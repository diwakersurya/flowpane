// Pure reducers and derivations: no `$`, so tests run them directly.
import type { Decision, FlowNode, Status, Todo, TodoStatus } from '../types'

const LABEL_MAX = 60

export const clip = (text: string, max = LABEL_MAX) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

const tail = (path: string) => path.split('/').slice(-2).join('/')

/** "Edit src/app.ts", "Bash npm test", "Grep requireAuth". */
export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  const arg =
    (path && tail(path)) ??
    str('command') ??
    str('pattern') ??
    str('url') ??
    str('query') ??
    str('skill') ??
    str('description') ??
    str('subject') ??
    Object.values(input).find((v): v is string => typeof v === 'string')
  return clip(arg ? `${name} ${arg}` : name)
}

export const currentTurn = (nodes: readonly FlowNode[]) =>
  [...nodes].reverse().find(n => n.kind === 'turn')

export function startTurn(nodes: readonly FlowNode[], id: string, text: string, at: number): FlowNode[] {
  const n = nodes.filter(x => x.kind === 'turn').length + 1
  const label = clip(text, 40) || 'continuation'
  return [...nodes, { id, kind: 'turn', label, status: 'running', startedAt: at, n }]
}

export function endNode(nodes: readonly FlowNode[], id: string, status: Status, at: number): FlowNode[] {
  return nodes.map(x => (x.id === id && x.status === 'running' ? { ...x, status, endedAt: at } : x))
}

/** Upserts a tool or agent node under its parent (turn, or the subagent's Agent call). */
export function startTool(
  nodes: readonly FlowNode[],
  node: Omit<FlowNode, 'status' | 'kind'> & { kind?: FlowNode['kind'] },
): FlowNode[] {
  const full: FlowNode = { kind: 'tool', status: 'running', ...node }
  const i = nodes.findIndex(x => x.id === node.id)
  if (i === -1) return [...nodes, full]
  const next = nodes.slice()
  next[i] = { ...nodes[i]!, ...node, kind: node.kind ?? nodes[i]!.kind }
  return next
}

const descendants = (nodes: readonly FlowNode[], id: string): Set<string> => {
  const out = new Set<string>()
  let frontier = [id]
  while (frontier.length) {
    const kids = nodes.filter(x => x.parent && frontier.includes(x.parent)).map(x => x.id)
    kids.forEach(k => out.add(k))
    frontier = kids
  }
  return out
}

/** Past `max` nodes, drops the oldest turns' children, keeping each turn as a summary. */
export function prune(nodes: readonly FlowNode[], max: number): FlowNode[] {
  let out = nodes.slice()
  const turns = out.filter(x => x.kind === 'turn' && x.status !== 'running')
  for (const turn of turns) {
    if (out.length <= max) break
    const drop = descendants(out, turn.id)
    if (drop.size === 0) continue
    out = out
      .filter(x => !drop.has(x.id))
      .map(x => (x.id === turn.id ? { ...x, pruned: (x.pruned ?? 0) + drop.size } : x))
  }
  return out
}

// ── todos ──────────────────────────────────────────────────────────

export function fromTodoWrite(
  list: readonly { content: string; status: TodoStatus; activeForm?: string }[],
  at: number,
): Todo[] {
  return list.map((t, i) => ({ id: `tw${i}`, content: t.content, activeForm: t.activeForm, status: t.status, updatedAt: at }))
}

export function taskCreate(todos: readonly Todo[], id: string, subject: string, activeForm: string | undefined, at: number): Todo[] {
  return [...todos.filter(t => t.id !== id), { id, content: subject, activeForm, status: 'pending', updatedAt: at }]
}

export function taskUpdate(
  todos: readonly Todo[],
  u: { taskId: string; subject?: string; activeForm?: string; status?: TodoStatus | 'deleted' },
  at: number,
): Todo[] {
  const status = u.status
  if (status === 'deleted') return todos.filter(t => t.id !== u.taskId)
  return todos.map(t =>
    t.id === u.taskId
      ? {
          ...t,
          content: u.subject ?? t.content,
          activeForm: u.activeForm ?? t.activeForm,
          status: status ?? t.status,
          updatedAt: at,
        }
      : t,
  )
}

// ── decisions ──────────────────────────────────────────────────────

const CUES = /\b(instead of|rather than|chose|choosing|going with|opted|decided|over the)\b/i

export const hasDecisionCue = (text: string) => CUES.test(text)

export const extractPrompt = (answer: string) =>
  `Below is an AI coding assistant's message. If it states a choice between approaches, reply with JSON only:
{"choice":"<X over Y, under 12 words>","why":"<reason, under 15 words>","alternatives":["Y"]}
If it states no such choice, reply with exactly: null

Message:
${answer.slice(0, 6000)}`

/** Reads the extractor's reply: a decision, or undefined for `null` or anything malformed. */
export function parseDecision(text: string): Pick<Decision, 'choice' | 'why' | 'alternatives'> | undefined {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return undefined
  try {
    const v = JSON.parse(json) as Record<string, unknown>
    if (typeof v.choice !== 'string' || !v.choice.trim()) return undefined
    return {
      choice: clip(v.choice, 120),
      why: typeof v.why === 'string' ? clip(v.why, 160) : undefined,
      alternatives: Array.isArray(v.alternatives) ? v.alternatives.filter((a): a is string => typeof a === 'string') : undefined,
    }
  } catch {
    return undefined
  }
}

// ── view rows ──────────────────────────────────────────────────────

export type Row = {
  node: FlowNode
  depth: number
  /** Present on rows that hold children: whether they show. */
  isOpen?: boolean
  /** Children count (tools inside a subagent, calls in a turn). */
  count: number
}

/**
 * Flattens the tree newest turn first. The latest turn starts open, every
 * other turn and every subagent starts shut; `toggled` flips that default.
 */
export function buildRows(nodes: readonly FlowNode[], toggled: readonly string[]): Row[] {
  const flip = new Set(toggled)
  const kids = new Map<string, FlowNode[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const list = kids.get(n.parent) ?? []
    list.push(n)
    kids.set(n.parent, list)
  }
  const latest = currentTurn(nodes)?.id
  const rows: Row[] = []
  const walk = (node: FlowNode, depth: number) => {
    const children = kids.get(node.id) ?? []
    const count = children.length + (node.pruned ?? 0)
    const holds = node.kind === 'turn' || (node.kind === 'agent' && children.length > 0)
    const byDefault = node.kind === 'turn' && node.id === latest
    const isOpen = holds ? byDefault !== flip.has(node.id) : undefined
    rows.push({ node, depth, isOpen, count })
    if (isOpen) children.forEach(c => walk(c, depth + 1))
  }
  const turns = nodes.filter(n => n.kind === 'turn').reverse()
  turns.forEach(t => walk(t, 0))
  return rows
}

export const ICON: Record<Status, string> = { running: '●', done: '✓', error: '✗', denied: '⊘' }

export const duration = (n: FlowNode, now: number) => {
  const s = Math.round(((n.endedAt ?? now) - n.startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export const bar = (part: number, whole: number, width: number) => {
  const filled = whole > 0 ? Math.round((part / whole) * width) : 0
  return '█'.repeat(Math.min(width, filled)) + '░'.repeat(Math.max(0, width - filled))
}

export const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

// ── tool families: minimap and SVG colours ─────────────────────────

const FAMILY: [RegExp, number][] = [
  [/^(Read|Glob|Grep|LS|NotebookRead)$/, 0x5fafff], // read: blue
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 0xffaf00], // write: amber
  [/^(Bash|BashOutput|KillShell|PowerShell)$/, 0xaf87ff], // shell: violet
  [/^(Agent|Task)$/, 0x5fd7af], // agents: teal
  [/^(WebFetch|WebSearch)$/, 0x87d7ff], // web: sky
  [/^mcp__/, 0xd787af], // mcp: pink
]

export const familyColor = (tool = '') => FAMILY.find(([re]) => re.test(tool))?.[1] ?? 0x9e9e9e

export const hex = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0')

/** One row of cells, one per tool call (latest at the right); error calls red. */
export function minimapCells(nodes: readonly FlowNode[], columns: number): Uint32Array {
  const calls = nodes.filter(n => n.kind !== 'turn').slice(-columns)
  const words = new Uint32Array(columns * 3)
  for (let i = 0; i < columns; i++) {
    const n = calls[i - (columns - calls.length)]
    const fg = n ? (n.status === 'error' ? 0xff5f5f : familyColor(n.tool)) : 0x01000000
    words.set([n ? 0x2588 : 0x20, fg, 0x01000000], i * 3)
  }
  return words
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const STATUS_FILL: Record<Status, string> = { running: '#ffd75f', done: '#5faf5f', error: '#ff5f5f', denied: '#9e9e9e' }

/**
 * Lane diagram for the remote surfaces: one lane for main, one per subagent;
 * the last `max` calls left to right, turn boundaries as rules.
 */
export function svgLanes(nodes: readonly FlowNode[], now: number, max = 60): string {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const calls = nodes.filter(n => n.kind !== 'turn').slice(-max)
  const laneOf = (n: FlowNode) => {
    const parent = n.parent ? byId.get(n.parent) : undefined
    return parent?.kind === 'agent' ? parent.id : 'main'
  }
  const lanes = ['main', ...new Set(calls.map(laneOf).filter(l => l !== 'main'))]
  const W = 26, H = 30, PAD = 90
  const width = PAD + Math.max(1, calls.length) * W + 10
  const height = lanes.length * H + 10
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="ui-monospace,monospace" font-size="11">`,
    `<style>.n:hover{stroke:#fff;stroke-width:2}.run{animation:p 1s ease-in-out infinite alternate}@keyframes p{from{opacity:.4}to{opacity:1}}</style>`,
  ]
  lanes.forEach((lane, i) => {
    const y = 5 + i * H
    const name = lane === 'main' ? 'main' : (byId.get(lane)?.label ?? 'agent')
    out.push(`<text x="4" y="${y + 18}" fill="#888">${esc(clip(name, 12))}</text>`)
    out.push(`<line x1="${PAD - 4}" x2="${width}" y1="${y + 14}" y2="${y + 14}" stroke="#444" stroke-dasharray="2 3"/>`)
  })
  let lastTurn: string | undefined
  calls.forEach((n, i) => {
    const x = PAD + i * W
    let turn: FlowNode | undefined = n
    while (turn && turn.kind !== 'turn') turn = turn.parent ? byId.get(turn.parent) : undefined
    if (turn && turn.id !== lastTurn) {
      out.push(`<line x1="${x - 3}" x2="${x - 3}" y1="0" y2="${height}" stroke="#666"/>`)
      out.push(`<text x="${x}" y="${height - 1}" fill="#666" font-size="9">T${turn.n ?? ''}</text>`)
      lastTurn = turn.id
    }
    const y = 5 + lanes.indexOf(laneOf(n)) * H
    const tip = `${n.label} · ${n.status} · ${duration(n, now)}`
    out.push(
      `<rect class="n${n.status === 'running' ? ' run' : ''}" x="${x}" y="${y + 4}" width="${W - 6}" height="20" rx="5" fill="${STATUS_FILL[n.status]}" stroke="${hex(familyColor(n.tool))}" stroke-width="2"><title>${esc(tip)}</title></rect>`,
    )
  })
  out.push('</svg>')
  return out.join('')
}

// ── pet ────────────────────────────────────────────────────────────

/** Where the cat looks: -2 far left (Flow), 0 ahead (Todos), 2 far right (Decisions). */
export const PET_TARGET: Record<'flow' | 'todos' | 'decisions', number> = { flow: -2, todos: 0, decisions: 2 }

const EYES: Record<number, string> = { [-2]: '<.<  ', [-1]: 'o.o  ', 0: ' o.o ', 1: '  o.o', 2: '  >.>' }

/** The cat at a head position: three rows, seven columns; ears follow the head. */
export function petFrame(pos: number): [string, string, string] {
  const p = Math.max(-2, Math.min(2, Math.round(pos)))
  const ears = p < 0 ? '/\\_/\\  ' : p > 0 ? '  /\\_/\\' : ' /\\_/\\ '
  return [ears, `(${EYES[p]})`, ' > ^ < ']
}

/** One step of the head from `pos` toward `target`. */
export const stepToward = (pos: number, target: number) => pos + Math.sign(target - pos)
