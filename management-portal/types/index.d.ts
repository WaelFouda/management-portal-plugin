// The management-portal mod's $.state contract (plugin 1.8.0). Every value a drawing reads is
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

export type Milestone = { name: string; status: string; id: string | null }
export type Phase = { name: string; id: string | null; milestones: Milestone[] }
export type Proposal = { title: string; status: string; phases: Phase[] }
export type TaskRow = { status: string; title: string; priority: string | null; id: string | null }

export type PortalPrefs = { rich: boolean; band: boolean; watch: boolean }
export type PortalCockpit = { loading: boolean; at: number; error: string | null; proposal: Proposal | null; tasks: TaskRow[] | null; server: string | null }
export type PortalBand = { hidden: boolean; asked: string }
export type PortalWatch = { channelId: string; agent: string; since: string | null; seen: string[]; lastPollAt: number; lastError: string | null }

declare module 'claude-code' {
  interface PluginState {
    'management-portal': {
      canon: CanonStatus | null
      cockpit: PortalCockpit
      prefs: PortalPrefs
      band: PortalBand
      raw: string[]
      watch: PortalWatch | null
    }
  }
}
