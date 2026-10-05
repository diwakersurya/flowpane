import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiPressArgument } from 'claude-code'

import type { Ask, Guards, Pin, QueueItem, Snippet, Tab } from '../types'
import {
  askPrompt,
  clip,
  DEFAULT_SNIPPETS,
  explainQuestion,
  guardVerdict,
  GUARD_LABEL,
  maskDeep,
  needsBranch,
  NO_GUARDS,
  parseFence,
  parseSnippet,
  pinsSection,
  quote,
} from './logic'
import { AskTab, Band, guard, Header, PinsTab, QueueTab } from './views'

const PANE = 'flowpane'
const TITLE = 'Flowpane'

const pins = atom({ plugin: 'flowpane', key: 'pins' } as const, [] as Pin[])
const guards = atom({ plugin: 'flowpane', key: 'guards' } as const, NO_GUARDS)
const fence = atom({ plugin: 'flowpane', key: 'fence' } as const, [] as string[])
const asks = atom({ plugin: 'flowpane', key: 'asks' } as const, [] as Ask[])
const queue = atom({ plugin: 'flowpane', key: 'queue' } as const, [] as QueueItem[])
const autoSend = atom({ plugin: 'flowpane', key: 'autoSend' } as const, true)
const snippets = atom({ plugin: 'flowpane', key: 'snippets' } as const, [] as Snippet[])
const tab = atom({ plugin: 'flowpane', key: 'tab' } as const, 'pins' as Tab)

type $ = EngineInterface

const newId = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`

// ── per-project lists, mirrored to the store ───────────────────────

async function projectKey($: $, name: string) {
  return `${name}:${await $.session.cwd()}`
}

async function setPins($: $, fn: (list: Pin[]) => Pin[]) {
  await update($, pins, list => fn(list).slice(-30))
  await $.store.set(await projectKey($, 'pins'), await read($, pins))
}

async function addPin($: $, text: string) {
  const rule = clip(text, 300)
  if (!rule) return
  const id = newId('p')
  await setPins($, list => (list.some(p => p.text === rule) ? list : [...list, { id, text: rule, isOn: true }]))
}

async function setSnippets($: $, fn: (list: Snippet[]) => Snippet[]) {
  await update($, snippets, list => fn(list).slice(-12))
  await $.store.set(await projectKey($, 'snippets'), await read($, snippets))
}

async function addSnippet($: $, text: string) {
  const s = parseSnippet(text)
  if (!s) return false
  const id = newId('s')
  await setSnippets($, list => [...list, { id, label: clip(s.label, 24), text: clip(s.text, 500) }])
  return true
}

/** Restores this project's pins and snippets, and starts the guards for a new session. */
async function loadProject($: $, secretShield: boolean) {
  if ((await read($, pins)).length === 0) {
    const saved = (await $.store.get(await projectKey($, 'pins'))) as Pin[] | undefined
    if (saved?.length) await update($, pins, () => saved)
  }
  if ((await read($, snippets)).length === 0) {
    const saved = (await $.store.get(await projectKey($, 'snippets'))) as Snippet[] | undefined
    await update($, snippets, () => saved ?? DEFAULT_SNIPPETS)
  }
  // Guards are the session's: set once when it starts, kept across hot reloads.
  const { value } = await $.state.get({ plugin: 'flowpane', key: 'guards' })
  if (value === undefined) await update($, guards, () => ({ ...NO_GUARDS, secrets: secretShield }))
}

async function toggleGuard($: $, k: keyof Guards) {
  const was = (await read($, guards))[k]
  await update($, guards, g => ({ ...g, [k]: !g[k] }))
  $.ui.toast(`${GUARD_LABEL[k]} ${was ? 'off' : 'on'}`)
}

async function setFence($: $, text: string) {
  const globs = parseFence(text)
  await update($, fence, () => globs)
  $.ui.toast(globs.length ? `Edits fenced to ${globs.join(', ')}` : 'Fence off')
}

async function currentBranch($: $) {
  const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 }).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : undefined
}

// ── queue ──────────────────────────────────────────────────────────

async function enqueue($: $, text: string) {
  const t = text.trim()
  if (!t) return
  const id = newId('q')
  await update($, queue, list => [...list, { id, text: t }].slice(-30))
}

/** Sends one queued prompt as the person's own words; it starts once the session is idle. */
async function sendQueued($: $, id: string) {
  const item = (await read($, queue)).find(q => q.id === id)
  if (!item) return
  await update($, queue, list => list.filter(q => q.id !== id))
  await $.prompt.submit({ text: item.text, asUser: true })
}

async function sendNextQueued($: $) {
  const [first] = await read($, queue)
  if (first) await sendQueued($, first.id)
}

// ── ask aside: a fork over the transcript, never added to it ───────

async function askAside($: $, question: string) {
  const q = clip(question, 500)
  if (!q) return
  const at = await $.clock.now()
  const id = newId('a')
  await update($, asks, list => [...list, { id, question: q, status: 'thinking' as const, at }].slice(-20))
  const r = await $.model.fork({ prompt: askPrompt(q) })
  const answer = r.isAnswered
    ? r.text.trim()
    : r.reason === 'nothing-to-fork'
      ? 'Nothing to ask about yet: the conversation has no reply so far.'
      : `No answer (${r.reason}).`
  const status = r.isAnswered ? ('done' as const) : ('error' as const)
  await update($, asks, list => list.map(a => (a.id === id ? { ...a, answer, status } : a)))
}

async function useSelection($: $, action: 'explain' | 'quote' | 'pin') {
  const sel = await $.ui.selection()
  if (!sel?.text.trim()) {
    $.ui.toast('Select some text in the transcript first')
    return
  }
  if (action === 'quote') {
    await $.prompt.fill({ text: quote(sel.text), mode: 'insert' })
  } else if (action === 'pin') {
    await addPin($, sel.text)
    $.ui.toast('Pinned')
  } else {
    await askAside($, explainQuestion(sel.text))
  }
}

async function setTab($: $, next: Tab) {
  await update($, tab, () => next)
}

function openPane($: $) {
  return $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = (on, options) => {
  // ── session and commands ─────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'flow', description: 'Flowpane: toggle the panel, or `/flow pins|ask|queue`' })
    await $.command.register({ name: 'pin', description: 'Flowpane: pin a rule sent with every request, e.g. `/pin use pnpm`' })
    await $.command.register({ name: 'ask', description: 'Flowpane: ask a side question about this conversation without adding to it' })
    await $.command.register({ name: 'queue', description: 'Flowpane: queue a prompt to send when the agent is idle' })
    await $.command.register({ name: 'fence', description: 'Flowpane: fence edits to paths, e.g. `/fence src/auth/**`, or `/fence off`' })
    await $.command.register({ name: 'snippet', description: 'Flowpane: add a one-click prompt, e.g. `/snippet Lint: run the linter and fix`' })
    await loadProject($, options.secretShield !== false)
    const wasClosed = (await $.store.get('closedByPerson')) === true
    if (e.isInteractive && options.autoOpen !== false && !wasClosed) void openPane($)
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set('closedByPerson', true)
    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pins' || arg === 'ask' || arg === 'queue') {
      await setTab($, arg)
    } else if (arg === '' && (await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      await $.store.set('closedByPerson', true)
      return { text: 'Flowpane closed.' }
    } else if (arg !== '') {
      return { text: 'Usage: /flow [pins|ask|queue]' }
    }
    await $.store.set('closedByPerson', false)
    await openPane($)
    return { text: 'Flowpane opened.' }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      const list = await read($, pins)
      return { text: list.length ? list.map(p => `${p.isOn ? '☑' : '☐'} ${p.text}`).join('\n') : 'No pins. Add one with /pin <rule>.' }
    }
    await addPin($, text)
    return { text: `Pinned: ${clip(text, 80)}` }
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    const q = e.args.trim()
    if (!q) return { text: 'Usage: /ask <question about this conversation>' }
    await setTab($, 'ask')
    await openPane($)
    $.clock.after(0, () => void askAside($, q))
    return { text: 'Asking aside… the answer shows in Flowpane.' }
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      const list = await read($, queue)
      return { text: list.length ? list.map((q, i) => `${i + 1}. ${q.text}`).join('\n') : 'Nothing queued. Add with /queue <prompt>.' }
    }
    await enqueue($, text)
    return { text: `Queued (${(await read($, queue)).length}): ${clip(text, 80)}` }
  })

  on('command.run', { command: 'fence' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) {
      const f = await read($, fence)
      return { text: f.length ? `Edits fenced to ${f.join(', ')}. /fence off removes it.` : 'No fence. Set one with /fence <globs>.' }
    }
    await setFence($, arg.toLowerCase() === 'off' ? '' : arg)
    const f = await read($, fence)
    return { text: f.length ? `Edits fenced to ${f.join(', ')}.` : 'Fence off.' }
  })

  on('command.run', { command: 'snippet' }, async ($, e) => {
    return (await addSnippet($, e.args)) ? { text: 'Snippet added to the band.' } : { text: 'Usage: /snippet <label>: <prompt text>' }
  })

  // ── what pins and guards do ──────────────────────────────────────

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const text = pinsSection(await read($, pins), await read($, guards), await read($, fence))
    if (!text) return r
    return { sections: [...r.sections, { id: 'flowpane:pins', text, scope: 'session' as const }] }
  })

  on('tool.check', async ($, e, next) => {
    const gs = await read($, guards)
    const ctx = {
      fence: await read($, fence),
      cwd: await $.session.cwd(),
      branch: needsBranch(gs, e.tool, e.input) ? await currentBranch($) : undefined,
    }
    const verdict = guardVerdict(gs, e.tool, e.input, ctx)
    if (!verdict) return next(e)
    if (verdict.decision === 'deny') return verdict
    const r = await next(e)
    return r.decision === 'deny' ? r : verdict
  })

  // The secret shield masks tokens in every tool result before the model reads it.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny || r.result === undefined || !(await read($, guards)).secrets) return r
    const masked = maskDeep(r.result)
    if (masked === r.result) return r
    return r.isError ? { result: masked, isError: true as const } : { result: masked }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.reason === 'answer' && (await read($, autoSend)) && (await read($, queue)).length > 0) {
      $.clock.after(0, () => void sendNextQueued($))
    }
    return r
  })

  // ── drawing ──────────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band === false || e.props.hasSurvey) return next(e)
    const [gs, ps, f, qs, ss] = await Promise.all([read($, guards), read($, pins), read($, fence), read($, queue), read($, snippets)])
    const els = $.ui.resolve(e)
    const onGuard = (k: keyof Guards) => void toggleGuard($, k)
    const onSnippet = (id: string) => {
      const s = ss.find(x => x.id === id)
      if (s) void $.prompt.fill({ text: s.text, mode: 'insert' })
    }
    return (
      <els.Box>
        {guard(els, 'band', () =>
          Band(els, {
            guards: gs,
            fence: f,
            pinsOn: ps.filter(p => p.isOn).length,
            queued: qs.length,
            snippets: ss,
            rows: e.props.maxRows,
            onGuard,
            onSnippet,
          }),
        )}
      </els.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const [ps, gs, f, as, qs, auto, ss, savedTab] = await Promise.all([
      read($, pins),
      read($, guards),
      read($, fence),
      read($, asks),
      read($, queue),
      read($, autoSend),
      read($, snippets),
      read($, tab),
    ])
    // A tab saved by an older version (flow, changes…) falls back to Pins.
    const current: Tab = savedTab === 'ask' || savedTab === 'queue' ? savedTab : 'pins'

    const onTab = (next: Tab) => void setTab($, next)
    const onGuard = (k: keyof Guards) => void toggleGuard($, k)
    const onFence = (text: string) => void setFence($, text)
    const onAdd = (text: string) => void addPin($, text)
    const onTogglePin = (id: string) => void setPins($, list => list.map(p => (p.id === id ? { ...p, isOn: !p.isOn } : p)))
    const onRemovePin = (id: string) => void setPins($, list => list.filter(p => p.id !== id))
    const onAsk = (q: string) => void askAside($, q)
    const onSel = (action: 'explain' | 'quote' | 'pin', _press: UiPressArgument) => void useSelection($, action)
    const onInsert = (id: string) => {
      const a = as.find(x => x.id === id)
      if (a?.answer) void $.prompt.fill({ text: a.answer, mode: 'insert' })
    }
    const onRemoveAsk = (id: string) => void update($, asks, list => list.filter(a => a.id !== id))
    const onAuto = () => void update($, autoSend, v => !v)
    const onEnqueue = (text: string) => void enqueue($, text)
    const onSend = (id: string) => void sendQueued($, id)
    const onMove = (id: string, by: -1 | 1) =>
      void update($, queue, list => {
        const i = list.findIndex(q => q.id === id)
        const j = i + by
        if (i < 0 || j < 0 || j >= list.length) return list
        const next = list.slice()
        ;[next[i], next[j]] = [next[j]!, next[i]!]
        return next
      })
    const onDequeue = (id: string) => void update($, queue, list => list.filter(q => q.id !== id))
    const onAddSnippet = (text: string) => void addSnippet($, text)
    const onRemoveSnippet = (id: string) => void setSnippets($, list => list.filter(s => s.id !== id))

    const { Box } = els
    const body =
      current === 'ask'
        ? guard(els, 'ask', () => AskTab(els, Input, { asks: as, onAsk, onSelection: onSel, onInsert, onRemove: onRemoveAsk }))
        : current === 'queue'
          ? guard(els, 'queue', () =>
              QueueTab(els, Input, {
                queue: qs,
                autoSend: auto,
                snippets: ss,
                onAuto,
                onAdd: onEnqueue,
                onSend,
                onMove,
                onRemove: onDequeue,
                onAddSnippet,
                onRemoveSnippet,
              }),
            )
          : guard(els, 'pins', () =>
              PinsTab(els, Input, { pins: ps, guards: gs, fence: f, onGuard, onFence, onAdd, onToggle: onTogglePin, onRemove: onRemovePin }),
            )

    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        {guard(els, 'header', () =>
          Header(els, {
            tab: current,
            pinsOn: ps.filter(p => p.isOn).length + (f.length ? 1 : 0),
            guardsOn: Object.values(gs).filter(Boolean).length,
            queued: qs.length,
            onTab,
          }),
        )}
        <Box flexDirection="column" marginTop={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
