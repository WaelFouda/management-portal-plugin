# Operating the Management-Portal MCP — Agent Discipline

> Canonical source of truth for how an AI coding agent must operate the **management-portal MCP**.
> Every platform bundle (Claude Code, VS Code GitHub Copilot, Roo Code, Cursor) wraps this one document.
> If you change how agents should behave, change it **here** first, then regenerate the adapters.

**Version:** 1.0.0 · **Status:** ratified · **Last updated:** 2026-06-10.
Bump the version (semver) on any change to this spec, add a line to the Changelog, then regenerate the
platform adapters so they never drift from this source.

---

## 0. Who this is for

Any AI agent that can call the management-portal MCP tools — through Claude Code, VS Code GitHub
Copilot, Roo Code, Cursor, or any other client — **and** the in-app AI Chat Assistant / Thoth, which
share the same tool registry. You operate a real freelancer's workspace: clients, projects, briefs,
proposals, tasks, a flow board, calendar, notes, boards, gigs, time, and team chat. **Writes change
real data.** Act like it.

## 1. Prime directive

**Ground every action in what the portal actually contains, then leave the portal complete and
correct.** You have the *tools*, not the database — so the portal's read tools are your only source of
truth and your only way to verify. Never guess a field, an **id**, or a structure you could read.

## 2. The core loop

Run this loop for every unit of work. Do not skip steps.

```
READ  ──▶ GAP  ──▶ ALIGN ──▶ BREAK DOWN ──▶ BUILD ──▶ TEST ──▶ VERIFY ──▶ DELIVER ──▶ UPDATE
 │        │         │          │             │         │        │           │           │
 │        │         │          │             │         │        │           │           └─ memory + flow board
 │        │         │          │             │         │        │           └─ mark delivered ONLY if criteria met
 │        │         │          │             │         │        └─ read-after-write (read the record back)
 │        │         │          │             │         └─ E2E incl. UI/UX
 │        │         │          │             └─ on a branch, never on the deploy branch
 │        │         │          └─ tasks → subtasks → nested + flow clusters + custom relations
 │        │         └─ a board (mermaid + charts) so the human aligns BEFORE the brief/proposal
 │        └─ what's missing vs. the spec (and the flow-board clusters/relations)
 └─ proposal, brief, phases, milestones, acceptance criteria, deliverables, flow board (clusters + relations)
```

1. **READ** — Before doing anything, read the relevant records: the proposal, brief, every phase and
   milestone (with **deliverables** and **acceptance criteria**), and the **flow board** (clusters
   *and* custom relations). The clusters and relations are not decoration — they encode real intent
   (what groups together, what depends on what). Read them every time.
2. **GAP** — Compare what exists to what the spec asks for. Name the gaps explicitly.
3. **ALIGN (board-first)** — For any non-trivial new work, create an **alignment board** first:
   explain the plan with **mermaid diagrams and charts** so the human can align *before* you create the
   brief/proposal. Wait for alignment.
4. **BREAK DOWN (task-breakdown gate)** — Decompose the work into **tasks → subtasks → nested
   subtasks**, and build the **flow board** (clusters per phase + custom relations for dependencies).
   You perform the semantic extraction yourself (see §5). **Do not start building until this exists.**
5. **BUILD** — Implement on a **branch**, never on the auto-deploying branch. Commit each step.
6. **TEST** — End-to-end, including **UI/UX**. Run the app, not just the type-checker.
7. **VERIFY (read-after-write gate)** — After every write tool, call the matching `get_*`/`list_*`
   tool and confirm the change actually landed. Trust the **data effect**, not the success message or
   the schema.
8. **DELIVER** — Mark a milestone delivered **only** when it is tested end-to-end (incl. UI/UX) **and**
   meets its deliverables + acceptance criteria, **and** every one of its subtasks/nested subtasks is
   done and marked (see §4, bottom-up). "It compiles" is not delivery.
9. **UPDATE** — Update the memory graph and the flow board to reflect reality.

## 3. The three gates

These are hard stops. Violating any one means the work is **not done**.

### Gate 1 — Read-after-write
You have tools, not a database. After any write, **read the record back** with the matching
`get_*`/`list_*` tool and confirm the field actually persisted. Never trust a success string or a
schema. A stale cached tool schema is not evidence of anything — the deployed server is the truth.
Concretely: `update_proposal_milestone(...)` → `get_proposal_detail(project_id)` and confirm the field;
`create_task(...)` → `list_tasks(project_id)` and find the row; `create_flow_connection(...)` →
`list_flow_connections` and confirm the edge (it may have landed even if the call reported a timeout).

### Gate 2 — Completeness ("no lazy partial fills")
When you create or update **any** brief, proposal, phase, or milestone, fill **every** field:
objective, description, **diagrams** (mermaid + charts), deliverables, acceptance criteria,
**disclaimers & disclosures**, **timeline / deadline**, **time** estimate, and **cost**
(= estimated hours × the user's profile hourly rate). An artifact with empty fields is **not done**.

### Gate 3 — Task-breakdown ("never start before decomposing")
Before any implementation, the work must be decomposed into **tasks → subtasks → nested subtasks**
*and* the **flow board** (clusters + custom relations) must exist. Skipping the breakdown is not
allowed. You do the semantic extraction yourself (see §5). Completion of that breakdown is **bottom-up**
(see §4).

## 4. Definition of Done — per artifact

"Done" means the **whole** structure exists, not just the part that shows. Run the matching checklist
before claiming completion.

**Completion is BOTTOM-UP — verify each leaf, never assume.** A parent task or milestone is complete
only when **every** subtask and nested subtask is actually done and marked complete. Walk the leaves
first: `list_subtasks(parent)` → for each child (and its children) confirm the real work is done and
`complete_task(child)` → re-list to confirm all children are complete → **only then** complete the
parent. Never mark a parent done because the headline artifact "looks done." Going child-by-child is
how you find the work you actually skipped.

- **Client** — name, contact/platform, status. Read back.
- **Project** — name, client link, status, dates, description. Read back.
- **Brief** — overview, goals, deliverables, requirements, **Additional Notes**, at least one
  **diagram**, priority, source, budget/currency, deadline. Read back.
- **Proposal** — title, **introduction** (with a roadmap **diagram**), **disclaimers & disclosures**.
- **Phase** — name, objective, deliverables, acceptance criteria, deadline.
- **Milestone** — objective, description (with a **diagram**), deliverables, acceptance criteria,
  **time** (hours the *agent* will take), **cost** (= hours × profile rate), **deadline**, status.
- **Task tree** — a top-level task per milestone (flow node) → implementation subtasks → nested
  subtasks where the work has finer steps. Due dates + priorities. Completed bottom-up.
- **Flow board** — a cluster per phase grouping its tasks; custom relations for real dependencies
  (intra-phase order **and** cross-phase / cross-cutting dependencies).

## 5. Who performs semantic extraction

Whatever intelligence is **in the loop** does the extraction; there is no separate extractor for the MCP.

| Entry point | Who extracts |
|---|---|
| **MCP agent** (Claude Code, Copilot, Roo, Cursor, …) | **The agent itself** — reason over what the read tools return, then write clusters/relations/tasks via the primitive tools. **No DeepSeek.** |
| **Web / mobile app** button features (e.g. Generate Tasks) | **`deepseek-v4-flash`**, server-side (no conversational agent present). |
| **In-app AI Chat Assistant / Thoth** | **Itself**, inline in its own reasoning. |

So the MCP needs no DeepSeek tool — it needs solid **read tools + primitive write tools + this
guidance**, so the agent can self-extract and then read-after-write verify.

## 6. Grounding principles

- **Grounding beats guessing.** Read the proposal/brief/milestones/criteria/flow-board before you
  build. Matching what's specified beats inventing a plausible-looking version of it.
- **Never fabricate ids.** Every id — project, proposal, phase, milestone, task, subtask, board,
  block, flow cluster, flow connection — must come from a read tool (`list_*` / `get_*`) or from the
  response of the `create_*` call that created it. **Never invent, guess, pattern-match, abbreviate, or
  reuse from memory an id.** If you do not have an id, read for it. A wrong id silently writes to the
  wrong record or fails — both are worse than reading first.
- **The flow-board clusters & custom relations are real intent.** Use them as source of truth; never
  dismiss them as decoration.
- **Trust the data effect, not the description.** Verify by reading the record back, not by what a
  tool claims or what a (possibly stale) schema shows.
- **Don't work around a missing capability — fix it.** If a field can be written but not read back,
  that is a coverage gap to close, not a reason to reach outside the tools.
- **Diagrams via the diagram tool.** Insert mermaid with `insert_diagram` (never paste raw mermaid
  into a field); use the chart tool for charts.

## 7. Principle → concrete tool sequences

Each principle maps to an exact tool sequence. Follow them; the verifying read is part of the step.

- **Board-first alignment** → `create_board(title)` → `create_board_block(type:"heading"/"text")` +
  `create_board_block(type:"mermaid", content:{code})` and/or charts → (wait for human alignment) →
  *then* create the brief/proposal. Verify: `read_board(board_id)`.
- **Create a project with a complete brief + proposal** →
  `create_project(name, client_id)` → `update_brief(project_id, overview/goals/deliverables/
  requirements/notes/...)` + `insert_diagram(entity_type:"brief", field:"overview")` →
  `create_proposal(project_id, introduction)` + `insert_diagram(entity_type:"proposal",
  field:"introduction")` + `update_proposal(project_id, disclaimers_html)`.
  Verify: `get_proposal_detail(project_id)`.
- **Add a complete phase + milestones** → `add_proposal_phase(project_id, name, objective,
  deliverables, acceptance, deadline)` → `add_proposal_milestone(phase_id, name, objective,
  description, deliverables, acceptance, time_value, time_unit, cost, deadline)` →
  `insert_diagram(entity_type:"milestone", entity_id:<milestone_id>, field:"description")`.
  Verify: `get_proposal_detail(project_id)` and confirm no field is empty.
- **Cost & time** → read the rate with `get_my_full_profile` (→ `hourly_rate`); set `time_value` =
  hours the agent will take; `cost` = hours × `hourly_rate`.
- **Task breakdown + flow board** → per milestone `create_task(project_id, title, due_date,
  priority)` → `create_subtask(parent_task_id, title)` → nested `create_subtask(parent_task_id:
  <subtask_id>, title)` → `create_flow_cluster(title, task_ids:[…])` →
  `create_flow_connection(source_id, target_id, title)`.
  Verify: `list_tasks(project_id)`, `list_subtasks(parent)`, `list_flow_clusters`,
  `list_flow_connections`.
- **Bottom-up completion** → `list_subtasks(parent)` → for each leaf: do the work, then
  `complete_task(leaf)` → re-`list_subtasks(parent)` to confirm all children complete → only then
  `complete_task(parent)` and `update_proposal_milestone(status:"delivered")`.

## 8. Tool map (orient before you act)

- **Read (safe):** `get_*` / `list_*` — clients, projects, briefs, proposals (+ `get_proposal_detail`,
  `list_milestones`), tasks (+ `list_subtasks`), flow board (`list_flow_clusters`,
  `list_flow_connections`), notes, boards, calendar, gigs, time, profile, chat.
- **Write (real):** `create_*` / `update_*` / `add_*` — projects, briefs, proposals, phases,
  milestones, tasks, subtasks, flow clusters, flow connections, boards + blocks, `insert_diagram`,
  notes, events, etc. `complete_task` marks a task done.
- **Verify with the read tool that mirrors the write tool.** Every writable field must have one.

## 9. Anti-patterns (do not do these)

- Building before reading the portal, or before the task breakdown + flow board exist.
- Filling only deliverables + acceptance and leaving objectives/descriptions/diagrams/disclaimers/
  timeline/time/cost empty.
- **Marking a parent task or milestone complete while its subtasks / nested subtasks are still open or
  unverified.**
- **Assuming a subtask is done because the headline artifact exists — verify each leaf one by one
  against its actual deliverable.**
- Marking a milestone delivered because it compiled, without E2E + UI/UX testing.
- Trusting a write's success message or a cached schema instead of reading the record back.
- **Fabricating, guessing, or reusing-from-memory an id instead of reading it from a `list_*`/`get_*`
  tool or a `create_*` response.**
- Treating flow-board clusters/relations as optional.
- Merging to the auto-deploying branch without explicit human go-ahead.

## Changelog

- **1.0.0** (2026-06-10) — Initial ratified spec: core loop, three gates, bottom-up completion,
  per-artifact definition of done, semantic-extraction model, no-fabricated-ids rule, principle→tool
  sequences, tool map, anti-patterns.
