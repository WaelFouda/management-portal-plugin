---
description: Resume the autonomous run and keep going — no confirmation between phases.
argument-hint: "[run id or project name]"
---

Resume the autonomous portal run and carry it to delivery.

## 0. The argument — optional, but never a placeholder

```
raw       = $ARGUMENTS
positional cross-check:  $0 | $1
```

**`$​ARGUMENTS` is authoritative.** Its first value, if there is one, is the run id or project name.

**Measured: the positional variables on this build are 0-indexed** — `$​0` renders the FIRST argument and
`$​1` the SECOND, probed directly on Claude Code 2.1.x — and a positional with no argument behind it renders
as the literal text `$​1`. They are printed above **only as a cross-check**; `$​ARGUMENTS` wins, and a
positional never goes into a tool call.

The argument is **optional**, and empty is the normal case: the run resolves from this project directory,
which is how it survives a restarted session. Do not ask for it. **If it rendered as a literal placeholder**
— `<run id>`, `[run id or project name]`, `$​1` — treat it as absent, say so in one line, and carry on. Never
pass a placeholder to the gate, and never address a run id you have not seen printed.

## 1. Step one — promote the run

Run this, exactly, as your first tool call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" run-promote --state RUN --run "<RUN>"
```

`<RUN>` is the value you confirmed in §0 — type it in literally, never a `$​1`. **Drop `--run "<RUN>"`
entirely when there is no argument**, which is the usual case. If no run exists for this project, this
opens one in state **RUN**.

**Typing this command is the alignment.** The run moves ALIGN → RUN, `CANON-BOARD-FIRST` stands down, and
canon (b) turns on. Nobody has to say "continue" again after this.

If the path does not resolve, use the absolute `CANON_GATE_PATH` from the canon card at the top of this
session. If there is no canon card, the gates are not running here — say so in one line and follow the
canon below by hand.

## 2. Canon (b) — never stop between phases

> **Proceed autonomously to the next phase without waiting for confirmation. The owner is not there to say
> continue.**

That is the whole rule, and it is the one the owner has had to retype the most. What it means in practice:

- Finishing a phase is not a stopping point. It is the moment you start the next one.
- Do not end a turn with "shall I proceed", "let me know if you want me to continue", or a summary of what
  you *would* do next. Do the next thing.
- Do not stop to report a success. Report it on the way past.
- You are **approved to spawn as many concurrent sub-agents and workflows as you need** to keep moving.
  Keep the portal writes and the phase accounting in this session, though — the gates read this session's
  tool stream, and work done in a sub-agent may not reach the ledger the gates fold at turn end.

`CANON-ACCOUNT` refuses to let a turn end silently while phases remain. It clears two ways, and both are
listed in the block reason every time it fires: start the next phase's first real step in this turn, **or**
write the blocked journal entry in §5 and end. It never demands an outcome — only an account.

## 3. Every phase, all the way through

For each phase, in order, and without pausing between them:

1. **Read first** — `get_proposal_detail(project_id)`, `list_tasks`, `list_subtasks`, `list_flow_clusters`,
   `list_flow_connections`. One `bulk`, one round trip. The flow board's clusters and relations are real
   intent; read them every time, not once at the start.
2. **Build** on a branch, never on the auto-deploying branch. Commit each step.
3. **Test end-to-end, including UI/UX.** Run the app in the preview panel, drive the real interface, and
   **read the console** — check for errors and warnings and fix what you find. A type-check that passes is
   not a test, and "it compiles" is not delivery. The gates cannot see whether your testing was thorough;
   they can only see that you ran something. This one is on you.
4. **Verify by reading the record back.** After every write, call the mapped `get_*`/`list_*` and confirm
   the field you wrote is actually there. `CANON-READ-BACK` compels this at the next tool call and again at
   turn end, and it tells you the exact `bulk` read that clears it.
5. **Update status** (canon (c)) — `complete_task` bottom-up through the leaves, then the parent, then
   `update_proposal_milestone(status:"delivered")`, then `update_proposal_phase(status:"completed")`.
   A milestone whose tasks are all done but whose status still says otherwise is reported at turn end.
6. **Journal the phase and read it back** (canon (d), §5).
7. **Update the knowledge graph and read it back** — `extract_knowledge_graph(graph_id)` (never
   `regenerate_*`, which destroys the nodes and edges first), then `interpret_knowledge_graph`, then
   `get_knowledge_graph` / `semantic_search_knowledge_graph`. Say what changed in the graph.
8. **Go straight into the next phase.** Do not stop to announce that you are about to.

Use `bulk` for every group of calls you already know you are making (canon (f)).

## 4. When every phase is done — the summary board

On finishing **all** phases, create a summary board describing what was done:

```
create_board(title:"<project> — summary")
  → create_board_block(type:"heading"/"text")   what was built, phase by phase
  → create_board_block(type:"mermaid")          the shape of what shipped
  → a chart where a number carries the argument
  → read_board(board_id)                        the verifying read
```

Then close the run out: a **final journal entry** in the run-log folder with the lessons learnt and
anything that must be returned to, read back; and the **knowledge-graph closure** — sources covering the
journal folder, the notes, the boards, the tag query, the project and the tasks →
`extract_knowledge_graph` → `interpret_knowledge_graph` → a read-back. `CANON-CLOSEOUT` names exactly
which of these is missing, and the run auto-closes when they are all present.

## 5. The account rule — the only sanctioned way to stop

If you genuinely cannot continue — a credential is missing, a decision is the owner's to make, an external
system is down — **do not end the turn silently.** Write it down:

```
create_journal(folder_id:"<the run-log folder>", title:"<phase> — blocked",
               content:"<what stopped you, what you tried, what would unblock it>",
               tags:["blocked"], logged_at:"<today, YYYY-MM-DD>", project_id:<project>)
```

Then end the turn. A blocked run that says why is recoverable by whoever reads it next. A run that stopped
without a word is not, and the owner finds out hours later.

You may always stop with an account. You may not stop silently.

## The two honest limits

- **The gates check structure, never quality.** They can see that a journal entry exists, that a board has
  a mermaid block, that a read followed a write. They cannot see whether the phase was actually finished
  well, whether the E2E test was thorough, or whether the summary is true.
- **No hook can restart an idle session.** These gates refuse tool calls and refuse to end a turn silently
  mid-run. Nothing wakes a session that has already gone quiet — a coordinator once sat idle for over three
  hours with no hook misfiring, because an idle session ends no turn for a hook to catch. Canon (b)
  shortens the gap at turn end; it does not close it.

If a gate is blocking work it cannot un-block, `/portal-stand-down` is the escape and it is honoured
mid-session.
