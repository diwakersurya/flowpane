import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, UiPressArgument } from 'claude-code'

import type { ContextFill, Decision, FlowNode, Question, Snapshot, Tab, Todo } from '../types'
import {
  answered,
  asked,
  currentTurn,
  endNode,
  extractPrompt,
  fromTodoWrite,
  hasDecisionCue,
  mermaidOf,
  minimapCells,
  parseDecision,
  PET_TARGET,
  petFrame,
  prune,
  questionsFromHistory,
  startTool,
  stepToward,
  startTurn,
  svgLanes,
  svgQuestions,
  taskCreate,
  taskUpdate,
  toolLabel,
} from './model'
import { DecisionList, FlowList, guard, Header, LastDecision, Pet, petSvg, QuestionFlow, TodoList } from './views'

const PANE = 'flowpane'
const TITLE = 'Flowpane'
const DECISION_TOOL = 'mcp__flowpane__RecordDecision'
const SNAPSHOT_TTL_MS = 14 * 24 * 3600 * 1000

const nodes = atom({ plugin: 'flowpane', key: 'nodes' } as const, [] as FlowNode[])
const todos = atom({ plugin: 'flowpane', key: 'todos' } as const, [] as Todo[])
const decisions = atom({ plugin: 'flowpane', key: 'decisions' } as const, [] as Decision[])
const questions = atom({ plugin: 'flowpane', key: 'questions' } as const, [] as Question[])
const agents = atom({ plugin: 'flowpane', key: 'agents' } as const, {} as Record<string, string>)
const toggled = atom({ plugin: 'flowpane', key: 'toggled' } as const, [] as string[])
const tab = atom({ plugin: 'flowpane', key: 'tab' } as const, 'flow' as Tab)
const petPos = atom({ plugin: 'flowpane', key: 'petPos' } as const, PET_TARGET.flow)
const context = atom({ plugin: 'flowpane', key: 'context' } as const, null as ContextFill | null)

const DECISION_PROMPT = `# Flowpane decision log
When you choose between two or more approaches (a library, a design, a fix strategy), call the ${DECISION_TOOL} tool once with the choice, a short reason and the alternatives you rejected. Load it with ToolSearch first if it is deferred. Do not call it for trivial steps.`

type $ = EngineInterface

/** The environment's Uint8Array.toBase64, which the es2023 lib does not type. */
const base64 = (words: Uint32Array) => (new Uint8Array(words.buffer) as unknown as { toBase64(): string }).toBase64()

async function storeKey($: $) {
  return `session:${await $.session.id()}`
}

async function save($: $) {
  const snap: Snapshot = {
    nodes: await read($, nodes),
    todos: await read($, todos),
    decisions: await read($, decisions),
    agents: await read($, agents),
    questions: await read($, questions),
    savedAt: await $.clock.now(),
  }
  await $.store.set(await storeKey($), snap)
}

async function restoreAndPrune($: $) {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith('session:')) continue
    const snap = (await $.store.get(key)) as Snapshot | undefined
    if (!snap || now - snap.savedAt > SNAPSHOT_TTL_MS) await $.store.delete(key)
  }
  if ((await read($, questions)).length === 0) {
    const history = questionsFromHistory(await $.session.messages(), now)
    if (history.length) await update($, questions, () => history.slice(-100))
  }
  if ((await read($, nodes)).length > 0) return // a hot reload keeps $.state
  const snap = (await $.store.get(await storeKey($))) as Snapshot | undefined
  if (!snap) return
  await update($, nodes, () => snap.nodes)
  await update($, todos, () => snap.todos)
  await update($, decisions, () => snap.decisions)
  await update($, agents, () => snap.agents)
  await update($, questions, () => snap.questions ?? [])
}

async function reset($: $) {
  await update($, nodes, () => [])
  await update($, todos, () => [])
  await update($, decisions, () => [])
  await update($, agents, () => ({}))
  await update($, questions, () => [])
  await update($, toggled, () => [])
}

const PET_STEP_MS = 90
let petTimer: Timer | undefined

/** Switches tab and turns the cat's head toward it, one frame per step. */
async function setTab($: $, next: Tab) {
  await update($, tab, () => next)
  petTimer?.cancel()
  const target = PET_TARGET[next]
  petTimer = $.clock.every(PET_STEP_MS, () => {
    void stepPet($, target)
  })
}

async function stepPet($: $, target: number) {
  const pos = await read($, petPos)
  if (pos === target) {
    petTimer?.cancel()
    return
  }
  await update($, petPos, p => stepToward(p, target))
}

function openPane($: $) {
  return $.ui.open({ id: PANE, title: TITLE })
}

async function addDecision($: $, d: Omit<Decision, 'id' | 'turnId' | 'at'>) {
  const turnId = currentTurn(await read($, nodes))?.id ?? ''
  const at = await $.clock.now()
  await update($, decisions, list => [...list, { ...d, id: `d${at}-${list.length}`, turnId, at }].slice(-200))
}


export const register: Register = (on, options) => {
  const maxNodes = Number(options.maxNodes ?? 500)
  const isDecisionTool = options.decisionTool !== false

  // ── session ──────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: 'Flowpane: toggle the panel, or `/flow todos|decisions|flow|clear`',
    })
    if (isDecisionTool) {
      await $.tool.register({
        name: 'RecordDecision',
        description:
          'Log a decision you made between approaches so it shows in the Flowpane side panel. Call once per real choice, not for routine steps.',
        inputSchema: {
          type: 'object',
          properties: {
            choice: { type: 'string', description: 'What was chosen over what, under 12 words, e.g. "StyleX over CSS modules"' },
            why: { type: 'string', description: 'The reason, one short sentence' },
            alternatives: { type: 'array', items: { type: 'string' }, description: 'Options considered and rejected' },
          },
          required: ['choice'],
        },
      })
    }
    await restoreAndPrune($)
    const wasClosed = (await $.store.get('closedByPerson')) === true
    if (e.isInteractive && options.autoOpen !== false && !wasClosed) void openPane($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set('closedByPerson', true)
    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear') {
      await reset($)
      return { text: 'Flowpane view cleared.' }
    }
    if (arg === 'flow' || arg === 'todos' || arg === 'decisions') {
      await setTab($, arg)
    } else if (arg === '' && (await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      await $.store.set('closedByPerson', true)
      return { text: 'Flowpane closed.' }
    } else if (arg !== '') {
      return { text: 'Usage: /flow [flow|todos|decisions|clear]' }
    }
    await $.store.set('closedByPerson', false)
    await openPane($)
    return { text: 'Flowpane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    const c = e.context
    if (e.changed.includes('context') && c.tokens !== undefined) {
      await update($, context, () => ({ used: c.tokens!, window: c.window, percent: c.percent ?? Math.round((c.tokens! / c.window) * 100) }))
    }
    return next(e)
  })

  // ── turns ────────────────────────────────────────────────────────

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, nodes, list => prune(startTurn(list, e.turnId, e.text, at), maxNodes))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const at = await $.clock.now()
    await update($, nodes, list => endNode(list, e.turnId, e.isAborted ? 'error' : e.reason === 'answer' ? 'done' : 'error', at))
    await save($)

    const shouldInfer =
      options.inferDecisions === true &&
      e.reason === 'answer' &&
      hasDecisionCue(e.answer) &&
      !(await read($, decisions)).some(d => d.turnId === e.turnId)
    if (shouldInfer) {
      // Off the turn's dispatch, so the answer is never held up by the extraction.
      const answer = e.answer
      const turnId = e.turnId
      $.clock.after(0, () => {
        void (async () => {
          const r = await $.model.complete({ model: 'haiku', prompt: extractPrompt(answer), maxTokens: 200 })
          const d = r.isAnswered ? parseDecision(r.text) : undefined
          if (!d) return
          const now = await $.clock.now()
          await update($, decisions, list => [...list, { ...d, id: `d${now}`, turnId, at: now, source: 'inferred' as const }])
        })().catch(() => {})
      })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!isDecisionTool) return r
    return { sections: [...r.sections, { id: 'flowpane:decisions', text: DECISION_PROMPT, scope: 'session' as const }] }
  })

  // ── tool calls ───────────────────────────────────────────────────

  on('tool.call', { tool: /^mcp__flowpane__RecordDecision$/ }, async ($, e) => {
    const input = e as unknown as { choice?: unknown; why?: unknown; alternatives?: unknown }
    const d = parseDecision(JSON.stringify(input))
    if (!d) return { deny: 'RecordDecision needs a non-empty "choice" string.' }
    await addDecision($, { ...d, source: 'tool' })
    return { result: 'Recorded in Flowpane.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!r.deny && r.agentId) {
      const agentId = r.agentId
      await update($, agents, map => ({ ...map, [agentId]: e.tool_use_id }))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === DECISION_TOOL || !e.tool_use_id) return next(e)
    const id = e.tool_use_id
    const at = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const agentMap = await read($, agents)
    const parent = e.agentId ? agentMap[e.agentId] : currentTurn(await read($, nodes))?.id
    const isAgent = tool === 'Agent' || tool === 'Task'
    const label = isAgent
      ? `${String(input.subagent_type ?? 'agent')}: ${String(input.description ?? '')}`
      : toolLabel(tool, input)
    await update($, nodes, list => startTool(list, { id, kind: isAgent ? 'agent' : 'tool', tool, label, parent, startedAt: at }))
    if (e.tool === 'AskUserQuestion') {
      const turnId = currentTurn(await read($, nodes))?.id ?? ''
      await update($, questions, list => [...list, ...asked(e, id, turnId, at)].slice(-100))
    }

    const r = await next(e)

    if (!e.agentId && !r.deny && !r.isError) {
      const now = await $.clock.now()
      if (e.tool === 'TodoWrite') await update($, todos, () => fromTodoWrite(e.todos, now))
      else if (e.tool === 'TaskCreate' && r.result) {
        const created = (r.result as { task?: { id: string } }).task
        if (created) await update($, todos, list => taskCreate(list, created.id, e.subject, e.activeForm, now))
      } else if (e.tool === 'TaskUpdate') await update($, todos, list => taskUpdate(list, e, now))
    }
    if (e.tool === 'AskUserQuestion') {
      const answers = !r.deny && !r.isError ? (r.result as { answers?: Record<string, unknown> } | undefined)?.answers : undefined
      await update($, questions, list => answered(list, id, answers))
    }
    const status = r.deny ? 'denied' : r.isError ? 'error' : 'done'
    const endedAt = await $.clock.now()
    await update($, nodes, list => endNode(list, id, status, endedAt))
    return r
  })

  // ── drawing ──────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const room = Math.max(6, (e.viewport?.rows ?? 30) - 8)
    const [n, t, d, open, current, ctx, pos, qs] = await Promise.all([
      read($, nodes),
      read($, todos),
      read($, decisions),
      read($, toggled),
      read($, tab),
      read($, context),
      read($, petPos),
      read($, questions),
    ])
    const now = await $.clock.now()
    const onTab = (next: Tab) => void setTab($, next)
    const onToggle = (id: string) => void update($, toggled, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
    const onJump = (turnId: string) => {
      void setTab($, 'flow')
      const latest = currentTurn(n)?.id
      // Open the turn: the latest is open by default, the rest open when toggled.
      void update($, toggled, list =>
        turnId === latest ? list.filter(x => x !== turnId) : list.includes(turnId) ? list : [...list, turnId],
      )
    }
    const onCopy = (press: UiPressArgument) => {
      void $.ui.copy({ text: mermaidOf(qs), surface: press.surface }).then(r => {
        $.ui.toast(r.isCopied ? 'Mermaid copied to the clipboard' : 'Could not copy here')
      })
    }
    const { Box } = els

    let picture = null
    if (current === 'flow' && n.length > 0) {
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)
        if (options.minimap !== false) {
          picture = guard(els, 'minimap', () => (
            <Raster key="minimap" columns={width} rows={1} cells={base64(minimapCells(n, width))} />
          ))
        }
      } else {
        const { Svg } = $.ui.resolve(e)
        picture = guard(els, 'lanes', () => (
          <Svg source={svgLanes(n, now)} alt="Tool calls per agent lane, newest at the right" isInteractive />
        ))
      }
    }

    const body =
      current === 'todos'
        ? guard(els, 'todos', () => TodoList(els, { todos: t, width }))
        : current === 'decisions'
          ? guard(els, 'decisions', () => DecisionList(els, { decisions: d, nodes: n, width, onJump }))
          : guard(els, 'flow', () => (
              <Box flexDirection="column">
                {QuestionFlow(els, {
                  questions: qs.slice(-8),
                  width,
                  onCopy,
                  picture:
                    e.surface === 'terminal' || qs.length === 0
                      ? undefined
                      : (() => {
                          const { Svg } = $.ui.resolve(e)
                          return <Svg source={svgQuestions(qs.slice(-8))} alt="Questions asked and the options picked" isInteractive />
                        })(),
                })}
                {FlowList(els, { nodes: n, toggled: open, now, width, room, onToggle })}
                {LastDecision(els, { decision: d[d.length - 1], width })}
              </Box>
            ))

    return (
      <Box flexDirection="column" width={width}>
        {guard(els, 'header', () => Header(els, { tab: current, todos: t, decisions: d, context: ctx, width, onTab }))}
        {picture}
        <Box flexDirection="column" marginTop={1}>
          {body}
        </Box>
        {guard(els, 'pet', () => {
          const frame = petFrame(pos)
          if (e.surface === 'terminal') return Pet(els, { frame })
          const { Svg } = $.ui.resolve(e)
          return Pet(els, { frame, svg: <Svg source={petSvg(frame)} alt="Flowpane cat" width={64} height={50} /> })
        })}
      </Box>
    )
  })
}
