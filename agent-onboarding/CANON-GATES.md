# CANON-GATES.md — what a hook can actually force, measured

> What the Claude Code hook system will and will not let us enforce, so the next investigation does
> not re-measure it. Companion to `WATCH-LAYERS.md` (which covers Team Chat presence) and
> `DISCIPLINE.md` (the canon itself). **The facts below were measured, and the conditions are stated
> so you can re-run them** — do not treat any of them as settled on a version or platform where they
> were not run.
>
> Where a fact was measured by the hook-probe investigation rather than re-verified while writing
> this file, it says so. **Two facts were re-verified from source in this repo and are marked
> `VERIFIED HERE`.** The difference matters: one is a citation, the other is evidence.

## Read this first: the honest one-paragraph answer

**Before-any-action enforcement is real on this build.** A `PreToolUse` hook returning
`permissionDecision: "deny"` refuses the call outright — it works on MCP tools, works inside
subagents, and overrides a global `bypassPermissions` setting. So the canon can ship as gates rather
than as reminders. **Three limits bound what may honestly be claimed**, and every doc that describes
this system must carry all three:

1. A hook can refuse a tool call and can refuse to end a turn. It **cannot make an idle session
   resume.** "Never stop between phases" is therefore enforceable only as "never end a **turn**
   silently mid-run". Those are different sentences and must never be blurred.
2. **Instructions inside a `PreToolUse` deny reason are read as prompt injection and deliberately
   not followed** (measured twice). Refusal reasons must state facts only. Every clearing action and
   every escape has to travel through a channel the model trusts: `SessionStart` /
   `UserPromptSubmit` additional context, and `PostToolUse` / `Stop` block reasons.
3. **Hooks fail open and silently** on crash and on timeout. A dead gate is indistinguishable from a
   live one from inside the conversation, which is why a liveness token and a doctor mode are part
   of the design rather than extras.

## The runtime facts

| # | Fact | Evidence |
|---|---|---|
| G1 | `PreToolUse` `hookSpecificOutput{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason}` **refuses the call**; the reason reaches the model verbatim. | Hook probe, 2.1.231 |
| G2 | `PostToolUse` `{decision:"block", reason}` is obeyed and compels an action before continuing. | Hook probe |
| G3 | `Stop` `{decision:"block", reason}` is obeyed. The runtime **hard-caps consecutive Stop blocks at 9**, then ends the turn with an **empty result**. Stay far below it. | Hook probe; `watch-alarm.js` has shipped a Stop block since 1.4.x |
| G4 | `SessionStart` and `UserPromptSubmit` `additionalContext` reach the model. **Pre/PostToolUse `additionalContext` is NOT proven** on 2.1.231. | Hook probe — **no gate may depend on the unproven channel** |
| G5 | `matcher` is a **full** match on the tool name. | See "The inert matcher", below — **VERIFIED HERE** |
| G6 | Hook stdin carries `session_id`, `transcript_path`, `cwd`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`; `PostToolUse` adds `tool_response` and `duration_ms`; `Stop` adds `stop_hook_active`. | 473-byte payload dump |
| G7 | Hook `timeout` is in **seconds**, kills the process, and the call proceeds **with the model told nothing**. | Hook probe |
| G8 | `settings.json` `"env"` propagates into hook processes — so an env escape works, but it is **fixed for the session**. A mid-session escape must therefore be a **file**, re-read every invocation. | Hook probe |
| G9 | Plain **stdout** from a hook is **discarded** for `PreToolUse`, `PostToolUse` and `Stop` alike. | Measured on 2.1.222 (Windows); recorded at the top of `scripts/canon-gate.js` (it was recorded in `portal-gate.js`, which 1.5.0 deletes) |

## The gate that never was — VERIFIED HERE, and now replaced

`agent-onboarding/plugin/scripts/portal-gate.js` **was 61 lines and contained no
`permissionDecision` anywhere in it.** It built a fixed `additionalContext` string and exited 0. It
was never able to refuse anything.

This is the premise of the whole canon-gates effort, and it is worth stating from the code rather
than from the spec: **the read-after-write "gate" was advisory from the day it shipped**, and it was
described in the plugin README as a gate. Combined with G4 — Pre/PostToolUse `additionalContext`
being unproven on 2.1.231 — those two reminders may have been reaching nobody at all for their
entire service life.

**As of 1.5.0 that file is deleted.** `scripts/canon-gate.js` replaces it: 2062 lines, a real
`PreToolUse` `permissionDecision: "deny"`, wired into 8 of the 11 entries in `hooks/hooks.json`.
**State the replacement precisely.** What is now true is that the engine **ships**. What is *not* yet
true is that anyone has watched it refuse a live call on this merged build — its gates are
**fixture-verified** (`scripts/canon-selftest.js` spawns the real binary under an isolated
`PORTAL_CANON_HOME`; the suite **currently reports 321 assertions**, an emergent count partly driven
off `REGISTER`, so **never quote 321 as a constant**) and several were live-verified on the engine
lane before the merge, over bytes identical to these. The one place that verdict lives is the status
board in `plugin/skills/management-portal/canon-gates.md`, where it reads **ARMED, not ENFORCED**.

> The lesson generalises past this file: **"produced no visible effect" and "did not execute" look
> identical from inside a conversation.** Every gate this project ships must therefore be provable
> from outside it — a liveness token in the session, a `doctor` mode on the command line, and
> `--include-hook-events` when neither is enough.

## The inert matcher — VERIFIED HERE, and now fixed

The 1.4.3 hook matcher was:

```
mcp__(plugin_management-portal_)?management-portal__…
```

Because `matcher` is a **full** match (G5), that pattern fired **only** for the bare and
plugin-scoped spellings. It was **inert** for at least two spellings that exist in the wild:

- the claude.ai connector install — `mcp__claude_ai_management-portal__*`
- a **UUID-named** install — `mcp__<uuid>__*`

This is not hypothetical. The session that wrote this file had the portal tools registered as
`mcp__560b8d0b-857c-40eb-bb2f-8eeb37d8c9db__create_task` — a UUID spelling that matcher would never
have matched. **On that install every read-after-write hook was silently dead.**

**1.5.0 takes the fix.** The `PreToolUse` and `PostToolUse` entries now match **`.*`** and scope at
**runtime** against a frozen set of **257** portal tool names — a raw name is portal iff it matches
`^mcp__.+?__(.+)$` and the tail is in the set, so an unknown MCP server is **ignored rather than
gated**, keeping Supabase, Desktop Commander, chrome-devtools and playwright out of the blast radius.
Non-portal tools are judged purely by **argument shape** — does a key carry a shell command line,
does a key name a file about to be written — and **nothing asks whether the tool is called `Bash`**,
which is what closes the hole where `PowerShell` and `bulk` walked past a name-shaped matcher.
**Never enumerate install spellings in a regex again**, which is how this broke in the first place.

The cost of matching everything is paid structurally rather than by narrowing again: the gate bails
before touching disk for any call that is neither portal nor a write/command. A/B interleaved on
identical fixtures at 60,000 ledger lines, on the engine lane at the same bytes that merged here:
ungated **88–93 ms** before / **86–91 ms** after, gated **182–191 ms** before / **175–187 ms** after,
with Node process startup (~68–95 ms, machine-dependent) the dominant term. Two earlier figures
(119–130 ms and ~100 ms) name no method and are **superseded — do not quote them.**

## THE RELEASE DEFECT: two version fields that must move together

**This one has already cost the owner hours**, and it will bite the very next publish if it is not
checked.

```
.claude-plugin/marketplace.json                    → plugins[0].version   ← the CATALOG
agent-onboarding/plugin/.claude-plugin/plugin.json → version              ← the PLUGIN
```

They are **separate files with separate version fields**, and the marketplace catalog cache is
separate from the plugin install. Bump one without the other and the catalog advertises a version
that does not match what installs — which is the most likely explanation for the owner reinstalling
repeatedly and receiving **1.3.2** for hours while believing he had the newest build.

**The failure is silent and it points the wrong way:** the docs describe the new behaviour, the user
installs the old plugin, and every symptom looks like "the gates don't work" rather than "the wrong
version installed".

**Check before you publish, from the repo root:**

```bash
node -e "const a=require('./.claude-plugin/marketplace.json').plugins[0].version, b=require('./agent-onboarding/plugin/.claude-plugin/plugin.json').version; console.log(a===b?('OK  both '+a):('MISMATCH  catalog='+a+'  plugin='+b)); process.exit(a===b?0:1)"
```

Then, on each machine: `/plugin update management-portal@portal`, reload, and **confirm with
`/plugin` that the installed version actually reads the new number** before believing any change
shipped. A marketplace refresh and a plugin install are two different operations.

## Which channel each change reaches users through

Three separate shipping channels, with very different reach. Confusing them wastes a release.

| Channel | What lives there | How it reaches a user |
|---|---|---|
| **Backend** | `SERVER_INSTRUCTIONS` in `backend/routers/mcp_server.py` | **Deployed.** Reaches every MCP client — claude.ai connector, Cursor, Roo, the plugin — on their next connect. No reinstall, no version bump. But it only ships when `master` deploys. |
| **Plugin** | everything under `agent-onboarding/plugin/**` | Needs a version bump in **both** files above, a marketplace catalog refresh, and a per-machine reinstall + reload. |
| **Website** | `frontend/src/pages/DocsMcp.tsx` | Deploys with the frontend. Informational only — changes no client behaviour. |

**The canon text now lives in three places, so it can drift.** The rule: the backend carries the
canon **only, never gate ids** — a client without the plugin has no gates and must not be told it
has. The gate register and the not-checkable list live in the plugin skill and the docs page, and
must stay word-consistent between them.

## Known failure modes — name them, do not hide them

- **A stale run gates future work.** A session that dies mid-run leaves the manifest at `RUN`; later
  sessions in that project spend one block per turn until the 24h no-progress TTL, a stand-down, or
  an explicit close. Mitigated five ways; not removed.
- **`bypassPermissions` makes a deny the only brake.** In an autonomous run there is no permission
  UI to override a gate — which is exactly why the primary escape is a **file** re-read on every
  invocation, not a flag fixed at session start.
- **A restart, or a sub-agent, lost the decomposition — fixed in 1.6.3.** `CANON-TREE-FIRST` counted the
  four decomposition calls in the SESSION's tool stream, but a run outlives a session. Restart Claude
  Code mid-run and a task tree built an hour earlier became invisible: every source write was refused,
  with the reason insisting the run had "no recorded `create_task`" while the tasks sat in the portal.
  It was worse for sub-agents, which is how it surfaced — three lanes blocked at once. A fresh
  sub-agent's stream contains no portal writes at all, and **must not**, because the canon explicitly
  says to keep portal writes in the parent session. The canon asked for something it then refused to
  accept. The decomposition is now recorded on the RUN, so it survives a restart and is visible to a
  sub-agent; a run that genuinely has no tree is still refused.
- **A quoted `>` was parsed as a redirection — fixed in 1.6.2.** The shell scan ran over raw segment
  text, so a comparison inside a quoted argument (`node -e '... a > b ...'`) was reported as a file
  write. It refused a read-only diagnostic, and because the same scan answers "does this command change
  state", it also mis-classified read-only commands as mutating. Quoted spans are masked before the
  operator is located; a quoted redirect TARGET is still resolved.
- **Two rules were canon-by-prose until 1.7.0, and the owner caught both.** The flow board was
  write-once: `CANON-TREE-FIRST` required a cluster and a connection to EXIST before the first
  source edit and never looked again, so dependency order recorded on the board was never read
  while the plan was executed. And `CANON-STATUS` only fired when TASKS were done and the
  milestone was stale — never the reverse, which is the direction that actually happens:
  measured at eleven milestones delivered against two completed tasks in one day.
  `CANON-FLOW-READ` and `CANON-STATUS-SYNC` close both. Neither can verify the CONTENT — a gate
  cannot know whether a task is really finished, and milestones and tasks share no key — so both
  enforce the honest thing instead: that the record was read before the claim was made.
- **A restart did not restore the budget either — fixed in 1.6.4.** The run outlives the session, so the
  silenced gate survived every restart for the rest of the day. A new session now refunds it; a session that
  then genuinely wedges still exhausts its own three and cannot be trapped.
- **A gate that budgets its own blocks can go silent for good — fixed in 1.6.1.** Every gate degrades to
  a notice after 3 blocks in a run, so it can never trap a session that genuinely cannot proceed. The
  counter was per-run and monotonic, so a run lasting a working day lost `CANON-ACCOUNT` by mid-morning
  and never got it back — the one gate whose job is refusing a silent stop mid-run. It was compounded by
  a second defect: phase boundaries were only recorded for `update_milestone_status`, never for
  `update_proposal_milestone`, which is the tool the canon's own status guidance names. Three milestones
  delivered, `phase boundaries recorded 0`. The budget is now refunded on evidence of progress, so a
  moving run keeps its net and a stuck one still cannot be trapped.
- **Two install channels keep two ledgers.** `CLAUDE_PLUGIN_DATA` differs between a marketplace
  install and a `--plugin-dir` run, so a run opened under one is invisible to the other. Set
  `PORTAL_CANON_HOME` to force a single home.
  **The hook-vs-CLI half of this was measured and fixed in 1.6.0.** `CLAUDE_PLUGIN_DATA` is set for a
  hook process and unset for a Bash one, and the commands tell the agent to run `canon-gate.js` from
  Bash — so `run-promote` wrote a run the gates could never see, and the card reported `no run
  declared` indefinitely. The CLI branch now discovers the live home by evidence (most recently
  written `sessions/`) instead of assuming a folder name; `doctor` reports which rule was used.
- **On OAuth installs the Stop-time portal read frequently 401s** — `watch-alarm` returned
  `http_401` seven turns running on this machine. The turn-end reports then fall back to local
  ledger evidence and must label themselves **"local evidence, not a verdict"**.
- **Unrelated, found while working here, and worth acting on:** `~/.claude/settings.json` contains a
  live-looking GitHub personal access token in plaintext under `"env"`, and **any hook or subagent
  that reads that file inherits it**. It should be rotated and moved to a credential store. No hook
  in this plugin may read `settings.json` for anything beyond an armed-check, and none may log its
  contents.

## What is NOT measured — the gates themselves

**Everything above is about the hook system. None of it is evidence that a canon gate works.** G1–G9
say a `PreToolUse` deny *can* refuse a call; they do not say that `CANON-ID` refuses one on this
build. That distinction is the whole reason this file exists, so it is stated here too:

- **The engine shipping is not the same fact as the engine being verified here, and they must never
  be collapsed.** `canon-gate.js` now ships and is wired in — that half is settled, and the old line
  "the engine lane has not pushed it" is dead. The other half is not: **no live refusal has been
  observed against this merged build.** The gates are **fixture-verified**, and several were
  live-verified on the engine lane over bytes identical to these, but *fixture-verified* and
  *live-verified on this tree* are different claims. The one place that verdict lives is the status
  board in `plugin/skills/management-portal/canon-gates.md`, where it reads **ARMED**. Until it reads
  **ENFORCED**, no doc may say a canon gate has been seen protecting anyone on this build.
- **One gate is fixture-proven only, permanently so far:** `CANON-ID`'s provenance split has never
  been live-verified, **because the live model declined to fabricate an id at all.** A live
  `CANON-ID` test that passes may be passing because the model refused to invent an id rather than
  because the hook refused the call. Those two are indistinguishable from outside; the fixture is the
  only evidence that separates them. Do not report a green live run as proof of this gate.
- **Still unmeasured, and each one changes a design decision if it comes back wrong:** whether a
  refusal reason written with **no** imperatives still trips the injection heuristic (limit 2 at the
  top of this file — *not* G9, which is about stdout being discarded); the real derivation of
  `run.all_phases_terminal`, only ever reached in fixtures by patching the run manifest; whether
  subagent tool calls carry the parent `session_id` or their own; and whether `watch-alarm`'s Stop
  ordering guarantee holds under the runtime. **Pre/PostToolUse `additionalContext` remains
  unproven** (G4) and no gate depends on it.
- ⚠ **`~150 ms` is a threshold, not a benchmark.** It was written as the point at which a design
  trade would be *considered* — narrow the matcher, downgrade `CANON-ID` to a turn-end advisory. The
  trade was **not** taken: the matcher was broadened to `.*` and the cost paid structurally instead
  (figures under "The inert matcher"). **Any doc presenting ~150 ms as a measurement is wrong.**
- **`Notification`, `PreCompact`, `PostCompact` and `PermissionRequest` never fired in the probe.**
  Their payloads are unknown and nothing is built on them.

## Deliberately not built

Recorded so the next investigation does not mistake these for oversights: blocking on
`SubagentStop` (a trapped subagent reports nothing useful to the owner, and the parent cannot see
why); any gate depending on Pre/PostToolUse `additionalContext` (G4 — unproven); a second Team Chat
poller (compose with `watch-alarm.js`, never duplicate it); ping-pong enforcement (`watch-alarm`
owns it); and any rewrite of `watch-alarm.js` internals — it is proven code, and its credential and
HTTPS handling is deliberately **duplicated** rather than refactored out of a shipping Stop gate.
