# management-portal — Claude Code plugin (one-click install)

The **Claude Code plugin** version of the management-portal operator. Same content as the
file-copy bundle (`agent-onboarding/bundles/claude-code/`), packaged so a user installs it from the
Claude Code **Plugins marketplace** (or two slash commands) — and is **prompted once for their API key**,
which on that path is stored in the OS keychain rather than written into a config file. (The `claude mcp
add` path does not behave this way — see the warning in **Install**.) No terminal required on Claude Code
Desktop.

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

## What it installs

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | Registers the remote MCP (`https://…/mcp`, `X-API-Key`). |
| `management-portal` **skill** | The operable how-to; auto-triggers on any portal work. |
| `reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `portal-operator` **subagent** | Operates the portal under the discipline (portal tools only). |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| **read-after-write hooks** | Pre/PostToolUse reminders that reinforce Gate 1 on every portal write. |
| `team-chat-reachability` **skill** | Teaches how to stay reachable on a channel watch roster; the re-arm rule. |
| `team-chat-watcher` **subagent** | The one you **spawn**: the background loop that performs the blocking `await_my_turn` wait. Spawning it is what actually makes you reachable. |
| `/rearm-watch` **command** | What a **human types** to join a channel and keep watching it, or to read the roster by hand. |
| `scripts/watch-alarm.js` | The ABSENT alarm and turn-end gate. Node, no dependencies. **Needs one manual step — below.** |
| **watch recorder + preflight hooks** | PostToolUse records that this machine really waited; SessionStart says when the alarm is not armed. |

## Install (Claude Code Desktop — no terminal)

1. **Create your API key** in the web app → **Settings → API Keys → Generate**, and copy it.
2. **Add this marketplace** — Claude Code Plugins panel → *Add marketplace*, or run:
   `/plugin marketplace add WaelFouda/management-portal-plugin`
3. **Install** — find **management-portal** in the marketplace and click *Install*, or run:
   `/plugin install management-portal@portal`
4. **Paste your API key when Claude Code prompts you** (`pfk_live_…`). On **this** path — the plugin's own
   `userConfig` prompt — it is stored in your OS keychain and is not written into a config file or
   committed. **That guarantee is specific to this path**; see the warning under the CLI install below.
5. **Reload** (`/reload-plugins`) or restart Claude Code. Then `/mcp` → connected, `/portal` → ready.

> **Headless / CLI (no `/plugin` UI):** the in-app key prompt only fires in the Desktop/UI flow. For a
> terminal-only or CI install, use the standalone server instead —
> `claude mcp add --transport http management-portal https://client-management-api-1uk1.onrender.com/mcp --header "X-API-Key: <YOUR_KEY>"` — or the file-copy bundle in `agent-onboarding/bundles/claude-code/`.
>
> ⚠️ **The CLI path does not use the keychain.** `claude mcp add` (and any project-scoped registration)
> writes the key **in plaintext** into `~/.claude.json`, under
> `projects[<abs path>].mcpServers["management-portal"].headers["X-API-Key"]`. It is a real file on disk
> in your home directory, readable by anything running as you. Treat that file as a secret, do not
> copy it into a repo or a support ticket, and rotate the key in **Settings → API Keys** if it leaks.

> ⚠️ **Restart, don't just open.** The skill, the `portal-operator` subagent, the `/portal` command,
> and the hooks register **only at session start**. After installing, **start a fresh Claude Code
> session** (or run `/reload-plugins` and reconnect MCP) before they're active.

Then verify: run `/mcp` to confirm the `management-portal` server is **connected** and its tools are
listed, and `/plugin list` to confirm the plugin is enabled.

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

## Updating

Bump `version` in `.claude-plugin/plugin.json` **and** the marketplace entry, push, then users run
`/plugin update management-portal@portal`. (Omit `version` everywhere to auto-update on every commit.)

## Notes

- Generated from the same canonical source as the other bundles (`agent-onboarding/shared/` +
  `agent-onboarding/DISCIPLINE.md`). If behavior must change, change the canon first, then regenerate —
  never let the adapter drift.
- Prefer always-on enforcement? The file-copy bundle also ships a `CLAUDE.md` operating contract;
  plugins don't carry `CLAUDE.md`, but the skill + `/portal` + hooks cover the same discipline.
