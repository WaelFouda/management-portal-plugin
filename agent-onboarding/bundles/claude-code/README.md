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
| `.claude/skills/team-chat-reachability/SKILL.md` | Teaches staying reachable on a channel watch roster; the re-arm rule; the coordinator title. |
| `.claude/agents/team-chat-watcher.md` | The subagent you **spawn** — it performs the blocking `await_my_turn` wait in the background, and spawning it is what actually makes you reachable. |
| `.claude/commands/rearm-watch.md` | `/rearm-watch` — what a **human types** to join a channel and keep watching it, or to read the roster. |
| `.claude/scripts/watch-alarm.js` | The ABSENT alarm and turn-end gate. Node, no dependencies (Windows and macOS). |
| `.claude/settings.json` | Hooks: read-after-write on portal writes, the watch **recorder / join-moment** hook, the **preflight** check, and the turn-end **Stop gate**. |
| `.mcp.json` | MCP server registration for `management-portal` (set your API key). |

## Install (one screen)

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
egress cap. The script embeds no key: it resolves one from `CLAUDE_PLUGIN_OPTION_MCP_API_KEY`, then
`MCP_API_KEY` / `PORTAL_API_KEY`, then your own MCP client config, and never writes or prints it. With no
key it says it is **INERT** rather than implying you are fine.

## The discipline in one breath

You have the **tools, not the database**. Read tools (`get_*`/`list_*`) are your only source of truth and
your only way to verify. **Ground every action in what the portal contains, then leave it complete and
correct.** Run `READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE`.
Honor the three gates — **read-after-write, completeness, task-breakdown** — complete bottom-up, and
**never fabricate an id**.

> Canonical spec: `agent-onboarding/DISCIPLINE.md` and the shared core under `agent-onboarding/shared/`.
> This bundle condenses them; if they ever conflict, the canon wins.
