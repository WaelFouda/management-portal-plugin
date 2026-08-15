# management-portal — Claude Code bundle

Drop-in onboarding for operating the **management-portal MCP** from Claude Code, with the agent discipline
baked in. Copy these files into your repo root and set your key.

This file bundle is **one of four working install paths**. If you are not sure which you want, read the
next section first — the plugin install is easier and brings more, and one of the four paths has a trap
that is currently the single most common reason a new install cannot connect.

## Install paths — pick one

The plugin is **v1.3.2**, published from the **public** repo
[`WaelFouda/management-portal-plugin`](https://github.com/WaelFouda/management-portal-plugin) under the
marketplace name **`portal`**. Public means clients need no repo access to install it.

| | Path | How you install | Does it collect your API key? |
|---|---|---|---|
| **A** | **Claude Code Desktop — plugin, no terminal** *(recommended)* | Plugins panel → clicks | ✅ **Yes — it prompts you, and stores the key in your OS keychain.** |
| **B** | **Claude Code CLI — plugin** | `claude plugin …` in a shell | ❌ **No. It never asks. You must set the key yourself — see B2 below.** |
| **C** | **Manual `.mcp.json`** (this bundle; also Roo Code, Cursor, VS Code Copilot) | copy files, write the header | You write the key into the file. |
| **D** | **`claude mcp add`** | one command | You pass the key on the command line. |

> ### ⚠️ The difference that breaks installs: **A prompts for your key. B does not.**
>
> Both A and B install the same plugin. Only **A** ever asks you for a key. A **CLI** install substitutes
> the key variable **without having collected a value**, so the `X-API-Key` header goes out **empty** and
> every call fails with a generic connection error that looks like the server is down. It is not — you
> simply never gave it a key. This is a documented Claude Code limitation, closed as *not planned*:
> [`anthropics/claude-code#39827`](https://github.com/anthropics/claude-code/issues/39827).
>
> **If you install from the CLI, do step B2 below.** It is not optional.

## A · Claude Code Desktop — plugin, no terminal (recommended)

The path for a non-technical user. Nothing to edit, no terminal, and it is the **only** path that puts
your key in the OS keychain instead of a file on disk.

1. **Create your API key** in the web app → **Settings → API Keys → Generate**, and copy it
   (it looks like `pfk_live_YOUR_KEY`).
2. In Claude Code, open **Plugins** → **Add marketplace** → **Add from a repository**, and paste:

   ```
   WaelFouda/management-portal-plugin
   ```

3. Find **`management-portal`** in the marketplace list → click **Install**.
4. **Claude Code prompts you for the API key — paste it.** It is stored in your **OS keychain**: not
   written into a config file, not committed, not readable from your repo.
5. **Restart Claude Code** (or `/reload-plugins`). Then `/mcp` shows `management-portal` **connected**,
   and `/portal` is ready.

## B · Claude Code CLI — plugin

```bash
claude plugin marketplace add WaelFouda/management-portal-plugin
claude plugin install management-portal@portal
```

**B2 — set your key. Do this now, before you try to use it.** The two commands above complete
successfully and tell you nothing is missing, but **they never asked you for a key**, and the plugin has
no value to substitute into its `X-API-Key` header. Add the value yourself in `~/.claude/settings.json`,
under `pluginConfigs`:

```json
{
  "pluginConfigs": {
    "management-portal@portal": {
      "options": {
        "mcp_api_key": "pfk_live_YOUR_KEY"
      }
    }
  }
}
```

It has to be your **user** settings file — `~/.claude/settings.json`. A project-level or local
`.claude/settings.json` is **ignored** for `pluginConfigs`, so a key put there looks right and does
nothing.

Then restart Claude Code and run `/mcp` to confirm `management-portal` is **connected**.

If you skip B2, the failure does not say "no API key". It reports a generic connection/authentication
error that reads like an outage — which is why this step is here, above the first thing you would try,
and not in a troubleshooting section at the bottom. Prefer not to have a key in a settings file at all?
Use **path A**, which is the only one that uses the keychain.

## C · Manual `.mcp.json` — this bundle (and Roo Code, Cursor, VS Code Copilot)

A plain MCP server registration with the `X-API-Key` header. It works in **every** MCP client — this is
exactly what the Roo Code, Cursor and VS Code (Copilot) bundles do, with only the wrapper key and
transport hint changed:

```json
{
  "mcpServers": {
    "management-portal": {
      "type": "http",
      "url": "https://client-management-api-1uk1.onrender.com/mcp",
      "headers": {
        "X-API-Key": "pfk_live_YOUR_KEY"
      }
    }
  }
}
```

Copying this bundle's files is that registration **plus** the whole discipline as files — see
**What's in the bundle** and **Install (one screen)** below.

## D · `claude mcp add`

One command, no files to edit — the MCP server only, without the skills, subagents, commands or hooks:

```bash
claude mcp add --transport http management-portal \
  https://client-management-api-1uk1.onrender.com/mcp \
  --header "X-API-Key: pfk_live_YOUR_KEY"
```

⚠️ **This path does not use the keychain.** `claude mcp add` writes your key in **plaintext** into
`~/.claude.json`, under
`projects[<abs path>].mcpServers["management-portal"].headers["X-API-Key"]` — a real file in your home
directory, readable by anything running as you. Treat it as a secret, never copy it into a repo or a
support ticket, and rotate the key in **Settings → API Keys** if it leaks.

## What one plugin install brings (paths A and B)

A single install registers all of it — there is **nothing to add to `settings.json` by hand**:

- the **`management-portal` MCP server**;
- the **`management-portal` skill** (the operating discipline, auto-triggering on portal work);
- the **`team-chat-reachability` skill** and its **`team-chat-watcher` sub-agent**;
- the **`portal-operator` sub-agent**;
- the **`/portal`** and **`/rearm-watch`** commands;
- the **hooks** — read-after-write, the watch recorder, the session-start preflight, and a **`Stop` hook
  that arms the ABSENT alarm on install** and fires from the plugin's own `hooks/hooks.json`.

### Upgrading from 1.0.x — two things were renamed

| Old name | New name |
|---|---|
| skill `team-chat-watch` | skill **`team-chat-reachability`** |
| command `/watch-team-chat` | command **`/rearm-watch`** |

If you copied the old bundle by hand, delete the old skill directory and the old command file — a stale
copy keeps triggering alongside the new one.

## What's in the bundle

| File | Purpose |
|---|---|
| `CLAUDE.md` | Short repo memory — points at the skill + states the condensed operating contract. |
| `.claude/skills/management-portal/SKILL.md` | The `management-portal` skill — triggers on any portal work. |
| `.claude/skills/management-portal/reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `.claude/agents/portal-operator.md` | Subagent that operates the portal under the discipline (portal tools only). |
| `.claude/commands/portal.md` | `/portal` slash command — dispatches the `portal-operator` subagent. |
| `.claude/skills/team-chat-reachability/SKILL.md` | Teaches staying reachable on a channel watch roster; the re-arm rule; the coordinator title. |
| `.claude/agents/team-chat-watcher.md` | The subagent you **spawn** — it performs the blocking `await_my_turn` wait in the background, and spawning it is what actually makes you reachable. |
| `.claude/commands/rearm-watch.md` | `/rearm-watch` — what a **human types** to join a channel and keep watching it, or to read the roster. |
| `.claude/scripts/watch-alarm.js` | The ABSENT alarm and turn-end gate. Node, no dependencies (Windows and macOS). |
| `.claude/settings.json` | Hooks: read-after-write on portal writes, the watch **recorder / join-moment** hook, the **preflight** check, and the turn-end **Stop gate**. |
| `.mcp.json` | MCP server registration for `management-portal` (set your API key). |

## Install the file bundle (path C, one screen)

The shipped `.mcp.json` carries the placeholder `<YOUR_MCP_API_KEY>`; your real key looks like
`pfk_live_YOUR_KEY`.

1. **Copy** the bundle contents into your repo **root**, preserving paths:

   ```
   CLAUDE.md
   .mcp.json
   .claude/settings.json
   .claude/skills/management-portal/SKILL.md
   .claude/skills/management-portal/reference.md
   .claude/skills/team-chat-reachability/SKILL.md
   .claude/agents/portal-operator.md
   .claude/agents/team-chat-watcher.md
   .claude/commands/portal.md
   .claude/commands/rearm-watch.md
   .claude/scripts/watch-alarm.js
   ```

   If you already have a `CLAUDE.md` or `.claude/settings.json`, **merge** rather than overwrite.

2. **Set your key.** In `.mcp.json`, replace `<YOUR_MCP_API_KEY>` with your real management-portal key.
   **Never commit a real key.** Prefer an env var so it stays out of version control — set `MCP_API_KEY`
   in your environment and use:

   ```json
   "headers": { "X-API-Key": "${MCP_API_KEY}" }
   ```

   (Add `.mcp.json` to `.gitignore` if you hardcode the key instead.)

3. **Reload Claude Code** in the repo. Approve the `management-portal` MCP server when prompted, then run
   `/mcp` to confirm it connected and the tools are listed.

> ⚠️ **Restart, don't just open.** The skill, the `portal-operator` subagent, the `/portal` command, and
> the hooks register **only at session start**. If you add this bundle to a *running* Claude Code session
> it will **not** be active until you restart (start a fresh session) — verified the hard way.

## Use

- Just work on the portal — the **`management-portal` skill** auto-triggers and loads the discipline.
- For a dedicated, disciplined run, use **`/portal <what to do>`** — it dispatches the `portal-operator`
  subagent, which is restricted to `management-portal` tools and follows the core loop, the three gates,
  bottom-up completion, never-fabricate-ids, and board-first alignment.
- On Team Chat, type **`/rearm-watch`** to join a channel and keep watching it, or with no arguments to
  read the roster and re-arm.

## Team Chat watch: this bundle has full coverage

**This is a latency problem, not a delivery problem.** Messages are never lost — `await_my_turn` resumes
from its cursor and hands you everything that arrived while you were not looking. An agent that stops
watching loses **responsiveness**, not mail. Every layer below shortens that gap; none of it rescues a
dropped message, because none is dropped. What actually went wrong is that nobody was *told*.

This is the only bundle that carries every layer:

| Layer | Where it lives | What it does |
|---|---|---|
| MCP roster | the server | `start_watching_channel` enrols you; `list_channel_watchers` shows who is really present; `ABSENT` after 300 s with no heartbeat. |
| **Stop gate** | `.claude/settings.json` → `hooks.Stop` | At **turn end**, checks the roster — and when this session's identity is `ABSENT` and certainly its own, returns `decision: block` so **the turn does not end** until the watcher is spawned. |
| Recorder / join | `.claude/settings.json` → `hooks.PostToolUse` | Notes locally that this machine really called `await_my_turn` / `start_watching_channel`, and under which name. Silent on the watcher's quiet polling; speaks at the two join moments below. |
| Preflight | `.claude/settings.json` → `hooks.SessionStart` | Says at session start when the Stop gate is **not** armed, so this cannot degrade in silence. |
| Script | `.claude/scripts/watch-alarm.js` | Node, no dependencies; one implementation for Windows and macOS. |
| Sub-agent | `.claude/agents/team-chat-watcher.md` | The one you **spawn**. The background loop that performs the blocking wait — the only layer that actually makes you reachable. |
| Skill | `.claude/skills/team-chat-reachability/SKILL.md` | **Teaches** the procedure, including **re-arm first, then handle**. |
| Command | `/rearm-watch` | What a **human types** to join, check, or re-arm by hand. |

**The gate, and the join moments.** The `Stop` hook does not merely warn: on a certain `ABSENT` it blocks,
and the turn is held open until you spawn `team-chat-watcher` (verified — the turn stayed open and the
model was re-invoked with the block reason). It gates **at most once per turn**, via the
`stop_hook_active` guard, then releases with a loud notice; a session that can never finish a turn is
worse than one briefly unreachable. It never gates on a roster read that merely failed (6 s bound, three
strikes), and never gates a watch it cannot prove belongs to this session — both of those speak instead.
Separately, the `PostToolUse` hook covers the two moments a watch exists with nothing listening: when
`start_watching_channel` returns, and when `await_my_turn` hands control back with `my_turn` true. No hook
can spawn a sub-agent; what these do is make stopping conditional on your spawning one.

The `Stop` entry lives in `.claude/settings.json` in this bundle because a file bundle has no plugin to
declare it in. It works equally well from a plugin's `hooks/hooks.json` — verified on Claude Code 2.1.222
and 2.1.85, Windows — so if you install the plugin instead, the gate arms itself and you add nothing. Also note both hooks emit
`{"hookSpecificOutput":{"hookEventName":"…","additionalContext":"…"}}`: plain stdout from a hook is
discarded for **`Stop` and `PostToolUse` alike**, so the `echo "…"` pattern the read-after-write hooks use
never reaches the model in either place.

**What full coverage still does not buy you.** A `Stop` hook fires at *turn end*: gating closes that exit,
but it shortens the blind gap to one turn rather than removing it. An agent grinding through a
twenty-minute turn has not ended one, so nothing fires. A session that has **ended entirely** has no turn
left to end, so **no alarm will ever fire for it** — the roster row, the obligation, and the `ABSENT`
marking survive the session, and only a human or the coordinator's roster read will catch it. Full matrix
and limits: `agent-onboarding/WATCH-LAYERS.md`.

**Never forge a heartbeat.** A heartbeat means "this agent performed the blocking wait", and only
`await_my_turn` writes one. The alarm never writes one; its local state file is not a heartbeat and never
leaves your machine. Its one network call is a **read** (`list_channel_watchers`), bounded at 6 s, at most
once per 30 s, and skipped entirely when the local record is fresh — this project runs near a 5 GB/month
egress cap. The script embeds no credential. It resolves one, best first, from the **OAuth** env names
(`CLAUDE_PLUGIN_OPTION_MCP_OAUTH_TOKEN` / `MCP_OAUTH_TOKEN` / `PORTAL_OAUTH_TOKEN`), then the **API-key**
names (`CLAUDE_PLUGIN_OPTION_MCP_API_KEY` / `MCP_API_KEY` / `PORTAL_API_KEY`), then your own MCP client
config in either header form, and finally — this is how it stays useful on an **OAuth** install — this
server's **access token only** from the host's own store at `~/.claude/.credentials.json` (`mcpOAuth`). It
never touches the refresh token, never looks at an entry for any other server, and never writes, prints or
logs any of it; `PORTAL_ALARM_NO_CREDENTIAL_FILE=1` switches that last path off. With **no** credential at
all it says it could not read the roster and therefore **does not know** — never that you are fine — and it
tells you outright not to paste an API key on account of the message.

## The discipline in one breath

You have the **tools, not the database**. Read tools (`get_*`/`list_*`) are your only source of truth and
your only way to verify. **Ground every action in what the portal contains, then leave it complete and
correct.** Run `READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE`.
Honor the three gates — **read-after-write, completeness, task-breakdown** — complete bottom-up, and
**never fabricate an id**.

> Canonical spec: `agent-onboarding/DISCIPLINE.md` and the shared core under `agent-onboarding/shared/`.
> This bundle condenses them; if they ever conflict, the canon wins.
