---
description: Turn off this session's HelmOS inbox monitor and stop the plugin asking to arm it, until /monitor-arm.
argument-hint: "[optional: session id — normally worked out for you]"
---

Disarm the HelmOS cross-session inbox monitor for this session.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xsession.js" monitor-disarm $ARGUMENTS
```

`$ARGUMENTS` is optional and almost always empty. Never pass a placeholder; leave it out instead.

## 2. Then

- If this session has a **Monitor** task running `xsession-monitor.js`, stop it with **TaskStop**. The
  script has already stopped the process; a monitor it could not reach exits within 15 seconds once it
  sees the disarm flag.
- Report what the script printed, in one or two lines.

While disarmed, no hook asks for the monitor: not SessionStart, not the token capture, not the prompt
reminder, and not the Stop re-arm. `/monitor-arm` undoes this.

Disarming costs the wake-up, not the mail. Messages from Thoth sessions still wait in the inbox, and
`check_session_inbox` reads them whenever you call it.
