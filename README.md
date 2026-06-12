# Management Portal — Claude Code plugin marketplace

One-click install of the **management-portal MCP operator** for [Claude Code](https://code.claude.com).
It connects the management-portal MCP **and** ships the agent discipline that makes an agent use it
correctly — in a single install.

## Install

```text
/plugin marketplace add WaelFouda/management-portal-plugin
/plugin install management-portal@portal
```

On install you're **prompted once for your Management Portal API key** (`pfk_live_…`, from the web app
→ **Settings → API Keys**). It's stored securely in your OS keychain and injected into the MCP server's
`X-API-Key` header at runtime — it is **never** written to disk or committed.

> ⚠️ **Restart after installing.** The skill, the `portal-operator` subagent, the `/portal` command, and
> the hooks register only at session start. Start a fresh Claude Code session (or `/reload-plugins` and
> reconnect MCP), then run `/mcp` to confirm the `management-portal` server is **connected**.

## What you get

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | The remote MCP (clients, projects, briefs, proposals, tasks, flow board, boards, notes, calendar, gigs, time, team chat). |
| `management-portal` **skill** | Auto-triggers on any portal work and loads the operating discipline. |
| `portal-operator` **subagent** | Runs the portal under the discipline (portal tools only). |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| **read-after-write hooks** | Reinforce "verify every write by reading it back" on each portal write. |

## Use

Just start working on the portal — the skill loads automatically. For a dedicated, disciplined run use
**`/management-portal:portal <what to do>`**, which engages the `portal-operator` subagent bound to the
core loop, the three gates, bottom-up completion, never-fabricate-ids, and board-first alignment.

## Other platforms

Using VS Code Copilot, Cursor, or Roo Code instead? Equivalent bundles exist — see the in-app docs page
(`/docs/mcp`) and your API-key settings for the per-platform config.

---

*This repo is the public distribution channel for the plugin. The canonical source is maintained
privately and mirrored here; the plugin contains no secrets (your API key is supplied at install).*
