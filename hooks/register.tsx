import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiPressArgument } from 'claude-code'

import type { Ask, Guards, Pin, Tab } from '../types'
import { askPrompt, clip, explainQuestion, guardVerdict, GUARD_LABEL, NO_GUARDS, pinsSection, quote } from './logic'
import { AskTab, Band, guard, Header, PinsTab } from './views'

const PANE = 'flowpane'
const TITLE = 'Flowpane'

const pins = atom({ plugin: 'flowpane', key: 'pins' } as const, [] as Pin[])
const guards = atom({ plugin: 'flowpane', key: 'guards' } as const, NO_GUARDS)
const asks = atom({ plugin: 'flowpane', key: 'asks' } as const, [] as Ask[])
const tab = atom({ plugin: 'flowpane', key: 'tab' } as const, 'pins' as Tab)

type $ = EngineInterface

// ── pins: per project, mirrored to the store ───────────────────────

async function pinsKey($: $) {
  return `pins:${await $.session.cwd()}`
}

async function setPins($: $, fn: (list: Pin[]) => Pin[]) {
  await update($, pins, list => fn(list).slice(-30))
  await $.store.set(await pinsKey($), await read($, pins))
}

async function addPin($: $, text: string) {
  const rule = clip(text, 300)
  if (!rule) return
  const id = `p${crypto.randomUUID().slice(0, 8)}`
  await setPins($, list => (list.some(p => p.text === rule) ? list : [...list, { id, text: rule, isOn: true }]))
}

async function loadPins($: $) {
  if ((await read($, pins)).length > 0) return // a hot reload keeps $.state
  const saved = (await $.store.get(await pinsKey($))) as Pin[] | undefined
  if (saved?.length) await update($, pins, () => saved)
}

// ── ask aside: a fork over the transcript, never added to it ───────

async function askAside($: $, question: string) {
  const q = clip(question, 500)
  if (!q) return
  const at = await $.clock.now()
  const id = `a${crypto.randomUUID().slice(0, 8)}`
  await update($, asks, list => [...list, { id, question: q, status: 'thinking' as const, at }].slice(-20))
  const r = await $.model.fork({ prompt: askPrompt(q) })
  const answer = r.isAnswered
    ? r.text.trim()
    : r.reason === 'nothing-to-fork'
      ? 'Nothing to ask about yet: the conversation has no reply so far.'
      : `No answer (${r.reason}).`
  const status = r.isAnswered ? ('done' as const) : ('error' as const)
  await update($, asks, list => list.map(a => (a.id === id ? { ...a, answer, status } : a)))
}

async function useSelection($: $, action: 'explain' | 'quote' | 'pin') {
  const sel = await $.ui.selection()
  if (!sel?.text.trim()) {
    $.ui.toast('Select some text in the transcript first')
    return
  }
  if (action === 'quote') {
    await $.prompt.fill({ text: quote(sel.text), mode: 'insert' })
  } else if (action === 'pin') {
    await addPin($, sel.text)
    $.ui.toast('Pinned')
  } else {
    await askAside($, explainQuestion(sel.text))
  }
}

async function toggleGuard($: $, k: keyof Guards) {
  const was = (await read($, guards))[k]
  await update($, guards, g => ({ ...g, [k]: !g[k] }))
  $.ui.toast(`${GUARD_LABEL[k]} ${was ? 'off' : 'on'}`)
}

async function setTab($: $, next: Tab) {
  await update($, tab, () => next)
}

function openPane($: $) {
  return $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = (on, options) => {
  // ── session and commands ─────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'flow', description: 'Flowpane: toggle the panel, or `/flow pins|ask`' })
    await $.command.register({ name: 'pin', description: 'Flowpane: pin a rule sent with every request, e.g. `/pin use pnpm`' })
    await $.command.register({ name: 'ask', description: 'Flowpane: ask a side question about this conversation without adding to it' })
    await loadPins($)
    const wasClosed = (await $.store.get('closedByPerson')) === true
    if (e.isInteractive && options.autoOpen !== false && !wasClosed) void openPane($)
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set('closedByPerson', true)
    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pins' || arg === 'ask') {
      await setTab($, arg)
    } else if (arg === '' && (await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      await $.store.set('closedByPerson', true)
      return { text: 'Flowpane closed.' }
    } else if (arg !== '') {
      return { text: 'Usage: /flow [pins|ask]' }
    }
    await $.store.set('closedByPerson', false)
    await openPane($)
    return { text: 'Flowpane opened.' }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      const list = await read($, pins)
      return { text: list.length ? list.map(p => `${p.isOn ? '☑' : '☐'} ${p.text}`).join('\n') : 'No pins. Add one with /pin <rule>.' }
    }
    await addPin($, text)
    return { text: `Pinned: ${clip(text, 80)}` }
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    const q = e.args.trim()
    if (!q) return { text: 'Usage: /ask <question about this conversation>' }
    await setTab($, 'ask')
    await openPane($)
    $.clock.after(0, () => void askAside($, q))
    return { text: 'Asking aside… the answer shows in Flowpane.' }
  })

  // ── what pins and guards do ──────────────────────────────────────

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const text = pinsSection(await read($, pins), await read($, guards))
    if (!text) return r
    return { sections: [...r.sections, { id: 'flowpane:pins', text, scope: 'session' as const }] }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = guardVerdict(await read($, guards), e.tool, e.input)
    if (!verdict) return next(e)
    if (verdict.decision === 'deny') return verdict
    const r = await next(e)
    return r.decision === 'deny' ? r : verdict
  })

  // ── drawing ──────────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band === false || e.props.hasSurvey) return next(e)
    const [gs, ps] = await Promise.all([read($, guards), read($, pins)])
    const els = $.ui.resolve(e)
    const onGuard = (k: keyof Guards) => void toggleGuard($, k)
    return <els.Box>{guard(els, 'band', () => Band(els, { guards: gs, pinsOn: ps.filter(p => p.isOn).length, onGuard }))}</els.Box>
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const [ps, gs, as, savedTab] = await Promise.all([read($, pins), read($, guards), read($, asks), read($, tab)])
    // A tab saved by an older version (flow, changes…) falls back to Pins.
    const current: Tab = savedTab === 'ask' ? 'ask' : 'pins'

    const onTab = (next: Tab) => void setTab($, next)
    const onGuard = (k: keyof Guards) => void toggleGuard($, k)
    const onAdd = (text: string) => void addPin($, text)
    const onTogglePin = (id: string) => void setPins($, list => list.map(p => (p.id === id ? { ...p, isOn: !p.isOn } : p)))
    const onRemovePin = (id: string) => void setPins($, list => list.filter(p => p.id !== id))
    const onAsk = (q: string) => void askAside($, q)
    const onSel = (action: 'explain' | 'quote' | 'pin', _press: UiPressArgument) => void useSelection($, action)
    const onInsert = (id: string) => {
      const a = as.find(x => x.id === id)
      if (a?.answer) void $.prompt.fill({ text: a.answer, mode: 'insert' })
    }
    const onRemoveAsk = (id: string) => void update($, asks, list => list.filter(a => a.id !== id))

    const { Box } = els
    const body =
      current === 'ask'
        ? guard(els, 'ask', () => AskTab(els, Input, { asks: as, onAsk, onSelection: onSel, onInsert, onRemove: onRemoveAsk }))
        : guard(els, 'pins', () =>
            PinsTab(els, Input, { pins: ps, guards: gs, onGuard, onAdd, onToggle: onTogglePin, onRemove: onRemovePin }),
          )

    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        {guard(els, 'header', () =>
          Header(els, { tab: current, pinsOn: ps.filter(p => p.isOn).length, guardsOn: Object.values(gs).filter(Boolean).length, onTab }),
        )}
        <Box flexDirection="column" marginTop={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
