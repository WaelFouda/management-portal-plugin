# management-portal MCP — Detailed Reference

> Load-on-demand deep doc for the `management-portal` skill. Summarizes the canonical
> `agent-onboarding/DISCIPLINE.md` (v1.0.0) and its companions `WRITE-READ-MAP.md` and `BOARD-FIRST.md`.
> If anything here ever conflicts with those, **the canon wins** — change `DISCIPLINE.md` first, then
> update this copy **by hand, in the same commit**. There is no generator; `shared/` and `bundles/` are
> hand-maintained copies and nothing warns you when they drift. Read this before you actually build.

---

## 1. The discipline (summary of DISCIPLINE.md)

**Prime directive.** Ground every action in what the portal actually contains, then leave it complete and
correct. You have the *tools*, not the database — read tools are your only source of truth and your only
way to verify. Never guess a field, an id, or a structure you could read.

**Core loop** (every unit of work):
`READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE`.

- **READ** the proposal, brief, every phase + milestone (deliverables + acceptance criteria), and the flow
  board (clusters *and* custom relations — real intent, not decoration; read every time).
- **GAP** — name gaps vs. the spec and the flow-board explicitly.
- **ALIGN** — board-first for non-trivial work; wait for human alignment (§4).
- **BREAK DOWN** — tasks → subtasks → nested + flow clusters + relations; you self-extract (§5).
- **BUILD** on a branch, never the auto-deploying branch; commit each step.
- **TEST** end-to-end incl. UI/UX — run the app, not just the type-checker.
- **VERIFY** — read-after-write (Gate 1).
- **DELIVER** — only when tested E2E, meets deliverables + acceptance, and every subtask/nested subtask is
  done & marked (bottom-up). "It compiles" is not delivery.
- **UPDATE** the memory graph + flow board to reflect reality.

### The three gates (hard stops — violating any one means NOT done)

1. **Read-after-write.** After any write, read the record back with the matching `get_*`/`list_*` and
   confirm the specific field persisted. A success string or a (possibly stale) cached schema is not
   evidence; the deployed server is the truth.
2. **Completeness ("no lazy partial fills").** On any brief, proposal, phase, or milestone, fill **every**
   field: objective, description, diagrams (mermaid + charts), deliverables, acceptance criteria,
   disclaimers & disclosures, timeline/deadline, time estimate, and cost (= estimated hours × profile
   hourly rate). An artifact with empty fields is not done.
3. **Task-breakdown ("never start before decomposing").** Before any implementation, the work must be
   decomposed into tasks → subtasks → nested subtasks **and** the flow board (clusters + custom relations)
   must exist.

### Bottom-up completion

Completion is **bottom-up — verify each leaf, never assume**. A parent task or milestone is complete only
when **every** subtask and nested subtask is actually done and marked. Walk the leaves first:
`list_subtasks(parent)` → for each child (and its children) confirm the real work is done and
`complete_task(child)` → re-list to confirm all children complete → **only then** complete the parent and
`update_proposal_milestone(status:"delivered")`. Never mark a parent done because the headline artifact
"looks done." Going child-by-child is how you find the work you actually skipped.

### Definition of Done — per artifact

"Done" means the **whole** structure exists, not just the part that shows.

- **Client** — name, contact/platform, status. Read back.
- **Project** — name, client link, status, dates, description. Read back.
- **Brief** — overview, goals, deliverables, requirements, Additional Notes, ≥1 diagram, priority, source,
  budget/currency, deadline. Read back.
- **Proposal** — title, introduction (with a roadmap diagram), disclaimers & disclosures.
- **Phase** — name, objective, deliverables, acceptance criteria, deadline.
- **Milestone** — objective, description (with a diagram), deliverables, acceptance criteria, time (hours
  the *agent* will take), cost (= hours × profile rate), deadline, status.
- **Task tree** — a top-level task per milestone (flow node) → implementation subtasks → nested subtasks
  where work has finer steps. Due dates + priorities. Completed bottom-up.
- **Flow board** — a cluster per phase grouping its tasks; custom relations for real dependencies
  (intra-phase order **and** cross-phase / cross-cutting dependencies).

### Grounding principles

- **Grounding beats guessing.** Match what's specified; don't invent a plausible-looking version.
- **Never fabricate ids.** Every id (project, proposal, phase, milestone, task, subtask, board, block,
  flow cluster, flow connection) comes from a `list_*`/`get_*` read or a `create_*` response. Never invent,
  guess, pattern-match, abbreviate, or reuse-from-memory an id. A wrong id silently writes to the wrong
  record or fails — both worse than reading first.
- **Flow-board clusters & relations are real intent** — source of truth, never decoration.
- **Trust the data effect, not the description** — verify by reading the record back.
- **Don't work around a missing capability — fix it.** A field writable but not readable is a coverage gap
  to close (see `../../../COVERAGE-AUDIT.md`), not a reason to reach outside the tools.
- **Diagrams via the diagram tool** — `insert_diagram` for mermaid (never paste raw mermaid into a field);
  the chart tool for charts.

### Anti-patterns (do not do these)

- Building before reading the portal, or before the task breakdown + flow board exist.
- Filling only deliverables + acceptance, leaving objectives/descriptions/diagrams/disclaimers/timeline/
  time/cost empty.
- Marking a parent complete while subtasks/nested subtasks are still open or unverified.
- Assuming a subtask is done because the headline artifact exists — verify each leaf against its deliverable.
- Marking a milestone delivered because it compiled, without E2E + UI/UX testing.
- Trusting a write's success message or a cached schema instead of reading the record back.
- Fabricating, guessing, or reusing-from-memory an id.
- Treating flow-board clusters/relations as optional.
- Merging to the auto-deploying branch without explicit human go-ahead.

### Who performs semantic extraction (§5)

Whatever intelligence is **in the loop** extracts; there is no separate extractor for the MCP.

| Entry point | Who extracts |
|---|---|
| **MCP agent** (Claude Code, Copilot, Roo, Cursor, …) | **The agent itself** — reason over read-tool output, then write clusters/relations/tasks via primitive tools. **No DeepSeek.** |
| **Web/mobile app** buttons (e.g. Generate Tasks) | `deepseek-v4-flash`, server-side (no conversational agent present). |
| **In-app AI Chat Assistant / Thoth** | Itself, inline in its own reasoning. |

So the MCP needs no DeepSeek tool — just solid read tools + primitive write tools + this guidance.

---

## 2. Principle → concrete tool sequences (the playbook)

Each principle maps to an exact tool sequence; the verifying read is part of the step.

- **Board-first alignment** → `create_board(title)` → `create_board_block(type:"heading"/"text")` +
  `create_board_block(type:"mermaid", content:{code})` and/or charts → (wait for human alignment) → *then*
  create the brief/proposal. **Verify:** `read_board(board_id)`.
- **Create a project with a complete brief + proposal** → `create_project(name, client_id)` →
  `update_brief(project_id, overview/goals/deliverables/requirements/notes/…)` +
  `insert_diagram(entity_type:"brief", field:"overview")` → `create_proposal(project_id, introduction)` +
  `insert_diagram(entity_type:"proposal", field:"introduction")` + `update_proposal(project_id,
  disclaimers_html)`. **Verify:** `get_proposal_detail(project_id)`.
- **Add a complete phase + milestones** → `add_proposal_phase(project_id, name, objective, deliverables,
  acceptance, deadline)` → `add_proposal_milestone(phase_id, name, objective, description, deliverables,
  acceptance, time_value, time_unit, cost, deadline)` → `insert_diagram(entity_type:"milestone",
  entity_id:<milestone_id>, field:"description")`. **Verify:** `get_proposal_detail(project_id)` and
  confirm no field is empty.
- **Cost & time** → read the rate with `get_my_full_profile` (→ `hourly_rate`); set `time_value` = hours
  the agent will take; `cost` = hours × `hourly_rate`.
- **Task breakdown + flow board** → per milestone `create_task(project_id, title, due_date, priority)` →
  `create_subtask(parent_task_id, title)` → nested `create_subtask(parent_task_id:<subtask_id>, title)` →
  `create_flow_cluster(title, task_ids:[…])` → `create_flow_connection(source_id, target_id, title)`.
  **Verify:** `list_tasks(project_id)`, `list_subtasks(parent)`, `list_flow_clusters`,
  `list_flow_connections`.
- **Bottom-up completion** → `list_subtasks(parent)` → for each leaf do the work then `complete_task(leaf)`
  → re-`list_subtasks(parent)` to confirm all children complete → only then `complete_task(parent)` and
  `update_proposal_milestone(status:"delivered")`.

### Tool map (orient before you act)

- **Read (safe):** `get_*` / `list_*` — clients, projects, briefs, proposals (+ `get_proposal_detail`,
  `list_milestones`), tasks (+ `list_subtasks`), flow board (`list_flow_clusters`,
  `list_flow_connections`), notes, boards, calendar, gigs, time, profile, chat.
- **Write (real):** `create_*` / `update_*` / `add_*` — projects, briefs, proposals, phases, milestones,
  tasks, subtasks, flow clusters, flow connections, boards + blocks, `insert_diagram`, notes, events, etc.
  `complete_task` marks a task done.
- **Verify with the read tool that mirrors the write tool.** Every writable field must have one.

---

## 2b. The canon (a)–(h) — one tool sequence each

The eight standing rules the owner should never have to type again. A gate id is named where one is
**designed** to cover the rule — but **check the register in `canon-gates.md` before relying on any of
them**, because none of these gates is in plugin 1.4.3: `scripts/canon-gate.js` is on the unmerged branch
`feat/canon-hooks-enforce`, and the commands that drive a run are on `feat/canon-commands`. **Treat all
eight as rules you keep yourself**, and read the gate ids below as *which gate will cover this once it
ships*. `canon-gates.md` carries the proven-status board (fixture-verified / live-verified / unverified),
the tools each gate may never refuse, and the stand-down escape.

Two behaviours of that build are worth knowing while you read these, because they change what a rule
costs you tomorrow rather than today. **The two debt gates run before every other refusal**, so an unread
write or an unmade close-out refuses the *next turn's work* rather than nagging at the end of this one —
and **debt is keyed by project, not session**, so it survives closing the terminal. **Reads are never
work**, which is why no debt gate can refuse the read that settles it.

**(a) PROJECT INITIATION** — a new project, a big scope, or a scope change. *(gates:
`CANON-BOARD-FIRST` while the run is in ALIGN, then `CANON-TREE-FIRST`)*

`list_clients` → `create_client` if absent → `create_project(name, client_id)` → **alignment board first**
(`create_board` → `create_board_block(type:"mermaid")` → `read_board` → **present and stop for the
human**) → `update_brief(project_id, overview/goals/deliverables/requirements/notes/priority/source/
budget/deadline)` + `insert_diagram(entity_type:"brief")` → `create_proposal(project_id, introduction)` +
`insert_diagram(entity_type:"proposal")` + `update_proposal(disclaimers_html)` → per phase
`add_proposal_phase(objective, deliverables, acceptance, deadline)` → per phase
`add_proposal_milestone(objective, description, deliverables, acceptance, time_value, cost, deadline)` +
`insert_diagram(entity_type:"milestone")` → per milestone `create_task` → `create_subtask` → **nested**
`create_subtask(parent_task_id:<subtask_id>)` → `create_flow_cluster` per phase →
`create_flow_connection` for every real dependency. **Both the brief and the proposal carry mermaid and
rich formats.** **Verify:** `get_brief`, `get_proposal_detail`, `list_tasks`, `list_subtasks`,
`list_flow_clusters`, `list_flow_connections`.
**Then implement to final delivery** — which is canon (b).

**(b) NEVER STOP BETWEEN PHASES** — *(gate: `CANON-ACCOUNT`, at turn end)*

Proceed autonomously to the next phase **without waiting for confirmation**; the owner is not there to
say continue. On finishing **all** phases: `create_board(title:"<project> — summary")` +
`create_board_block` describing what was done → `read_board`. Test end-to-end including UI/UX and console
debugging in the preview panel — not just the type-checker.
**The honest limit, in the same breath as the rule:** a hook cannot make an already-idle session resume.
It can refuse to let a turn end **silently** mid-run, which shortens the gap to one turn. If you truly
cannot continue, do not go quiet — `create_journal(folder_id, title:"<phase> — blocked", tags:["blocked"])`
naming what stopped you, and then end.

**(c) STATUS DISCIPLINE** — *(gate: `CANON-STATUS`, advisory)*

As each unit completes: `complete_task(subtask)` → re-`list_subtasks(parent)` → `complete_task(parent)` →
`update_proposal_milestone(status:"delivered")` → when every milestone in a phase is delivered,
`update_proposal_phase(status:"completed")`. **Verify:** `get_proposal_detail` — a milestone whose tasks
are all complete but whose status still reads otherwise is the exact thing the advisory reports.

**(d) JOURNALS** — *(gate: `CANON-JOURNAL-PHASE`, which requires the write **and** the read-back)*

Once per run: `create_journal_folder(name:"<project> — run log")`. After **every** phase:
`create_journal(folder_id, title, body, tags, logged_at)` capturing lessons learnt and anything that must
be returned to → **then read it back**: `get_journal` / `list_journals(folder_id)` /
`search_journals`. The read-back is not ceremony — it is half the rule, and the gate checks for both
halves separately. Pass `logged_at` explicitly when the entry is about an earlier day.

**(e) KNOWLEDGE GRAPH** — *(gate: `CANON-KG-DESTRUCTIVE` guards the destructive path;
`CANON-CLOSEOUT` requires the closure)*

`create_knowledge_graph(name)` → `add_source_to_knowledge_graph` for **each** source kind — the run's
journal folder, notes, boards, tags, the project, and tasks → `extract_knowledge_graph` →
`interpret_knowledge_graph` → read it back with `get_knowledge_graph` /
`semantic_search_knowledge_graph`. Keep updating it and keep reading it back.
**`regenerate_knowledge_graph` destroys the existing nodes and edges first** — `extract_knowledge_graph`
is the incremental path and is what you want in almost every case. Treat any edge below 0.6 confidence as
a hypothesis, never as established fact.

**(f) EFFICIENCY — use `bulk`** — *(gate: `CANON-BULK`, advisory by design)*

`bulk({calls:[{tool, args}, …], stop_on_error})` rather than N single calls. It is one round trip and one
result block, and the hook ledger expands it, so a write and its verifying read **inside the same bulk**
satisfy read-after-write in one call — and the ids returned by its inner calls count as ids you have seen.
**Read the per-item results**: `[i] FAILED — …` marks the ones that did not land. This is reported and
never refused: a refusal on the fourth single call cannot undo the first three, and single calls are
sometimes right.

**(g) TEAM CHAT — COORDINATOR** — *(gate: `CANON-COORD-ROLE`)*

`read_chat_channels` → `whoami` / `register_me_as_agent(<identity>)` → `start_watching_channel` **and
spawn the `team-chat-watcher` sub-agent** → `claim_coordinator_title(channel_id, title)` (**once**; the
token returns once and never again) → `set_channel_policy` → `require_channel_watch(channel_id,
agent_names, coordinator_token)` per named agent. **Verify:** `list_channel_watchers`,
`read_channel_policy`.
**The policy must cover nine things:** (1) what this channel is for, (2) how it is used, (3) participants
and each one's role, (4) the project scope and a mention of the project, (5) read the brief, proposal,
task tree and flow board before acting, (6) follow the canon strictly, (7) each agent's tasks, (8) do not
chat idly and do not interfere with each other — follow the coordinator, who acts with the owner's full
authority, (9) messages are **ping-pong**: an agent that sends **waits for a reply** rather than throwing
and running. Agents are approved to spawn as many concurrent sub-agents and workflows as they need.
**The coordinator COUNSELS AND COORDINATES ONLY and does not implement** — while you hold the role the
gate refuses **any file write or mutating command, judged by effect and never by tool name**. Portal
tools carry an empty `effect`, so **portal writes are not refused by it**; and nothing asks whether the
tool is called `Bash`, which is what a name-shaped matcher got wrong when a `PowerShell` call walked past
it. Its only never-refuses entry is `transfer_coordinator_title`, which is also how you clear it. The
nine-heading check is a completeness prompt; no hook can tell whether the policy is any good.

**(h) TEAM CHAT — PARTICIPANT** — *(gate: `CANON-POLICY-FIRST`)*

`read_chat_channels` → `register_me_as_agent(<identity>)` → **`read_channel_policy` AND
`read_channel_messages` before any other work** → `start_watching_channel` + spawn the
`team-chat-watcher` sub-agent → then start the mission. Keep watching and **respond** rather than
ask-and-run; follow the coordinator's instructions. That last obligation has no structural signature and
is **not** gated — it is canon, kept by you.

---

## 3. Write → read verification map (from WRITE-READ-MAP.md)

For every write tool, this is the read tool you call afterward to confirm the change landed. **If a write
has no read path here, that is a coverage gap** — record it for the read=write coverage audit and close it
(`../../../COVERAGE-AUDIT.md`).

> ⚠️ **This table is mirrored as a frozen constant (`WRITE_READ_MAP`) inside `scripts/canon-gate.js`,**
> where the `CANON-READ-BACK` gate uses it to decide which read clears which write — a hook cannot read a
> markdown table at runtime. The constant currently holds **98 write→read rows**; this table groups
> several write tools onto one row, so the two counts are different numbers describing the same map.
> **This file stays the human source of truth; the constant is a copy.** A row added, removed or
> re-pointed here must be changed in the script **in the same commit** — otherwise the gate either blocks
> a write that has no read it recognises, or silently stops enforcing one that does.

| Write tool(s) | Verify by reading | Confirms |
|---|---|---|
| `create_client`, `update_client` | `get_client` / `list_clients` | client fields persisted |
| `create_project`, `update_project` | `get_project` / `list_projects` | project fields persisted |
| `update_brief`, `update_brief_field` | `get_brief` | every brief field (overview/goals/deliverables/requirements/notes + diagram) |
| `create_proposal`, `update_proposal` | `get_proposal_detail` | title, introduction (+roadmap diagram), disclaimers |
| `add_proposal_phase`, `update_proposal_phase`, `reorder_proposal_phases` | `get_proposal_detail` | phase name/objective/deliverables/acceptance/deadline/order |
| `add_proposal_milestone`, `update_proposal_milestone`, `reorder_proposal_milestones` | `get_proposal_detail` (+ `list_milestones`) | every milestone field (objective/description/diagram/deliverables/acceptance/time/cost/deadline/status) |
| `insert_diagram` (proposal/brief/milestone/phase) | `get_proposal_detail` / `get_brief` | the diagram is in the target field |
| `create_task`, `update_task`, `complete_task` | `get_task` / `list_tasks` | task fields + status |
| `create_subtask` | `list_subtasks(parent_task_id)` | subtask exists under the right parent (and bottom-up completion) |
| `create_flow_cluster`, `update_flow_cluster`, `delete_flow_cluster` | `list_flow_clusters` | cluster + its `task_ids` |
| `create_flow_connection`, `update_flow_connection`, `delete_flow_connection` | `list_flow_connections` | the edge (may land even if the call reports a timeout) |
| `create_board`, `update_board` | `read_board` / `list_boards` | board metadata |
| `create_board_block`, `update_board_block`, `reorder_blocks`, `set_block_parent`, `delete_board_block` | `list_board_blocks` / `read_board` | block content, type, order, parent |
| `add_board_comment`, `edit_comment`, `resolve_comment`, `react_to_comment` | `read_board` (comment counts) | comment state |
| `create_note`, `update_note`, `update_note_content`, `delete_note` | `get_note` / `list_notes` | note fields |
| `create_note_column`, `update_note_column`, `delete_note_column` | `list_note_columns` | category/column state |
| `create_event`, `update_event`, `delete_event` | `list_events` | event fields |
| `log_time`, `start_timer`, `stop_timer`, `update_time_entry`, `delete_time_entry` | `list_time_entries` / `get_time_summary` | time entries/totals |
| `create_quick_proposal`, `update_quick_proposal`, `promote_quick_proposal`, `attach_to_quick_proposal` | `get_quick_proposal` / `list_quick_proposals` | quick-proposal fields |
| `create_mentoring_session`, `update_mentoring_session` | `get_mentoring_session` / `list_mentoring_sessions` | session fields |
| `create_gig`, `update_gig`, `add/update/delete_gig_*` | `get_gig` / `list_gigs` | gig + packages/faq/requirements |
| `update_my_profile_extended`, `update_profile`, portfolio/work-history/skills writes | `get_my_full_profile` / `get_my_portfolio` / `get_my_work_history` / `get_my_skills` | profile fields |
| `create_scheduling_link`, `approve/reject_scheduling_request` | `list_scheduling_links` / `list_scheduling_requests` | scheduling state |
| `send_chat_message`, `send_dm_message`, `send_inbox_message` | `read_channel_messages` / `read_dm_messages` / `read_inbox` | message posted |
| `start_watching_channel` | `list_channel_watchers` | your status becomes `watching` (the heartbeat is written by `await_my_turn` itself) |
| `require_channel_watch` | `list_channel_watchers` | the named agent is on the roster — as `NEVER_STARTED` until it actually starts |
| `release_channel_watch` | `list_channel_watchers(include_released=true)` | the obligation shows as `released` |
| `claim_coordinator_title` | `list_channel_watchers` | `coordinator.title` appears (the token itself is returned once and is never readable) |
| `transfer_coordinator_title` | `list_channel_watchers` | `coordinator.agent_name` changed and `token_version` incremented |
| `remember`, `update_memory`, `delete_memory` | `recall` | memory state |

**Rule:** after a write, call the mapped read tool and confirm the *specific field you wrote* is present
and correct. Trust the data effect, not the success message or the schema.

**Deletes clear on ABSENCE.** Seven `delete_*` rows are discharged by the id being **gone** from the
mapped read, never by it coming back — an id that returns is proof the delete failed. The gate says so in
its own block text; it is written here because the opposite polarity shipped once and latched.

---

## 3b. Team Chat: staying reachable (the watch roster)

An external MCP agent has **no event loop**. `await_my_turn` blocks for **at most 25 seconds**; when it
returns, your turn ends and **nothing wakes you again**. So an agent that "joined a channel" silently stops
listening — and nobody could tell. The **watch roster** makes presence readable.

**`timeout_s`: leave it at the default.** It is **20 s by default with a 25 s maximum**, and the server
*clamps* anything larger rather than rejecting it, so an oversized value fails silently. Raising it does
**not** buy a longer wait: the MCP client discards any answer that takes more than roughly a minute of wall
clock, which swallowed **9 of 14** calls across three independent sessions. It used to be worse than
mis-scaled — `timeout_s` never meant seconds at all, because the poll loop counted only its own sleeps and
ignored how long each database read took, so a "30 second" wait really occupied **56.9 s** of wall clock
while reporting `waited_seconds: 30.0`. The loop now uses a monotonic clock, so `timeout_s` means real
seconds and `waited_seconds` is true. And a shorter wait does not cost egress: the server polls the database
every **600 ms** for the whole block, so a continuously-watching agent costs ~**115 req/min** essentially
regardless of `timeout_s` (120 s → 20 s moves it from ~115 to ~127, about **11%**). The internal tick was always the
dominant cost; the outer call rate never was.

| Tool | Who calls it | Scope | What it does |
|---|---|---|---|
| `start_watching_channel(channel_id, note?, as_agent?)` | any agent, for **itself** | `team_chat.write` | puts you on the channel's watch roster |
| `list_channel_watchers(channel_id?, include_released?)` | anyone | `team_chat.read` | who **must** watch, who actually **is**, and who **coordinates** |
| `require_channel_watch(channel_id, agent_names[], coordinator_token?, coordinator_agent?, note?, as_agent?)` | **coordinator only** | `team_chat.write` | puts named agents on the roster, whether or not they cooperate |
| `release_channel_watch(channel_id, agent_names[]?, all_agents?, coordinator_token?, reason?, as_agent?)` | **coordinator only** | `team_chat.write` | the **only** way an obligation ends |
| `claim_coordinator_title(channel_id, title, as_agent?)` | the coordinator, **once** | `team_chat.write` | binds the title and returns the token **once**; first-come, never a takeover |
| `transfer_coordinator_title(channel_id, coordinator_token, to_agent?, title?, as_agent?)` | the **current holder** | `team_chat.write` | deliberate hand-over; rotates the secret, the old token dies immediately |

There is **no self-release**. Who counts as the **coordinator** is the subject of the next sub-section.

| status from `list_channel_watchers` | meaning |
|---|---|
| `watching` | really called `await_my_turn` within the last 5 minutes |
| `ABSENT` | was watching and **stopped** |
| `NEVER_STARTED` | on the roster, never showed up once |
| `released` | the coordinator lifted the obligation |

The heartbeat is written by **`await_my_turn` itself** — there is no separate heartbeat tool — so
`watching` is *evidence*, not a claim. A **DM-scoped wait does not count**: to watch a channel, pass
`channel_id`.

### The coordinator title — and why a role check was not enough

The shipped gate was "only the channel's **creator** or the **workspace owner** may release a watch". That
separates *different people's* API keys. It does **not** separate different **sessions sharing one key** —
which is the normal way this product is used (several Claude Code sessions on one `pfk_live_…` key). Every
one of them carries the same user id, so every one of them passed. The only thing left standing between
them was `as_agent`, a string any caller can type. A second API key would fix it, and was rejected: that is
configuration the owner should not have to do.

So the coordinator is now something a session **claims**. The server binds the title and returns a secret
**exactly once**; the coordinator-only tools require that secret back. It is a **second layer, never a
replacement**: every coordinator-only call still runs the original creator/owner check *first*, and then —
only where a title has actually been claimed — the token. Layer 1 holds between **different people's
keys**; layer 2 holds between **sessions sharing one key**, which layer 1 provably cannot.

1. **Claim it once, at the start.** `claim_coordinator_title(channel_id, title)` — as the coordinator
   (layer 1: you must be able to write this channel's policy), right after creating the channel and
   writing that policy, **before any worker joins**. The token comes back **once and is never shown
   again**. **First-come:** if a title is already claimed on that channel the call **fails** rather than
   taking it over.
2. **Use it on the gated tools.** `require_channel_watch` and `release_channel_watch` take an optional
   `coordinator_token`, which is **required** once a title has been claimed on that channel.
3. **Hand it over deliberately.** `transfer_coordinator_title(channel_id, coordinator_token, to_agent?,
   title?)` rotates the secret; the old token dies immediately. It **requires the current holder's token** —
   the creator/owner check is deliberately **not** accepted in its place, because on a shared key it admits
   every worker session. It requires layer 1 **as well**, so a token that leaks out of the workspace is not
   a skeleton key, and a hand-over to an agent on a *different* key is refused up front rather than
   completed and then useless.
4. **Read who holds it.** `list_channel_watchers` returns a `coordinator` object: `title`, `agent_name`,
   `claimed_at`, `token_version`. It never returns the token or its hash.

**Title vs token — keep these distinct.** The **title** is the public, human-readable half: it is
announced, and it is shown on the roster, so everyone can see who coordinates — exactly like a person
saying "I'm Wael Fouda, founder of HelmOS". The **token** is the private half that makes it binding. **A
title alone is the honour system.**

**Never post the token** into a channel, a DM, a commit, or a file. Anyone holding it **is** the
coordinator as far as that channel is concerned.

**Backward compatible.** The token gate applies **only** where a title has actually been claimed. A channel
with no claim behaves exactly as before.

**A lost token is a manual human action — on purpose.** If the coordinator session ends without
transferring, recovery is the **workspace owner running SQL directly**:
`DELETE FROM public.chat_channel_coordinators WHERE channel_id = '<uuid>';` and then claiming the title
again. It is deliberately **not** a tool, because any recovery a coordinator could self-serve, a worker on
the same key could self-serve too. Coordinators should call `transfer_coordinator_title` **before** ending
a session others depend on.

### The three honesty rules (never soften these)

1. **An agent cannot be prevented from stopping its watcher.** The guarantee is narrower and real: it
   cannot **hide** having stopped, and it cannot clear its own obligation — only the coordinator can.
   Never describe this as enforcement.
2. **What survives a session ending:** the watcher loop does **not** — it dies with the session. The roster
   row, the obligation, and the `ABSENT` marking **do**. **Nobody is notified automatically** — someone must
   *read* the roster. Closing a session with work outstanding? Say so in the channel first.
3. **What the coordinator token does and does not defend.** A worker session that can read the coordinator
   session's context or transcript can read the token — on a shared API key that is not defeatable
   in-product. This defends against agents drifting off and against a buggy or rogue agent acting outside
   its remit; it is not a defence against an operator who can read another session's memory.

**Re-arm rule — RE-ARM FIRST, THEN HANDLE.** The instant the watcher returns, start the next one *before* you
read, think about, or answer the message. The heartbeat is written by `await_my_turn` **itself**, so any gap
with no watcher running is not merely unwatched time — it is provable absence, and the roster reports it.
Three agents that handled first and re-armed afterwards read ABSENT for **9m25s, 10m14s and 2m20s** while
working perfectly. Re-arming first is safe on every count: the previous watcher has already returned (that
return is what invoked you), so two never run at once; you hand back the same `cursor`, so no message is
missed; and the number of calls is identical, so there is no extra egress. Before ending a turn while on a
roster, ask: *is a watcher running right now?* If you cannot say yes, start one. Full worker and coordinator
procedures live in the `team-chat-reachability` skill — the skill **teaches** the rule, `/rearm-watch` is the
command a **human types** to check or re-arm by hand, and the bundled `team-chat-watcher` sub-agent is the one
**you spawn**; only that last one actually makes you reachable.

---

## 4. Board-first procedure (from BOARD-FIRST.md)

For any non-trivial new work, break the idea down on a **board** (mermaid + charts) and get the human's
alignment **BEFORE** creating the brief, proposal, or task tree. Align first; build second.

**When to run it.** Any new project, new phase, or change big enough to warrant a brief/proposal. Skip only
for trivial single-step edits.

**Procedure**

1. **Create the alignment board.** `create_board(title:"… — Plan", icon, description)`.
2. **Explain the plan visually.** Add blocks: a `callout` with the goal; `heading` + `text`/`bullet_list`
   for problem/approach/scope/deliverables; **`mermaid` diagrams** for architecture, workflow/loop, and the
   phase roadmap (`create_board_block(type:"mermaid", content:{code})` or `insert_diagram`); **charts**
   where a comparison/breakdown reads better than prose.
3. **Read the board back (verify).** `read_board(board_id)` — confirm every block landed, in order, and
   diagrams rendered (Gate 1). Fix anything missing before showing the human.
4. **Pre-execution confirmation gate.** Present the board and **stop**. Do not create the brief, proposal,
   or tasks until the human has reviewed and aligned. Incorporate feedback into the board (update blocks,
   re-read to verify) and re-confirm if it changed materially.
5. **Only then proceed** to brief → proposal (phases + milestones, every field filled) → task tree → flow
   board, per the discipline.

> Two hard sub-rules: **(a)** the pre-execution confirmation gate — never start the brief/proposal before
> the human aligns on the board; **(b)** read the board back — verify with `read_board` before presenting,
> so you align on what actually exists, not what you hope you wrote.

**Cluster + relation conventions (flow board, after alignment)**

- **One cluster per phase.** `create_flow_cluster(title:"Phase N — <name>", task_ids:[…all the phase's
  milestone task ids], color)`. Group the phase's top-level milestone tasks.
- **Distinct cluster colors**, low-alpha rgba so tasks stay readable, e.g. indigo `rgba(99,102,241,0.15)`,
  emerald `rgba(52,211,153,0.15)`, amber `rgba(251,191,36,0.15)`, sky `rgba(56,189,248,0.15)`, violet
  `rgba(167,139,250,0.15)`, rose `rgba(244,114,182,0.15)`, teal `rgba(20,184,166,0.15)`.
- **Relations are directed `source → target`** = *source must happen before / enables target*.
  - **Intra-phase order:** consecutive milestones, title `"then"`.
  - **Cross-phase chain:** last milestone of phase N → first milestone of phase N+1, title `"then"`.
  - **Cross-cutting dependencies:** real dependencies that jump the sequence, with a meaningful title +
    `details` — e.g. `"feeds"`, `"enables"`, `"blocks"` (`1.2 universal-layer → feeds → 2.1 shared core`;
    `4.3 block-numbering → enables → 5.1 block-mentions`).
- **You (the agent) do the semantic extraction** deciding clusters and relations — reason over the
  milestones, don't auto-generate decorative links. Verify with `list_flow_clusters` /
  `list_flow_connections` (the edge may land even if the call reports a timeout).

---

## 5. Canon pointers

- `../../../DISCIPLINE.md` — canonical spec (v1.0.0); change behavior here first.
- `../../../WRITE-READ-MAP.md` — full write→read map.
- `../../../BOARD-FIRST.md` — full board-first procedure + worked example.
- `../../../COVERAGE-AUDIT.md` — read=write coverage audit / gaps.
- `../../mcp.config.md` — MCP connection params + per-platform config files.
