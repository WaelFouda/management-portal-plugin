---
description: Show whether this session is registered for HelmOS cross-session messages and whether its inbox monitor is live, stale or disarmed. Changes nothing.
argument-hint: "[optional: session id — normally worked out for you]"
---

Report the HelmOS inbox monitor for this session.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xsession.js" monitor-status $ARGUMENTS
```

`$ARGUMENTS` is optional and almost always empty. Never pass a placeholder; leave it out instead.

Read the output back as it stands:

| line | meaning |
|---|---|
| `registered: yes` | `register_claude_session` stored an inbox token. The token itself is never shown. |
| `registered: no` | not registered yet. The SessionStart hook asks for it; mail cannot be addressed here until then. |
| `monitor: live — pid N, heartbeat Ns ago` | a monitor is watching. A Thoth message will wake this session. |
| `monitor: not running` | nothing will wake this session. `/monitor-arm` fixes it. |
| `… (stale lock …)` | a monitor ended without cleaning up, or stopped beating. `/monitor-rearm` replaces it. |
| `disarmed: yes` | `/monitor-disarm` is in force, and the hooks will not ask. `/monitor-arm` clears it. |

This command only reads. It never starts or stops anything.
