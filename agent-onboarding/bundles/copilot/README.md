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
| `.github/hooks/portal-watch-rearm.json` | PostToolUse hook firing as `await_my_turn` returns — the re-arm reminder. **Not** a turn-end gate; see below. |
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

## Team Chat watch: what Copilot gets, and what it does not

**This is a latency problem, not a delivery problem.** Messages are never lost — `await_my_turn` resumes
from its cursor and hands the agent everything that arrived while it was not looking. An agent that stops
watching loses **responsiveness**, not mail. Nothing below rescues a dropped message, because none is
dropped; the failure is that nobody is *told* an agent went quiet.

**What Copilot gets.** The full MCP roster — `start_watching_channel`, `list_channel_watchers`,
`require_channel_watch` / `release_channel_watch` — because that is server-side and works from any MCP
client. Plus the discipline in prose: `.github/copilot-instructions.md` carries the staying-reachable
contract, and you can copy `agent-onboarding/shared/skills/team-chat-reachability/` into `.github/skills/`
for the full procedure. Copilot's hook support is real but **partial**: `.github/hooks/*.json` handles
**`PreToolUse` and `PostToolUse` only**. The bundle uses what that allows —
`.github/hooks/portal-watch-rearm.json` fires on the way out of every `await_my_turn`, which is
exactly the moment the re-arm decision is made and exactly the moment it gets forgotten. Be clear about
what that is: a **reminder inside the tool path**. Its message is deliberately static, because with no
turn-end event there is nothing to hang a roster lookup on — so it needs no script, no key, and no
network.

**What Copilot does not get: the turn-end gate.** There is **no `Stop` equivalent** in Copilot's hook
model, so the ABSENT alarm that Claude Code runs at turn end — which there does not merely warn but returns
`decision: block` and holds the turn open until the watcher is spawned — cannot be ported here, and the
`watch-alarm.js` script has nothing to run it. Concretely: **nothing on Copilot will interrupt
an agent that has stopped watching, and nothing here can hold a turn open.** The `PostToolUse` re-arm reminder narrows the window that produces
that state, but it cannot rescue you from it — it fires only while you are still calling `await_my_turn`,
and the failure case is precisely an agent that has stopped calling it.

**The fallback, and it is the real one.** The human runs the roster check
(`list_channel_watchers(channel_id)`) and the coordinator reads the roster on their own cadence; the agent
is told, in `copilot-instructions.md`, to verify its own watch with `list_channel_watchers` rather than
assume. There is no automatic backstop here. Full per-adapter matrix and limits:
`agent-onboarding/WATCH-LAYERS.md`.

**Never forge a heartbeat.** A heartbeat means "this agent performed the blocking wait", and only
`await_my_turn` writes one. No hook, script, or reminder may write one — a forged heartbeat shows liveness
for an agent that is not listening, which is the exact defect this system exists to remove.

## An open question about these hooks — please verify before relying on them

Both hook files here emit their reminder with `echo … 1>&2`. On **Claude Code** that pattern was measured
and found to be **inert**: plain stdout from a `PreToolUse`, `PostToolUse` or `Stop` hook is discarded and
never reaches the model, so the hook fires, exits 0, and the agent sees nothing. The Claude Code bundle and
the plugin were rewritten to emit `hookSpecificOutput.additionalContext` instead, which was verified to
arrive.

**That measurement is about Claude Code, not Copilot.** Copilot is a different runtime and these hooks were
**not** tested here — which is why they have been left exactly as they are rather than "fixed" to match a
harness they do not run on. Changing them blind could break a pattern that currently works.

So treat this as an open item, not a defect: **confirm that the text of a `.github/hooks` command actually
reaches the model in your Copilot version.** The cheap test is to put a distinctive marker in the message
and see whether the agent can repeat it back. If it cannot, these reminders are decoration, and the honest
fallback is the one described above — a human reads the roster, and you verify your own watch with
`list_channel_watchers`.

## Notes

- **Connection params** come from `agent-onboarding/shared/mcp.config.md`; URL, header name, and server
  name are identical across every platform bundle.
- **Canonical behavior** lives in `agent-onboarding/DISCIPLINE.md` (v1.0.0). Change behavior there first,
  then regenerate this bundle — never edit the adapter to diverge from canon.
