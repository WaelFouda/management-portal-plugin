# management-portal MCP — Detailed Reference

> Load-on-demand deep doc for the `management-portal` skill. Summarizes the canonical
> `agent-onboarding/DISCIPLINE.md` (v1.0.0) and its companions `WRITE-READ-MAP.md` and `BOARD-FIRST.md`.
> If anything here ever conflicts with those, **the canon wins** — change `DISCIPLINE.md` first, then
> regenerate this. Read this before you actually build.

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

## 3. Write → read verification map (from WRITE-READ-MAP.md)

For every write tool, this is the read tool you call afterward to confirm the change landed. **If a write
has no read path here, that is a coverage gap** — record it for the read=write coverage audit and close it
(`../../../COVERAGE-AUDIT.md`).

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
| `remember`, `update_memory`, `delete_memory` | `recall` | memory state |

**Rule:** after a write, call the mapped read tool and confirm the *specific field you wrote* is present
and correct. Trust the data effect, not the success message or the schema.

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
