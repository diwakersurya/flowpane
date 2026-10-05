// Pure logic for the Changes tab and the Needs-you strip: files, checks,
// background tasks, loose ends, git. No `$`, so tests run it directly.
import type { BgTask, Check, CheckKind, FileChange, GitState, LooseEnd } from '../types'
import { clip } from './model'

const PATCH_MAX = 6000

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: readonly string[] }

export const hunksToDiff = (hunks: readonly Hunk[]) =>
  hunks.map(h => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`).join('\n')

/** Adds one edit to a file's record: counts, turns, and the newest hunks kept at the front. */
export function recordEdit(
  files: readonly FileChange[],
  e: { path: string; hunks: readonly Hunk[]; isNew: boolean; turn: number | undefined },
): FileChange[] {
  const lines = e.hunks.flatMap(h => h.lines)
  const added = lines.filter(l => l.startsWith('+')).length
  const removed = lines.filter(l => l.startsWith('-')).length
  const diff = hunksToDiff(e.hunks)
  const prev = files.find(f => f.path === e.path)
  const turns = prev?.turns ?? []
  const next: FileChange = {
    path: e.path,
    edits: (prev?.edits ?? 0) + 1,
    added: (prev?.added ?? 0) + added,
    removed: (prev?.removed ?? 0) + removed,
    isNew: prev?.isNew ?? e.isNew,
    turns: e.turn === undefined || turns.includes(e.turn) ? turns : [...turns, e.turn],
    // Newest first; old hunks fall off past the cap, cut only at a hunk boundary.
    patch: keepWholeHunks([diff, prev?.patch].filter(Boolean).join('\n'), PATCH_MAX),
  }
  return [next, ...files.filter(f => f.path !== e.path)]
}

function keepWholeHunks(diff: string, max: number) {
  if (diff.length <= max) return diff
  const cut = diff.lastIndexOf('\n@@ ', max)
  return cut > 0 ? diff.slice(0, cut) : diff.slice(0, max)
}

export const relative = (path: string, cwd: string) =>
  cwd && path.startsWith(cwd.replace(/\/$/, '') + '/') ? path.slice(cwd.replace(/\/$/, '').length + 1) : path

// ── checks ─────────────────────────────────────────────────────────

const KINDS: [CheckKind, RegExp][] = [
  ['types', /\b(tsc\b(?!.*--build)|mypy|pyright|vue-tsc|typecheck|type-check|check-types)/],
  ['lint', /\b(eslint|biome (check|lint)|ruff|golangci-lint|stylelint|prettier --check|clippy|lint)\b/],
  ['test', /\b(test|tests|jest|vitest|pytest|mocha|rspec|phpunit|playwright|cypress run|go test|cargo test|bun test)\b/],
  ['build', /\b(build|webpack|rollup|esbuild|vite build|cargo build|go build|make\b|gradle|mvn (package|install))\b/],
]

/** Which check a shell command is, if any; the first word chain decides (`npm run lint`, `pnpm test`). */
export function classify(command: string): CheckKind | undefined {
  const cmd = command.replace(/\s+/g, ' ').trim()
  if (/^(cat|grep|rg|ls|echo|sed|head|tail|find|git|cd \S+$)\b/.test(cmd)) return undefined
  return KINDS.find(([, re]) => re.test(cmd))?.[0]
}

export function recordCheck(checks: readonly Check[], c: Check): Check[] {
  return [...checks, c].slice(-60)
}

/** The newest result of each kind, in a fixed order. */
export function latestChecks(checks: readonly Check[]): Check[] {
  const order: CheckKind[] = ['test', 'types', 'lint', 'build']
  return order.flatMap(k => {
    const last = [...checks].reverse().find(c => c.kind === k)
    return last ? [last] : []
  })
}

// ── background tasks ───────────────────────────────────────────────

/** A port the command will listen on: `--port 3000`, `-p 3000`, `PORT=3000`, `:3000`. */
export function portOf(command: string): number | undefined {
  const m =
    command.match(/(?:--port[= ]|-p\s+|PORT=)(\d{2,5})\b/) ??
    command.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/)
  return m ? Number(m[1]) : undefined
}

type Summary = { id: string; type: string; status: string; description: string; command?: string; name?: string }

/** Replaces the list with the engine's own (from the Stop hook), keeping when each was first seen. */
export function mergeBackground(tasks: readonly BgTask[], live: readonly Summary[], now: number): BgTask[] {
  return live
    .filter(t => t.status === 'running' || t.status === 'pending')
    .map(t => {
      const prev = tasks.find(x => x.id === t.id)
      const command = t.command ?? prev?.command
      return {
        id: t.id,
        kind: t.type,
        label: clip(t.name || t.description || command || t.type, 48),
        command,
        port: command ? portOf(command) : undefined,
        startedAt: prev?.startedAt ?? now,
      }
    })
}

// ── loose ends ─────────────────────────────────────────────────────

const LOOSE =
  /\b(assum(e|ed|es|ing|ption)|not (yet )?(verified|tested|run|checked)|didn'?t (test|verify|run|check)|(un|not )tested|unverified|skipp(ed|ing)|todo|fixme|left out|out of scope|placeholder|stub(bed)?|hard-?coded|workaround|you('ll| will) (need|want) to|manually|could not|couldn'?t|follow-?up|later)\b/i

/** Sentences of an answer that flag something to check before shipping. */
export function extractLooseEnds(answer: string): string[] {
  const clean = answer.replace(/```[\s\S]*?```/g, ' ').replace(/\*\*|__|`/g, '')
  const parts = clean
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.replace(/^\s*([-•>]|\d+\.)\s*/, '').trim())
    .filter(s => s.length > 12 && LOOSE.test(s))
  return [...new Set(parts)].slice(0, 5).map(s => clip(s, 160))
}

export function addLooseEnds(list: readonly LooseEnd[], texts: readonly string[], turnId: string, at: number): LooseEnd[] {
  const known = new Set(list.map(l => l.text))
  const fresh = texts.filter(t => !known.has(t)).map((text, i) => ({ id: `le${at}-${i}`, turnId, text, isDone: false }))
  return [...list, ...fresh].slice(-80)
}

// ── git ────────────────────────────────────────────────────────────

/** Reads `git status --porcelain=v1 -b`: branch, ahead/behind, changed paths. */
export function parseGitStatus(stdout: string): Omit<GitState, 'commits'> {
  const [head = '', ...rest] = stdout.split('\n')
  const branch = head.replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0]!.trim() || 'HEAD'
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0)
  return { branch, ahead, behind, dirty: rest.filter(l => l.trim()).length }
}
