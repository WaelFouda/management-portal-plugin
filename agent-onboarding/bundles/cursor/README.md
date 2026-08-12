# Cursor bundle — management-portal MCP

Installable Cursor template that maps the shared portable core (`agent-onboarding/shared/`) onto
Cursor's native config: a root `AGENTS.md`, an always-applied project rule, the MCP server
registration, and a `/portal` command.

## What's in this bundle

| File | Purpose |
|---|---|
| `AGENTS.md` | Root agent contract — Cursor honors a root `AGENTS.md` automatically. Condensed from `shared/AGENTS.md`. |
| `.cursor/rules/portal-mcp.mdc` | Always-applied project rule (`alwaysApply: true`) carrying the operating contract — core loop, three gates, board-first, never-fabricate-ids. |
| `.cursor/mcp.json` | Registers the `management-portal` MCP server (URL + `X-API-Key`). |
| `.cursor/commands/portal.md` | A `/portal` command for a disciplined, contract-bound portal run. |

## Install

1. **Copy the bundle into your project root.** From this folder, copy `AGENTS.md` and `.cursor/` so they
   sit at the root of the repo you open in Cursor:

   ```
   <your-repo>/
   ├── AGENTS.md
   └── .cursor/
       ├── mcp.json
       ├── rules/
       │   └── portal-mcp.mdc
       └── commands/
           └── portal.md
   ```

   Cursor reads a root `AGENTS.md` automatically; `.cursor/rules/*.mdc` with `alwaysApply: true` is
   injected on every request; `.cursor/commands/*.md` registers slash commands (run `/portal`).

2. **Set your MCP key.** Open `.cursor/mcp.json` and replace `<YOUR_MCP_API_KEY>` with your real key.
   **Never commit the real key** — keep `.cursor/mcp.json` out of version control (add it to
   `.gitignore`) or have each developer fill it in locally.

3. **(Recommended) Add the operating skill.** For the full how-to + playbook (the principle →
   exact-tool-sequence guide and the write → read verification map), also copy the shared skill from
   `agent-onboarding/shared/skills/management-portal/` (`SKILL.md` + `reference.md`) into your repo so
   the contract's "where the detail lives" pointers resolve.

4. **Reload Cursor.** Enable the `management-portal` server in **Settings → MCP**, confirm it's
   connected, then run `/portal` for a disciplined portal run.

   > ⚠️ **Reload is required.** The root `AGENTS.md`, the `.mdc` rule, the `/portal` command, and the MCP
   > server take effect on load — restart/reload Cursor after copying the files or they won't be active.

## One-click (MCP server only)

Skip the `.cursor/mcp.json` edit — open this link to add the server to Cursor in one click:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=management-portal&config=eyJ1cmwiOiJodHRwczovL2NsaWVudC1tYW5hZ2VtZW50LWFwaS0xdWsxLm9ucmVuZGVyLmNvbS9tY3AiLCJoZWFkZXJzIjp7IlgtQVBJLUtleSI6IjxZT1VSX01DUF9BUElfS0VZPiJ9fQ==
```

Then replace `<YOUR_MCP_API_KEY>` in `.cursor/mcp.json`. The deeplink installs the **server only** — the
`AGENTS.md` contract, the `.mdc` rule, and the `/portal` command still come from the file copy above. Only
open MCP deeplinks from sources you trust.

## Connection (from `shared/mcp.config.md`)

| Field | Value |
|---|---|
| Server name | `management-portal` |
| Transport | streamable HTTP |
| URL | `https://client-management-api-1uk1.onrender.com/mcp` |
| Auth | header `X-API-Key: <YOUR_MCP_API_KEY>` |

## Team Chat watch: this bundle is instructions only

**This is a latency problem, not a delivery problem.** Messages are never lost — `await_my_turn` resumes
from its cursor and hands the agent everything that arrived while it was not looking. An agent that stops
watching loses **responsiveness**, not mail. The failure this system addresses is that nobody is *told*
an agent went quiet.

**What this bundle gets.** The full MCP roster — `start_watching_channel`, `list_channel_watchers`,
`require_channel_watch` / `release_channel_watch` — because that is server-side and works from any MCP
client. And the discipline in prose: the root `AGENTS.md` and `.cursor/rules/portal-mcp.mdc` carry the
staying-reachable contract, always applied.

**What it does not get, plainly.** Cursor has **no hooks, no harness-run scripts, and no background
sub-agents** in this bundle. There is no turn-end event to hang an alarm on, so the
`watch-alarm.js` script has nothing to run it — including the gate it runs on Claude Code, which there
holds a turn open until the watcher is spawned — and the `team-chat-watcher` sub-agent has nothing
to loop in. **Nothing will interrupt this agent when it goes `ABSENT`.** `/portal` is a command you invoke;
a command cannot loop and cannot fire on its own, so it is a way for you to ask, never a way to be told.

**The fallback, and it is the only one.** The human runs the roster check
(`list_channel_watchers(channel_id)`), and the coordinator reads the roster on their own cadence. Nothing
else here notices. Do not tell yourself the instructions are a backstop — they compete for the agent's
attention at exactly the moment the agent has decided something else matters more, which is how agents go
unreachable in the first place. Full per-adapter matrix and limits:
`agent-onboarding/WATCH-LAYERS.md`.

**Never forge a heartbeat.** A heartbeat means "this agent performed the blocking wait", and only
`await_my_turn` writes one. Nothing else may write one, and "I re-armed" is not evidence — the roster is.

## Notes

- This bundle is generated from the shared portable core. If behavior must change, change
  `agent-onboarding/DISCIPLINE.md` first, then regenerate the adapters so they never drift.
- `AGENTS.md` and the `.mdc` rule are condensations of `shared/AGENTS.md`; the canonical operating
  how-to is the `management-portal` skill and its `reference.md`.
