import { expect, test } from 'claude-code/testing'

import { globToRegExp, guardVerdict, inFence, isSecretPath, maskDeep, maskSecrets, mutates, needsBranch, NO_GUARDS, parseSnippet, pinsSection, quote, touchesSecret } from './logic'

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
  expect(guardVerdict({ ...NO_GUARDS, readOnly: true, askBash: true }, 'Bash', { command: 'rm a' })?.decision).toBe('deny')
})

test('quote', async () => {
  expect(quote('a\nb')).toBe('> a\n> b\n\n')
})

test('fence globs: **, *, bare folders, relative to the session folder', async () => {
  expect(globToRegExp('src/auth/**').test('src/auth/a/b.ts')).toBe(true)
  expect(globToRegExp('src/auth/**').test('src/api/x.ts')).toBe(false)
  expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
  expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
  expect(globToRegExp('**/*.test.ts').test('a/b/c.test.ts')).toBe(true)
  expect(globToRegExp('**/*.test.ts').test('c.test.ts')).toBe(true)
  expect(globToRegExp('docs').test('docs/x.md')).toBe(true)
  expect(inFence('/repo/src/auth/x.ts', ['src/auth/**'], '/repo')).toBe(true)
  expect(inFence('/repo/src/db/x.ts', ['src/auth/**', 'tests/**'], '/repo')).toBe(false)
})

test('fence and no-main verdicts', async () => {
  const ctx = { fence: ['src/auth/**'], cwd: '/repo' }
  expect(guardVerdict(NO_GUARDS, 'Edit', { file_path: '/repo/src/auth/a.ts' }, ctx)).toBeUndefined()
  expect(guardVerdict(NO_GUARDS, 'Edit', { file_path: '/repo/src/db/a.ts' }, ctx)?.decision).toBe('deny')
  expect(guardVerdict(NO_GUARDS, 'Bash', { command: 'rm src/db/x' }, ctx)?.decision).toBe('ask')
  expect(guardVerdict(NO_GUARDS, 'Bash', { command: 'ls' }, ctx)).toBeUndefined()

  const g = { ...NO_GUARDS, noMain: true }
  expect(needsBranch(g, 'Edit', {})).toBe(true)
  expect(needsBranch(g, 'Bash', { command: 'git switch -c feat' })).toBe(false)
  expect(needsBranch(g, 'Read', {})).toBe(false)
  expect(guardVerdict(g, 'Write', { file_path: 'a' }, { fence: [], cwd: '', branch: 'main' })?.decision).toBe('deny')
  expect(guardVerdict(g, 'Write', { file_path: 'a' }, { fence: [], cwd: '', branch: 'feat/x' })).toBeUndefined()
  expect(guardVerdict(g, 'Bash', { command: 'git worktree add ../x -b x' }, { fence: [], cwd: '', branch: 'main' })).toBeUndefined()
  expect(pinsSection([], NO_GUARDS, ['src/**'])).toContain('fenced to src/**')
})

test('secret shield: files, commands, and tokens in output', async () => {
  for (const p of ['.env', 'app/.env.local', '/home/u/.ssh/id_rsa', 'certs/server.pem', 'config/secrets.yml', '.npmrc']) expect(isSecretPath(p)).toBe(true)
  for (const p of ['.env.example', 'src/env.ts', 'README.md', 'keyboard.ts']) expect(isSecretPath(p)).toBe(false)
  expect(touchesSecret('cat .env')).toBe(true)
  expect(touchesSecret('grep KEY app/.env.production')).toBe(true)
  expect(touchesSecret('printenv')).toBe(true)
  expect(touchesSecret('cat .env.example')).toBe(false)
  expect(touchesSecret('npm test')).toBe(false)

  const shield = { ...NO_GUARDS, secrets: true }
  expect(guardVerdict(shield, 'Read', { file_path: '/repo/.env' })?.decision).toBe('deny')
  expect(guardVerdict(shield, 'Bash', { command: 'cat .env | head' })?.decision).toBe('deny')
  expect(guardVerdict(shield, 'Read', { file_path: '/repo/src/a.ts' })).toBeUndefined()

  expect(maskSecrets('key=AKIAABCDEFGHIJKLMNOP done')).toBe('key=«redacted:aws» done')
  expect(maskSecrets('ANTHROPIC_API_KEY="sk-ant-abcdefghijklmnopqrstuv"')).toBe('ANTHROPIC_API_KEY="«redacted:api-key»"')
  expect(maskSecrets('DB_PASSWORD=hunter2hunter2')).toBe('DB_PASSWORD=«redacted»')
  expect(maskSecrets('token: ghp_' + 'a'.repeat(36))).toBe('token: «redacted:github»')
  expect(maskSecrets('nothing secret here')).toBe('nothing secret here')
  const obj = { stdout: 'x', nested: [{ v: 'sk-' + 'b'.repeat(30) }] }
  expect(maskDeep(obj)).toEqual({ stdout: 'x', nested: [{ v: '«redacted:api-key»' }] })
  const clean = { a: 'b', n: 1 }
  expect(maskDeep(clean)).toBe(clean)
})

test('snippets parse with or without a label', async () => {
  expect(parseSnippet('Lint: run the linter and fix')).toEqual({ label: 'Lint', text: 'run the linter and fix' })
  expect(parseSnippet('run all the tests please')).toEqual({ label: 'run all the', text: 'run all the tests please' })
  expect(parseSnippet('  ')).toBeUndefined()
})
