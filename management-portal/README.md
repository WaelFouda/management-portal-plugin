# management-portal — Claude Code plugin (one-click install)

The **Claude Code plugin** version of the management-portal operator. Same content as the
file-copy bundle (`agent-onboarding/bundles/claude-code/`), packaged so a user installs it from the
Claude Code **Plugins marketplace** (or two slash commands) — and is **prompted once for their API key**,
stored in the OS keychain, never written to disk. No terminal required on Claude Code Desktop.

## What it installs

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | Registers the remote MCP (`https://…/mcp`, `X-API-Key`). |
| `management-portal` **skill** | The operable how-to; auto-triggers on any portal work. |
| `reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `portal-operator` **subagent** | Operates the portal under the discipline (portal tools only). |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| **read-after-write hooks** | Pre/PostToolUse reminders that reinforce Gate 1 on every portal write. |

## Install (Claude Code Desktop — no terminal)

1. **Create your API key** in the web app → **Settings → API Keys → Generate**, and copy it.
2. **Add this marketplace** — Claude Code Plugins panel → *Add marketplace*, or run:
   `/plugin marketplace add WaelFouda/management-portal-plugin`
3. **Install** — find **management-portal** in the marketplace and click *Install*, or run:
   `/plugin install management-portal@portal`
4. **Paste your API key when Claude Code prompts you** (`pfk_live_…`). It's stored in your OS keychain — never written to disk or committed.
5. **Reload** (`/reload-plugins`) or restart Claude Code. Then `/mcp` → connected, `/portal` → ready.

> **Headless / CLI (no `/plugin` UI):** the in-app key prompt only fires in the Desktop/UI flow. For a
> terminal-only or CI install, use the standalone server instead —
> `claude mcp add --transport http management-portal https://client-management-api-1uk1.onrender.com/mcp --header "X-API-Key: <YOUR_KEY>"` — or the file-copy bundle in `agent-onboarding/bundles/claude-code/`.

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

## Updating

Bump `version` in `.claude-plugin/plugin.json` **and** the marketplace entry, push, then users run
`/plugin update management-portal@portal`. (Omit `version` everywhere to auto-update on every commit.)

## Notes

- Generated from the same canonical source as the other bundles (`agent-onboarding/shared/` +
  `agent-onboarding/DISCIPLINE.md`). If behavior must change, change the canon first, then regenerate —
  never let the adapter drift.
- Prefer always-on enforcement? The file-copy bundle also ships a `CLAUDE.md` operating contract;
  plugins don't carry `CLAUDE.md`, but the skill + `/portal` + hooks cover the same discipline.
