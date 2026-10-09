// register.tsx — the management-portal MOD (plugin 1.9.0). OPTIONAL EXTRAS, NEVER ENFORCEMENT.
//
// Claude Code >= 2.1.287 (the Desktop Code tab from 2.1.286) loads this module through
// `hooks/hooks.json` → `modules`. An older Claude Code ignores that key and runs the plugin
// exactly as 1.7.x did. Every gate still lives in the COMMAND hooks (scripts/canon-gate.js,
// scripts/watch-alarm.js): a mod hook that throws fails OPEN, so nothing in this file is ever
// relied on to refuse or block anything.
//
// What it adds (README "Mods" lists exactly what each reads and writes):
//   RUN COCKPIT pane (/portal-cockpit; opens by itself on a wide Desktop): the run's PLAN —
//     proposal phases → milestones → tasks → subtasks, with progress bars (SVG on the Desktop,
//     text in the terminal), Completed vs Remaining, the current phase, deadlines and overdue,
//     hours and cost delivered vs planned, what the canon owes and which gates are stood down.
//     Tabs: Plan · Gates (re-arm / stand down, with a reason) · Graph (the latest
//     interpret_knowledge_graph: hubs, gaps) · Board (the last board read) · Settings.
//   STATUS LINE: run · phase n/N · overall % with a mini bar · gates armed/stood · owed reads.
//   BAND above the prompt: what is owed now (button: ask Claude to run the settling read), the
//     idle-run countdown (Continue now / Not now), and the timer on the current task.
//   CARDS for portal tool results (tasks, milestones, proposal, boards, graphs, inbox, DMs, bulk),
//     with a progress bar and "raw" one press away.
//   NOTIFICATIONS: toasts for new unread DMs, unread inbox mail, approvals waiting, tasks due.
//   TEAM CHAT WAKE-UP: polls the watched channel and starts a turn when this agent is @-addressed.
//   IDLE-RUN NUDGE: a run in RUN state with milestones remaining, idle N minutes (default 10)
//     with no background work → a toast, a 60-second countdown in the band, then a "continue
//     the run" prompt. Default ON only for runs started with /portal-continue; capped at three
//     nudges without progress. This closes the documented "no hook can restart an idle session".
//   COMPACT RUN CONTEXT: a few lines about the run added to the first message (prompt.context).
//
// The portal server is DISCOVERED, never hard-coded: the server Claude's own portal calls ran
// on (classic.PostToolUse names it — in the Desktop Code tab that is the claude.ai connector,
// `mcp__<uuid>__…`), the one remembered from an earlier session, the plugin's own server, and
// any server whose tool list carries the portal's signature. When the mod cannot reach any of
// them itself, the plan is still drawn from the portal results Claude reads in the session.
//
// Writes: its own $.state and $.store values; the canon sentinels through canon-gate.js
// stand-down / re-arm ONLY when the person presses those buttons; and start_timer / stop_timer
// ONLY when the person presses the timer button. Every other portal call it makes is a READ.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'
import type {
  BoardView, CanonStatus, CommandInfo, GateRow, KgView, PortalCockpit, PortalIdle, PortalLauncher, PortalPrefs,
  PortalTimer, PortalView, PortalWatch, TaskRow,
} from '../../types'
import {
  type Card, type ChatMessage, type Plan,
  CARD_TOOLS, addresses, buildPlan, cardFor, classOf, clip, currentTask, dueTasks, gatesFromStatus, glyph, helmosLink,
  looksLikePortal, money, newNotes, nudgeDecision, nudgeEnabled, nudgePrompt, owedNow, parseBoard, parseCanonStatus,
  parseDmConversations, parseDoctor, parseInbox, parseKgInterpretation, parseMessages, parseProposalDetail,
  parseSchedulingRequests, parseSubtasks, parseTasks, parseTimerEntry, portalServersFrom, portalServersFromBreakdown,
  progressMark, resultText, round1, rowLine, runContext, settlePrompt, splitMcpName, statusLine, svgBar, svgPlan,
  textBar, todayOf, wakePrompt, NUDGE_GRACE_MS,
  BUILTIN_PRESETS, PRESET_RUN, builtinPresets, phaseCounts, parseCommandFile, presetCommands, presetNameOk,
} from './portal-view'

const PANE = 'portal-cockpit'
const CANON_EVERY_MS = 10_000
const PLAN_EVERY_MS = 120_000
const WATCH_EVERY_MS = 45_000
const NOTIFY_EVERY_MS = 180_000
const IDLE_EVERY_MS = 15_000
const BG_MAX_MS = 30 * 60_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PORTAL_WRITES = /^(create_|update_|add_|complete_task|delete_|reorder_|set_|start_timer|stop_timer|log_time|promote_|attach_|move_|pin_|tag_|bulk$)/
const CONTINUE_RE = /^\s*\/(?:management-portal:)?portal-continue\b/i

const DEFAULT_PREFS: PortalPrefs = { rich: true, band: true, watch: true, notify: true, autoOpen: true, nudge: 'auto', nudgeMinutes: 10, helmosUrl: null }
const DEFAULT_IDLE: PortalIdle = { continueMode: false, lastActivityAt: 0, working: false, pendingSince: 0, nudges: 0, lastNudgeAt: 0, progressMark: '' }

const canonA = atom({ plugin: 'management-portal', key: 'canon' } as const, null)
const cockpitA = atom({ plugin: 'management-portal', key: 'cockpit' } as const,
  { loading: false, at: 0, error: null, projectId: null, proposal: null, tasks: null, server: null, via: null })
const prefsA = atom({ plugin: 'management-portal', key: 'prefs' } as const, DEFAULT_PREFS)
const bandA = atom({ plugin: 'management-portal', key: 'band' } as const, { hidden: false, asked: '' })
const rawA = atom({ plugin: 'management-portal', key: 'raw' } as const, [])
const watchA = atom({ plugin: 'management-portal', key: 'watch' } as const, null)
const serverA = atom({ plugin: 'management-portal', key: 'server' } as const, { name: null, how: 'not looked yet', tried: [], error: null, at: 0 })
const viewA = atom({ plugin: 'management-portal', key: 'view' } as const, { tab: 'plan', showDone: false })
const gatesA = atom({ plugin: 'management-portal', key: 'gates' } as const, { rows: null, reason: '', busy: null, last: null, at: 0 })
const kgA = atom({ plugin: 'management-portal', key: 'kg' } as const, null)
const boardA = atom({ plugin: 'management-portal', key: 'board' } as const, null)
const timerA = atom({ plugin: 'management-portal', key: 'timer' } as const, null)
const notifyA = atom({ plugin: 'management-portal', key: 'notify' } as const, { items: [], lastPollAt: 0, error: null })
const idleA = atom({ plugin: 'management-portal', key: 'idle' } as const, DEFAULT_IDLE)
const launcherA = atom({ plugin: 'management-portal', key: 'launcher' } as const,
  { list: null, presets: {}, active: PRESET_RUN, editing: null, presetName: '', form: null, last: null })

// Caches only — nothing a drawing reads. A fresh environment simply rediscovers them.
let canonInFlight: Promise<void> | null = null
let planInFlight: Promise<void> | null = null
let planReloadQueued = false
let lastStatus: string | undefined
let observed: string[] = []
let goodServer: string | null = null
let watchBusy = false
let notifyBusy = false
let doctorTick = 0
let autoOpened = false
let lastContextKey = ''
const bg = new Map<string, number>()

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadStored($)
    for (const c of [
      { name: 'portal-cockpit', description: 'Portal run cockpit: plan, phases, milestones, tasks with progress bars, done vs remaining, gates (management-portal mod)', argumentHint: '[project-id | gates | graph | board | settings | watch <channel> <agent> | unwatch | nudge on|off|auto|<minutes> | url <https://…>]' },
      { name: 'portal-gates', description: 'Portal canon gate control panel: every gate armed or stood down, with re-arm and stand-down buttons (management-portal mod)' },
      { name: 'portal-commands', description: 'A button for every management-portal command, with saved presets of which ones to show (management-portal mod)' },
    ]) {
      try { await $.command.register({ ...c, immediate: true }) } catch (_) { /* a name clash must not take the rest of the mod down */ }
    }
    void loadCommands($)
    $.clock.every(CANON_EVERY_MS, () => { void refreshCanon($) })
    $.clock.every(PLAN_EVERY_MS, () => { void loadPlan($, null, false) })
    $.clock.every(WATCH_EVERY_MS, () => { void pollWatch($) })
    $.clock.every(NOTIFY_EVERY_MS, () => { void pollNotify($) })
    $.clock.every(IDLE_EVERY_MS, () => { void idleTick($) })
    $.clock.after(500, () => { void refreshCanon($).then(() => loadPlan($, null, false)).then(() => maybeAutoOpen($)) })
    $.clock.after(20_000, () => { void pollNotify($) })
    return started
  })

  // /clear, /resume and /branch reset every $.state value and fire no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const r = await next(e)
    try { await loadStored($); void refreshCanon($).then(() => loadPlan($, null, false)) } catch (_) { /* convenience */ }
    return r
  }).catch(($, e, next) => next(e))

  // Observe, never decide. classic.PostToolUse runs after the chain (the plugin's own command
  // PostToolUse hooks, canon-gate post among them, answer exactly as before). It names the MCP
  // server a portal call ran on, and carries the result the model read.
  on('classic.PostToolUse', async ($, e, next) => {
    const answered = await next(e)
    try { await observeResult($, e as unknown as PostEvent) } catch (_) { /* observation only */ }
    return answered
  }).catch(($, e, next) => next(e))

  // Pass-through: background work is remembered so the idle nudge never fires over it.
  on('tool.call', async ($, e, next) => {
    try {
      const input = e as unknown as Record<string, unknown>
      const tool = String(e.tool)
      if ((tool === 'Bash' || tool === 'PowerShell') && input.run_in_background === true) bg.set(e.tool_use_id, await $.clock.now())
      if (tool === 'Monitor') bg.set(e.tool_use_id, await $.clock.now())
      if (tool === 'Skill' && /portal-continue/.test(String(input.skill || input.command || ''))) await setContinueMode($, true)
    } catch (_) { /* observation only */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await next(e)
    try {
      const text = String((e as unknown as { prompt?: string }).prompt || '')
      if (CONTINUE_RE.test(text)) await setContinueMode($, true)
      const now = await $.clock.now()
      await update($, idleA, (i) => ({ ...i, lastActivityAt: now, pendingSince: 0 }))
    } catch (_) { /* observation only */ }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try { const now = await $.clock.now(); await update($, idleA, (i) => ({ ...i, working: true, pendingSince: 0, lastActivityAt: now })) } catch (_) { /* fine */ }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    try {
      if (!(e as unknown as { agentId?: string }).agentId) {
        const now = await $.clock.now()
        await update($, idleA, (i) => ({ ...i, working: false, lastActivityAt: now }))
      }
    } catch (_) { /* fine */ }
    $.clock.after(300, () => { void refreshCanon($) })
    return done
  })

  // The compact run context: a few lines on the first message, beside (never instead of) the
  // canon card the command hooks print. Re-rendered only when the run or its phase changes.
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const s = await read($, canonA)
    const plan = planOf(await read($, cockpitA), await $.clock.now())
    const text = runContext(s, plan)
    if (!text) return r
    return { ...r, blocks: [...r.blocks.filter((b) => b.name !== 'portalRun'), { name: 'portalRun', text }] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'portal-commands' }, async ($) => {
    await update($, viewA, (v) => ({ ...v, tab: 'commands' as const }))
    void loadCommands($)
    await $.ui.open({ id: PANE, title: 'Portal cockpit' })
    return { text: 'Portal command launcher opened.' }
  })

  on('command.run', { command: 'portal-gates' }, async ($) => {
    await update($, viewA, (v) => ({ ...v, tab: 'gates' as const }))
    await $.ui.open({ id: PANE, title: 'Portal cockpit' })
    void refreshGates($)
    return { text: 'Portal gate control panel opened.' }
  })

  on('command.run', { command: 'portal-cockpit' }, async ($, e) => {
    const raw = String(e.args || '').trim()
    const args = raw.split(/\s+/).filter(Boolean)
    const a0 = (args[0] || '').toLowerCase()
    if (a0 === 'watch' && args[1] && args[2]) {
      await rememberWatch($, args[1], args.slice(2).join(' '))
      return { text: `Team Chat wake-up will poll channel ${args[1]} as ${args.slice(2).join(' ')} every ${WATCH_EVERY_MS / 1000}s.` }
    }
    if (a0 === 'unwatch') {
      await update($, watchA, () => null)
      try { await $.store.delete('watch') } catch (_) { /* fine */ }
      return { text: 'Team Chat wake-up stopped. The team-chat-watcher subagent is unaffected.' }
    }
    if (a0 === 'nudge' && args[1]) {
      const v = args[1].toLowerCase()
      if (v === 'on' || v === 'off' || v === 'auto') { await setPrefs($, { nudge: v }); return { text: `Idle-run nudge: ${v}.` } }
      const n = parseInt(v, 10)
      if (n >= 1 && n <= 240) { await setPrefs($, { nudgeMinutes: n }); return { text: `Idle-run nudge after ${n} idle minute(s).` } }
      return { text: 'Usage: /portal-cockpit nudge on|off|auto|<minutes>' }
    }
    if (a0 === 'url') {
      const u = args[1] || ''
      if (u === 'off') { await setPrefs($, { helmosUrl: null }); return { text: 'HelmOS links off.' } }
      if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(\/[\w./-]*)?$/i.test(u)) return { text: 'Usage: /portal-cockpit url https://<your HelmOS web address>' }
      await setPrefs($, { helmosUrl: u.replace(/\/+$/, '') })
      return { text: `HelmOS links point at ${u}.` }
    }
    if (['rich', 'band', 'watch', 'notify', 'autoopen'].includes(a0) && (args[1] === 'on' || args[1] === 'off')) {
      const key = (a0 === 'autoopen' ? 'autoOpen' : a0) as 'rich' | 'band' | 'watch' | 'notify' | 'autoOpen'
      await setPrefs($, { [key]: args[1] === 'on' } as Partial<PortalPrefs>)
      return { text: `portal mod: ${a0} ${args[1]}` }
    }
    if (['plan', 'commands', 'gates', 'graph', 'board', 'settings'].includes(a0)) await update($, viewA, (v) => ({ ...v, tab: a0 as PortalView['tab'] }))
    let projectId: string | null = null
    if (UUID_RE.test(args[0] || '')) {
      projectId = args[0]!
      await update($, cockpitA, (c) => ({ ...c, projectId, proposal: c.projectId === projectId ? c.proposal : null, tasks: c.projectId === projectId ? c.tasks : null }))
      try { await $.store.set('lastProject', projectId) } catch (_) { /* fine */ }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Portal cockpit' })
    void refreshCanon($).then(() => loadPlan($, projectId, true))
    if (a0 === 'gates') void refreshGates($)
    const placed = opened && typeof opened === 'object' && 'isPlaced' in opened ? (opened as { isPlaced: boolean }).isPlaced : true
    return { text: placed ? 'Portal cockpit opened.' : 'Portal cockpit is open but not placed yet — widen the window.' }
  })

  on('ui.close', async ($, e, next) => {
    if ((e as unknown as { id?: string }).id === PANE) autoOpened = true
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------------------------------------------------------------------------------------
  // The cockpit pane
  // ---------------------------------------------------------------------------------------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as unknown as Els
    const { Box, Text, Button } = els
    const cols = Math.max(30, (e.props.bodyColumns || 80) - 2)
    const desktop = e.surface === 'desktop' || e.surface === 'mobile'
    const view = await read($, viewA)
    const s = await read($, canonA)
    const cockpit = await read($, cockpitA)
    const prefs = await read($, prefsA)
    const now = await $.clock.now()
    const plan = planOf(cockpit, now)
    const tabs: [PortalView['tab'], string, string][] = [['plan', 'Plan', '1'], ['commands', 'Commands', '2'], ['gates', 'Gates', '3'], ['graph', 'Graph', '4'], ['board', 'Board', '5'], ['settings', 'Settings', '6']]
    const tabRow = (
      <Box key="tabs" flexDirection="row" columnGap={2}>
        {tabs.map(([id, label, hk]) => (
          <Button key={'tab-' + id} label={view.tab === id ? `[${label}]` : label} hotkey={hk} plain dimColor={view.tab !== id}
            onPress={() => { void update($, viewA, (v) => ({ ...v, tab: id })); if (id === 'gates') void refreshGates($) }} />
        ))}
      </Box>
    )
    let body: RenderNode
    if (view.tab === 'gates') body = await gatesBody($, els, s, cols)
    else if (view.tab === 'graph') body = await graphBody($, els, prefs, cockpit)
    else if (view.tab === 'board') body = await boardBody($, els, prefs, cols)
    else if (view.tab === 'settings') body = await settingsBody($, els, prefs)
    else if (view.tab === 'commands') body = await commandsBody($, els, cols, desktop)
    else body = await planBody($, els, { s, cockpit, plan, view, cols, desktop, now })
    return (
      <Box key="cockpit" flexDirection="column">
        {tabRow}
        {body}
      </Box>
    )
  })

  // ---------------------------------------------------------------------------------------
  // The band above the prompt: owed read-backs, the idle-run countdown, the timer.
  // ---------------------------------------------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prefs = await read($, prefsA)
    if (!prefs.band || e.props.hasSurvey) return next(e)
    const s = await read($, canonA)
    const band = await read($, bandA)
    const idle = await read($, idleA)
    const timer = await read($, timerA)
    const cockpit = await read($, cockpitA)
    const now = await $.clock.now()
    const o = owedNow(s)
    const plan = planOf(cockpit, now)
    const runOn = Boolean(s && s.run && s.run.state === 'RUN')
    const task = runOn ? currentTask(plan) : null
    const showOwed = !band.hidden && (o.count > 0 || o.journal)
    const showIdle = idle.pendingSince > 0
    const showTimer = Boolean(timer && timer.entryId) || (!band.hidden && runOn && Boolean(task))
    if (!showOwed && !showIdle && !showTimer) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(30, (e.props.bodyColumns || 80) - 2)
    const rows: RenderNode[] = []
    if (showIdle) {
      const left = Math.max(0, Math.ceil((NUDGE_GRACE_MS - (now - idle.pendingSince)) / 1000))
      rows.push(
        <Box key="idle" flexDirection="row" columnGap={1}>
          <Text key="idle-t" color="cyan" wrap="truncate-end">{`Idle ${prefs.nudgeMinutes}m · continues in ${left}s`}</Text>
          <Button key="idle-now" label="Continue now" variant="primary" onPress={() => { void fireNudge($) }} />
          <Button key="idle-not" label="Not now" onPress={() => { void snoozeNudge($) }} />
        </Box>,
      )
    }
    if (showOwed) {
      const what = o.count
        ? `portal canon owes ${o.count} read-back${o.count === 1 ? '' : 's'}: ${o.writes.slice(0, 3).join(', ')}${o.writes.length > 3 ? '…' : ''}`
        : 'portal canon: a journal entry is owed since the last phase boundary'
      const settle = o.settle
      const asked = settle !== null && band.asked === settle
      rows.push(<Text key="what" color="yellow" wrap="truncate-end">{clip(what, width)}</Text>)
      if (settle) rows.push(<Text key="call" dimColor wrap="truncate-end">{settle}</Text>)
      rows.push(
        <Box key="acts" flexDirection="row" columnGap={1}>
          {settle && !asked ? (
            <Button key="settle" label="Ask Claude to run the settling read" variant="primary" onPress={() => {
              void update($, bandA, (b) => ({ ...b, asked: settle }))
              void $.prompt.submit({ text: settlePrompt(settle) })
              $.ui.toast('Asked Claude to run the settling read')
            }} />
          ) : null}
          {asked ? <Text key="asked" dimColor>asked — waiting for the read</Text> : null}
          <Button key="hide" label="Hide" onPress={() => { void update($, bandA, (b) => ({ ...b, hidden: true })) }} />
        </Box>,
      )
    }
    if (showTimer) {
      if (timer && timer.entryId) {
        rows.push(
          <Box key="timer" flexDirection="row" columnGap={1}>
            <Text key="timer-t" color="green" wrap="truncate-end">{`⏱ timer running since ${clock(timer.startedAt)} on ${clip(timer.taskTitle, Math.max(10, width - 40))}`}</Text>
            <Button key="timer-stop" label={timer.busy ? 'stopping…' : 'Stop timer'} onPress={() => { void stopTimer($) }} />
          </Box>,
        )
      } else if (task) {
        rows.push(
          <Box key="timer" flexDirection="row" columnGap={1}>
            <Text key="timer-t" dimColor wrap="truncate-end">{`⏱ ${clip(task.title, Math.max(10, width - 30))}`}</Text>
            <Button key="timer-start" label={timer && timer.busy ? 'starting…' : 'Start timer'} onPress={() => { void startTimer($, task.id, task.title) }} />
            {timer && timer.error ? <Text key="timer-err" color="red">{clip(timer.error, 40)}</Text> : null}
          </Box>,
        )
      }
    }
    const max = Math.max(1, e.props.maxRows || 6)
    return <Box key="portal-band" flexDirection="column">{rows.slice(0, max)}</Box>
  })

  // ---------------------------------------------------------------------------------------
  // Cards for portal tool results. Anything we do not recognise draws as the engine draws it.
  // ---------------------------------------------------------------------------------------
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const prefs = await read($, prefsA)
    if (!prefs.rich || e.props.isErrored) return next(e)
    const p = splitMcpName(String(e.props.tool))
    if (!p || !CARD_TOOLS.has(p.tool) || !isPortalServer(p.server)) return next(e)
    const id = String(e.props.tool_use_id || e.requestId || '')
    const rawIds = await read($, rawA)
    const els = $.ui.resolve(e) as unknown as Els
    const { Box, Text, Button } = els
    if (rawIds.includes(id)) {
      const theirs = await next(e)
      return (
        <Box key="raw-wrap" flexDirection="column">
          <Button key="card" label="card" plain onPress={() => { void update($, rawA, (l) => l.filter((x) => x !== id)) }} />
          {theirs}
        </Box>
      )
    }
    const card: Card | null = cardFor(p.tool, resultText(e.props.output))
    if (!card) return next(e)
    const width = Math.max(30, (e.viewport?.columns || 100) - 8)
    const desktop = e.surface === 'desktop' || e.surface === 'mobile'
    const bar = typeof card.frac === 'number'
      ? (desktop && els.Svg
        ? <els.Svg key="bar" source={svgBar({ width: Math.min(560, width * 7), frac: card.frac, review: card.review || 0, label: 'progress' })} alt={`${Math.round(card.frac * 100)}% done`} />
        : <Text key="bar" color="green">{`${textBar(card.frac, Math.min(30, width - 10), card.review || 0)} ${Math.round(card.frac * 100)}%`}</Text>)
      : null
    const input = (e.props as unknown as { input?: Record<string, unknown> }).input || {}
    const linkKind = p.tool === 'read_board' ? 'board' : p.tool === 'interpret_knowledge_graph' ? 'graph' : p.tool === 'get_proposal_detail' ? 'project' : /tasks$/.test(p.tool) ? 'task' : null
    const href = linkKind ? helmosLink(prefs.helmosUrl, linkKind, String(input.board_id || input.graph_id || input.project_id || '')) : null
    return (
      <Box key="card" flexDirection="column">
        <Box key="head" flexDirection="row" columnGap={1}>
          <Text key="title" bold color="cyan">{card.title}</Text>
          <Text key="sum" dimColor wrap="truncate-end">{card.summary}</Text>
          <Button key="raw" label="raw" plain onPress={() => { void update($, rawA, (l) => [...l.filter((x) => x !== id), id].slice(-100)) }} />
        </Box>
        {bar}
        {card.rows.map((r, i) => (
          <Text key={'r' + i} wrap="truncate-end" color={colorOf(r.cls)} dimColor={r.cls === 'done'} bold={r.depth === 0 && r.mark !== '•'}>{rowLine(r, width)}</Text>
        ))}
        {card.more ? <Text key="more" dimColor>{`…${card.more} more (raw shows all)`}</Text> : null}
        {href ? <els.Link key="open" href={href} label="open in HelmOS" /> : null}
      </Box>
    )
  })
}

// =========================================================================================
// Pane bodies — top-level and in this file, as the engine requires of helpers that take `$`.
// =========================================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = (props: any) => RenderNode
type Els = { Box: El; Text: El; Button: El; Input?: El; Select?: El; Svg?: El; Link: El; Markdown?: El; Code?: El }

async function planBody($: EngineInterface, els: Els, x: { s: CanonStatus | null; cockpit: PortalCockpit; plan: Plan | null; view: PortalView; cols: number; desktop: boolean; now: number }): Promise<RenderNode> {
  const { Box, Text, Button } = els
  const { s, cockpit, plan, view, cols, desktop } = x
  const server = await read($, serverA)
  const timer = await read($, timerA)
  const lines: RenderNode[] = []
  const T = (key: string, text: string, o: { color?: string; dim?: boolean; bold?: boolean } = {}) =>
    <Text key={key} color={o.color} dimColor={o.dim} bold={o.bold} wrap="truncate-end">{text}</Text>
  const run = s && s.run
  if (run) lines.push(T('run', `run ${run.id} · ${run.state} · ${run.mode || 'solo'}${run.project_id ? ' · project ' + run.project_id.slice(0, 8) : ''}`, { dim: run.state !== 'RUN' }))
  else if (s) lines.push(T('run', 'no portal run declared for this project', { dim: true }))
  if (!plan) {
    if (cockpit.loading) lines.push(T('plan-loading', 'reading the plan from the portal…', { dim: true }))
    if (cockpit.error) lines.push(T('plan-err', cockpit.error, { color: 'red' }))
    if (!cockpit.loading && !cockpit.projectId) lines.push(T('plan-none', 'No project yet: start a run (/portal-project), or open /portal-cockpit <project-id>.', { dim: true }))
    else if (!cockpit.loading && !cockpit.proposal) {
      lines.push(T('plan-how', server.name ? 'No proposal read yet — press Refresh.' : 'The mod has not reached a portal server yet. Ask Claude to read the plan once; the cockpit fills from that read and remembers the server.', { dim: true }))
      if (cockpit.projectId) lines.push(
        <Button key="ask-plan" label="Ask Claude to read the plan" variant="primary" onPress={() => {
          void $.prompt.submit({ text: `Read the management-portal plan for project ${cockpit.projectId}: call get_proposal_detail and list_tasks (project_id ${cockpit.projectId}). Only read; no changes.` })
          $.ui.toast('Asked Claude to read the plan')
        }} />,
      )
    }
  } else {
    const head = `${plan.title} · ${plan.status || 'draft'}`
    lines.push(T('title', clip(head, cols), { bold: true }))
    if (desktop && els.Svg) {
      lines.push(<els.Svg key="chart" source={svgPlan(plan, Math.min(760, Math.max(280, cols * 7)))} alt={`Overall ${plan.pct}% delivered; phase ${plan.current + 1} of ${plan.phases.length}`} />)
    } else {
      lines.push(T('overall', `Overall ${textBar(plan.pct / 100, Math.min(30, cols - 20), plan.reviewPct / 100)} ${plan.pct}%`, { bold: true, color: 'green' }))
    }
    const facts = [
      `milestones ${plan.milestones.done}/${plan.milestones.total} done${plan.milestones.review ? ` (${plan.milestones.review} in review)` : ''}`,
      plan.tasks.total ? `tasks ${plan.tasks.done}/${plan.tasks.total}` : '',
      plan.subtasks.total ? `subtasks ${plan.subtasks.done}/${plan.subtasks.total}` : '',
      plan.hours ? `hours ${round1(plan.hours.delivered)}/${round1(plan.hours.planned)}` : '',
      plan.cost ? `${money(plan.cost.delivered)}/${money(plan.cost.planned)} delivered` : '',
    ].filter(Boolean).join(' · ')
    lines.push(T('facts', facts, { dim: true }))
    if (plan.overdue.length) lines.push(T('overdue', `OVERDUE: ${plan.overdue.map((o) => `${o.title} (${o.due})`).join(' · ')}`, { color: 'red' }))
    // Phases → milestones → (current phase) subtasks.
    lines.push(T('h-phases', 'PHASES', { bold: true }))
    if (plan.awaitingReview.length) lines.push(T('awaiting', `awaiting review (only in-review milestones left): phase ${plan.awaitingReview.map((k) => k + 1).join(', ')}`, { color: 'yellow' }))
    plan.phases.forEach((ph, i) => {
      const bar = textBar(ph.isDone ? 1 : ph.progress.total ? ph.progress.done / ph.progress.total : 0, 10, ph.progress.total ? ph.progress.review / ph.progress.total : 0)
      const mark = ph.isCurrent ? '▸' : ph.isDone ? '✓' : '·'
      lines.push(T('ph' + i, `${mark} ${i + 1}. ${clip(ph.name, Math.max(12, cols - 34))}  ${desktop ? '' : bar + ' '}${ph.progress.done}/${ph.progress.total}${ph.deadline ? ' · due ' + ph.deadline : ''}${ph.overdue ? ' · OVERDUE' : ''}`,
        { bold: ph.isCurrent, color: ph.isCurrent ? 'cyan' : ph.overdue ? 'red' : undefined, dim: ph.isDone && !ph.isCurrent }))
      if (ph.isCurrent) lines.push(T('phc' + i, `   current phase · ${phaseCounts(ph)}`, { color: 'cyan', dim: true }))
      const showMs = ph.isCurrent || view.showDone || !ph.isDone
      if (!showMs) return
      ph.milestones.forEach((m, j) => {
        const sub = m.task && m.task.sub && m.task.sub.total ? ` · subtasks ${m.task.sub.done}/${m.task.sub.total} ${textBar(m.task.sub.done / m.task.sub.total, 8)}` : ''
        const money_ = typeof m.cost === 'number' ? ` · ${money(m.cost)}` : ''
        const hrs = typeof m.hours === 'number' ? ` · ${round1(m.hours)}h` : ''
        const meta = `${m.status}${hrs}${money_}${sub}${m.overdue ? ' · OVERDUE' : ''}`
        const msColor = m.overdue && m.cls !== 'done' ? 'red' : colorOf(m.cls)
        if (cols < 90) {
          // Narrow (a docked Desktop pane is ~50 columns): the name gets its own line, the facts the next.
          lines.push(T(`ms${i}-${j}`, `   ${glyph(m.status)} ${m.name}`, { color: msColor, dim: m.cls === 'done' }))
          lines.push(T(`msm${i}-${j}`, `      ${meta}`, { dim: true }))
        } else {
          lines.push(T(`ms${i}-${j}`, `   ${glyph(m.status)} ${clip(m.name, Math.max(16, cols - 60))} · ${meta}`, { color: msColor, dim: m.cls === 'done' }))
        }
        if ((ph.isCurrent || view.showDone) && m.task && m.task.subtasks && m.cls !== 'done') {
          m.task.subtasks.forEach((st, k) => {
            if (!view.showDone && classOf(st.status) === 'done') return
            lines.push(T(`st${i}-${j}-${k}`, `       ${glyph(st.status)} ${clip(st.title, Math.max(10, cols - 12))}`, { dim: classOf(st.status) === 'done', color: colorOf(classOf(st.status)) }))
          })
        }
      })
    })
    // Completed vs Remaining.
    const remainingMs = plan.remaining.filter((r) => r.kind !== 'subtask')
    const remainingSub = plan.remaining.filter((r) => r.kind === 'subtask')
    lines.push(T('h-rem', `REMAINING · ${remainingMs.length} milestone/task(s), ${remainingSub.length} subtask(s)`, { bold: true, color: 'yellow' }))
    remainingMs.slice(0, 12).forEach((r, i) => lines.push(T('rem' + i, `  ${glyph(r.status)} ${clip(r.title, Math.max(10, cols - 30))} · ${r.status}${r.due ? ' · due ' + r.due : ''}${r.overdue ? ' · OVERDUE' : ''}`, { color: r.overdue ? 'red' : colorOf(classOf(r.status)) })))
    if (remainingMs.length > 12) lines.push(T('rem-more', `  …${remainingMs.length - 12} more`, { dim: true }))
    const completedMs = plan.completed.filter((r) => r.kind !== 'subtask')
    lines.push(T('h-done', `COMPLETED · ${completedMs.length} milestone/task(s)`, { bold: true, color: 'green' }))
    const doneShown = view.showDone ? completedMs : completedMs.slice(-6)
    doneShown.forEach((r, i) => lines.push(T('done' + i, `  ✓ ${clip(r.title, Math.max(10, cols - 6))}`, { dim: true })))
    if (!view.showDone && completedMs.length > 6) lines.push(T('done-more', `  …${completedMs.length - 6} earlier (Show all)`, { dim: true }))
  }
  // What the canon owes, and what is stood down.
  if (s) {
    const o = owedNow(s)
    lines.push(T('h-canon', `CANON · gates ${s.gates.armed}/${s.gates.total} armed${s.mode !== 'on' ? ' · PORTAL_CANON=' + s.mode : ''}`, { bold: true }))
    for (const g of s.gates.stood) lines.push(T('sd-' + g.id, `  stood down: ${g.id}${g.why ? ' (' + clip(g.why, 60) + ')' : ''}`, { color: 'yellow' }))
    if (!o.count && !o.journal && !o.closeout.length) lines.push(T('owed-none', '  nothing owed', { dim: true }))
    if (o.count) lines.push(T('owed', `  owes ${o.count} read-back(s): ${o.writes.slice(0, 4).join(', ')}${o.writes.length > 4 ? '…' : ''}`, { color: 'yellow' }))
    if (o.settle) lines.push(T('settle', `  settle: ${clip(o.settle, cols * 2)}`, { dim: true }))
    if (o.journal && s.journal) lines.push(T('journal', `  journal owed since ${s.journal.boundary}${s.journal.id ? ' ' + s.journal.id.slice(0, 8) : ''} (${!s.journal.wrote ? 'no entry' : 'not read back'})`, { color: 'yellow' }))
    if (o.closeout.length) lines.push(T('closeout', `  close-out missing: ${o.closeout.join(', ')}`, { color: 'yellow' }))
  }
  const src = cockpit.via === 'observed' ? 'from a portal result Claude read' : cockpit.server ? `via ${cockpit.server}` : 'not read yet'
  lines.push(T('src', `plan ${src}${cockpit.at ? ' · ' + clock(cockpit.at) : ''}${server.error && !cockpit.proposal ? ' · ' + clip(server.error, 80) : ''}`, { dim: true }))
  const task = currentTask(plan)
  lines.push(
    <Box key="buttons" flexDirection="row" columnGap={1}>
      <Button key="refresh" label={cockpit.loading ? 'Refreshing…' : 'Refresh'} hotkey="r" onPress={() => { void refreshCanon($).then(() => loadPlan($, null, true)) }} />
      <Button key="showdone" label={view.showDone ? 'Hide done' : 'Show all'} hotkey="d" onPress={() => { void update($, viewA, (v) => ({ ...v, showDone: !v.showDone })) }} />
      {timer && timer.entryId
        ? <Button key="timer" label="Stop timer" hotkey="t" onPress={() => { void stopTimer($) }} />
        : task ? <Button key="timer" label="Start timer" hotkey="t" onPress={() => { void startTimer($, task.id, task.title) }} /> : null}
      <Button key="close" label="Close" role="dismiss" onPress={() => { void $.ui.close({ id: PANE }) }} />
    </Box>,
  )
  return <Box key="plan" flexDirection="column">{lines}</Box>
}

async function gatesBody($: EngineInterface, els: Els, s: CanonStatus | null, cols: number): Promise<RenderNode> {
  const { Box, Text, Button } = els
  const g = await read($, gatesA)
  const rows: GateRow[] = g.rows && g.rows.length ? g.rows : gatesFromStatus(s)
  const out: RenderNode[] = []
  out.push(<Text key="g-head" bold>{`GATES · ${s ? `${s.gates.armed}/${s.gates.total} armed` : 'reading…'}${s && s.mode !== 'on' ? ' · PORTAL_CANON=' + s.mode : ''}`}</Text>)
  out.push(<Text key="g-help" dimColor wrap="wrap">Standing a gate down writes its sentinel (it survives restarts); re-arm puts it back. Both run canon-gate.js exactly as /portal-stand-down and /portal-rearm do.</Text>)
  if (els.Input) {
    out.push(<els.Input key="reason" label="Reason" placeholder="why this gate must stand down (required)" value={g.reason}
      onInput={(v: string) => { void update($, gatesA, (x) => ({ ...x, reason: String(v || '') })) }}
      onSubmit={(v: string) => { void update($, gatesA, (x) => ({ ...x, reason: String(v || '') })) }} submitLabel="set" />)
  }
  if (!g.rows) out.push(<Text key="g-wait" dimColor>{s ? 'listing every gate (canon-gate.js doctor)…' : 'reading the canon…'}</Text>)
  rows.forEach((r) => {
    out.push(
      <Box key={'g-' + r.id} flexDirection="row" columnGap={1}>
        <Text key={'gs-' + r.id} color={r.armed ? 'green' : 'yellow'}>{r.armed ? 'ARMED     ' : 'STOOD DOWN'}</Text>
        <Text key={'gi-' + r.id} bold={!r.armed} wrap="truncate-end">{clip(r.id + (r.why ? `  (${r.why})` : ''), Math.max(20, cols - 30))}</Text>
        {r.armed
          ? <Button key={'sd-' + r.id} label="Stand down" plain onPress={() => { void gateAction($, 'stand-down', r.id) }} />
          : <Button key={'ra-' + r.id} label="Re-arm" plain onPress={() => { void gateAction($, 're-arm', r.id) }} />}
      </Box>,
    )
  })
  out.push(
    <Box key="g-acts" flexDirection="row" columnGap={1}>
      <Button key="rearm-all" label="Re-arm all" variant="primary" onPress={() => { void gateAction($, 're-arm', 'all') }} />
      <Button key="g-refresh" label="Refresh" hotkey="r" onPress={() => { void refreshCanon($).then(() => refreshGates($)) }} />
    </Box>,
  )
  if (g.busy) out.push(<Text key="g-busy" dimColor>{g.busy}</Text>)
  if (g.last) out.push(<Text key="g-last" dimColor wrap="wrap">{g.last}</Text>)
  return <Box key="gates" flexDirection="column">{out}</Box>
}

async function graphBody($: EngineInterface, els: Els, prefs: PortalPrefs, cockpit: PortalCockpit): Promise<RenderNode> {
  const { Box, Text, Button } = els
  const kg = await read($, kgA)
  const out: RenderNode[] = []
  if (!kg) {
    out.push(<Text key="kg-none" dimColor wrap="wrap">No graph interpretation read in this session yet. The panel fills from the next interpret_knowledge_graph result: its hubs, bridges, communities and candidate missing links.</Text>)
  } else {
    out.push(<Text key="kg-title" bold>{`GRAPH · ${kg.title}`}</Text>)
    if (kg.summary) out.push(els.Markdown ? <els.Markdown key="kg-sum" text={kg.summary} /> : <Text key="kg-sum" wrap="wrap">{kg.summary}</Text>)
    const list = (k: string, head: string, items: string[], color?: string) => {
      if (!items.length) return
      out.push(<Text key={k + '-h'} bold color={color}>{head}</Text>)
      items.forEach((it, i) => out.push(<Text key={k + i} wrap="truncate-end">{`  • ${it}`}</Text>))
    }
    list('hub', `HUBS (${kg.hubs.length}) — what holds the graph together`, kg.hubs, 'cyan')
    list('gap', `GAPS (${kg.gaps.length}) — close in meaning, no edge between them`, kg.gaps, 'yellow')
    list('bridge', `BRIDGES (${kg.bridges.length})`, kg.bridges)
    list('comm', `COMMUNITIES (${kg.communities.length})`, kg.communities)
    list('thin', `ISOLATED (${kg.thin.length})`, kg.thin, 'red')
    const href = helmosLink(prefs.helmosUrl, 'graph', kg.graphId)
    if (href) out.push(<els.Link key="kg-open" href={href} label="open the graph in HelmOS" />)
  }
  out.push(
    <Box key="kg-acts" flexDirection="row" columnGap={1}>
      {kg && kg.gaps.length ? (
        <Button key="kg-gaps" label="Ask Claude to act on the gaps" onPress={() => {
          void $.prompt.submit({ text: `The knowledge graph${kg.graphId ? ' ' + kg.graphId : ''} interpretation lists ${kg.gaps.length} candidate missing link(s). Review them against the project${cockpit.projectId ? ' ' + cockpit.projectId : ''} and, where a link is real, add the edge or a task for it; say which you rejected and why.` })
          $.ui.toast('Asked Claude to review the graph gaps')
        }} />
      ) : null}
      <Button key="kg-ask" label="Ask Claude to interpret the project graph" onPress={() => {
        void $.prompt.submit({ text: `Interpret the knowledge graph for project ${cockpit.projectId || '(the current run\'s project)'}: find it with list_knowledge_graphs, run interpret_knowledge_graph on it, and tell me the hubs and gaps that matter for the remaining phases.` })
        $.ui.toast('Asked Claude to interpret the graph')
      }} />
    </Box>,
  )
  return <Box key="graph" flexDirection="column">{out}</Box>
}

async function boardBody($: EngineInterface, els: Els, prefs: PortalPrefs, cols: number): Promise<RenderNode> {
  const { Box, Text } = els
  const b = await read($, boardA)
  const out: RenderNode[] = []
  if (!b) {
    out.push(<Text key="b-none" dimColor wrap="wrap">No board read in this session yet. The preview fills from the next create_board / read_board result.</Text>)
  } else {
    out.push(<Text key="b-title" bold>{`BOARD · ${b.title} · ${b.blocks.length} block(s)`}</Text>)
    b.blocks.forEach((x, i) => out.push(
      <Text key={'b' + i} wrap="truncate-end" color={x.type === 'mermaid' ? 'cyan' : x.type === 'heading' ? undefined : undefined} bold={x.type === 'heading' || x.type === 'h1' || x.type === 'h2'}>
        {`${'  '.repeat(x.depth)}${x.type === 'mermaid' ? '◇' : '▪'} ${clip(x.text || '(' + x.type + ')', Math.max(10, cols - 4 - x.depth * 2))}  ${x.type}`}
      </Text>,
    ))
    const href = helmosLink(prefs.helmosUrl, 'board', b.id)
    if (href) out.push(<els.Link key="b-open" href={href} label="open the board in HelmOS" />)
  }
  return <Box key="board" flexDirection="column">{out}</Box>
}

async function settingsBody($: EngineInterface, els: Els, prefs: PortalPrefs): Promise<RenderNode> {
  const { Box, Text, Button } = els
  const idle = await read($, idleA)
  const watch = await read($, watchA)
  const notify = await read($, notifyA)
  const server = await read($, serverA)
  const out: RenderNode[] = []
  const toggle = (k: 'rich' | 'band' | 'watch' | 'notify' | 'autoOpen', label: string) => (
    <Button key={'pref-' + k} label={`${label}: ${prefs[k] ? 'on' : 'off'}`} onPress={() => { void setPrefs($, { [k]: !prefs[k] } as Partial<PortalPrefs>) }} />
  )
  out.push(<Text key="s-h" bold>SETTINGS</Text>)
  out.push(<Box key="s-t1" flexDirection="row" columnGap={1}>{toggle('rich', 'Cards')}{toggle('band', 'Band')}{toggle('notify', 'Notifications')}</Box>)
  out.push(<Box key="s-t2" flexDirection="row" columnGap={1}>{toggle('watch', 'Chat wake')}{toggle('autoOpen', 'Auto-open')}</Box>)
  out.push(<Text key="s-n" bold>{`IDLE-RUN NUDGE · ${prefs.nudge} · after ${prefs.nudgeMinutes} min · ${nudgeEnabled(prefs, idle) ? 'active in this session' : 'not active in this session'}${idle.continueMode ? ' · run started with /portal-continue' : ''}`}</Text>)
  if (els.Select) {
    out.push(<els.Select key="nudge" label="Nudge" value={prefs.nudge}
      options={[{ value: 'auto', label: 'auto — only runs started with /portal-continue' }, { value: 'on', label: 'on — every run in RUN state' }, { value: 'off', label: 'off' }]}
      onSelect={(v: string) => { void setPrefs($, { nudge: (v === 'on' || v === 'off' ? v : 'auto') }) }} />)
    out.push(<els.Select key="nudge-min" label="Idle minutes" value={String(prefs.nudgeMinutes)}
      options={[5, 10, 15, 20, 30, 60].map((n) => ({ value: String(n), label: `${n} min` }))}
      onSelect={(v: string) => { void setPrefs($, { nudgeMinutes: Math.max(1, parseInt(v, 10) || 10) }) }} />)
  } else {
    out.push(<Box key="nudge-b" flexDirection="row" columnGap={1}>
      {(['auto', 'on', 'off'] as const).map((v) => <Button key={'nudge-' + v} label={prefs.nudge === v ? `[${v}]` : v} onPress={() => { void setPrefs($, { nudge: v }) }} />)}
    </Box>)
  }
  if (idle.nudges) out.push(<Text key="s-nc" dimColor>{`${idle.nudges} nudge(s) sent; pauses after 3 without progress`}</Text>)
  if (els.Input) {
    out.push(<els.Input key="url" label="HelmOS web address" placeholder="https://… (for links; empty = none)" value={prefs.helmosUrl || ''}
      onSubmit={(v: string) => {
        const u = String(v || '').trim().replace(/\/+$/, '')
        if (!u) void setPrefs($, { helmosUrl: null })
        else if (/^https:\/\/[a-z0-9.-]+(?::\d+)?(\/[\w./-]*)?$/i.test(u)) void setPrefs($, { helmosUrl: u })
        else $.ui.toast('That is not an https:// address')
      }} submitLabel="save" />)
  }
  out.push(<Text key="s-srv" dimColor wrap="wrap">{`Portal server: ${server.name || 'none reached yet'} (${server.how})${server.tried.length ? ' · tried ' + server.tried.join(', ') : ''}${server.error ? ' · ' + server.error : ''}`}</Text>)
  out.push(<Text key="s-w" dimColor wrap="truncate-end">{watch ? `Team Chat wake-up: ${watch.agent} on ${watch.channelId.slice(0, 8)}${prefs.watch ? '' : ' (paused)'}${watch.lastError ? ' · ' + watch.lastError : ''}` : 'Team Chat wake-up: no channel watched (it starts when Claude starts watching one)'}</Text>)
  if (watch) out.push(<Button key="unwatch" label="Stop the chat wake-up" onPress={() => { void update($, watchA, () => null); void $.store.delete('watch') }} />)
  out.push(<Text key="s-nh" bold>{`NOTIFICATIONS${notify.lastPollAt ? ' · checked ' + clock(notify.lastPollAt) : ''}`}</Text>)
  if (notify.error) out.push(<Text key="s-ne" color="red">{clip(notify.error, 100)}</Text>)
  if (!notify.items.length) out.push(<Text key="s-n0" dimColor>nothing new</Text>)
  notify.items.slice(-8).reverse().forEach((n, i) => out.push(<Text key={'nt' + i} wrap="truncate-end">{`${clock(n.at)}  ${n.text}`}</Text>))
  return <Box key="settings" flexDirection="column">{out}</Box>
}

// =========================================================================================
// Data: canon snapshot, gates, discovery, plan, observation
// =========================================================================================

type PostEvent = { tool_name?: string; tool_input?: Record<string, unknown>; tool_response?: unknown; mcp_server?: { name: string; source: string } }

function colorOf(cls: string | undefined): string | undefined {
  return cls === 'active' ? 'cyan' : cls === 'review' ? 'yellow' : cls === 'done' ? 'green' : cls === 'cancelled' ? 'gray' : undefined
}

function clock(ms: number): string {
  try { return new Date(ms).toTimeString().slice(0, 5) } catch (_) { return '' }
}

function planOf(c: PortalCockpit, now: number): Plan | null {
  return c.proposal ? buildPlan(c.proposal, c.tasks, todayOf(now)) : null
}

function isPortalServer(server: string): boolean {
  return looksLikePortal(server, [...observed, ...(goodServer ? [goodServer] : [])])
}

async function loadStored($: EngineInterface): Promise<void> {
  try {
    const saved = (await $.store.get('prefs')) as Partial<PortalPrefs> | undefined
    if (saved && typeof saved === 'object') await update($, prefsA, (p) => ({ ...DEFAULT_PREFS, ...p, ...saved }))
    const w = (await $.store.get('watch')) as PortalWatch | undefined
    if (w && typeof w === 'object' && w.channelId && w.agent) await update($, watchA, () => ({ ...w, seen: (w.seen || []).slice(-200) }))
    const srv = (await $.store.get('server')) as string | undefined
    if (typeof srv === 'string' && srv) { if (!observed.includes(srv)) observed = [...observed, srv] }
    const sid = await $.session.id()
    const cont = (await $.store.get('continue')) as Record<string, number> | undefined
    const now = await $.clock.now()
    await update($, idleA, (i) => ({ ...i, continueMode: Boolean(cont && cont[sid]), lastActivityAt: i.lastActivityAt || now }))
    const t = (await $.store.get('timer')) as PortalTimer | undefined
    if (t && typeof t === 'object' && t.entryId) await update($, timerA, () => ({ ...t, busy: false, error: null }))
  } catch (_) { /* preferences are a convenience */ }
}

async function setPrefs($: EngineInterface, patch: Partial<PortalPrefs>): Promise<void> {
  const prefs = await update($, prefsA, (p) => ({ ...p, ...patch }))
  try { await $.store.set('prefs', prefs) } catch (_) { /* the session value still applies */ }
}

async function setContinueMode($: EngineInterface, on: boolean): Promise<void> {
  await update($, idleA, (i) => ({ ...i, continueMode: on, nudges: 0 }))
  try {
    const sid = await $.session.id()
    const cont = ((await $.store.get('continue')) as Record<string, number> | undefined) || {}
    const now = await $.clock.now()
    const keep = Object.fromEntries(Object.entries(cont).filter(([, at]) => now - at < 14 * 86_400_000))
    if (on) keep[sid] = now; else delete keep[sid]
    await $.store.set('continue', keep)
  } catch (_) { /* the session value still applies */ }
}

async function dataEnv($: EngineInterface): Promise<Record<string, string>> {
  // The hooks run with CLAUDE_PLUGIN_DATA = ~/.claude/plugins/data/<plugin>-<marketplace>; the
  // status command must read the SAME canon home, so it is derived from where this plugin is
  // installed. When it cannot be derived, canon-lib's own discovery (newest sessions/) decides.
  try {
    const root = String($.plugin.root || '')
    const m = /^(.*[\\/]plugins)[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/][^\\/]+[\\/]?$/.exec(root)
    let dir: string | null = null
    if (m) dir = `${m[1]}/data/${m[3]}-${m[2]}`
    else {
      const cfg = (await $.env.get('CLAUDE_CONFIG_DIR')) || (((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '') + '/.claude')
      if (cfg && cfg !== '/.claude') dir = `${cfg}/plugins/data/${$.plugin.name}-inline`
    }
    if (dir && (await $.fs.exists(dir + '/canon'))) return { CLAUDE_PLUGIN_DATA: dir }
  } catch (_) { /* fall through to discovery */ }
  return {}
}

/** One snapshot at a time; a caller that arrives mid-read waits for THAT read. */
function refreshCanon($: EngineInterface): Promise<void> {
  if (!canonInFlight) canonInFlight = readCanon($).finally(() => { canonInFlight = null })
  return canonInFlight
}

async function readCanon($: EngineInterface): Promise<void> {
  try {
    const sid = await $.session.id()
    const cwd = await $.session.cwd()
    const env = await dataEnv($)
    const r = await $.process.run(
      ['node', `${$.plugin.root}/scripts/canon-gate.js`, 'status', '--json', '--session', sid, '--cwd', cwd],
      { env, timeoutMs: 8000 },
    )
    const nextS: CanonStatus | null = parseCanonStatus(r.stdout)
    if (!nextS) {
      $.ui.log('canon status unreadable (exit ' + r.exitCode + '): ' + String(r.stderr || r.stdout || '').slice(0, 200), { to: 'debug' })
      return
    }
    const before = await read($, canonA)
    const beforeOwed = JSON.stringify(owedNow(before))
    await update($, canonA, () => nextS)
    // Something new is owed: the band comes back even if it was hidden for the last debt.
    if (JSON.stringify(owedNow(nextS)) !== beforeOwed) await update($, bandA, () => ({ hidden: false, asked: '' }))
    // A new run or a new project: the plan follows it.
    const pid = nextS.run && nextS.run.project_id
    const c = await read($, cockpitA)
    if (pid && pid !== c.projectId && !c.loading) void loadPlan($, null, false)
    await pushStatus($)
    if (++doctorTick % 3 === 1) void refreshGates($)
  } catch (err) {
    // node missing or the status command failed: the status line simply stays as it was.
    $.ui.log('canon status failed: ' + String((err as Error)?.message || err).slice(0, 200), { to: 'debug' })
  }
}

async function refreshGates($: EngineInterface): Promise<void> {
  try {
    const env = await dataEnv($)
    const cwd = await $.session.cwd()
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/canon-gate.js`, 'doctor'], { env, cwd, timeoutMs: 8000 })
    const rows = parseDoctor(r.stdout)
    if (rows.length) await update($, gatesA, (g) => ({ ...g, rows }))
  } catch (_) { /* the status snapshot's stood-down list still draws */ }
}

async function gateAction($: EngineInterface, action: 'stand-down' | 're-arm', gate: string): Promise<void> {
  const g = await read($, gatesA)
  if (g.busy) return
  const reason = g.reason.trim()
  if (action === 'stand-down' && !reason) { $.ui.toast('Type a reason first — a stand-down needs one'); return }
  await update($, gatesA, (x) => ({ ...x, busy: `${action} ${gate}…` }))
  let last = ''
  try {
    const env = await dataEnv($)
    const argv = ['node', `${$.plugin.root}/scripts/canon-gate.js`, action, '--gate', gate]
    if (action === 'stand-down') argv.push('--reason', `${reason} (cockpit, by the person)`)
    const r = await $.process.run(argv, { env, timeoutMs: 8000 })
    last = String(r.stdout || r.stderr || '').trim().split(/\r?\n/).slice(0, 3).join(' ')
    $.ui.toast(clip(last || `${action} ${gate}: exit ${r.exitCode}`, 160))
  } catch (err) {
    last = `${action} failed: ${String((err as Error)?.message || err).slice(0, 120)}`
    $.ui.toast(last)
  }
  await update($, gatesA, (x) => ({ ...x, busy: null, last, reason: action === 'stand-down' ? '' : x.reason }))
  await refreshCanon($)
  await refreshGates($)
}

async function pushStatus($: EngineInterface): Promise<void> {
  const s = await read($, canonA)
  const plan = planOf(await read($, cockpitA), await $.clock.now())
  const line = statusLine(s, plan)
  if (line !== lastStatus) { lastStatus = line; $.ui.status(line) }
  // The first message's run context changes only with the run or its phase.
  const key = [s?.run?.id, s?.run?.state, plan?.current, plan?.phases.length].join('|')
  if (key !== lastContextKey) { lastContextKey = key; try { $.ui.invalidate('prompt.context') } catch (_) { /* fine */ } }
}

/** Candidate servers, best first, each with how it was found. */
async function candidates($: EngineInterface): Promise<{ name: string; how: string }[]> {
  const out: { name: string; how: string }[] = []
  const add = (name: string | null | undefined, how: string) => { if (name && !out.some((c) => c.name === name)) out.push({ name, how }) }
  add(goodServer, 'worked before in this session')
  for (const o of observed) add(o, 'Claude\'s portal calls ran on it')
  try {
    const own = await $.mcp.connect('management-portal')
    if (own && own.isConnected && own.server) add(String(own.server), 'the plugin\'s own server')
  } catch (_) { /* not connected or not ours */ }
  try {
    const all = await $.tool.list()
    for (const s of portalServersFrom(all.map((t) => t.name), $.plugin.name)) add(s, 'its tools carry the portal signature')
  } catch (_) { /* tool list unavailable */ }
  try {
    // With tool search on, $.tool.list() answers only the tools loaded into the prompt; the
    // context breakdown lists every MCP tool, loaded or deferred, with the server's /mcp name.
    const usage = await $.session.usage({ breakdown: 'summary' })
    const rows = (usage.context.breakdown && usage.context.breakdown.mcpTools) || []
    for (const s of portalServersFromBreakdown(rows, $.plugin.name)) add(s, 'its tools carry the portal signature (context)')
  } catch (_) { /* breakdown unavailable */ }
  return out
}

/** A portal READ (or a timer press) through whichever server answers. */
async function portalCall($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<{ text: string; server: string }> {
  const cands = await candidates($)
  const tried: string[] = []
  let last = 'no portal MCP server reachable from the mod in this session'
  for (const c of cands) {
    tried.push(c.name)
    try {
      const res = await $.mcp.call(c.name, tool, args)
      const text = resultText(res)
      if (res && res.isError) {
        last = `${c.name}: ${text.slice(0, 120) || 'error'}`
        // The server answered: it IS the portal, the call itself failed. Do not try the others.
        if (!/unknown tool|not found|no such tool|not connected|needs? auth|unauthori[sz]ed|401|403/i.test(text)) {
          goodServer = c.name
          throw new Error(last)
        }
        continue
      }
      if (goodServer !== c.name) {
        goodServer = c.name
        try { await $.store.set('server', c.name) } catch (_) { /* fine */ }
      }
      const now = await $.clock.now()
      const cur = await read($, serverA)
      if (cur.name !== c.name || cur.error) await update($, serverA, () => ({ name: c.name, how: c.how, tried, error: null, at: now }))
      return { text, server: c.name }
    } catch (err) {
      last = String((err as Error)?.message || err).slice(0, 160)
      if (goodServer === c.name && /: /.test(last)) break
    }
  }
  const now = await $.clock.now()
  await update($, serverA, (s) => ({ ...s, tried, error: last, at: now, how: cands.length ? s.how : 'no candidate found yet' }))
  throw new Error(last)
}

async function resolveProject($: EngineInterface, explicit: string | null): Promise<string | null> {
  if (explicit) return explicit
  const c = await read($, cockpitA)
  const s = await read($, canonA)
  const fromRun = s && s.run && s.run.project_id
  if (fromRun) return fromRun
  if (c.projectId) return c.projectId
  try { const last = (await $.store.get('lastProject')) as string | undefined; if (last && UUID_RE.test(last)) return last } catch (_) { /* fine */ }
  return null
}

/** Proposal → tasks → each task's subtasks. One load at a time; a write queues one more. */
function loadPlan($: EngineInterface, explicit: string | null, asked: boolean): Promise<void> {
  if (planInFlight) { planReloadQueued = true; return planInFlight }
  planInFlight = doLoadPlan($, explicit, asked).finally(() => {
    planInFlight = null
    if (planReloadQueued) { planReloadQueued = false; void loadPlan($, null, false) }
  })
  return planInFlight
}

async function doLoadPlan($: EngineInterface, explicit: string | null, asked: boolean): Promise<void> {
  const projectId = await resolveProject($, explicit)
  if (!projectId) { await update($, cockpitA, (c) => ({ ...c, loading: false, projectId: null })); return }
  await update($, cockpitA, (c) => ({ ...c, loading: true, error: null, projectId }))
  try {
    const prop = await portalCall($, 'get_proposal_detail', { project_id: projectId })
    const proposal = parseProposalDetail(prop.text)
    const tl = await portalCall($, 'list_tasks', { project_id: projectId, limit: 50 })
    const tasks: TaskRow[] = parseTasks(tl.text)
    // Subtasks, four at a time; one that fails leaves that task without a subtask count.
    const withId = tasks.filter((t) => t.id).slice(0, 30)
    for (let i = 0; i < withId.length; i += 4) {
      await Promise.all(withId.slice(i, i + 4).map(async (t) => {
        try { t.subtasks = parseSubtasks((await portalCall($, 'list_subtasks', { parent_task_id: t.id })).text).rows } catch (_) { t.subtasks = null }
      }))
    }
    const now = await $.clock.now()
    await update($, cockpitA, () => ({ loading: false, error: proposal ? null : 'no proposal for this project yet', projectId, proposal, tasks, server: prop.server, via: 'mcp' as const, at: now }))
    try { await $.store.set('lastProject', projectId) } catch (_) { /* fine */ }
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 160)
    await update($, cockpitA, (c) => ({ ...c, loading: false, error: c.proposal ? null : (asked ? 'portal read failed: ' : 'waiting for a portal server: ') + msg }))
  }
  await pushStatus($)
}

async function maybeAutoOpen($: EngineInterface): Promise<void> {
  try {
    const prefs = await read($, prefsA)
    const c = await read($, cockpitA)
    if (autoOpened || !prefs.autoOpen || !c.projectId) return
    const surfaces = await $.session.surfaces()
    if (!surfaces.some((s) => s === 'desktop')) return
    autoOpened = true
    // Unasked: the engine places it only where it fits as a sidebar (a wide Desktop window).
    await $.ui.open({ id: PANE, title: 'Portal cockpit' })
  } catch (_) { /* convenience */ }
}

/** Everything the mod learns from the portal results Claude itself read. */
async function observeResult($: EngineInterface, e: PostEvent): Promise<void> {
  const name = String(e.tool_name || '')
  const p = splitMcpName(name)
  if (!p) return
  const input = (e.tool_input || {}) as Record<string, unknown>
  const text = resultText(e.tool_response)
  // Only a server that answers portal-only tools is remembered as the portal.
  const portalish = looksLikePortal(p.server, observed) || ['get_proposal_detail', 'list_flow_connections', 'await_my_turn', 'list_subtasks', 'get_task', 'list_tasks', 'whoami'].includes(p.tool)
  if (!portalish) return
  const serverName = (e.mcp_server && e.mcp_server.name) || p.server
  for (const n of [serverName, p.server]) if (n && !observed.includes(n)) observed = [...observed, n]
  try { await $.store.set('server', serverName) } catch (_) { /* fine */ }
  if (p.tool === 'start_watching_channel' || p.tool === 'await_my_turn') {
    const ch = typeof input.channel_id === 'string' ? input.channel_id : null
    const ag = typeof input.as_agent === 'string' ? input.as_agent : typeof input.agent_name === 'string' ? input.agent_name : null
    if (ch && ag) await rememberWatch($, ch, ag)
  }
  const now = await $.clock.now()
  const c = await read($, cockpitA)
  const pid = typeof input.project_id === 'string' ? input.project_id : null
  if ((p.tool === 'get_proposal_detail' || p.tool === 'list_milestones') && pid && (!c.projectId || c.projectId === pid)) {
    const proposal = parseProposalDetail(text)
    if (proposal) await update($, cockpitA, (x) => ({ ...x, projectId: pid, proposal, via: (x.via === 'mcp' && x.at > now - 60_000 ? 'mcp' : 'observed') as PortalCockpit['via'], at: now, error: null, loading: false }))
  } else if (p.tool === 'list_tasks' && pid && (!c.projectId || c.projectId === pid) && !input.status) {
    const tasks = parseTasks(text)
    if (tasks.length) await update($, cockpitA, (x) => {
      const old = new Map((x.tasks || []).map((t) => [t.id, t.subtasks]))
      return { ...x, projectId: pid, tasks: tasks.map((t) => ({ ...t, subtasks: old.get(t.id) ?? null })), at: now }
    })
  } else if (p.tool === 'list_subtasks') {
    const sub = parseSubtasks(text)
    const parent = sub.parent || (typeof input.parent_task_id === 'string' ? input.parent_task_id : null)
    if (parent && c.tasks && c.tasks.some((t) => t.id === parent)) {
      await update($, cockpitA, (x) => ({ ...x, tasks: (x.tasks || []).map((t) => (t.id === parent ? { ...t, subtasks: sub.rows } : t)) }))
    }
  } else if (p.tool === 'interpret_knowledge_graph') {
    const kg: KgView | null = parseKgInterpretation(text, typeof input.graph_id === 'string' ? input.graph_id : null, now)
    if (kg) {
      await update($, kgA, () => kg)
      $.ui.toast(`Graph read: ${kg.hubs.length} hub(s), ${kg.gaps.length} gap(s) — /portal-cockpit graph`)
    }
  } else if (p.tool === 'read_board') {
    const b: BoardView | null = parseBoard(text, typeof input.board_id === 'string' ? input.board_id : null, now)
    if (b) await update($, boardA, () => b)
  } else if (p.tool === 'create_board') {
    const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text)
    const title = typeof input.title === 'string' ? input.title : 'new board'
    await update($, boardA, () => ({ id: id ? (id[1] ?? null) : null, title, blocks: [], at: now }))
  } else if (p.tool === 'start_timer') {
    const entryId = parseTimerEntry(text)
    if (entryId) await saveTimer($, { entryId, taskId: typeof input.task_id === 'string' ? input.task_id : null, taskTitle: String(input.description || input.task_id || 'timer'), startedAt: now, busy: false, error: null })
  } else if (p.tool === 'stop_timer') {
    const t = await read($, timerA)
    if (t && t.entryId && input.entry_id === t.entryId) await saveTimer($, null)
  }
  // A write moves the plan: reload it (debounced by the single-flight loader) and the canon.
  if (PORTAL_WRITES.test(p.tool)) {
    $.clock.after(1500, () => { void loadPlan($, null, false) })
    $.clock.after(400, () => { void refreshCanon($) })
  }
}

async function saveTimer($: EngineInterface, t: PortalTimer | null): Promise<void> {
  await update($, timerA, () => t)
  try { if (t && t.entryId) await $.store.set('timer', t); else await $.store.delete('timer') } catch (_) { /* fine */ }
}

async function startTimer($: EngineInterface, taskId: string, taskTitle: string): Promise<void> {
  const cur = await read($, timerA)
  if (cur && cur.busy) return
  await update($, timerA, () => ({ entryId: null, taskId, taskTitle, startedAt: 0, busy: true, error: null }))
  try {
    const c = await read($, cockpitA)
    const args: Record<string, unknown> = { task_id: taskId, description: taskTitle }
    if (c.projectId) args.project_id = c.projectId
    const r = await portalCall($, 'start_timer', args)
    const entryId = parseTimerEntry(r.text)
    if (!entryId) throw new Error(clip(r.text, 80) || 'no entry id in the answer')
    await saveTimer($, { entryId, taskId, taskTitle, startedAt: await $.clock.now(), busy: false, error: null })
    $.ui.toast(`Timer started on ${clip(taskTitle, 60)}`)
  } catch (err) {
    await update($, timerA, () => ({ entryId: null, taskId, taskTitle, startedAt: 0, busy: false, error: String((err as Error)?.message || err).slice(0, 80) }))
  }
}

async function stopTimer($: EngineInterface): Promise<void> {
  const t = await read($, timerA)
  if (!t || !t.entryId || t.busy) return
  await update($, timerA, (x) => (x ? { ...x, busy: true } : x))
  try {
    const r = await portalCall($, 'stop_timer', { entry_id: t.entryId })
    $.ui.toast(clip(r.text.replace(/^✅\s*/, ''), 100) || 'Timer stopped')
    await saveTimer($, null)
  } catch (err) {
    await update($, timerA, (x) => (x ? { ...x, busy: false, error: String((err as Error)?.message || err).slice(0, 80) } : x))
  }
}

async function rememberWatch($: EngineInterface, channelId: string, agent: string): Promise<void> {
  const cur = await read($, watchA)
  if (cur && cur.channelId === channelId && cur.agent === agent) return
  const w: PortalWatch = { channelId, agent, since: null, seen: [], lastPollAt: 0, lastError: null }
  await update($, watchA, () => w)
  try { await $.store.set('watch', w) } catch (_) { /* the session value still applies */ }
}

/** Team Chat wake-up. The first poll of a watch only sets the baseline, so history never wakes. */
async function pollWatch($: EngineInterface): Promise<void> {
  const w = await read($, watchA)
  const prefs = await read($, prefsA)
  if (!w || !prefs.watch || watchBusy) return
  watchBusy = true
  try {
    // No as_agent: an unattributed read is delivered the channel charter in FULL and records
    // nothing, so this poll can never consume the agent's own first delivery of the policy.
    const args: Record<string, unknown> = { channel_id: w.channelId, limit: 20 }
    if (w.since) args.since = w.since.replace(' ', 'T')
    const { text } = await portalCall($, 'read_channel_messages', args)
    const msgs: ChatMessage[] = parseMessages(text)
    const baseline = w.since === null
    const seen = new Set(w.seen)
    let wake: ChatMessage | null = null
    for (const m of msgs) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      if (!baseline && !wake && addresses(m, w.agent)) wake = m
    }
    const newest = msgs.length ? msgs[msgs.length - 1]!.at : w.since
    const nw: PortalWatch = { ...w, since: newest || w.since || '1970-01-01 00:00:00', seen: [...seen].slice(-200), lastPollAt: await $.clock.now(), lastError: null }
    await update($, watchA, () => nw)
    try { await $.store.set('watch', nw) } catch (_) { /* fine */ }
    if (wake) {
      $.ui.toast(`Team Chat: ${wake.sender} addressed ${w.agent}`)
      void $.prompt.submit({ text: wakePrompt(w.channelId, w.agent, wake) })
    }
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 80)
    await update($, watchA, (cur) => (cur ? { ...cur, lastError: msg } : cur))
  } finally {
    watchBusy = false
  }
}

/** Notifications: new unread DMs, unread inbox mail, approvals waiting, tasks due. Toasts carry
 *  labels only (a sender's name, a subject) — never a message body. The first poll ever is a
 *  silent baseline, so a backlog never floods the screen. */
async function pollNotify($: EngineInterface): Promise<void> {
  const prefs = await read($, prefsA)
  if (!prefs.notify || notifyBusy) return
  notifyBusy = true
  try {
    const now = await $.clock.now()
    const safe = async (tool: string, args: Record<string, unknown>) => { try { return (await portalCall($, tool, args)).text } catch (_) { return '' } }
    const dmText = await safe('read_dm_conversations', {})
    if (!dmText && !goodServer) throw new Error('no portal server reached yet')
    const inboxText = await safe('read_inbox', { limit: 10 })
    const apText = await safe('list_scheduling_requests', {})
    const c = await read($, cockpitA)
    const due = dueTasks(c.tasks, todayOf(now)).map((t) => ({ id: t.id, title: t.title, due: t.due }))
    const seen = ((await $.store.get('notifySeen')) as string[] | undefined) || null
    const fresh = newNotes({ dms: parseDmConversations(dmText), inbox: parseInbox(inboxText), approvals: parseSchedulingRequests(apText), due }, seen || [], now)
    if (seen === null) {
      // Baseline: remember everything current, announce nothing.
      await $.store.set('notifySeen', fresh.map((n) => n.id).slice(-400))
    } else if (fresh.length) {
      await $.store.set('notifySeen', [...seen, ...fresh.map((n) => n.id)].slice(-400))
      fresh.slice(0, 3).forEach((n) => $.ui.toast(n.text, { timeoutMs: 8000 }))
      if (fresh.length > 3) $.ui.toast(`+${fresh.length - 3} more — /portal-cockpit settings`)
    }
    await update($, notifyA, (x) => ({ items: [...x.items, ...(seen === null ? [] : fresh)].slice(-40), lastPollAt: now, error: null }))
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 100)
    await update($, notifyA, (x) => ({ ...x, error: msg }))
  } finally {
    notifyBusy = false
  }
}

async function backgroundBusy($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  for (const [id, at] of bg) if (now - at > BG_MAX_MS) bg.delete(id)
  if (bg.size) return true
  try {
    const agents = await $.agent.list()
    return agents.some((a) => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  } catch (_) { return false }
}

/** The idle-run nudge: toast first, a countdown in the band, then one "continue" prompt. */
async function idleTick($: EngineInterface): Promise<void> {
  try {
    const prefs = await read($, prefsA)
    const idle = await read($, idleA)
    if (prefs.nudge === 'off' && !idle.pendingSince) return
    const s = await read($, canonA)
    const now = await $.clock.now()
    const plan = planOf(await read($, cockpitA), now)
    const verdict = nudgeDecision({ now, prefs, idle, canon: s, plan, busy: await backgroundBusy($), progressMark: progressMark(s, plan) })
    if (verdict.act === 'warn') {
      await update($, idleA, (i) => ({ ...i, pendingSince: now }))
      $.ui.toast(`Portal run idle ${prefs.nudgeMinutes} min — Claude continues it in 60s. "Not now" in the band cancels.`, { timeoutMs: 10_000 })
    } else if (verdict.act === 'nudge') {
      await fireNudge($)
    } else if (verdict.act === 'cancel') {
      await update($, idleA, (i) => ({ ...i, pendingSince: 0 }))
    }
  } catch (_) { /* a missed tick is harmless */ }
}

async function fireNudge($: EngineInterface): Promise<void> {
  const s = await read($, canonA)
  const prefs = await read($, prefsA)
  const now = await $.clock.now()
  const plan = planOf(await read($, cockpitA), now)
  const mark = progressMark(s, plan)
  await update($, idleA, (i) => ({ ...i, pendingSince: 0, lastActivityAt: now, lastNudgeAt: now,
    nudges: i.progressMark === mark ? i.nudges + 1 : 1, progressMark: mark }))
  $.ui.toast('Continuing the portal run (idle-run nudge)')
  void $.prompt.submit({ text: nudgePrompt(s, plan, prefs.nudgeMinutes) })
}

async function snoozeNudge($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, idleA, (i) => ({ ...i, pendingSince: 0, lastActivityAt: now }))
  $.ui.toast('Idle-run nudge snoozed')
}

// =========================================================================================
// The command launcher — a button for every command the plugin ships, chosen by preset
// =========================================================================================

const MOD_COMMANDS: CommandInfo[] = [
  { name: 'portal-cockpit', description: 'Open the run cockpit: plan, phases, milestones, tasks with progress bars, done vs remaining.', argumentHint: '[project-id | gates | graph | board | settings]', needsArgs: false, source: 'mod' },
  { name: 'portal-gates', description: 'Open the gate control panel: every canon gate armed or stood down, with re-arm and stand-down buttons.', argumentHint: null, needsArgs: false, source: 'mod' },
]

/** Reads commands/*.md from the plugin itself, so a new command shows up with no change here. */
async function loadCommands($: EngineInterface): Promise<void> {
  const list: CommandInfo[] = []
  try {
    const dir = `${$.plugin.root}/commands`
    const entries = await $.fs.list(dir)
    for (const en of entries.filter((x) => x.kind === 'file' && /\.md$/i.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const c = parseCommandFile(en.name, await $.fs.read(`${dir}/${en.name}`))
        if (c) list.push(c)
      } catch (_) { /* one unreadable file does not hide the rest */ }
    }
  } catch (_) { /* no commands folder: the mod's own commands still show */ }
  for (const m of MOD_COMMANDS) if (!list.some((c) => c.name === m.name)) list.push(m)
  let saved: { presets?: Record<string, string[]>; active?: string } | undefined
  try { saved = (await $.store.get('launcher')) as typeof saved } catch (_) { /* fine */ }
  await update($, launcherA, (l) => ({
    ...l, list,
    presets: saved && saved.presets && typeof saved.presets === 'object' ? saved.presets : l.presets,
    active: saved && typeof saved.active === 'string' ? saved.active : l.active,
  }))
}

async function saveLauncher($: EngineInterface, l: PortalLauncher): Promise<void> {
  try { await $.store.set('launcher', { presets: l.presets, active: l.active }) } catch (_) { /* the session value still applies */ }
}

/** Runs a command as if typed. Plugin commands are tried by their plain and their namespaced
 *  name; when the engine will not run it from a mod, the command is put in the prompt box. */
async function runCommand($: EngineInterface, c: CommandInfo, args: string): Promise<void> {
  const a = String(args || '').trim()
  let how = ''
  for (const name of c.source === 'plugin' ? [c.name, `${$.plugin.name}:${c.name}`] : [c.name]) {
    try {
      await $.command.run({ command: name, args: a })
      how = `ran /${name}${a ? ' ' + a : ''}`
      break
    } catch (_) { /* try the next spelling */ }
  }
  if (!how) {
    try {
      await $.prompt.fill({ text: `/${c.name}${a ? ' ' + a : ' '}` })
      how = `/${c.name} is in the prompt box — press Enter to run it`
    } catch (_) { how = `could not run /${c.name}` }
  }
  $.ui.toast(how)
  await update($, launcherA, (l) => ({ ...l, form: null, last: how }))
}

async function commandsBody($: EngineInterface, els: Els, cols: number, desktop: boolean): Promise<RenderNode> {
  const { Box, Text, Button } = els
  const l = await read($, launcherA)
  const out: RenderNode[] = []
  if (!l.list) {
    return <Box key="cmds" flexDirection="column"><Text key="c-wait" dimColor>reading the plugin's commands…</Text></Box>
  }
  const list = l.list
  const all = { ...builtinPresets(list), ...l.presets }
  const presetNames = [...BUILTIN_PRESETS, ...Object.keys(l.presets).filter((n) => !BUILTIN_PRESETS.includes(n)).sort()]
  const active = all[l.active] ? l.active : PRESET_RUN
  // The preset picker.
  if (els.Select) {
    out.push(<els.Select key="preset" label="Preset" value={active} options={presetNames.map((n) => ({ value: n, label: `${n} (${(all[n] || []).length})` }))}
      onSelect={(v: string) => { void update($, launcherA, (x) => ({ ...x, active: v, editing: null, form: null })).then((x) => saveLauncher($, x)) }} />)
  } else {
    out.push(<Box key="preset" flexDirection="row" columnGap={1}>{presetNames.map((n) => (
      <Button key={'preset-' + n} label={n === active ? `[${n}]` : n} plain onPress={() => { void update($, launcherA, (x) => ({ ...x, active: n, editing: null, form: null })).then((x) => saveLauncher($, x)) }} />
    ))}</Box>)
  }
  if (l.editing) {
    // Choosing which commands show, and saving the choice as a named preset.
    const chosen = new Set(l.editing)
    out.push(<Text key="e-h" bold>{`CHOOSE COMMANDS · ${chosen.size} of ${list.length} selected`}</Text>)
    list.forEach((c) => out.push(
      <Box key={'pick-row-' + c.name} flexDirection="row" columnGap={1}>
        <Button key={'pick-' + c.name} label={`${chosen.has(c.name) ? '☑' : '☐'} /${c.name}`} plain onPress={() => {
          void update($, launcherA, (x) => {
            const ed = x.editing || []
            return { ...x, editing: ed.includes(c.name) ? ed.filter((n) => n !== c.name) : [...ed, c.name] }
          })
        }} />
        <Text key={'pick-d-' + c.name} dimColor wrap="truncate-end">{clip(c.description, Math.max(10, cols - c.name.length - 8))}</Text>
      </Box>,
    ))
    if (els.Input) {
      out.push(<els.Input key="preset-name" label="Preset name" placeholder="e.g. My run" value={l.presetName}
        onInput={(v: string) => { void update($, launcherA, (x) => ({ ...x, presetName: String(v || '') })) }}
        onSubmit={(v: string) => { void savePreset($, String(v || '')) }} submitLabel="save" />)
    }
    out.push(
      <Box key="e-acts" flexDirection="row" columnGap={1}>
        <Button key="save-preset" label="Save preset" variant="primary" onPress={() => { void savePreset($, null) }} />
        <Button key="cancel-edit" label="Cancel" onPress={() => { void update($, launcherA, (x) => ({ ...x, editing: null })) }} />
        {!BUILTIN_PRESETS.includes(active) ? <Button key="delete-preset" label={`Delete "${active}"`} onPress={() => { void deletePreset($, active) }} /> : null}
      </Box>,
    )
    out.push(<Text key="e-help" dimColor wrap="wrap">{`Run, Team Chat and All are built in. Saving under a new name adds a preset; saving under "${active}" ${BUILTIN_PRESETS.includes(active) ? 'is not allowed (built in)' : 'replaces it'}. Presets are kept across sessions.`}</Text>)
    return <Box key="cmds" flexDirection="column">{out}</Box>
  }
  if (l.form) {
    const c = list.find((x) => x.name === l.form!.name)
    if (c) {
      out.push(<Text key="f-h" bold>{`/${c.name}  ${c.argumentHint || ''}`}</Text>)
      out.push(<Text key="f-d" dimColor wrap="wrap">{c.description}</Text>)
      if (els.Input) {
        out.push(<els.Input key="cmd-args" label="Arguments" placeholder={c.argumentHint || ''} value={l.form.args} autoFocus
          onInput={(v: string) => { void update($, launcherA, (x) => ({ ...x, form: x.form ? { ...x.form, args: String(v || '') } : x.form })) }}
          onSubmit={(v: string) => { if (c.needsArgs && !String(v || '').trim()) { $.ui.toast(`/${c.name} needs ${c.argumentHint}`); return } void runCommand($, c, String(v || '')) }} submitLabel="run" />)
      }
      out.push(
        <Box key="f-acts" flexDirection="row" columnGap={1}>
          <Button key="run-form" label={`Run /${c.name}`} variant="primary" onPress={() => {
            const args = l.form ? l.form.args : ''
            if (c.needsArgs && !args.trim()) { $.ui.toast(`/${c.name} needs ${c.argumentHint}`); return }
            void runCommand($, c, args)
          }} />
          <Button key="cancel-form" label="Cancel" onPress={() => { void update($, launcherA, (x) => ({ ...x, form: null })) }} />
        </Box>,
      )
      return <Box key="cmds" flexDirection="column">{out}</Box>
    }
  }
  const shown = presetCommands(list, l.presets, active)
  out.push(<Text key="c-h" bold>{`COMMANDS · ${active} · ${shown.length} shown`}</Text>)
  shown.forEach((c) => {
    const open = () => { void update($, launcherA, (x) => ({ ...x, form: { name: c.name, args: '' } })) }
    out.push(
      <Box key={'row-' + c.name} flexDirection="row" columnGap={1}>
        <Button key={'cmd-' + c.name} label={`/${c.name}`} variant={c.name === 'portal-continue' ? 'primary' : 'secondary'}
          onPress={() => { if (c.needsArgs) open(); else void runCommand($, c, '') }} />
        {c.argumentHint && !c.needsArgs ? <Button key={'args-' + c.name} label="…" plain onPress={open} /> : null}
        <Text key={'desc-' + c.name} dimColor wrap="truncate-end">{clip(c.description, Math.max(10, cols - c.name.length - 12))}</Text>
        {desktop ? (
          <Box position="absolute" top={1} left={2} display="none" hover={{ display: 'flex' }} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text key={'tip-t-' + c.name} bold>{`/${c.name}${c.argumentHint ? '  ' + c.argumentHint : ''}`}</Text>
            <Text key={'tip-d-' + c.name} wrap="wrap">{c.description}</Text>
          </Box>
        ) : null}
      </Box>,
    )
  })
  if (!shown.length) out.push(<Text key="c-none" dimColor>This preset shows no commands — press "Choose commands…".</Text>)
  out.push(
    <Box key="c-acts" flexDirection="row" columnGap={1}>
      <Button key="edit-preset" label="Choose commands…" onPress={() => { void update($, launcherA, (x) => ({ ...x, editing: shown.map((c) => c.name), presetName: BUILTIN_PRESETS.includes(active) ? '' : active })) }} />
      <Button key="reload-cmds" label="Reload" onPress={() => { void loadCommands($) }} />
    </Box>,
  )
  if (l.last) out.push(<Text key="c-last" dimColor wrap="truncate-end">{l.last}</Text>)
  return <Box key="cmds" flexDirection="column">{out}</Box>
}

async function savePreset($: EngineInterface, typed: string | null): Promise<void> {
  const l = await read($, launcherA)
  const name = String(typed ?? l.presetName).trim()
  if (!presetNameOk(name)) { $.ui.toast(BUILTIN_PRESETS.includes(name) ? `"${name}" is built in — pick another name` : 'Give the preset a name (letters, digits, spaces, . - _; up to 32)'); return }
  const sel = l.editing || []
  const order = (l.list || []).map((c) => c.name).filter((n) => sel.includes(n))
  const nl = await update($, launcherA, (x) => ({ ...x, presets: { ...x.presets, [name]: order }, active: name, editing: null, presetName: '', last: `saved preset "${name}" (${order.length} commands)` }))
  await saveLauncher($, nl)
  $.ui.toast(`Saved preset "${name}"`)
}

async function deletePreset($: EngineInterface, name: string): Promise<void> {
  if (BUILTIN_PRESETS.includes(name)) return
  const nl = await update($, launcherA, (x) => {
    const presets = { ...x.presets }
    delete presets[name]
    return { ...x, presets, active: PRESET_RUN, editing: null, last: `deleted preset "${name}"` }
  })
  await saveLauncher($, nl)
}
