# Portal MCP — operating contract (Roo rule)

> Always-on workspace rule for operating the **management-portal MCP** (a real freelancer/client
> workspace: clients, projects, briefs, proposals, phases, milestones, tasks, a flow board, calendar,
> notes, boards, gigs, time, team chat). **Writes change real data.** Condensed from
> `agent-onboarding/shared/AGENTS.md` (canon: `agent-onboarding/DISCIPLINE.md` v1.0.0). The shared
> AGENTS.md / skill are canonical — this rule never contradicts them.

## Prime directive

You have the **tools, not the database**. The read tools (`get_*`/`list_*`) are your only source of
truth and your only way to verify. **Ground every action in what the portal actually contains, then
leave it complete and correct.** Never guess a field, an **id**, or a structure you could read.

## The core loop (every unit of work — no skipped steps)

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

1. **READ** the proposal, brief, every phase + milestone (deliverables + acceptance), and the **flow
   board** (clusters *and* custom relations — they encode real intent; read them every time).
2. **GAP** — name what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — for non-trivial work, build an alignment board (mermaid + charts) and
   **wait for the human** before creating the brief/proposal.
4. **BREAK DOWN** — tasks → subtasks → nested subtasks + flow board (clusters per phase + relations).
   **Do not build until this exists.**
5. **BUILD** on a branch (never the auto-deploying branch); commit each step.
6. **TEST** end-to-end including UI/UX — run the app, not just the type-checker.
7. **VERIFY** — read-after-write every change.
8. **DELIVER** only when tested E2E + meets deliverables/acceptance **and** every subtask is done
   (bottom-up). "It compiles" is not delivery.
9. **UPDATE** the memory graph + flow board to reflect reality.

## The three gates (hard stops — violating any one means NOT done)

1. **Read-after-write** — after any write tool, call the matching `get_*`/`list_*` and confirm the
   field actually persisted. Trust the **data effect**, not the success string or a stale schema.
   (`update_proposal_milestone` → `get_proposal_detail`; `create_task` → `list_tasks`;
   `create_flow_connection` → `list_flow_connections` — the edge may land even on a reported timeout.)
2. **Completeness** — on any brief/proposal/phase/milestone, fill **every** field: objective,
   description, diagrams (mermaid + charts), deliverables, acceptance criteria, disclaimers &
   disclosures, timeline/deadline, time estimate, cost (= hours × profile hourly rate). Empty = not done.
3. **Task-breakdown** — before any implementation, the work must already be decomposed into tasks →
   subtasks → nested subtasks **and** the flow board (clusters + relations) must exist.

## Non-negotiables

- **Bottom-up completion** — a parent is done only when **every** child is verified done:
  `list_subtasks(parent)` → do + `complete_task(child)` → re-list to confirm all children → *then*
  complete the parent. Never mark a parent done because the headline artifact "looks done."
- **Never fabricate ids** — every id (project, proposal, phase, milestone, task, subtask, board,
  block, flow cluster, flow connection) comes from a `list_*`/`get_*` read or a `create_*` response.
  Never invent, guess, pattern-match, abbreviate, or reuse-from-memory an id. No id? Read for it.
- **Board-first** — for any non-trivial new work, align on a **board with diagrams BEFORE** the
  brief/proposal/task tree, then **stop and wait for the human** before building. Insert mermaid via
  `insert_diagram` / `create_board_block(type:"mermaid")`, never raw mermaid pasted into a field.
- **Flow-board clusters & relations are real intent** — source of truth, never decoration.
- **Semantic extraction is yours** — reason over read-tool output, then write clusters/relations/tasks
  via the primitive tools. **No DeepSeek** (that's only server-side app buttons like Generate Tasks).
- **Branch, never the auto-deploying branch.** Commit each step. Test end-to-end incl. UI/UX.

## Where the detail lives

- **Operating how-to + playbook** — the `management-portal` skill (`SKILL.md` + `reference.md`):
  the principle → exact-tool-sequence playbook and the write → read verification map.
- **Connection** — `.roo/mcp.json` (server `management-portal`, URL + `X-API-Key`; set your key).
- **Canon** — `agent-onboarding/DISCIPLINE.md` and companions; change behavior there first.
