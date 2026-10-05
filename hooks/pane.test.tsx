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
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
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

test('ask aside answers from a fork and inserts into the prompt', async ($, on) => {
  world(on)
  const filled: string[] = []
  on('model.fork', (_$, e) => ({ value: { isAnswered: true as const, text: `It was src/auth.ts. (${e.prompt.includes('Question: which file?') ? 'q' : '?'})`, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true as const }
  })
  on('ui.selection', () => ({ value: { text: 'the auth bug' } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-ask' })

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

const BAND = {
  plugin: 'flowpane',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 1 }, view: {} },
  viewport: { columns: 120, rows: 40, isFullscreen: true },
} as const

test('the band flips guards on every surface, shared with the pane', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'allow' as const }))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'band-noPush', text: '○ No push' })).toBeDefined()
    await band.press({ key: 'band-noPush' })
    expect(await band.find({ key: 'band-noPush', text: '● No push' })).toBeDefined()
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })).decision).toBe('deny')
    await band.press({ key: 'band-noPush' })
    await band.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'band-readOnly' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'guard-readOnly', text: '● Read-only' })).toBeDefined()
  await pane.press({ key: 'guard-readOnly' })
  expect(await band.find({ key: 'band-readOnly', text: '○ Read-only' })).toBeDefined()
})

test('the band steps aside for a survey', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
  expect(await band.find({ key: 'band-readOnly' })).toBeUndefined()
})

test('the band can be turned off in settings', { options: { band: false } }, async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'band-readOnly' })).toBeUndefined()
})

test('queue: sends the next prompt as the user when a turn ends, and on ▶', async ($, on) => {
  const clock = world(on)
  const sent: { text: string }[] = []
  on('prompt.submit', (_$, e) => {
    sent.push({ text: e.text })
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-queue' })
  await ui.input({ key: 'enqueue', text: 'then add tests' })
  await ui.input({ key: 'enqueue', text: 'then update README' })
  expect(await ui.find({ key: 'tab-queue', text: /Queue 2/ })).toBeDefined()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(sent).toEqual([{ text: 'then add tests' }])

  await $.turn.complete({ answer: 'stopped', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  expect(sent.length).toBe(1)

  const send = (await ui.findAll({ type: 'Button', text: '▶' }))[0] as { key: string }
  await ui.press({ key: send.key })
  expect(sent.map(s => s.text)).toEqual(['then add tests', 'then update README'])
  expect(await ui.find({ text: 'Nothing queued.' })).toBeDefined()
})

test('band: snippets fill the prompt; fence and queue show', async ($, on) => {
  world(on)
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true as const }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.input({ key: 'fence', text: 'src/auth/**' })
  expect(await pane.find({ text: 'src/auth/**' })).toBeDefined()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /fence src\/auth\/\*\*/ })).toBeDefined()
  await band.press({ key: 'snip-s-test' })
  expect(filled).toEqual(['Run the tests and fix any failures.'])

  const oneRow = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 1 } })
  expect(await oneRow.find({ key: 'snip-s-test' })).toBeUndefined()

  await pane.press({ key: 'tab-queue' })
  await pane.input({ key: 'new-snippet', text: 'Lint: run the linter and fix' })
  expect(await band.find({ text: '[Lint]' })).toBeDefined()
})

test('fence and no-main decide tool checks', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const r = await $.command.run({ command: 'fence', args: 'src/auth/**', origin: { kind: 'composer' } as never, presentation: { isFullscreen: true, columns: 160 } as never })
  expect(r.text).toContain('src/auth/**')
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: '/repo/src/db/x.ts' } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: '/repo/src/auth/x.ts' } })).decision).toBe('allow')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'band-noMain' })
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: '/repo/src/auth/x.ts' } })).decision).toBe('deny')
  // Inside a fence, a command that changes the tree still needs a look; with the fence off, branching is free.
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git switch -c feat' } })).decision).toBe('ask')
  await $.command.run({ command: 'fence', args: 'off', origin: { kind: 'composer' } as never, presentation: { isFullscreen: true, columns: 160 } as never })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git switch -c feat' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf src' } })).decision).toBe('deny')
})

test('secret shield starts on, blocks .env, masks tokens in results', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', () => ({ result: { stdout: 'OPENAI_API_KEY=sk-' + 'x'.repeat(30) + '\nok', stderr: '', interrupted: false } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'band-secrets', text: '● Secrets' })).toBeDefined()
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/repo/.env' } })).decision).toBe('deny')
  const r = await $.tool.call({ tool: 'Bash', command: 'node print.js', tool_use_id: 'b1' })
  expect(JSON.stringify(r.result)).toContain('«redacted:api-key»')
  expect(JSON.stringify(r.result)).not.toContain('xxxxxxxx')

  await band.press({ key: 'band-secrets' })
  const raw = await $.tool.call({ tool: 'Bash', command: 'node print.js', tool_use_id: 'b2' })
  expect(JSON.stringify(raw.result)).toContain('xxxxxxxx')
})
