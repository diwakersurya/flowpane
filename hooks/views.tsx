import type { Elements, RenderNode, UiPressArgument } from 'claude-code'

import type { Ask, Guards, Pin, Tab } from '../types'
import { GUARD_LABEL } from './logic'

/** What every surface draws. */
export type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown'>
/** `Input` is on every surface but mobile; absent there, the views say how to do it by command. */
export type Field = Elements['terminal']['Input'] | undefined

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'pins', label: 'Pins', hotkey: 'p' },
  { tab: 'ask', label: 'Ask', hotkey: 'a' },
]

export function Header({ Box, Button }: Common, p: { tab: Tab; pinsOn: number; guardsOn: number; onTab: (t: Tab) => void }) {
  const badge: Record<Tab, string> = {
    pins: p.pinsOn + p.guardsOn ? ` ${p.pinsOn + p.guardsOn} on` : '',
    ask: '',
  }
  return (
    <Box gap={1}>
      {TABS.map(t => (
        <Button
          key={`tab-${t.tab}`}
          label={t.label + badge[t.tab]}
          hotkey={t.hotkey}
          variant={t.tab === p.tab ? 'primary' : undefined}
          dimColor={t.tab !== p.tab}
          onPress={() => p.onTab(t.tab)}
        />
      ))}
    </Box>
  )
}

export function PinsTab(
  { Box, Text, Button }: Common,
  Input: Field,
  p: {
    pins: readonly Pin[]
    guards: Guards
    onGuard: (k: keyof Guards) => void
    onAdd: (text: string) => void
    onToggle: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  return (
    <Box flexDirection="column">
      <Text bold>Guards</Text>
      <Box flexDirection="column" marginBottom={1}>
        {(Object.keys(GUARD_LABEL) as (keyof Guards)[]).map(k => (
          <Button
            key={`guard-${k}`}
            plain
            label={`${p.guards[k] ? '●' : '○'} ${GUARD_LABEL[k]}`}
            variant={p.guards[k] ? 'primary' : undefined}
            onPress={() => p.onGuard(k)}
          />
        ))}
      </Box>
      <Text bold>Pinned rules</Text>
      <Text dimColor wrap="wrap">
        Sent with every request while on, and kept through /compact.
      </Text>
      {p.pins.length === 0 && <Text dimColor>None yet.</Text>}
      {p.pins.map(pin => (
        <Box gap={1}>
          <Button key={`pin-${pin.id}`} plain label={pin.isOn ? '☑' : '☐'} onPress={() => p.onToggle(pin.id)} />
          <Box flexGrow={1}>
            <Text dimColor={!pin.isOn} wrap="wrap">
              {pin.text}
            </Text>
          </Box>
          <Button key={`unpin-${pin.id}`} plain dimColor label="✕" onPress={() => p.onRemove(pin.id)} />
        </Box>
      ))}
      <Box marginTop={1}>
        {Input ? (
          <Input key="new-pin" placeholder="Pin a rule, e.g. use pnpm, not npm" submitLabel="Pin" onSubmit={text => p.onAdd(text)} />
        ) : (
          <Text dimColor>No text fields here yet: add pins with /pin &lt;rule&gt;.</Text>
        )}
      </Box>
    </Box>
  )
}

export function AskTab(
  { Box, Text, Button, Markdown }: Common,
  Input: Field,
  p: {
    asks: readonly Ask[]
    onAsk: (q: string) => void
    onSelection: (action: 'explain' | 'quote' | 'pin', press: UiPressArgument) => void
    onInsert: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  return (
    <Box flexDirection="column">
      {Input ? (
        <Input key="ask" placeholder="Ask about this conversation…" submitLabel="Ask" onSubmit={q => p.onAsk(q)} />
      ) : (
        <Text dimColor>No text fields here yet: ask with /ask &lt;question&gt;.</Text>
      )}
      <Text dimColor wrap="wrap">
        Answered from the conversation without adding to it or interrupting the agent.
      </Text>
      <Box gap={1} marginTop={1} flexWrap="wrap">
        <Text dimColor>Selection:</Text>
        <Button key="sel-explain" label="Explain" hotkey="e" onPress={press => p.onSelection('explain', press)} />
        <Button key="sel-quote" label="Quote" hotkey="q" onPress={press => p.onSelection('quote', press)} />
        <Button key="sel-pin" label="Pin" onPress={press => p.onSelection('pin', press)} />
      </Box>
      {[...p.asks].reverse().map(a => (
        <Box flexDirection="column" marginTop={1}>
          <Text bold wrap="wrap">
            ? {a.question}
          </Text>
          {a.status === 'thinking' ? (
            <Text color="yellow">… thinking</Text>
          ) : a.status === 'error' ? (
            <Text color="red" wrap="wrap">
              ✗ {a.answer}
            </Text>
          ) : (
            <Markdown text={a.answer ?? ''} />
          )}
          <Box gap={1}>
            {a.status === 'done' && <Button key={`insert-${a.id}`} plain label="↳ Insert into prompt" onPress={() => p.onInsert(a.id)} />}
            <Button key={`drop-${a.id}`} plain dimColor label="✕" onPress={() => p.onRemove(a.id)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Draws one view, an inline error line in its place if it throws. */
export function guard({ Text }: Common, name: string, draw: () => RenderNode | null): RenderNode | null {
  try {
    return draw()
  } catch (err) {
    return (
      <Text color="red" wrap="wrap">
        ✗ couldn't draw {name}: {err instanceof Error ? err.message : String(err)}
      </Text>
    )
  }
}
