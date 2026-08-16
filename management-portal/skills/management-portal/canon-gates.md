# The portal canon gates — what refuses, what advises, and how to get out

> Load-on-demand companion to the `management-portal` skill. The canon itself (the core loop, the
> three gates, board-first, bottom-up completion, never-fabricate-ids) lives in `SKILL.md` and
> `reference.md`. **This file is only about enforcement**: which rules a hook can actually refuse,
> which are reminders wearing a badge, and what to type when a gate is blocking work it cannot
> un-block.
>
> **This file is the single source of truth for gate status.** The plugin README and the public
> `/docs/mcp` page mirror the status board below. If they ever disagree, this file wins — and the
> disagreement is a bug worth fixing in the same commit.

---

## STAND DOWN — read this first if a gate is blocking you

You are probably here in a hurry. **Any one of these works, and the first two take effect
immediately, mid-session, without a restart:**

```bash
# 1. Stand one gate down, or all of them. Re-read on every hook invocation.
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" stand-down --gate <GATE-ID|all> --reason "why"
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" re-arm     --gate <GATE-ID|all>
```

```
# 2. Type the command.
/portal-stand-down [gate id or 'all'] [reason]
```

```bash
# 3. Env, for the whole session (needs a restart — that is why 1 and 2 exist).
PORTAL_CANON=off        # every gate silent
PORTAL_CANON=advisory   # nothing refuses or blocks; the Stop report still prints
```

**Three things that make this a real escape and not a promise:**

- The `stand-down` invocation is **exempt from every gate, including the coordinator gate that
  otherwise refuses `Bash`.** A gate that can block its own escape is the trap this section exists
  to prevent.
- It is a **file**, not a flag, precisely because the owner runs `defaultMode: bypassPermissions` —
  there is no permission prompt to click "no" on in an autonomous run, so the brake has to be
  something a hook re-reads from disk on every single invocation.
- Sentinels live in `<CANON_HOME>/`: `STAND-DOWN` (everything), `STAND-DOWN-<run_id>` (one run),
  `STAND-DOWN-<GATE-ID>` (one gate everywhere). **Deleting the file re-arms the gate.** You can
  also just delete `<CANON_HOME>/runs/by-project/<projhash>.json` to end a run outright.

Gates also stand **themselves** down: 3 blocks per gate per run (2 for closeout), 12 PostToolUse
blocks per session, and a dead-man rule that disarms any gate which blocks twice with no tool call
in between. A stuck session un-sticks itself even if nobody reads this page.

---

## The status board

**This is the part that matters.** In this codebase, "documented as enforced" has repeatedly not
meant "enforced": a hook that looked installed and did nothing, four gates whose failure arms could
never fire, a gate that skipped at exit 77 and therefore silently did not exist. So every rule below
carries one of exactly four states, and **no state is ever quietly rounded up to the one above it**.

| State | Means |
|---|---|
| **ENFORCED** | Observed on a real session **against this build** to refuse a call or refuse to end a turn. The observation is named. |
| **ARMED** | The code **ships** and is wired into the hook that fires it, and its behaviour is **fixture-verified** — `canon-selftest.js` spawns the real `canon-gate.js` with fixture payloads on stdin and drives each gate into its latched state and back out. **ARMED is not ENFORCED**: it says the gate exists and does what the fixtures say, not that anyone has watched it refuse a live call on this build. |
| **ADVISORY** | Verified to only inject text. It can be ignored, and sometimes should be. |
| **PENDING** | Neither the code nor the evidence. The design exists; nothing else does. Treat as advisory until proven. |

### As of 2026-08-17 — plugin 1.7.0, and two rules stopped being prose

**The engine ships.** `scripts/canon-gate.js` is present, 2062 lines, and emits a real `PreToolUse`
`hookSpecificOutput.permissionDecision: "deny"`. `hooks/hooks.json` holds **11 hook entries**, and
canon-gate owns **8** of them — one on each of `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop` and `SessionEnd`; `watch-alarm.js` owns the
other three. The advisory `portal-gate.js` that canon-gate replaces has been **deleted**.

| Rule | Verdict | **Status** |
|---|---|---|
| Team Chat turn-end ABSENT gate (`watch-alarm.js`) | refuses to end a turn | **ENFORCED** — shipping since 1.4.x, `decision: block`, verified on 2.1.222 and 2.1.85 |
| `CANON-ID`, `CANON-READ-BACK`, `CANON-BOTTOM-UP` | refuses / blocks | **ENFORCED** — observed refusing real calls in a live session on 2026-08-16. See the correction below: the first `CANON-ID` refusals were **false**. |
| Every other canon gate in the register below | refuses / blocks / advises | **ARMED** — shipped, wired, fixture-verified by 398 assertions. No live refusal observed for these. |
| The 1.4.3 read-after-write reminders (`portal-gate.js`) | reminder only | **GONE** — the file is deleted in 1.5.0. See "What 1.4.3 did" below |

**The correction that matters more than the promotion.** Three gates are now ENFORCED, and the first live
refusals `CANON-ID` produced were **wrong**. 1.5.0 read a `bulk` tool response as a string when it is really
content blocks, so every id returned inside a batch was dropped from the seen-id ledger and the gate refused
ids the server had just issued — on the batching path the canon itself tells the agent to prefer. Five more
defects of the same family followed, each found by USING the gates rather than reading them: a read-back that
could not be discharged for a long listing, a uuid FRAGMENT harvested as a phantom subtask that made
`CANON-BOTTOM-UP` unclearable, an over-long ledger row that vanished instead of arriving trimmed, a `>` inside
quotes read as a file redirection, and a block budget that switched `CANON-ACCOUNT` off for a whole day.

**A gate that refuses honest work is worse than a gate that is off**, because it is believed. That is why the
promotion to ENFORCED is written here alongside the defects rather than on its own — the evidence that they
fire is the same evidence that they fired wrongly, and reporting only the first half would be the exact
failure this board exists to prevent.

**What the evidence actually covers.** `canon-gate.js`, `canon-lib.js`, `canon-selftest.js` and
`hooks/hooks.json` merged **byte-for-byte unchanged** from the engine lane (`git diff 8666e28 HEAD`
over those four paths is empty). So the lane's own live runs — a `PreToolUse` deny genuinely
refusing under `bypassPermissions`, the cold return across a wiped ledger, debt-budget degradation,
Stop blocking at most once per turn, a deny reason read as prompt injection and correctly not
followed — exercised **these bytes**. They did **not** exercise this composition of 34 branches, on
this machine, at this HEAD. That gap is why the row above reads ARMED and not ENFORCED.

**Three tiers of evidence, and they are not interchangeable:** *fixture-verified* (the selftest
spawns the real binary under an isolated `PORTAL_CANON_HOME`; no live session, no MCP server —
the suite **currently reports 398 assertions**, which is an emergent count summed from `check()`
calls and partly driven off `REGISTER`, so **never quote 321 as a constant**); *live-verified*
(installed over the real plugin cache and driven with `claude -p --debug-file`); and *unverified*
(designed and reasoned, not observed). One gate is deliberately **fixture-proven only**:
`CANON-ID`'s provenance split has never been live-verified, because the live model **declined to
fabricate an id at all** — so a live `CANON-ID` test that "passes" may be passing because the model
refused to invent an id, not because the hook refused the call. The two are indistinguishable from
outside, and the fixture is the only evidence that separates them.

**When a live refusal is finally observed on this build, update this one table plus the README
status box and the `/docs/mcp` sections that mirror it** — they are required to agree.

### What 1.4.3 did, measured — and why the file is gone

Worth knowing, because it is the reason this whole effort exists:

- `portal-gate.js` **was 61 lines and contained no `permissionDecision` at all.** It could not
  refuse anything. It emitted a fixed `hookSpecificOutput.additionalContext` string and exited 0.
  The entire read-after-write "gate" was advisory for its whole service life, while being described
  as a gate. **In 1.5.0 that file is deleted** and `canon-gate.js` carries the rule instead.
- `additionalContext` on **PreToolUse/PostToolUse is still not proven to reach the model** on
  2.1.231. Plain stdout is definitely discarded (measured on 2.1.222, Windows). So those two
  reminders may have been reaching nobody at all. **No canon gate depends on that channel** — the
  refusals travel on `permissionDecision`, and the escapes on `SessionStart`/`UserPromptSubmit`
  `additionalContext` and on `PostToolUse`/`Stop` block reasons, all three of which are proven.
- The 1.4.3 hook matcher, `mcp__(plugin_management-portal_)?management-portal__…`, was a **full**
  match — so it was **inert** for a claude.ai-connector install (`mcp__claude_ai_management-portal__*`)
  and for a UUID-named install (`mcp__<uuid>__*`). Both spellings are live in the wild. **1.5.0 fixes
  this the only way that generalises:** the `PreToolUse` and `PostToolUse` matchers are now `.*`, and
  the scoping happens **at runtime** against a frozen set of 257 portal tool names. A tool outside
  that set is never subject to a portal invariant, which is what keeps Supabase, Desktop Commander,
  chrome-devtools and playwright out of the blast radius. **Never enumerate install spellings in a
  regex again** — that is how this broke in the first place.

---

## The verdict vocabulary

Three words, used precisely, everywhere in this system:

- **REFUSE** — a `PreToolUse` deny. **The call never runs.** Nothing happened to your data.
- **BLOCK** — a `PostToolUse` or `Stop` `decision: block`. **The action already happened**; you are
  being compelled to do something before continuing or before the turn may end.
- **ADVISE** — text only. Nothing is prevented. Ignoring it has no mechanical consequence.

### Why refusal reasons sound curt and never tell you what to do

Measured twice: **instructions inside a `PreToolUse` deny reason are read as prompt injection and
deliberately not followed.** A deny reason that says "to clear this, call X" gets the gate itself
reported as an attack. So refusal reasons state facts only — the gate id, the fact about this call,
the canon rule — and every clearing action is published through the channels the model does trust:
the session-start canon card, `PostToolUse` block reasons, and `Stop` block reasons. **If a refusal
seems unhelpfully terse, that is the design, not an oversight.** The clearing action is on the card.

---

## The liveness proof — no card, no gates

Every session opens with a **canon card** injected at `SessionStart`, and its first line is:

```
[portal-canon v1 · alive · token <6 hex chars>]
```

That token is also written to the ledger. **Its presence is the only in-conversation proof the gates
are running.** Hooks fail open and silently: on a crash and on a timeout the tool call proceeds and
the model is told nothing, so **a green conversation is not evidence a gate is alive.** A dead gate
looks exactly like a live one from inside the conversation.

The card also carries the run state, the gate register, and the stand-down block verbatim.

### Checking properly, from a terminal

```bash
claude -p "list two files" --output-format stream-json --include-hook-events --verbose
```

Look for `{"type":"system","subtype":"hook_response","hook_name":"PreToolUse:…","exit_code":0,…}`.
An `outcome` of `"error"` means the gate **crashed**; `"cancelled"` means it **timed out**. Both fail
open silently.

```bash
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" doctor    # home, run, gates armed, last 5 blocks
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" selftest  # fixture payloads through every mode
```

---

## The gate register

**Status of every row: ARMED — shipped, wired and fixture-verified; no live refusal has been
observed against this build.** See the status board. This register is now a description of
`canon-gate.js` as it stands, not a design contract.

**Read the fourth column. It is the anti-latch mechanism, and it is the reason this table is
shaped like this.** Two gates once shipped as **one-way latches**: `CANON-COORD-ROLE` latched on
`claim_coordinator_title` with nothing anywhere able to un-latch it, and `CANON-JOURNAL-PHASE`
refused `create_journal` — *the exact call it demanded* — because `create_journal` is itself a
portal write. A gate that refuses the action it names is worse than no gate: the model does what the
card says, the refusal persists, and the escape text loses its credit along with it. So the key is
held as **data** in `REGISTER`'s fourth column, and `canon-selftest.js` drives each gate into its
latched state and back out **through exactly those calls**. **Documentation that omits this column
recreates the bug.**

`REGISTER` carries **13 gates**. `CANON-READ-BACK-STOP` is a real, separately stand-downable gate
that is **not** in `REGISTER` — so it never appears on the canon card or in `doctor` output, even
though its own block reason tells you to stand it down by name. Three advisories sit outside it too.

### Refusals (PreToolUse — the call never runs)

Listed in `evaluateCall()` order. **The debt gates are first, deliberately**, so a debt refusal
cannot hide behind another gate's reason.

| Gate | Refuses | Clears by | **Never refuses** (anti-latch key) |
|---|---|---|---|
| **CANON-DEBT-READ-BACK** | The **next turn's work** while an earlier turn's write is still unread (`work` = portal write ‖ file write ‖ mutating command). | The mapped read — `read_board` / `get_task` / `list_tasks`. `run-close` settles it outright. | those reads, plus `create_journal`, plus every other gate's clearing key. Budget **3 per distinct debt**, then that debt stands down permanently; 7-day TTL. |
| **CANON-DEBT-CLOSEOUT** | The **next turn's work** while the run's close-out is unmade. | `create_board` + `create_knowledge_graph` + `extract_` + `interpret_` + `create_journal`. | the 8 in `CLOSEOUT_CLEARING`: `create_board`, `create_board_block`, `create_knowledge_graph`, `add_source_to_knowledge_graph`, `extract_knowledge_graph`, `interpret_knowledge_graph`, `create_journal`, `update_journal`. Same budget. |
| **CANON-ID** | A portal write carrying an id this session never saw. Candidates come from the call's own arguments only, never from the payload envelope. | Any `list_*`/`get_*` that returns it, or the owner typing it. | — |
| **CANON-BOTTOM-UP** | `complete_task(X)` when no `list_subtasks(parent_task_id=X)` was read this session, or when a listed child of X has no recorded completion. | `list_subtasks(X)`, then complete the children, then the parent. | — |
| **CANON-COORD-ROLE** | **Any file write or mutating command** while this session holds the coordinator title. It reads **what the call does** — the file it writes, the program its command line runs — **not which tool carried it**, so `PowerShell` and `bulk` are covered exactly as `Bash` is. Portal tools have an empty effect, so **portal writes are not refused here**. | `transfer_coordinator_title`, or standing this one gate down. | `transfer_coordinator_title` |
| **CANON-POLICY-FIRST** | In participant mode: the first portal write or file edit before both `read_channel_policy` and `read_channel_messages`. | Read the policy and the messages. | — |
| **CANON-JOURNAL-PHASE** | In a RUN: the first portal write after a phase boundary, when the journal has not been both written and read back since that boundary. | `create_journal(folder_id=…)` **and** a `get_journal`/`list_journals`/`search_journals` read-back. | `create_journal`, `update_journal`, `create_journal_folder` |
| **CANON-KG-DESTRUCTIVE** | In a RUN: `delete_knowledge_graph` and `regenerate_knowledge_graph` — **both destroy nodes and edges** — plus `generate_knowledge_graph` on a graph already seen. Deletion destroys strictly more than regeneration and was previously ungated. | `extract_knowledge_graph`, the incremental path; `remove_source_from_knowledge_graph` narrows a graph without destroying it. Owner authorisation is the `ALLOW-KG-REGEN-<run_id>` sentinel, which is preferred over standing the gate down. | — |
| **CANON-TREE-FIRST** | Any write to a project source file before the task tree and flow board exist (≥1 each of `create_task`, `create_subtask`, `create_flow_cluster`, `create_flow_connection`). **Armed in ALIGN as well as RUN.** | Build the breakdown first. Exempts `node_modules`, `.git`, build dirs, `*.md`, `*.log`, lockfiles, and any path containing `agent-onboarding` or `management-portal-canon`. | — |
| | **Since 1.6.3** the four calls are recorded on the RUN, so they survive a restart and are visible to a sub-agent — whose own stream never contains portal writes, and must not. |
| **CANON-BOARD-FIRST** | While a run is in ALIGN: `update_brief`, `update_brief_field`, `create_proposal`, `add_proposal_phase`, `add_proposal_milestone`, `create_task`, **`create_subtask`** and **`insert_diagram`**. The last two were holes you could drive the whole gate through — build the tree one subtask at a time, or paste the roadmap straight into the proposal, without ever making the board. | `create_board` + a `mermaid` block + `read_board`. **Inert once the run is promoted to RUN.** | — |

### Compulsions (PostToolUse / Stop — the action already happened)

| Gate | Blocks when | Clears by |
|---|---|---|
| **CANON-READ-BACK** | A portal write has no mapped read carrying the same id. Once per turn, 12 per session. **Deletes clear on ABSENCE** — the block text says so, because an id coming *back* after a delete is proof the delete failed. | The mapped read from the write→read map (`reference.md` §3) — ideally one `bulk` of them. |
| **CANON-FLOW-READ** | A portal write after a phase boundary with the flow board unread. The board carries dependency order that exists nowhere else, and a phase can be delivered out of that order with nothing to say so. | `list_flow_clusters` **and** `list_flow_connections` since the boundary. Clusters alone do not clear it — the relations are the ordering. Journalling is exempt, or this and CANON-JOURNAL-PHASE deadlock. |
| **CANON-STATUS-SYNC** | Setting a milestone to `delivered`/`approved` with the task tree unread. Measured: eleven milestones delivered in a day against two completed tasks, leaving the tree claiming "pending" for shipped work. | `list_subtasks` / `list_tasks` / `get_task` since the boundary. It CANNOT verify the mapping — milestones and tasks share no key, only a naming convention — so it enforces the one thing it honestly can: that you looked. |
| **CANON-ACCOUNT** | A turn is ending with phases remaining and no journal entry written this turn. Budget 3 per run, **refunded by progress since 1.6.1 and by a new session since 1.6.4**. | Continue into the next phase's first real step, **or** journal what stopped you, tagged `blocked`. You may not stop silently; you may always stop with an account. |
| **CANON-READ-BACK-STOP** | Read-back obligations are still open at turn end. Budget 3. ⚠ **Not in `REGISTER`** — so it appears on neither the canon card nor `doctor`. | The same bulk read. |
| **CANON-CLOSEOUT** | All phases are terminal but the summary board, the knowledge-graph closure, or the final journal entry is missing. Budget 2. | Whichever the reason names. When nothing is missing it **auto-closes the run**. |

Exceeding a Stop budget writes `run.degraded[gate]` and that gate becomes **permanently advisory for
that run**. **A Stop gate blocks at most once per turn, by design** — see the honest limits below.

### Reports (Stop — never blocks)

**CANON-COMPLETE** names phases/milestones with an empty required field, and missing initiation
items. **CANON-BULK** counts single writes that should have been one `bulk` call. **CANON-STATUS**
cross-references milestones whose tasks are all done but whose status was never updated.

These are **advisory by design, not by weakness.** A deny on the fourth single write cannot undo the
first three; single calls are sometimes right; and completeness is a judgement about content, which
no hook can make.

---

## The honest limits — never soften these

**1. A hook cannot make an idle session resume.** This is the big one, and it sits directly under
canon (b), "never stop between phases". A hook can refuse a tool call and can refuse to end a turn.
It **cannot** wake a session that is already sitting idle — measured: a coordinator was absent for
3h06m while no hook misfired, because an idle session ends no turn. So (b) ships as **"never end a
turn silently mid-run"**, which is enforceable, and **not** as "never stop", which is not. Do not
blur those two.

**2. A Stop gate blocks at most once per turn, and that is deliberate safety.** `stop_hook_active`
short-circuits above the block check, and it is the only reason this plugin cannot trap its owner:
the runtime hard-caps consecutive Stop blocks at 9 and then ends the turn with an **empty result**.
The leak is stated plainly rather than hidden — `stop#1 BLOCK → stop#2 SPEAK → stop#3 BLOCK →
stop#4 ALLOW`, and the turn ends with the write unverified and phases remaining. **The Stop half
delays a violating turn by one exchange; it does not prevent it.** That is precisely **why the debt
gates exist**: the turn may end, the obligation is written down, and the *next* turn's first action
answers for it. Debt is keyed by **project, not session** — a debt left on Friday refuses the first
work on Monday, and a debt that evaporated because you opened a new terminal would be the same leak
wearing a different hat.

**3. CANON-READ-BACK proves a read happened, not that you compared anything.** It proves a mapped
read ran and returned a record carrying that id. Whether you actually looked at the field you wrote
is between you and the work.

**4. Gates judge STRUCTURE, never QUALITY.** "A brief exists and was read back" is checkable. "The
brief is good" is not, and nothing here pretends otherwise. The selftest asserts it verbatim: *they
cannot tell whether a brief is good.*

**5. Hooks fail open.** Crash or timeout ⇒ the call proceeds, silently. That is deliberate — a gate
that crashes must never be the reason your turn fails — and it is why the canon card and `doctor`
exist. **A dead gate is indistinguishable from a live one from inside the conversation**, which is
also why "the gates are armed" above is an out-of-band claim about the shipped files and the
fixtures, and not something you can confirm by having a quiet session.

**6. On OAuth installs the Stop-time portal read often 401s.** `watch-alarm` returned `http_401`
seven turns running on this machine. When it fails, the Stop reports fall back to local ledger
evidence and label themselves **"local evidence, not a verdict"**, and they inform rather than block.

---

## NOT CHECKABLE BY ANY HOOK

This list ships verbatim in the plugin skill and on the public docs page so that nobody later builds
a gate that pretends. No hook can check:

- whether a brief, proposal, phase or milestone description is **GOOD**;
- whether a mermaid diagram is **USEFUL** or even correct;
- whether a decomposition is the **RIGHT** one;
- whether a channel policy is well written — **the nine-heading check is trivially satisfied by nine
  empty headings**; it is a completeness prompt and never counts as verification;
- whether journal lessons are insightful;
- whether a graph interpretation is sound;
- whether the coordinator's instructions were **FOLLOWED**;
- whether E2E testing was thorough (only that test tools ran);
- whether the deliverables actually satisfy the acceptance criteria (only that both fields are
  non-empty).

---

## The run lifecycle

Gates that would be obnoxious on a one-line edit are scoped to a **run**: a manifest on disk, keyed
by project, that survives compaction and session death.

```
none  →  ALIGN  →  RUN  →  CLOSED
```

- **ALIGN** — board-first governs. Stopping for the human is **correct** here. `CANON-BOARD-FIRST`
  is armed; `CANON-ACCOUNT` is inert.
- **RUN** — canon (b) governs. `CANON-ACCOUNT`, `CANON-JOURNAL-PHASE` and `CANON-TREE-FIRST` arm;
  `CANON-BOARD-FIRST` goes inert.
- **CLOSED** — nothing gates.

That split is the resolution of an apparent contradiction: **board-first governs the initiation of
new work; (b) governs phases inside an already-approved plan.** They never both apply.

Runs open via `/portal-project` (ALIGN) or, if that is skipped, automatically on a `create_project`
with no active run. `/portal-continue` promotes ALIGN → RUN. Runs close on completion, on
`run-close`, on a stand-down sentinel, or automatically after **24h with no recorded progress**.

**The known failure mode, named rather than hidden:** a session that dies mid-run leaves the state
at RUN, and later sessions in that project spend one block per turn until the 24h TTL expires,
someone stands it down, or the run is closed. Mitigated five ways; not removed.

---

## The commands

| Command | Carries |
|---|---|
| `/portal-project <client> <project> [scope]` | Full initiation: alignment board, brief, proposal, phases, milestones, task tree, flow board, journal folder, knowledge graph. Opens the run in ALIGN. |
| `/portal-continue [run or project]` | Promotes to RUN and resumes autonomously — no confirmation between phases. |
| `/channel-coordinate <channel> <identity> [agents…]` | Join as coordinator, claim the title, publish the nine-section channel policy. |
| `/channel-join <channel> <identity>` | Join as participant: policy and messages first, then the mission. |
| `/portal-stand-down [gate] [reason]` | The escape. |
| `/portal-rearm [gate]` | The way back. Names any gate still stood down, so a partial re-arm cannot read as done. |
| `/portal-rearm [gate]` | The way back — and it names any gate still stood down. |
| `/plain-english [what]` | Carries no canon and gates nothing. Re-states the work in plain language for someone who does not work on the code, and holds that register for the rest of the session. It changes how things are said, never what is true — a caveat that would change the reader's decision stays in. |

Command bodies are a **trusted channel** — imperatives there are followed normally. That is exactly
why the clearing actions live in the commands and on the canon card rather than in refusal reasons.

---

## Privacy — what the ledger stores

The gates work from a local append-only ledger, not from network calls. It is a plaintext file with
ordinary user ACLs, so what goes in it matters.

**Recorded:** tool names, uuids, booleans, durations, and a fixed allow-list of scalar id/status
arguments.

**Never recorded:** titles, names, bodies, content, descriptions, messages, objectives, deliverables,
acceptance criteria, lessons, moods, reflections, or any prompt or response text. Implemented as an
**allow-list, not a deny-list**.

**The journal is somebody's private account of how their days actually went. The ledger stores that
a journal entry happened, and never a word of what it said.**

Ledger location: `PORTAL_CANON_HOME`, else the plugin data dir (`CLAUDE_PLUGIN_DATA`), else — from
1.6.0 — **the live home discovered on disk**, else `~/.claude/plugins/data/management-portal-canon`.
Session files are deleted at session end and swept after 48h regardless. `doctor` prints both the
resolved path and **which of those four rules produced it**.

> **Two installs, two ledgers — and the CLI used to be the second install.** `CLAUDE_PLUGIN_DATA` is
> set for a hook and **unset for a Bash invocation**, and `/portal-continue` opens by running
> `canon-gate.js run-promote` from Bash. So the run was written to one home while every gate read
> another, and the card kept saying `no run declared` however many times it was promoted — the
> command's own first step was a silent no-op. **1.6.0 fixes that**: with no env set, the CLI now
> finds the home whose `sessions/` was written to most recently instead of assuming a folder name,
> which matters because a machine can carry several of them under different marketplace names.
>
> Two genuinely separate installs (marketplace vs `--plugin-dir`) can still keep separate ledgers.
> Set `PORTAL_CANON_HOME` in both to force one.
