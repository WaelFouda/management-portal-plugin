# Changelog

Releases before 1.8.0 are described in the commit history (`plugin vX.Y.Z: …`) and in the
"Known failure modes" section of [`management-portal/README.md`](management-portal/README.md).

## 1.9.0 — unreleased

### Mods — the plan, the gates and every command, on screen

- **Fixed: the cockpit said "not connected" in the Desktop Code tab.** There the portal is a claude.ai
  connector named by a UUID (`mcp__560b8d0b-…__*`); the plugin's own server needs `/mcp` sign-in, and
  with tool search on `$.tool.list()` does not list deferred connector tools. Discovery now takes the server
  Claude's own portal calls ran on (`classic.PostToolUse` names it), the one remembered from an earlier
  session, the context breakdown's `/mcp` names, then the plugin's server — and the plan fills from the
  portal results Claude reads when the mod cannot call any server itself.
- **Run cockpit** (`/portal-cockpit [project-id]`, opens by itself on a wide Desktop window): phases →
  milestones → tasks → subtasks with progress bars (SVG on the Desktop, text in the terminal), the current
  phase, Completed vs Remaining, deadlines and overdue, hours and cost delivered vs planned, owed read-backs,
  stood-down gates. Tabs: Plan · Commands · Gates · Graph · Board · Settings.
- **Status line:** run · phase n/N · overall % with a mini bar · gates armed/stood · owed reads.
- **Gate control panel** (`/portal-gates`): every gate from `canon-gate.js doctor`, with Stand down (reason
  required), Re-arm and Re-arm all — run through `canon-gate.js` on the person's press only.
- **Command launcher** (`/portal-commands`): a button for every `commands/*.md` (read at run time), the
  description as a hover card, argument forms for `<required>` hints, and named presets kept in `$.store`.
- **Band:** owed read-back, idle-run countdown, timer on the current task (start/stop on press).
- **Cards** gain progress bars and cover boards, graph interpretations, inbox and DMs; **Board preview** and
  **Graph panel** (hubs, gaps, bridges) fill from observed results; **notifications** toast new unread DMs,
  inbox mail, approvals and tasks due; **compact run context** adds a few lines to the first message.
- **Idle-run nudge:** a RUN-state run with milestones remaining, idle N minutes (default 10) with no
  background work → toast, 60-second countdown, one "continue the run" prompt. Default on only for runs
  started with `/portal-continue`; pauses after three nudges without progress.
- Still additive and never enforcement. Tests: `claude plugin test management-portal` — 44 tests, terminal
  and desktop surfaces.

## 1.8.0 — 2026-10-06

### Mods — optional extras for Claude Code ≥ 2.1.287

- New function-hooks module `management-portal/hooks/mods/register.tsx`, listed under `modules` in
  `hooks/hooks.json`, with its `$.state` contract in `management-portal/types/index.d.ts`:
  - **canon status line** — run id, state, armed vs stood-down gates, owed read-backs;
  - **`/portal-cockpit`** — a pane with the run, phases → milestones → task progress, owed read-backs and
    stood-down gates (portal data via `$.mcp.call` reads of `get_proposal_detail` and `list_tasks`);
  - **gate band** above the prompt while something is owed, whose button submits a prompt asking Claude to
    run the settling read (a mod-made MCP call could never settle a gate);
  - **result cards** for portal tool results, with `raw` one press away;
  - **Team Chat wake-up** — polls the watched channel and starts a turn when this agent is `@`-addressed.
    The `team-chat-watcher` subagent remains the documented mechanism and the roster is unchanged.
- **Additive.** Older Claude Code ignores `modules` and the manifest's `types` field; every gate stays in
  the command hooks; a failing mod hook fails open. The mod reads locally and from the portal (reads only)
  and writes only its own session state and store — see *Mods → Privacy* in the plugin README.
- The portal MCP server is discovered at runtime (plugin server, claude.ai connector or raw install),
  never hard-coded.
- Tests: `claude plugin test management-portal` — 18 tests across terminal and desktop surfaces.

### Canon gates

- **Fixed: a long listing could never vouch for an id near its end.** A 156-connection
  `list_flow_connections` (~470 uuids) exceeded the 300-fingerprint cap (150 after the 4 KB line trim), so
  the debt for the last connection could not clear. A read now matches the pending ids against its full
  output and records them first. A deleted id still present at the end of a long listing now keeps the
  delete unverified, and an over-long bulk row sheds fingerprints before its inner calls.
- **New: `canon-gate.js status --json [--session <id>] [--cwd <dir>]`** — a read-only snapshot of the run,
  the gates and what is owed (used by the mod). It never appends, closes a run or deletes a debt.
- `hooks/hooks.json` no longer carries a `_comment` key (Claude Code 2.1.29x warned about it at every
  session start); the text moved to `management-portal/hooks/README.md`.
- Selftest: 450 assertions (12 new: the ~470-uuid listing direct, batched, absent and deleted cases, the
  ledger-line bound, and the read-only status snapshot).
