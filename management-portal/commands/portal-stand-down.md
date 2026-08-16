---
description: Stand the portal canon gates down for this session or run when one of them is blocking work it cannot un-block.
argument-hint: "[gate id or 'all'] [reason]"
---

Stand the canon gates down. This is the escape hatch, and it is honoured mid-session.

## 0. The arguments — both optional, on purpose

```
raw       = $ARGUMENTS
positional cross-check:  $0 | $1
```

**`$​ARGUMENTS` is authoritative.** Its **first** value is the gate id (or `all`); everything after it is the
reason. **Measured: the positional variables on this build are 0-indexed** — `$​0` is the FIRST argument, `$​1`
the SECOND — so `$​1` here is the first word of the *reason*, not the gate. Cross-check only; `$​ARGUMENTS`
wins.

**This command inverts the usual rule about missing arguments.** Everywhere else in this plugin, a missing
argument stops the work loudly. Here it must not: whoever types this is already stuck, and an escape hatch
that interrogates you is not an escape hatch.

- **No gate given** → stand down **`all`**. The person typing this is blocked and does not necessarily know
  which gate did it.
- **No reason given** → write one from what just happened ("CANON-READ-BACK blocked twice on a create that
  the portal reports as failed"). Never leave it empty; the reason is the only record of why the discipline
  was suspended.
- **A gate id you do not recognise** → say so, print the list in §2, and stand down `all` rather than
  nothing. Refusing to help here is the failure mode this command exists to prevent.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" stand-down --gate "<GATE>" --reason "<REASON>"
```

`<GATE>` and `<REASON>` are the values from §0, typed in literally — never a `$​1`. Use `--gate all` when no
gate was named. Add `--run <run_id>` to scope it to one run instead of everywhere; the run id is on the
canon card at the top of the session. Nothing parses the reason, so write a sentence rather than a token.

This writes a sentinel file. **Every gate re-reads the sentinels on every single invocation**, which is
what makes this work in the middle of a session — unlike the environment variable in §3, which is fixed
for the session's life.

This exact invocation is **always allowed**, including while `CANON-COORD-ROLE` is refusing every other
`Bash` call. A gate that could block its own escape would be a trap, so that exemption is hard-coded.

If the path does not resolve, use the absolute `CANON_GATE_PATH` printed on this session's canon card
(`[portal-canon v1 · alive · token …]`). If there is no canon card, no gates are running in this session
and there is nothing to stand down — say that and carry on.

## 2. The gate ids

**Refuse a tool call before it runs (PreToolUse):**

| id | what it refuses |
|---|---|
| `CANON-ID` | a portal write carrying a uuid this session has never seen in a tool result or a message |
| `CANON-BOTTOM-UP` | completing a parent task whose children were never listed, or are listed and unfinished |
| `CANON-COORD-ROLE` | the coordinator's own `Write`/`Edit`/`MultiEdit`/mutating `Bash` |
| `CANON-POLICY-FIRST` | a participant's first write before it read the channel policy and the messages |
| `CANON-JOURNAL-PHASE` | the first write after a phase boundary with no journal entry, or no read-back |
| `CANON-KG-DESTRUCTIVE` | `regenerate_knowledge_graph` inside a run — it destroys the nodes and edges first |
| `CANON-TREE-FIRST` | implementation edits before tasks + subtasks + a flow cluster + a connection exist |
| `CANON-BOARD-FIRST` | a brief/proposal/phase/task while the run is in ALIGN and no alignment board exists |

**Compel an action after the call, or at turn end (PostToolUse / Stop):**

| id | what it blocks on |
|---|---|
| `CANON-READ-BACK` | a write with no read-back yet — names the exact `bulk` read that clears it |
| `CANON-READ-BACK-STOP` | the same, at turn end, listing what is still unverified |
| `CANON-ACCOUNT` | ending a turn silently while phases remain — clears by continuing, or by a `blocked` journal entry |
| `CANON-CLOSEOUT` | finishing a run without the summary board, the graph closure, or the final journal |

**Report only, never refuse or block:** `CANON-COMPLETE` (empty required fields), `CANON-BULK` (single
calls that should have been one `bulk`), `CANON-STATUS` (a milestone whose tasks are all done but whose
status is not). Standing these down is harmless and pointless — they only ever print.

Use `all` when you do not know which one it was.

## 3. The other two escapes

**Environment** — `PORTAL_CANON=off` silences everything; `PORTAL_CANON=advisory` leaves the gates
reporting but stops them refusing and blocking. Both are **fixed when the session starts**, so they are the
right tool for "I never want gates in this repo" and the wrong tool for "this gate is blocking me right
now". That is why §1 writes a file.

**Close the run** — `node "<CANON_GATE_PATH>" run-close --run <run_id>`. If the gates are firing because a
session died mid-run and left a stale `RUN` manifest, closing the run is the honest fix and a stand-down is
the blunt one. A run with no recorded progress for 24 hours closes itself.

**A destructive knowledge-graph rebuild** is a narrower case with a narrower authorisation. If the owner
genuinely asked for a rebuild, do not stand `CANON-KG-DESTRUCTIVE` down — run
`node "<CANON_GATE_PATH>" doctor` to print `CANON_HOME`, then create the file
`canon/ALLOW-KG-REGEN-<run_id>` there. It authorises exactly the one thing and leaves every other gate up.

## 4. Afterwards

- **Say in your answer that you stood a gate down, which one, and why.** A suspended discipline that nobody
  is told about is worse than no discipline — the owner will read the result believing it was verified.
- Gates resume when the sentinel file is deleted, or when the run closes. Nothing expires it for you.
- `node "<CANON_GATE_PATH>" doctor` prints `CANON_HOME`, the resolved run, which gates are armed and which
  are stood down, and the last five blocks. It is how you check whether a stand-down from an earlier
  session is still in force.
- Some gates stand themselves down without being asked: each has a per-run block budget, and a gate that
  blocks twice with no tool call in between is treated as stuck. When that happens the canon card says so.
- **From 1.6.1 that budget is refunded by progress.** It used to be per-run and monotonic — three blocks
  and the gate was a notice for the rest of the run, however long the run lasted and however much work
  landed after. On a day-long run `CANON-ACCOUNT` was silent by mid-morning and never came back, so the
  owner became the mechanism that kept the run moving. Delivering or approving a milestone, or completing
  a phase, now resets every gate's counter. A genuinely stuck run still exhausts its three and cannot be
  trapped; a run that is visibly moving keeps its net.

## The honest limit

Standing a gate down removes the enforcement, not the canon. Read after every write anyway. Journal the
phase anyway. The gates were only ever the part of the discipline that could be checked by a machine.
