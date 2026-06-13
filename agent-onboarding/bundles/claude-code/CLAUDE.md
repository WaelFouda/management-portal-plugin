# CLAUDE.md — management-portal operating contract

This repo connects to the **management-portal MCP** (a real freelancer/client workspace:
clients, projects, briefs, proposals, phases, milestones, tasks, a flow board, calendar,
notes, boards, gigs, time, team chat). **Writes change real data.**

> Full how-to lives in the **`management-portal` skill** (`.claude/skills/management-portal/SKILL.md`,
> with `reference.md`). It triggers automatically on any portal work. Load it before you operate.
> For dedicated, disciplined runs use the **`/portal`** command (dispatches the `portal-operator` subagent).
> Connection is registered in **`.mcp.json`** (set your key — never commit a real one).

## Operating contract (condensed — the skill is canonical)

You have the **tools, not the database**. The read tools (`get_*`/`list_*`) are your only source of
truth and your only way to verify. **Ground every action in what the portal actually contains, then
leave it complete and correct.** Never guess a field, an **id**, or a structure you could read.

### The core loop (every unit of work — no skipped steps)

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

### The three gates (hard stops)

1. **Read-after-write** — after any write tool, call the matching `get_*`/`list_*` and confirm the
   field actually persisted. Trust the **data effect**, not the success string or a stale schema.
   (`create_flow_connection` → `list_flow_connections`; the edge may land even on a reported timeout.)
2. **Completeness** — on any brief/proposal/phase/milestone, fill **every** field: objective,
   description, diagrams (mermaid + charts), deliverables, acceptance criteria, disclaimers &
   disclosures, timeline/deadline, time estimate, cost (= hours × profile hourly rate). Empty = not done.
3. **Task-breakdown** — before any implementation, the work must already be decomposed into tasks →
   subtasks → nested subtasks **and** the flow board (clusters + relations) must exist.

### Non-negotiables

- **Bottom-up completion** — a parent is done only when **every** child is verified done:
  `list_subtasks(parent)` → do + `complete_task(child)` → re-list → *then* complete the parent.
- **Never fabricate ids** — every id comes from a `list_*`/`get_*` read or a `create_*` response.
  Never invent, guess, pattern-match, abbreviate, or reuse-from-memory an id. No id? Read for it.
- **Board-first** — for any non-trivial new work, align on a **board with diagrams BEFORE** the
  brief/proposal/task tree, then **stop and wait for the human** before building. Insert mermaid via
  `insert_diagram` / `create_board_block(type:"mermaid")`, never raw mermaid pasted into a field.
- **Semantic extraction is yours** — reason over read-tool output, then write clusters/relations/tasks
  via the primitive tools. **No DeepSeek** (that's only server-side app buttons like Generate Tasks).
- **Branch, never the auto-deploying branch.** Commit each step. Test end-to-end incl. UI/UX.

Canonical spec: the bundled skill + `reference.md` (condensed from `agent-onboarding/DISCIPLINE.md`).
