# management-portal — Claude Code plugin (one-click install)

The **Claude Code plugin** version of the management-portal operator. Same content as the
file-copy bundle (`agent-onboarding/bundles/claude-code/`), packaged so a user installs it with
**two slash commands** instead of copying files. The MCP server reads your API key from the
**`MCP_API_KEY` environment variable** at connect time — never written into the plugin or committed.

## What it installs

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | Registers the remote MCP (`https://…/mcp`, `X-API-Key`). |
| `management-portal` **skill** | The operable how-to; auto-triggers on any portal work. |
| `reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `portal-operator` **subagent** | Operates the portal under the discipline (portal tools only). |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| **read-after-write hooks** | Pre/PostToolUse reminders that reinforce Gate 1 on every portal write. |

## Install

**1. Set your API key as an environment variable** (once) — your `pfk_live_…` key from the web app
→ Settings → API Keys:

```text
# Windows (PowerShell):   setx MCP_API_KEY "pfk_live_your_key_here"
# macOS / Linux:          export MCP_API_KEY="pfk_live_your_key_here"   (add to ~/.zshrc or ~/.bashrc)
```

**2. Add the marketplace and install** (in Claude Code):

```text
/plugin marketplace add WaelFouda/management-portal-plugin
/plugin install management-portal@portal
```

The MCP server reads `MCP_API_KEY` from your environment at connect time and sends it as the
`X-API-Key` header — the key is **never** written into the plugin or committed. Env-var auth works for
**every** install path (CLI or the `/plugin` UI); an interactive key prompt only fires in the UI, so the
environment variable is the robust, universal approach.

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
