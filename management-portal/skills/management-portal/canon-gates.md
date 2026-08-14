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
>
> **Nothing below has shipped.** The released plugin is **1.4.3** and contains no canon gate at all.
> The gate engine lives on `feat/canon-hooks-enforce`, the slash commands on `feat/canon-commands`,
> and this page on `feat/canon-docs`; all three fork independently from master. Read every sentence
> here as *what the merged build does*, never as *what your install does*. The one way to tell them
> apart from inside a session is the canon card — see "The liveness proof".

---

## STAND DOWN — read this first if a gate is blocking you

You are probably here in a hurry. **Any one of these works, and the first takes effect immediately,
mid-session, without a restart:**

```bash
# 1. Stand one gate down, or all of them. Re-read on every hook invocation.
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" stand-down --gate <GATE-ID|all> --reason "why"
```

```
# 2. Type the command. Ships on the commands lane only — see "The merge trap".
/portal-stand-down [gate id or 'all'] [reason]
```

```bash
# 3. Env, for the whole session (needs a restart — that is why 1 and 2 exist).
PORTAL_CANON=off        # every gate silent
PORTAL_CANON=advisory   # nothing refuses or blocks; the Stop report still prints
```

`/portal-stand-down` takes no argument it can refuse: no gate id stands down **all**, and an
unrecognised gate id prints the list and stands down **all**. An escape hatch that interrogates you
is not an escape hatch.

**Three things that make this a real escape and not a promise:**

- The `stand-down` invocation is **exempt from every gate**, and it is matched against **any shell
  string in any tool's arguments** — not just `Bash`. It used to test `raw === 'Bash'`, which meant a
  session latched by the coordinator gate could not escape from PowerShell. A gate that can block its
  own escape is the trap this section exists to prevent.
- It is a **file**, not a flag, precisely because the owner runs `defaultMode: bypassPermissions` —
  there is no permission prompt to click "no" on in an autonomous run, so the brake has to be
  something a hook re-reads from disk on every single invocation.
- Sentinels live in `<CANON_HOME>/`: `STAND-DOWN` (everything), `STAND-DOWN-<run_id>` (one run),
  `STAND-DOWN-<GATE-ID>` (one gate everywhere). **Deleting the file re-arms the gate.** You can
  also just delete `<CANON_HOME>/runs/by-project/<projhash>.json` to end a run outright.

Gates also stand **themselves** down: 3 Stop blocks per gate per run (2 for closeout), 3 refusals per
distinct debt, 12 PostToolUse blocks per session, a 7-day debt TTL, a 24h run TTL, and a dead-man rule
that disarms any gate which blocks twice with no tool call in between. A stuck session un-sticks
itself even if nobody reads this page.

**`run-close` is the clean exit, not a stand-down.** It closes the run, deletes the debt file **and
stamps `run.debt_settled_at`**. The stamp is load-bearing: deleting the file alone did not work,
because the fold rebuilt the debt from the replayed ledger on the next call.

---

## The status board

**This is the part that matters.** In this codebase, "documented as enforced" has repeatedly not
meant "enforced": a hook that looked installed and did nothing, gates whose failure arms could never
fire, a gate that skipped at exit 77 and therefore silently did not exist. So every rule below
carries a **verdict class** and, separately, a **proven status** — and neither one is ever quietly
rounded up.

| Verdict class | Means |
|---|---|
| **ENFORCED** | Refuses a call, or refuses to end a turn. |
| **ADVISORY** | Injects text only. It can be ignored, and sometimes should be. |
| **PENDING** | Designed, not yet released. The design is below; no install contains it. |

| Proven status | Means |
|---|---|
| **live-verified** | Installed over the real plugin cache and driven with `claude -p` on 2.1.231 with `--debug-file`. Observed, not reasoned. |
| **fixture-verified** | `canon-selftest.js` spawns the real `canon-gate.js` with fixture payloads on stdin under an isolated `PORTAL_CANON_HOME`. No live session, no MCP server. Proves the code path; does not prove the model meets it. |
| **unverified** | Designed and reasoned, never observed. Say so out loud. |

### As of 2026-08-14 — unreleased; master ships 1.4.3

| Rule | Verdict class | Proven status |
|---|---|---|
| Team Chat turn-end ABSENT gate (`watch-alarm.js`) | **ENFORCED** | **live-verified** — `decision: block`, on 2.1.222 and 2.1.85. Shipping since 1.4.x |
| Gate 1 read-after-write reminders (`portal-gate.js`, 1.4.3) | **ADVISORY** | **live-verified as advisory**, and weaker than it looks — see "What 1.4.3 actually does" |
| Every canon gate in the register below | **PENDING — no release contains them** | **fixture-verified** across the register; several of the mechanisms they rest on are **live-verified**; one path is **fixture-only**. See "What is proven, and how" |

The canon gates ship in a release that does not exist yet. **Do not tell anyone a canon gate is
protecting them until an install exists that contains one.** When the code lanes merge and the
version moves, update this one table and the README and `/docs/mcp` sections that mirror it.

### What 1.4.3 actually does, measured

Worth knowing, because it is the reason this whole effort exists:

- `portal-gate.js` is **61 lines and contains no `permissionDecision` at all.** It cannot refuse
  anything. It emits a fixed `hookSpecificOutput.additionalContext` string and exits 0. The entire
  read-after-write "gate" has been advisory since it shipped.
- Worse, `additionalContext` on **PreToolUse/PostToolUse is not proven to reach the model** on
  2.1.231. Plain stdout is definitely discarded (measured on 2.1.222, Windows). So those two
  reminders may be reaching nobody at all. **No new gate may depend on that channel**, and none does.
- The shipped hook matcher, `mcp__(plugin_management-portal_)?management-portal__…`, is a **full**
  match — so it is **inert** for a claude.ai-connector install (`mcp__claude_ai_management-portal__*`)
  and for a UUID-named install (`mcp__<uuid>__*`). Both spellings are live in the wild; this session's
  own tool registry carries a UUID-named copy of the portal tools that the shipped matcher would
  never fire on. The gate engine matches `.*` and scopes at runtime instead — see "Scoping".

---

## What is proven, and how

**Live-verified:**

- A `PreToolUse` `permissionDecision: "deny"` genuinely refuses the call, on MCP tools, inside
  subagents, and over a global `bypassPermissions`.
- The `PowerShell` bypass, measured as a **failure before the fix**: `permission_denials: []` and
  zero hook entries.
- **The cold return, end to end.** Run 1 ended `stop_reason: end_turn` with the close-out missing;
  run 2, in a **new session whose ledger had been wiped**, had its first `Write` DENIED.
- **The split-channel design.** On a 3-day-old debt the model recovered `read_board("7b3f1a2e-…")`
  verbatim — a string present **only** in `additionalContext` and never in the deny reason. That is
  direct evidence that facts belong in refusals and instructions belong in the trusted channels.
- Debt budget degradation: 3 denials, success on the 4th.
- Stop blocking **at most once per turn**, across 5 turns.
- Deny-reason-as-injection, measured twice.

**Fixture-proven ONLY — the id-laundering path.** `CANON-ID`'s provenance split has never been
live-verified, **because the live model declined to fabricate an id at all**. This distinction has to
survive every rewrite of this page: **a `CANON-ID` test that passes live may be passing because the
model refused to invent an id, not because the hook refused the call.** The two are indistinguishable
from outside the process. The fixture is the only evidence that separates them, and it is the only
reason we can say the hook does anything here.

**Explicitly NOT proven:**

- Pre/PostToolUse `additionalContext` (which is why nothing depends on it).
- `run.all_phases_terminal`'s real derivation — only ever reached in fixtures by patching the run
  manifest.
- Whether a reason carrying **no** imperatives still trips the injection heuristic.
- Whether the Stop ordering guarantee below holds under the runtime.

**The selftest count.** The suite currently reports **321 assertions**, 0 failed. **`321` appears
nowhere in the source** — it is the runtime sum of `check()` calls, partly data-driven off the
register, so adding one register row silently changes it. Quote it as "currently reports", never as a
constant. There is no argv filter: no `--only`, no `--grep`. And **the selftest contains zero timing
instrumentation** — it is a correctness harness and measures no latency whatsoever. Performance
numbers come from a separate A/B run; see `agent-onboarding/CANON-GATES.md`.

---

## The verdict vocabulary

Three words, used precisely, everywhere in this system:

- **REFUSE** — a `PreToolUse` deny. **The call never runs.** Nothing happened to your data.
- **BLOCK** — a `PostToolUse` or `Stop` `decision: block`. **The action already happened**; you are
  being compelled to do something before continuing or before the turn may end.
- **ADVISE** — text only. Nothing is prevented. Ignoring it has no mechanical consequence.

### Why refusal reasons sound curt and never tell you what to do

Measured twice: **instructions inside a `PreToolUse` deny reason are read as prompt injection and
deliberately not followed.** A third probe told the model to write an unlock file; it declined, and
it was right to. A deny reason that says "to clear this, call X" gets the gate itself reported as an
attack.

So refusal reasons **state facts only and carry no imperatives** — the gate id, values lifted from
*this call*, the canon rule — and when a gate can name nothing concrete it says nothing. This is
checked mechanically, not by taste: `evaluateCall()` contains zero occurrences of `standDownLine`,
`/portal-stand-down`, or `TO STAND IT DOWN`.

Every clearing action travels through the channels the model does trust: the `SessionStart` canon
card, `UserPromptSubmit` context, and `PostToolUse` / `Stop` block reasons.

One deliberate wording rule: **deny reasons say "a turn in this project", never "this session".**
Debt is keyed by project and outlives a session, so the "this session" phrasing would be false in
exactly the case the gate exists for — and a refusal the reader can disprove has spent its credit.

**If a refusal seems unhelpfully terse, that is the design, not an oversight.** The clearing action
is on the card.

---

## The liveness proof — no card, no gates

Every session opens with a **canon card** injected at `SessionStart`, and its first line is:

```
[portal-canon v1 · alive · token <6 hex chars>]
```

That token is also written to the ledger. **Its presence is the only in-conversation proof the gates
are running.** Hooks fail open **and silently**: on a crash and on a timeout the tool call proceeds
and the model is told nothing, so **a green conversation is not evidence a gate is alive.** A dead
gate looks exactly like a live one from inside the conversation.

The card also carries the run state, the gate register, and the stand-down block verbatim. It is
capped at `CARD_CAP = 3000` characters (raised from 2600 — the live card measured 2614) and it is
assembled in three pieces, **head / gates / tail**, rather than truncated: a blind `slice()` cuts the
tail first, and the tail is **the escape**. The one thing a reader in trouble needs is the one thing
a naive cap would delete.

### Checking properly, from a terminal

```bash
claude -p "list two files" --output-format stream-json --include-hook-events --verbose
claude -p "…" --debug-file ./hooks.log     # the same evidence, written to a file
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

**13 gates live in `REGISTER`.** Plus `CANON-READ-BACK-STOP`, a real and separately stand-downable
gate that is **not** in `REGISTER` (see the gap flagged below). Plus 3 advisories. Seventeen distinct
`CANON-*` ids exist in the code.

**Verdict class of every row: PENDING — no release contains them.** Proven status: fixture-verified,
with the live-verified and fixture-only exceptions named above.

### The fourth column is the point

`REGISTER`'s fourth column is **the tools this gate may never refuse**. It is held as data, not as a
comment, and the selftest drives every gate into its latched state and back out through exactly those
calls. **A version of this register without that column recreates the bug it exists to prevent.**

The bug is a **latch**: a gate whose own exit condition is unreachable, so the only way out is the
stand-down. Six of them were found in this feature.

**Four shipped as latches and were fixed:**

1. `CANON-COORD-ROLE` — nothing anywhere wrote a second `mode` row, so the title could be entered and
   never left.
2. `CANON-JOURNAL-PHASE` — refused `create_journal`, the exact call it demanded.
3. **bulk inner ids** — ids returned by `bulk` inner calls never entered the seen set, so
   `bulk([create_task])` followed by `update_task(<that id>)` was refused for an id the portal had
   just issued.
4. **delete-obligation polarity** — seven `delete_*` rows could only be discharged by the id coming
   *back*, which is proof the delete **failed**.

**Two more were found and designed out before shipping**, both at the debt gates:

5. `CLOSEOUT_CLEARING` — every close-out artifact is itself a portal write, so a gate refusing portal
   writes until the close-out exists would refuse the close-out.
6. The `OTHER_GATE_KEYS` **seam** — `CANON-ACCOUNT` publishes `create_journal(tags=["blocked"])` as
   "you may always stop with an account". A debt gate refusing that call builds a latch **between two
   individually-safe gates**, which is the kind no single gate's tests would catch.

The rule that came out of it: **every state the ledger can enter needs a key proven to turn**, not
merely documented. The fourth column is that key as data.

Where the column reads **none needed**, the gate's clearing calls fall outside its own gated set by
construction — most often because reads are never work, so no gate can refuse the read that clears
it. That is still a claim the selftest drives, not an assumption.

### Refusals (PreToolUse — the call never runs), in `evaluateCall()` order

**The two debt gates are evaluated first, deliberately**, so a debt refusal can never hide behind
another gate's reason.

| Gate | Refuses | Clears by | May never refuse | Budget |
|---|---|---|---|---|
| **CANON-DEBT-READ-BACK** | the next turn's *work* while an earlier turn's write is still unread. `work = portal write, file write, or mutating command` | the mapped read — `read_board` / `get_task` / `list_tasks`, whichever the write owed | those reads, `create_journal`, and every key in `OTHER_GATE_KEYS` | **3 per distinct debt**, then that debt stands down permanently. 7-day TTL. `run-close` settles it |
| **CANON-DEBT-CLOSEOUT** | the next turn's *work* while the close-out is unmade | `create_board`, `create_knowledge_graph`, `extract_`, `interpret_`, `create_journal` | the 8 calls in `CLOSEOUT_CLEARING` | same |
| **CANON-ID** | a portal write carrying an id this session never saw. Candidates come from `harvestArgIds(tool_input)` **only** — never the payload envelope | any `list_*`/`get_*` that returns it, including a `create_*` response; or the owner typing it into the conversation | none needed | none. The old "first 3 tool calls" cold-start grace has been **narrowed so far that it effectively never applies to a normal session** — write as if there is no grace |
| **CANON-BOTTOM-UP** | `complete_task(X)` before X's subtasks have been listed and each child completed | `list_subtasks(parent_task_id=X)`, then complete the children, then the parent | none needed | none |
| **CANON-COORD-ROLE** | **any file write or mutating command** while holding the coordinator title. Judged **by effect**, not by tool name: nothing anywhere asks whether the tool is called `Bash`. Portal tools carry an empty `effect`, so **portal writes are not refused here** | `transfer_coordinator_title` — the coordinator counsels and coordinates; it does not implement | `transfer_coordinator_title` | none |
| **CANON-POLICY-FIRST** | a participant acting before reading the channel | `read_channel_policy` **and** `read_channel_messages` | none needed | none |
| **CANON-JOURNAL-PHASE** | the first portal write after a phase boundary, unjournalled | `create_journal(folder_id=…)` into the run's journal folder **and** a journal read-back | `create_journal`, `update_journal`, `create_journal_folder` | none |
| **CANON-KG-DESTRUCTIVE** | `delete_knowledge_graph`, `regenerate_knowledge_graph`, and `generate_knowledge_graph` on a `graph_id` already seen | `extract_knowledge_graph` — the incremental path; or the `ALLOW-KG-REGEN-<run_id>` sentinel, which is preferred over standing the gate down | none needed | none |
| **CANON-TREE-FIRST** | any write to a project source file before the task tree and flow board exist. **Armed in ALIGN as well as RUN** (`isRun` = state is anything but CLOSED) | one each of `create_task`, `create_subtask`, `create_flow_cluster`, `create_flow_connection` | none needed | none. Exempts `node_modules`, `.git`, build dirs, `*.md`, `*.log`, lockfiles, and any path containing `agent-onboarding` or `management-portal-canon` |
| **CANON-BOARD-FIRST** | brief / proposal / task writes before the alignment board. The gated set **includes `create_subtask` and `insert_diagram`** | `create_board` + a mermaid block + `read_board` | none needed | **inert once the run is promoted to RUN.** Governs initiation only |

### Compulsions (PostToolUse / Stop — the action already happened)

| Gate | Blocks when | Clears by | May never refuse | Budget |
|---|---|---|---|---|
| **CANON-READ-BACK** (PostToolUse) | a portal write left an open obligation | the mapped `get_*`/`list_*` from the write→read map, ideally batched into one `bulk`. **Deletes clear on ABSENCE** — the block text says so | n/a — a PostToolUse block never refuses a call | `POST_BLOCK_CAP = 12` per session, once per turn, plus the dead-man rule: two blocks with no tool call between them and it goes quiet |
| **CANON-READ-BACK-STOP** (Stop) | read-back obligations are still open at turn end | the same bulk read | n/a | 3 per run |
| **CANON-ACCOUNT** (Stop) | the run is in RUN, phases remain, and no journal was written this turn | starting the next phase's first real step, **or** `create_journal(tags=["blocked"])` plus a read-back. You may not stop silently; you may always stop with an account | n/a | 3 per run |
| **CANON-CLOSEOUT** (Stop) | RUN, all phases terminal, and `closeoutMissing()` is non-empty | whichever item the reason names. **When nothing is missing it auto-closes the run** | n/a | 2 per run |

Exceeding a Stop budget writes `run.degraded[<gate>]`, which makes that gate **permanently advisory
for that run**. It never comes back on by itself.

`closeoutMissing()` checks seven things: a summary board with at least one block,
`create_knowledge_graph`, at least 3 distinct source types, `extract_`, `interpret_`, a KG read-back,
and a journal write **plus** its read.

**KNOWN GAP — `CANON-READ-BACK-STOP` is not in `REGISTER`.** It is a real gate, it blocks, and it can
be stood down by id like any other. But because it is not a register row it **never appears on the
canon card and never appears in `doctor` output**. A reader auditing either surface will conclude it
does not exist. It is listed here so that at least one surface tells the truth; the fix is to give it
a register row.

### Reports (Stop — never blocks)

**CANON-COMPLETE** names phases and milestones with an empty required field, and missing initiation
items. **CANON-BULK** fires at **3 or more single writes** that should have been one `bulk` call.
**CANON-STATUS** cross-references milestones whose tasks are all done but whose status was never
updated.

These are **advisory by design, not by weakness.** In the words of the first commit: *"a deny on call
#4 cannot undo calls 1 to 3."* Single calls are sometimes right, and completeness is a judgement
about content, which no hook can make.

### Scoping — what is even eligible to be gated

- **`PORTAL_TOOLS` is a frozen set of 257 names.** A tool is a portal tool if and only if its raw
  name matches `^mcp__.+?__(.+)$` and the tail is in that set. **A tool outside the set is never
  subject to a portal invariant** — that is what keeps Supabase, Desktop_Commander, chrome-devtools
  and playwright out of the blast radius, on every install spelling, without enumerating spellings in
  a regex.
- **`WRITE_READ_MAP` carries 98 write→read rows.** Not the ~60 an older draft of this page implied.
- **Non-portal tools are judged purely by ARGUMENT SHAPE**: does some key carry a shell command line,
  does some key name a file about to be written. **Nothing asks whether the tool is called `Bash`.**
  This is why `PowerShell` and `bulk` used to walk past every name-shaped matcher.
- `modePre` calls `quiet()` **before touching disk** whenever a call is neither portal nor mutating —
  which is most calls, and which is why the ungated path costs nothing (see the performance section
  of `agent-onboarding/CANON-GATES.md`).

### Where the gates hang

Eight distinct hook events, not five: `SessionStart` (registered twice — the canon card and
watch-alarm's preflight, and both deliver), `UserPromptSubmit`, `PreToolUse`, `PostToolUse`
(registered twice), `SubagentStart`, `SubagentStop`, `Stop` (registered twice), `SessionEnd`. The
full registration table with the measured evidence for each is in `agent-onboarding/CANON-GATES.md`.

**Stop ordering matters and is worth knowing here:** watch-alarm's `check` runs **before**
canon-gate's `stop`, and canon-gate **yields silently if watch-alarm blocked within the last 90
seconds**. Two gates blocking the same turn would spend the runtime's 9-block budget by accident.
**Whether the runtime actually guarantees that ordering has not been verified** — the yield is
written defensively on the assumption it might not.

---

## Stop blocks at most once per turn — by design

`stop_hook_active` short-circuits **above** `canBlock`. That is not an oversight to be tightened
later; **it is the only reason the plugin cannot trap its owner.** The runtime hard-caps consecutive
Stop blocks at 9 and then ends the turn with an **empty result**, which is a worse outcome than the
violation.

The leak this leaves is measured and stated plainly in the code:

```
stop#1 BLOCK → stop#2 SPEAK → stop#3 BLOCK → stop#4 ALLOW
```

— turn ends with the write unverified and phases remaining.

**So the Stop half delays a violating turn by one exchange. It does not prevent it.**

**That is exactly why the debt gates exist.** The turn is allowed to end, the obligation is written
down, and the *next* turn's first action answers for it. A Stop gate strong enough to actually
prevent the violation would be a Stop gate strong enough to hang the session.

---

## The honest limits — never soften these

**1. A hook cannot make an idle session resume.** This is the big one, and it sits directly under
canon (b), "never stop between phases". A hook can refuse a tool call and can refuse to end a turn.
It **cannot** wake a session that is already sitting idle — measured: a coordinator was absent for
3h06m while no hook misfired, because an idle session ends no turn. So (b) ships as **"never end a
turn silently mid-run"**, which is enforceable, and **not** as "never stop", which is not. Do not
blur those two.

**2. CANON-READ-BACK proves a read happened, not that you compared anything.** It proves a mapped
read ran and returned a record carrying that id. Whether you actually looked at the field you wrote
is between you and the work.

**3. Gates judge STRUCTURE, never QUALITY.** Asserted verbatim by the selftest: *"They cannot tell
whether a brief is good."* "A brief exists and was read back" is checkable. "The brief is good" is
not, and nothing here pretends otherwise.

**4. Hooks fail open, and silently.** Crash or timeout means the call proceeds with the model told
nothing. That is deliberate — a gate that crashes must never be the reason your turn fails — and it
is why the canon card, `doctor` and `--include-hook-events` exist rather than being extras.

**5. The cold return is deliberate, and it is the point.** Debt is keyed by **project, not session**.
A debt left on Friday refuses the first work on Monday, in a new terminal, with an empty ledger. A
debt that evaporates because you opened a new session is the same leak wearing a different hat.

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
  is armed; `CANON-ACCOUNT` is inert; **`CANON-TREE-FIRST` is armed here too** — it arms for any
  state that is not CLOSED, because source edits before a breakdown are exactly as premature during
  alignment as during the run.
- **RUN** — canon (b) governs. `CANON-ACCOUNT` and `CANON-JOURNAL-PHASE` arm, `CANON-TREE-FIRST`
  stays armed, and **`CANON-BOARD-FIRST` goes inert.**
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

| Command | Carries | Missing arguments |
|---|---|---|
| `/portal-project <client> <project> [scope]` | Full initiation: alignment board, brief, proposal, phases, milestones, task tree, flow board, journal folder, knowledge graph. Opens the run in ALIGN. | **Hard stop.** Runs no tool, opens no run, creates nothing |
| `/portal-continue [run or project]` | Promotes to RUN and resumes autonomously — no confirmation between phases. | **Deliberately does not stop.** Empty is the normal case; it resolves from the project directory |
| `/channel-coordinate <channel> <identity> [agents…]` | Join as coordinator, claim the title, publish the nine-section channel policy. | **Hard stop.** Registers nothing, claims nothing, posts nothing |
| `/channel-join <channel> <identity>` | Join as participant: policy and messages first, then the mission. | **Hard stop** |
| `/portal-stand-down [gate] [reason]` | The escape. | **Inverts the rule.** No gate stands down all; an unrecognised gate prints the list and stands down all |

Command bodies are a **trusted channel** — imperatives there are followed normally. That is exactly
why the clearing actions live in the commands and on the canon card rather than in refusal reasons.

### The merge trap

**`/portal-stand-down` exists only on `feat/canon-commands`.** On the hooks lane and on master,
`commands/` holds `portal.md` and `rearm-watch.md` and nothing else.

The string `/portal-stand-down` appears at **four runtime sites**: the SessionStart canon card, and
the Stop block reasons of `CANON-READ-BACK-STOP`, `CANON-ACCOUNT` and `CANON-CLOSEOUT`. It is
**never** in a PreToolUse deny reason — that is the facts-only rule holding.

So the failure mode is not "a refusal names a command that does not exist". It is **"the canon card
and three Stop block reasons publish an escape that does not exist."**

It is **degraded, not total**: all four sites offer the `node … canon-gate.js stand-down` Bash form
**first**, and that form works standing alone. Shipping hooks without commands therefore ships a
working escape beside a dangling one — and given that the credibility of the escape text is the
scarce resource this whole design is spending, a published escape that silently does nothing is
precisely the failure it exists to prevent.

**Merge order: `feat/canon-commands` before or together with `feat/canon-hooks-enforce`.** Commands
is safe alone: it adds five files and touches nothing else. Docs last.

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

Ledger location: `PORTAL_CANON_HOME`, else the plugin data dir, else
`~/.claude/plugins/data/management-portal-canon`. Session files are deleted at session end and swept
after 48h regardless.

> **Two installs, two ledgers.** `CLAUDE_PLUGIN_DATA` differs between a marketplace install and a
> `--plugin-dir` run, so the two keep **separate ledgers and cannot see each other's runs**. Set
> `PORTAL_CANON_HOME` to force one.
