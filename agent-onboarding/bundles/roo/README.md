# Roo Code bundle — management-portal MCP

Installable Roo Code template that maps the shared portable core
(`agent-onboarding/shared/`) onto Roo Code's native config: an always-on workspace rule, a custom
**Portal Operator** mode, and the MCP server registration.

## What's in this bundle

| File | Purpose |
|---|---|
| `.roo/rules/01-portal-mcp.md` | Always-on workspace rule — the operating contract (core loop, three gates, board-first, never-fabricate-ids), condensed from `shared/AGENTS.md`. |
| `.roomodes` | A **Portal Operator** custom mode: persona + allowed tool groups (`read`, `edit`, `command`, `mcp`) + per-mode instructions that reference the contract. |
| `.roo/mcp.json` | Registers the `management-portal` MCP server (streamable HTTP, `X-API-Key`). |

## Install

1. **Copy the bundle into your project root.** From this folder, copy `.roo/` and `.roomodes` so they
   sit at the root of the repo where you run Roo Code:

   ```
   <your-repo>/
   ├── .roo/
   │   ├── mcp.json
   │   └── rules/
   │       └── 01-portal-mcp.md
   └── .roomodes
   ```

   Workspace rules (`.roo/rules/*.md`) load automatically and apply across all modes. The `.roomodes`
   file is picked up as a project-scoped custom mode.

2. **Set your MCP key.** Open `.roo/mcp.json` and replace `<YOUR_MCP_API_KEY>` with your real key.
   **Never commit the real key** — keep `.roo/mcp.json` out of version control (add it to
   `.gitignore`) or have each developer fill it in locally.

3. **(Recommended) Add the operating skill.** For the full how-to + playbook (the principle →
   exact-tool-sequence guide and the write → read verification map), also copy the shared skill from
   `agent-onboarding/shared/skills/management-portal/` (`SKILL.md` + `reference.md`) into your repo so
   the rule's "where the detail lives" pointers resolve.

4. **Reload Roo Code** (or reload the window). Confirm the `management-portal` server is connected in
   Roo's MCP panel, then switch to the **Portal Operator** mode for disciplined portal runs.

   > ⚠️ **Reload is required.** The Portal Operator mode, the workspace rule, and the MCP server register
   > when Roo / the window loads — a fresh install added to a running session is not active until you reload.

## One-click?

Roo Code's marketplace is curated/centralized — there is **no public deeplink** to one-click-install an
arbitrary remote MCP server. The **file copy above is the only path** for this server. (Heads-up: the
Roo-Code project was archived upstream in 2026-05, so its future is uncertain.)

## Connection (from `shared/mcp.config.md`)

| Field | Value |
|---|---|
| Server name | `management-portal` |
| Transport | streamable HTTP |
| URL | `https://client-management-api-1uk1.onrender.com/mcp` |
| Auth | header `X-API-Key: <YOUR_MCP_API_KEY>` |

## Notes

- This bundle is generated from the shared portable core. If behavior must change, change
  `agent-onboarding/DISCIPLINE.md` first, then regenerate the adapters so they never drift.
- The rule and mode are condensations of `shared/AGENTS.md`; the canonical operating how-to is the
  `management-portal` skill and its `reference.md`.
