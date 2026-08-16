# management-portal — Claude Code plugin (one-click install)

The **Claude Code plugin** version of the management-portal operator. Same content as the
file-copy bundle (`agent-onboarding/bundles/claude-code/`), packaged so a user installs it from the
Claude Code **Plugins marketplace** (or two slash commands). **You sign in with OAuth** — there is no API
key to create, paste or store. The plugin ships no `userConfig` prompt, and its `.mcp.json` carries no
`headers` at all: just `type` and `url`.

> ## Read [Install](#install-and-sign-in) before you click anything
>
> **How you connect decides whether the sign-in can complete at all.** Claude Code **Desktop cannot finish
> an MCP OAuth sign-in** — the "Authenticate" prompt it shows you is a status badge, not a login, and
> retrying it will never work. The two routes that *do* finish are the **claude.ai custom connector**
> (recommended, no terminal) and an **interactive terminal** session. Nothing is wrong with the plugin or
> the server; the Desktop surface simply does not implement the browser step.

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

# The canon gates (1.6.4) — READ THE ESCAPE FIRST

1.5.0 turns parts of the agent discipline from **reminders** into **hooks that refuse**. Before anything
else, here is how to turn them off, because someone reading this section is usually reading it because
something is blocked.

## STAND DOWN — if a gate is blocking work it cannot un-block

Any one of these. **The first two take effect immediately, mid-session, with no restart:**

```bash
# 1. Sentinel file. The gate script writes it; every hook re-reads it on every invocation.
node "<CLAUDE_PLUGIN_ROOT>/scripts/canon-gate.js" stand-down --gate <GATE-ID|all> --reason "why"
```

```
# 2. The same thing, typed.
/portal-stand-down [gate id or 'all'] [reason]
```

```bash
# 3. Environment. Fixed for the session's life — that is why 1 and 2 exist.
PORTAL_CANON=off        # every gate silent
PORTAL_CANON=advisory   # nothing refuses or blocks; the turn-end report still prints
```

**Why the primary escape is a file and not a flag.** This plugin's author runs
`defaultMode: bypassPermissions`, where a `PreToolUse` deny is the *only* brake and there is no
permission prompt to click through. So the brake must be something a hook re-reads from disk on **every
single invocation** — otherwise a wrong gate would be unclearable until the session was restarted.

The `stand-down` invocation is **exempt from every gate**, including the coordinator gate that otherwise
refuses `Bash`. A gate that can block its own escape is a trap; that exemption is hard-coded.

Sentinels live under `<CANON_HOME>/`: `STAND-DOWN` (everything), `STAND-DOWN-<run_id>` (one run),
`STAND-DOWN-<GATE-ID>` (one gate). **Delete the file to re-arm.** To end a run outright, delete
`<CANON_HOME>/runs/by-project/<projhash>.json`.

**They also stand themselves down.** 3 blocks per gate per run (2 for closeout), 12 `PostToolUse` blocks
per session, a dead-man rule that disarms any gate blocking twice with no tool call in between, and a
24-hour no-progress TTL that closes an abandoned run. A stuck session un-sticks itself even if nobody
finds this page.

**From 1.6.1 the per-run budget is REFUNDED BY PROGRESS, and from 1.6.4 by a NEW SESSION too** — a milestone delivered or approved, or a phase
completed. It used to be monotonic, which meant a run lasting a working day lost `CANON-ACCOUNT` by
mid-morning and never got it back, and the owner ended up doing the gate's job by hand. A genuinely stuck
run still exhausts its three and cannot be trapped; a run that is visibly moving keeps its net.

## What actually refuses, and what only advises

**The distinction is the whole point of this release, so it is stated in three places and they must
agree.** `skills/management-portal/canon-gates.md` is the **source of truth**; this README and the public
`/docs/mcp` page mirror it. If they disagree, that file wins and the drift is a bug.

| Verdict | Mechanism | Consequence |
|---|---|---|
| **REFUSE** | `PreToolUse` → `permissionDecision: "deny"` | The call **never runs**. Your data is untouched. |
| **BLOCK** | `PostToolUse` / `Stop` → `decision: "block"` | It **already happened**; you are compelled to act before continuing or ending the turn. |
| **ADVISE** | Text at turn end | Nothing is prevented. |

**Refusals cover:** a fabricated id (`CANON-ID`), completing a parent before its subtasks
(`CANON-BOTTOM-UP`), a coordinator implementing instead of delegating (`CANON-COORD-ROLE`), a participant
acting before reading the channel policy (`CANON-POLICY-FIRST`), skipping the journal at a phase boundary
(`CANON-JOURNAL-PHASE`), destroying a knowledge graph with `regenerate_*` (`CANON-KG-DESTRUCTIVE`),
editing implementation files before the task tree exists (`CANON-TREE-FIRST`), and writing the
brief/proposal before the alignment board (`CANON-BOARD-FIRST`).

**Compulsions cover:** read-after-write (`CANON-READ-BACK`, `CANON-READ-BACK-STOP`), ending a mid-run
turn without an account of yourself (`CANON-ACCOUNT`), and closing a run without its summary board,
graph closure and final journal (`CANON-CLOSEOUT`).

**Advisories — and they are advisory *by design*, not by weakness:** `bulk` efficiency (`CANON-BULK` — a
deny on the fourth single write cannot undo the first three), status discipline (`CANON-STATUS`), and
completeness (`CANON-COMPLETE` — which names empty **fields** and never judges what is written in them).

> ### ⚠️ Status, as of plugin 1.6.4 — three gates verified live, the rest armed
>
> **The engine ships.** `scripts/canon-gate.js` is present, 2062 lines, emits a real `PreToolUse`
> `permissionDecision: "deny"`, and `hooks/hooks.json` wires it into 8 of the 11 hook entries. The
> advisory `portal-gate.js` it replaces has been **deleted**. Every canon gate above therefore reads
> **ARMED** — shipped, wired, and **fixture-verified** by `scripts/canon-selftest.js`, which spawns the
> real binary with fixture payloads and drives each gate into its latched state and back out.
>
> **THREE ARE NOW VERIFIED LIVE, and the first refusals were WRONG — which is the honest headline.**
> On 2026-08-16 `CANON-ID`, `CANON-READ-BACK` and `CANON-BOTTOM-UP` were all observed refusing real calls
> in a live session. `CANON-ID`'s first refusals were **false**: 1.5.0 read a `bulk` response as a string
> when it is really content blocks, so every id returned inside a batch was dropped from the seen-id
> ledger and the gate refused ids the server had just issued. 1.6.0 fixed that; 1.6.1 fixed three more of
> the same family, including a `CANON-BOTTOM-UP` refusal naming a "subtask" that was a fragment of the
> parent's own uuid.
>
> **ARMED still is not ENFORCED for the rest**, and must not be written up as one. Everything not named
> above is fixture-verified by `scripts/canon-selftest.js` (351 assertions) and has not been seen refusing
> a live call. The status board in `skills/management-portal/canon-gates.md` remains the one place that
> verdict lives; this box mirrors it and the two are required to agree.
>
> The turn-end Team Chat ABSENT gate (`watch-alarm.js`) is still the one piece of enforcement observed
> live: `decision: block`, verified on Claude Code 2.1.222 and 2.1.85.
>
> **Why the distinction is drawn this hard:** the failure it guards against already happened here.
> 1.4.3's `portal-gate.js` was 61 lines, contained no `permissionDecision` at all, and was advisory for
> its entire service life — while being described as a gate.

## No card, no gates

Every session opens with a card injected at `SessionStart`:

```
[portal-canon v1 · alive · token <6 hex chars>]
```

**If you do not see that line, the gates are not running.** Hooks **fail open and silently** — on both a
crash and a timeout the tool call proceeds and the model is told nothing — so a session that looks fine
is *not* evidence that anything ran. A dead gate is indistinguishable from a live one from inside the
conversation. That is why the card carries a token, and why the checks below exist.

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

## Known failure modes — named, not hidden

- **A restart, or a sub-agent, lost the decomposition — fixed in 1.6.3.** `CANON-TREE-FIRST` counted the
  four decomposition calls in the SESSION's tool stream, but a run outlives a session. Restart Claude
  Code mid-run and a task tree built an hour earlier became invisible: every source write was refused,
  with the reason insisting the run had "no recorded `create_task`" while the tasks sat in the portal.
  It was worse for sub-agents, which is how it surfaced — three lanes blocked at once. A fresh
  sub-agent's stream contains no portal writes at all, and **must not**, because the canon explicitly
  says to keep portal writes in the parent session. The canon asked for something it then refused to
  accept. The decomposition is now recorded on the RUN, so it survives a restart and is visible to a
  sub-agent; a run that genuinely has no tree is still refused.

- **A `>` inside quotes was read as a redirection — fixed in 1.6.2.** `node -e '... a - b > 3600000 ...'`
  was refused by `CANON-TREE-FIRST` as *"writes 3600000 (via a redirection)"*. The `>` is a comparison
  inside a quoted argument and no shell would redirect there. The nuisance was not the cost: the same
  scan decides whether a command CHANGES STATE, so any quoted `>` also made a read-only command look
  like a write, which is the `CANON-COORD-ROLE` premise too. Quoted spans are now masked before the
  operator is located, while a genuinely quoted target — `> "my file.txt"` — is still read correctly.

- **And a RESTART did not restore it either — fixed in 1.6.4.** The run outlives the session, so a run that
  spent its three blocks in the morning carried a silenced `CANON-ACCOUNT` through every restart for the rest
  of the day. A new session now refunds the budget. Safe, because the hazard the cap exists for cannot cross
  that boundary: a gate stuck in a refuse-loop is stuck within one session's tool stream, and a restart ends
  that stream.
- **A long run used to lose its safety net permanently — fixed in 1.6.1, and worth knowing why.** Each
  gate has a per-run block budget (3), after which it degrades to a notice so it can never trap a session
  that genuinely cannot proceed. That counter was monotonic, so on a run lasting a working day
  `CANON-ACCOUNT` — the gate whose whole job is refusing a silent stop mid-run — was a notice by
  mid-morning and never came back. Compounding it, a phase boundary was only recorded for
  `update_milestone_status` while the tool everyone actually uses is `update_proposal_milestone`, so a run
  could deliver milestone after milestone and still report `phase boundaries recorded 0`. The gate went
  quiet and the evidence that it should not have was never written down. **The budget is now refunded by
  progress** — a milestone delivered or approved, or a phase completed — so a moving run keeps its net
  while a stuck one still exhausts its three.

- **A session that dies mid-run leaves the run open.** The run manifest lives on disk keyed by project
  (which is what lets "keep going" survive compaction and a restart), so later sessions in that project
  spend one block per turn until the **24-hour no-progress TTL** fires, or someone runs
  `/portal-stand-down`, or the run is closed. Mitigated five ways; **not removed.**
- **Two install paths keep two ledgers.** `CLAUDE_PLUGIN_DATA` differs between a marketplace install and
  a `--plugin-dir` run, so a run opened under one is **invisible** to the other. Set
  **`PORTAL_CANON_HOME`** to the same path in both to force a single ledger.
  **Fixed in 1.6.0 for the case that actually bit:** `CLAUDE_PLUGIN_DATA` is set for a hook and unset
  for a Bash call, and `/portal-continue` starts by running `run-promote` from Bash — so the run went
  to one home and every gate read another, and the card said `no run declared` no matter how many
  times it was promoted. With no env set the CLI now discovers the live home rather than assuming a
  folder name. Run `doctor`: it prints the resolved path **and which rule chose it**.
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
- **Gates judge STRUCTURE, never QUALITY.** "A brief exists and was read back" is checkable. "The brief
  is good" is not. `canon-gates.md` ships a verbatim list of what no hook can ever check, so that nobody
  later builds a gate that pretends.
- **Refusal reasons are curt on purpose.** Measured twice: instructions inside a `PreToolUse` deny reason
  are read as prompt injection and deliberately not followed. So refusals state facts only, and every
  clearing action is published through the channels the model trusts — the canon card, block reasons, and
  the command bodies.

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
| `canon-gates.md` | **The source of truth for what is enforced vs advisory** — the gate register, the status board, the escape hatch, the honest limits. |
| `scripts/canon-gate.js` | The canon gates: `PreToolUse` refusals, `PostToolUse`/`Stop` compulsions, turn-end advisories, plus `stand-down`, `doctor` and `selftest` modes. |
| `/portal-project`, `/portal-continue` | Start a disciplined run (client + project as arguments), and resume it without stopping between phases. |
| `/channel-coordinate`, `/channel-join` | Join a Team Chat channel as coordinator or participant, under a name you choose. |
| `/portal-stand-down` **command** | **The escape.** Stands one gate — or all of them — down, mid-session. |
| `/plain-english` **command** | Re-explains the current work in plain language — short, jargon-free, decision-first — and holds that register for the rest of the session. For handing a status to someone who does not work on the code. It changes how things are said, never what is true. |
| **canon gate hooks** | `PreToolUse` and `PostToolUse` on matcher `.*`, plus `SessionStart`, `UserPromptSubmit`, `SubagentStart`/`SubagentStop`, `Stop` and `SessionEnd` — all routed through `canon-gate.js`, which carries a real `permissionDecision`. **The 1.4.3 `portal-gate.js`, which carried none and could only remind, is deleted.** |
| `team-chat-reachability` **skill** | Teaches how to stay reachable on a channel watch roster; the re-arm rule. |
| `team-chat-watcher` **subagent** | The one you **spawn**: the background loop that performs the blocking `await_my_turn` wait. Spawning it is what actually makes you reachable. |
| `/rearm-watch` **command** | What a **human types** to join a channel and keep watching it, or to read the roster by hand. |
| `scripts/watch-alarm.js` | The ABSENT alarm and turn-end gate. Node, no dependencies. **Needs one manual step — below.** |
| **watch recorder + preflight hooks** | PostToolUse records that this machine really waited; SessionStart says when the alarm is not armed. |

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
out in full.** A **plugin** install (Routes B and C) and a **manual** registration (`claude mcp add`, the
file-copy bundle) do **not** produce the same tool names.

| Install path | Server registers as | Tools appear as |
|---|---|---|
| **Plugin** (`/plugin install`) | `plugin:management-portal:management-portal` | `mcp__plugin_management-portal_management-portal__create_task` |
| **Manual** (`claude mcp add`, hand-written `.mcp.json`, the file-copy bundle) | `management-portal` | `mcp__management-portal__create_task` |

Claude Code scopes a server that a **plugin** provides to `plugin:<plugin>:<server>`, and the tool name is
that scoped id with the colons turned into underscores. Because this plugin's name and its server's name
are both `management-portal`, the segment is doubled — which looks like a typo and is not.

**So bind to both, never to one — and for hooks, do not bind to a spelling at all.** The
`portal-operator` and `team-chat-watcher` `tools:` lists spell out both forms for every tool. The
**hooks no longer try**: 1.4.3 matched `mcp__(plugin_management-portal_)?management-portal__…`, and
because `matcher` is a **full** match that pattern was silently **inert** for a claude.ai-connector
install (`mcp__claude_ai_management-portal__*`) and for a UUID-named install (`mcp__<uuid>__*`), both
of which are live in the wild. 1.5.0 matches **`.*`** and scopes **at runtime** against a frozen set
of 257 portal tool names — a tool outside that set is never subject to a portal invariant, so an
unknown MCP server is ignored rather than gated. **Never enumerate install spellings in a regex
again**; that is how this broke in the first place. (`watch-alarm.js`'s recorder is the one remaining
narrow matcher, and it is spelling-agnostic too: `mcp__.*__(await_my_turn|start_watching_channel)`.)

**Why the agents do not just use a wildcard.** `tools:` does accept `mcp__<server>__*`, but both agents
hold a deliberately *narrowed* tool set — `portal-operator` has every `create_*`/`update_*` and **no**
`delete_*`; `team-chat-watcher` has seven read-only tools and cannot speak, release or claim a title. A
server wildcard would hand back exactly the tools those lists exist to withhold. The duplication is the
price of least privilege; **do not "clean it up".**

**How this failed silently.** Bare-only matchers do not error on a plugin install — they simply never
match, so the read-after-write hooks never fired and the watcher/operator resolved **zero** tools. It
went unnoticed for as long as it did because every manual registration uses the bare name, and that is
what testing used. Nothing warns you: a matcher that never matches and a hook that is not installed
look identical from inside a conversation, which is the same failure shape as the advisory
`portal-gate.js` and the reason the canon card carries a liveness token.

## Use

- Just work on the portal — the **`management-portal` skill** auto-triggers and loads the discipline.
- For a dedicated, disciplined run, use **`/management-portal:portal <what to do>`** (the `/portal`
  command) — it dispatches the `portal-operator` subagent, restricted to `management-portal` tools and
  bound to the core loop, the three gates, bottom-up completion, never-fabricate-ids, and board-first.
- On Team Chat, type **`/rearm-watch`** to join a channel and keep watching it, or with no arguments to
  read the roster and re-arm.

## Team Chat watch: what this plugin gets, and the one manual step

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
> `/plugin` and confirm the installed version reads **1.6.4**. If it does not, you are running older code
> no matter what the repository says.
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

- Generated from the same canonical source as the other bundles (`agent-onboarding/shared/` +
  `agent-onboarding/DISCIPLINE.md`). If behavior must change, change the canon first, then regenerate —
  never let the adapter drift.
- Prefer always-on enforcement? The file-copy bundle also ships a `CLAUDE.md` operating contract;
  plugins don't carry `CLAUDE.md`, but the skill + `/portal` + hooks cover the same discipline.
