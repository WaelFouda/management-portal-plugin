---
description: Start a disciplined, autonomous portal run for a client + project — alignment board, brief, proposal, phases, milestones, task tree, flow board, journal folder and knowledge graph — then implement to delivery without stopping between phases.
argument-hint: "<client> <project> [scope notes]"
---

Start an autonomous portal run for a client and a project, under the canon gates.

## 0. The arguments — read these before you touch a single tool

```
raw       = $ARGUMENTS
positional cross-check:  $0 | $1 | $2
```

**`$​ARGUMENTS` is authoritative.** Split it quote-aware: the **first** value is the **client**, the
**second** is the **project**, everything after that is **scope notes**.

**Measured, and it will surprise you: the positional variables on this build are 0-indexed.** `$​0` renders
the FIRST argument, `$​1` the SECOND, `$​2` the THIRD — probed directly on Claude Code 2.1.x, both quoted and
unquoted. They are printed above **only as a cross-check**. If the cross-check disagrees with your split of
`$​ARGUMENTS`, **`$​ARGUMENTS` wins**, and never paste a `$​1` into a tool call — on this build that would open
the run against the project name and file the first scope word as the project.

**STOP RIGHT HERE if `$​ARGUMENTS` is empty, if either of the first two values is missing, or if either is a
literal placeholder (`<client>`, `Client_Name`, `$​1`).** Run no tool, open no run, create nothing. Say what
is missing, show the line you were given, and ask for it in this form:

> `/portal-project "<client name>" "<project name>" [scope notes]`

**A cross-check slot that still renders as the literal `$​0` or `$​1` has no argument behind it** — that is what
"missing" means above. One value present and the other of the two still showing a positional is a stop, not a
half-invocation to fill in: never substitute a stand-in for the one you were not given — not a placeholder,
not the positional itself — and never open the run with only one of the two. **§0 is a precondition on §1: the
"first tool call" in §1 does not happen at all until both values are real.**

A run opened against an empty client or a placeholder project name creates a real record in a real
workspace under a name nobody chose, and the gates will then hold every later turn to it. **Never invent a
client name, never invent a project name, and never proceed with a placeholder.** This is the one place in
this command where stopping is correct.

Quote names that contain spaces — unquoted, `/portal-project Acme Corp Website` means client `Acme` and
project `Corp`, silently. If both values are present but the split looks wrong, say in one line what you
inferred and carry on; do not stop for it.

Scope notes are the owner's description of what the project is — use them as the seed for the brief. If
there are none, read the client and the workspace for context and write the brief from what you find,
rather than asking.

## 1. Step one — open the run

Run this, exactly, as your first tool call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" run-open --client "<CLIENT>" --project "<PROJECT>" --state ALIGN
```

`<CLIENT>` and `<PROJECT>` are the two values you confirmed in §0. **Type them into the line literally.**
Do not paste `$​1`/`$​2` into it — §0 says why that would bake the wrong pair into the run manifest, where it
would then govern every later turn.

It prints a run id. That run id is what makes the canon gates follow this work across turns, across
compaction, and across a restarted session — the run lives on disk keyed by this project directory, not in
your context.

**Run this whole command in this session.** Spawn as many sub-agents as the work needs — you are approved
to — but keep the portal writes and the phase accounting here, because the gates read *this* session's tool
stream and a write made inside a sub-agent may never reach the ledger they fold at turn end.

If the path does not resolve, take the absolute `CANON_GATE_PATH` printed on the canon card at the top of
this session (`[portal-canon v1 · alive · token …]`) and use that. **If there is no canon card, the gates
are not running in this session** — say that in one line, then follow every step below by hand. The canon
is the same either way; the gates only make it non-optional.

## 2. Board-first comes first, and it is the one place you stop

The run opens in state **ALIGN**. While it is in ALIGN, `CANON-BOARD-FIRST` refuses a brief, a proposal, a
phase or a task until an alignment board exists.

1. `create_board(title:"<PROJECT> — alignment")`
2. `create_board_block` for a `callout`/`heading`/`text` framing, **plus** `create_board_block(type:"mermaid")`
   for the shape of the work, **plus** a chart where a number carries the argument.
3. `read_board(board_id)` — the verifying read.
4. **Present the board and STOP for the human.** This is not a violation of "never stop between phases".
   Board-first governs the *initiation* of new work; canon (b) governs the phases inside an already-approved
   plan. Stopping here is the design.

The human aligns, then types `/portal-continue`, which promotes the run **ALIGN → RUN** and turns canon (b)
on. Say that explicitly when you present the board, so whoever reads it knows the word that restarts you.

## 3. Canon (a) — project initiation, in order

Do these in this order, and use `bulk` to send each group as one request (canon (f), §6).

1. **Client** — `list_clients` to find `<CLIENT>`; `create_client(name:"<CLIENT>", …)` only if it is genuinely absent.
   Never fabricate a client id; read it or create it. **Verify:** `get_client` / `list_clients`.
2. **Project** — `create_project(name:"<PROJECT>", client_id:<from step 1>, status, dates, description)`.
   **Verify:** `get_project`.
3. **Brief, every field** — `update_brief(project_id, overview, goals, deliverables, requirements,
   additional notes, priority, source, budget + currency, deadline)` and
   `insert_diagram(entity_type:"brief", field:"overview")` for the mermaid. Rich formats, not a bare list.
   **Verify:** `get_brief` — and check the diagram is in the field, not just that the call succeeded.
4. **Proposal** — `create_proposal(project_id, title, introduction)` +
   `insert_diagram(entity_type:"proposal", field:"introduction")` for the roadmap diagram +
   `update_proposal(project_id, disclaimers_html)` for disclaimers & disclosures.
   **Verify:** `get_proposal_detail(project_id)`.
5. **Phases** — `add_proposal_phase(project_id, name, objective, deliverables, acceptance, deadline)`.
   Every one of those fields, on every phase.
6. **Milestones, per phase** — `add_proposal_milestone(phase_id, name, objective, description,
   deliverables, acceptance, time_value, time_unit, cost, deadline)` +
   `insert_diagram(entity_type:"milestone", entity_id:<milestone_id>, field:"description")`.
   Time is the hours **you** will take; read the rate with `get_my_full_profile` and set
   `cost = hours × hourly_rate`. **Verify:** `get_proposal_detail` and confirm no field came back empty.
7. **Task tree** — a top-level `create_task(project_id, title, due_date, priority)` per milestone →
   `create_subtask(parent_task_id, title)` for the implementation steps → **nested** subtasks
   (`create_subtask(parent_task_id:<subtask_id>, …)`) wherever a step has finer steps.
   **Verify:** `list_tasks(project_id)`, `list_subtasks(parent)`.
8. **Flow board** — `create_flow_cluster(title, task_ids:[…])`, one cluster per phase, then
   `create_flow_connection(source_id, target_id, title)` for every real dependency: order inside a phase
   **and** the cross-phase ones. **Verify:** `list_flow_clusters`, `list_flow_connections` — the edge can
   land even when the call reports a timeout, so read before you retry.

`CANON-TREE-FIRST` refuses implementation edits until at least one task, one subtask, one flow cluster and
one flow connection exist for this run. That gate is telling you step 7 and 8 have not happened yet.

## 4. Canon (d) — the journal, in a named folder, read back every phase

Create it once, at the start:

```
create_journal_folder(name:"<PROJECT> — run log")
```

Then, **after every phase**, in one `bulk`:

- `create_journal(folder_id:<that folder>, title:"<phase> — <what happened>", content:"<rich HTML>",
  project_id:<project>, tags:["phase","<phase name>"], logged_at:"<today, YYYY-MM-DD>")` — what was done,
  the **lessons learnt**, and **anything that must be returned to**.
- and **read it back**: `list_journals(folder_id:…)` or `get_journal(log_id:…)` / `search_journals`.

Both halves. `CANON-JOURNAL-PHASE` refuses the first portal write after a phase boundary when either the
write or the read-back is missing, and it names which half it could not find.

`logged_at` is when the entry is **about**. Omit it and the entry files itself under today, and every
date query afterwards is wrong with no error to tell you.

## 5. Canon (e) — the knowledge graph, built and read back

Create it once the structure exists, and update it as the run goes:

1. `create_knowledge_graph(title:"<PROJECT> — knowledge graph", description:…)`
2. `add_source_to_knowledge_graph(graph_id, items:[…])` — one call, sources spanning **all** of:
   - `{type:"journal_folder", id:<the "<PROJECT> — run log" folder>}` — the folder and its subfolders
   - `{type:"note", id:<each related note>}`
   - `{type:"board", id:<the alignment board, and later the summary board>}`
   - the **tag** form: `{type:"journal_query", config:{tags:["<project tag>"]}}` — a saved query, no id,
     re-resolved on every extraction, so entries written later join the source by themselves
   - `{type:"project", id:<project>}`
   - `{type:"task", id:<each top-level task>}`
3. `extract_knowledge_graph(graph_id)` — the incremental, cheap path. **Never** `regenerate_knowledge_graph`
   for a refresh: it destroys the nodes and edges first and re-reads every source. `CANON-KG-DESTRUCTIVE`
   refuses it inside a run unless the owner authorised it.
4. `interpret_knowledge_graph(graph_id, focus:"<the question this run is answering>")` — and **say what it
   showed**. An interpretation nobody reads is not an interpretation.
5. **Read it back**: `get_knowledge_graph(graph_id)` or `semantic_search_knowledge_graph`.

Treat an edge below 0.6 confidence as a hypothesis. Check it against the record before you build on it.

## 6. Canon (f) — use `bulk`

The portal has a `bulk` tool that runs many calls in one request, chains `{{0.id}}` from an earlier call
into a later one, and reports each item separately. Three or more calls in a row that you already know you
are going to make **is** a bulk call: the client + project + brief; the proposal + its phases + their
milestones; a task with its subtasks and their nested subtasks; the whole read-back sweep.

`CANON-BULK` reports single-call runs at turn end. It never refuses — a refusal on call four cannot undo
calls one through three — so this one is on you.

## 7. Canon (c) — status discipline

As work completes, update it: `update_proposal_phase(status)`, `update_proposal_milestone(status:"delivered")`,
`complete_task`. Bottom-up, always — `list_subtasks(parent)` → finish and `complete_task` each leaf →
re-list to confirm every child is complete → **only then** the parent, then the milestone.
`CANON-BOTTOM-UP` refuses a `complete_task` on a parent whose children this session has never listed or has
listed and not finished.

## 8. Canon (b) — then keep going

Once the human aligns and the run is promoted to RUN, **do not stop between phases.** The full rule, the
end-of-run summary board, the E2E testing requirement and the account rule live in `/portal-continue` —
read that command's body and follow it for the rest of the run.

## The two honest limits — say them when you present the board

- **The gates check structure, never quality.** They can tell that a brief exists, that every field is
  non-empty, that a diagram is in the field, that a journal entry was written and read back. They cannot
  tell whether any of it is *good*. Nothing here is a substitute for reading what you wrote.
- **No hook can restart an idle session.** The gates refuse tool calls and refuse to end a turn silently
  mid-run; they cannot make a session that is already sitting idle pick the work back up. "Never stop
  between phases" is enforceable as "never end a **turn** silently mid-run", and that is the form it ships
  in.

If a gate is blocking work it cannot un-block, `/portal-stand-down` is the escape and it is honoured
mid-session.
