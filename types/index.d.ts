export type NodeKind = 'turn' | 'tool' | 'agent'
export type Status = 'running' | 'done' | 'error' | 'denied'

export type FlowNode = {
  id: string
  kind: NodeKind
  /** Turn id for a main-loop call, the Agent call's id for a subagent's call. */
  parent?: string
  label: string
  /** Tool name for tool and agent nodes. */
  tool?: string
  status: Status
  startedAt: number
  endedAt?: number
  /** Turn number, 1-based, on turn nodes. */
  n?: number
  /** Children pruned away by the node cap, on turn nodes. */
  pruned?: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type Todo = {
  id: string
  content: string
  activeForm?: string
  status: TodoStatus
  updatedAt: number
}

export type Decision = {
  id: string
  turnId: string
  choice: string
  why?: string
  alternatives?: string[]
  source: 'tool' | 'inferred'
  at: number
}

export type Question = {
  /** The AskUserQuestion call's id and the question's index in it. */
  id: string
  turnId: string
  header: string
  question: string
  options: string[]
  /** Option labels the person picked; empty while waiting or when they typed their own. */
  chosen: string[]
  /** What they typed instead of picking an option ("Other"). */
  other?: string
  status: 'waiting' | 'answered' | 'declined'
  at: number
}

export type FileChange = {
  /** Relative to the session's directory when inside it. */
  path: string
  edits: number
  added: number
  removed: number
  isNew: boolean
  /** Turn numbers that touched it. */
  turns: number[]
  /** Unified diff hunks, newest first, capped. */
  patch: string
}

export type CheckKind = 'test' | 'build' | 'lint' | 'types'

export type Check = { kind: CheckKind; ok: boolean; command: string; turn?: number; at: number }

export type BgTask = { id: string; kind: string; label: string; command?: string; port?: number; startedAt: number }

export type LooseEnd = { id: string; turnId: string; text: string; isDone: boolean }

export type GitState = { branch: string; ahead: number; behind: number; dirty: number; commits: number }

export type Tab = 'flow' | 'changes' | 'todos' | 'decisions'

export type ContextFill = { used: number; window: number; percent: number }

export type Snapshot = {
  nodes: FlowNode[]
  todos: Todo[]
  decisions: Decision[]
  agents: Record<string, string>
  questions?: Question[]
  files?: FileChange[]
  checks?: Check[]
  looseEnds?: LooseEnd[]
  gitBase?: string
  savedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    flowpane: {
      nodes: FlowNode[]
      todos: Todo[]
      decisions: Decision[]
      /** Questions the agent asked the person, in order, with what they chose. */
      questions: Question[]
      files: FileChange[]
      checks: Check[]
      /** Background shells and agents still running. */
      background: BgTask[]
      looseEnds: LooseEnd[]
      /** Null outside a git repository. */
      git: GitState | null
      /** HEAD when the session began, to count its commits. */
      gitBase: string
      /** Subagent loop id → the Agent tool call's node id. */
      agents: Record<string, string>
      /** Ids of turn and agent nodes the person toggled open or shut. */
      toggled: string[]
      tab: Tab
      context: ContextFill | null
      /** The cat's head: -2 looking left … 2 looking right. */
      petPos: number
    }
  }
}
