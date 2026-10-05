import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'flowpane',
  component: 'Pane',
  requestId: 'flowpane',
  props: { title: 'Flowpane', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const

function world(on: On) {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  return clock
}

const composed = async ($: Engine) => {
  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  return r.sections.find(s => s.id === 'flowpane:pins')?.text
}

test('pins added in the pane reach the system prompt and toggle off', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'new-pin', text: `use pnpm (${surface})` })
    expect(await ui.find({ text: `use pnpm (${surface})` })).toBeDefined()
    await ui.unmount()
  }
  expect(await composed($)).toContain('- use pnpm (terminal)')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const boxes = await ui.findAll({ type: 'Button', text: '☑' })
  for (const b of boxes) await ui.press({ key: (b as { key: string }).key })
  expect(await composed($)).toBeUndefined()
})

test('guards flip from the pane and decide tool checks', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'allow' as const }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })).decision).toBe('allow')

  await ui.press({ key: 'guard-noPush' })
  await ui.press({ key: 'guard-askBash' })
  expect(await ui.find({ key: 'tab-pins', text: /2 on/ })).toBeDefined()
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('ask')
  expect(await composed($)).toContain('No git push')

  await ui.press({ key: 'guard-readOnly' })
  expect((await $.tool.check({ tool: 'Write', input: { file_path: '/repo/a' } })).decision).toBe('deny')
})

test('ask aside answers from a fork, inserts into the prompt, and the cat looks right', async ($, on) => {
  const clock = world(on)
  const filled: string[] = []
  on('model.fork', (_$, e) => ({ value: { isAnswered: true as const, text: `It was src/auth.ts. (${e.prompt.includes('Question: which file?') ? 'q' : '?'})`, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true as const }
  })
  on('ui.selection', () => ({ value: { text: 'the auth bug' } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-ask' })
  await clock.advance(90 * 4)
  expect(await ui.find({ type: 'Text', text: '>.>' })).toBeDefined()

  await ui.input({ key: 'ask', text: 'which file?' })
  expect(await ui.find({ text: /It was src\/auth\.ts\. \(q\)/ })).toBeDefined()
  const insert = (await ui.findAll({ type: 'Button', text: /Insert into prompt/ }))[0] as { key: string }
  await ui.press({ key: insert.key })
  expect(filled[0]).toContain('src/auth.ts')

  await ui.press({ key: 'sel-quote' })
  expect(filled[1]).toBe('> the auth bug\n\n')
  await ui.press({ key: 'sel-pin' })
  await ui.press({ key: 'tab-pins' })
  expect(await ui.find({ text: 'the auth bug' })).toBeDefined()
})

test('mobile has no text fields, so the pane points at the commands', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ text: /\/pin <rule>/ })).toBeDefined()
  const r = await $.command.run({ command: 'pin', args: 'never edit migrations', origin: { kind: 'composer' } as never, presentation: { isFullscreen: true, columns: 160 } as never })
  expect(r.text).toContain('Pinned')
  expect(await ui.find({ text: 'never edit migrations' })).toBeDefined()
})
