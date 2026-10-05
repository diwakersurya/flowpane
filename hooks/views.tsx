import type { Elements, RenderNode } from 'claude-code'

import type { ContextFill, Decision, FlowNode, Tab, Todo } from '../types'
import { bar, buildRows, clip, duration, ICON, kilo } from './model'

/** The elements every surface draws: what the shared views are built from. */
export type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const TAB_NAMES: Record<Tab, string> = { flow: 'Flow', todos: 'Todos', decisions: 'Decisions' }
const HOTKEY: Record<Tab, string> = { flow: 'f', todos: 't', decisions: 'd' }

export function Header(
  { Box, Text, Button }: Common,
  p: { tab: Tab; todos: readonly Todo[]; decisions: readonly Decision[]; context: ContextFill | null; width: number; onTab: (t: Tab) => void },
) {
  const done = p.todos.filter(t => t.status === 'completed').length
  const badge: Record<Tab, string> = {
    flow: '',
    todos: p.todos.length ? ` ${done}/${p.todos.length}` : '',
    decisions: p.decisions.length ? ` ${p.decisions.length}` : '',
  }
  const ctx = p.context
  const barWidth = Math.max(4, Math.min(16, p.width - 22))
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {(Object.keys(TAB_NAMES) as Tab[]).map(t => (
          <Button
            key={`tab-${t}`}
            label={TAB_NAMES[t] + badge[t]}
            hotkey={HOTKEY[t]}
            variant={t === p.tab ? 'primary' : undefined}
            dimColor={t !== p.tab}
            onPress={() => p.onTab(t)}
          />
        ))}
      </Box>
      {ctx ? (
        <Text dimColor wrap="truncate">
          ctx <Text color={ctx.percent >= 80 ? 'red' : ctx.percent >= 60 ? 'yellow' : 'green'}>{bar(ctx.used, ctx.window, barWidth)}</Text>{' '}
          {kilo(ctx.used)} / {kilo(ctx.window)} · {kilo(Math.max(0, ctx.window - ctx.used))} left
        </Text>
      ) : (
        <Text dimColor>ctx —</Text>
      )}
    </Box>
  )
}

const STATUS_COLOR = { running: 'yellow', done: 'green', error: 'red', denied: 'gray' } as const

export function FlowList(
  { Box, Text, Button }: Common,
  p: { nodes: readonly FlowNode[]; toggled: readonly string[]; now: number; width: number; room: number; onToggle: (id: string) => void },
) {
  const rows = buildRows(p.nodes, p.toggled).slice(0, Math.max(3, p.room))
  if (rows.length === 0) return <Text dimColor>Waiting for the first turn…</Text>
  return (
    <Box flexDirection="column">
      {rows.map(({ node, depth, isOpen, count }) => {
        const pad = '  '.repeat(depth)
        const caret = isOpen === undefined ? ' ' : isOpen ? '▼' : '▸'
        if (node.kind === 'turn') {
          const meta = isOpen ? duration(node, p.now) : `${count} calls · ${duration(node, p.now)}`
          return (
            <Button
              key={`row-${node.id}`}
              plain
              label={clip(`${caret} Turn ${node.n ?? ''} "${node.label}"  ${meta}${node.status === 'running' ? ' ●' : ''}`, p.width)}
              onPress={() => p.onToggle(node.id)}
            />
          )
        }
        const icon = node.kind === 'agent' ? '◆' : ICON[node.status]
        const tail = node.kind === 'agent' && count ? `  ${count}` : node.status === 'running' ? '  running' : ''
        const text = clip(`${pad}${caret} ${icon} ${node.label}${tail}`, p.width)
        return isOpen !== undefined ? (
          <Button key={`row-${node.id}`} plain label={text} onPress={() => p.onToggle(node.id)} />
        ) : (
          <Text color={node.kind === 'agent' ? 'cyan' : STATUS_COLOR[node.status]} dimColor={node.status === 'done'} wrap="truncate">
            {text}
          </Text>
        )
      })}
    </Box>
  )
}

export function LastDecision({ Box, Text }: Common, p: { decision: Decision | undefined; width: number }) {
  if (!p.decision) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="magenta" wrap="truncate">
        ◆ {clip(p.decision.choice, p.width - 2)}
      </Text>
      {p.decision.why && (
        <Text dimColor wrap="wrap">
          {'  '}
          {p.decision.why}
        </Text>
      )}
    </Box>
  )
}

const TODO_ICON = { completed: '✓', in_progress: '●', pending: '○' } as const

export function TodoList({ Box, Text }: Common, p: { todos: readonly Todo[]; width: number }) {
  if (p.todos.length === 0) return <Text dimColor>No todos yet. They show when the agent plans a task list.</Text>
  const done = p.todos.filter(t => t.status === 'completed').length
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{bar(done, p.todos.length, Math.max(4, Math.min(20, p.width - 10)))}</Text> {done}/{p.todos.length}
      </Text>
      {p.todos.map(t => (
        <Text
          color={t.status === 'in_progress' ? 'yellow' : undefined}
          dimColor={t.status === 'completed'}
          bold={t.status === 'in_progress'}
          wrap="truncate"
        >
          {TODO_ICON[t.status]} {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
        </Text>
      ))}
    </Box>
  )
}

export function DecisionList(
  { Box, Text, Button }: Common,
  p: { decisions: readonly Decision[]; nodes: readonly FlowNode[]; width: number; onJump: (turnId: string) => void },
) {
  if (p.decisions.length === 0) return <Text dimColor>No decisions logged yet.</Text>
  const turnNo = new Map(p.nodes.filter(n => n.kind === 'turn').map(n => [n.id, n.n]))
  return (
    <Box flexDirection="column" gap={1}>
      {[...p.decisions].reverse().map(d => (
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            {d.source === 'inferred' ? '~ ' : '◆ '}
            {d.choice}
          </Text>
          {d.why && <Text dimColor wrap="wrap">{d.why}</Text>}
          {d.alternatives?.length ? (
            <Text dimColor strikethrough wrap="truncate">
              {d.alternatives.join(', ')}
            </Text>
          ) : null}
          {turnNo.has(d.turnId) && (
            <Button key={`jump-${d.id}`} plain dimColor label={`→ turn ${turnNo.get(d.turnId)}`} onPress={() => p.onJump(d.turnId)} />
          )}
        </Box>
      ))}
    </Box>
  )
}

/** Draws one view, an inline error line in its place if it throws, so the other tabs keep working. */
export function guard({ Text }: Common, name: string, draw: () => RenderNode | null): RenderNode | null {
  try {
    return draw()
  } catch (err) {
    return (
      <Text color="red" wrap="wrap">
        ✗ couldn't draw {name}: {err instanceof Error ? err.message : String(err)}
      </Text>
    )
  }
}

/** The cat, bottom right. Text on the terminal; an SVG elsewhere, where Text may not be monospace. */
export function Pet({ Box, Text }: Common, p: { frame: readonly string[]; svg?: RenderNode }) {
  return (
    <Box justifyContent="flex-end" marginTop={1}>
      {p.svg ?? (
        <Box flexDirection="column">
          {p.frame.map(line => (
            <Text color="#e0a96d">{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export function petSvg(frame: readonly string[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rows = frame.map((line, i) => `<text x="2" y="${14 + i * 15}" xml:space="preserve">${esc(line)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="50" font-family="ui-monospace,Menlo,monospace" font-size="13" fill="#e0a96d">${rows}</svg>`
}
