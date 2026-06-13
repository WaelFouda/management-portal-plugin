# Management Portal — Claude Code plugin marketplace

One-click install of the **management-portal MCP operator** for [Claude Code](https://code.claude.com).
It connects the management-portal MCP **and** ships the agent discipline that makes an agent use it
correctly — in a single install.

## Install

**1. Set your API key as an environment variable** (once) — your `pfk_live_…` key from the web app
→ **Settings → API Keys**:

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
`X-API-Key` header — the key is **never** written to disk or committed. Environment-variable auth works
on **every** install path (CLI or the `/plugin` UI); an interactive key prompt only fires in the UI, so
the env var is the robust, universal approach.

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

## Other platforms (file-copy bundles)

VS Code Copilot, Cursor, and Roo Code don't have a one-click marketplace like Claude Code — they install
by copying a small bundle. Grab the bundle for your platform from this repo:

| Platform | Bundle | One-click? |
|---|---|---|
| **Cursor** | [`agent-onboarding/bundles/cursor/`](agent-onboarding/bundles/cursor) | MCP server only — `cursor://` deeplink in its README |
| **VS Code (Copilot)** | [`agent-onboarding/bundles/copilot/`](agent-onboarding/bundles/copilot) | MCP server only — `vscode:mcp/install` link in its README |
| **Roo Code** | [`agent-onboarding/bundles/roo/`](agent-onboarding/bundles/roo) | No — file copy only |
| **Claude Code (manual)** | [`agent-onboarding/bundles/claude-code/`](agent-onboarding/bundles/claude-code) | Prefer the one-click plugin above |

Each bundle's README has one-screen install steps. The shared core they condense from is in
[`agent-onboarding/shared/`](agent-onboarding/shared); the canonical spec is
[`agent-onboarding/DISCIPLINE.md`](agent-onboarding/DISCIPLINE.md).

> **For agents:** when there's no one-click path (e.g. Roo), fetch the platform's bundle folder above,
> copy its files into the user's project root, replace `<YOUR_MCP_API_KEY>` in the MCP config, and follow
> the bundle README. Everything here is public and contains only placeholders — no secrets.

---

*This repo is the public distribution channel for the plugin. The canonical source is maintained
privately and mirrored here; the plugin contains no secrets (your API key is supplied at install).*
