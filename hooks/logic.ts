// Pure logic: the pinned-rules prompt section, guard verdicts, the fence,
// the secret shield, snippets. No `$`, so tests run it directly.
import type { Guards, Pin, Snippet } from '../types'

export const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

export const NO_GUARDS: Guards = { readOnly: false, noPush: false, askBash: false, noMain: false, secrets: false }

export const GUARD_LABEL: Record<keyof Guards, string> = {
  readOnly: 'Read-only',
  noPush: 'No git push',
  askBash: 'Ask before Bash',
  noMain: 'No edits on main',
  secrets: 'Secret shield',
}

/** The band's labels, short enough for one row. */
export const GUARD_SHORT: Record<keyof Guards, string> = {
  readOnly: 'Read-only',
  noPush: 'No push',
  askBash: 'Ask Bash',
  noMain: 'Not main',
  secrets: 'Secrets',
}

const GUARD_RULE: Record<keyof Guards, string> = {
  readOnly: 'Read-only: do not edit, create or delete files, and do not run commands that change them. Investigate and propose changes instead.',
  noPush: 'No git push: commit if asked, but never push.',
  askBash: 'Every shell command needs the user’s approval first, so prefer fewer, well-chosen commands.',
  noMain: 'No edits on main/master: before changing files, create a branch (git switch -c) or a worktree (git worktree add).',
  secrets: 'Secret shield: do not read .env files, private keys or credential files; tokens in tool output appear as «redacted».',
}

/** The system-prompt section for what is on; undefined when nothing is. */
export function pinsSection(pins: readonly Pin[], guards: Guards, fence: readonly string[] = []): string | undefined {
  const on = pins.filter(p => p.isOn)
  const rules = (Object.keys(GUARD_RULE) as (keyof Guards)[]).filter(k => guards[k])
  if (on.length === 0 && rules.length === 0 && fence.length === 0) return undefined
  const out = ['# Pinned by the user']
  if (on.length) {
    out.push('The user pinned these rules. Follow them in every reply for the rest of the session, including after compaction:')
    out.push(...on.map(p => `- ${p.text}`))
  }
  if (rules.length || fence.length) {
    out.push('Guards the user switched on (calls that break them are blocked before they run):')
    out.push(...rules.map(k => `- ${GUARD_RULE[k]}`))
    if (fence.length) out.push(`- Edits are fenced to ${fence.join(', ')}. Ask the user before changing anything outside it.`)
  }
  return out.join('\n')
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead'])

const MUTATES = [
  /(^|[;&|(]\s*|\bsudo\s+)(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|truncate|dd|tee|patch|unzip|tar\s+-?x)\b/,
  /\bsed\s+(-[a-zA-Z]*i|--in-place)/,
  /\bperl\s+-[a-zA-Z]*i/,
  /(^|[^0-9&>])>>?\s*(?!&|\/dev\/null)[\w./~$]/,
  /\bgit\s+(commit|push|reset|checkout|switch|merge|rebase|stash|apply|add|rm|mv|restore|clean|cherry-pick|revert|tag|am|pull)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|rm|uninstall|update|upgrade|publish|link|ci)\b/,
  /\b(pip|pip3|uv)\s+(install|uninstall|add|remove)\b/,
  /\bbrew\s+(install|uninstall|upgrade|reinstall)\b/,
]

const unquote = (command: string) => command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''")

/** Whether a shell command looks like it changes files. Quoted text is ignored. Best effort, not a sandbox. */
export function mutates(command: string): boolean {
  const bare = unquote(command)
  return MUTATES.some(re => re.test(bare))
}

/** Commands that move work off main: allowed by "No edits on main" so the agent can follow it. */
const LEAVES_MAIN = /^\s*git\s+(switch\s+(-c|--create)|checkout\s+-b|worktree\s+add|branch\s+[\w./-]+\s*$|fetch|status)\b/

// ── fence ──────────────────────────────────────────────────────────

/** A path glob as a RegExp: `**` any depth, `*` within a segment, `?` one character. A bare folder means everything in it. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, '')
  if (!/[*?]/.test(g)) g = g.replace(/\/?$/, '/**')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!
    if (c === '*' && g[i + 1] === '*') {
      re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += g[i + 2] === '/' ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export const parseFence = (text: string) =>
  text
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 10)

const relativeTo = (path: string, cwd: string) => {
  const root = cwd.replace(/\/$/, '') + '/'
  return path.startsWith(root) ? path.slice(root.length) : path.replace(/^\.\//, '')
}

export const inFence = (path: string, fence: readonly string[], cwd: string) =>
  fence.length === 0 || fence.some(g => globToRegExp(g).test(relativeTo(path, cwd)))

// ── secret shield ──────────────────────────────────────────────────

const SECRET_FILE = /(^|\/)(\.env(\.(?!example|sample|template|dist)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(pem|key|p12|pfx|keystore))$/i

export const isSecretPath = (path: string) => SECRET_FILE.test(path.trim())

/** Whether a shell command reads or prints a secret file, or dumps the environment. */
export function touchesSecret(command: string): boolean {
  const words = unquote(command).split(/[\s;&|<>()]+/)
  return words.some(w => isSecretPath(w.replace(/^['"]|['"]$/g, ''))) || /(^|[;&|]\s*)(printenv|env)\s*($|[;&|])/.test(command)
}

const TOKENS: [string, RegExp][] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['api-key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ['stripe', /\b(sk|rk)_(live|test)_[0-9a-zA-Z]{16,}\b/g],
  ['slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['google', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
]

const ASSIGNED = /\b([A-Za-z_]*(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key)[A-Za-z_]*)(\s*[:=]\s*)(['"]?)([^\s'"]{8,})\3/gi

/** Replaces tokens and `SECRET=value` values with «redacted:kind». */
export function maskSecrets(text: string): string {
  let out = text
  for (const [kind, re] of TOKENS) out = out.replace(re, `«redacted:${kind}»`)
  return out.replace(ASSIGNED, (all, name: string, eq: string, q: string, value: string) =>
    value.startsWith('«redacted') ? all : `${name}${eq}${q}«redacted»${q}`,
  )
}

/** Masks every string inside a tool result; returns the same object when nothing changed. */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') {
    const masked = maskSecrets(value)
    return (masked === value ? value : masked) as T
  }
  if (Array.isArray(value)) {
    const next = value.map(maskDeep)
    return (next.every((v, i) => v === value[i]) ? value : next) as T
  }
  if (value && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      next[k] = maskDeep(v)
      if (next[k] !== v) changed = true
    }
    return (changed ? next : value) as T
  }
  return value
}

// ── verdicts ───────────────────────────────────────────────────────

export type Verdict = { decision: 'deny' | 'ask'; reason: string }

/** Facts a verdict needs beyond the call: the fence, the session folder, and the branch when asked for. */
export type GuardContext = { fence: readonly string[]; cwd: string; branch?: string }

const pathOf = (input: unknown) => {
  const i = input as { file_path?: unknown; notebook_path?: unknown; path?: unknown } | undefined
  const p = i?.file_path ?? i?.notebook_path ?? i?.path
  return typeof p === 'string' ? p : undefined
}

/** Whether a call would need the branch name to decide (so the caller only runs git then). */
export function needsBranch(guards: Guards, tool: string, input: unknown): boolean {
  if (!guards.noMain) return false
  const command = tool === 'Bash' ? (input as { command?: string })?.command : undefined
  return EDIT_TOOLS.has(tool) || (command !== undefined && mutates(command) && !LEAVES_MAIN.test(command))
}

const blocked = (name: string, then: string): Verdict => ({ decision: 'deny', reason: `Blocked by the user’s “${name}” guard in Flowpane. ${then}` })

/** What the guards say about a tool call: deny, ask, or nothing to say. Denies win over asks. */
export function guardVerdict(guards: Guards, tool: string, input: unknown, ctx: GuardContext = { fence: [], cwd: '' }): Verdict | undefined {
  const command = tool === 'Bash' && typeof (input as { command?: unknown })?.command === 'string' ? (input as { command: string }).command : undefined
  const path = pathOf(input)
  const isEdit = EDIT_TOOLS.has(tool)
  const isWrite = isEdit || (command !== undefined && mutates(command))

  if (guards.noPush && command && /\bgit\s+push\b/.test(command)) return blocked('No git push', 'Do not retry; tell the user what is ready to push.')
  if (guards.secrets && ((path && (isEdit || READ_TOOLS.has(tool)) && isSecretPath(path)) || (command && touchesSecret(command)))) {
    return blocked('Secret shield', 'Do not try another way to read it; ask the user for the value you need, or for the variable name only.')
  }
  if (guards.readOnly && isWrite) return blocked('Read-only', 'Do not retry or work around it; describe the change instead.')
  if (guards.noMain && ctx.branch && /^(main|master)$/.test(ctx.branch) && isWrite && !(command && LEAVES_MAIN.test(command))) {
    return blocked('No edits on main', 'Create a branch (git switch -c <name>) or a worktree first, then make the change there.')
  }
  if (ctx.fence.length && isEdit && path && !inFence(path, ctx.fence, ctx.cwd)) {
    return blocked('Fence', `This file is outside the fence (${ctx.fence.join(', ')}). Ask the user before changing it.`)
  }
  if (ctx.fence.length && command && mutates(command)) return { decision: 'ask', reason: `Flowpane fence is on (${ctx.fence.join(', ')}): check this command stays inside it.` }
  if (guards.askBash && command !== undefined) return { decision: 'ask', reason: 'Flowpane “Ask before Bash” guard is on.' }
  return undefined
}

// ── ask aside ──────────────────────────────────────────────────────

/** The person's side question, framed so the fork answers briefly and does nothing else. */
export const askPrompt = (question: string) =>
  `The user has a quick side question about this conversation. Answer it directly and briefly (under 120 words), from what is above. Do not continue the task or propose tool calls.

Question: ${question}`

export const explainQuestion = (selection: string) => `Explain this part of our conversation: “${clip(selection, 1500)}”`

export const quote = (text: string) => text.replace(/^/gm, '> ') + '\n\n'

// ── snippets ───────────────────────────────────────────────────────

export const DEFAULT_SNIPPETS: Snippet[] = [
  { id: 's-test', label: 'Run tests & fix', text: 'Run the tests and fix any failures.' },
  { id: 's-commit', label: 'Commit', text: 'Commit these changes with a clear message.' },
  { id: 's-diff', label: 'Explain diff', text: 'Explain the last diff in plain words.' },
]

/** `label: text` makes a snippet; a bare text gets its first words as the label. */
export function parseSnippet(input: string): Omit<Snippet, 'id'> | undefined {
  const t = input.trim()
  if (!t) return undefined
  const m = t.match(/^([^:]{1,24}):\s*(.+)$/s)
  if (m) return { label: m[1]!.trim(), text: m[2]!.trim() }
  return { label: clip(t.split(/\s+/).slice(0, 3).join(' '), 20), text: t }
}
