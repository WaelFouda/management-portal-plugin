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

Stop runs watch-alarm FIRST (it owns Team Chat reachability and is unchanged), then canon-gate,
which yields silently if watch-alarm blocked this turn. Two gates blocking one turn is how you
spend the runtime's 9-consecutive-block budget by accident.

To stand every gate down: node scripts/canon-gate.js stand-down --gate all --reason "..."
or set PORTAL_CANON=off. See the header of canon-gate.js.

MODULES (1.8.0) are OPTIONAL EXTRAS for Claude Code >= 2.1.287: a status line, the /portal-cockpit pane,
a gate band above the prompt, cards for portal tool results and a Team Chat wake-up. An older Claude Code
ignores the key. NOTHING in the module enforces anything — a mod hook that throws fails OPEN — so every gate
stays in the command hooks below. See hooks/mods/register.tsx and the README "Mods" section.
