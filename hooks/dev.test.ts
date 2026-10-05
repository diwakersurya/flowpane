import { expect, test } from 'claude-code/testing'

import {
  addLooseEnds,
  classify,
  extractLooseEnds,
  latestChecks,
  mergeBackground,
  parseGitStatus,
  portOf,
  recordCheck,
  recordEdit,
  relative,
} from './dev'

const HUNK = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+B', '+c'] }

test('edits add up per file, newest file first, diff kept', async () => {
  let f = recordEdit([], { path: 'src/a.ts', hunks: [HUNK], isNew: false, turn: 1 })
  f = recordEdit(f, { path: 'src/b.ts', hunks: [], isNew: true, turn: 1 })
  f = recordEdit(f, { path: 'src/a.ts', hunks: [HUNK], isNew: false, turn: 2 })
  expect(f.map(x => x.path)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(f[0]).toMatchObject({ edits: 2, added: 4, removed: 2, turns: [1, 2] })
  expect(f[0]!.patch.startsWith('@@ -1,2 +1,3 @@\n a\n-b')).toBe(true)
  expect(f[1]!.isNew).toBe(true)
  expect(relative('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  expect(relative('/other/x.ts', '/repo')).toBe('/other/x.ts')
})

test('commands classify into checks; reads and git do not', async () => {
  expect(classify('npm test')).toBe('test')
  expect(classify('pnpm vitest run src')).toBe('test')
  expect(classify('claude plugin test .')).toBe('test')
  expect(classify('npx tsc -p . --noEmit')).toBe('types')
  expect(classify('npm run lint')).toBe('lint')
  expect(classify('npm run build')).toBe('build')
  expect(classify('cargo test')).toBe('test')
  expect(classify('git commit -m "test"')).toBeUndefined()
  expect(classify('cat test.txt')).toBeUndefined()
  expect(classify('ls -la')).toBeUndefined()
})

test('latest check per kind wins', async () => {
  let c = recordCheck([], { kind: 'test', ok: false, command: 'npm test', at: 1 })
  c = recordCheck(c, { kind: 'test', ok: true, command: 'npm test', at: 2 })
  c = recordCheck(c, { kind: 'build', ok: false, command: 'npm run build', at: 3 })
  expect(latestChecks(c).map(x => [x.kind, x.ok])).toEqual([['test', true], ['build', false]])
})

test('ports and background merge', async () => {
  expect(portOf('npm run dev -- --port 5173')).toBe(5173)
  expect(portOf('PORT=3000 node server.js')).toBe(3000)
  expect(portOf('python -m http.server -p 8080')).toBe(8080)
  expect(portOf('npm test')).toBeUndefined()
  const live = [
    { id: 'b1', type: 'local_bash', status: 'running', description: 'dev server', command: 'vite --port 5173' },
    { id: 'b2', type: 'local_bash', status: 'completed', description: 'done' },
  ]
  const merged = mergeBackground([{ id: 'b1', kind: 'local_bash', label: 'x', startedAt: 7 }], live, 99)
  expect(merged).toEqual([{ id: 'b1', kind: 'local_bash', label: 'dev server', command: 'vite --port 5173', port: 5173, startedAt: 7 }])
})

test('loose ends come from flagged sentences, deduped', async () => {
  const answer = `Done. I added the guard.

- I assumed the session store is Redis.
- Tests pass.
- I didn't test the logout path.

\`\`\`ts
// TODO inside code is ignored
\`\`\`
You'll need to set API_URL manually.`
  const ends = extractLooseEnds(answer)
  expect(ends).toEqual(['I assumed the session store is Redis.', "I didn't test the logout path.", "You'll need to set API_URL manually."])
  const once = addLooseEnds([], ends, 't1', 1)
  expect(addLooseEnds(once, ends, 't2', 2).length).toBe(3)
})

test('git status parses branch, sync and dirt', async () => {
  expect(parseGitStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({ branch: 'main', ahead: 2, behind: 1, dirty: 2 })
  expect(parseGitStatus('## No commits yet on main\n')).toEqual({ branch: 'main', ahead: 0, behind: 0, dirty: 0 })
})
