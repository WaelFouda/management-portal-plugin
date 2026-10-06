# Changelog

Releases before 1.8.0 are described in the commit history (`plugin vX.Y.Z: …`) and in the
"Known failure modes" section of [`management-portal/README.md`](management-portal/README.md).

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
