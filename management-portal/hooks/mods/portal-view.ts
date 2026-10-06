// portal-view.ts — the PURE half of the management-portal mod (1.8.0).
//
// Everything here is plain data in, plain data out: parsing the text the portal's tools
// return, summarising the canon snapshot `canon-gate.js status --json` prints, and deciding
// whether a Team Chat message addresses this agent. No `$`, no I/O, no timers — so it is the
// part the tests can hold exactly, and the part that cannot do anything but describe.

import type { CanonStatus, Milestone, Phase, Proposal, TaskRow } from '../../types'

export type { CanonStatus, Milestone, Phase, Proposal, TaskRow }

/** Parse the LAST JSON line of the status command's stdout; null when it is not one. */
export function parseCanonStatus(stdout: string): CanonStatus | null {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = (lines[i] ?? '').trim()
    if (!l.startsWith('{')) continue
    try {
      const v = JSON.parse(l)
      if (v && typeof v === 'object' && v.v === 1 && v.gates) return v as CanonStatus
    } catch (_) { /* not this line */ }
  }
  return null
}

/** What the canon says is owed NOW: this session's open read-backs, else the carried debt. */
export function owedNow(s: CanonStatus | null): { count: number; writes: string[]; settle: string | null; journal: boolean; closeout: string[] } {
  if (!s) return { count: 0, writes: [], settle: null, journal: false, closeout: [] }
  const session = s.owed || []
  const debtItems = (s.debt && s.debt.items) || []
  const useDebt = !session.length && debtItems.length > 0
  const writes = (useDebt ? debtItems : session).map((o) => o.w)
  const count = useDebt ? (s.debt ? s.debt.reads : 0) : (s.owedTotal ?? session.length)
  const settle = useDebt ? (s.debt && s.debt.settle) || null : s.settle
  const closeout = (s.closeout && s.closeout.length ? s.closeout : (s.debt && s.debt.closeout) || [])
  return { count, writes, settle, journal: Boolean(s.journal && s.journal.owed), closeout }
}

/** The one-line status entry. Short on purpose: the status line is shared with the engine. */
export function statusLine(s: CanonStatus | null): string | undefined {
  if (!s) return undefined
  if (s.mode !== 'on') return `canon ${s.mode}`
  const parts: string[] = []
  parts.push(s.run ? `canon ${s.run.id} ${s.run.state}` : 'canon: no run')
  const down = s.gates.stood.length
  parts.push(`gates ${s.gates.armed}/${s.gates.total} armed` + (down ? ` (${down} stood down)` : ''))
  const o = owedNow(s)
  if (o.count) parts.push(`owes ${o.count} read-back${o.count === 1 ? '' : 's'}`)
  if (o.journal) parts.push('journal owed')
  if (o.closeout.length) parts.push(`close-out: ${o.closeout.length} missing`)
  return parts.join(' · ')
}

/** The prompt the band's button submits. It ASKS for the read: a mod-made $.mcp.call is not a
 *  model tool call, so it could never settle a gate — only the model running the read does. */
export function settlePrompt(settle: string): string {
  return 'The management-portal canon gates show an unsettled read-back. Run this settling read now, '
    + 'exactly as printed, as your next tool call, and confirm the fields you wrote are present in what '
    + 'comes back (a delete is verified by ABSENCE):\n\n' + settle
}

// ---------------------------------------------------------------------------
// Portal server discovery — never hard-coded: the plugin's own server, the claude.ai
// connector and a raw MCP install all register the same tools under different names.
// ---------------------------------------------------------------------------

/** Tools only the portal registers. A server exposing all three is the portal. */
export const PORTAL_SIGNATURE = ['get_proposal_detail', 'list_flow_connections', 'await_my_turn']

export function splitMcpName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const cut = rest.lastIndexOf('__')
  if (cut <= 0) return null
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) }
}

/** Every server spelling (tool-name form) that carries the portal's signature tools, best first:
 *  the plugin's own server, then a claude.ai connector, then anything else. */
export function portalServersFrom(toolNames: readonly string[], pluginName: string): string[] {
  const by = new Map<string, Set<string>>()
  for (const n of toolNames) {
    const p = splitMcpName(n)
    if (!p) continue
    if (!by.has(p.server)) by.set(p.server, new Set())
    by.get(p.server)!.add(p.tool)
  }
  const hits = [...by.entries()].filter(([, tools]) => PORTAL_SIGNATURE.every((t) => tools.has(t))).map(([s]) => s)
  const rank = (s: string) => (s === `plugin_${pluginName}_${pluginName}` || s.startsWith(`plugin_${pluginName}_`) ? 0
    : s.startsWith('claude_ai') ? 1 : 2)
  return hits.sort((a, b) => rank(a) - rank(b))
}

/** Text of an MCP result in any of the shapes it reaches a mod in. */
export function resultText(out: unknown): string {
  if (out == null) return ''
  if (typeof out === 'string') return out
  if (Array.isArray(out)) return out.map((b) => (b && typeof b === 'object' && 'text' in (b as object) ? String((b as { text: unknown }).text ?? '') : typeof b === 'string' ? b : '')).join('\n')
  if (typeof out === 'object') {
    const o = out as Record<string, unknown>
    if (Array.isArray(o.content)) return resultText(o.content)
    if (typeof o.text === 'string') return o.text
    if (o.result !== undefined) return resultText(o.result)
  }
  try { return JSON.stringify(out) } catch (_) { return '' }
}

// ---------------------------------------------------------------------------
// Parsers for the portal's text results
// ---------------------------------------------------------------------------

const RE_ID = /\[id: ([^\]\s]+)\]/

export function parseProposalDetail(text: string): Proposal | null {
  const t = String(text || '')
  const title = /^Proposal: (.*)$/m.exec(t)
  if (!title) return null
  const status = /^Status: (.*)$/m.exec(t)
  const phases: Phase[] = []
  for (const line of t.split(/\r?\n/)) {
    const ph = /^\s{2}Phase: (.*?) \|.*\[([0-9a-f-]{8,})\]\s*$/.exec(line)
    if (ph) { phases.push({ name: (ph[1] ?? '').trim(), id: (ph[2] ?? ''), milestones: [] }); continue }
    const ms = /^\s{4}- (.*?) \|.*status: ([^|]*?) \|.*$/.exec(line)
    if (ms && phases.length) {
      const id = RE_ID.exec(line)
      phases[phases.length - 1]!.milestones.push({ name: (ms[1] ?? '').trim(), status: (ms[2] ?? '').trim() || 'pending', id: (id?.[1] ?? null) })
    }
  }
  return { title: (title[1] ?? '').trim(), status: status ? (status[1] ?? '').trim() : '', phases }
}

export function parseTasks(text: string): TaskRow[] {
  const rows: TaskRow[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^- \[([a-z_]+)\] (.*?)(?: \(priority: ([a-z]+)\))?(?: due: [^|]*)?(?: \|.*)?$/.exec(line.trim())
    if (!m) continue
    const id = RE_ID.exec(line)
    rows.push({ status: (m[1] ?? ''), title: (m[2] ?? '').trim(), priority: (m[3] ?? '') || null, id: (id?.[1] ?? null) })
  }
  return rows
}

export const DONE = /^(completed|complete|done|delivered|approved|paid)$/i
export const ACTIVE = /^(in_progress|active|started|in progress|submitted|review)$/i

export function glyph(status: string): string {
  if (DONE.test(status)) return '✓'
  if (ACTIVE.test(status)) return '▶'
  if (/cancel/i.test(status)) return '✗'
  return '○'
}

export function progress(statuses: string[]): { done: number; total: number } {
  return { done: statuses.filter((s) => DONE.test(s)).length, total: statuses.length }
}

export type ChatMessage = { id: string; sender: string; senderId: string | null; at: string; mentions: string[]; content: string }

/** read_channel_messages lines: `Name (YYYY-MM-DD HH:MM:SS) [id=… | sender_id=… | …]: content` */
export function parseMessages(text: string): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(.+?) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\) \[(.*?)\]: ?(.*)$/.exec(line)
    if (!m) continue
    const bits: Record<string, string> = {}
    for (const b of (m[3] ?? '').split(' | ')) { const k = b.indexOf('='); if (k > 0) bits[b.slice(0, k)] = b.slice(k + 1) }
    if (!bits.id) continue
    out.push({ id: bits.id, sender: (m[1] ?? ''), senderId: bits.sender_id || null, at: (m[2] ?? ''),
      mentions: bits.mentions ? bits.mentions.split(',') : [], content: (m[4] ?? '') })
  }
  return out
}

/** Does this message address `agent`? `@name` (case-insensitive) or `@all`/`@everyone`, never
 *  its own messages. Deliberately narrow: a false wake costs a turn, a missed one costs latency,
 *  and the server-side `await_my_turn` remains the authority. */
export function addresses(m: ChatMessage, agent: string): boolean {
  if (!agent) return false
  const a = agent.trim().toLowerCase()
  if (m.sender.trim().toLowerCase() === a) return false
  const c = m.content.toLowerCase()
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('@' + esc + '(?![\\w-])').test(c) || /@(all|everyone)\b/.test(c)
}

/** Names that reach a prompt are reduced to a safe, short label — the text of a chat message
 *  is never relayed into the model's prompt by the mod (it is untrusted input). */
export function safeLabel(s: string | null | undefined, max = 40): string {
  return String(s || '').replace(/[^\w .@-]/g, '').trim().slice(0, max) || '?'
}

export function wakePrompt(channelId: string, agent: string, msg: ChatMessage): string {
  return `Team Chat: a new message in channel ${channelId} addresses you (${safeLabel(agent)}) — message id `
    + `${msg.id}, from ${safeLabel(msg.sender)}. Read read_channel_policy and read_channel_messages for that `
    + `channel (as_agent: "${safeLabel(agent)}"), answer per the channel policy, then re-arm your watch `
    + '(/rearm-watch) as the team-chat-reachability skill describes.'
}

// ---------------------------------------------------------------------------
// Cards — the rich rendering of a portal tool result (D)
// ---------------------------------------------------------------------------

export type CardRow = { mark: string; text: string; meta?: string; id?: string | null }
export type Card = { title: string; summary: string; rows: CardRow[]; more: number }

const short = (id: string | null | undefined) => (id ? String(id).slice(0, 8) : '')

/** The tools a card exists for. Anything else draws exactly as the engine draws it. */
export const CARD_TOOLS = new Set([
  'list_tasks', 'list_subtasks', 'get_proposal_detail', 'list_milestones', 'list_flow_clusters',
  'list_flow_connections', 'read_channel_messages', 'list_projects', 'list_clients', 'list_boards',
  'list_journals', 'list_knowledge_graphs', 'bulk',
])

export function cardFor(tool: string, text: string, maxRows = 12): Card | null {
  const t = String(text || '')
  if (!t.trim()) return null
  let rows: CardRow[] = []
  let summary = ''
  if (tool === 'get_proposal_detail' || tool === 'list_milestones') {
    const p = parseProposalDetail(t)
    if (!p) return null
    const all = p.phases.flatMap((ph) => ph.milestones.map((m) => m.status))
    const pr = progress(all)
    summary = `${p.title} · ${p.status || 'draft'} · ${p.phases.length} phase(s) · milestones ${pr.done}/${pr.total} done`
    for (const ph of p.phases) {
      const pp = progress(ph.milestones.map((m) => m.status))
      rows.push({ mark: '■', text: ph.name, meta: `${pp.done}/${pp.total}`, id: ph.id })
      for (const m of ph.milestones) rows.push({ mark: '  ' + glyph(m.status), text: m.name, meta: m.status, id: m.id })
    }
  } else if (tool === 'list_tasks' || tool === 'list_subtasks') {
    const tasks = parseTasks(t)
    if (!tasks.length) return null
    const pr = progress(tasks.map((x) => x.status))
    summary = `${tasks.length} task(s) · ${pr.done} done · ${tasks.filter((x) => ACTIVE.test(x.status)).length} active`
    rows = tasks.map((x) => ({ mark: glyph(x.status), text: x.title, meta: [x.status, x.priority].filter(Boolean).join(' · '), id: x.id }))
  } else if (tool === 'read_channel_messages') {
    const msgs = parseMessages(t)
    if (!msgs.length) return null
    summary = `${msgs.length} message(s)` + (/CHANNEL POLICY/.test(t) ? ' · policy attached (see raw)' : '')
    rows = msgs.map((m) => ({ mark: '›', text: `${m.sender}: ${m.content.replace(/\s+/g, ' ').slice(0, 100)}`, meta: m.at.slice(5, 16), id: m.id }))
  } else if (tool === 'bulk') {
    const head = /Ran (\d+)\/(\d+) call\(s\); (\d+) failed/.exec(t)
    if (!head) return null
    summary = `bulk · ran ${(head[1] ?? '')}/${(head[2] ?? '')} · ${(head[3] ?? '')} failed`
    for (const line of t.split(/\r?\n/)) {
      const m = /^\[(\d+)\] ([a-z_]+): ?(.*)$/.exec(line)
      if (m) rows.push({ mark: /^\s*(FAILED|SKIPPED)/.test((m[3] ?? '')) ? '✗' : '✓', text: (m[2] ?? ''), meta: (m[3] ?? '').replace(/\s+/g, ' ').slice(0, 70) })
    }
  } else {
    // A generic portal listing: `Found N x(s):` then `- … [id: …]` rows.
    const found = /^Found (\d+) ([^:]+):/m.exec(t)
    if (!found) return null
    summary = `${(found[1] ?? '')} ${(found[2] ?? '')}`
    for (const line of t.split(/\r?\n/)) {
      if (!/^\s*- /.test(line)) continue
      const id = RE_ID.exec(line)
      const body = line.replace(RE_ID, '').replace(/^\s*- /, '').trim()
      const label = (body.split(' | ')[0] ?? '').replace(/\s+/g, ' ')
      rows.push({ mark: '•', text: label.slice(0, 90), id: (id?.[1] ?? null) })
    }
  }
  const more = Math.max(0, rows.length - maxRows)
  return { title: tool, summary, rows: rows.slice(0, maxRows), more }
}

export function rowLine(r: CardRow, width: number): string {
  const id = r.id ? ` ${short(r.id)}` : ''
  const meta = r.meta ? `  ${r.meta}` : ''
  const room = Math.max(10, width - id.length - meta.length - r.mark.length - 2)
  const text = r.text.length > room ? r.text.slice(0, room - 1) + '…' : r.text
  return `${r.mark} ${text}${meta}${id}`
}
