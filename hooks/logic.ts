// Pure logic: the pinned-rules prompt section and guard verdicts.
// No `$`, so tests run it directly.
import type { Guards, Pin } from '../types'

export const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

export const NO_GUARDS: Guards = { readOnly: false, noPush: false, askBash: false }

export const GUARD_LABEL: Record<keyof Guards, string> = {
  readOnly: 'Read-only',
  noPush: 'No git push',
  askBash: 'Ask before Bash',
}

/** The band's labels, short enough for one row. */
export const GUARD_SHORT: Record<keyof Guards, string> = { readOnly: 'Read-only', noPush: 'No push', askBash: 'Ask Bash' }

const GUARD_RULE: Record<keyof Guards, string> = {
  readOnly: 'Read-only: do not edit, create or delete files, and do not run commands that change them. Investigate and propose changes instead.',
  noPush: 'No git push: commit if asked, but never push.',
  askBash: 'Every shell command needs the user’s approval first, so prefer fewer, well-chosen commands.',
}

/** The system-prompt section for the pins and guards that are on; undefined when none are. */
export function pinsSection(pins: readonly Pin[], guards: Guards): string | undefined {
  const on = pins.filter(p => p.isOn)
  const rules = (Object.keys(GUARD_RULE) as (keyof Guards)[]).filter(k => guards[k])
  if (on.length === 0 && rules.length === 0) return undefined
  const out = ['# Pinned by the user']
  if (on.length) {
    out.push('The user pinned these rules. Follow them in every reply for the rest of the session, including after compaction:')
    out.push(...on.map(p => `- ${p.text}`))
  }
  if (rules.length) {
    out.push('Guards the user switched on (calls that break them are blocked before they run):')
    out.push(...rules.map(k => `- ${GUARD_RULE[k]}`))
  }
  return out.join('\n')
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

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

/** Whether a shell command looks like it changes files. Quoted text is ignored. Best effort, not a sandbox. */
export function mutates(command: string): boolean {
  const bare = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''")
  return MUTATES.some(re => re.test(bare))
}

export type Verdict = { decision: 'deny' | 'ask'; reason: string }

/** What the guards say about a tool call: deny, ask, or nothing to say. */
export function guardVerdict(guards: Guards, tool: string, input: unknown): Verdict | undefined {
  const command = tool === 'Bash' && typeof (input as { command?: unknown })?.command === 'string' ? (input as { command: string }).command : undefined
  if (guards.noPush && command && /\bgit\s+push\b/.test(command)) {
    return { decision: 'deny', reason: 'Blocked by the user’s “No git push” guard in Flowpane. Do not retry; tell the user what is ready to push.' }
  }
  if (guards.readOnly && (EDIT_TOOLS.has(tool) || (command !== undefined && mutates(command)))) {
    return { decision: 'deny', reason: 'Blocked by the user’s “Read-only” guard in Flowpane. Do not retry or work around it; describe the change instead.' }
  }
  if (guards.askBash && command !== undefined) {
    return { decision: 'ask', reason: 'Flowpane “Ask before Bash” guard is on.' }
  }
  return undefined
}

/** The person's side question, framed so the fork answers briefly and does nothing else. */
export const askPrompt = (question: string) =>
  `The user has a quick side question about this conversation. Answer it directly and briefly (under 120 words), from what is above. Do not continue the task or propose tool calls.

Question: ${question}`

export const explainQuestion = (selection: string) => `Explain this part of our conversation: “${clip(selection, 1500)}”`

export const quote = (text: string) => text.replace(/^/gm, '> ') + '\n\n'
