# management-portal — Claude Code bundle

Drop-in onboarding for operating the **management-portal MCP** from Claude Code, with the agent discipline
baked in. Copy these files into your repo root and set your key.

## What's in the bundle

| File | Purpose |
|---|---|
| `CLAUDE.md` | Short repo memory — points at the skill + states the condensed operating contract. |
| `.claude/skills/management-portal/SKILL.md` | The `management-portal` skill — triggers on any portal work. |
| `.claude/skills/management-portal/reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `.claude/agents/portal-operator.md` | Subagent that operates the portal under the discipline (portal tools only). |
| `.claude/commands/portal.md` | `/portal` slash command — dispatches the `portal-operator` subagent. |
| `.claude/settings.json` | PreToolUse/PostToolUse hooks that reinforce read-after-write on portal writes. |
| `.mcp.json` | MCP server registration for `management-portal` (set your API key). |

## Install (one screen)

1. **Copy** the bundle contents into your repo **root**, preserving paths:

   ```
   CLAUDE.md
   .mcp.json
   .claude/settings.json
   .claude/skills/management-portal/SKILL.md
   .claude/skills/management-portal/reference.md
   .claude/agents/portal-operator.md
   .claude/commands/portal.md
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

## The discipline in one breath

You have the **tools, not the database**. Read tools (`get_*`/`list_*`) are your only source of truth and
your only way to verify. **Ground every action in what the portal contains, then leave it complete and
correct.** Run `READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE`.
Honor the three gates — **read-after-write, completeness, task-breakdown** — complete bottom-up, and
**never fabricate an id**.

> Canonical spec: `agent-onboarding/DISCIPLINE.md` and the shared core under `agent-onboarding/shared/`.
> This bundle condenses them; if they ever conflict, the canon wins.
