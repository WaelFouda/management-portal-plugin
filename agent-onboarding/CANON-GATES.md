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
>
> Gate-by-gate status is **not** here. It lives in
> `plugin/skills/management-portal/canon-gates.md`, which is the single source of truth for it.

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
   not followed** (measured twice; a third probe told the model to write an unlock file and it
   declined, correctly). Refusal reasons must state facts only. This is enforced mechanically rather
   than by taste: `evaluateCall()` contains zero occurrences of `standDownLine`,
   `/portal-stand-down`, or `TO STAND IT DOWN`. Every clearing action and every escape travels
   through a channel the model trusts: `SessionStart` / `UserPromptSubmit` additional context, and
   `PostToolUse` / `Stop` block reasons. One wording rule falls out of the same logic: deny reasons
   say **"a turn in this project"**, never "this session" — debt is keyed by project and outlives a
   session, and a refusal the reader can disprove has spent its credit.
3. **Hooks fail open and silently** on crash and on timeout. A dead gate is indistinguishable from a
   live one from inside the conversation, which is why a liveness token and a doctor mode are part
   of the design rather than extras. The token rides the `SessionStart` canon card, capped at
   `CARD_CAP = 3000` characters and assembled **head / gates / tail** rather than truncated — a blind
   `slice()` cuts the tail, and the tail is the escape.

## The runtime facts

| # | Fact | Evidence |
|---|---|---|
| G1 | `PreToolUse` `hookSpecificOutput{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason}` **refuses the call**; the reason reaches the model verbatim. | Hook probe, 2.1.231 |
| G2 | `PostToolUse` `{decision:"block", reason}` is obeyed and compels an action before continuing. | Hook probe |
| G3 | `Stop` `{decision:"block", reason}` is obeyed. The runtime **hard-caps consecutive Stop blocks at 9**, then ends the turn with an **empty result**. Stay far below it. | Hook probe; `watch-alarm.js` has shipped a Stop block since 1.4.x |
| G4 | `SessionStart` and `UserPromptSubmit` `additionalContext` reach the model, and **two `SessionStart` hooks both deliver**. **Pre/PostToolUse `additionalContext` is NOT proven** on 2.1.231. | Hook probe — **no gate may depend on the unproven channel** |
| G5 | `matcher` is a **full** match on the tool name. | See "The inert matcher", below — **VERIFIED HERE** |
| G6 | Hook stdin carries `session_id`, `transcript_path`, `cwd`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`; `PostToolUse` adds `tool_response` and `duration_ms`; `Stop` adds `stop_hook_active`. | 473-byte payload dump |
| G7 | Hook `timeout` is in **seconds**, kills the process, and the call proceeds **with the model told nothing**. | Hook probe |
| G8 | `settings.json` `"env"` propagates into hook processes — so an env escape works, but it is **fixed for the session**. A mid-session escape must therefore be a **file**, re-read every invocation. | Hook probe |
| G9 | Plain **stdout** from a hook is **discarded** for `PreToolUse`, `PostToolUse` and `Stop` alike. | Measured on 2.1.222 (Windows); recorded at the top of `scripts/portal-gate.js` |
| G10 | A `Stop` hook can block **at most once per turn**, because `stop_hook_active` short-circuits above the block decision. See "The Stop half only buys one exchange". | Measured across 5 turns on 2.1.231 |

## The eight hook events the gates hang on

Not five. This is the registration on `feat/canon-hooks-enforce`; **1.4.3 registers four event types
and only `portal-gate.js` and `watch-alarm.js`.**

| Event | Matcher | Emits |
|---|---|---|
| **SessionStart** (registered twice) | — | `additionalContext` = the **canon card**; plus `watch-alarm.js preflight`. Both deliver (G4) |
| **UserPromptSubmit** | — | `additionalContext` — debt notice, run line, stood-down list. Capped at 1400 chars |
| **PreToolUse** | **`.*`** | `{permissionDecision:"deny", permissionDecisionReason}`, or nothing |
| **PostToolUse** | **`.*`** | `{decision:"block", reason}`, or nothing |
| **PostToolUse** | `mcp__.*__(await_my_turn\|start_watching_channel)` | watch-alarm's own record |
| **SubagentStart / SubagentStop** | — | nothing; `note` ledger rows only |
| **Stop** (registered twice — **order matters**) | — | watch-alarm `check` **then** canon-gate `stop` |
| **SessionEnd** | — | deletes this session's ledger files, then sweeps |

**The Stop ordering.** canon-gate **yields silently if watch-alarm blocked within the last 90
seconds**, because two gates blocking the same turn spends the runtime's 9-block budget by accident.
**Whether the runtime actually guarantees that two `Stop` hooks run in registration order has NOT
been verified.** The yield is written defensively on the assumption it might not — it is a mitigation
for an ordering we believe in but have not measured.

Note what the `.*` matchers buy: after G5, an install-spelling regex is a bug waiting to happen. The
gate matches everything and scopes at runtime instead.

## The Stop half only buys one exchange

`stop_hook_active` short-circuits **above** the block decision, so a `Stop` hook blocks at most once
per turn. **That is deliberate safety, not a gap to be tightened**: it is the only reason the plugin
cannot trap its owner, and the alternative — hitting the runtime's 9-block cap — ends the turn with
an empty result, which is worse than the violation.

The leak this leaves is measured, and stated plainly in the code:

```
stop#1 BLOCK → stop#2 SPEAK → stop#3 BLOCK → stop#4 ALLOW
```

— turn ends with the write unverified and phases remaining.

**The Stop half delays a violating turn by one exchange; it does not prevent it. That is WHY the debt
gates exist** — the turn is allowed to end, the obligation is written to disk keyed by **project**,
and the *next* turn's first action answers for it, even in a new session on a different day.

## The gate that never was — VERIFIED HERE

`agent-onboarding/plugin/scripts/portal-gate.js` is **61 lines and contains no
`permissionDecision` anywhere in it.** It builds a fixed `additionalContext` string and exits 0. It
has never been able to refuse anything.

This is the premise of the whole canon-gates effort, and it is worth stating from the code rather
than from the spec: **the read-after-write "gate" has been advisory since the day it shipped**, and
it was described in the plugin README as a gate. Combined with G4 — Pre/PostToolUse
`additionalContext` being unproven on 2.1.231 — those two reminders may have been reaching nobody at
all for their entire service life.

> The lesson generalises past this file: **"produced no visible effect" and "did not execute" look
> identical from inside a conversation.** Every gate this project ships must therefore be provable
> from outside it — a liveness token in the session, a `doctor` mode on the command line, and
> `--include-hook-events` or `--debug-file` when neither is enough.

## The inert matcher — VERIFIED HERE

The shipped hook matcher is:

```
mcp__(plugin_management-portal_)?management-portal__…
```

Because `matcher` is a **full** match (G5), that pattern fires **only** for the bare and
plugin-scoped spellings. It is **inert** for at least two spellings that exist in the wild:

- the claude.ai connector install — `mcp__claude_ai_management-portal__*`
- a **UUID-named** install — `mcp__<uuid>__*`

This is not hypothetical. The session that wrote this file had the portal tools registered as
`mcp__560b8d0b-857c-40eb-bb2f-8eeb37d8c9db__create_task` — a UUID spelling the shipped matcher would
never have matched. **On that install every read-after-write hook was silently dead.**

The fix is to match broadly (`mcp__.*`) and scope at **runtime**, never to enumerate install
spellings in a regex, which is how this broke in the first place. Concretely:

- **`PORTAL_TOOLS` is a frozen set of 257 names.** A call is a portal call if and only if its raw
  name matches `^mcp__.+?__(.+)$` **and** the tail is in that set. **A tool outside the set is never
  subject to a portal invariant** — Supabase, Desktop_Commander, chrome-devtools and playwright stay
  out of the blast radius on every install spelling.
- **`WRITE_READ_MAP` carries 98 write→read rows**, not the ~60 older drafts implied.
- **Non-portal tools are judged purely by ARGUMENT SHAPE**: does a key carry a shell command line,
  does a key name a file about to be written. **Nothing asks whether the tool is called `Bash`** —
  which is exactly why `PowerShell` and `bulk` used to walk past every name-shaped matcher.

**`257` is currently hardcoded in two selftest assertions.** That is the remaining copied-number
drift risk in this codebase: change the set, and two unrelated assertions fail with a number rather
than a name.

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

**Both files currently read `1.4.3`, matching master and both code lanes.** They stay there until the
gate engine actually merges: a docs branch cannot ship a version number for code it does not contain.
**Whoever merges `feat/canon-hooks-enforce` bumps both fields in the same commit** — that is the
merge's job, not this branch's.

**Check before you publish, from the repo root:**

```bash
node -e "const a=require('./.claude-plugin/marketplace.json').plugins[0].version, b=require('./agent-onboarding/plugin/.claude-plugin/plugin.json').version; console.log(a===b?('OK  both '+a):('MISMATCH  catalog='+a+'  plugin='+b)); process.exit(a===b?0:1)"
```

Then, on each machine: `/plugin update management-portal@portal`, reload, and **confirm with
`/plugin` that the installed version actually reads the new number** before believing any change
shipped. A marketplace refresh and a plugin install are two different operations.

## THE MERGE TRAP: an escape that is published but absent

**`/portal-stand-down` exists only on `feat/canon-commands`.** On `feat/canon-hooks-enforce` and on
master, `commands/` holds `portal.md` and `rearm-watch.md` and nothing else.

The string appears at **four runtime sites**: the `SessionStart` canon card, and the `Stop` block
reasons of `CANON-READ-BACK-STOP`, `CANON-ACCOUNT` and `CANON-CLOSEOUT`. It is **never** in a
`PreToolUse` deny reason — that is limit 2 holding, exactly as designed.

**Two precisions, because the loose version of this warning is wrong:**

1. The failure is **not** "a refusal names a missing command". It is **"the canon card and three Stop
   block reasons publish an escape that does not exist."**
2. It is **degraded, not total.** All four sites offer the `node … canon-gate.js stand-down` Bash
   form **first**, and that form works standing alone. So hooks-alone ships a working escape beside a
   dangling one — and given limit 2, where the credibility of the escape text is the scarce resource,
   a published escape that silently does nothing is precisely the failure this design guards against.

**Merge order: `feat/canon-commands` before or together with `feat/canon-hooks-enforce`.** Commands
is safe alone — it adds five files and touches nothing else. **`feat/canon-docs` last.**

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

**`agent-onboarding/shared/` and `agent-onboarding/bundles/` are hand-maintained copies, and no
generator exists.** Nothing regenerates them. When a canon surface changes, the copies move by hand
**in the same commit** or they are already stale.

## Performance — measured, with the method

The gate runs on **every** tool call, because after G5 a name-shaped matcher is a bug. Mitigation is
structural rather than clever: `modePre` calls `quiet()` **before touching disk** for anything that
is neither a portal tool nor a write/command.

**Use the HEAD figures only** (`8666e28`). A/B interleaved on identical fixtures, at a 60,000-line
ledger:

| Path | Before the gate | After the gate |
|---|---|---|
| **ungated** tool call | 88–93 ms | 86–91 ms |
| **gated** tool call | 182–191 ms | 175–187 ms |

**Two earlier figures — 119–130 ms and ~100 ms — are superseded, name no method, and must not be
quoted.**

The absolutes are machine-dependent: **the dominant term is Node process startup, roughly 68–95 ms**,
and an independent reproduction confirmed the *shape* rather than the numbers. Four claims are
portable:

1. **The ungated path does not scale with ledger size** — flat from 0 to 60,000 lines.
2. **The gate's own work is 0.12 ms on an empty ledger and single-digit ms at realistic density**,
   bounded because `MAX_FOLD_LINES = 5000` caps the fold regardless of file size.
3. **The debt gates cost nothing measurable** — they read an already-loaded fold.
4. **There is no network on the hot path.** `canon-net.js` is `Stop`-only, does one read per run per
   120 s with a 6 s timeout, and degrades to local evidence on failure.

**These numbers did not come from the selftest.** `canon-selftest.js` contains **zero timing
instrumentation** — it is a correctness harness and measures no latency at all. Any doc claiming the
suite reports performance is wrong.

## What is and is not proven about the gates themselves

**Everything above is about the hook system. None of it is evidence that a canon gate works.** G1–G10
say a `PreToolUse` deny *can* refuse a call; they do not say that `CANON-ID` refuses one. That
distinction is the whole reason this file exists, so three words are used precisely wherever gate
status is discussed:

| Term | Means |
|---|---|
| **live-verified** | Installed over the real plugin cache and driven with `claude -p` on 2.1.231 with `--debug-file`. Observed. |
| **fixture-verified** | `canon-selftest.js` spawns the real `canon-gate.js` with fixture payloads on stdin under an isolated `PORTAL_CANON_HOME`. No live session, no MCP server. Proves the code path; does not prove the model meets it. |
| **unverified** | Designed and reasoned, never observed. |

The per-gate verdicts live in `plugin/skills/management-portal/canon-gates.md` and nowhere else.
Summarised: every register row is **fixture-verified**; the mechanisms they rest on — deny genuinely
refusing, the cold return end to end, debt-budget degradation, Stop blocking at most once per turn,
deny-reason-as-injection — are **live-verified**; and no released build contains any of it.

**The one distinction that must never be flattened.** `CANON-ID`'s id-laundering defence is
**fixture-proven only**, because in the live run **the model declined to fabricate an id at all**. So
**a live `CANON-ID` test that passes may be passing because the model refused to invent an id, not
because the hook refused the call.** Those two outcomes are indistinguishable from outside the
process. The fixture is the only evidence that separates them, and anyone who deletes that sentence
has deleted the only reason to believe the hook does anything here.

**The selftest count.** The suite currently reports **321 assertions**, 0 failed. **`321` appears
nowhere in the source** — it is the runtime sum of `check()` calls, partly data-driven off the gate
register, so adding one register row silently changes it. Write "currently reports 321"; never treat
321 as a constant. There is no argv handling either: no `--only`, no filter, no way to run one case.

**Still unmeasured, and each one changes a design decision if it comes back wrong:**

- Whether a refusal reason written with **no imperatives at all** still trips the injection heuristic
  (limit 2 in the opening paragraph — an earlier draft of this line cited "G9", which is about plain
  stdout being discarded and has nothing to do with injection).
- Whether `Stop` hooks are guaranteed to run in registration order under the runtime.
- `run.all_phases_terminal`'s real derivation — only ever reached in fixtures by patching the run
  manifest.
- The run-scoped stand-down sentinel (`--gate all --run <id>`) and deleting the run pointer by hand:
  both implemented, neither covered by a dedicated assertion.
- Whether subagent tool calls carry the parent `session_id` or their own.
- **`Notification`, `PreCompact`, `PostCompact` and `PermissionRequest` never fired in the probe.**
  Their payloads are unknown and nothing is built on them.

**A threshold that is not a measurement.** An earlier revision of this file carried "~150 ms median
`PostToolUse` spawn cost on Windows" as the point at which the matcher would narrow and `CANON-ID`
would downgrade from a refusal to a turn-end advisory. **That number is a decision rule someone wrote
down before any A/B run existed. Nobody has ever measured a 150 ms median, and the trade has not been
taken.** It is recorded here only so that the next reader who meets it elsewhere knows what it is.
The real figures are in "Performance", above; quote those.

**One fixture claims more than it proves.** `caseDebtHotPath` (D8) is labelled "the largest debt this
gate can carry", but its fixture carries exactly one unverified write. The label is not backed by the
case. Do not repeat the claim.

## Known failure modes — name them, do not hide them

- **A stale run gates future work.** A session that dies mid-run leaves the manifest at `RUN`; later
  sessions in that project spend one block per turn until the 24h no-progress TTL, a stand-down, or
  an explicit close. Mitigated five ways; not removed.
- **`bypassPermissions` makes a deny the only brake.** In an autonomous run there is no permission
  UI to override a gate — which is exactly why the primary escape is a **file** re-read on every
  invocation, not a flag fixed at session start.
- **Two install channels keep two ledgers.** `CLAUDE_PLUGIN_DATA` differs between a marketplace
  install and a `--plugin-dir` run, so a run opened under one is invisible to the other. Set
  `PORTAL_CANON_HOME` to force a single home.
- **`CANON-READ-BACK-STOP` is not in the gate register.** It is a real gate that blocks and can be
  stood down by id, but because it is not a register row it never appears on the canon card and never
  appears in `doctor` output. Two of the three audit surfaces will tell you it does not exist.
- **On OAuth installs the Stop-time portal read frequently 401s** — `watch-alarm` returned
  `http_401` seven turns running on this machine. The turn-end reports then fall back to local
  ledger evidence and must label themselves **"local evidence, not a verdict"**.
- **Unrelated, found while working here, and worth acting on:** `~/.claude/settings.json` contains a
  live-looking GitHub personal access token in plaintext under `"env"`, and **any hook or subagent
  that reads that file inherits it**. It should be rotated and moved to a credential store. No hook
  in this plugin may read `settings.json` for anything beyond an armed-check, and none may log its
  contents.

## Deliberately not built

Recorded so the next investigation does not mistake these for oversights: blocking on
`SubagentStop` (a trapped subagent reports nothing useful to the owner, and the parent cannot see
why); any gate depending on Pre/PostToolUse `additionalContext` (G4 — unproven); a second Team Chat
poller (compose with `watch-alarm.js`, never duplicate it); ping-pong enforcement (`watch-alarm`
owns it); and any rewrite of `watch-alarm.js` internals — it is proven code, and its credential and
HTTPS handling is deliberately **duplicated** rather than refactored out of a shipping Stop gate.
