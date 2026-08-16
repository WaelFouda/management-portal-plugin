---
description: Re-arm canon gates that were stood down — the way back from the escape hatch, and a check on what is silently off.
argument-hint: "[gate id or 'all']  (empty means all)"
---

Put the canon gates back. This is the counterpart to `/portal-stand-down`, and it exists because for a
long time there was no way back at all.

## 0. The argument — optional, and empty is the normal case

```
raw       = $ARGUMENTS
positional cross-check:  $0
```

**`$​ARGUMENTS` is authoritative.** Its first value is a gate id, or `all`. **Measured: the positional
variables on this build are 0-indexed** — `$​0` is the FIRST argument — and a positional with no argument
behind it renders as the literal text `$​1`. Cross-check only; `$​ARGUMENTS` wins.

- **No argument** → re-arm **`all`**. Someone typing this usually wants "put everything back", and a
  command that interrogates you before restoring a safety control has the incentives backwards.
- **A literal placeholder** — `<gate>`, `[gate id]`, `$​1` — is an ABSENT argument. Treat it as `all`,
  say so in one line, and never pass it to the CLI.
- **A gate id you do not recognise** → run it anyway. The CLI answers by listing what is actually stood
  down, which is more useful than a spelling lecture.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" re-arm --gate "<GATE>"
```

`<GATE>` is the value from §0, typed literally — never a `$​1`. Use `--gate all` when nothing was named.

If the path does not resolve, use the absolute `CANON_GATE_PATH` from this session's canon card
(`[portal-canon v1 · alive · token …]`). If there is no canon card, no gates are running here and there
is nothing to re-arm — say that and carry on.

## 2. Read the output back to the owner, in full

The command answers in one of four ways, and the differences matter:

| output | what it means |
|---|---|
| `re-armed <X>` + `Every gate is armed. Nothing is suppressed.` | done, and nothing is left off |
| `re-armed <X>` + **`STILL STOOD DOWN: <Y>`** | **partial.** `<Y>` is still off — say so, and offer `all` |
| `nothing matched "<X>". Currently stood down: <Y>` | the named gate was not down; `<Y>` is what is |
| `nothing was stood down — every gate is already armed` | a safe no-op |

**Never report a partial re-arm as a completed one.** A gate left silently off is the exact failure this
command exists to prevent, and the second row above is the one that is easy to skim past.

## 3. Why this is its own command

Standing a gate down was always one command. Putting it back was undocumented file surgery — the only
instruction the tooling ever gave was *"Delete that file to re-arm"*, naming a sentinel inside a plugin
data directory nobody opens by hand. Two properties turn that from an annoyance into a hole:

- **The sentinels outlive the session that wrote them.** "It will reset when I restart" is false. A
  stand-down taken this morning is still in force tomorrow, and the only trace is a line on a session
  card nobody re-reads.
- **A stand-down that was CORRECT becomes a HOLE the moment its reason expires.** Standing a gate down
  because the build was broken is right. Leaving it down after the build is fixed silently removes real
  protection — and because it is the same gate, nothing ever fires to tell you.

Measured, on the machine this was written on: two gates crossed a restart still disabled, and were only
re-armed because a note had been written specifically to remember them. That is luck, not a mechanism.

## 4. When to reach for it without being asked

- Immediately after the reason for a stand-down expires — a fixed build, a merged branch, a restart.
- At the start of a session whose canon card lists anything as `stood down`.
- Whenever you are about to claim work was verified. If a gate was off while you worked, say which one,
  and re-arm it before making the claim.

`node "<CANON_GATE_PATH>" doctor` lists every gate as `ARMED` or `stood down`, plus `CANON_HOME`, the
resolved run, and the last five blocks. Use it when you want the picture before changing anything.

## The honest limit

Re-arming restores the **enforcement**, not the verification skipped while it was off. Anything written
during a stand-down is still unverified — the gate starts asking again; it does not answer for the
window it was silent. If a write happened while a read-back gate was down, read it back yourself.
