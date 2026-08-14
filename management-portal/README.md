# management-portal — Claude Code plugin (one-click install)

The **Claude Code plugin** version of the management-portal operator. Same content as the
file-copy bundle (`agent-onboarding/bundles/claude-code/`), packaged so a user installs it from the
Claude Code **Plugins marketplace** (or two slash commands). **You sign in with OAuth** — there is no API
key to create, paste or store. The plugin ships no `userConfig` prompt, and its `.mcp.json` carries no
`headers` at all: just `type` and `url`.

> ## The gate arms itself on install
>
> **The turn-end gate ships in this plugin and fires from it.** Installing is enough — there is nothing to
> add to `.claude/settings.json` by hand. `SessionStart`, `PostToolUse` and `Stop` all fire from the
> plugin's own `hooks/hooks.json`.
>
> An earlier version of this file said the opposite in a large warning box and told you to hand-add the
> `Stop` entry. That was **wrong**, and it is worth knowing why, because the mistake is easy to repeat: the
> test that produced it seeded its fixture at a path passed through `CLAUDE_PLUGIN_DATA`, but Claude Code
> **overrides that variable for plugin hooks** and points it at `~/.claude/plugins/data/<plugin>/`. The hook
> fired, read an empty state, correctly stayed silent, and never touched the seeded file — and the untouched
> file was read as proof it had not run. **Produced no visible effect is not the same as did not execute.**
>
> Adding the entry to `.claude/settings.json` as well is harmless but unnecessary. If you do, note that a
> plugin hook and a settings hook resolve their state directory differently, so they will not share one.

---

# The canon gates — NOT IN THIS RELEASE — READ THE ESCAPE FIRST

**Everything in this section describes code that 1.4.3 does not contain.** The gate script
`scripts/canon-gate.js` is on the unmerged branch `feat/canon-hooks-enforce`; four of the five canon
commands are on `feat/canon-commands`. What 1.4.3 actually ships under `scripts/` is `portal-gate.js` —
61 lines, no `permissionDecision` anywhere in it, advisory since the day it shipped while being described
as a gate — and `watch-alarm.js`, the Team Chat turn-end ABSENT gate, which does genuinely refuse to end
a turn. `commands/` holds `portal.md` and `rearm-watch.md` and nothing else. **On 1.4.3 no canon gate is
protecting anybody, and nobody should be told otherwise.**

It is documented here because it is what installs the moment those branches merge, and because the escape
below is the first thing anyone will need. So the escape comes first.

## STAND DOWN — if a gate is blocking work it cannot un-block

Once the gate script is installed, any one of these. **The first takes effect immediately, mid-session,
with no restart, and it works standing alone — reach for it first:**

```bash
# 1. Sentinel file. The gate script writes it; every hook re-reads it on every invocation.
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" stand-down --gate <GATE-ID|all> --reason "why"
```

```bash
# 2. Environment. Fixed for the session's life — that is why 1 exists.
PORTAL_CANON=off        # every gate silent
PORTAL_CANON=advisory   # nothing refuses or blocks; the turn-end report still prints
```

```
# 3. /portal-stand-down [gate id or 'all'] [reason]
#    SHIPS WITH feat/canon-commands. It is not in 1.4.3, and it is not on
#    feat/canon-hooks-enforce either — typing it in either place gets you an unknown command.
```

> **The merge trap, put where it can be acted on.** `/portal-stand-down` is named at **four runtime
> sites** in the gate build: the `SessionStart` canon card, and the `Stop` block reasons of
> `CANON-READ-BACK-STOP`, `CANON-ACCOUNT` and `CANON-CLOSEOUT`. It is **never** named in a `PreToolUse`
> deny reason — that is the facts-only rule below holding. So merging `feat/canon-hooks-enforce` alone
> does not ship a refusal that names a missing command; it ships **a canon card and three block reasons
> that publish an escape which does nothing.** All four sites offer the `node …` form first, so the
> failure is degraded rather than total — but the credit of the escape text is the scarce resource in
> this design, and an escape that silently does nothing is what spends it. **Merge
> `feat/canon-commands` first, or in the same commit.**

**Why the primary escape is a file and not a flag.** This plugin's author runs
`defaultMode: bypassPermissions`, where a `PreToolUse` deny is the *only* brake and there is no
permission prompt to click through. So the brake must be something a hook re-reads from disk on **every
single invocation** — otherwise a wrong gate would be unclearable until the session was restarted.

**The `stand-down` invocation is exempt from every gate**, and it is matched against **any shell string
in any tool's arguments** — not against a tool named `Bash`. That precision is a bug fix rather than
pedantry: the earlier test was `raw === 'Bash'`, so a session latched by `CANON-COORD-ROLE` could not
escape from `PowerShell`. A gate that can block its own escape is a trap; the exemption is hard-coded.

Sentinels live under `<CANON_HOME>/`: `STAND-DOWN` (everything), `STAND-DOWN-<GATE-ID>` (one gate), and
`STAND-DOWN-<run_id>` (one run — implemented, but **no test asserts the run-scoped form**, so treat it as
the least-proven of the three). **Delete the file to re-arm.** To end a run outright, use
`canon-gate.js run-close`: it closes the run, deletes the debt file **and stamps
`run.debt_settled_at`**. The stamp is not decoration — deleting the debt file alone did not work,
because the fold rebuilt the debt from the replayed ledger on the very next call. Deleting
`<CANON_HOME>/runs/by-project/<projhash>.json` by hand is also documented, but **no test asserts it**;
prefer `run-close`.

**They also stand themselves down.** Stop budgets of 3 blocks for `CANON-ACCOUNT`, 3 for
`CANON-READ-BACK-STOP` and 2 for `CANON-CLOSEOUT` — exceeding one writes `run.degraded[<gate>]` and that
gate is **permanently advisory for the rest of the run**. A debt budget of 3 refusals per **distinct**
debt, after which that debt stands down for good, and a 7-day TTL on top. 12 `PostToolUse` blocks per
session. A dead-man rule that disarms any gate blocking twice with no tool call in between. A 24-hour
no-progress TTL that closes an abandoned run. A stuck session un-sticks itself even if nobody finds this
page.

## What actually refuses, and what only advises

**The distinction is the whole point of the gate build, so it is stated in three places and they must
agree.** `skills/management-portal/canon-gates.md` is the **source of truth**; this README and the public
`/docs/mcp` page mirror it. If they disagree, that file wins and the drift is a bug.

| Verdict | Mechanism | Consequence |
|---|---|---|
| **REFUSE** | `PreToolUse` → `permissionDecision: "deny"` | The call **never runs**. Your data is untouched. |
| **BLOCK** | `PostToolUse` / `Stop` → `decision: "block"` | It **already happened**; you are compelled to act before continuing or ending the turn. |
| **ADVISE** | Text at turn end | Nothing is prevented. |

**The register holds 13 gates** — plus `CANON-READ-BACK-STOP`, a real, separately stand-downable gate
that is **not in the register at all**, and therefore never appears on the canon card or in `doctor`
output. That is a reporting gap, not a design choice: a gate you can stand down but cannot see listed is
one you will forget you armed.

**Two debt gates run FIRST**, ahead of every other refusal, and the order is deliberate — a debt refusal
must never hide behind another gate's reason. `CANON-DEBT-READ-BACK` refuses the *next turn's work* while
an earlier turn's write is still unread; `CANON-DEBT-CLOSEOUT` refuses it while a finished run's
close-out is unmade. Work means a portal write, a file write, or a mutating command. **Reads are never
work** — which is what makes it structurally impossible for a debt gate to refuse the read that settles
it.

**The debt is keyed by PROJECT, not by session.** A debt left on Friday refuses the first work on Monday,
in a new terminal, against an empty ledger. That cold return is the whole point: a debt that evaporates
because you opened a new window is the same leak wearing a different hat. Budgets: 3 refusals per
**distinct** debt, after which that debt stands down permanently; a 7-day TTL; and `run-close` settles it
outright.

**Refusals cover:** a fabricated id (`CANON-ID`), completing a parent before its subtasks
(`CANON-BOTTOM-UP`), a coordinator implementing instead of delegating (`CANON-COORD-ROLE`), a participant
acting before reading the channel policy (`CANON-POLICY-FIRST`), skipping the journal at a phase boundary
(`CANON-JOURNAL-PHASE`), destroying a knowledge graph (`CANON-KG-DESTRUCTIVE` — `delete_`, `regenerate_`
**and** `generate_` on a graph this session has seen), editing implementation files before the task tree
and flow board exist (`CANON-TREE-FIRST`, which is armed in ALIGN as well as RUN and exempts
`node_modules`, `.git`, build dirs, `*.md`, `*.log`, lockfiles and anything under `agent-onboarding` or
`management-portal-canon`), and writing the brief/proposal before the alignment board
(`CANON-BOARD-FIRST`, whose gated set includes `create_subtask` and `insert_diagram`, and which goes
**inert once the run is promoted to RUN**).

**`CANON-COORD-ROLE` is judged by EFFECT, never by tool name.** While you hold the coordinator title it
refuses **any file write or mutating command**, whatever the tool happens to be called. Portal tools carry
an empty `effect`, so **portal writes are not refused by it at all** — a coordinator may go on using the
portal; what it may not do is implement. Its single never-refuses entry is `transfer_coordinator_title`,
which is also how you clear it.

**Compulsions cover:** read-after-write (`CANON-READ-BACK` at `PostToolUse`, `CANON-READ-BACK-STOP` at
turn end), ending a mid-run turn without an account of yourself (`CANON-ACCOUNT`), and closing a run
without its summary board, graph closure and final journal (`CANON-CLOSEOUT` — which **auto-closes the
run** when nothing is missing).

**Advisories — and they are advisory *by design*, not by weakness:** `bulk` efficiency (`CANON-BULK` — a
deny on the fourth single write cannot undo the first three), status discipline (`CANON-STATUS`), and
completeness (`CANON-COMPLETE` — which names empty **fields** and never judges what is written in them).

### What a tool is, and is not, subject to

- **`PORTAL_TOOLS` is a frozen set of 257 names.** A tool counts as a portal tool only if its raw name
  matches `^mcp__.+?__(.+)$` *and* the tail is in that set. **A tool outside the set is never subject to a
  portal invariant** — which is exactly what keeps Supabase, Desktop_Commander, chrome-devtools and
  playwright out of the blast radius. (`257` is also hardcoded in two selftest assertions, so it is a
  copied number: add a tool and three places have to move together.)
- **Non-portal tools are judged purely by ARGUMENT SHAPE:** does some key carry a shell command line, does
  some key name a file about to be written. **Nothing anywhere asks whether the tool is called `Bash`.** A
  name-shaped matcher is precisely how a `PowerShell` call walked past the gate once already.
- **`WRITE_READ_MAP` holds 98 write→read rows.** The table in `reference.md` is the human copy and groups
  several write tools onto one row, so its row count and the constant's are different numbers describing
  the same map — do not quote either from memory.

### The column that stops a gate latching

Every row of the register carries a fourth column: **the tools that gate may never refuse.** It is held as
data, not as a comment, and the selftest drives each gate into its latched state and back out again
through exactly those calls. **A doc that omits this column recreates the bug**, which is why it is
written down here too.

It exists because of a count. **Four gates shipped as latches and had to be fixed:** `CANON-COORD-ROLE`,
where nothing anywhere wrote the second `mode` row that would have cleared it; `CANON-JOURNAL-PHASE`,
which refused `create_journal` — the exact call it was demanding; **bulk inner ids**, where ids returned
by `bulk`'s inner calls never entered the seen set, so `bulk([create_task])` followed by
`update_task(<that id>)` was refused for an id the portal had just issued; and **delete-obligation
polarity**, where seven `delete_*` rows could only be discharged by the id coming *back* — which is proof
the delete **failed**. **Two more were found and designed out before they shipped**, both at the debt
gates: every close-out artifact is itself a portal write, so a gate refusing portal writes until the
close-out exists would refuse the close-out; and `CANON-ACCOUNT` publishes `create_journal(tags:
["blocked"])` as *"you may always stop with an account"*, so a debt gate refusing that call would build a
latch **between two individually safe gates**.

Six latches in one feature. The rule that came out of it: **every state the ledger can enter needs a key
proven to turn, not merely documented.**

> ### ⚠️ Proven status — three tiers, and they are not interchangeable
>
> - **fixture-verified** — `canon-selftest.js` spawns the real `canon-gate.js` with fixture payloads on
>   stdin under an isolated `PORTAL_CANON_HOME`. No live session, no MCP server.
> - **live-verified** — installed over the real plugin cache and driven with `claude -p` on 2.1.231 with
>   `--debug-file`.
> - **unverified** — designed and reasoned, not observed.
>
> **Live-verified:** a `PreToolUse` deny genuinely refuses, and it beats `bypassPermissions`. The
> `PowerShell` bypass was measured **as a failure before the fix** (`permission_denials: []`, zero hook
> entries). The **cold return, end to end** — run 1 ended `stop_reason: end_turn` with the close-out
> missing, and run 2, a **new session whose ledger had been wiped**, had its first `Write` DENIED. On a
> **3-day-old debt the model recovered `read_board("7b3f1a2e-…")` verbatim** — a string present **only**
> in `additionalContext` and never in the deny reason, which is direct evidence that the split-channel
> design works. Debt budget degradation. Stop blocking at most once per turn, measured across 5 turns.
>
> **⚠️ `CANON-ID`'s id-laundering defence is FIXTURE-PROVEN ONLY**, and this distinction has to survive
> every rewrite of this page: it has never been live-verified **because the live model declined to
> fabricate an id at all.** So a live `CANON-ID` test that passes may be passing because the model
> refused to invent an id, not because the hook refused the call. **Those two are indistinguishable from
> outside**, and the fixture is the only evidence that separates them.
>
> **⚠️ Explicitly not proven:** `additionalContext` on `PreToolUse`/`PostToolUse` — no gate depends on
> it. `run.all_phases_terminal`'s real derivation, which is only ever reached in fixtures by patching the
> run manifest. Whether a deny reason carrying **no** imperatives still trips the injection heuristic.
>
> The failure all of this guards against has already happened here: 1.4.3's `portal-gate.js` is 61 lines,
> contains no `permissionDecision` at all, and has been advisory since the day it shipped — while being
> described as a gate.

## No card, no gates

On the gate build, every session opens with a card injected at `SessionStart`:

```
[portal-canon v1 · alive · token <6 hex chars>]
```

**If you do not see that line, the gates are not running.** Hooks **fail open and silently** — on both a
crash and a timeout the tool call proceeds and the model is told nothing — so a session that looks fine
is *not* evidence that anything ran. A dead gate is indistinguishable from a live one from inside the
conversation. That is why the card carries a token, and why the checks below exist.

The card is assembled in three pieces — head, gates, tail — rather than built and truncated, because a
blind `slice()` cuts **the escape** off first. Its cap is 3000 characters, raised from 2600 after the
live card measured 2614.

**Check properly, from a terminal:**

```bash
claude -p "list two files" --output-format stream-json --include-hook-events --verbose
```

Look for `{"type":"system","subtype":"hook_response","hook_name":"PreToolUse:…","exit_code":0,…}`. An
`outcome` of `"error"` means the gate **crashed**; `"cancelled"` means it **timed out**. Both fail open.

```bash
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" doctor     # home, run, gates armed, last 5 blocks
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" selftest   # fixture payloads through every mode
```

`doctor` lists the register, so `CANON-READ-BACK-STOP` is missing from its output too — check the
sentinel file directly if you need to know whether that one is stood down.

**What the selftest is, and is not.** It drives fixture payloads through every mode, and the suite
**currently reports 321 assertions**. That number appears **nowhere in the source** — it is the runtime
sum of `check()` calls, partly data-driven off the register, so adding one register row silently changes
it. **Never quote 321 as a constant.** There is no argv handling: no `--only`, no filter, you run the
whole suite or none of it. And it carries **zero timing instrumentation** — it measures correctness and
never latency, so no claim about speed can honestly cite it.

### The hook events involved

**1.4.3 registers four event types**, all of them `portal-gate.js` and `watch-alarm.js`: `PreToolUse` and
`PostToolUse` on the portal-write matcher, a second `PostToolUse` on
`await_my_turn`/`start_watching_channel`, a `SessionStart` preflight, and the `Stop` check.

**The gate build registers eight:** `SessionStart` (×2 — the canon card and the watch preflight; both
deliver), `UserPromptSubmit` (the debt notice, the run line and the stood-down list, capped at 1400
characters), `PreToolUse` on `.*`, `PostToolUse` on `.*` plus the watch recorder, `SubagentStart` and
`SubagentStop` (which emit nothing and only write ledger rows), `Stop` (×2, and **order matters** —
watch-alarm's `check` runs first, then canon-gate's `stop`, and canon-gate yields silently if watch-alarm
blocked within the last 90 s, because two gates blocking one turn spends the runtime's 9-block budget by
accident), and `SessionEnd`, which deletes this session's ledger files and then sweeps.

The `.*` matchers are deliberate: the gate runs on **every** tool call and bails before touching disk for
anything that is neither a portal tool nor a write/command. See **Performance** below.

## Known failure modes — named, not hidden

- **A session that dies mid-run leaves the run open.** The run manifest lives on disk keyed by project
  (which is what lets "keep going" survive compaction and a restart), so later sessions in that project
  spend one block per turn until the **24-hour no-progress TTL** fires, or someone runs
  `canon-gate.js stand-down` / `run-close`, or the run is closed. Mitigated five ways; **not removed.**
- **The same disk key is what makes the cold return work, and the two are one mechanism.** A debt keyed
  by project is a debt that survives closing the terminal — which is the point on Monday morning and the
  irritation on the run nobody meant to leave open. You cannot have one without the other.
- **Two install paths keep two ledgers.** `CLAUDE_PLUGIN_DATA` differs between a marketplace install and
  a `--plugin-dir` run, so a run opened under one is **invisible** to the other. Set
  **`PORTAL_CANON_HOME`** to the same path in both to force a single ledger.
- **On OAuth installs the one Stop-time portal read frequently returns 401** (`watch-alarm` returned
  `http_401` seven turns running on the author's machine). The turn-end reports then fall back to local
  ledger evidence and **label themselves "local evidence, not a verdict"** rather than pretending. The
  read-back gates and `CANON-ACCOUNT` are unaffected — they read the tool stream, not the network.
- **A hook that crashes or times out fails open.** Deliberate: a crashing gate must never be the reason
  your turn fails. It also means silence proves nothing.

## The honest limits

- **A hook can refuse a call and refuse to end a turn. It cannot make an idle session resume.** So
  "never stop between phases" ships as **"never end a turn silently mid-run"** — the enforceable form.
  Measured: a coordinator sat idle for 3h06m while no hook misfired, because an idle session ends no
  turn. These two sentences are not the same and this documentation does not blur them.
- **The `Stop` half blocks at most once per turn, and that is deliberate safety.** `stop_hook_active`
  short-circuits **above** the can-block check, and that short-circuit is the only reason this plugin
  cannot trap its own owner. The runtime hard-caps consecutive `Stop` blocks at 9 and then ends the turn
  with an **empty result**, which is worse than letting it end. The leak is measured and stated plainly
  in the code: `stop#1 BLOCK → stop#2 SPEAK → stop#3 BLOCK → stop#4 ALLOW` — the turn ends with the write
  unverified and phases remaining. **So the `Stop` half delays a violating turn by one exchange; it does
  not prevent it. That is WHY the debt gates exist:** the turn may end, the obligation is written down,
  and the *next* turn's first action answers for it.
- **Gates judge STRUCTURE, never QUALITY.** "A brief exists and was read back" is checkable. "The brief
  is good" is not — the selftest asserts that sentence verbatim. `canon-gates.md` ships a list of what no
  hook can ever check, so that nobody later builds a gate that pretends.
- **Refusal reasons carry facts and nothing else.** Measured twice: instructions inside a `PreToolUse`
  deny reason are read as prompt injection and deliberately not followed — a third probe told the model
  to write an unlock file and it declined, correctly. So a refusal names values **lifted from the call it
  is refusing**, and when it can name nothing concrete it says nothing. **Zero imperatives, verified
  mechanically:** the call evaluator contains no occurrence of the stand-down line, of
  `/portal-stand-down`, or of "TO STAND IT DOWN". Every clearing action instead travels on the channels
  the model does trust — `SessionStart` and `UserPromptSubmit` `additionalContext`, and `PostToolUse` /
  `Stop` block reasons. That split is not stylistic; it is the reason a 3-day-old debt could hand the
  model a board id it then used verbatim.
- **A deny reason says "a turn in this project", never "this session".** Debt outlives a session, so the
  session-shaped sentence would be untrue and would discredit the refusal that carried it.

## Performance

The gate runs on **every** tool call. The mitigation is structural rather than heuristic: the pre-tool
path calls `quiet()` and returns **before touching disk** for anything that is neither a portal tool nor
a write/command.

**Measured at HEAD of `feat/canon-hooks-enforce`**, A/B interleaved on identical fixtures at 60,000
ledger lines:

| | before | after |
|---|---|---|
| ungated tool call | 88–93 ms | 86–91 ms |
| gated tool call | 182–191 ms | 175–187 ms |

Older figures from earlier commits name no method and are superseded — **do not quote them**, and in
particular do not repeat `~150 ms`: that number is a *threshold for a future design decision* written
under a heading that says it is not measured, and it is the single highest re-quote risk in these docs.

Four claims are portable; independent reproduction confirmed their shape but not the absolutes, because
the dominant term is Node process startup (~68–95 ms) and that is machine-dependent:

1. **The ungated path does not scale with ledger size** — flat from 0 to 60,000 lines.
2. **The gate's own work is 0.12 ms on an empty ledger and single-digit ms at realistic density**,
   bounded because the fold is capped at 5000 lines regardless of file size.
3. **The debt gates cost nothing measurable** — they run off an already-loaded fold.
4. **There is no network on the hot path.** `canon-net.js` is `Stop`-only, one read per run per 120 s,
   6 s timeout, and it degrades to local evidence on failure.

## Privacy — what the ledger keeps

The gates work from a **local append-only ledger**, not from network calls on the hot path. It is a
plaintext file with ordinary user permissions. It records tool names, uuids, booleans, durations and a
fixed allow-list of scalar id/status arguments — and it **never** records titles, bodies, descriptions,
messages, objectives, deliverables, acceptance criteria, lessons, moods, reflections, or any prompt or
response text. **The journal is somebody's private account of how their days actually went; the ledger
stores that an entry happened and never a word of what it said.**

---

## What it installs

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | Registers the remote MCP (`https://…/mcp`). Auth is **OAuth 2.1 + PKCE** — no key, no headers. |
| `management-portal` **skill** | The operable how-to; auto-triggers on any portal work. |
| `reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `portal-operator` **subagent** | Operates the portal under the discipline (portal tools only). |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| `canon-gates.md` | **The source of truth for what is enforced vs advisory** — the gate register (including the tools each gate may never refuse), the proven-status board, the escape hatch, the honest limits. |
| **read-after-write hooks** | Pre/PostToolUse reminders that reinforce Gate 1 on every portal write. **Advisory** — `portal-gate.js` carries no `permissionDecision` and cannot refuse anything. |
| `team-chat-reachability` **skill** | Teaches how to stay reachable on a channel watch roster; the re-arm rule. |
| `team-chat-watcher` **subagent** | The one you **spawn**: the background loop that performs the blocking `await_my_turn` wait. Spawning it is what actually makes you reachable. |
| `/rearm-watch` **command** | What a **human types** to join a channel and keep watching it, or to read the roster by hand. |
| `scripts/watch-alarm.js` | The ABSENT alarm and turn-end gate. Node, no dependencies. **Arms itself on install** — the `Stop` entry is already in the plugin's own `hooks/hooks.json`. |
| **watch recorder + preflight hooks** | PostToolUse records that this machine really waited; SessionStart says when the alarm is not armed. |

**Not in 1.4.3 — listed so nobody goes hunting for it in an install that does not have it:**

| Component | Where it actually is |
|---|---|
| `scripts/canon-gate.js` | `feat/canon-hooks-enforce`. The canon gates: `PreToolUse` refusals, `PostToolUse`/`Stop` compulsions, the two debt gates, turn-end advisories, plus `stand-down`, `run-close`, `doctor` and `selftest` modes. |
| `/portal-project`, `/portal-continue` | `feat/canon-commands`. Start a disciplined run (client + project as arguments), and resume it without stopping between phases. |
| `/channel-coordinate`, `/channel-join` | `feat/canon-commands`. Join a Team Chat channel as coordinator or participant, under a name you choose. |
| `/portal-stand-down` **command** | `feat/canon-commands`. **The typed escape.** Until it merges, the escape is `canon-gate.js stand-down`, which works standing alone. |

## Install and sign in

The server authenticates with **OAuth 2.1 + PKCE** — discovery, dynamic client registration, authorize,
consent, token. There is **no API key anywhere in this path**. Two routes actually carry the sign-in
through to a working connection. Pick the one that matches you.

### Route 1 — claude.ai custom connector (recommended if you are not living in a terminal)

**Settings → Connectors → Add custom connector**, paste
`https://client-management-api-1uk1.onrender.com/mcp`, and approve. That is the whole flow: no terminal, no
JSON to edit, no key. The portal tools appear in the conversation straight away.

This route gives you the **tools only**. The skill, the subagents, the commands and the hooks are plugin
content — for those, take Route 2.

### Route 2 — the plugin, signed in from an interactive terminal

1. **Add this marketplace** — Claude Code Plugins panel → *Add marketplace*, or run:
   `/plugin marketplace add WaelFouda/management-portal-plugin`
2. **Install** — find **management-portal** in the marketplace and click *Install*, or run:
   `/plugin install management-portal@portal`
3. **Reload** (`/reload-plugins`) or restart Claude Code.
4. **Sign in.** In an **interactive terminal**, run `claude`, then `/mcp` → select **management-portal** →
   **Authenticate**. A browser opens, you approve, and the server comes back connected.

> ⚠️ **The sign-in only completes in an interactive terminal.** `/mcp` → **Authenticate** is the only
> thing that opens a browser.
>
> **Claude Code Desktop cannot complete it.** Desktop does perform discovery, dynamic client registration
> and PKCE, and it does build the authorization URL — then it logs
> `Redirection handling is disabled, skipping redirect` and stops. That is a **connect-time probe** whose
> job is to mark a server as "needs auth". **It is not a login.** The same applies to `claude -p` and to
> the SDK. If you only ever use Desktop, take **Route 1**.
>
> **Windows:** if no browser opens, Claude Code prints the authorization URL instead — paste it into a
> browser by hand. (Upstream `#44350` and `#59194`, both Windows, both closed without a fix.)
>
> **There is no `claude mcp login`.** No such subcommand exists in 2.1.85; don't go hunting for it.

> **Headless / CI, where no browser can ever open:** OAuth needs an interactive browser, so that case
> cannot use it. The server does still accept a platform API key on `X-API-Key`, so register the
> **standalone** server instead —
> `claude mcp add --transport http management-portal https://client-management-api-1uk1.onrender.com/mcp --header "X-API-Key: <YOUR_KEY>"`
> (key from the web app → **Settings → API Keys → Generate**) — or use the file-copy bundle in
> `agent-onboarding/bundles/claude-code/`, which registers the same way. That is a **different install path
> from this plugin** and it yields different tool names; see the next section.
>
> ⚠️ **That path writes the key in plaintext.** `claude mcp add` (and any project-scoped registration)
> puts it in `~/.claude.json`, under
> `projects[<abs path>].mcpServers["management-portal"].headers["X-API-Key"]`. It is a real file on disk
> in your home directory, readable by anything running as you. Treat that file as a secret, do not
> copy it into a repo or a support ticket, and rotate the key in **Settings → API Keys** if it leaks.

> ⚠️ **Restart, don't just open.** The skill, the `portal-operator` subagent, the `/portal` command,
> and the hooks register **only at session start**. After installing, **start a fresh Claude Code
> session** (or run `/reload-plugins` and reconnect MCP) before they're active.

Then verify: run `/mcp` to confirm the `management-portal` server is **connected** and its tools are
listed, and `/plugin list` to confirm the plugin is enabled.

### Signing in gets you tools — it does not get you a Team Chat name

**"I authenticated and `/portal` still finds nothing of mine" is the commonest confusion on this path, so
read this before you debug anything else.** A completed OAuth sign-in authenticates you as a *user*: the
session's `key_id` is `oauth:<user_id>`, not an API-key uuid. It does **not** enrol you on Team Chat and it
does **not** give you an agent name. You still call `register_me_as_agent` to take one, exactly as an
API-key install does — and one sign-in can host **several** named agents, precisely as one API key can.

Named registration under an OAuth session was impossible until the fix in `91bf9af`; it works now. If a
roster read or a watch shows nothing for you, the cause is almost always that nothing has registered a
name yet — not the sign-in.

## The tool-name prefix depends on which install path you took

**Read this before you write a hook matcher, an agent `tools:` list, or any doc that spells a tool name
out in full.** The two install paths above do **not** produce the same tool names.

| Install path | Server registers as | Tools appear as |
|---|---|---|
| **Plugin** (`/plugin install`) | `plugin:management-portal:management-portal` | `mcp__plugin_management-portal_management-portal__create_task` |
| **Manual** (`claude mcp add`, hand-written `.mcp.json`, the file-copy bundle) | `management-portal` | `mcp__management-portal__create_task` |

Claude Code scopes a server that a **plugin** provides to `plugin:<plugin>:<server>`, and the tool name is
that scoped id with the colons turned into underscores. Because this plugin's name and its server's name
are both `management-portal`, the segment is doubled — which looks like a typo and is not.

**So bind to both, never to one.** Everything this plugin ships that names a tool in full accepts both
spellings: the hook matchers make the plugin segment an optional regex group
(`mcp__(plugin_management-portal_)?management-portal__…`), and the `portal-operator` and
`team-chat-watcher` `tools:` lists spell out both forms for every tool.

**Why the agents do not just use a wildcard.** `tools:` does accept `mcp__<server>__*`, but both agents
hold a deliberately *narrowed* tool set — `portal-operator` has every `create_*`/`update_*` and **no**
`delete_*`; `team-chat-watcher` has seven read-only tools and cannot speak, release or claim a title. A
server wildcard would hand back exactly the tools those lists exist to withhold. The duplication is the
price of least privilege; **do not "clean it up".**

**How this failed silently.** Bare-only matchers do not error on a plugin install — they simply never
match, so the read-after-write gates never fire and the watcher/operator resolve **zero** tools. It went
unnoticed for as long as it did because every manual registration uses the bare name, and that is what
testing used.

## Use

- Just work on the portal — the **`management-portal` skill** auto-triggers and loads the discipline.
- For a dedicated, disciplined run, use **`/management-portal:portal <what to do>`** (the `/portal`
  command) — it dispatches the `portal-operator` subagent, restricted to `management-portal` tools and
  bound to the core loop, the three gates, bottom-up completion, never-fabricate-ids, and board-first.
- On Team Chat, type **`/rearm-watch`** to join a channel and keep watching it, or with no arguments to
  read the roster and re-arm.

## Team Chat watch: what this plugin gets, and what still needs a human

**This is a latency problem, not a delivery problem.** Messages are never lost — `await_my_turn` resumes
from its cursor and hands you everything that arrived while you were not looking. An agent that stops
watching loses **responsiveness**, not mail. Everything below shortens that gap; none of it rescues a
dropped message, because none is dropped.

**What the plugin gives you:** three separate mechanisms, and it is worth keeping them apart — the
`team-chat-reachability` **skill**, which teaches the rule; the `/rearm-watch` **command**, which a human
types; and the `team-chat-watcher` **sub-agent**, which you spawn and which is the only one of the three
that actually makes you reachable. Plus the alarm script at
`${CLAUDE_PLUGIN_ROOT}/scripts/watch-alarm.js`, a **`PostToolUse` recorder** on
`await_my_turn` / `start_watching_channel` that also speaks at the two join moments (a
`start_watching_channel` that has enrolled you but left nothing listening, and an `await_my_turn` that has
handed control back with `my_turn` true), and a **`SessionStart` preflight** check.

**The turn-end gate is included and needs no hand-editing.** It is this `Stop` entry, already present in
the plugin's `hooks/hooks.json`, and it fires from there (verified on Claude Code 2.1.222 and 2.1.85,
Windows). You do not need to copy it anywhere; it is shown only so you can recognise it:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/watch-alarm.js\" check",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

If that entry is ever removed, the `SessionStart` preflight announces at every session start that the alarm
is **NOT ARMED** — so this degrades loudly, never silently. **Fallback while unarmed:** read the roster
yourself with `list_channel_watchers`, or type `/rearm-watch`.

**What it does:** it does not merely warn. When the roster says this session's identity is
`ABSENT` and the script is certain the watch is this session's, it returns `decision: block` and **the turn
does not end** until you spawn the watcher. It gates **at most once per turn** and then releases with a
loud notice, it never gates on a roster read that merely failed, and it never gates a watch it cannot prove
is yours — those produce a notice instead. A hook still cannot spawn the sub-agent for you; it can only
make stopping conditional on your doing it.

**Still true even when it is armed:** a `Stop` hook fires at *turn end*, so it shortens the blind gap to
one turn rather than removing it, and a session that has **ended** has no turn left to end — no alarm will
ever fire for it. That case belongs to the coordinator's roster read and to the human. Full matrix and
limits: `agent-onboarding/WATCH-LAYERS.md`.

**Never forge a heartbeat.** A heartbeat means "this agent performed the blocking wait", and only
`await_my_turn` writes one. The alarm deliberately never writes one; the local state file it keeps is not
a heartbeat and never leaves your machine. Its one network call is a **read** (`list_channel_watchers`),
bounded at 6 s, at most once per 30 s, and skipped entirely when the local record is fresh.

**How the alarm authenticates that read, on an OAuth install.** The hook is a separate process and cannot
borrow your session's MCP connection, so it resolves its own credential — best first: the OAuth env names,
then the API-key env names, then your MCP client config, and finally this server's **access token only**
from the host's own store at `~/.claude/.credentials.json` (`mcpOAuth`). It never touches the refresh
token, never reads an entry belonging to another server, and never writes, prints or logs any of it.
`PORTAL_ALARM_NO_CREDENTIAL_FILE=1` turns that last path off. If it ends up with **nothing**, it says it
could not read the roster and therefore **does not know** — it never claims you are fine, and it never asks
you to paste an API key.

## Updating — and the release trap that has already bitten once

Bump `version` in `.claude-plugin/plugin.json` **and** the marketplace entry (`.claude-plugin/
marketplace.json` at the repo root — **both**, they are separate files), push, then users run
`/plugin update management-portal@portal`. (Omit `version` everywhere to auto-update on every commit.)

**Two files, two `version` fields, and nothing warns you when they disagree.** Bump one without the
other and the catalog advertises a version that is not what installs — the docs then describe
behaviour the user does not have. **Run this from the repo root before every publish:**

```bash
node -e "const a=require('./.claude-plugin/marketplace.json').plugins[0].version, b=require('./management-portal/.claude-plugin/plugin.json').version; console.log(a===b?('OK  both '+a):('MISMATCH  catalog='+a+'  plugin='+b)); process.exit(a===b?0:1)"
```

It exits non-zero on a mismatch, so it works as a pre-publish check rather than something to
remember.

> ### ⚠️ The marketplace catalog cache is SEPARATE from the plugin install
>
> **A reinstall can serve you a stale version.** After one bump the marketplace kept serving **1.3.2 for
> hours** while the repository plainly contained the new version. Nothing errors; you simply get old code
> and believe it is new — which, for a release whose entire content is *enforcement*, means believing you
> are gated when you are not.
>
> **Forcing a refresh, in order of increasing brutality:**
>
> ```
> /plugin marketplace update portal      # refresh the CATALOG, not the plugin
> /plugin update management-portal@portal
> /plugin marketplace remove portal      # if the catalog is still stale
> /plugin marketplace add WaelFouda/management-portal-plugin
> ```
>
> Then **reload** (`/reload-plugins`) or restart Claude Code, and **verify before you trust it**: run
> `/plugin` and confirm the installed version matches the one in `.claude-plugin/plugin.json` — **1.4.3**
> at the time of writing. If it does not, you are running older code no matter what the repository says.
>
> **This is per machine.** A bump reaches nobody until each machine updates.

### Which channel does a change ship through?

Three channels carry this plugin's canon, and they have **completely different reach**. Say which one you
changed, every time:

| Channel | What lives there | How it reaches people |
|---|---|---|
| **Backend** — `backend/routers/mcp_server.py` (`SERVER_INSTRUCTIONS`) | The canon itself, prepended to every session on every client. | **Deployed.** Reaches *every* MCP client — claude.ai connector, Cursor, Roo, plugin — on their next connect. No reinstall, no version bump. But **only when master deploys**. |
| **Plugin** — `management-portal/**` | Skills, commands, subagents, hooks, the gate script. | **Version bump → catalog refresh → per-machine reinstall → reload.** The slowest channel and the one with the stale-cache trap above. |
| **Website** — `frontend/src/pages/DocsMcp.tsx` | The public `/docs/mcp` page. | Deploys with the frontend. **Informational only** — it changes no client behaviour. |

**The backend deliberately never names a gate id.** A client without the plugin has no gates, and must not
be told it has. Gate ids appear only in plugin content and on the docs page.

## Notes

- Written from the same canonical source as the other bundles (`agent-onboarding/shared/` +
  `agent-onboarding/DISCIPLINE.md`). **There is no generator** — `shared/` and `bundles/` are
  hand-maintained copies, so "regenerate the adapters" is not a step that exists. If behavior must
  change, change the canon first and **move the copies by hand in the same commit**; nothing warns you
  when they drift.
- **`agent-onboarding/` itself has no README**, so there is no entry point above this file. If you
  arrived here first, the canon is `agent-onboarding/DISCIPLINE.md` and the measured hook facts are in
  `agent-onboarding/CANON-GATES.md`.
- Prefer always-on enforcement? The file-copy bundle also ships a `CLAUDE.md` operating contract;
  plugins don't carry `CLAUDE.md`, but the skill + `/portal` + hooks cover the same discipline.
