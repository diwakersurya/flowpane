/** A rule the person pinned: sent with every request while on. */
export type Pin = { id: string; text: string; isOn: boolean }

/** Live switches the person flips in the pane; each blocks or asks before a kind of tool call. */
export type Guards = { readOnly: boolean; noPush: boolean; askBash: boolean }

/** A side question answered from the conversation without adding to it. */
export type Ask = {
  id: string
  question: string
  answer?: string
  status: 'thinking' | 'done' | 'error'
  at: number
}

export type Tab = 'pins' | 'ask'

declare module 'claude-code' {
  interface PluginState {
    flowpane: {
      /** This project's pins; mirrored to the store under the session's folder. */
      pins: Pin[]
      /** This session's guards; never stored, so a new session starts with all off. */
      guards: Guards
      asks: Ask[]
      tab: Tab
    }
  }
}
