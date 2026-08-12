# AGENTS.md — Management-Portal MCP Operating Contract

> The persistent contract every AI agent reads **on every session** before operating the
> **management-portal MCP**. Cursor honors a root `AGENTS.md` automatically; the same contract is also
> surfaced as a Cursor rule (`.cursor/rules/portal-mcp.mdc`). Condensed from
> `agent-onboarding/shared/AGENTS.md`. Canonical source: `agent-onboarding/DISCIPLINE.md` (v1.0.0) —
> this file condenses it and never contradicts it.

## Who / what

You operate a **real freelancer's workspace** through MCP tools: clients, projects, briefs, proposals,
phases, milestones, tasks, a flow board, calendar, notes, boards, gigs, time, and team chat. **Writes
change real data.** You have the *tools*, not the database — the read tools are your only source of
truth and your only way to verify.

## Prime directive

**Ground every action in what the portal actually contains, then leave the portal complete and correct.**
Never guess a field, an **id**, or a structure you could read.

## The core loop (run for every unit of work — do not skip steps)

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

1. **READ** the proposal, brief, every phase + milestone (deliverables + acceptance criteria), and the
   **flow board** (clusters *and* custom relations — they encode real intent, read them every time).
2. **GAP** — name explicitly what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — for any non-trivial work, build an alignment **board** (mermaid + charts)
   and **wait for the human** before creating the brief/proposal.
4. **BREAK DOWN** — tasks → subtasks → nested subtasks + flow board (clusters per phase + relations).
   **Do not start building until this exists.**
5. **BUILD** on a branch, never on the auto-deploying branch. Commit each step.
6. **TEST** end-to-end, including UI/UX — run the app, not just the type-checker.
7. **VERIFY** — read-after-write every change (below).
8. **DELIVER** — mark delivered only when tested E2E + meets deliverables/acceptance **and** every
   subtask/nested subtask is done (bottom-up). "It compiles" is not delivery.
9. **UPDATE** the memory graph and the flow board to reflect reality.

## The three gates (hard stops — violating any one means the work is NOT done)

1. **Read-after-write** — after any write tool, call the matching `get_*`/`list_*` and confirm the field
   actually persisted. Trust the **data effect**, not the success string or a (possibly stale) schema.
   (`update_proposal_milestone` → `get_proposal_detail`; `create_task` → `list_tasks`;
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
flow cluster, flow connection) must come from a `list_*`/`get_*` read or a `create_*` response. Never
invent, guess, pattern-match, abbreviate, or reuse-from-memory an id. If you don't have it, read for it.

## Board-first rule

For any non-trivial new work, **align on a board with diagrams BEFORE the brief/proposal/task tree**.
`create_board` → blocks (`callout`/`heading`/`text` + `mermaid` diagrams + charts) → `read_board` to
verify → **present and stop** until the human aligns → only then build. Insert mermaid via
`insert_diagram` / `create_board_block(type:"mermaid")`, never raw mermaid pasted into a field.

## Semantic extraction (who extracts)

Whatever intelligence is **in the loop** self-extracts; there is no separate extractor for the MCP.

- **MCP agent** (Cursor / Claude Code / Copilot / Roo): **the agent itself** reasons over read-tool
  output and writes clusters/relations/tasks via the primitive tools. **No DeepSeek.**
- **Web/mobile app buttons** (e.g. Generate Tasks): `deepseek-v4-flash`, server-side (no agent present).
- **In-app AI Chat Assistant / Thoth**: **itself**, inline in its own reasoning.

So the MCP needs no DeepSeek tool — just solid read tools + primitive write tools + this guidance.

## Team Chat: staying reachable (the watch roster)

`await_my_turn` blocks for **at most 25 seconds** (`timeout_s` defaults to 20 and the server clamps
anything higher — raising it does not wait longer, it only loses the answer, because the MCP client throws
away any result slower than roughly a minute of wall clock). When it returns your turn ends and **nothing
wakes you again**. So a channel keeps a **watch roster**: `start_watching_channel(channel_id)` puts you on
it, `list_channel_watchers(channel_id)` shows who is actually present, and the **coordinator** uses
`require_channel_watch(channel_id, agent_names, coordinator_token)` and `release_channel_watch(…,
coordinator_token)`. Release is the **only** way an obligation ends; there is no self-release.
Statuses: `watching` (really waited within the last 5 min), `ABSENT` (was watching and stopped),
`NEVER_STARTED` (on the roster, never showed up), `released`. The heartbeat is written by `await_my_turn`
**itself** — no separate heartbeat tool — so `watching` is evidence, not a claim; a DM-scoped wait does
**not** count.

**Who the coordinator is — a claimed title, backed by a token.** "Creator or workspace owner" separates
*different people's* API keys but **not different sessions sharing one key** — the normal way this is
used (several sessions on one `pfk_live_…`, all carrying the same user id, so all passing; the only thing
left was `as_agent`, a string any caller can type). So a session **claims** the title and the server
returns a secret **exactly once**. Both tools are scope `team_chat.write`:

- `claim_coordinator_title(channel_id, title, as_agent?)` — call it **once**, as the coordinator, right
  after creating the channel and writing its policy, **before any worker joins**. The token comes back
  **once and is never shown again**. **First-come:** a claim on an already-claimed title **fails**
  rather than taking over.
- `transfer_coordinator_title(channel_id, coordinator_token, to_agent?, title?, as_agent?)` — the
  deliberate hand-over. It rotates the secret, the old token dies immediately, and it **requires the
  current holder's token**: the creator/owner check is deliberately **not** accepted in its place,
  because on a shared key it admits every worker session.

`require_channel_watch` and `release_channel_watch` take a new optional `coordinator_token`, **required
once a title has been claimed** on that channel. `list_channel_watchers` also returns a `coordinator`
object (`title`, `agent_name`, `claimed_at`, `token_version`) — never the token or its hash.

**Two layers — the token never replaces the first.** Every coordinator-only call still runs the original
check (you must be the channel's **creator** or the **workspace owner**) and *then*, where a title has
been claimed, the token. Layer 1 holds between **different people's keys**; layer 2 holds between
**sessions sharing one key**, which layer 1 provably cannot. Claim and transfer need layer 1 too — so a
token that leaks out of the workspace is not a skeleton key.

**Title vs token — keep these distinct.** The **title** is the public, human-readable half: announced and
shown on the roster, so everyone can see who coordinates — exactly like a person saying "I'm Wael Fouda,
founder of HelmOS". The **token** is the private half that makes it binding; a title alone is the honour
system. **Never post the token** into a channel, a DM, a commit, or a file — anyone holding it **is** the
coordinator as far as that channel is concerned. **Backward compatible:** the token gate applies **only**
where a title has actually been claimed; a channel with no claim behaves exactly as before.

**A lost token is a manual human action, on purpose.** Recovery is the workspace owner running SQL
directly — `DELETE FROM public.chat_channel_coordinators WHERE channel_id = '<uuid>';` then claiming
again. It is deliberately **not** a tool, because any recovery a coordinator could self-serve, a worker
on the same key could self-serve too. Call `transfer_coordinator_title` **before** ending a session
others depend on.

**Three things never to soften.** (1) Nothing can *prevent* an agent from stopping its watcher — what it
cannot do is **hide** having stopped, or clear its own obligation. Never call this enforcement. (2) The
watcher loop **dies with the session**; the roster row, the obligation, and the `ABSENT` marking
**survive**, and nobody is notified automatically — someone must *read* the roster. (3) A worker session
that can read the coordinator session's context or transcript can read the token — on a shared API key
that is not defeatable in-product. This defends against agents drifting off and against a buggy or rogue
agent acting outside its remit; it is not a defence against an operator who can read another session's
memory.

**Re-arm rule — re-arm FIRST, then handle.** The instant the watcher returns, start the next one **before**
you read or answer the message. The heartbeat is written by `await_my_turn` itself, so handling first marks
you ABSENT for exactly as long as handling takes — three agents lost 9m25s, 10m14s and 2m20s that way.
Re-arming first is safe: the previous watcher has already returned (that return is what invoked you), so
two never run at once; the cursor is unchanged, so no message is missed; and the call count is identical,
so there is no extra egress. Run the wait loop on whatever background/looping primitive your harness
provides.

**What will and will not tell you — in Cursor, nothing will.** First, the thing that is *not* at risk:
**no message is ever lost.** `await_my_turn` resumes from its cursor, so the moment you look again you are
handed everything that arrived while you were not looking. Stopping costs you **time, not mail** — this is
a latency problem, not a delivery problem, and nothing here is a queue or a retry.

What that leaves is the part nobody notices. On other platforms a turn-end hook checks the roster and
speaks up when an agent has stopped watching. **Cursor has no hook, no harness-run script, and no
background sub-agent here**, so there is no turn-end event and no alarm: when you go `ABSENT`, **nothing
interrupts you and nobody is notified**. `/portal` is a command you invoke — a way for you to ask, never a
way to be told. Four agents went unreachable this way and the system told nobody.

So the roster is not a formality, it is the only signal that exists: **read
`list_channel_watchers(channel_id)` yourself** rather than assuming you are still on it, and treat a
`watching` row as the only evidence — your own belief that you re-armed is not evidence, because only
`await_my_turn` actually running writes the heartbeat. The other backstop is a person: the human or the
coordinator reading the roster. Per-adapter matrix and limits: `agent-onboarding/WATCH-LAYERS.md`.

## Where the detail lives

- **Rule** — `.cursor/rules/portal-mcp.mdc` (the same contract, always-applied in Cursor).
- **Skill** — `management-portal` (`SKILL.md` + `reference.md`): the operable how-to, the principle →
  exact-tool-sequence playbook, and the write → read verification map.
- **Connection** — `.cursor/mcp.json` (canonical MCP URL + `X-API-Key`; set your key, never commit it).
- **Canon** — `agent-onboarding/DISCIPLINE.md` and companions; change behavior there first.
