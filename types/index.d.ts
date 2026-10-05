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

export type Tab = 'flow' | 'todos' | 'decisions'

export type ContextFill = { used: number; window: number; percent: number }

export type Snapshot = {
  nodes: FlowNode[]
  todos: Todo[]
  decisions: Decision[]
  agents: Record<string, string>
  questions?: Question[]
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
