import type { Elements, RenderNode } from 'claude-code'

import type { BgTask, Check, FileChange, FlowNode, GitState, LooseEnd, Question } from '../types'
import { latestChecks } from './dev'
import { clip, duration } from './model'
import type { Common } from './views'

/** The Changes tab draws `Code` too, which every surface has. */
export type WithCode = Common & Pick<Elements['terminal'], 'Code'>

const KIND_NAME = { test: 'tests', types: 'types', lint: 'lint', build: 'build' } as const

export function GitStrip({ Text }: Common, p: { git: GitState | null }) {
  if (!p.git) return null
  const g = p.git
  const sync = [g.ahead ? `↑${g.ahead}` : '', g.behind ? `↓${g.behind}` : ''].filter(Boolean).join(' ')
  return (
    <Text wrap="truncate">
      <Text color="cyan">⎇ {g.branch}</Text>
      {sync && <Text dimColor> {sync}</Text>}
      <Text color={g.dirty ? 'yellow' : 'green'}> · {g.dirty ? `${g.dirty} uncommitted` : 'clean'}</Text>
      <Text dimColor> · {g.commits} commit{g.commits === 1 ? '' : 's'} this session</Text>
    </Text>
  )
}

export function ChecksRow({ Box, Text }: Common, p: { checks: readonly Check[] }) {
  const latest = latestChecks(p.checks)
  if (latest.length === 0) return <Text dimColor>No tests, builds or lint runs yet.</Text>
  return (
    <Box flexDirection="column">
      {latest.map(c => {
        const history = p.checks.filter(x => x.kind === c.kind).slice(-8)
        return (
          <Text wrap="truncate">
            <Text color={c.ok ? 'green' : 'red'} bold>
              {c.ok ? '✓' : '✗'} {KIND_NAME[c.kind].padEnd(5)}
            </Text>{' '}
            {history.map(run => (
              <Text color={run.ok ? "green" : "red"}>{run.ok ? "▪" : "▫"}</Text>
            ))}
            <Text dimColor>
              {'  '}
              {c.turn ? `turn ${c.turn} · ` : ''}
              {clip(c.command, 36)}
            </Text>
          </Text>
        )
      })}
    </Box>
  )
}

export function FileList(
  { Box, Text, Button, Code }: WithCode,
  p: { files: readonly FileChange[]; open: readonly string[]; width: number; onToggle: (id: string) => void },
) {
  if (p.files.length === 0) return <Text dimColor>No files changed yet.</Text>
  const added = p.files.reduce((n, f) => n + f.added, 0)
  const removed = p.files.reduce((n, f) => n + f.removed, 0)
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {p.files.length} file{p.files.length === 1 ? '' : 's'} · <Text color="green">+{added}</Text> <Text color="red">-{removed}</Text>
      </Text>
      {p.files.slice(0, 40).map(f => {
        const id = `file:${f.path}`
        const isOpen = p.open.includes(id)
        const counts = `+${f.added} -${f.removed}`
        const meta = `${f.edits}× · T${f.turns.join(',T')}`
        const name = clip(f.path, Math.max(12, p.width - counts.length - meta.length - 8))
        return (
          <Box flexDirection="column">
            <Button
              key={`row-${id}`}
              plain
              label={`${isOpen ? '▼' : '▸'} ${f.isNew ? '✚' : '✎'} ${name}  ${counts}  ${meta}`}
              onPress={() => p.onToggle(id)}
            />
            {isOpen && f.patch && <Code source={f.patch} format="diff" path={f.path} wrap="truncate-end" />}
          </Box>
        )
      })}
    </Box>
  )
}

export function LooseEnds({ Box, Text, Button }: Common, p: { items: readonly LooseEnd[]; turnNo: (turnId: string) => number | undefined; onDone: (id: string) => void }) {
  const open = p.items.filter(i => !i.isDone)
  if (open.length === 0) return <Text dimColor>Nothing flagged. Assumptions, skipped steps and TODOs in answers land here.</Text>
  return (
    <Box flexDirection="column">
      {open.slice(-12).map(i => (
        <Box gap={1}>
          <Button key={`done-${i.id}`} plain label="☐" onPress={() => p.onDone(i.id)} />
          <Text wrap="wrap">
            {i.text}
            {p.turnNo(i.turnId) ? <Text dimColor> · T{p.turnNo(i.turnId)}</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const Section = ({ Box, Text }: Common, title: string, body: RenderNode | null) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold>{title}</Text>
    {body}
  </Box>
)

export function ChangesTab(
  els: WithCode,
  p: {
    git: GitState | null
    checks: readonly Check[]
    files: readonly FileChange[]
    looseEnds: readonly LooseEnd[]
    open: readonly string[]
    width: number
    turnNo: (turnId: string) => number | undefined
    onToggle: (id: string) => void
    onDone: (id: string) => void
  },
) {
  return (
    <els.Box flexDirection="column">
      {p.git && <els.Box marginBottom={1}>{GitStrip(els, { git: p.git })}</els.Box>}
      {Section(els, 'Checks', ChecksRow(els, { checks: p.checks }))}
      {Section(els, 'Files changed', FileList(els, { files: p.files, open: p.open, width: p.width, onToggle: p.onToggle }))}
      {Section(els, 'Check before shipping', LooseEnds(els, { items: p.looseEnds, turnNo: p.turnNo, onDone: p.onDone }))}
    </els.Box>
  )
}

/** What is waiting on the person, or still running: drawn above every tab, nothing when empty. */
export function NeedsYou(
  { Box, Text, Button }: Common,
  p: { questions: readonly Question[]; denied: readonly FlowNode[]; background: readonly BgTask[]; now: number; width: number; onStop: (id: string) => void },
) {
  const waiting = p.questions.filter(q => q.status === 'waiting')
  if (waiting.length + p.denied.length + p.background.length === 0) return null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      {waiting.map(q => (
        <Text color="yellow" wrap="truncate">
          ? {clip(`${q.header}: ${q.question}`, p.width - 6)}
        </Text>
      ))}
      {p.denied.map(n => (
        <Text color="red" wrap="truncate">
          ⊘ refused: {clip(n.label, p.width - 16)}
        </Text>
      ))}
      {p.background.map(t => (
        <Box justifyContent="space-between">
          <Text wrap="truncate">
            <Text color="cyan">⟳</Text> {clip(t.label, p.width - 26)}
            {t.port ? <Text color="green"> :{t.port}</Text> : null}
            <Text dimColor> {duration({ startedAt: t.startedAt } as FlowNode, p.now)}</Text>
          </Text>
          <Button key={`stop-${t.id}`} label="Stop" dimColor onPress={() => p.onStop(t.id)} />
        </Box>
      ))}
    </Box>
  )
}
