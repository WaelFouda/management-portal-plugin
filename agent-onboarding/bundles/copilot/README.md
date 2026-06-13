# Management-Portal Operator — VS Code GitHub Copilot bundle

Installable Copilot bundle that teaches Copilot (and any agent honoring `.github/*` / `CLAUDE.md`) to
operate the **management-portal MCP** under the shared agent discipline. It wires up the full 2026 Copilot
agent stack — custom agent, skill, prompt file, hook, and MCP registration — from one canonical source
(`agent-onboarding/DISCIPLINE.md`).

## What's in the bundle

| File | Purpose |
|---|---|
| `.github/copilot-instructions.md` | Repo-wide operating contract (condensed discipline); points to the skill. |
| `.github/skills/management-portal/SKILL.md` | The operable how-to; triggers on any portal work. |
| `.github/skills/management-portal/reference.md` | Full discipline, principle→tool playbook, write→read map, board-first. |
| `.github/agents/portal-operator.agent.md` | The `portal-operator` custom agent (MCP tools scoped). |
| `.github/prompts/portal.prompt.md` | The `/portal` prompt file that engages the portal-operator agent. |
| `.github/hooks/portal-read-after-write.json` | Pre/PostToolUse hook reinforcing read-after-write (Gate 1). |
| `.vscode/mcp.json` | management-portal MCP registration (VS Code `servers` key). |
| `plugin.json` | Agent-plugin manifest bundling the above for distribution. |

## Install (one screen)

1. **Copy the bundle into your repo root**, preserving paths — so you end up with `.github/…`,
   `.vscode/mcp.json`, and `plugin.json` at the repository root (Copilot reads them from there).
   ```sh
   cp -r agent-onboarding/bundles/copilot/. <your-repo-root>/
   ```
2. **Set your MCP API key.** Open `.vscode/mcp.json` and replace `<YOUR_MCP_API_KEY>` with your real key.
   **Never commit the real key** — prefer VS Code's secret prompt: change the header to
   `"X-API-Key": "${input:mcp_api_key}"` and add an `inputs` entry (`type: "promptString"`, `password: true`),
   or inject it from your environment / secret store.
3. **Reload VS Code** so Copilot picks up `.github/copilot-instructions.md`, the skill, the agent, the
   prompt, and the hook, and connects the `management-portal` MCP server from `.vscode/mcp.json`.

   > ⚠️ **Reload is required** (Command Palette → *Developer: Reload Window*). The custom agent, skill,
   > prompt file, and hooks register only when the window loads — a fresh install is not picked up by a
   > running session until you reload.
4. **Use it.** Run **`/portal <your request>`** in Copilot Chat to engage the `portal-operator` agent, or
   just start working — `copilot-instructions.md` + the `management-portal` skill apply automatically on any
   portal entity.

## One-click (MCP server only)

Open this link to install the server in VS Code in one click:

```
vscode:mcp/install?%7B%22name%22%3A%22management-portal%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fclient-management-api-1uk1.onrender.com%2Fmcp%22%2C%22headers%22%3A%7B%22X-API-Key%22%3A%22%3CYOUR_MCP_API_KEY%3E%22%7D%7D
```

This installs the **MCP server only**. The `.github/*` agent, skill, prompt, and hook stack remains a file
copy — there is no VS Code marketplace that consumes them, and `plugin.json` here is a bundling manifest
(Claude-Code plugin schema), not a Copilot registry artifact.

## Verify

- The `management-portal` server shows **Connected** in the MCP view and its tools are listed.
- Copilot Chat lists the **`portal-operator`** agent and the **`/portal`** prompt.
- A write tool followed by a missing read triggers the read-after-write reminder from the hook.

## Notes

- **Connection params** come from `agent-onboarding/shared/mcp.config.md`; URL, header name, and server
  name are identical across every platform bundle.
- **Canonical behavior** lives in `agent-onboarding/DISCIPLINE.md` (v1.0.0). Change behavior there first,
  then regenerate this bundle — never edit the adapter to diverge from canon.
