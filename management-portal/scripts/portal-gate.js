#!/usr/bin/env node
/**
 * portal-gate.js — the read-after-write discipline reminders, in a form the model
 * actually receives.
 *
 * WHY THIS FILE EXISTS.
 * These two messages used to be inline `echo "..."` commands in the hook config. They
 * fired correctly and the model never saw a word of them. Measured on Claude Code
 * 2.1.222 (Windows): plain stdout from a hook is DISCARDED for `PreToolUse`,
 * `PostToolUse` and `Stop` alike — the hook runs, exits 0, and its stdout goes
 * nowhere near the conversation. Only `hookSpecificOutput.additionalContext` (or, for
 * Stop, `decision: block`) reaches the model.
 *
 * So Gate 1 and Gate 3 have been enforced by a hook that looked installed and did
 * nothing. That is the same failure mode this whole watch effort exists to prevent,
 * which is why it is fixed here rather than left for later.
 *
 * NOTE FOR NON-CLAUDE-CODE ADAPTERS: this measurement is about Claude Code. The
 * copilot bundle's hooks use `1>&2` under a different runtime and were not tested
 * here — do not assume this finding transfers to them.
 */

'use strict';

const MESSAGES = {
  pre:
    '[management-portal] WRITE about to run. Gate 1 (read-after-write): immediately '
    + 'after this, call the matching get_*/list_* tool and confirm the field actually '
    + 'persisted — trust the data effect, not the success string. Gate 3: do not write '
    + 'implementation entities before the task/subtask tree + flow board exist. Never '
    + 'fabricate an id — read it from a list_*/get_* or a create_* response.',
  post:
    '[management-portal] WRITE returned. READ-AFTER-WRITE NOW: call the matching '
    + 'get_*/list_* read tool and confirm the specific field you wrote is present and '
    + 'correct before moving on. A success message is not evidence. The edge of a flow '
    + 'connection may have landed even if the call reported a timeout.',
};

const EVENTS = { pre: 'PreToolUse', post: 'PostToolUse' };

const mode = process.argv[2];

// Drain stdin so the runtime never blocks on us, then answer.
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  const text = MESSAGES[mode];
  if (text) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: EVENTS[mode], additionalContext: text },
    }));
  }
  process.exit(0);
};

setTimeout(finish, 2000).unref?.();
process.stdin.on('data', () => {});
process.stdin.on('end', finish);
process.stdin.on('error', finish);
