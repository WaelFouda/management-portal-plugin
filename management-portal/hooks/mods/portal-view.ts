// portal-view.ts — the PURE half of the management-portal mod (1.9.0).
//
// Everything here is plain data in, plain data out: parsing the text the portal's tools
// return, turning a proposal + task tree into a PLAN (phases → milestones → tasks → subtasks,
// done vs remaining, progress, deadlines, hours and cost), summarising the canon snapshot
// `canon-gate.js status --json` prints, drawing progress bars as text or SVG, and deciding
// whether the idle-run nudge or a Team Chat wake-up should fire. No `$`, no I/O, no timers —
// so it is the part the tests can hold exactly, and the part that cannot do anything but describe.

import type {
  BoardBlock, BoardView, CanonStatus, CommandInfo, GateRow, KgView, Milestone, Phase, PortalIdle, PortalNote, PortalPrefs, Proposal,
  SubtaskRow, TaskRow,
} from '../../types'

export type { CanonStatus, GateRow, Milestone, Phase, Proposal, SubtaskRow, TaskRow }

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

/** `canon-gate.js doctor` lists every gate: `    ARMED      CANON-ID` / `    stood down CANON-X  (why)`. */
export function parseDoctor(text: string): GateRow[] {
  const rows: GateRow[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s+(ARMED|stood down)\s+(CANON-[A-Z0-9-]+)(?:\s+\((.*)\))?\s*$/.exec(line)
    if (!m) continue
    rows.push({ id: m[2] ?? '', armed: m[1] === 'ARMED', why: m[3] ? m[3] : null })
  }
  return rows
}

/** Gates from the status snapshot alone (no doctor output yet): the stood-down ones, named. */
export function gatesFromStatus(s: CanonStatus | null): GateRow[] {
  if (!s) return []
  return s.gates.stood.map((g) => ({ id: g.id, armed: false, why: g.why }))
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

/** The prompt the band's button submits. It ASKS for the read: a mod-made $.mcp.call is not a
 *  model tool call, so it could never settle a gate — only the model running the read does. */
export function settlePrompt(settle: string): string {
  return 'The management-portal canon gates show an unsettled read-back. Run this settling read now, '
    + 'exactly as printed, as your next tool call, and confirm the fields you wrote are present in what '
    + 'comes back (a delete is verified by ABSENCE):\n\n' + settle
}

// ---------------------------------------------------------------------------
// Portal server discovery — never hard-coded: the plugin's own server, the claude.ai connector
// (in the Desktop Code tab it is named by a UUID: mcp__560b8d0b-…__get_proposal_detail) and a
// raw MCP install all register the same tools under different names.
// ---------------------------------------------------------------------------

/** Tools only the portal registers. A server exposing all three is the portal. */
export const PORTAL_SIGNATURE = ['get_proposal_detail', 'list_flow_connections', 'await_my_turn']
/** Weaker evidence: a server whose tool list (as far as we can see it) carries one of these. */
export const PORTAL_HINT_TOOLS = new Set(['get_proposal_detail', 'list_flow_clusters', 'list_flow_connections', 'await_my_turn',
  'create_proposal', 'add_proposal_milestone', 'list_subtasks', 'interpret_knowledge_graph', 'read_board'])

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
  return rankServers(hits, pluginName)
}

/** The breakdown rows carry `serverName` (what /mcp lists and $.mcp.call takes) beside the wire
 *  name; a server qualifies on the signature, or on `get_proposal_detail` alone when the list is
 *  partial. Returns names in the form $.mcp.call takes, best first, each once. */
export function portalServersFromBreakdown(rows: readonly { name: string; serverName?: string }[], pluginName: string): string[] {
  const by = new Map<string, { tools: Set<string>; spelled: string }>()
  for (const r of rows) {
    const p = splitMcpName(r.name)
    if (!p) continue
    const key = r.serverName || p.server
    if (!by.has(key)) by.set(key, { tools: new Set(), spelled: p.server })
    by.get(key)!.tools.add(p.tool)
  }
  const full: string[] = []
  const partial: string[] = []
  for (const [k, v] of by) {
    if (PORTAL_SIGNATURE.every((t) => v.tools.has(t))) full.push(k)
    else if (v.tools.has('get_proposal_detail')) partial.push(k)
  }
  return [...rankServers(full, pluginName), ...rankServers(partial, pluginName)]
}

export function rankServers(names: readonly string[], pluginName: string): string[] {
  const rank = (s: string) => (s === `plugin_${pluginName}_${pluginName}` || s.startsWith(`plugin_${pluginName}_`)
    || s.startsWith(`plugin:${pluginName}:`) ? 0
    : /^claude[._ ]ai/i.test(s) ? 1 : 2)
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b))
}

/** Is this server name (any spelling) one we have evidence is the portal? */
export function looksLikePortal(server: string, known: readonly string[]): boolean {
  if (known.includes(server)) return true
  return /management[-_ ]portal/i.test(server)
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
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function num(s: string | undefined | null): number | null {
  if (s == null) return null
  const v = parseFloat(String(s))
  return Number.isFinite(v) ? v : null
}

/** `time: 6.0 hours` / `time: 1 d` / `time: 90 min` → hours. A day is 8 working hours. */
export function hoursOf(s: string | null | undefined): number | null {
  const m = /([\d.]+)\s*(hours?|hrs?|h|days?|d|min(?:ute)?s?|m|weeks?|w)\b/i.exec(String(s || ''))
  if (!m) return num(s)
  const v = num(m[1])
  if (v === null) return null
  const u = (m[2] || '').toLowerCase()
  if (u.startsWith('d')) return v * 8
  if (u.startsWith('w')) return v * 40
  if (u.startsWith('m')) return v / 60
  return v
}

function field(line: string, name: string): string | null {
  const m = new RegExp('\\|\\s*' + name + ':\\s*([^|\\[]*?)\\s*(?:\\||\\[|$)').exec(line)
  const v = m ? (m[1] ?? '').trim() : ''
  return v && v !== 'None' ? v : null
}

export function parseProposalDetail(text: string): Proposal | null {
  const t = String(text || '')
  const title = /^Proposal: (.*)$/m.exec(t)
  if (!title) return null
  const status = /^Status: (.*)$/m.exec(t)
  const phases: Phase[] = []
  for (const line of t.split(/\r?\n/)) {
    const ph = /^\s{2}Phase: (.*?) \|.*\[([0-9a-f-]{8,})\]\s*$/.exec(line)
    if (ph) {
      phases.push({ name: (ph[1] ?? '').trim(), id: (ph[2] ?? ''), milestones: [],
        deadline: field(line, 'deadline'), order: num(field(line, 'order')) })
      continue
    }
    const ms = /^\s{4}- (.*?) \|.*status: ([^|]*?) \|.*$/.exec(line)
    if (ms && phases.length) {
      const id = RE_ID.exec(line)
      phases[phases.length - 1]!.milestones.push({
        name: (ms[1] ?? '').trim(), status: (ms[2] ?? '').trim() || 'pending', id: (id?.[1] ?? null),
        cost: num(field(line, 'cost')), hours: hoursOf(field(line, 'time')), deadline: field(line, 'deadline'),
      })
    }
  }
  return { title: (title[1] ?? '').trim(), status: status ? (status[1] ?? '').trim() : '', phases }
}

/** list_tasks and list_subtasks share the row shape: `- [status] Title (priority: p) due: d | … [id: …]`. */
export function parseTasks(text: string): TaskRow[] {
  const rows: TaskRow[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^- \[([a-z_]+)\] (.*?)(?: \(priority: ([a-z]+)\))?(?: due: ([^|\[]*?))?\s*(?:\|.*)?(?:\[id: [^\]]+\])?$/.exec(line.trim())
    if (!m) continue
    const id = RE_ID.exec(line)
    rows.push({ status: (m[1] ?? ''), title: (m[2] ?? '').trim(), priority: (m[3] ?? '') || null, id: (id?.[1] ?? null),
      due: m[4] && m[4].trim() && m[4].trim() !== 'None' ? m[4].trim() : null })
  }
  return rows
}

export function parseSubtasks(text: string): { parent: string | null; rows: SubtaskRow[] } {
  const head = /subtask\(s\) for task ([0-9a-f-]{36})/i.exec(String(text || ''))
  return { parent: head ? (head[1] ?? null) : null, rows: parseTasks(text).map((r) => ({ status: r.status, title: r.title, id: r.id })) }
}

// ---------------------------------------------------------------------------
// Status classes, progress and the PLAN
// ---------------------------------------------------------------------------

export const DONE = /^(completed|complete|done|delivered|approved|paid|accepted)$/i
export const REVIEW = /^(in_review|review|submitted|awaiting_review|in review)$/i
export const ACTIVE = /^(in_progress|active|started|in progress|doing)$/i
export const CANCELLED = /^(cancel+ed|dropped|void)$/i

export type StatusClass = 'done' | 'review' | 'active' | 'pending' | 'cancelled'
export function classOf(status: string): StatusClass {
  if (DONE.test(status)) return 'done'
  if (REVIEW.test(status)) return 'review'
  if (ACTIVE.test(status)) return 'active'
  if (CANCELLED.test(status)) return 'cancelled'
  return 'pending'
}

export function glyph(status: string): string {
  switch (classOf(status)) {
    case 'done': return '✓'
    case 'review': return '◐'
    case 'active': return '▶'
    case 'cancelled': return '✗'
    default: return '○'
  }
}

export type Progress = { done: number; review: number; total: number; pct: number }

/** Counts; cancelled items leave the denominator. */
export function progress(statuses: readonly string[]): Progress {
  const live = statuses.filter((s) => classOf(s) !== 'cancelled')
  const done = live.filter((s) => classOf(s) === 'done').length
  const review = live.filter((s) => classOf(s) === 'review').length
  return { done, review, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 }
}

export type PlanTask = TaskRow & { sub: Progress | null }
export type PlanMilestone = Milestone & {
  cls: StatusClass
  overdue: boolean
  task: PlanTask | null
  /** 0..1 inside the milestone: delivered 1, else its task tree's done share. */
  frac: number
}
export type PlanPhase = {
  name: string
  id: string | null
  index: number
  deadline: string | null
  overdue: boolean
  milestones: PlanMilestone[]
  progress: Progress
  frac: number
  isCurrent: boolean
  isDone: boolean
}
export type PlanItem = { kind: 'milestone' | 'task' | 'subtask'; title: string; status: string; phase: string; id: string | null; due?: string | null; overdue?: boolean }
export type Plan = {
  title: string
  status: string
  phases: PlanPhase[]
  current: number
  /** Overall share delivered: by planned hours when every milestone has them, else by count. */
  pct: number
  reviewPct: number
  milestones: Progress
  tasks: Progress
  subtasks: Progress
  hours: { planned: number; delivered: number } | null
  cost: { planned: number; delivered: number } | null
  completed: PlanItem[]
  remaining: PlanItem[]
  overdue: PlanItem[]
  orphanTasks: PlanTask[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** `today` is YYYY-MM-DD; a deadline before it on something not done is overdue. */
export function isOverdue(deadline: string | null | undefined, status: string, today: string): boolean {
  if (!deadline) return false
  const d = /^\d{4}-\d{2}-\d{2}/.exec(deadline)
  if (!d) return false
  const c = classOf(status)
  return c !== 'done' && c !== 'cancelled' && d[0] < today
}

export function todayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function buildPlan(p: Proposal, tasks: readonly TaskRow[] | null, today: string): Plan {
  const used = new Set<string>()
  const taskFor = (name: string): PlanTask | null => {
    if (!tasks) return null
    const n = norm(name)
    const t = tasks.find((x) => !used.has(x.id || x.title) && norm(x.title) === n)
      || tasks.find((x) => !used.has(x.id || x.title) && (norm(x.title).startsWith(n) || n.startsWith(norm(x.title))) && norm(x.title).length > 6)
    if (!t) return null
    used.add(t.id || t.title)
    return { ...t, sub: t.subtasks ? progress(t.subtasks.map((s) => s.status)) : null }
  }
  const phases: PlanPhase[] = p.phases.map((ph, index) => {
    const milestones: PlanMilestone[] = ph.milestones.map((m) => {
      const cls = classOf(m.status)
      const task = taskFor(m.name)
      const frac = cls === 'done' ? 1 : task && task.sub && task.sub.total ? task.sub.done / task.sub.total : 0
      return { ...m, cls, task, frac, overdue: isOverdue(m.deadline, m.status, today) }
    })
    const pr = progress(milestones.map((m) => m.status))
    const live = milestones.filter((m) => m.cls !== 'cancelled')
    const frac = live.length ? live.reduce((a, m) => a + m.frac, 0) / live.length : 0
    const isDone = live.length > 0 && pr.done === pr.total
    return { name: ph.name, id: ph.id, index, deadline: ph.deadline ?? null, milestones, progress: pr, frac,
      isCurrent: false, isDone, overdue: !isDone && isOverdue(ph.deadline, 'pending', today) }
  })
  let current = phases.findIndex((ph) => !ph.isDone)
  if (current < 0) current = Math.max(0, phases.length - 1)
  if (phases[current]) phases[current]!.isCurrent = true
  const allMs = phases.flatMap((ph) => ph.milestones).filter((m) => m.cls !== 'cancelled')
  const msProg = progress(allMs.map((m) => m.status))
  const withHours = allMs.filter((m) => typeof m.hours === 'number' && (m.hours as number) > 0)
  const hours = withHours.length ? {
    planned: withHours.reduce((a, m) => a + (m.hours as number), 0),
    delivered: withHours.filter((m) => m.cls === 'done').reduce((a, m) => a + (m.hours as number), 0),
  } : null
  const withCost = allMs.filter((m) => typeof m.cost === 'number')
  const cost = withCost.length ? {
    planned: withCost.reduce((a, m) => a + (m.cost as number), 0),
    delivered: withCost.filter((m) => m.cls === 'done').reduce((a, m) => a + (m.cost as number), 0),
  } : null
  const byHours = hours && withHours.length === allMs.length && hours.planned > 0
  const pct = byHours ? Math.round((hours!.delivered / hours!.planned) * 100) : msProg.pct
  const reviewHours = byHours ? withHours.filter((m) => m.cls === 'review').reduce((a, m) => a + (m.hours as number), 0) : 0
  const reviewPct = byHours ? Math.round((reviewHours / hours!.planned) * 100)
    : msProg.total ? Math.round((msProg.review / msProg.total) * 100) : 0
  const tk = tasks || []
  const subs = tk.flatMap((t) => t.subtasks || [])
  const completed: PlanItem[] = []
  const remaining: PlanItem[] = []
  const overdue: PlanItem[] = []
  for (const ph of phases) {
    for (const m of ph.milestones) {
      if (m.cls === 'cancelled') continue
      const item: PlanItem = { kind: 'milestone', title: m.name, status: m.status, phase: ph.name, id: m.id, due: m.deadline, overdue: m.overdue }
      ;(m.cls === 'done' ? completed : remaining).push(item)
      if (m.overdue) overdue.push(item)
      if (m.task && m.task.subtasks && m.cls !== 'done') {
        for (const s of m.task.subtasks) {
          if (classOf(s.status) === 'cancelled') continue
          const si: PlanItem = { kind: 'subtask', title: s.title, status: s.status, phase: ph.name, id: s.id }
          ;(classOf(s.status) === 'done' ? completed : remaining).push(si)
        }
      }
    }
  }
  const orphanTasks = tk.filter((t) => !used.has(t.id || t.title)).map((t) => ({ ...t, sub: t.subtasks ? progress(t.subtasks.map((s) => s.status)) : null }))
  for (const t of orphanTasks) {
    const item: PlanItem = { kind: 'task', title: t.title, status: t.status, phase: '', id: t.id, due: t.due, overdue: isOverdue(t.due, t.status, today) }
    if (classOf(t.status) === 'cancelled') continue
    ;(classOf(t.status) === 'done' ? completed : remaining).push(item)
    if (item.overdue) overdue.push(item)
  }
  return {
    title: p.title, status: p.status, phases, current, pct, reviewPct, milestones: msProg,
    tasks: progress(tk.map((t) => t.status)), subtasks: progress(subs.map((s) => s.status)),
    hours, cost, completed, remaining, overdue, orphanTasks,
  }
}

// ---------------------------------------------------------------------------
// Bars — text for the terminal, SVG for the Desktop
// ---------------------------------------------------------------------------

/** `███▒▒░░░░░` — done, in review, remaining. */
export function textBar(frac: number, width: number, reviewFrac = 0): string {
  const w = Math.max(1, Math.floor(width))
  const f = Math.max(0, Math.min(1, frac || 0))
  const r = Math.max(0, Math.min(1 - f, reviewFrac || 0))
  const d = Math.round(f * w)
  const v = Math.min(w - d, Math.round(r * w))
  return '█'.repeat(d) + '▒'.repeat(v) + '░'.repeat(Math.max(0, w - d - v))
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export const SVG_COLORS = { done: '#2f9e5b', review: '#d49a1a', active: '#3b82f6', rest: '#8a8f98', overdue: '#d64545', text: '#8a8f98', current: '#3b82f6' }

/** One bar row: label left, bar, percent right. Neutral text colour so it reads on light and dark. */
export function svgBar(opts: { width: number; label?: string; frac: number; review?: number; overdue?: boolean; height?: number; current?: boolean }): string {
  const W = Math.max(120, Math.round(opts.width))
  const H = opts.height ?? 22
  const labelW = opts.label ? Math.min(Math.round(W * 0.42), 260) : 0
  const pctW = 44
  const barX = labelW ? labelW + 8 : 0
  const barW = Math.max(20, W - barX - pctW)
  const f = Math.max(0, Math.min(1, opts.frac || 0))
  const r = Math.max(0, Math.min(1 - f, opts.review || 0))
  const pct = Math.round(f * 100)
  const lab = opts.label ? `<text x="0" y="${H / 2 + 4}" font-family="system-ui,sans-serif" font-size="12" fill="${opts.current ? SVG_COLORS.current : SVG_COLORS.text}"${opts.current ? ' font-weight="700"' : ''}>${esc(clip(opts.label, Math.floor(labelW / 6.6)))}</text>` : ''
  const y = Math.round(H / 2 - 5)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lab}`
    + `<rect x="${barX}" y="${y}" width="${barW}" height="10" rx="5" fill="${SVG_COLORS.rest}" fill-opacity="0.25"/>`
    + (r > 0 ? `<rect x="${barX}" y="${y}" width="${Math.round(barW * (f + r))}" height="10" rx="5" fill="${SVG_COLORS.review}"/>` : '')
    + (f > 0 ? `<rect x="${barX}" y="${y}" width="${Math.max(10, Math.round(barW * f))}" height="10" rx="5" fill="${opts.overdue ? SVG_COLORS.overdue : SVG_COLORS.done}"/>` : '')
    + `<text x="${W}" y="${H / 2 + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="12" fill="${SVG_COLORS.text}">${pct}%</text></svg>`
}

/** The whole plan as one chart: an overall bar, then one row per phase. */
export function svgPlan(plan: Plan, width: number): string {
  const W = Math.max(240, Math.round(width))
  const rowH = 24
  const H = 34 + plan.phases.length * rowH + 6
  const parts: string[] = []
  const labelW = Math.min(Math.round(W * 0.45), 300)
  const barX = labelW + 8
  const barW = Math.max(40, W - barX - 48)
  const f = plan.pct / 100
  const r = plan.reviewPct / 100
  parts.push(`<text x="0" y="16" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${SVG_COLORS.text}">Overall</text>`)
  parts.push(`<rect x="${barX}" y="6" width="${barW}" height="12" rx="6" fill="${SVG_COLORS.rest}" fill-opacity="0.25"/>`)
  if (r > 0) parts.push(`<rect x="${barX}" y="6" width="${Math.round(barW * Math.min(1, f + r))}" height="12" rx="6" fill="${SVG_COLORS.review}"/>`)
  if (f > 0) parts.push(`<rect x="${barX}" y="6" width="${Math.max(12, Math.round(barW * f))}" height="12" rx="6" fill="${SVG_COLORS.done}"/>`)
  parts.push(`<text x="${W}" y="16" text-anchor="end" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${SVG_COLORS.text}">${plan.pct}%</text>`)
  plan.phases.forEach((ph, i) => {
    const y = 34 + i * rowH
    const pf = ph.isDone ? 1 : ph.progress.total ? ph.progress.done / ph.progress.total : 0
    const pr = ph.progress.total ? ph.progress.review / ph.progress.total : 0
    const col = ph.isCurrent ? SVG_COLORS.current : SVG_COLORS.text
    const name = `${i + 1}. ${ph.name}`
    if (ph.isCurrent) parts.push(`<rect x="0" y="${y - 2}" width="${W}" height="${rowH - 2}" rx="4" fill="${SVG_COLORS.current}" fill-opacity="0.10"/>`)
    parts.push(`<text x="4" y="${y + 14}" font-family="system-ui,sans-serif" font-size="12" fill="${col}"${ph.isCurrent ? ' font-weight="700"' : ''}>${esc(clip(name, Math.floor(labelW / 6.6)))}</text>`)
    parts.push(`<rect x="${barX}" y="${y + 5}" width="${barW}" height="10" rx="5" fill="${SVG_COLORS.rest}" fill-opacity="0.25"/>`)
    if (pr > 0) parts.push(`<rect x="${barX}" y="${y + 5}" width="${Math.round(barW * Math.min(1, pf + pr))}" height="10" rx="5" fill="${SVG_COLORS.review}"/>`)
    if (pf > 0) parts.push(`<rect x="${barX}" y="${y + 5}" width="${Math.max(10, Math.round(barW * pf))}" height="10" rx="5" fill="${ph.overdue ? SVG_COLORS.overdue : SVG_COLORS.done}"/>`)
    parts.push(`<text x="${W}" y="${y + 14}" text-anchor="end" font-family="system-ui,sans-serif" font-size="12" fill="${col}">${ph.progress.done}/${ph.progress.total}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

export function clip(s: string, n: number): string {
  const t = String(s || '')
  return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t
}

export function money(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`
}

// ---------------------------------------------------------------------------
// The status line
// ---------------------------------------------------------------------------

/** `HelmOS Live Voice · phase 7/7 · ███░░ 62% · gates 14/15 (1 down) · owes 2` — short on purpose. */
export function statusLine(s: CanonStatus | null, plan?: Plan | null): string | undefined {
  if (!s && !plan) return undefined
  if (s && s.mode !== 'on') return `portal · canon ${s.mode}` + (plan ? ` · ${textBar(plan.pct / 100, 6)} ${plan.pct}%` : '')
  const parts: string[] = []
  if (plan) {
    parts.push(clip(plan.title.split(/ [—–-] /)[0] || plan.title, 28))
    if (plan.phases.length) parts.push(`phase ${plan.current + 1}/${plan.phases.length}`)
    parts.push(`${textBar(plan.pct / 100, 8, plan.reviewPct / 100)} ${plan.pct}%`)
  }
  if (s) {
    if (s.run) parts.unshift(`${s.run.id} ${s.run.state}`)
    else if (!plan) parts.push('canon: no run')
    const down = s.gates.stood.length
    parts.push(`gates ${s.gates.armed}/${s.gates.total} armed` + (down ? ` (${down} stood down)` : ''))
    const o = owedNow(s)
    if (o.count) parts.push(`owes ${o.count} read-back${o.count === 1 ? '' : 's'}`)
    if (o.journal) parts.push('journal owed')
    if (o.closeout.length) parts.push(`close-out: ${o.closeout.length} missing`)
  }
  return parts.join(' · ')
}

/** The compact run context added to the first message (prompt.context): a few lines, not a card. */
export function runContext(s: CanonStatus | null, plan: Plan | null): string | null {
  if (!s?.run && !plan) return null
  const lines: string[] = []
  if (s?.run) lines.push(`Portal run ${s.run.id} is ${s.run.state}${s.run.project_id ? ` on project ${s.run.project_id}` : ''}.`)
  if (plan) {
    const ph = plan.phases[plan.current]
    lines.push(`Plan "${plan.title}": ${plan.pct}% delivered; phase ${plan.current + 1}/${plan.phases.length}${ph ? ` "${ph.name}" (${ph.progress.done}/${ph.progress.total} milestones)` : ''}; ${plan.remaining.filter((r) => r.kind === 'milestone').length} milestone(s) remaining${plan.overdue.length ? `, ${plan.overdue.length} overdue` : ''}.`)
  }
  if (s) {
    const o = owedNow(s)
    if (o.count) lines.push(`Owed now: ${o.count} read-back(s)${o.settle ? ` — settle with ${clip(o.settle, 240)}` : ''}.`)
    if (s.gates.stood.length) lines.push(`Stood down: ${s.gates.stood.map((g) => g.id).join(', ')} (re-arm with /portal-rearm).`)
  }
  lines.push('This summary comes from the management-portal mod and is a snapshot; the canon gates remain the authority.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The idle-run nudge — closes "no hook can restart an idle session", toast first, capped.
// ---------------------------------------------------------------------------

export const NUDGE_GRACE_MS = 60_000
export const NUDGE_MAX_WITHOUT_PROGRESS = 3

export type NudgeInput = {
  now: number
  prefs: Pick<PortalPrefs, 'nudge' | 'nudgeMinutes'>
  idle: PortalIdle
  canon: CanonStatus | null
  plan: Plan | null
  /** Subagents, background shells or monitors still running. */
  busy: boolean
  /** A fingerprint of the canon's progress (ledger position, owed, run state). */
  progressMark: string
}
export type NudgeVerdict = { act: 'none' | 'warn' | 'nudge' | 'cancel'; why: string }

export function nudgeEnabled(prefs: Pick<PortalPrefs, 'nudge'>, idle: Pick<PortalIdle, 'continueMode'>): boolean {
  return prefs.nudge === 'on' || (prefs.nudge === 'auto' && idle.continueMode)
}

export function nudgeDecision(i: NudgeInput): NudgeVerdict {
  if (!nudgeEnabled(i.prefs, i.idle)) return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'nudge off for this session' }
  const run = i.canon && i.canon.run
  if (!run || run.state !== 'RUN') return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'no run in RUN state' }
  const remaining = i.plan ? i.plan.remaining.filter((r) => r.kind === 'milestone').length : null
  if (remaining === 0) return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'no phases remaining' }
  if (i.idle.working) return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'a turn is running' }
  if (i.busy) return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'background work is running' }
  if (i.idle.nudges >= NUDGE_MAX_WITHOUT_PROGRESS && i.idle.progressMark === i.progressMark) {
    return { act: i.idle.pendingSince ? 'cancel' : 'none', why: `${NUDGE_MAX_WITHOUT_PROGRESS} nudges without progress — paused` }
  }
  const idleMs = Math.max(1, i.prefs.nudgeMinutes) * 60_000
  if (i.now - i.idle.lastActivityAt < idleMs) return { act: i.idle.pendingSince ? 'cancel' : 'none', why: 'not idle long enough' }
  if (!i.idle.pendingSince) return { act: 'warn', why: 'idle' }
  if (i.now - i.idle.pendingSince >= NUDGE_GRACE_MS) return { act: 'nudge', why: 'idle past the grace period' }
  return { act: 'none', why: 'counting down' }
}

export function nudgePrompt(s: CanonStatus | null, plan: Plan | null, minutes: number): string {
  const run = s && s.run ? s.run.id : 'the portal run'
  const ph = plan && plan.phases[plan.current]
  return `The management-portal run ${run} is in RUN state and this session has been idle for ${minutes} minute(s) `
    + `with no background work running${ph ? ` (current phase: "${clip(ph.name, 80)}", ${plan!.remaining.filter((r) => r.kind === 'milestone').length} milestone(s) remaining)` : ''}. `
    + 'Continue the run from where it stopped, following /portal-continue: no confirmation between phases; settle anything owed first. '
    + 'If you are genuinely blocked, say so in a journal entry tagged "blocked" and stop.'
}

// ---------------------------------------------------------------------------
// Team Chat
// ---------------------------------------------------------------------------

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
  const escd = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('@' + escd + '(?![\\w-])').test(c) || /@(all|everyone)\b/.test(c)
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
// Notifications — DMs, inbox, tasks due, approvals. Labels only; message text never reaches a prompt.
// ---------------------------------------------------------------------------

/** read_dm_conversations: `conversation_id | unread | last_read_at | participants` rows. */
export function parseDmConversations(text: string): { id: string; unread: number; who: string }[] {
  const out: { id: string; unread: number; who: string }[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-f-]{36})\s*\|\s*(\d+|\?)\s*\|\s*[^|]*\|\s*(.*)$/.exec(line.trim())
    if (m) out.push({ id: m[1] ?? '', unread: m[2] === '?' ? 0 : Number(m[2]), who: (m[3] ?? '').trim() })
  }
  return out
}

/** read_inbox: `Sender (date) [id=… | sender_id=… | read=no] Subject: …`. */
export function parseInbox(text: string): { id: string; sender: string; read: boolean; subject: string; at: string }[] {
  const out: { id: string; sender: string; read: boolean; subject: string; at: string }[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(.+?) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\) \[(.*?)\] Subject: ?(.*)$/.exec(line)
    if (!m) continue
    const bits: Record<string, string> = {}
    for (const b of (m[3] ?? '').split(' | ')) { const k = b.indexOf('='); if (k > 0) bits[b.slice(0, k)] = b.slice(k + 1) }
    if (!bits.id) continue
    out.push({ id: bits.id, sender: m[1] ?? '', read: bits.read === 'yes', subject: m[4] ?? '', at: m[2] ?? '' })
  }
  return out
}

/** list_scheduling_requests: one request per `- ` / id-bearing line; "No scheduling requests" = none. */
export function parseSchedulingRequests(text: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  if (/^No scheduling requests/i.test(String(text || '').trim())) return out
  for (const line of String(text || '').split(/\r?\n/)) {
    const id = UUID.exec(line)
    if (!id || !/^\s*(-|\*|\d+\.)\s/.test(line)) continue
    out.push({ id: id[0], label: safeLabel(line.replace(/\[.*?\]/g, '').replace(UUID, '').replace(/^\s*(-|\*|\d+\.)\s*/, ''), 60) })
  }
  return out
}

/** New notifications against what was already announced. Unread DMs are keyed by conversation
 *  and count, so a further message in the same conversation announces again. */
export function newNotes(
  input: { dms: { id: string; unread: number; who: string }[]; inbox: { id: string; sender: string; read: boolean; subject: string }[];
    approvals: { id: string; label: string }[]; due: { id: string | null; title: string; due: string | null | undefined }[] },
  seen: readonly string[], now: number,
): PortalNote[] {
  const s = new Set(seen)
  const out: PortalNote[] = []
  for (const d of input.dms) {
    if (d.unread <= 0 || /just you/i.test(d.who)) continue
    const id = `dm:${d.id}:${d.unread}`
    if (!s.has(id)) out.push({ id, kind: 'dm', text: `${d.unread} unread DM${d.unread === 1 ? '' : 's'} from ${safeLabel(d.who, 30)}`, at: now })
  }
  for (const m of input.inbox) {
    if (m.read) continue
    const id = `inbox:${m.id}`
    if (!s.has(id)) out.push({ id, kind: 'inbox', text: `Inbox: ${safeLabel(m.sender, 24)} — ${safeLabel(m.subject, 50)}`, at: now })
  }
  for (const a of input.approvals) {
    const id = `approval:${a.id}`
    if (!s.has(id)) out.push({ id, kind: 'approval', text: `Approval waiting: ${a.label}`, at: now })
  }
  for (const t of input.due) {
    const id = `due:${t.id || t.title}:${t.due}`
    if (!s.has(id)) out.push({ id, kind: 'due', text: `Due ${t.due}: ${clip(t.title, 60)}`, at: now })
  }
  return out
}

// ---------------------------------------------------------------------------
// Knowledge graph interpretation and boards — what the graph says, what the board holds
// ---------------------------------------------------------------------------

/** The bullet lines under a STRUCTURAL FACTS heading such as `HUBS (by degree …):`. */
function factList(text: string, heading: RegExp): string[] {
  const lines = String(text || '').split(/\r?\n/)
  const out: string[] = []
  let on = false
  for (const line of lines) {
    if (/^[A-Z][A-Z /&-]{2,60}(\(.*\))?:\s*(.*)$/.test(line)) {
      on = heading.test(line)
      const inline = /:\s*(\S.*)$/.exec(line)
      if (on && inline && inline[1] && !/^none$/i.test(inline[1].trim())) out.push(...inline[1].split(/,\s*/).map((x) => x.trim()).filter(Boolean))
      continue
    }
    if (!on) continue
    const m = /^\s+-\s+(.*)$/.exec(line)
    if (m && m[1]) out.push(m[1].trim())
    else if (/^\s+\S/.test(line) && !/^\s+-/.test(line)) out.push(...line.trim().split(/,\s*/).filter((x) => x && !/^none$/i.test(x)))
    else if (!line.trim()) on = false
  }
  return out
}

/** interpret_knowledge_graph: `# Interpretation — {title}`, prose, then `--- STRUCTURAL FACTS … ---`
 *  with HUBS / BRIDGES / COMMUNITIES / CANDIDATE SURPRISING CONNECTIONS / ISOLATED NODES lists. */
export function parseKgInterpretation(text: string, graphId: string | null, now: number): KgView | null {
  const t = String(text || '')
  if (!t.trim() || /has no nodes yet/i.test(t) || /^(error|graph not found)/i.test(t.trim())) return null
  const cut = t.search(/^---\s*STRUCTURAL FACTS/m)
  const prose = (cut >= 0 ? t.slice(0, cut) : t).replace(/^#\s*Interpretation\s*[—-]\s*.*$/m, '').replace(/^⚠.*$/gm, '').trim()
  const facts = cut >= 0 ? t.slice(cut) : t
  const title = (/^#\s*Interpretation\s*[—-]\s*(.+)$/m.exec(t)?.[1] || /^GRAPH:\s*(.+?)(?:\s*\(id [^)]*\))?\s*$/m.exec(t)?.[1] || '').trim()
  const gid = graphId || /^GRAPH:.*\(id ([0-9a-f-]{36})\)/m.exec(t)?.[1] || null
  const label = (s: string) => s.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+(degree|spans)\b.*$/, '').trim()
  const hubs = factList(facts, /^HUBS/).map(label)
  const bridges = factList(facts, /^BRIDGES/).map(label)
  const communities = factList(facts, /^COMMUNITIES/).map((c) => c.replace(/:.*$/, '').trim())
  const gaps = factList(facts, /^CANDIDATE SURPRISING/).map((g) => g.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+cosine\s+([\d.]+).*$/, ' (cosine $1)').trim())
  const thin = factList(facts, /^ISOLATED NODES/)
  const firstPara = prose.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 30 && !/^#/.test(p)) || ''
  if (!hubs.length && !gaps.length && !communities.length && !firstPara) return null
  return { graphId: gid, title: title || 'knowledge graph', hubs: hubs.slice(0, 8), bridges: bridges.slice(0, 6), gaps: gaps.slice(0, 8),
    thin: thin.slice(0, 8), communities: communities.slice(0, 8), summary: clip(firstPara.replace(/\s+/g, ' '), 600), at: now }
}

/** read_board: `Board: {title}`, then `{indent}- [{block_id}] type={type} pos={n} comments={n} | {summary}`,
 *  two spaces per depth from depth 1; comment lines (`💬 …`) are skipped. */
export function parseBoard(text: string, boardId: string | null, now: number): BoardView | null {
  const t = String(text || '')
  const title = /^Board: (.+)$/m.exec(t)
  if (!title) return null
  const blocks: BoardBlock[] = []
  for (const line of t.split(/\r?\n/)) {
    if (/^Board-level comments:/.test(line)) break
    const m = /^(\s*)- \[([^\]]+)\] type=(\S+)(?: pos=\S+)?(?: comments=(\d+))?\s*\|?\s*(.*)$/.exec(line)
    if (!m) continue
    blocks.push({ depth: Math.max(0, Math.floor((m[1] ?? '').length / 2) - 1), type: (m[3] ?? '').toLowerCase(),
      text: (m[5] ?? '').trim(), id: m[2] ?? null })
  }
  return { id: boardId, title: (title[1] ?? '').trim(), blocks: blocks.slice(0, 80), at: now }
}

// ---------------------------------------------------------------------------
// Links into HelmOS — only when the base URL is known (a portal result carried one, or the
// person set it). Never guessed: a wrong link is worse than none.
// ---------------------------------------------------------------------------

export function helmosLink(base: string | null | undefined, kind: 'project' | 'task' | 'board' | 'journal' | 'graph', id: string | null | undefined): string | null {
  if (!base || !/^https:\/\/[a-z0-9.-]+(?::\d+)?(\/[\w./-]*)?$/.test(base)) return null
  const b = base.replace(/\/+$/, '')
  // Routes from the HelmOS web app (frontend/src/App.tsx): boards, journal entries and graphs have
  // their own page; a project and a task open from their list pages.
  if (kind === 'project') return b + '/projects'
  if (kind === 'task') return b + '/tasks'
  if (!id || !UUID.test(id)) return null
  return b + (kind === 'board' ? `/boards/${id}` : kind === 'journal' ? `/journal/${id}` : `/knowledge-graphs/${id}`)
}

// ---------------------------------------------------------------------------
// Cards — the rich rendering of a portal tool result
// ---------------------------------------------------------------------------

export type CardRow = { mark: string; text: string; meta?: string; id?: string | null; cls?: StatusClass; frac?: number | null; depth?: number }
export type Card = { title: string; summary: string; rows: CardRow[]; more: number; frac?: number | null; review?: number | null; kind?: string }

const short = (id: string | null | undefined) => (id ? String(id).slice(0, 8) : '')

/** The tools a card exists for. Anything else draws exactly as the engine draws it. */
export const CARD_TOOLS = new Set([
  'list_tasks', 'list_subtasks', 'get_proposal_detail', 'list_milestones', 'list_flow_clusters',
  'list_flow_connections', 'read_channel_messages', 'list_projects', 'list_clients', 'list_boards',
  'list_journals', 'list_knowledge_graphs', 'bulk', 'interpret_knowledge_graph', 'read_board',
  'read_dm_conversations', 'read_inbox',
])

export function cardFor(tool: string, text: string, maxRows = 12): Card | null {
  const t = String(text || '')
  if (!t.trim()) return null
  let rows: CardRow[] = []
  let summary = ''
  let frac: number | null = null
  let review: number | null = null
  if (tool === 'get_proposal_detail' || tool === 'list_milestones') {
    const p = parseProposalDetail(t)
    if (!p) return null
    const plan = buildPlan(p, null, '0000-00-00')
    summary = `${p.title} · ${p.status || 'draft'} · ${p.phases.length} phase(s) · milestones ${plan.milestones.done}/${plan.milestones.total} done`
      + (plan.milestones.review ? ` · ${plan.milestones.review} in review` : '')
      + (plan.hours ? ` · ${round1(plan.hours.delivered)}/${round1(plan.hours.planned)} h` : '')
    frac = plan.pct / 100
    review = plan.reviewPct / 100
    for (const ph of plan.phases) {
      rows.push({ mark: ph.isCurrent ? '▸' : '■', text: ph.name, meta: `${ph.progress.done}/${ph.progress.total}`, id: ph.id,
        frac: ph.progress.total ? ph.progress.done / ph.progress.total : 0, depth: 0 })
      for (const m of ph.milestones) rows.push({ mark: glyph(m.status), text: m.name, meta: m.status + (m.overdue ? ' · overdue' : ''), id: m.id, cls: m.cls, depth: 1 })
    }
  } else if (tool === 'list_tasks' || tool === 'list_subtasks') {
    const tasks = parseTasks(t)
    if (!tasks.length) return null
    const pr = progress(tasks.map((x) => x.status))
    summary = `${tasks.length} ${tool === 'list_subtasks' ? 'subtask' : 'task'}(s) · ${pr.done} done · ${tasks.filter((x) => classOf(x.status) === 'active').length} active · ${pr.total - pr.done} remaining`
    frac = pr.total ? pr.done / pr.total : 0
    rows = [...tasks].sort((a, b) => rankCls(classOf(a.status)) - rankCls(classOf(b.status)))
      .map((x) => ({ mark: glyph(x.status), text: x.title, meta: [x.status, x.priority, x.due ? 'due ' + x.due : null].filter(Boolean).join(' · '), id: x.id, cls: classOf(x.status) }))
  } else if (tool === 'read_channel_messages') {
    const msgs = parseMessages(t)
    if (!msgs.length) return null
    summary = `${msgs.length} message(s)` + (/CHANNEL POLICY/.test(t) ? ' · policy attached (see raw)' : '')
    rows = msgs.map((m) => ({ mark: '›', text: `${m.sender}: ${m.content.replace(/\s+/g, ' ').slice(0, 100)}`, meta: m.at.slice(5, 16), id: m.id }))
  } else if (tool === 'read_dm_conversations') {
    const dms = parseDmConversations(t)
    if (!dms.length) return null
    const unread = dms.reduce((a, d) => a + d.unread, 0)
    summary = `${dms.length} conversation(s) · ${unread} unread`
    rows = dms.map((d) => ({ mark: d.unread ? '●' : '○', text: d.who, meta: d.unread ? `${d.unread} unread` : '', id: d.id }))
  } else if (tool === 'read_inbox') {
    const msgs = parseInbox(t)
    if (!msgs.length) return null
    summary = `${msgs.length} message(s) · ${msgs.filter((m) => !m.read).length} unread`
    rows = msgs.map((m) => ({ mark: m.read ? '○' : '●', text: `${m.sender}: ${m.subject}`, meta: m.at.slice(5, 16), id: m.id }))
  } else if (tool === 'interpret_knowledge_graph') {
    const kg = parseKgInterpretation(t, null, 0)
    if (!kg) return null
    summary = `${kg.hubs.length} hub(s) · ${kg.gaps.length} gap(s) · ${kg.communities.length} communit${kg.communities.length === 1 ? 'y' : 'ies'}`
    for (const h of kg.hubs) rows.push({ mark: '◆', text: h, meta: 'hub' })
    for (const g of kg.gaps) rows.push({ mark: '⚠', text: g, meta: 'gap' })
    for (const b of kg.bridges) rows.push({ mark: '↔', text: b, meta: 'bridge' })
  } else if (tool === 'read_board') {
    const b = parseBoard(t, null, 0)
    if (!b || !b.blocks.length) return null
    summary = `${b.title} · ${b.blocks.length} block(s)`
    rows = b.blocks.map((x) => ({ mark: x.type === 'mermaid' ? '◇' : '▪', text: x.text || '(empty)', meta: x.type, id: x.id, depth: x.depth }))
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
  return { title: tool, summary, rows: rows.slice(0, maxRows), more, frac, review, kind: tool }
}

function rankCls(c: StatusClass): number {
  return c === 'active' ? 0 : c === 'review' ? 1 : c === 'pending' ? 2 : c === 'done' ? 3 : 4
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export function rowLine(r: CardRow, width: number): string {
  const id = r.id ? ` ${short(r.id)}` : ''
  const meta = r.meta ? `  ${r.meta}` : ''
  const indent = r.depth ? '  '.repeat(r.depth) : ''
  const room = Math.max(10, width - id.length - meta.length - r.mark.length - 2 - indent.length)
  const text = r.text.length > room ? r.text.slice(0, room - 1) + '…' : r.text
  return `${indent}${r.mark} ${text}${meta}${id}`
}

/** A cheap fingerprint of canon progress, for the nudge's "no progress since" check. */
export function progressMark(s: CanonStatus | null, plan: Plan | null): string {
  return [s?.run?.id, s?.run?.state, s?.run?.last_progress_at, owedNow(s).count, plan?.pct, plan?.subtasks.done].join('|')
}

/** The first task that is in progress, else the first pending one in the current phase. */
export function currentTask(plan: Plan | null): { id: string; title: string } | null {
  if (!plan) return null
  const ph = plan.phases[plan.current]
  const pick = (cls: StatusClass[]) => {
    for (const p of [ph, ...plan.phases].filter(Boolean) as PlanPhase[]) {
      for (const m of p.milestones) if (m.task && m.task.id && cls.includes(classOf(m.task.status))) return { id: m.task.id, title: m.task.title }
    }
    for (const t of plan.orphanTasks) if (t.id && cls.includes(classOf(t.status))) return { id: t.id, title: t.title }
    return null
  }
  return pick(['active']) || pick(['pending', 'review'])
}

/** Tasks due today or earlier that are not done — for the notifications. */
export function dueTasks(tasks: readonly TaskRow[] | null, today: string): TaskRow[] {
  return (tasks || []).filter((t) => t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due) && t.due.slice(0, 10) <= today
    && classOf(t.status) !== 'done' && classOf(t.status) !== 'cancelled')
}

/** start_timer's answer names the new time entry; take the first uuid after "entry"/"id". */
export function parseTimerEntry(text: string): string | null {
  const t = String(text || '')
  const m = /(?:entry|id)[^0-9a-f]{0,20}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(t) || UUID.exec(t)
  return m ? (m[1] ?? m[0] ?? null) : null
}

// ---------------------------------------------------------------------------
// The command launcher — every command the plugin ships, read from commands/*.md at run time
// ---------------------------------------------------------------------------

/** A command file's frontmatter: `description:` and `argument-hint:`, quoted or bare. */
export function parseCommandFile(fileName: string, text: string): CommandInfo | null {
  const name = String(fileName || '').replace(/^.*[\/]/, '').replace(/\.md$/i, '')
  if (!/^[\w-]{1,64}$/.test(name)) return null
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''))
  const get = (k: string) => {
    if (!fm) return null
    const m = new RegExp('^' + k + ':\s*(.*)$', 'm').exec(fm[1] ?? '')
    if (!m) return null
    const v = (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim()
    return v || null
  }
  const description = get('description') || (String(text || '').replace(/^---[\s\S]*?---/, '').trim().split(/\r?\n/)[0] || '').slice(0, 200)
  const argumentHint = get('argument-hint')
  return { name, description, argumentHint, needsArgs: needsArgs(argumentHint), source: 'plugin' }
}

/** `<x>` is required; `[x]` alone is optional. */
export function needsArgs(hint: string | null | undefined): boolean {
  return /<[^>]+>/.test(String(hint || ''))
}

export const PRESET_RUN = 'Run'
export const PRESET_CHAT = 'Team Chat'
export const PRESET_ALL = 'All'
export const BUILTIN_PRESETS = [PRESET_RUN, PRESET_CHAT, PRESET_ALL]
const RUN_FIRST = ['portal-continue', 'portal-cockpit', 'portal-gates', 'portal-project', 'portal', 'portal-rearm', 'portal-stand-down', 'plain-english']
const CHAT_FIRST = ['channel-join', 'channel-coordinate', 'rearm-watch']

/** The built-in presets, derived from whatever commands exist (so a renamed command never strands one). */
export function builtinPresets(list: readonly CommandInfo[]): Record<string, string[]> {
  const names = list.map((c) => c.name)
  const pick = (order: string[], match: RegExp) => [...order.filter((n) => names.includes(n)), ...names.filter((n) => !order.includes(n) && match.test(n))]
  return {
    [PRESET_RUN]: pick(RUN_FIRST, /^portal/),
    [PRESET_CHAT]: pick(CHAT_FIRST, /^(channel|rearm-watch|team)/),
    [PRESET_ALL]: [...names],
  }
}

/** The commands a preset shows, in the preset's order; names no longer shipped are dropped. */
export function presetCommands(list: readonly CommandInfo[], presets: Record<string, string[]>, active: string): CommandInfo[] {
  const all = { ...builtinPresets(list), ...presets }
  const names = all[active] || all[PRESET_RUN] || []
  const by = new Map(list.map((c) => [c.name, c]))
  return names.map((n) => by.get(n)).filter((c): c is CommandInfo => Boolean(c))
}

/** A preset name a person may save: short, printable, not a built-in. */
export function presetNameOk(name: string): boolean {
  const n = String(name || '').trim()
  return n.length > 0 && n.length <= 32 && !BUILTIN_PRESETS.includes(n) && /^[\w .-]+$/.test(n)
}
