import { expect, test } from 'claude-code/testing'

import { guardVerdict, mutates, NO_GUARDS, petFrame, pinsSection, quote, stepToward } from './logic'

test('pins section lists only what is on', async () => {
  expect(pinsSection([], NO_GUARDS)).toBeUndefined()
  expect(pinsSection([{ id: '1', text: 'use pnpm', isOn: false }], NO_GUARDS)).toBeUndefined()
  const text = pinsSection(
    [
      { id: '1', text: 'use pnpm', isOn: true },
      { id: '2', text: 'old rule', isOn: false },
    ],
    { ...NO_GUARDS, noPush: true },
  )!
  expect(text).toContain('- use pnpm')
  expect(text).not.toContain('old rule')
  expect(text).toContain('No git push')
  expect(text).not.toContain('Read-only')
})

test('mutating shell commands are told apart from reads', async () => {
  for (const c of ['rm -rf dist', 'echo hi > a.txt', 'cat a >> b', "sed -i '' s/a/b/ f", 'git commit -m x', 'npm install zod', 'ls && mkdir x', 'sudo rm x'])
    expect(mutates(c)).toBe(true)
  for (const c of ['ls -la', 'cat a.txt', 'git status', 'git diff HEAD', 'npm test', 'grep -r "a > b" src', 'node x.js 2>&1', 'cmd > /dev/null', 'git log --oneline'])
    expect(mutates(c)).toBe(false)
})

test('guards deny or ask; nothing when off', async () => {
  expect(guardVerdict(NO_GUARDS, 'Edit', { file_path: 'a' })).toBeUndefined()
  expect(guardVerdict({ ...NO_GUARDS, readOnly: true }, 'Edit', {})?.decision).toBe('deny')
  expect(guardVerdict({ ...NO_GUARDS, readOnly: true }, 'Bash', { command: 'git status' })).toBeUndefined()
  expect(guardVerdict({ ...NO_GUARDS, readOnly: true }, 'Bash', { command: 'rm a' })?.decision).toBe('deny')
  expect(guardVerdict({ ...NO_GUARDS, noPush: true }, 'Bash', { command: 'git push origin main' })?.decision).toBe('deny')
  expect(guardVerdict({ ...NO_GUARDS, noPush: true }, 'Bash', { command: 'git commit -m x' })).toBeUndefined()
  expect(guardVerdict({ ...NO_GUARDS, askBash: true }, 'Bash', { command: 'ls' })?.decision).toBe('ask')
  expect(guardVerdict({ ...NO_GUARDS, askBash: true }, 'Read', { file_path: 'a' })).toBeUndefined()
  // A deny outranks an ask.
  expect(guardVerdict({ readOnly: true, noPush: false, askBash: true }, 'Bash', { command: 'rm a' })?.decision).toBe('deny')
})

test('quote and cat', async () => {
  expect(quote('a\nb')).toBe('> a\n> b\n\n')
  for (const p of [-2, -1, 0, 1, 2]) expect(petFrame(p).every(l => l.length === 7)).toBe(true)
  expect(stepToward(-2, 2)).toBe(-1)
})
