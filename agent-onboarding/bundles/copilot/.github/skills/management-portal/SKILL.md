---
name: management-portal
description: Operate the management-portal MCP correctly — the freelancer/client workspace of clients, projects, briefs, proposals, phases, milestones, tasks, subtasks, a flow board, calendar, notes, boards, gigs, time, and team chat. Use whenever you read or write any management-portal / portal entity (create or update a client/project/brief/proposal/milestone/task, build or edit the flow board or a board, run board-first alignment, or break work into tasks + clusters + relations). Enforces the core loop, the three gates (read-after-write, completeness, task-breakdown), bottom-up completion, never-fabricate-ids, and board-first.
---

# Operating the management-portal MCP

You operate a **real freelancer's workspace** over MCP tools. **Writes change real data.** You have the
*tools*, not the database — the read tools (`get_*`/`list_*`) are your only source of truth and your only
way to verify. **Ground every action in what the portal actually contains, then leave it complete and
correct.** Never guess a field, an **id**, or a structure you could read.

## The core loop (every unit of work — no skipped steps)

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

1. **READ** the proposal, brief, phases + milestones (deliverables + acceptance), and the **flow board**
   (clusters *and* custom relations — they encode real intent; read them every time).
2. **GAP** — name what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — for non-trivial work, build an alignment board (mermaid + charts) and **wait
   for the human** before the brief/proposal. See `reference.md` §board-first.
4. **BREAK DOWN** — tasks → subtasks → nested subtasks + flow board (clusters per phase + relations).
   **Do not build until this exists.**
5. **BUILD** on a branch (never the auto-deploying branch); commit each step.
6. **TEST** end-to-end including UI/UX — run the app, not just the type-checker.
7. **VERIFY** — read-after-write every change.
8. **DELIVER** only when tested E2E + meets deliverables/acceptance **and** every subtask is done
   (bottom-up). "It compiles" is not delivery.
9. **UPDATE** the memory graph + flow board to reflect reality.

## The three gates (hard stops)

1. **Read-after-write** — after any write, call the matching `get_*`/`list_*` and confirm the field
   persisted. Trust the **data effect**, not the success string or a stale schema. (`create_flow_connection`
   → `list_flow_connections`; the edge may land even on a reported timeout.)
2. **Completeness** — on any brief/proposal/phase/milestone, fill **every** field: objective, description,
   diagrams (mermaid + charts), deliverables, acceptance criteria, disclaimers & disclosures,
   timeline/deadline, time estimate, cost (= hours × profile hourly rate). Empty fields = not done.
3. **Task-breakdown** — before implementation, work must already be decomposed into tasks → subtasks →
   nested subtasks **and** the flow board (clusters + relations) must exist.

**Bottom-up completion** — a parent is done only when **every** child is verified done:
`list_subtasks(parent)` → do + `complete_task(child)` → re-list → *then* complete the parent.

**Never fabricate ids** — every id comes from a `list_*`/`get_*` read or a `create_*` response. Never
invent, guess, pattern-match, abbreviate, or reuse-from-memory an id. No id? Read for it.

## Board-first

For any non-trivial new work, align on a **board with diagrams BEFORE** the brief/proposal/task tree:
`create_board` → blocks (`callout`/`heading`/`text` + `mermaid` + charts) → `read_board` to verify →
present and **stop** until the human aligns → only then build. Insert mermaid via `insert_diagram` /
`create_board_block(type:"mermaid")`, never raw mermaid pasted into a field.

## Semantic extraction

Whatever intelligence is **in the loop** self-extracts — there is no separate extractor for the MCP.
**As an MCP agent you extract yourself**: reason over read-tool output, then write clusters/relations/tasks
via primitive tools. **No DeepSeek** (that's only for server-side app buttons like Generate Tasks). The
in-app AI Chat / Thoth likewise self-extract.

## Load the reference when you…

Read `reference.md` (same folder) before you actually build, for: the full discipline summary, the
**principle → exact-tool-sequence** playbook (create project + brief + proposal, add phase + milestones,
cost/time, task breakdown + flow board, bottom-up completion), the **write → read verification map** (which
read tool confirms each write), and the **board-first procedure** with cluster/relation conventions.
Connection params: `../../../.vscode/mcp.json` (and `agent-onboarding/shared/mcp.config.md`). Canon:
`agent-onboarding/DISCIPLINE.md` and companions.
