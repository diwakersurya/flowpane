import { expect, test } from 'claude-code/testing'

import {
  answered,
  asked,
  mermaidOf,
  questionsFromHistory,
  svgQuestions,
  buildRows,
  endNode,
  fromTodoWrite,
  hasDecisionCue,
  minimapCells,
  parseDecision,
  petFrame,
  stepToward,
  prune,
  startTool,
  startTurn,
  svgLanes,
  taskCreate,
  taskUpdate,
  toolLabel,
} from './model'

test('tool labels pick the telling argument', async () => {
  expect(toolLabel('Edit', { file_path: '/a/b/src/app.ts', old_string: 'x' })).toBe('Edit src/app.ts')
  expect(toolLabel('Bash', { command: 'npm test' })).toBe('Bash npm test')
  expect(toolLabel('mcp__srv__do', { q: 'hi' })).toBe('srv:do hi')
})

test('latest turn opens, older turns and subagents start shut, toggles flip', async () => {
  let n = startTurn([], 't1', 'first', 0)
  n = startTool(n, { id: 'a', tool: 'Read', label: 'Read x', parent: 't1', startedAt: 1 })
  n = endNode(n, 't1', 'done', 2)
  n = startTurn(n, 't2', 'second', 3)
  n = startTool(n, { id: 'ag', kind: 'agent', tool: 'Agent', label: 'Explore: find', parent: 't2', startedAt: 4 })
  n = startTool(n, { id: 'b', tool: 'Grep', label: 'Grep y', parent: 'ag', startedAt: 5 })

  const rows = buildRows(n, [])
  expect(rows.map(r => r.node.id)).toEqual(['t2', 'ag', 't1'])
  expect(rows[1]!.isOpen).toBe(false)
  expect(rows[1]!.count).toBe(1)
  expect(rows[2]!.count).toBe(1)

  const opened = buildRows(n, ['ag', 't1'])
  expect(opened.map(r => r.node.id)).toEqual(['t2', 'ag', 'b', 't1', 'a'])
})

test('prune folds the oldest finished turns into counts', async () => {
  let n = startTurn([], 't1', 'one', 0)
  for (let i = 0; i < 5; i++) n = startTool(n, { id: `x${i}`, tool: 'Read', label: 'r', parent: 't1', startedAt: i })
  n = endNode(n, 't1', 'done', 9)
  n = startTurn(n, 't2', 'two', 10)
  const out = prune(n, 3)
  expect(out.map(x => x.id)).toEqual(['t1', 't2'])
  expect(out[0]!.pruned).toBe(5)
  expect(buildRows(out, [])[1]!.count).toBe(5)
})

test('todos from TodoWrite and from TaskCreate/TaskUpdate', async () => {
  expect(fromTodoWrite([{ content: 'a', status: 'pending', activeForm: 'A-ing' }], 1)[0]!.status).toBe('pending')
  let t = taskCreate([], '7', 'ship', 'shipping', 1)
  t = taskUpdate(t, { taskId: '7', status: 'in_progress' }, 2)
  expect(t[0]!.status).toBe('in_progress')
  expect(taskUpdate(t, { taskId: '7', status: 'deleted' }, 3)).toEqual([])
})

test('decision parsing accepts JSON, refuses null and junk', async () => {
  expect(parseDecision('{"choice":"A over B","why":"faster","alternatives":["B"]}')).toEqual({
    choice: 'A over B',
    why: 'faster',
    alternatives: ['B'],
  })
  expect(parseDecision('null')).toBeUndefined()
  expect(parseDecision('{"choice":""}')).toBeUndefined()
  expect(hasDecisionCue('I went with Vite rather than Webpack')).toBe(true)
  expect(hasDecisionCue('Done.')).toBe(false)
})

test('minimap and lanes draw', async () => {
  let n = startTurn([], 't1', 'one', 0)
  n = startTool(n, { id: 'a', tool: 'Edit', label: 'Edit <x>', parent: 't1', startedAt: 1 })
  const cells = minimapCells(n, 4)
  expect(cells.length).toBe(12)
  expect(cells[9]).toBe(0x2588)
  const svg = svgLanes(n, 5)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.includes('Edit &lt;x&gt;')).toBe(true)
})

test('cat frames keep their width and turn one step at a time', async () => {
  for (const p of [-2, -1, 0, 1, 2]) expect(petFrame(p).every(line => line.length === 7)).toBe(true)
  expect(petFrame(-2)[1]).toBe('(<.<  )')
  expect(petFrame(2)[1]).toBe('(  >.>)')
  let pos = -2
  const seen: number[] = []
  while (pos !== 2) seen.push((pos = stepToward(pos, 2)))
  expect(seen).toEqual([-1, 0, 1, 2])
})

const ASK = {
  questions: [
    { question: 'Which pet?', header: 'Pet', options: [{ label: 'Owl' }, { label: 'Cat' }, { label: 'Bird' }] },
    { question: 'Where?', header: 'Placement', options: [{ label: 'Bottom' }, { label: 'Right' }] },
    { question: 'Extras?', header: 'Extras', options: [{ label: 'Blink' }, { label: 'Purr' }, { label: 'Tail' }] },
  ],
}

test('questions settle from answers: single, typed-in, multi, and declined', async () => {
  const qs = asked(ASK, 'c1', 't1', 0)
  expect(qs.map(q => q.status)).toEqual(['waiting', 'waiting', 'waiting'])
  const done = answered(qs, 'c1', { 'Which pet?': 'Cat', 'Where?': 'On the tabs please', 'Extras?': 'Blink, Tail' })
  expect(done[0]).toMatchObject({ chosen: ['Cat'], status: 'answered' })
  expect(done[1]).toMatchObject({ chosen: [], other: 'On the tabs please' })
  expect(done[2]!.chosen).toEqual(['Blink', 'Tail'])
  expect(answered(qs, 'c1', undefined).every(q => q.status === 'declined')).toBe(true)
  expect(answered(qs, 'other', {})).toEqual(qs)
})

test('mermaid leads through picked answers and hangs the rest dotted', async () => {
  const done = answered(asked(ASK, 'c1', 't1', 0).slice(0, 2), 'c1', { 'Which pet?': 'Cat' })
  const m = mermaidOf(done)
  expect(m.startsWith('flowchart TD')).toBe(true)
  expect(m).toContain('q0 -->|"Cat"| q1')
  expect(m).toContain('q0 -.- q0o0["Owl"]:::dim')
  expect(m).toContain('q1 -.->|"declined"|')
  expect(svgQuestions(done).startsWith('<svg')).toBe(true)
})

test('questions are rebuilt from history', async () => {
  const rows = [
    { toolUses: [{ tool_use_id: 'x', tool: 'Read', input: {} }] },
    { toolUses: [{ tool_use_id: 'a1', tool: 'AskUserQuestion', input: ASK, result: { answers: { 'Which pet?': 'Cat' } } }] },
    { toolUses: [{ tool_use_id: 'a2', tool: 'AskUserQuestion', input: { questions: [ASK.questions[0]!] } }] },
  ]
  const qs = questionsFromHistory(rows, 5)
  expect(qs.length).toBe(4)
  expect(qs[0]!.chosen).toEqual(['Cat'])
  expect(qs[3]!.status).toBe('waiting')
})
