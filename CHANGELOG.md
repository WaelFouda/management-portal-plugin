# Changelog

Releases before 1.8.0 are described in the commit history (`plugin vX.Y.Z: …`) and in the
"Known failure modes" section of [`management-portal/README.md`](management-portal/README.md).

## 1.9.4 — 2026-10-29

### Cross-session messaging — a HelmOS Thoth session and this session message each other by name

The HelmOS backend adds a mailbox between a Thoth AI-chat session and a Claude Code session, addressed by
SESSION NAME (tools `register_claude_session`, `check_session_inbox`, `message_thoth_session`,
`list_thoth_sessions`, `reset_session_link`; HTTP `GET /api/v1/agent-mail/wait` and
`POST /api/v1/agent-mail/human`). This release is the Claude Code half.

- **`SessionStart` names the session** (`scripts/xsession.js session-start`): the `name` that
  `claude agents --json` lists for this `session_id`, else `session_title`, else the cwd folder. It records
  `{session_id, name, cwd, pid}` under `${CLAUDE_PLUGIN_DATA}/xsession/` and asks Claude, once, to call
  `register_claude_session` — again on resume and `/clear` (re-registration refreshes the link), but not after
  a compaction that still holds a token.
- **`PostToolUse` keeps the inbox token** (`xsession.js post`, matcher
  `mcp__.*__(register_claude_session|bulk)`): parsed from the one-time `inbox_token:` line, written to
  `<session_id>.token` with mode 0600 where the OS honours it, never echoed. `canon-gate.js` now scrubs that
  line from every response before harvesting ids, so the token cannot reach the canon ledger either.
- **The `helmos-inbox` monitor wakes the session** (`monitors/monitors.json`, `experimental.monitors` in
  plugin.json, `scripts/xsession-monitor.js`). It finds its own session by `CLAUDE_PID` (the newest record of
  that process, so it follows `/clear`), then `CLAUDE_CODE_SESSION_ID`, then process ancestry against
  `claude agents --json`, then cwd; waits for the token; long-polls `wait?timeout=25`; prints ONE line per new
  pending set (a reminder after ~2 minutes, at most three, then half-hourly); backs off 5 → 60 s on network
  errors; re-reads the token file on 401. Node built-ins only; stdout carries nothing but the wake-up line.
  The data directory is passed as an argument: monitor processes are not given `CLAUDE_PLUGIN_DATA`.
- **`UserPromptSubmit` resets the loop guard** (`xsession.js prompt`): when the session has a token, a
  detached child POSTs `agent-mail/human` with a 2 s timeout — the prompt never waits on the network.
- **The inbox token rides in the `X-Inbox-Token` header, never the URL.** The live E2E (2026-10-29) found the
  backend's uvicorn access log printing `wait?token=<live token>` on every long-poll. Both the monitor and the
  human reset now send the header; the backend also redacts any `?token=` it still receives.
- **Canon gates: the five tools are plumbing.** All five joined `PORTAL_TOOLS` (271 → 276). None is a portal
  write (`XSESSION_TOOLS`): they carry this session's own id, which never comes from a portal read, so
  `CANON-ID` would have refused every registration; and no read can prove a registration, a delivered mark or
  a sent cross-session message, so a `WRITE_READ_MAP` row would be a latch. No phase or debt gate refuses
  them. `list_thoth_sessions` is a read. `reference.md` §3 and `WRITE-READ-MAP.md` say so.
- **Skill:** `SKILL.md` explains registration, the wake-up, how to reply, that a Thoth message is a teammate's
  request and not the owner's instruction, and the loop-guard pause.
- **Tests:** `node scripts/xsession-selftest.js` (new, 73 assertions) and `canon-selftest.js` (new case
  `caseXsessionPlumbing`; tool count 276).

## 1.9.3 — 2026-10-26

### Guidance — read the flow board for the project, not the whole workspace

The HelmOS backend (master `4632b029`) gave `list_flow_connections` and `list_flow_clusters` optional
`project_id` and `task_id` filters. Unfiltered they return the whole workspace — measured at 190
connections (~31k chars) and 212 clusters (~66k chars), enough to overflow an agent's context; with
`project_id` the same reads were ~1.8k and ~1.3k chars. A bare id that is not a project resolves to that
connection, cluster or task, so read-backs keep working.

- **Every place the plugin tells an agent to read the flow board now names the filter:**
  `list_flow_clusters(project_id)` + `list_flow_connections(project_id)` in `/portal-continue` (read
  first, re-read the board), `/portal-project` (verify the board, the phase-boundary order),
  `/channel-join`, `/channel-coordinate`, the `portal-operator` subagent's read-after-write example, the
  `SKILL.md` read-after-write example, the phase-boundary order in `reference.md` and `canon-gates.md`,
  and the `CANON-FLOW-READ` hint in the gate register (`canon-gate.js`).
- **No gate logic changed.** `CANON-FLOW-READ` matches the two reads by tool name only, so a filtered
  read clears it exactly as an unfiltered one did.
- **Knowledge-graph reading (`SKILL.md`):** one line — `get_knowledge_graph` pages with `node_offset` /
  `edge_offset` and prints the next-page call, and semantic search / `ask_knowledge_graph` cover every
  node, reporting "Searched X of Y". The backend now reads every node; no plugin text stated the old caps.
- The selftest's interpret fixture uses the backend's new "CANDIDATE SURPRISING CONNECTIONS (computed in
  the database over …)" heading instead of the retired "highest-degree" one; the gap parser reads the
  section, not the heading.
- The README's post-update check now asks for **1.9.3** (it still said 1.9.1).

## 1.9.2 — 2026-10-25

### Canon gates — knowledge-graph extraction runs are controllable, and the brakes are never refused

The HelmOS backend now gives every extraction a `run_state` (`idle | running | stopping | paused | stopped |
failed`, plus a computed `stale` when the heartbeat is more than 5 minutes old), a 30-minute deadline that
ends a run `paused`, and four new agent tools. `extract_knowledge_graph(force=true)` no longer starts a
second concurrent run — it only takes over a run reported stale.

- **Eight backend tools the gates could not see are now in `PORTAL_TOOLS` (263 → 271):**
  `stop_knowledge_graph_extraction`, `pause_knowledge_graph_extraction`,
  `resume_knowledge_graph_extraction`, `ask_knowledge_graph`, and `generate`, `check_generation`,
  `list_models`, `read_media`, which had been registered in the backend without being listed. A tool outside
  the list is never gated, so none of these was subject to `CANON-ID`, read-back or the seen set.
- **The run controls owe a read-back.** `stop_`/`pause_`/`resume_knowledge_graph_extraction` are portal
  writes (`stop|pause|resume` joined `WRITE_PREFIX`) and map to `get_knowledge_graph` / `list_knowledge_graphs`
  in `WRITE_READ_MAP` and `reference.md` §3.
- **The brakes are never refused (`KG_BRAKES`).** `stop_` and `pause_knowledge_graph_extraction` are exempt
  from `CANON-DEBT-READ-BACK`, `CANON-DEBT-CLOSEOUT`, `CANON-JOURNAL-PHASE`, `CANON-FLOW-READ`,
  `CANON-KG-CONSULT`, `CANON-JOURNAL-GRAPH` and `CANON-POLICY-FIRST`: no gate that refuses work may refuse
  the call that stops a runaway extraction. Their own read-back is still owed after the call.
- **`resume_knowledge_graph_extraction` is the incremental extract:** in `KG_LEARNING` (never refused by the
  phase gates), `KG_BUILDS`, `CLOSEOUT_CLEARING`, the `rd` bulk summary, and credited as the close-out's
  extract and as `CANON-KG-LEARN`'s extract.
- **`ask_knowledge_graph` counts as consulting a graph** for `CANON-KG-CONSULT` (direct and inside `bulk`),
  and as the close-out's graph read-back. The refusal text, the card and the docs list it.
- **Fixed: `create_knowledge_graph_edge`'s read-back named a call that could never clear it.** The
  obligation was keyed on the EDGE id the write returned, so the gate printed `get_knowledge_graph("<edge
  id>")`. It is now keyed on the write's own `graph_id` (`READ_ARG_SOURCE`, the fourth instance of this
  defect), and a `get_knowledge_graph_node` read — whose reply names the graph and lists the edge — clears
  it too. The node writes were checked for the same defect and do not have it.
- **Docs:** one rule in `reference.md`, `SKILL.md`, `/portal-project` and `/portal-continue` — if extract
  returns "⏳ … still running", poll `get_knowledge_graph` until `run_state` is `idle` before interpreting;
  if it ended `paused`, call `resume_knowledge_graph_extraction`; halt a run with `stop_`/`pause_`;
  `force:true` only resets a stale run. The README's version-check one-liner now reads
  `./management-portal/.claude-plugin/plugin.json` (it pointed at a path that does not exist in this repo).
- Selftest 576 assertions (was 530), including: the brakes pass every phase and debt gate while work is
  refused; the edge's printed read uses the graph id and clears it; an ask satisfies `CANON-KG-CONSULT`;
  each run control owes `get_knowledge_graph`.

## 1.9.1 — 2026-10-09

### Mods

- **Fixed: the command launcher's hover help garbled the list on the Desktop.** 1.9.0 drew each command's
  usage as a floating card over the rows beneath it; the Desktop paints that card with no background, so
  its text and the rows under it overlapped unreadably (owner's screenshot). The floating card is gone.
  Pointing at a command now lights that row's hover scope and swaps its full usage
  (`/portal-cockpit  [project-id | gates | graph | board | settings]`) and description into a **fixed detail
  area under the list** — space reserved, nothing overlaps, nothing jumps. Each row still shows its
  description inline, truncated.
- Measured on the Desktop in 1.9.0: a launcher button really runs the command (`ran
  /management-portal:portal-rearm`), so the plugin-namespaced spelling is the one the engine accepts there.
- Tests: `claude plugin test management-portal` — 45 (a new one holds the launcher to no floating card
  and one scoped detail entry per command, on the terminal and the Desktop).

## 1.9.0 — 2026-10-09

### Canon gates — the knowledge graph is consulted every phase, not only written

- **New `CANON-KG-CONSULT` (blocking, during a run):** the first implementation work and the first portal
  write after each phase boundary need a consult of the run's graph first —
  `semantic_search_knowledge_graph`, a focused `interpret_knowledge_graph` or `get_knowledge_graph` (any
  graph while the run has none). Credited on the run, so sub-agents and restarts inherit it; the prompt
  notice names the exact call.
- **New `CANON-JOURNAL-GRAPH` (blocking):** the phase journal must carry a "What the graph showed" section.
- **New advisories `CANON-KG-LEARN` / `CANON-KG-GAPS`:** a phase passed without extract + interpret;
  interpretation gaps (surprising connections, isolated nodes) not turned into a task or a "won't fix" line.
  `CANON-JOURNAL-PHASE` and `CANON-FLOW-READ` no longer refuse the graph-learning calls.
- **Fixed (measured 2026-10-09):** reads inside `bulk` count for every gate (children of `list_subtasks`
  were never attributed, so `complete_task` over a pending child was allowed); reads past the 20th inner
  call or with stripped args were lost; `CANON-ID` refused row 60 of a 120-row listing; a result that
  overflowed to a saved file (`… Output has been saved to <path>`) is now read from that file (≤ 4 MB).
- Card cap 3000 → 3600 so every gate stays on the card; `status --json` gains an additive `kg` object.
  Selftest 530 assertions (was 450). Like every gate, the new ones are fixture-verified, not yet seen
  refusing a live call.


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
- **Desktop Code tab, measured on 2.1.293:** a docked pane is about 48 columns wide, so the layout puts
  milestone facts on their own line and the band keeps to one short line; `$.ui.status` (the status line)
  is **not drawn** on the Desktop surface — there the cockpit and band carry the same facts.
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
