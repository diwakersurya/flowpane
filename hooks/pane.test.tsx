import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

function world(on: On) {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  return clock
}

const PANE = {
  plugin: 'flowpane',
  component: 'Pane',
  requestId: 'flowpane',
  props: { title: 'Flowpane', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const

test('turns, tools, todos and decisions reach the pane on every surface', async ($, on) => {
  world(on)
  on('tool.call', async (_$, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: '1', subject: e.subject } } }
    return { result: 'ok' }
  })

  await $.turn.start({ text: 'add auth guard', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/router.ts', tool_use_id: 'u1' })
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'u2',
    todos: [
      { content: 'Write guard', status: 'completed', activeForm: 'Writing guard' },
      { content: 'Add tests', status: 'in_progress', activeForm: 'Adding tests' },
    ],
  })
  await $.tool.call({ tool: 'mcp__flowpane__RecordDecision', tool_use_id: 'u3', choice: 'Middleware over per-route guard', why: 'one place to audit' } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Turn 1 "add auth guard"/ })).toBeDefined()
    expect(await ui.find({ text: /Read src\/router\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /Middleware over per-route guard/ })).toBeDefined()

    await ui.press({ key: 'tab-todos' })
    expect(await ui.find({ text: /Adding tests/ })).toBeDefined()
    expect(await ui.find({ key: 'tab-todos', text: /1\/2/ })).toBeDefined()

    await ui.press({ key: 'tab-decisions' })
    expect(await ui.find({ text: /one place to audit/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('empty pane says it is waiting', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Waiting for the first turn/ })).toBeDefined()
})

test('/flow todos opens on the todos tab', async ($, on) => {
  world(on)
  const r = await $.command.run({ command: 'flow', args: 'todos', origin: { kind: 'composer' } as never, presentation: { isFullscreen: true, columns: 160 } as never })
  expect(r.text).toBe('Flowpane opened.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /No todos yet/ })).toBeDefined()
})

test('the cat turns its head toward the tab', async ($, on) => {
  const clock = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const looks = async (eyes: string) =>
      surface === 'terminal'
        ? (await ui.find({ type: 'Text', text: eyes })) !== undefined
        : (await ui.find({ type: 'Svg' })) !== undefined
    expect(await looks('<.<')).toBe(true)
    await ui.press({ key: 'tab-decisions' })
    await clock.advance(90)
    expect(await looks('o.o')).toBe(true)
    await clock.advance(90 * 4)
    expect(await looks('>.>')).toBe(true)
    await ui.press({ key: 'tab-flow' })
    await clock.advance(90 * 5)
    expect(await looks('<.<')).toBe(true)
    await ui.unmount()
  }
})

test('flow shows the questions asked, what was picked, and copies Mermaid', async ($, on) => {
  world(on)
  const copied: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') return { result: { questions: e.questions, answers: { 'Which pet?': 'Cat' } } as never }
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'add a pet', turnId: 't1' })
  await $.tool.call({
    tool: 'AskUserQuestion',
    tool_use_id: 'ask1',
    questions: [{ question: 'Which pet?', header: 'Pet', multiSelect: false, options: [{ label: 'Owl', description: '' }, { label: 'Cat', description: '' }] }],
  } as never)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ text: /◇ Pet/ })).toBeDefined()
  expect(await term.find({ text: /✓ Cat/ })).toBeDefined()
  await term.press({ key: 'copy-mermaid' })
  expect(copied[0]).toContain('flowchart TD')
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ key: 'copy-mermaid' })).toBeDefined()
})

test('changes tab: files with diffs, checks, loose ends; needs-you strip with stop', async ($, on) => {
  world(on)
  const stopped: string[] = []
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Edit')
      return {
        result: {
          filePath: '/repo/src/router.ts',
          oldString: 'a',
          newString: 'b',
          originalFile: 'a',
          structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
          userModified: false,
          replaceAll: false,
        },
      }
    if (e.tool === 'Bash' && e.command === 'npm test') return { result: { stdout: '', stderr: 'fail', interrupted: false }, isError: true as const }
    if (e.tool === 'Bash' && e.run_in_background) return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }
    if (e.tool === 'TaskStop') {
      stopped.push(String(e.task_id))
      return { result: { message: 'stopped', task_id: String(e.task_id), task_type: 'local_bash' } }
    }
    return { result: 'ok' }
  })
  on('session.cwd', () => ({ value: '/repo' }))

  await $.turn.start({ text: 'guard', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/router.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev -- --port 5173', description: 'dev server', run_in_background: true, tool_use_id: 'b2' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /dev server/ })).toBeDefined()
    expect(await ui.find({ text: /:5173/ })).toBeDefined()
    expect(await ui.find({ key: 'tab-changes', text: /✗/ })).toBeDefined()

    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ text: /✗ tests/ })).toBeDefined()
    expect(await ui.find({ key: 'row-file:src/router.ts', text: /\+1 -1/ })).toBeDefined()
    await ui.press({ key: 'row-file:src/router.ts' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.press({ key: 'row-file:src/router.ts' })
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop-bg1' })
  expect(stopped).toEqual(['bg1'])
  expect(await ui.find({ text: /dev server/ })).toBeUndefined()
})

test('loose ends from a finished turn show under Changes and can be ticked off', async ($, on) => {
  world(on)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repo', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.turn.start({ text: 'guard', turnId: 't1' })
  await $.turn.complete({ answer: 'Added it. I assumed the store is Redis. Tests pass.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ text: /I assumed the store is Redis\./ })).toBeDefined()
  expect(await ui.find({ text: /⎇/ })).toBeUndefined()
  const item = await ui.findAll({ type: 'Button', text: '☐' })
  await ui.press({ key: (item[0] as { key: string }).key })
  expect(await ui.find({ text: /Nothing flagged/ })).toBeDefined()
})
