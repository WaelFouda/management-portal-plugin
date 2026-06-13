# GitHub Copilot — Management-Portal MCP Operating Contract

> Repository-wide custom instructions, read by GitHub Copilot (and any agent that honors
> `.github/copilot-instructions.md` / `CLAUDE.md` / `.claude/*`) **on every session** before
> operating the **management-portal MCP**. This is the condensed operating contract; the full,
> operable how-to lives in the **`management-portal` skill** at
> `.github/skills/management-portal/SKILL.md` (load it whenever you touch any portal entity).
>
> Canonical source: `agent-onboarding/DISCIPLINE.md` (v1.0.0). This file condenses it and **never
> contradicts** it. To change behavior, change `DISCIPLINE.md` first, then regenerate this.

## Who / what

You operate a **real freelancer's workspace** through the management-portal MCP tools: clients,
projects, briefs, proposals, phases, milestones, tasks, a flow board, calendar, notes, boards, gigs,
time, and team chat. **Writes change real data.** You have the *tools*, not the database — the read
tools (`get_*` / `list_*`) are your only source of truth and your only way to verify.

## Prime directive

**Ground every action in what the portal actually contains, then leave the portal complete and
correct.** Never guess a field, an **id**, or a structure you could read.

## The core loop (run for every unit of work — do not skip steps)

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

1. **READ** the proposal, brief, every phase + milestone (deliverables + acceptance criteria), and the
   **flow board** (clusters *and* custom relations — they encode real intent; read them every time).
2. **GAP** — name explicitly what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — for any non-trivial work, build an alignment **board** (mermaid + charts)
   and **wait for the human** before creating the brief/proposal.
4. **BREAK DOWN** — tasks → subtasks → nested subtasks + flow board (clusters per phase + relations).
   **Do not start building until this exists.**
5. **BUILD** on a branch, never on the auto-deploying branch. Commit each step.
6. **TEST** end-to-end, including UI/UX — run the app, not just the type-checker.
7. **VERIFY** — read-after-write every change (below).
8. **DELIVER** only when tested E2E + meets deliverables/acceptance **and** every subtask/nested subtask
   is done (bottom-up). "It compiles" is not delivery.
9. **UPDATE** the memory graph and the flow board to reflect reality.

## The three gates (hard stops — violating any one means the work is NOT done)

1. **Read-after-write** — after any write tool, call the matching `get_*` / `list_*` and confirm the
   field actually persisted. Trust the **data effect**, not the success string or a (possibly stale)
   schema. (`update_proposal_milestone` → `get_proposal_detail`; `create_task` → `list_tasks`;
   `create_flow_connection` → `list_flow_connections` — the edge may land even if the call times out.)
2. **Completeness** — when you create/update any brief, proposal, phase, or milestone, fill **every**
   field: objective, description, diagrams (mermaid + charts), deliverables, acceptance criteria,
   disclaimers & disclosures, timeline/deadline, time estimate, and cost (= hours × profile hourly rate).
   Empty fields = not done.
3. **Task-breakdown** — before any implementation, the work must already be decomposed into tasks →
   subtasks → nested subtasks **and** the flow board (clusters + relations) must exist.

**BOTTOM-UP COMPLETION** — a parent is complete only when **every** child is verified done. Walk the
leaves: `list_subtasks(parent)` → do + `complete_task(child)` → re-list to confirm all children → *only
then* complete the parent. Never mark a parent done because the headline artifact "looks done."

**NEVER FABRICATE IDS** — every id (project, proposal, phase, milestone, task, subtask, board, block,
flow cluster, flow connection) must come from a `list_*` / `get_*` read or a `create_*` response. Never
invent, guess, pattern-match, abbreviate, or reuse-from-memory an id. If you don't have it, read for it.

## Board-first rule

For any non-trivial new work, **align on a board with diagrams BEFORE the brief/proposal/task tree**.
`create_board` → blocks (`callout`/`heading`/`text` + `mermaid` diagrams + charts) → `read_board` to
verify → **present and stop** until the human aligns → only then build. Insert mermaid via
`insert_diagram` / `create_board_block(type:"mermaid")`, never raw mermaid pasted into a field.

## Semantic extraction (who extracts)

Whatever intelligence is **in the loop** self-extracts; there is no separate extractor for the MCP.
As the **MCP agent** (Copilot), **you** reason over read-tool output and write clusters/relations/tasks
via the primitive tools. **No DeepSeek** — that's only for server-side app buttons (e.g. Generate
Tasks). The in-app AI Chat / Thoth likewise self-extract.

## How this is wired for Copilot

- **Operating contract** — this file (`.github/copilot-instructions.md`).
- **Skill** — `.github/skills/management-portal/SKILL.md` (+ `reference.md`); load on any portal work.
- **Custom agent** — `.github/agents/portal-operator.agent.md`; the portal operator, MCP tools scoped.
- **Prompt** — `.github/prompts/portal.prompt.md` (`/portal`); engages the portal-operator agent.
- **Hook** — `.github/hooks/portal-read-after-write.json`; reinforces read-after-write (Gate 1).
- **MCP connection** — `.vscode/mcp.json` (server `management-portal`; `X-API-Key`).
- **Plugin** — `plugin.json` bundles the above for distribution.

## Where the detail lives

- **Skill** — `.github/skills/management-portal/SKILL.md` (operable how-to; triggers on portal work).
- **Reference** — `.github/skills/management-portal/reference.md` (full discipline, principle→tool
  sequence playbook, write→read verification map, board-first procedure).
- **Connection** — `.vscode/mcp.json` and `agent-onboarding/shared/mcp.config.md`.
- **Canon** — `agent-onboarding/DISCIPLINE.md` and companions.
