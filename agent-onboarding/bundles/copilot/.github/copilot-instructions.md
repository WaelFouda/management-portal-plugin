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

## Team Chat: staying reachable (what will and will not tell you)

`await_my_turn` blocks for **at most 25 s** (`timeout_s` defaults to 20 and the server clamps anything
higher). When it returns your turn ends and **nothing wakes you again**. So a channel keeps a **watch
roster**: `start_watching_channel(channel_id)` enrols you, `list_channel_watchers(channel_id)` shows who
is actually present, and the coordinator holds `require_channel_watch` / `release_channel_watch` — release
is the only way an obligation ends, there is no self-release. Statuses: `watching` (really waited within
the last 5 min), `ABSENT` (watched, then stopped), `NEVER_STARTED`, `released`. The heartbeat is written
by `await_my_turn` **itself**, so `watching` is evidence, not a claim; a DM-scoped wait does **not** count,
and nothing else — no hook, no script, no assertion that you re-armed — may write one.

**Re-arm FIRST, then handle.** The instant the wait returns, start the next one *before* you read or
answer the message. Handling first marks you `ABSENT` for exactly as long as handling takes — three agents
lost 9m25s, 10m14s and 2m20s that way. Re-arming first is safe: the previous wait has already returned, so
two never run at once; the cursor is unchanged, so nothing is missed; and the call count is identical, so
there is no extra egress.

**What is not at risk: no message is ever lost.** `await_my_turn` resumes from its cursor and hands you
everything that arrived while you were not looking. Stopping costs **time, not mail** — this is a latency
problem, not a delivery problem.

**What is at risk: nobody notices.** On Claude Code a turn-end `Stop` hook reads the roster and says so
when an agent has stopped watching. **Copilot has no `Stop` equivalent** — `.github/hooks/*.json` supports
`PreToolUse` and `PostToolUse` only — so **no alarm will interrupt you here.** What you do get is
`.github/hooks/portal-watch-rearm.json`, a static reminder that fires as `await_my_turn` returns; it
narrows the window in which you forget to re-arm, but it fires only while you are still calling the tool,
and the failure case is an agent that has stopped calling it. When you go `ABSENT`, nothing in this
harness notices. Therefore: **read `list_channel_watchers(channel_id)` yourself** instead of assuming you
are still on the roster, and know that the remaining backstop is a person — the human or the coordinator
reading the roster. Per-adapter matrix and limits: `agent-onboarding/WATCH-LAYERS.md`.

## How this is wired for Copilot

- **Operating contract** — this file (`.github/copilot-instructions.md`).
- **Skill** — `.github/skills/management-portal/SKILL.md` (+ `reference.md`); load on any portal work.
- **Custom agent** — `.github/agents/portal-operator.agent.md`; the portal operator, MCP tools scoped.
- **Prompt** — `.github/prompts/portal.prompt.md` (`/portal`); engages the portal-operator agent.
- **Hooks** — `.github/hooks/portal-read-after-write.json` reinforces read-after-write (Gate 1);
  `.github/hooks/portal-watch-rearm.json` fires as `await_my_turn` returns and tells you to re-arm.
  **`PreToolUse` / `PostToolUse` only** — there is no `Stop` event here, so no turn-end watch gate.
- **MCP connection** — `.vscode/mcp.json` (server `management-portal`; `X-API-Key`).
- **Plugin** — `plugin.json` bundles the above for distribution.

## Where the detail lives

- **Skill** — `.github/skills/management-portal/SKILL.md` (operable how-to; triggers on portal work).
- **Reference** — `.github/skills/management-portal/reference.md` (full discipline, principle→tool
  sequence playbook, write→read verification map, board-first procedure).
- **Connection** — `.vscode/mcp.json` and `agent-onboarding/shared/mcp.config.md`.
- **Canon** — `agent-onboarding/DISCIPLINE.md` and companions.
