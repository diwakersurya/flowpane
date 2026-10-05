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
