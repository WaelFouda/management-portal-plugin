# hooks/hooks.json — why it looks the way it does

This note lived inside hooks.json as a `_comment` key until 1.8.0. Claude Code 2.1.29x prints
`hooks.json: unknown key "_comment" ignored` at every session start for it, so the text moved here,
unchanged.

MATCHERS ARE A FULL MATCH ON THE TOOL NAME, and that is why every matcher here is broad.
The matcher this file used to carry — mcp__(plugin_management-portal_)?management-portal__... —
was INERT on any install whose server is named differently: the claude.ai connector registers
tools as mcp__claude_ai_management-portal__*, and a plain MCP install registers them as
mcp__<uuid>__*. Neither ever matched, so the hook looked installed and never fired.
Scoping now happens at RUNTIME in canon-gate.js against a frozen list of the 257 tool names
this server actually registers, plus — for the file and shell gates only — the SHAPE of the
call's arguments. A foreign tool is never subject to the PORTAL invariants; it is subject to
the effect gates exactly when it writes a file or runs a command, and to nothing otherwise.

PreToolUse IS NOW .* AND THAT IS THE POINT. It was Edit|Write|MultiEdit|NotebookEdit|Bash,
and stock Claude Code on Windows exposes a first-class PowerShell tool that appears in none
of those five names. Measured: the model created src/bypass.ts inside a gated project, the
run recorded permission_denials: [], and the debug log contained ZERO Hook PreToolUse entries
for it. Every name-shaped matcher this plugin has shipped turned out to have a door beside it,
so there is no longer a name list here at all: everything reaches the gate, and canon-gate.js
exits before touching the disk for anything that neither writes a file nor runs a command.

PostToolUse is deliberately .* — ids legitimately arrive via Read, Grep, Bash and other MCP
servers, and `bulk` has to be expanded into its inner calls or canon (f) blinds Gate 1.

Stop runs watch-alarm FIRST (it owns Team Chat reachability and is unchanged), then xsession `stop`
(1.9.5, the HelmOS inbox-monitor re-arm), then canon-gate, which yields silently if watch-alarm
blocked this turn or if xsession blocks it. Two gates blocking one turn is how you spend the
runtime's 9-consecutive-block budget by accident. Stop hooks may run concurrently, so canon-gate does
not wait for a file: it asks xsession's own predicate (`stopBlocks` — "it just recorded a block, or it
is about to") and steps aside on either.

To stand every gate down: node scripts/canon-gate.js stand-down --gate all --reason "..."
or set PORTAL_CANON=off. See the header of canon-gate.js.

MODULES (1.8.0; 1.9.0 adds the plan with progress bars, the gate panel, the command launcher, notifications and the idle-run nudge) are OPTIONAL EXTRAS for Claude Code >= 2.1.287: a status line, the /portal-cockpit pane,
a gate band above the prompt, cards for portal tool results and a Team Chat wake-up. An older Claude Code
ignores the key. NOTHING in the module enforces anything — a mod hook that throws fails OPEN — so every gate
stays in the command hooks below. See hooks/mods/register.tsx and the README "Mods" section.

CROSS-SESSION MESSAGING (1.9.4) adds three command hooks, all routed through scripts/xsession.js and all
fail-open (any error exits 0 with no output): SessionStart `session-start` (names the session, asks once for
register_claude_session), UserPromptSubmit `prompt` (fire-and-forget loop-guard reset) and PostToolUse
`post` on mcp__.*__(register_claude_session|bulk) (stores the inbox token, never echoes it). The wake-up
itself is not a hook: it is scripts/xsession-monitor.js.

THE MONITOR IS ARMED BY CLAUDE (1.9.5). The 1.9.4 premise — that Claude Code starts the declared
`helmos-inbox` monitor (monitors/monitors.json) by itself — is only true of an interactive CLI session.
Measured 2026-10-30 on 2.1.309: in a desktop-app session (Windows and Mac) no monitor process is ever
started. So the hooks ask Claude to start it with the Monitor tool —
`node "<root>/scripts/xsession-monitor.js" "<plugin data>" "<session id>"`, timeout_ms 1800000 — and,
because a Monitor run is capped at 30 minutes, to start it again when it expires:
  · SessionStart `session-start` adds the exact Monitor call to its registration text;
  · PostToolUse `post` adds it once the token is stored;
  · UserPromptSubmit `prompt` adds a one-line reminder, at most once per 10 minutes (<sid>.nudge);
  · Stop `stop` (new) BLOCKS ONCE with the call — at most once per 30 minutes, never when
    `stop_hook_active` is set. That is the re-arm: the expiry notice wakes the session, the turn ends,
    this asks for a new monitor.
All four stay silent while a monitor is LIVE or the session is DISARMED. Live = <sid>.monitor
{pid, t, via} names a running pid with a heartbeat under 90 s old; the monitor rewrites it every loop and
every 15 s, and a second copy for the same session exits 0 at once — so where the platform does start the
declared monitor (it stays in monitors.json), a Claude-armed duplicate ends immediately and the hooks stay
quiet. <sid>.disarmed is written by /monitor-disarm; the monitor exits on seeing it. The commands
/monitor-status, /monitor-arm, /monitor-rearm and /monitor-disarm run `xsession.js monitor-*` from Bash;
canon-gate treats those lines and the Monitor call as plumbing (xsessionPlumbing).
