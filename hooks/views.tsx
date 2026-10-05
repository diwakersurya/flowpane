import type { Elements, RenderNode, UiPressArgument } from 'claude-code'

import type { Ask, Guards, Pin, QueueItem, Snippet, Tab } from '../types'
import { GUARD_LABEL, GUARD_SHORT } from './logic'

/** What every surface draws. */
export type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown'>
/** `Input` is on every surface but mobile; absent there, the views say how to do it by command. */
export type Field = Elements['terminal']['Input'] | undefined

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'pins', label: 'Pins', hotkey: 'p' },
  { tab: 'ask', label: 'Ask', hotkey: 'a' },
  { tab: 'queue', label: 'Queue', hotkey: 'q' },
]

const GUARD_KEYS = Object.keys(GUARD_LABEL) as (keyof Guards)[]

export function Header({ Box, Button }: Common, p: { tab: Tab; pinsOn: number; guardsOn: number; queued: number; onTab: (t: Tab) => void }) {
  const badge: Record<Tab, string> = {
    pins: p.pinsOn + p.guardsOn ? ` ${p.pinsOn + p.guardsOn} on` : '',
    ask: '',
    queue: p.queued ? ` ${p.queued}` : '',
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

const ByCommand = ({ Text }: Common, command: string) => <Text dimColor>No text fields here yet: use {command}.</Text>

export function PinsTab(
  els: Common,
  Input: Field,
  p: {
    pins: readonly Pin[]
    guards: Guards
    fence: readonly string[]
    onGuard: (k: keyof Guards) => void
    onFence: (text: string) => void
    onAdd: (text: string) => void
    onToggle: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column">
      <Text bold>Guards</Text>
      <Box flexDirection="column">
        {GUARD_KEYS.map(k => (
          <Button
            key={`guard-${k}`}
            plain
            label={`${p.guards[k] ? '●' : '○'} ${GUARD_LABEL[k]}`}
            variant={p.guards[k] ? 'primary' : undefined}
            onPress={() => p.onGuard(k)}
          />
        ))}
      </Box>
      <Box gap={1} marginBottom={1}>
        <Text>{p.fence.length ? '●' : '○'} Fence</Text>
        {p.fence.length ? (
          <>
            <Text color="cyan">{p.fence.join(', ')}</Text>
            <Button key="fence-clear" plain dimColor label="✕" onPress={() => p.onFence('')} />
          </>
        ) : Input ? (
          <Input key="fence" placeholder="src/auth/** (edits stay inside)" submitLabel="Fence" onSubmit={text => p.onFence(text)} />
        ) : (
          ByCommand(els, '/fence <globs>')
        )}
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
          ByCommand(els, '/pin <rule>')
        )}
      </Box>
    </Box>
  )
}

export function AskTab(
  els: Common,
  Input: Field,
  p: {
    asks: readonly Ask[]
    onAsk: (q: string) => void
    onSelection: (action: 'explain' | 'quote' | 'pin', press: UiPressArgument) => void
    onInsert: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  const { Box, Text, Button, Markdown } = els
  return (
    <Box flexDirection="column">
      {Input ? <Input key="ask" placeholder="Ask about this conversation…" submitLabel="Ask" onSubmit={q => p.onAsk(q)} /> : ByCommand(els, '/ask <question>')}
      <Text dimColor wrap="wrap">
        Answered from the conversation without adding to it or interrupting the agent.
      </Text>
      <Box gap={1} marginTop={1} flexWrap="wrap">
        <Text dimColor>Selection:</Text>
        <Button key="sel-explain" label="Explain" hotkey="e" onPress={press => p.onSelection('explain', press)} />
        <Button key="sel-quote" label="Quote" onPress={press => p.onSelection('quote', press)} />
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

export function QueueTab(
  els: Common,
  Input: Field,
  p: {
    queue: readonly QueueItem[]
    autoSend: boolean
    snippets: readonly Snippet[]
    onAuto: () => void
    onAdd: (text: string) => void
    onSend: (id: string) => void
    onMove: (id: string, by: -1 | 1) => void
    onRemove: (id: string) => void
    onAddSnippet: (text: string) => void
    onRemoveSnippet: (id: string) => void
  },
) {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column">
      <Button
        key="auto-send"
        plain
        label={`${p.autoSend ? '●' : '○'} Send the next one when the agent finishes`}
        variant={p.autoSend ? 'primary' : undefined}
        onPress={p.onAuto}
      />
      {Input ? (
        <Input key="enqueue" placeholder="Then… (queued until the agent is idle)" submitLabel="Queue" onSubmit={text => p.onAdd(text)} />
      ) : (
        ByCommand(els, '/queue <prompt>')
      )}
      {p.queue.length === 0 && <Text dimColor>Nothing queued.</Text>}
      {p.queue.map((item, i) => (
        <Box gap={1}>
          <Text dimColor>{i + 1}.</Text>
          <Box flexGrow={1}>
            <Text wrap="wrap">{item.text}</Text>
          </Box>
          <Button key={`send-${item.id}`} plain label="▶" onPress={() => p.onSend(item.id)} />
          {i > 0 && <Button key={`up-${item.id}`} plain dimColor label="↑" onPress={() => p.onMove(item.id, -1)} />}
          {i < p.queue.length - 1 && <Button key={`down-${item.id}`} plain dimColor label="↓" onPress={() => p.onMove(item.id, 1)} />}
          <Button key={`dequeue-${item.id}`} plain dimColor label="✕" onPress={() => p.onRemove(item.id)} />
        </Box>
      ))}

      <Box marginTop={1}>
        <Text bold>Snippets</Text>
      </Box>
      <Text dimColor wrap="wrap">
        One-click prompts in the band above the prompt box.
      </Text>
      {p.snippets.map(s => (
        <Box gap={1}>
          <Text color="cyan">{s.label}</Text>
          <Box flexGrow={1}>
            <Text dimColor wrap="truncate">
              {s.text}
            </Text>
          </Box>
          <Button key={`unsnip-${s.id}`} plain dimColor label="✕" onPress={() => p.onRemoveSnippet(s.id)} />
        </Box>
      ))}
      {Input ? (
        <Input key="new-snippet" placeholder="label: prompt text" submitLabel="Add" onSubmit={text => p.onAddSnippet(text)} />
      ) : (
        ByCommand(els, '/snippet label: text')
      )}
    </Box>
  )
}

/** Above the prompt: the guards as switches (row one), the snippets (row two, room allowing). */
export function Band(
  { Box, Text, Button }: Common,
  p: {
    guards: Guards
    fence: readonly string[]
    pinsOn: number
    queued: number
    snippets: readonly Snippet[]
    rows: number
    onGuard: (k: keyof Guards) => void
    onSnippet: (id: string) => void
  },
) {
  const extras = [p.fence.length ? `fence ${p.fence.join(',')}` : '', p.pinsOn ? `${p.pinsOn} pin${p.pinsOn === 1 ? '' : 's'}` : '', p.queued ? `${p.queued} queued` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text dimColor>guards</Text>
        {GUARD_KEYS.map(k => (
          <Button
            key={`band-${k}`}
            plain
            label={`${p.guards[k] ? '●' : '○'} ${GUARD_SHORT[k]}`}
            variant={p.guards[k] ? 'primary' : undefined}
            dimColor={!p.guards[k]}
            onPress={() => p.onGuard(k)}
          />
        ))}
        {extras && <Text dimColor>· {extras}</Text>}
      </Box>
      {p.rows >= 2 && p.snippets.length > 0 && (
        <Box gap={1}>
          <Text dimColor>prompts</Text>
          {p.snippets.slice(0, 6).map(s => (
            <Button key={`snip-${s.id}`} plain label={`[${s.label}]`} onPress={() => p.onSnippet(s.id)} />
          ))}
        </Box>
      )}
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
