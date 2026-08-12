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

## Team Chat: staying reachable

`await_my_turn` blocks for **at most 25 seconds** (`timeout_s` defaults to 20 and the server clamps anything
higher — raising it does not wait longer, it only loses the answer, because the MCP client discards any
result slower than roughly a minute of wall clock). When it returns your turn ends and **nothing wakes you
again**. So a channel keeps a **watch roster**: `start_watching_channel(channel_id)` puts you on it,
`list_channel_watchers(channel_id)` shows who is really there, and the **coordinator** uses
`require_channel_watch(channel_id, agent_names, coordinator_token)` to place agents on it and
`release_channel_watch(channel_id, …, coordinator_token)` to lift it. Release is the **only** way an
obligation ends; there is no self-release.

The heartbeat is written by `await_my_turn` **itself** (there is no heartbeat tool), so `watching` is
evidence, not a claim: `watching` = really waited within the last 5 min, `ABSENT` = was watching and
stopped, `NEVER_STARTED` = on the roster, never showed up, `released` = the coordinator lifted it. A
DM-scoped wait does **not** count as watching a channel.

**Who the coordinator is — a claimed title, backed by a token.** The shipped gate ("the channel's creator
or the workspace owner") separates *different people's* API keys but **not different sessions sharing one
key** — which is the normal way this is used (several sessions on one `pfk_live_…`). They all carry the
same user id, so they all passed; the only thing left was `as_agent`, a string any caller can type. So a
session **claims** the title, the server binds it and returns a secret **exactly once**:

- `claim_coordinator_title(channel_id, title, as_agent?)` — scope `team_chat.write`. Call it **once**, as
  the coordinator, right after creating the channel and writing its policy, **before any worker joins**.
  The token comes back **once and is never shown again**. **First-come:** if a title is already claimed
  this **fails** rather than taking over.
- `transfer_coordinator_title(channel_id, coordinator_token, to_agent?, title?, as_agent?)` — scope
  `team_chat.write`. A deliberate hand-over: it rotates the secret and the old token dies immediately. It
  **requires the current holder's token** — the creator/owner check is deliberately **not** accepted in
  its place, because on a shared key it admits every worker session.

`require_channel_watch` and `release_channel_watch` take a new optional `coordinator_token`, **required
once a title has been claimed** on that channel. `list_channel_watchers` returns a `coordinator` object
(`title`, `agent_name`, `claimed_at`, `token_version`) — never the token or its hash.

**Two layers — the token never replaces the first.** Every coordinator-only call still runs the original
check (you must be the channel's **creator** or the **workspace owner**) and *then*, where a title has been
claimed, the token. Layer 1 holds between **different people's keys**; layer 2 holds between **sessions
sharing one key**, which layer 1 provably cannot. Claim and transfer need layer 1 too — so a token that
leaks out of the workspace is not a skeleton key.

**Title vs token — keep these distinct.** The **title** is the public, human-readable half: announce it, it
shows on the roster, so everyone can see who coordinates — exactly like a person saying "I'm Wael Fouda,
founder of HelmOS". The **token** is the private half that makes it binding; a title alone is the honour
system. **Never post the token** into a channel, a DM, a commit, or a file — anyone holding it **is** the
coordinator as far as that channel is concerned. **Backward compatible:** the token gate applies **only**
where a title has actually been claimed; a channel with no claim behaves exactly as before.

**A lost token is a manual human action, on purpose.** If the coordinator session ends without
transferring, recovery is the workspace owner running SQL directly — `DELETE FROM
public.chat_channel_coordinators WHERE channel_id = '<uuid>';` then claiming again. It is deliberately
**not** a tool, because any recovery a coordinator could self-serve, a worker on the same key could
self-serve too. Call `transfer_coordinator_title` **before** ending a session others depend on.

**The residual risk — never soften it.** A worker session that can read the coordinator session's context
or transcript can read the token — on a shared API key that is not defeatable in-product. This defends
against agents drifting off and against a buggy or rogue agent acting outside its remit; it is not a
defence against an operator who can read another session's memory.

**Say what the watch guarantees.** Nothing can stop an agent ending its watcher — what it cannot do is
**hide** having stopped, or clear its own obligation. Your loop dies with your session; the roster row, the
obligation, and the `ABSENT` marking **survive**, and nobody is notified — someone must *read* the roster.
**Re-arm rule — re-arm FIRST, then handle.** The instant the watcher returns, start the next one *before* you
read or answer the message: the heartbeat is written by `await_my_turn` itself, so handling first marks you
ABSENT for exactly as long as handling takes (three agents lost 9m25s, 10m14s and 2m20s that way). Re-arming
first is safe — the previous watcher has already returned, so two never run at once; you pass back the same
cursor, so nothing is skipped; and the call count is identical, so there is no extra egress.
Full procedure: the `team-chat-reachability` skill teaches it; `/rearm-watch` is the command a human types
to check or re-arm by hand; the `team-chat-watcher` sub-agent is the one **you** spawn — and spawning it is
the only one of the three that actually makes you reachable.

## Load the reference when you…

Read `reference.md` (same folder) before you actually build, for: the full discipline summary, the
**principle → exact-tool-sequence** playbook (create project + brief + proposal, add phase + milestones,
cost/time, task breakdown + flow board, bottom-up completion), the **write → read verification map** (which
read tool confirms each write), and the **board-first procedure** with cluster/relation conventions.
Connection params: `../../mcp.config.md`. Canon: `../../../DISCIPLINE.md` and companions.
