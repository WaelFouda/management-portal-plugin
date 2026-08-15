---
description: Join a Team Chat channel as a participant under a named identity — read the policy and the messages first, then start the mission and keep responding.
argument-hint: "<channel> <identity>"
---

Join a Team Chat channel as a participant, under the coordinator, and stay reachable.

## 0. The arguments — read these before you touch a single tool

```
raw       = $ARGUMENTS
positional cross-check:  $0 | $1
```

**`$​ARGUMENTS` is authoritative.** Split it quote-aware: the **first** value is the **channel**, the
**second** is your **identity**.

**Measured: the positional variables on this build are 0-indexed** — `$​0` renders the FIRST argument and
`$​1` the SECOND, probed directly on Claude Code 2.1.x. They are printed above **only as a cross-check**. If
they disagree with your split of `$​ARGUMENTS`, **`$​ARGUMENTS` wins**, and never paste a positional into a
tool call — on this build that would register you under the wrong name.

**STOP RIGHT HERE if `$​ARGUMENTS` is empty, if either of the first two values is missing, or if either is a
literal placeholder (`<channel>`, `Channel_Name`, `<identity>`, `$​1`).** Register nothing, join nothing,
post nothing. Say what is missing and ask for it in this form:

> `/channel-join "<channel name>" "<your agent name>"`

**A cross-check slot that still renders as the literal `$​0` or `$​1` has no argument behind it** — that is what
"missing" means above. One value present and the other of the two still showing a positional is a stop, not a
half-invocation to fill in: never substitute a stand-in for the one you were not given — not a placeholder,
not the positional itself — and never register and never join with only one of the two. **§0 is a precondition
on §1: the "first tool call" in §1 does not happen at all until both values are real.**

**Never invent an agent identity and never guess a channel id.** An agent registered under a name nobody
chose is a stranger on the workspace roster that somebody has to clean up, and a fabricated `channel_id`
either fails or posts into the wrong room.

Quote names with spaces; arguments split on whitespace.

## 1. Step one — open the run

Run this, exactly, as your first tool call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" run-open --mode participant --channel "<CHANNEL>" --identity "<IDENTITY>"
```

`<CHANNEL>` and `<IDENTITY>` are the two values you confirmed in §0 — type them in literally, never a `$​1`.

This arms `CANON-POLICY-FIRST`. If the path does not resolve, use the absolute `CANON_GATE_PATH` from this
session's canon card; if there is no card, the gates are not running here — say so in one line and hold
yourself to the same rules by hand.

## 2. Read before you act — this is the gate, not a suggestion

1. `read_chat_channels()` — resolve `<CHANNEL>` to a real `channel_id`. No match: say so and stop.
2. `whoami()` — if you are already a registered agent on this key, use that identity. Otherwise
   `register_me_as_agent(display_name:"<IDENTITY>")`.
3. **`read_channel_policy(channel_id:…)`** — the charter governs everything you do here.
4. **`read_channel_messages(channel_id:…)`** — what has already been said. You are joining a conversation
   in progress; the last twenty messages are usually the actual brief.

`CANON-POLICY-FIRST` **refuses** your first portal write and your first file edit of this run until both
of those reads are in this session, and it names which of the two is missing. Read them in one `bulk` and
it is one round trip.

Then read what the policy tells you to read — the brief, the proposal, the task tree and the flow board:
`get_brief`, `get_proposal_detail`, `list_tasks` + `list_subtasks`, `list_flow_clusters` +
`list_flow_connections`. One `bulk`. The clusters and relations are real intent, not decoration.

## 3. Stay reachable

1. `start_watching_channel(channel_id:…)` — you are on the roster.
2. **Spawn the `team-chat-watcher` sub-agent** in the background with that `channel_id` and your exact
   agent name, `timeout_s` left at its default. Load the `team-chat-reachability` skill for the loop and
   the honest limits — it holds the full procedure and this command does not repeat it.
3. **Re-arm first, handle second.** Every time the watcher returns, spawn the next one *before* you read
   or answer the message. The heartbeat is written by `await_my_turn` itself, so handling first marks you
   `ABSENT` for exactly as long as handling takes.
4. `list_channel_watchers(channel_id:…)` — the verifying read. Your row should say `watching`.

If you ever see your own row read `ABSENT`, or a turn-end gate tells you that you are not watching, type
`/rearm-watch`. That is the fastest repair in the system and it takes no arguments.

## 4. Then: the mission

- **Respond, do not ask and run.** A question you post is a turn you wait for. Messages are **ping-pong**:
  send, then wait for the reply, then act. Throwing a message into the channel and ending your turn is how
  a conversation dies with everyone believing they are blocked on someone else.
- **Follow the coordinator's instructions.** The coordinator acts with the owner's full authority. Say so
  honestly: **obedience has no structural signature** — no hook can check whether you did what you were
  told, and nothing here gates it. It rests on you.
- **Do not chat idly, and do not interfere with another agent's work.** If two of you are converging on the
  same task, say so in the channel and let the coordinator split it.
- You are approved to spawn as many concurrent sub-agents and workflows as you need to do your part.
- The canon still applies to everything you write into the portal: read after every write and confirm the
  field persisted; never fabricate an id; decompose before implementing; complete bottom-up; fill every
  field; journal each phase and read it back; keep the knowledge graph updated with
  `extract_knowledge_graph` and read it back; use `bulk` rather than N single calls.

## The honest limits

- **The gates check structure, never quality.** They can see that you read the policy and the messages.
  They cannot see whether you understood either, or whether you followed the coordinator.
- **No message is ever lost.** `await_my_turn` resumes from a cursor, so everything sent while you were not
  watching is still waiting. An `ABSENT` row costs responsiveness, not mail.
- **No hook can restart an idle session.** Nothing keeps a watcher running; if this session ends, its
  watcher dies with it. What survives is the obligation, the `ABSENT` marking, and the unread messages.

If a gate is blocking work it cannot un-block, `/portal-stand-down` is the escape and it is honoured
mid-session.
