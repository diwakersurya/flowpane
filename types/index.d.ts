/** A rule the person pinned: sent with every request while on. */
export type Pin = { id: string; text: string; isOn: boolean }

/** Live switches the person flips in the pane or the band; each blocks or asks before a kind of tool call. */
export type Guards = { readOnly: boolean; noPush: boolean; askBash: boolean; noMain: boolean; secrets: boolean }

/** A side question answered from the conversation without adding to it. */
export type Ask = {
  id: string
  question: string
  answer?: string
  status: 'thinking' | 'done' | 'error'
  at: number
}

/** A prompt waiting to be sent once the agent is idle. */
export type QueueItem = { id: string; text: string }

/** A one-click prompt in the band. */
export type Snippet = { id: string; label: string; text: string }

export type Tab = 'pins' | 'ask' | 'queue'

declare module 'claude-code' {
  interface PluginState {
    flowpane: {
      /** This project's pins; mirrored to the store under the session's folder. */
      pins: Pin[]
      /** This session's guards; never stored. */
      guards: Guards
      /** Globs edits are fenced to this session; empty means no fence. */
      fence: string[]
      asks: Ask[]
      queue: QueueItem[]
      /** Send the next queued prompt each time a turn ends. */
      autoSend: boolean
      /** This project's snippets; mirrored to the store. */
      snippets: Snippet[]
      tab: Tab
    }
  }
}
