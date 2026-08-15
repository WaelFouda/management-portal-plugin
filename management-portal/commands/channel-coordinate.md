---
description: Join a Team Chat channel as coordinator under a named identity, claim the title, and publish the channel policy.
argument-hint: "<channel> <identity> [agent names…]"
---

Take the coordinator seat on a Team Chat channel and publish the charter the other agents will work under.

## 0. The arguments — read these before you touch a single tool

```
raw       = $ARGUMENTS
positional cross-check:  $0 | $1 | $2
```

**`$​ARGUMENTS` is authoritative.** Split it quote-aware: the **first** value is the **channel**, the
**second** is your **identity**, and every value after those is an **agent name**.

**Measured: the positional variables on this build are 0-indexed** — `$​0` renders the FIRST argument, `$​1`
the SECOND, `$​2` the THIRD, probed directly on Claude Code 2.1.x. They are printed above **only as a
cross-check**. If the cross-check disagrees with your split of `$​ARGUMENTS`, **`$​ARGUMENTS` wins**, and
never paste a positional into a tool call — on this build that would claim the coordinator title under
somebody else's name.

**STOP RIGHT HERE if `$​ARGUMENTS` is empty, if either of the first two values is missing, or if either is a
literal placeholder (`<channel>`, `Channel_Name`, `<identity>`, `$​1`).** Register nothing, claim nothing,
post nothing. Say what is missing and ask for it in this form:

> `/channel-coordinate "<channel name>" "<your agent name>" [agent names…]`

**A cross-check slot that still renders as the literal `$​0` or `$​1` has no argument behind it** — that is what
"missing" means above. One value present and the other of the two still showing a positional is a stop, not a
half-invocation to fill in: never substitute a stand-in for the one you were not given — not a placeholder,
not the positional itself — and never register and never claim the title with only one of the two. **§0 is a
precondition on §1: the "first tool call" in §1 does not happen at all until both values are real.**

**Never invent an agent identity and never guess a channel.** A claimed coordinator title is first-come and
cannot be taken over: claim it under the wrong name and the only recovery is a manual transfer from a
session that may already be gone. Registering an agent nobody named puts a stranger on the workspace
roster.

**Agent names are optional** — with none, you publish the policy and require nothing of anyone yet.

Quote names with spaces; arguments split on whitespace.

## 1. Step one — open the run

Run this, exactly, as your first tool call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/canon-gate.js" run-open --mode coordinator --channel "<CHANNEL>" --identity "<IDENTITY>"
```

This is what arms `CANON-COORD-ROLE` (§5). If the path does not resolve, use the absolute
`CANON_GATE_PATH` from this session's canon card; if there is no card, the gates are not running here —
say so in one line and hold yourself to the same rules by hand.

## 2. Join, in this order — the order is the point

1. `read_chat_channels()` — resolve `<CHANNEL>` to a real `channel_id`. **If no channel matches, say so and stop.
   Never fabricate a channel id.**
2. `whoami()` — are you already a registered agent on this key? If yes, use that identity.
   If not, `register_me_as_agent(display_name:"<IDENTITY>")`.
3. `start_watching_channel(channel_id:…)` — you are on the roster.
4. **Spawn the `team-chat-watcher` sub-agent** in the background with that `channel_id` and your exact
   agent name, `timeout_s` left at its default. Load the `team-chat-reachability` skill for the loop, the
   re-arm-first rule and the honest limits — it holds the full procedure and this command does not repeat
   it. Nothing else in this list makes you reachable; this step does.
5. `claim_coordinator_title(channel_id:…, title:"<IDENTITY>")` — **before any worker joins.** Claiming is
   first-come; a second claim fails rather than taking over. The token comes back **once**: keep it in
   context, pass it to every coordinator call, and **never post it into the channel**. Announce the
   *title*, never the token. If `list_channel_watchers` already shows a coordinator, do not try to claim —
   report who holds it.
6. `set_channel_policy(channel_id:…, content_markdown:"…")` — the charter, §3 below.
7. `require_channel_watch(channel_id:…, agent_names:[<the names after the first two>],
   coordinator_token:"…")` — one per named agent.
8. `read_channel_policy(channel_id:…)` and `list_channel_watchers(channel_id:…)` — the verifying reads.
   Report the roster as a table: name, status, minutes since last heartbeat, who holds the title.

You are not exempt from step 4 because you are the coordinator. Re-arm your own watcher too, and do it
before you rule on anyone else's.

## 3. The policy — nine sections, all nine present

Write it as `content_markdown` with these nine headings, in this order. Fill every one against the real
project; a heading with nothing under it is worse than no heading.

```markdown
# <channel> — channel policy

## 1. What this channel is for
<the one job this channel exists to do>

## 2. How this channel is used
<when to post, what belongs here and what belongs in a DM, how to address someone —
 [@TeamMember:Name:<uuid>] — and how to reply>

## 3. Participants and roles
<every agent by name, and the one thing each of them is responsible for>

## 4. Project scope
<what is in scope and what is explicitly out, plus the project mention:
 [@Project:<project name>:<project uuid>]>

## 5. Read before you act
Read the brief, the proposal, the task tree and the flow board before your first write:
get_brief, get_proposal_detail, list_tasks + list_subtasks, list_flow_clusters + list_flow_connections.
The flow board's clusters and relations are real intent, not decoration.

## 6. Follow the canon strictly
Read after every write and confirm the field persisted — a success string is not a data effect.
Never fabricate an id; read it from a list_*/get_* or a create_* response.
Decompose into tasks, subtasks and nested subtasks, with the flow board, before implementing.
Complete bottom-up: every child verified done before the parent.
Fill every field — objective, description, diagrams, deliverables, acceptance criteria,
disclaimers, timeline, time estimate, cost. Empty fields are not done.
Journal each phase into the run-log folder and read it back. Keep the knowledge graph
updated with extract_knowledge_graph and read it back. Use `bulk` instead of N single calls.

## 7. Each agent's tasks
<by name: the tasks that agent owns, with the portal task ids they map to>

## 8. Conduct
Do not chat idly. Do not interfere with another agent's work.
Follow the coordinator, who acts with the owner's full authority.
You are approved to spawn as many concurrent sub-agents and workflows as you need.

## 9. Messages are PING-PONG
An agent that sends a message WAITS for the reply. Do not throw a message and run.
Stay watching the channel and respond; re-arm your watcher before you handle what it returned.
```

**What can be checked and what cannot:** the check is *"the nine headings are present"*. That is all a
structural check can ever be. **No hook can tell whether a policy is any good** — nine empty headings would
pass. Treat the template as a completeness prompt, never as verification, and read what you wrote.

## 4. Then: coordinate

- Keep the watcher re-armed. Every time it returns, spawn the next one **first**, then read and answer.
- Give each named agent its tasks, by portal task id, and check the roster rather than assuming presence.
  `ABSENT` means an agent stopped watching. No message is ever lost — `await_my_turn` resumes from a
  cursor — but responsiveness is, and an absent row may or may not recover on its own.
- `release_channel_watch(channel_id, agent_names, coordinator_token)` when an agent's work is done. There
  is no self-release.
- Before you finish a session others depend on, `transfer_coordinator_title` — or say plainly that the
  token will be lost and recovery becomes a manual database action.

## 5. Your own rule: counsel and coordinate only

**You do not implement.** You read, you decide, you instruct, you verify, you unblock. The work is done by
the participants.

`CANON-COORD-ROLE` enforces this while this run is in coordinator mode: it **refuses** your `Write`,
`Edit`, `MultiEdit`, `NotebookEdit` and mutating `Bash` calls. When it refuses, the answer is not to find a
way around it — it is to hand that work to a participant. Delegation is the coordinator's mode of work,
not a workaround for it.

You have the owner's full authority on this channel. Use it to direct, not to do.

## The honest limits

- **The gates check structure, never quality.** Nine headings present is structure. A good policy is not.
  Whether an agent actually *followed* your instructions has no structural signature at all and is not
  gated by anything.
- **No hook can restart an idle session** — not yours, not a participant's. The watcher loop and the
  turn-end gate shorten the gap; they do not close it. That is why the roster is worth reading.

If a gate is blocking work it cannot un-block, `/portal-stand-down` is the escape and it is honoured
mid-session. The stand-down command itself is always allowed, even while `CANON-COORD-ROLE` is refusing
everything else — a gate that could block its own escape would be a trap.
