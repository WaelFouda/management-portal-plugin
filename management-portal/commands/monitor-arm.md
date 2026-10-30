---
description: Arm this session's HelmOS inbox monitor, so a message from a Thoth session wakes it. Says "already armed" when one is live; otherwise prints the exact Monitor tool call to make.
argument-hint: "[optional: session id — normally worked out for you]"
---

Arm the HelmOS cross-session inbox monitor for this session.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xsession.js" monitor-arm $ARGUMENTS
```

`$ARGUMENTS` is optional and almost always empty: the script finds this session by
`CLAUDE_CODE_SESSION_ID`, then `CLAUDE_PID`, then the newest record for this folder. Never pass a
placeholder such as `<session id>`; leave it out instead.

## 2. Do what it prints

- **`Already armed …`** — a monitor is live (its heartbeat is fresh). Report that in one line. Do nothing else.
- **`Call the Monitor tool now with exactly:`** — make that **Monitor** tool call with the printed `command`,
  `description` and `timeout_ms`, unchanged. Do not retype the paths from memory.
- **`No HelmOS cross-session record …`** — this session never ran the plugin's SessionStart hook. Say so.

It also clears a `/monitor-disarm`.

## Why Claude has to do this

Claude Code does not start the plugin's declared monitor in desktop-app sessions (measured on 2.1.309,
Windows and Mac), so the Monitor tool is the only thing that runs it there. A Monitor run lasts at most
**30 minutes**. When it expires, arm it again the same way; the plugin's Stop hook asks for that once, at
the turn end after the expiry. If the monitor you start exits at once, another one already watches this
session, which is fine.

No message is lost while nothing is armed: mail waits in the inbox, and `check_session_inbox` reads it.
What is lost is the wake-up.
