---
description: Restart this session's HelmOS inbox monitor — stop the running one (if any), then print the exact Monitor tool call to start a fresh one.
argument-hint: "[optional: session id — normally worked out for you]"
---

Restart the HelmOS cross-session inbox monitor for this session. Use it when the monitor looks stuck,
after a plugin update, or when `/monitor-status` shows a stale lock.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/xsession.js" monitor-rearm $ARGUMENTS
```

`$ARGUMENTS` is optional and almost always empty. Never pass a placeholder; leave it out instead.

## 2. Do what it prints

1. It reports whether it stopped a live monitor (and its pid), clears any `/monitor-disarm`, and removes
   the lock.
2. If this session has a **Monitor** task still running `xsession-monitor.js`, stop it with **TaskStop**.
   The script has already ended the process; this clears the task.
3. Then make the **Monitor** tool call it prints, with the printed `command`, `description` and
   `timeout_ms` unchanged.

Only a monitor with a **fresh** heartbeat is killed. A stale lock's pid may belong to an unrelated process
by now, so the script only removes that lock.
