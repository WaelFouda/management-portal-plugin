// The management-portal mod's $.state contract (plugin 1.9.0). Every value a drawing reads is
// held by the host here, not in a module variable: a module variable is not what a render sees
// (measured live on 2.1.291 — the pane kept drawing its first, empty value after the canon
// snapshot had arrived) and a hot reload starts it over.

export type CanonOwed = { w: string; id: string | null; neg?: boolean; carried?: boolean; read?: string | null }

/** What `node scripts/canon-gate.js status --json` prints: a READ-ONLY snapshot of the canon. */
export type CanonStatus = {
  v: number
  plugin?: string | null
  home?: string
  homeVia?: string
  mode: string
  run: null | {
    id: string
    state: string
    mode?: string
    project_id?: string | null
    proposal_id?: string | null
    client_id?: string | null
    journal_folder?: string | null
    last_progress_at?: number | null
    blocks?: number
    tree?: { task?: number; subtask?: number; cluster?: number; connection?: number } | null
  }
  gates: { total: number; armed: number; stood: { id: string; why: string | null }[] }
  owed: CanonOwed[]
  owedTotal?: number
  settle: string | null
  journal: null | { boundary: string; id: string | null; status: string | null; wrote: boolean; read: boolean; owed: boolean }
  closeout: string[]
  debt: null | { at: number; reads: number; items?: { w: string; id: string | null }[]; settle: string | null; closeout: string[] }
  error?: string
}

/** One gate as `canon-gate.js doctor` lists it. */
export type GateRow = { id: string; armed: boolean; why: string | null }

export type Milestone = {
  name: string
  status: string
  id: string | null
  cost?: number | null
  hours?: number | null
  deadline?: string | null
}
export type Phase = { name: string; id: string | null; milestones: Milestone[]; deadline?: string | null; order?: number | null }
export type Proposal = { title: string; status: string; phases: Phase[] }
export type SubtaskRow = { status: string; title: string; id: string | null }
export type TaskRow = {
  status: string
  title: string
  priority: string | null
  id: string | null
  due?: string | null
  subtasks?: SubtaskRow[] | null
}

/** Which MCP server the mod reaches the portal through, and how it was found. */
export type PortalServer = { name: string | null; how: string; tried: string[]; error: string | null; at: number }

export type PortalPrefs = {
  rich: boolean
  band: boolean
  watch: boolean
  notify: boolean
  autoOpen: boolean
  /** 'auto' = only for runs started with /portal-continue; 'on' = every RUN; 'off' = never. */
  nudge: 'auto' | 'on' | 'off'
  nudgeMinutes: number
  /** The HelmOS web app's address, for links from cards and panes; null = no links. */
  helmosUrl: string | null
}
export type PortalCockpit = {
  loading: boolean
  at: number
  error: string | null
  projectId: string | null
  proposal: Proposal | null
  tasks: TaskRow[] | null
  server: string | null
  /** `mcp` = read by the mod itself; `observed` = parsed from a portal result Claude read. */
  via: 'mcp' | 'observed' | null
}
export type PortalBand = { hidden: boolean; asked: string }
export type PortalWatch = { channelId: string; agent: string; since: string | null; seen: string[]; lastPollAt: number; lastError: string | null }
export type PortalView = { tab: 'plan' | 'commands' | 'gates' | 'graph' | 'board' | 'settings'; showDone: boolean }

/** One slash command the launcher can run: read from the plugin's commands/*.md at run time. */
export type CommandInfo = {
  name: string
  description: string
  argumentHint: string | null
  /** The hint names a required argument (`<…>`): the launcher asks for it first. */
  needsArgs: boolean
  source: 'plugin' | 'mod'
}
export type PortalLauncher = {
  list: CommandInfo[] | null
  /** Named selections of command names; the built-in ones are re-derived and cannot be deleted. */
  presets: Record<string, string[]>
  active: string
  /** The settings view: the selection being edited, or null when not editing. */
  editing: string[] | null
  presetName: string
  /** A command waiting for its arguments. */
  form: { name: string; args: string } | null
  last: string | null
}
export type PortalGatePanel = { rows: GateRow[] | null; reason: string; busy: string | null; last: string | null; at: number }
export type KgView = { graphId: string | null; title: string; hubs: string[]; bridges: string[]; gaps: string[]; thin: string[]; communities: string[]; summary: string; at: number }
export type BoardBlock = { depth: number; type: string; text: string; id: string | null }
export type BoardView = { id: string | null; title: string; blocks: BoardBlock[]; at: number }
export type PortalTimer = { entryId: string | null; taskId: string | null; taskTitle: string; startedAt: number; busy: boolean; error: string | null }
export type PortalNote = { id: string; kind: 'dm' | 'inbox' | 'due' | 'approval'; text: string; at: number }
export type PortalNotify = { items: PortalNote[]; lastPollAt: number; error: string | null }
export type PortalIdle = {
  /** The run was started (or resumed) with /portal-continue in this session. */
  continueMode: boolean
  lastActivityAt: number
  working: boolean
  /** When the toast-first countdown started; 0 when none is pending. */
  pendingSince: number
  nudges: number
  lastNudgeAt: number
  /** The canon fingerprint when the last nudge fired: no progress since then means "stop nudging". */
  progressMark: string
}

declare module 'claude-code' {
  interface PluginState {
    'management-portal': {
      canon: CanonStatus | null
      cockpit: PortalCockpit
      prefs: PortalPrefs
      band: PortalBand
      raw: string[]
      watch: PortalWatch | null
      server: PortalServer
      view: PortalView
      gates: PortalGatePanel
      kg: KgView | null
      board: BoardView | null
      timer: PortalTimer | null
      notify: PortalNotify
      idle: PortalIdle
      launcher: PortalLauncher
    }
  }
}
