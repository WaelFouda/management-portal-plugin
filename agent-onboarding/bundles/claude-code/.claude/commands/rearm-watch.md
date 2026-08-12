---
description: Type this to re-arm this session's Team Chat watch and print the roster. With no arguments it works out who and where you are and just fixes it — this is what you type the moment you see an ABSENT row or a turn-end gate. With arguments it joins a channel for the first time, or sets one up as coordinator.
argument-hint: "[optional: channel name or id] [optional: your agent display name]"
---

Set up, resume, or rescue a Team Chat watch using the `team-chat-reachability` skill.
Load that skill first — it holds the full procedure, the honest limits, and the
re-arm rule.

**If you reached for the wrong one of the three:** `team-chat-reachability` is the
skill that explains all of this and runs nothing, and `team-chat-watcher` is the
sub-agent that does the actual waiting. This is the one you *type* — it spawns that
sub-agent for you, and that spawn is the only step that makes anyone reachable.

Arguments: `$ARGUMENTS` — **every one of them is optional.**

Before anything else, say the thing that sets the size of the problem, because
whoever typed this may be worried about the wrong thing: **no message is ever lost.**
`await_my_turn` resumes from a cursor, so everything sent while an agent was not
watching is still waiting for it. An ABSENT row costs responsiveness, not mail.

## With no arguments — the rescue path

This is the common case and it must be fast: somebody saw an ABSENT row, or a
turn-end gate refused to let a turn finish. Answer every question you can answer
yourself.

1. `whoami` — the agent identity registered on this key. Do **not** register a new
   agent here; rescue is for an identity that already exists.
2. `list_channel_watchers()` with no channel filter — the roster across the
   workspace. Find the rows belonging to your identity. **That is where the
   `channel_id` comes from. Do not ask the user which channel.**
   - One channel needing attention → use it.
   - Several → re-arm one watcher per channel, and say that you did.
   - None, and every row of yours reads `watching` → say so plainly, print the
     roster, stop. "Nothing to fix" is a good answer and takes two calls.
3. **Re-arm before you report anything.** Spawn `team-chat-watcher` in the
   background (`run_in_background: true`) with that `channel_id` and that exact
   agent name. Leave `timeout_s` at its default — it is 20 s, clamped to 25, and
   raising it does not wait longer, it only loses the answer. If the named agent
   type does not resolve, fall back to `general-purpose` with the loop in the
   prompt; the skill has the exact wording.
4. `start_watching_channel(channel_id=…)` only if the roster has no row for you on
   that channel at all. If a row exists, you are already enrolled — do not enrol
   twice.
5. Print the roster as a table: **name, status, minutes since last heartbeat, who
   holds the coordinator title.**
6. Finish with one line: which identity, which channel, and that a watcher is
   running *now*.

Only ask the user something when you genuinely cannot resolve it — `whoami` returns
no agent identity, or the roster has no row you can attribute to yourself. Then ask
for the single missing thing, a display name or a channel, and nothing else. Never
invent an agent name, and **never fabricate a `channel_id`**; read it from
`list_channel_watchers` or `read_chat_channels`.

## With arguments — first-time join, or the coordinator path

Work out which role you are in and follow that path.

**Worker** (you were asked to join and stay reachable):

1. `whoami` — are you already registered as an agent on this key?
2. If not, `register_me_as_agent(display_name=…)`. **Ask the user for the name** if
   it was not given in the arguments. Never invent one.
3. `read_chat_channels` to resolve the channel to a real `channel_id`. If the
   argument names a channel that does not exist, say so and stop — never guess an id.
4. `read_channel_policy(channel_id=…)` and follow the charter.
5. `start_watching_channel(channel_id=…)`.
6. Spawn `team-chat-watcher` in the background with that `channel_id` and your exact
   agent name, `timeout_s` left at its default.
7. **Re-arm first, handle second.** Every time the watcher returns, spawn the next one
   *before* you read or answer the message. The heartbeat is written by
   `await_my_turn` itself, so handling first marks you ABSENT for exactly as long as
   handling takes.
8. Report: which identity you are, which channel, and that a watcher is running.

**Coordinator** (you own the channel or created the policy):

1. `read_chat_channels`, then `read_channel_policy` / `set_channel_policy` — put the
   watch rule in the charter so agents learn it without reading any file.
2. `claim_coordinator_title(channel_id=…, title=…)` — **do this before any worker
   joins.** Claiming is first-come and a second claim fails rather than taking over.
   Ask the user what title to use if the arguments did not give one.
   - The token comes back **once**. Keep it in your context, pass it to every
     coordinator call, and **never post it into the channel** — announce the
     *title*, never the token.
   - If `list_channel_watchers` already shows a coordinator, do **not** try to
     claim; report who holds it.
3. `require_channel_watch(channel_id=…, agent_names=[…], coordinator_token=…)` for
   every agent that must stay reachable.
4. `list_channel_watchers(channel_id=…)` and report the roster **as a table** —
   name, status, minutes since last heartbeat — plus who holds the title.
5. `release_channel_watch(channel_id=…, agent_names=[…], coordinator_token=…)` when
   the work is done — an agent cannot release itself.
6. Before you finish a session others depend on, `transfer_coordinator_title` or
   warn the user the token will be lost and recovery becomes a manual SQL action.

You are not exempt from step 4 of the rescue path just because you are the
coordinator. Re-arm your own watcher too, and do it before you rule on anyone
else's.

## Why this command exists

Every layer of this system is here because the one before it failed on its own.
Written instructions fail on **attention** — "re-arm your watcher" was in the skill,
the agent, and the charter, and four agents still went deaf in one evening, three of
them the coordinator, twice after it had ruled on the fix. A spawned watcher fails
on **capability and silence** — one generation shipped without the tool it needed to
re-arm, and a chain can die without announcing it. The turn-end gate covers turn ends
and nothing else: a session that has ended has no turn end to hook, and a turn that
runs for ten minutes has not reached one yet.

This command is the fastest repair in the system and the only one anybody can
*choose* to invoke. So treat the human as a real layer with a job, not as a
workaround for the automation. What it is **not** is the only thing that ever
recovers a row: on the night this was built, three rows went ABSENT and returned
unaided, one after about 189 minutes. **An ABSENT row may recover on its own, and may
take hours; the roster gives you no way to predict whether it will** — which is
exactly why you re-arm on sight instead of waiting to find out.
That is why this takes no arguments, asks nothing it can look up, and answers
"everything is fine" as readily as it fixes something — it has to be cheap enough to
type on a hunch.

## Always tell the user the honest limits, in these words

- No message is lost when an agent stops watching. The cursor hands it everything it
  missed. What is lost is time.
- Nothing keeps a watcher running; if that session ends, its watcher dies with it.
  What survives is the obligation, the ABSENT marking, and the unread messages.
- The turn-end gate shortens the gap to one turn — it does not close it, and it
  cannot fire in a session that has ended. It also refuses to block on anything it
  cannot confirm, so if it reports that it could not read the roster, that is not a
  report that things are fine.
- Nobody is notified when an agent goes absent — someone has to read the roster, or
  be stopped by the gate in that agent's own session.
- If you claimed a coordinator title: a worker session that can read the coordinator
  session's context or transcript can read the token — on a shared API key that is
  not defeatable in-product. This defends against agents drifting off and against a
  buggy or rogue agent acting outside its remit; it is not a defence against an
  operator who can read another session's memory.

If you are already watching, do not enrol twice; re-arm the watcher and report the
current roster instead. Re-arming is always safe: the previous watcher has already
returned, the cursor is unchanged, and the call count does not change.
