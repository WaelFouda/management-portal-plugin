// register.tsx — the management-portal MOD (plugin 1.8.0). OPTIONAL EXTRAS, NEVER ENFORCEMENT.
//
// Claude Code >= 2.1.287 loads this module through `hooks/hooks.json` → `modules`. An older
// Claude Code ignores that key and runs the plugin exactly as 1.7.x did. Every gate still
// lives in the COMMAND hooks (scripts/canon-gate.js, scripts/watch-alarm.js): a mod hook that
// throws fails OPEN, so nothing in this file is ever relied on to refuse or block anything.
//
// What it adds, and exactly what it reads (see README "Mods"):
//   (C) a status line: run id, state, armed vs stood-down gates, owed read-backs — from
//       `node scripts/canon-gate.js status --json` (read-only; reuses the gate's own fold).
//   (A) /portal-cockpit: a pane with the run, phases → milestones → task progress (via
//       $.mcp.call get_proposal_detail + list_tasks, READS only), owed read-backs, stood-down gates.
//   (B) a band above the prompt naming what is owed NOW, with a button that SUBMITS A PROMPT
//       asking the model to run the settling read (a mod-made MCP call is not a model tool call,
//       so it could never settle a gate).
//   (D) portal tool results drawn as cards/tables; a "raw" button shows the engine's own row.
//   (E) a Team Chat wake-up: while this session watches a channel, a timer reads it and, when
//       a message addresses this agent, toasts and submits a prompt. The team-chat-watcher
//       subagent stays the documented fallback; the server roster is unchanged by this.
//
// It never writes to the portal and never touches the canon data dir. Its only writes are its
// own $.state values and $.store preferences (rich/band/watch toggles, the watched channel and
// the last-seen message ids).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { CanonStatus, PortalCockpit, PortalPrefs, PortalWatch } from '../../types'
import {
  type Card, type ChatMessage,
  ACTIVE, CARD_TOOLS, addresses, cardFor, glyph, owedNow, parseCanonStatus, parseMessages, parseProposalDetail,
  parseTasks, portalServersFrom, progress, resultText, rowLine, settlePrompt, splitMcpName, statusLine, wakePrompt,
} from './portal-view'

const PANE = 'portal-cockpit'
const CANON_EVERY_MS = 10_000
const WATCH_EVERY_MS = 45_000
const PORTAL_TOOL_RE = /^mcp__.+__[a-z_]+$/

const canonA = atom({ plugin: 'management-portal', key: 'canon' } as const, null)
const cockpitA = atom({ plugin: 'management-portal', key: 'cockpit' } as const,
  { loading: false, at: 0, error: null, proposal: null, tasks: null, server: null })
const prefsA = atom({ plugin: 'management-portal', key: 'prefs' } as const, { rich: true, band: true, watch: true })
const bandA = atom({ plugin: 'management-portal', key: 'band' } as const, { hidden: false, asked: '' })
const rawA = atom({ plugin: 'management-portal', key: 'raw' } as const, [])
const watchA = atom({ plugin: 'management-portal', key: 'watch' } as const, null)

// Caches only — nothing a drawing reads. A fresh environment simply rediscovers them.
let canonInFlight: Promise<void> | null = null
let lastStatus: string | undefined
let servers: string[] = []
let goodServer: string | null = null
let watchBusy = false

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      const saved = (await $.store.get('prefs')) as Partial<PortalPrefs> | undefined
      if (saved && typeof saved === 'object') await update($, prefsA, (p) => ({ ...p, ...saved }))
      const w = (await $.store.get('watch')) as PortalWatch | undefined
      if (w && typeof w === 'object' && w.channelId && w.agent) await update($, watchA, () => ({ ...w, seen: (w.seen || []).slice(-200) }))
    } catch (_) { /* preferences are a convenience */ }
    try {
      await $.command.register({ name: 'portal-cockpit', description: 'Portal run cockpit: run, phases, milestones, tasks, owed read-backs, stood-down gates (management-portal mod)' })
    } catch (_) { /* a name clash must not take the rest of the mod down */ }
    $.clock.every(CANON_EVERY_MS, () => { void refreshCanon($) })
    $.clock.every(WATCH_EVERY_MS, () => { void pollWatch($) })
    $.clock.after(500, () => { void refreshCanon($) })
    return started
  })

  // Observe, never decide. classic.PostToolUse, NOT tool.call: this mod must never sit in the
  // path that decides a call. The chain runs first (the plugin's own command PostToolUse hooks,
  // canon-gate post among them, answer exactly as before); afterwards the canon snapshot is
  // refreshed (debounced) and a Team Chat watch the model started is remembered for (E).
  on('classic.PostToolUse', async ($, e, next) => {
    const answered = await next(e)
    try {
      const name = String(e.tool_name || '')
      const p = splitMcpName(name)
      const input = (e.tool_input || {}) as { channel_id?: unknown; as_agent?: unknown; agent_name?: unknown }
      if (p && (p.tool === 'start_watching_channel' || p.tool === 'await_my_turn')) {
        const ch = typeof input.channel_id === 'string' ? input.channel_id : null
        const ag = typeof input.as_agent === 'string' ? input.as_agent : typeof input.agent_name === 'string' ? input.agent_name : null
        if (ch && ag) await rememberWatch($, ch, ag)
      }
      if (p && ['start_watching_channel', 'await_my_turn', 'get_proposal_detail', 'list_flow_connections'].includes(p.tool)
        && !servers.includes(p.server)) servers = [...servers, p.server]
      if (PORTAL_TOOL_RE.test(name)) $.clock.after(400, () => { void refreshCanon($) })
    } catch (_) { /* observation only */ }
    return answered
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    $.clock.after(300, () => { void refreshCanon($) })
    return done
  })

  on('command.run', { command: 'portal-cockpit' }, async ($, e) => {
    const args = String((e as { args?: string }).args || '').trim().split(/\s+/).filter(Boolean)
    if (args[0] === 'watch' && args[1] && args[2]) {
      await rememberWatch($, args[1], args.slice(2).join(' '))
      return { text: `Team Chat wake-up will poll channel ${args[1]} as ${args.slice(2).join(' ')} every ${WATCH_EVERY_MS / 1000}s.` }
    }
    if (args[0] === 'unwatch') {
      await update($, watchA, () => null)
      await $.store.delete('watch')
      return { text: 'Team Chat wake-up stopped. The team-chat-watcher subagent is unaffected.' }
    }
    if ((args[0] === 'rich' || args[0] === 'band' || args[0] === 'watch') && (args[1] === 'on' || args[1] === 'off')) {
      await setPref($, args[0], args[1] === 'on')
      return { text: `portal mod: ${args[0]} ${args[1]}` }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Portal cockpit' })
    await refreshCanon($)
    await loadCockpit($)
    const placed = opened && typeof opened === 'object' && 'isPlaced' in opened ? (opened as { isPlaced: boolean }).isPlaced : true
    return { text: placed ? 'Portal cockpit opened.' : 'Portal cockpit is open but not placed yet — widen the terminal.' }
  })

  // (A) the cockpit pane.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(30, (e.props.bodyColumns || 80) - 2)
    const s = await read($, canonA)
    const cockpit = await read($, cockpitA)
    const prefs = await read($, prefsA)
    const watch = await read($, watchA)
    const o = owedNow(s)
    const run = s && s.run
    const lines: { key: string; text: string; color?: string; dim?: boolean; bold?: boolean }[] = []
    lines.push({ key: 'h-run', text: 'RUN', bold: true })
    if (!s) lines.push({ key: 'run-none', text: 'reading the canon status…', dim: true })
    else {
      lines.push({ key: 'run', text: run ? `${run.id} · ${run.state} · ${run.mode || 'solo'}${run.project_id ? ' · project ' + run.project_id.slice(0, 8) : ''}` : 'no run declared for this project' })
      if (run && run.tree) lines.push({ key: 'tree', text: `tree: ${run.tree.task || 0} tasks · ${run.tree.subtask || 0} subtasks · ${run.tree.cluster || 0} clusters · ${run.tree.connection || 0} connections`, dim: true })
      lines.push({ key: 'gates', text: `gates ${s.gates.armed}/${s.gates.total} armed${s.mode !== 'on' ? ' · PORTAL_CANON=' + s.mode : ''}` })
      for (const g of s.gates.stood) lines.push({ key: 'sd-' + g.id, text: `  stood down: ${g.id}${g.why ? ' (' + g.why + ')' : ''}`, color: 'yellow' })
      if (s.gates.stood.length) lines.push({ key: 'rearm', text: '  re-arm: /portal-rearm', dim: true })
      lines.push({ key: 'h-owed', text: 'OWED NOW', bold: true })
      if (!o.count && !o.journal && !o.closeout.length) lines.push({ key: 'owed-none', text: 'nothing owed', dim: true })
      if (o.count) lines.push({ key: 'owed', text: `${o.count} read-back(s): ${o.writes.slice(0, 4).join(', ')}${o.writes.length > 4 ? '…' : ''}`, color: 'yellow' })
      if (o.settle) lines.push({ key: 'settle', text: `settle: ${o.settle.length > width * 2 ? o.settle.slice(0, width * 2 - 1) + '…' : o.settle}`, dim: true })
      if (o.journal && s.journal) lines.push({ key: 'journal', text: `journal owed since ${s.journal.boundary}${s.journal.id ? ' ' + s.journal.id.slice(0, 8) : ''} (${!s.journal.wrote ? 'no entry' : 'not read back'})`, color: 'yellow' })
      if (o.closeout.length) lines.push({ key: 'closeout', text: `close-out missing: ${o.closeout.join(', ')}`, color: 'yellow' })
    }
    lines.push({ key: 'h-plan', text: 'PLAN', bold: true })
    if (cockpit.loading) lines.push({ key: 'plan-loading', text: 'reading the portal…', dim: true })
    else if (cockpit.error) lines.push({ key: 'plan-err', text: cockpit.error, color: 'red' })
    else if (cockpit.proposal) {
      const p = cockpit.proposal
      const all = progress(p.phases.flatMap((ph) => ph.milestones.map((m) => m.status)))
      lines.push({ key: 'prop', text: `${p.title} · ${p.status || 'draft'} · milestones ${all.done}/${all.total}` })
      p.phases.forEach((ph, i) => {
        const pp = progress(ph.milestones.map((m) => m.status))
        lines.push({ key: 'ph' + i, text: `■ ${ph.name}  ${pp.done}/${pp.total}` })
        ph.milestones.forEach((m, j) => lines.push({ key: `ms${i}-${j}`, text: `   ${glyph(m.status)} ${m.name}  ${m.status}`, dim: /pending|draft/i.test(m.status) }))
      })
    } else lines.push({ key: 'plan-none', text: run && run.project_id ? 'no proposal read yet — press Refresh' : 'no project in the run', dim: true })
    if (cockpit.tasks) {
      const t = cockpit.tasks
      const pr = progress(t.map((x) => x.status))
      lines.push({ key: 'h-tasks', text: `TASKS ${pr.done}/${pr.total} done · ${t.filter((x) => ACTIVE.test(x.status)).length} active`, bold: true })
      t.slice(0, 10).forEach((x, i) => lines.push({ key: 'tk' + i, text: `${glyph(x.status)} ${x.title.length > width - 6 ? x.title.slice(0, width - 7) + '…' : x.title}`, dim: /completed/.test(x.status) }))
      if (t.length > 10) lines.push({ key: 'tk-more', text: `…${t.length - 10} more`, dim: true })
    }
    if (watch) lines.push({ key: 'watch', text: `Team Chat wake-up: ${watch.agent} on ${watch.channelId.slice(0, 8)}${prefs.watch ? '' : ' (paused)'}${watch.lastError ? ' · ' + watch.lastError : ''}`, dim: true })
    lines.push({ key: 'src', text: `source: canon-gate.js status --json · portal via ${cockpit.server || 'not resolved yet'}`, dim: true })
    return (
      <Box key="cockpit" flexDirection="column">
        {lines.map((l) => (
          <Text key={l.key} color={l.color} dimColor={l.dim} bold={l.bold} wrap="truncate-end">{l.text}</Text>
        ))}
        <Box key="buttons" flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => { void refreshCanon($).then(() => loadCockpit($)) }} />
          <Button key="rich" label={prefs.rich ? 'Cards: on' : 'Cards: off'} onPress={() => { void setPref($, 'rich', !prefs.rich) }} />
          <Button key="watch" label={prefs.watch ? 'Chat wake: on' : 'Chat wake: off'} onPress={() => { void setPref($, 'watch', !prefs.watch) }} />
          <Button key="close" label="Close" role="dismiss" onPress={() => { void $.ui.close({ id: PANE }) }} />
        </Box>
      </Box>
    )
  })

  // (B) the gate band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, canonA)
    const prefs = await read($, prefsA)
    const band = await read($, bandA)
    const o = owedNow(s)
    const quiet = !prefs.band || band.hidden || e.props.hasSurvey || (!o.count && !o.journal)
    if (quiet) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(30, (e.props.bodyColumns || 80) - 2)
    const what = o.count
      ? `portal canon owes ${o.count} read-back${o.count === 1 ? '' : 's'}: ${o.writes.slice(0, 3).join(', ')}${o.writes.length > 3 ? '…' : ''}`
      : 'portal canon: a journal entry is owed since the last phase boundary'
    const settle = o.settle
    const asked = settle !== null && band.asked === settle
    return (
      <Box key="portal-band" flexDirection="column">
        <Text key="what" color="yellow" wrap="truncate-end">{what.length > width ? what.slice(0, width - 1) + '…' : what}</Text>
        {settle ? <Text key="call" dimColor wrap="truncate-end">{settle}</Text> : null}
        <Box key="acts" flexDirection="row" gap={1}>
          {settle && !asked ? (
            <Button key="settle" label="Ask Claude to run the settling read" variant="primary" onPress={() => {
              void update($, bandA, (b) => ({ ...b, asked: settle }))
              void $.prompt.submit({ text: settlePrompt(settle) })
              $.ui.toast('Asked Claude to run the settling read')
            }} />
          ) : null}
          {asked ? <Text key="asked" dimColor>asked — waiting for the read</Text> : null}
          <Button key="hide" label="Hide" onPress={() => { void update($, bandA, (b) => ({ ...b, hidden: true })) }} />
        </Box>
      </Box>
    )
  })

  // (D) portal tool results as cards. Anything we do not recognise draws as the engine draws it.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const prefs = await read($, prefsA)
    if (!prefs.rich || e.props.isErrored) return next(e)
    const p = splitMcpName(String(e.props.tool))
    if (!p || !CARD_TOOLS.has(p.tool) || !isPortalServer(p.server)) return next(e)
    const id = String(e.props.tool_use_id || e.requestId || '')
    const rawIds = await read($, rawA)
    const { Box, Text, Button } = $.ui.resolve(e)
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
    return (
      <Box key="card" flexDirection="column">
        <Box key="head" flexDirection="row" gap={1}>
          <Text key="title" bold color="cyan">{card.title}</Text>
          <Text key="sum" dimColor wrap="truncate-end">{card.summary}</Text>
          <Button key="raw" label="raw" plain onPress={() => { void update($, rawA, (l) => [...l.filter((x) => x !== id), id].slice(-100)) }} />
        </Box>
        {card.rows.map((r, i) => (
          <Text key={'r' + i} wrap="truncate-end">{rowLine(r, width)}</Text>
        ))}
        {card.more ? <Text key="more" dimColor>{`…${card.more} more (raw shows all)`}</Text> : null}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Helpers that take `$` — top-level and in this file, as the engine requires.
// ---------------------------------------------------------------------------

function isPortalServer(server: string): boolean {
  if (servers.includes(server)) return true
  // Before discovery has run in this environment, the tool-name prefix is the only evidence:
  // accept the plugin's own spelling and a connector named after the portal.
  return /management-portal/i.test(server)
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

/** One snapshot at a time; a caller that arrives mid-read (the cockpit opened during startup)
 *  waits for THAT read instead of drawing an empty pane. */
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
    const next: CanonStatus | null = parseCanonStatus(r.stdout)
    if (!next) {
      $.ui.log('canon status unreadable (exit ' + r.exitCode + '): ' + String(r.stderr || r.stdout || '').slice(0, 200), { to: 'debug' })
      return
    }
    const before = JSON.stringify(owedNow(await read($, canonA)))
    await update($, canonA, () => next)
    // Something new is owed: the band comes back even if it was hidden for the last debt.
    if (JSON.stringify(owedNow(next)) !== before) await update($, bandA, () => ({ hidden: false, asked: '' }))
    const line = statusLine(next)
    if (line !== lastStatus) { lastStatus = line; $.ui.status(line) }
  } catch (err) {
    // node missing or the status command failed: the status line simply stays as it was.
    $.ui.log('canon status failed: ' + String((err as Error)?.message || err).slice(0, 200), { to: 'debug' })
  }
}

async function discoverServers($: EngineInterface): Promise<string[]> {
  if (servers.length) return servers
  try {
    const own = await $.mcp.connect('management-portal')
    if (own && own.isConnected && own.server) servers = [String(own.server)]
  } catch (_) { /* not connected or not ours */ }
  try {
    const all = await $.tool.list()
    const listed = portalServersFrom(all.map((t) => t.name), $.plugin.name)
    for (const s of listed) if (!servers.includes(s)) servers = [...servers, s]
    $.ui.log(`portal discovery: ${all.filter((t) => t.mcp).length} MCP tools listed; portal servers: ${servers.join(', ') || 'none'}`, { to: 'debug' })
  } catch (_) { /* tool list unavailable */ }
  if (!servers.length) {
    // MEASURED on 2.1.291: with tool search on, $.tool.list() answers only the tools loaded into
    // the prompt (2 MCP tools here), so a deferred portal server is invisible to it. The context
    // breakdown lists every MCP tool, loaded or deferred, and `summary` is estimated locally —
    // no request is sent for it.
    try {
      const usage = await $.session.usage({ breakdown: 'summary' })
      const rows = (usage.context.breakdown && usage.context.breakdown.mcpTools) || []
      const listed = portalServersFrom(rows.map((t) => t.name), $.plugin.name)
      for (const s of listed) if (!servers.includes(s)) servers = [...servers, s]
      $.ui.log(`portal discovery (context breakdown): ${rows.length} MCP tools; portal servers: ${servers.join(', ') || 'none'}`, { to: 'debug' })
    } catch (_) { /* breakdown unavailable */ }
  }
  return servers
}

/** A portal READ through whichever server answers. Never a write: the only tools this mod
 *  ever calls are get_proposal_detail, list_tasks and read_channel_messages. */
async function portalRead($: EngineInterface, tool: 'get_proposal_detail' | 'list_tasks' | 'read_channel_messages', args: Record<string, unknown>): Promise<{ text: string; server: string }> {
  const found = await discoverServers($)
  const cands = goodServer ? [goodServer, ...found.filter((s) => s !== goodServer)] : found
  if (!cands.length) throw new Error('no portal MCP server is connected in this session (sign in via /mcp, or call any portal tool once)')
  let last = 'no answer'
  for (const server of cands) {
    try {
      const res = await $.mcp.call(server, tool, args)
      const text = resultText(res)
      if (res && res.isError) { last = text.slice(0, 120) || 'error'; continue }
      goodServer = server
      return { text, server }
    } catch (err) {
      last = String((err as Error)?.message || err).slice(0, 120)
    }
  }
  throw new Error(last)
}

async function loadCockpit($: EngineInterface): Promise<void> {
  await update($, cockpitA, (c) => ({ ...c, loading: true, error: null }))
  let nextCockpit: PortalCockpit
  try {
    const s = await read($, canonA)
    const projectId = s && s.run && s.run.project_id
    if (!projectId) {
      nextCockpit = { loading: false, error: null, proposal: null, tasks: null, server: null, at: await $.clock.now() }
    } else {
      const prop = await portalRead($, 'get_proposal_detail', { project_id: projectId })
      const tasks = await portalRead($, 'list_tasks', { project_id: projectId, limit: 50 })
      nextCockpit = { loading: false, error: null, proposal: parseProposalDetail(prop.text), tasks: parseTasks(tasks.text),
        server: prop.server, at: await $.clock.now() }
    }
  } catch (err) {
    nextCockpit = { loading: false, error: 'portal read failed: ' + String((err as Error)?.message || err).slice(0, 140),
      proposal: null, tasks: null, server: null, at: 0 }
  }
  await update($, cockpitA, () => nextCockpit)
}

async function setPref($: EngineInterface, key: keyof PortalPrefs, value: boolean): Promise<void> {
  const prefs = await update($, prefsA, (p) => ({ ...p, [key]: value }))
  try { await $.store.set('prefs', prefs) } catch (_) { /* the session value still applies */ }
}

async function rememberWatch($: EngineInterface, channelId: string, agent: string): Promise<void> {
  const cur = await read($, watchA)
  if (cur && cur.channelId === channelId && cur.agent === agent) return
  const w: PortalWatch = { channelId, agent, since: null, seen: [], lastPollAt: 0, lastError: null }
  await update($, watchA, () => w)
  try { await $.store.set('watch', w) } catch (_) { /* the session value still applies */ }
}

/** (E) One poll. The first poll of a watch only sets the baseline, so history never wakes. */
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
    const { text } = await portalRead($, 'read_channel_messages', args)
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
