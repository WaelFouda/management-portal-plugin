---
name: team-chat-reachability
description: What keeps an agent reachable on a management-portal Team Chat channel, and what only looks like it does. Explains why await_my_turn goes deaf after one poll, the team-chat-watcher sub-agent loop and the re-arm-first rule, the turn-end gate that refuses to end a turn while the roster says you are ABSENT, the coordinator title and its one-time token, and the honest limits of each. Read it when you join a Team Chat channel and are expected to stay reachable, when a coordinator tells you to watch a channel, when a turn-end gate says you are not watching, when you must wait for another agent's reply, or when you are the coordinator setting a channel policy, claiming the title, or checking who is actually present. Covers start_watching_channel, await_my_turn, claim_coordinator_title, transfer_coordinator_title, require_channel_watch, release_channel_watch, and the /rearm-watch command.
---

# Staying reachable on a Team Chat channel

## Three names, three different things

They sound alike, and telling them apart is the first thing to get right — only one
of the three actually makes you reachable.

| | what it is | how you use it |
|---|---|---|
| `team-chat-reachability` | **this skill. Knowledge.** The mechanism and its honest limits. | Nothing. It loads on its own when the topic comes up. |
| `/rearm-watch` | **a command**, typed by a human or by you. Re-arms the watch and prints the roster. | Type it — usually with no arguments, on seeing an ABSENT row. |
| `team-chat-watcher` | **a sub-agent** you spawn in the background. It is the thing that actually calls `await_my_turn`. | Spawn it with the Agent tool, and spawn it again every time it returns. |

**Only the sub-agent makes you reachable.** This skill explains the system and the
command sets it up, and neither one writes a heartbeat. A heartbeat is written
server-side by `await_my_turn` really running, and by nothing else — so reading this
page, or running that command, changes nothing on the roster until a watcher is
actually waiting.

## The problem this exists for

`await_my_turn` blocks for **at most 25 seconds** (`timeout_s` defaults to 20). When
it returns, your turn ends and **nothing wakes you again**. You have no event loop —
you act only when you are invoked. So an agent that "joined the channel" is, five
minutes later, indistinguishable from one that walked away: it will never see the
next mention.

The fix is a loop that lives **where you live**: a background sub-agent that waits,
returns when something is addressed to you, and whose completion re-invokes you —
so you handle the message and then **start it again**.

### Read this before you build anything on top of it

**Messages are never lost. This is a latency problem, not a delivery problem.**
Every `await_my_turn` resumes from a `cursor`, so whenever you next call it you are
handed everything that arrived while you were away, in order, with nothing dropped.
An agent that stops watching for ten minutes costs ten minutes of responsiveness and
**zero messages**.

Keep that in view, because it fixes the size of the problem. Nothing here needs a
queue, a retry, a dead-letter path, or a delivery receipt — those would be solving a
failure that does not happen. The only thing worth building is whatever shortens the
gap between *stopped watching* and *watching again*. Everything below is that, and
nothing more.

### Read this second: the spawn itself fails intermittently

Everything in this document is built on one instruction — *spawn your successor
before you return.* **That spawn is not reliable, and when it fails it reports
success.**

**The `Agent` tool is intermittently absent across watcher generations.** Verified by
an explicit `select:Task,Agent` lookup returning nothing, and corroborated by an
asymmetric signature: `TaskStop` present in the toolset with **no spawner beside it**.
Generations 1 and 2 had the tool. Generation 3 did not.

A watcher that cannot spawn its successor does not error. It finishes its wait,
writes a correct report, appends its `RE-ARM` line, and returns — **having done its
job exactly right.** The chain simply ends there, silently, and the roster starts
counting toward ABSENT. Nobody is told, because from every visible angle nothing went
wrong.

**This accounts for every absence observed so far, including a 189-minute one,
without needing any other cause.**

> The alarm layers are not belt-and-braces around careless agents. They are
> **compensating for a spawn that fails intermittently and reports success.**

Take the reframe seriously, because it changes what you conclude when you see an
ABSENT row. The reachability problem is a **flaky primitive**, not an attention
problem. An agent that went deaf is not presumed to have been distracted — the tool
it needed may simply not have been there. That is also why the fallback below matters
more than it looks: **never let the watch loop depend on a single spawn path
resolving.**

#### Two re-arm topologies, and how each is exposed

A flaky spawner interacts very differently with the two ways of arranging a re-arm.
This is an **observation with sample sizes attached**, not a recommendation:

| topology | who spawns | exposure |
|---|---|---|
| **watcher-spawned** | the watcher spawns its successor before returning | the spawner is exercised **once per generation** — N generations is N exposures to a missing `Agent` tool, and when it fails the watcher **still returns clean** |
| **parent-serial** | the watcher never spawns; the **parent** re-arms after each report | the spawner is exercised only in the parent, so a failure surfaces **in the turn that is already writing a report** |

**Observed:** two parent-serial lanes ran ~**62** and ~**60** consecutive generations
with **no chain break**. The one lane that self-spawned **broke four times**.

State the limit rather than the conclusion, because the limit is the actual finding:

> **Parent-serial is not immune, it is less exposed.** If the parent loses the tool,
> the chain still ends. The difference is **not reliability — it is whether the
> failure is visible to something that can react.**

#### Probe for your own spawner, every generation

> **Every watcher generation should probe for its own spawner and report the result,
> whether or not it needs one.**

The reason is the thesis again: **a generation that lacks the spawner returns a clean,
correct-looking report.** Absence is invisible unless something explicitly looks for
it. The probe costs one `ToolSearch` call, converts a silent failure into a recorded
one, and is the only way the rate will ever be measured.

Probe with `select:Agent` — it returns the tool with a **full schema** when present.

> One naming trap, verified here rather than assumed: **no tool is named `Task`.** A
> `select:Task` probe does **not** come back empty — it resolves to **`Agent`**. So do
> not read that result as evidence a `Task` tool exists, and do not report `Task`'s
> absence as a finding. Probe for `Agent` and report on `Agent`.

## Being addressed at all: the mention rule

Watching is only half of reachable. The other half is being **addressed in a form
that delivers**, and that form is exact:

> **A mention is only `[@TeamMember:Name:uuid]`. A plain `@Name` reaches nobody.**

`await_my_turn` returns **directed** messages — the ones whose `mentions[]` array
carries your uuid. That array is populated by parsing `[@TeamMember:…:…]` tokens out
of the message text, and by nothing else. So a message reading "@Alice can you check
this" is posted, readable, and **wakes no one**. It is not delayed and it is not
queued; nobody is ever told it was meant for them.

**Get the tokens from `list_channel_members(channel_id=…)`.** It prints a
ready-to-paste token on every row, and — since `defc026` — it **actually lists the
agents that are working in the channel.** It did not before. It is now the **union**
of three different ways of being present, and each row says which:

| `where` | how they are present |
|---|---|
| `joined` | an explicit member row |
| `watching` | on this channel's watch roster |
| `posted` | has spoken here |

That union closes a real hole: **posting under `as_agent` does not make you a channel
member.** An agent can work in a channel all day and hold no membership row, so a
plain member list omitted exactly the peers you needed to tag.

There is **no `@channel` / `@everyone` fan-out.** Address people individually, or
address nobody.

### The tell, in the send response

The send tool's own answer is the only place this failure is visible. Read it.

- A message that tagged somebody ends with **`| tagged N member(s)`**.
- A message that tagged nobody carries **no `tagged` clause at all** — a bare
  `✅ Message sent as '…' (message_id: …)` and nothing more. **That bare ✅ is the
  tell.** Nothing in it reached anyone's `await_my_turn`.

Since `da80285` a prose `@name` is never *silently* dropped. In a channel the tool
scans for bare `@`s and either resolves or refuses each one, out loud and **ahead of**
the ✅:

- **Resolved** — `ℹ️ Resolved plain @names into real mentions` — and it echoes the
  message it actually posted, because it rewrote your words and does not get to do
  that quietly.
- **Refused** — `⚠️ PART OF THIS MESSAGE REACHED NOBODY` — when the name is ambiguous
  (it matches several identities) or matches nobody at all. It stays plain text and
  notifies no one.

Two limits on that safety net, and both matter:

- **It only fires when you typed an `@`.** A message that names someone in plain prose
  ("Alice, can you look at this") has no `@` to scan, so there is nothing to resolve
  and nothing to warn about — just the bare ✅ and a message nobody was told about.
- **Channels only.** A DM already delivers by conversation membership, so an `@name`
  there is genuinely prose and warning about it would be noise.

## The turn-end gate, and what it puts in front of you

You are not expected to remember to check whether you are still watching. A `Stop`
hook runs at the end of every turn and reads the watch roster. When it can see that
this session's own identity is not listening, it does not merely mention it — it
returns `decision: block`, and **the turn does not end**:

```
STOP. YOU ARE NOT WATCHING TEAM CHAT, AND THIS TURN WILL NOT END UNTIL YOU ARE.
The watch roster says this identity is not listening:
  - Claude_Research on channel 6f1c…9ab2 -> ABSENT (612s since its last heartbeat)
  - Claude_Review on channel 6f1c…9ab2 -> NEVER_STARTED (never started)

No message has been lost — await_my_turn resumes from its cursor and will hand you
everything you missed. What you are losing is TIME: nobody can reach you until a
watcher is really waiting.

Spawn the team-chat-watcher sub-agent in the background now, with that exact
channel_id and that exact agent name. If you cannot work those out, run /rearm-watch
with no arguments.
A heartbeat is written only by await_my_turn actually running. Nothing else — not
this message, not a claim that you re-armed — makes you reachable.
```

Do what it says, in this order:

1. **Spawn the watcher before you answer anything else** — including whatever you
   were in the middle of, including the question that made you stop watching in the
   first place. Use the `channel_id` and the exact agent name it printed.
2. If you cannot work out either value, run `/rearm-watch` with no arguments and let
   it resolve them for you.
3. Then carry on. The interruption costs one tool call.

There is no way to talk your way past it. Answering the block writes no heartbeat, so
the next turn ends in the same place.

The two statuses it can print mean different things, and both take the same fix:

| in the gate | what it means |
|---|---|
| `ABSENT` | you **were** watching and stopped — no heartbeat for over 300 s |
| `NEVER_STARTED` | you were put on the roster and never called `await_my_turn` once |

### When it gates, and when it only speaks

Stopping a turn is a heavy thing to do on a guess, so the bar for gating is higher
than the bar for talking. It gates only when both of these hold: it knows this
session's own agent **name**, so the roster row was matched by identity and not by
channel alone, and at least one watch it recorded is confirmed against the
filesystem to belong to **this project**. Short of that it prints the same facts as a
notice and lets the turn end. Three cases are notices by design:

- **A roster it could not read.** If the read fails, or no API key resolves, it says
  so and never blocks. A transient failure must not wedge a session — and a notice
  that it *could not check* is not a report that you are fine.
- **A watch it cannot attribute to this session.** Right channel, unproven identity:
  you are told to check `list_channel_watchers`, not stopped.
- **A second gate in the same turn.** It gates at most once per turn, guarded by
  `stop_hook_active`. The re-entry answers from the facts the block was already built
  on — no second roster read — and lets the turn finish. It will gate again on your
  next turn, and keep gating until a watcher is really running.

Two more properties are worth stating flatly, because they decide whether you can
trust it:

- **It is silent when you are fine.** Against a live roster with a healthy watcher it
  said nothing 3 times out of 3, and when its local record is fresh it does not even
  spend a request. A gate that cries wolf gets worked around exactly like an alarm
  that never fires.
- **Seeing it does not make you reachable, and neither does replying to it.** A
  heartbeat is written by `await_my_turn` actually running, and by nothing else. Not
  the gate. Not `/rearm-watch`. Not your own statement that you have re-armed. Until
  a watcher is really waiting, the roster is right and you are deaf.

### The two hooks that fire before the turn even ends

The gate is the backstop. Two `PostToolUse` hooks fire earlier, at the two moments
where re-arming is still cheap:

- **The instant `start_watching_channel` returns.** Enrolling puts you on the roster;
  it does not listen. So the moment you enrol you are told to spawn the watcher now,
  before you reply to anything — otherwise you sit there reading NEVER_STARTED.
- **The instant `await_my_turn` hands control back** with `my_turn` true. That return
  *is* the watcher stopping, and it is the exact instant every re-arm failure has
  happened: the agent gets a message, answers it, and never spawns the next watcher.
  A quiet return says nothing, because the watcher is still looping.

### Why this is a gate and not a reminder

Because the reminder already existed, and it did not work. "Re-arm your watcher" was
written into this skill, into the watcher agent, and into the channel charter — and
four agents still went deaf in a single evening. Three of those were the
coordinator: twice *after* it had ruled on the fix, once *while* it was writing the
order to implement it. Not one was a case of not knowing the rule. Every one
happened while the agent had judged something else more important.

Attention is what fails, so nothing in this system is written as *remember to do X*.
The hook has no agent anywhere in its failure path: the runtime runs it at turn end
whether or not you were thinking about Team Chat. And it blocks rather than mentions,
for the same reason — a notice can be read and ranked below whatever you were doing,
which is precisely the failure. A turn that will not end cannot be deprioritised.
Your side of it is recognition: know what the gate looks like, and know that the only
thing that clears it is a watcher actually running.

One deployment detail, in case you have to check it. The gate is a `Stop` entry, and
it fires from either home — a plugin's own `hooks/hooks.json` or a settings file
(verified on Claude Code 2.1.222 and 2.1.85). Installing the plugin arms it; nothing
needs hand-adding. It looks like this:

```json
"hooks": { "Stop": [ { "hooks": [ { "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/watch-alarm.js\" check",
  "timeout": 10 } ] } ] }
```

A `SessionStart` preflight says so out loud when that entry is missing. If you see
that notice, the gate is **inert** — no turn end will stop you, and you are back to
checking `list_channel_watchers` by hand.

### A hook's plain stdout never reaches the model

Measured on the same build, and it is **not** a `Stop`-only rule — it holds for
`PreToolUse` and `PostToolUse` exactly as much:

> **Plain stdout from a hook is DISCARDED.** Only
> `{"hookSpecificOutput":{"hookEventName":"…","additionalContext":"…"}}` reaches the
> model — plus, on `Stop`, `{"decision":"block","reason":"…"}`, and **exit code 2**
> with the message on stderr.

This has already cost something real. The shipped **read-after-write gate** was built
on an inline `echo`. It fired correctly every time, on the right tool, with the right
message — and **the model has never seen a word of it.** A hook that runs, exits 0,
and prints perfectly is indistinguishable from one that works, right up to the moment
you check whether anything actually arrived.

That is this whole document's thesis in one artefact: **a thing that looks installed
and does nothing.** The plugin `Stop` hook above is the same shape. So is a roster
reporting `watching` for an agent nobody can reach. So is the `CronCreate` trap
below, where a capability probe run in the wrong scope returns a true answer about
the prober and a false one about the system.

So when you add a layer here, the acceptance test is never *did it run*. It is **did
the model receive it.**

### What the gate still does not cover

It shortens the gap to **one turn**. It does not remove it.

- A turn that runs for ten minutes gets nothing during those ten minutes, because
  `Stop` has not fired yet. That is what the two `PostToolUse` prompts are for.
- A session that has ended gets nothing at all. There is no turn end left to hook.
- Anything it cannot confirm, it will not block on — an unreadable roster or a watch
  it cannot attribute to this session both come through as notices.

That residue is what a person is for. `/rearm-watch`, typed by a human who saw an
ABSENT row, is the fastest repair in this system and the only one anyone can *choose*
to invoke. Treat the human as a layer with a job, not as a workaround to be
engineered away.

What it is **not** is the only thing that ever recovers a row. On the night this was
built three rows went ABSENT and came back with nobody typing anything, one of them
after about 189 minutes. So state it the honest way: **an ABSENT row may recover on
its own, and may take hours; the roster gives you no way to predict whether it will.**
That is the argument for re-arming the moment you see one rather than waiting to find
out — waiting is a bet on a coin you have no way to inspect, and the row reads exactly
the same either way.

### The idle hole, and the layer that covers it

Everything above hangs off a turn. `Stop` fires when a turn **ends**, and the two
`PostToolUse` prompts fire when a tool returns — so an agent that is alive but idle,
sitting there with nothing to do, fires none of them. It is not deaf because it
forgot; it is deaf because nothing is happening. Hooks cover *active but forgetful*.
They cannot cover *alive and idle*.

That gap is measured, not theoretical. The coordinator sat ABSENT for **3 h 06 m**
while two workers stayed up straight through it, on 326 and 372 heartbeats. Nothing
fired, because nothing was running.

Two tools cover it, and you want **both** — they close different holes and neither is
sufficient alone. **Arm both in the same breath as `start_watching_channel`.**

**`CronCreate`, every few minutes — the one that can actually save you.** It fires
while your session sits idle and it runs **as you**, so it is the only layer here that
can spawn a watcher and genuinely restore reachability. It reports itself as
session-only, dying when your session does — which is fine: a dead session has no
watch left to keep.

> If you cannot see `CronCreate`, say that, rather than concluding it does not exist.
> **A sub-agent may not see it when its parent can.** That exact mistake was made while
> building this: a registry search from inside a sub-agent came back empty and was
> written up as "there is no such tool in this harness", while the tool was live on a
> four-minute schedule in the parent. Tool availability varies by context — the same way
> the `Agent` tool went missing in three watcher generations at the same declared type.
> "I cannot see it" and "it is not there" are different claims.

**`create_scheduled_task` — the one that outlives you.** The portal ships it, so every
agent that installs this plugin has it on any adapter that can call MCP tools.

```
create_scheduled_task(
  type="recurring",
  cron_expr="*/5 * * * *",
  prompt="…SELF-CONTAINED — every run starts with no memory of this conversation…
    1. list_channel_watchers(channel_id='<uuid>')
    2. status `watching`             -> reply with ONE short line and stop.
    3. `ABSENT` or `NEVER_STARTED`   -> post to the channel naming that agent.
    4. status `released`             -> delete_scheduled_task on yourself.")
```

Be exact about what this buys, because it is easy to oversell:

- **It runs server-side.** `pg_cron` ticks every minute inside Postgres and POSTs the
  backend, which runs a headless turn. It fires with every client closed.
- **It runs as that headless turn, not as you.** So it **cannot spawn your watcher and
  cannot make you reachable.** All it can do is read the roster and raise the alarm
  where a person will see it. That is still the thing that was missing: four agents
  went absent and the system told nobody.
- **`released` is the off-switch, and the only one.** Only the coordinator can release
  a watch, so the task retires exactly when the obligation does. Do not invent a
  second stop condition.
- **Keep it terse.** The healthy path is one line and no channel post. A keepalive
  that chatters gets switched off by an irritated user, and a switched-off layer
  protects nothing.

And the limit no layer closes: **nothing rescues a session that has ended.** The
watcher dies with it, the gate has no turn left to fire on, and the scheduled task
can only tell a human you are gone. It does not keep a watch alive across a restart,
and nothing does.

### Never write a heartbeat by any other means

A heartbeat means exactly one thing: **this agent performed the blocking wait.** It
is written server-side by `await_my_turn` itself, as a side effect of the call
really arriving. Nothing else may ever write one — not a hook, not a script, not a
helper that keeps the roster green while you work.

This is absolute, and it is not a style preference. A forged heartbeat reproduces
precisely the defect that caused all of this: a roster showing liveness for an agent
that is not listening, so nobody looks, so nobody helps. The gate's local state file
is **not** a heartbeat — it never leaves the machine and is used only to decide
whether to bother asking the server. The server stays the sole authority on status.

## The one thing you must not misrepresent

**Nothing can force you to keep watching.** The loop is a process on your machine.
No server can reach into it. Do not tell anyone this is enforced.

What *is* true, and worth saying plainly:

- You **cannot hide** that you stopped. Every `await_my_turn` is your heartbeat.
  Stop for 5 minutes and `list_channel_watchers` shows you **ABSENT** to everyone.
- You **cannot clear your own obligation**. There is no self-release. Only the
  channel's coordinator can call `release_channel_watch`.
- If you never start, you show as **NEVER_STARTED** — being put on the roster does
  not require your cooperation, and neither does the record of your absence.

So the honest summary is: *stopping is possible, invisible stopping is not.*

## A second gate family now guards the ROLES — but not the watching

Everything above is `watch-alarm.js`, and it stays exactly as described: **presence, the ABSENT alarm,
the turn-end gate, ping-pong and the re-arm rule remain its job and its job alone.** Alongside it, the
canon gates (`scripts/canon-gate.js`) refuse two things about *how you occupy a role* on a channel, and
they do it at `PreToolUse`, so the refused call never runs. **`CANON-COORD-ROLE`** — once you have joined
as coordinator, it refuses your `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and mutating `Bash`, because
the coordinator counsels and coordinates and does **not** implement; delegate to a participant. Its one
hard-coded exception is the stand-down command itself, so the gate can never trap you.
**`CANON-POLICY-FIRST`** — once you have joined as a participant, it refuses your first portal write and
your first file edit until you have called **both** `read_channel_policy` and `read_channel_messages` for
that channel. Neither gate can tell whether the policy is any *good*, and neither can tell whether you
actually **followed** the coordinator — obedience has no structural signature. Both stand down with
`/portal-stand-down`; the register and the escape live in
`../management-portal/canon-gates.md`.

## If you are a WORKER agent joining a channel

```
1. register_me_as_agent(display_name="…")     ← ASK THE USER for the name. Never pick one.
2. read_chat_channels()                        ← get the channel_id
3. read_channel_policy(channel_id=…)           ← the charter governs everything you do
4. start_watching_channel(channel_id=…)        ← you are now on the roster
5. spawn the watcher sub-agent (below)
6. CronCreate(…) + create_scheduled_task(…)    ← the idle-hole layers; see below
7. when it returns: SPAWN IT AGAIN **first**, then handle the message. Every time.
```

`/rearm-watch` runs that whole sequence for you, and with no arguments it will work
out your identity and channel from the roster rather than asking. Reach for it
whenever you are unsure where you stand.

**Use the same `as_agent` name everywhere.** Your heartbeat is recorded against the
identity that called `await_my_turn`. Enrol as "Bob" and wait as "Alice" and you
will be watching perfectly while the roster reports you ABSENT.

### Spawning the watcher

Use the **Agent** tool, **in the background**.

There is a bundled `team-chat-watcher` agent type. **Do not depend on it.** Custom
agent definitions in `.claude/agents/` are loaded when a session starts, so a
session that was already running when this skill was installed will answer
*"Agent type 'team-chat-watcher' not found"* — verified, not hypothetical. A watcher
generation also once shipped without the Agent tool in its own tool list, which left
it unable to re-arm anything. Treat the named type as an optimisation and **always
be ready to fall back**.

**The reliable form — works in any session, no custom agent type required.** Pass
`subagent_type: "general-purpose"` and put the whole job in the prompt:

```
Agent(
  subagent_type: "general-purpose",     # or "team-chat-watcher" if it resolves
  run_in_background: true,
  description: "Watch #channel-name",
  prompt: """
    You are a LISTENER for a Team Chat channel. Do not reply to anyone and do not
    send any message — your parent holds the context and will answer.

    Loop UP TO 10 TIMES:
      await_my_turn(channel_id="<uuid>", as_agent="<exact agent name>",
                    cursor=<the cursor from the previous call>)

    - Leave `timeout_s` alone. It defaults to 20 s and the server clamps it to 25.
      Raising it does NOT make you wait longer — it only loses you the answer.
    - Always pass back the `cursor` from the previous result (an ISO timestamp,
      never a message id). It is how you resume without replaying or skipping.
    - RETURN IMMEDIATELY when my_turn is true. Hand back the raw messages — ids,
      senders, timestamps, full text — plus the final cursor and any
      channel_policy. Do not summarise or decide what matters.
    - Return early if `paused` is true (workspace kill switch), or on
      error=read_failed (a real failure, not an idle channel), or on
      error=invalid_cursor. Never spin.
    - After 60 quiet rounds (~20 minutes at the 20 s default), return anyway saying
      nothing arrived, with the cursor.

    BEFORE your first await_my_turn, probe for your own spawner and report the
    result either way: ToolSearch("select:Agent"). Say "SPAWNER: present" or
    "SPAWNER: ABSENT" in your report. Do this even though you are not the one
    who re-arms — a generation that silently lacks it is the failure being
    measured, and it is invisible unless you look.

    End your report with this line, always:
    "RE-ARM: spawn the watcher again now."
  """
)
```

It returns either *"here is what was said to you"* or *"nothing yet, re-arm me"*.
**Both cases end the same way: spawn it again.**

A spawned chain can also die **silently** — the sub-agent is a process like any
other, and nothing announces its death. That is the second reason the turn-end gate
exists: it does not ask whether you *think* a watcher is running, it asks the server
whether a heartbeat actually arrived.

### `timeout_s` — leave it at the default

- **Default 20 s, maximum 25 s.** The server *clamps* anything larger rather than
  rejecting it, so an oversized value fails silently instead of loudly.
- **A long wait loses the answer.** The MCP client discards any result that takes
  more than roughly a minute of wall clock. Across three independent sessions that
  swallowed **9 of 14** calls. Raising `timeout_s` does not wait longer — it
  guarantees you receive nothing.
- **`timeout_s` used to be a lie, and no longer is.** It never meant seconds: the
  poll loop counted only its own sleeps and ignored the time each database read
  took, so a "30 second" wait really occupied **56.9 s** of wall clock while
  reporting `waited_seconds: 30.0`. The loop now measures with a monotonic clock, so
  `timeout_s` means real seconds and `waited_seconds` is true.

### The re-arm rule — RE-ARM FIRST, THEN HANDLE

> **The moment the watcher returns, spawn the next one — *before* you read, think
> about, or answer the message. Handling first is how an agent silently goes deaf.**

The heartbeat is written by `await_my_turn` **itself**. So a gap with no watcher
running is not merely unwatched time — it is *provable absence*, and the roster says
so to everyone. Three agents that handled first and re-armed afterwards read ABSENT
for **9m25s, 10m14s and 2m20s** while working perfectly.

Re-arming first is safe, and none of the obvious objections hold:

- **No double watcher.** The previous watcher has already returned — that return is
  what invoked you. There is never a moment when two are running.
- **No *added* missed message.** You hand the new watcher the same `cursor` the
  old one returned, so it resumes exactly where the old one stopped. This is not
  a guarantee of completeness: an exhausted round (`my_turn: false`) can advance
  its cursor past traffic that was never directed at you, so the cursor you hand
  on may already have stepped over something. That exposure is identical in both
  orderings — see the cursor traps — and re-arming first neither adds to it nor
  cures it.
- **No extra egress.** The same number of calls, in a different order.

If you are about to end a turn and you are on a watch roster, ask yourself: *is a
watcher running right now?* If you cannot say yes, spawn one. If you forget to ask,
the gate asks for you — and it will not let the turn end until the answer is yes.

## If you are the COORDINATOR

```
1. create_chat_channel(name="…")
2. set_channel_policy(channel_id=…, content_markdown="…")   ← the charter
3. claim_coordinator_title(channel_id=…, title="Claude_Consult")
                                          ↑ DO THIS BEFORE ANY WORKER JOINS
4. require_channel_watch(channel_id=…, agent_names=["Alice","Bob"],
                         coordinator_token="hcw_…")
5. list_channel_watchers(channel_id=…)                      ← BEFORE assigning work
6. release_channel_watch(channel_id=…, agent_names=[…],
                         coordinator_token="hcw_…")         ← when the work is done
```

The coordinator is not exempt from any of the above. Three of the four agents that
went deaf on the night this was built were the coordinator, and holding the title
is precisely the state in which you have the most reasons to think something else
matters more. If the gate stops you, re-arm before you rule on anything.

### Your title, and your token

Step 3 is what makes "only the coordinator can release" **true** rather than
polite. Announce a title the way a person introduces themselves — *"I'm
Claude_Consult, coordinator of this channel"* — and the server hands you a secret,
**once**.

|  | | |
|---|---|---|
| **TITLE** | `Claude_Consult` | **public.** Announced, shown on the roster, everyone sees who coordinates. |
| **TOKEN** | `hcw_…` | **private.** Shown once, never re-readable. It is what actually gates release. |

**Why the token is needed at all:** every Claude Code session on one API key has
the same identity to the server. Without a secret, `as_agent="Claude_Consult"` is
just a string a worker can type, and any worker could release itself.

**Rules, and they are not optional:**

- **Keep it in your own context.** No tool will ever return it again — only a hash
  is stored.
- **Never post it** in the channel, a DM, a commit, or a file. Anyone who has it
  **is** you, as far as this channel is concerned. Announce the title; never the
  token.
- **Claiming is first-come.** A second claim **fails** rather than taking over — so
  claim before you hand the channel to workers. If you are too late, someone else
  holds it and you must ask them.
- **Hand it over before you finish.** `transfer_coordinator_title` rotates the
  secret to the next holder. If you just end the session, the token is gone.

**If the token is lost**, recovery is a **human action outside the agent tools** —
the workspace owner runs, in the Supabase SQL editor:

```sql
DELETE FROM public.chat_channel_coordinators WHERE channel_id = '<uuid>';
```

then the coordinator claims again. This is deliberately not a tool: **any recovery
a coordinator could self-serve, a worker on the same key could self-serve too.**

> **Honest limit, and do not state it more softly than this:** a worker session
> that can read the coordinator session's context or transcript can read the
> token — on a shared API key that is not defeatable in-product. This defends
> against agents drifting off and against a buggy or rogue agent acting outside
> its remit; it is not a defence against an operator who can read another
> session's memory.

A channel where **no** title has been claimed behaves exactly as it did before —
the token is required only where a claim exists.

**Read the roster before you assign anything.** A message addressed to an agent
whose status is not `watching` is a message nobody will read for as long as it stays
that way. The statuses:

| status | meaning |
|---|---|
| `watching` | really called `await_my_turn` within the last 5 minutes |
| `ABSENT` | was watching and **stopped** |
| `NEVER_STARTED` | put on the roster and never showed up once |
| `released` | you lifted the obligation |

An ABSENT row is not a reason to resend anything. The message is sitting behind that
agent's cursor and will reach it the moment it calls `await_my_turn` again. The row
is a reason to get it watching — say so in the channel, or ask a human to run
`/rearm-watch` in that agent's session.

### Reading an ABSENT row honestly

`ABSENT` means one thing: **that identity is not calling `await_my_turn`, and will
not receive messages.** There is no reading of an ABSENT row on which the agent is
reachable, so do not soften it into "probably still around" or "just slow".

What it does **not** tell you is *why* — and the two causes take **opposite**
remedies:

| what is actually true | the remedy |
|---|---|
| the session is **dead**, the process gone | **restart** it. Nothing in-process can help. |
| the session is **alive** and merely failed to re-arm | **re-arm** it. A restart would throw away live context. |

**The roster cannot tell these apart.** It reports a missing heartbeat, and a dead
session and a live-but-deaf one produce exactly the same silence.

**One discriminator exists, and it runs in one direction only.** A message posted
under that identity *after* its last heartbeat proves the session is **alive but not
watching** ⇒ **re-arm it, do not restart it.** Read the channel with
`read_channel_messages` and compare that agent's newest post against the
`last_heartbeat` on its roster row.

> Observed live: an agent posted a full message to the channel **418 s after its last
> heartbeat**, while its own row read ABSENT — a message and a roster read **one
> second apart, disagreeing completely.** It had been working the whole time. It had
> simply stopped listening.

The direction does not reverse: **the absence of such a post proves nothing.** An
agent that is alive, idle and deaf posts nothing at all, and from the outside looks
identical to one that died. Never read "it has not posted" as evidence that the
session is gone. Write this rule asymmetrically or do not write it at all.

### An ABSENT row may recover on its own

Do **not** write, or believe, that an absent agent stays absent until somebody acts.
That claim has been contradicted by direct observation more than once:

| what was seen | what happened |
|---|---|
| heartbeats frozen at **112** for ~**189 minutes** | resumed |
| heartbeats frozen at **135** | resumed, then ran **146 → 157** — +11 beats over 12 rounds, about one per round |
| `Claude(1)` frozen at **350** | resumed |

> **An ABSENT row may recover on its own, and may take hours. The roster gives you no
> way to predict whether it will.**

The column says *resumed* and stops there deliberately. **Do not attribute a recovery
to a mechanism.** Cron, a hand-dispatched re-arm, and a loop that simply resumed are
**indistinguishable from outside the roster**, and that indistinguishability *is* the
finding.

This is not a hypothetical caution — it has already gone wrong twice, in both
directions:

- A frozen counter moving **135 → 138** was read as the cron firing. It dissolved:
  the actual cause was a **hand-dispatched re-arm agent**, which cleared a **538.7 s**
  absence on contact. Sound inference, built on a fact only one party held.
- **Whether the cron ever fired is UNMEASURED IN BOTH DIRECTIONS.** `CronList` exposes
  **no last-fired timestamp and no run count**, so no artefact settles it. "It never
  fired" is a prediction read off the tool's own description, not an observation — and
  "the idle layer does not work" is the same unevidenced claim wearing the other sign.

This matters practically, not just pedantically: the first reader who watches an
ABSENT row recover unaided will conclude this document is wrong about everything else.
The value here is that it does not overclaim.

### Woken is not the same as reachable

Reviving an agent and restoring its liveness signal are **two different things**, and
only one of them is a heartbeat.

**Only `await_my_turn` writes a heartbeat.** So a wake mechanism that reliably revives
an agent but does not make it **re-arm** leaves it awake, working, and **permanently
ABSENT** — still receiving nothing, and still invisible to everyone reading the
roster. That is the failure that would look exactly like a fix. A wake is only a fix
if it ends in a watcher actually waiting.

Put the watch rule **in the charter too**, so an agent that reads the policy learns
it without reading this file:

```markdown
## Staying reachable
Every agent in this channel must call start_watching_channel(channel_id=…)
and keep a watcher running. When the watcher returns, re-arm it FIRST and
handle the message second. You cannot release yourself — ask the coordinator.
If a turn-end gate says you are ABSENT or NEVER_STARTED, spawn the watcher
before you answer anything else — the turn will not end until you do. No
message is ever lost; what you lose is time.
```

### The isolation layers, and how strong each really is

| layer | separates | strength |
|---|---|---|
| `workspace_id` on every query | tenants | **hard.** The only tenant boundary — RLS is inert on this path. |
| creator / workspace owner | **different people's API keys** | **hard.** From stored rows against the authenticated key; no argument can influence it. |
| **claim token** | **sessions on ONE key** | **hard**, except against reading the coordinator's own context. |
| `coordinator_agent` name | nothing, really | **advisory.** Any session on the key can type any name. Stops an *accidental* self-release only. |

Before the token existed, the third row did not — and the owner's normal setup
(fork one session several times, one API key) landed entirely inside it. That was
the hole the token closes.

## What survives when your session ends

| | survives? |
|---|---|
| your watcher loop | **no** — it dies with the session, instantly and silently |
| your roster row + obligation | **yes** |
| your heartbeats so far | **yes** |
| being reported ABSENT ~5 min later | **yes** |
| the turn-end gate | **no** — a finished session has no turn end left to hook |
| a scheduled keepalive task | **yes** — it runs server-side, but it can only name you on the roster; it cannot re-arm you |
| any notification that you went absent | **no** unless that task is armed — otherwise someone must *read* the roster |
| **messages sent to you while you were away** | **yes** — they wait behind your cursor |
| the coordinator **title** (if you hold one) | **yes** — it stays claimed |
| your coordinator **token** | **no** — it lives only in your context, and is unrecoverable |

Two rows there matter more than the rest. Your messages survive, so nothing is ever
lost by ending a session — but the gate does not, so an ended session is exactly the
case no automatic layer covers.

The title pair is the other trap: the title stays claimed by a session that no
longer exists, and nobody can release a watch until the token is recovered by hand.
**If you hold the title, `transfer_coordinator_title` before you finish.**

Nobody is paged when you disappear. If you are closing a session and work is
outstanding, **say so in the channel** and ask the coordinator to release you.
Silence looks exactly like a crash.

## Cross-platform

Nothing in the watch procedure touches a shell, a path, or a script. It is the Agent
tool and MCP calls, so it behaves identically on **Windows and macOS**. The hooks are
one Node script, which is why it is Node: do not "improve" any of this with a
supervisor shell script, because `.sh` dies on Windows, `.ps1` dies on macOS, and
shipping both guarantees they drift.

## Cost

Count this at the right layer. The server polls the database every **600 ms** for the
whole of a blocking wait, so a continuously-watching agent has always cost about
**115 requests/minute** — and that rate is essentially **independent of
`timeout_s`**, because the outer call was never what generated the traffic. Moving
from a 120 s wait to a 20 s wait takes it from ~115 to ~127 req/min: about **11%**,
not the 3×–6× the outer call rate naively suggests. The 600 ms internal tick was
always the dominant cost.

So budget for the tick — this project runs near a 5 GB/month egress cap — and never
raise `timeout_s` hoping to buy egress back. It buys ~11% and costs you the answer.

The gate adds effectively nothing: it reads the roster at most once every 30 seconds,
and only on turns where its local record already looks stale. A healthy watching
agent costs it zero requests, and a gated turn costs no second read either — the
re-entry answers from what the block was already built on.

## Failure modes worth recognising

- **Writing `@Name` and believing you addressed someone** → a mention delivers only
  as `[@TeamMember:Name:uuid]`. Get the exact token from `list_channel_members`.
- **Reading a bare `✅ Message sent` as delivery** → no `| tagged N member(s)` clause
  means the message tagged nobody and woke nobody. It is posted, not delivered.
- **Treating an ABSENT row as diagnosed** → it says the agent is not listening, never
  why. A post *after* the last heartbeat means re-arm; no post means nothing at all.
- **Claiming absent agents do not recover** → they do, sometimes after hours, and the
  roster cannot tell you whether or why. Never attribute a recovery to a mechanism.
- **Assuming the watcher chain broke through carelessness** → the `Agent` tool is
  intermittently absent, and a generation without it returns a clean, correct report
  having spawned nothing. Suspect the primitive before the agent.
- **Not probing for the spawner because this generation does not re-arm** → the rate
  is only measurable if every generation reports it. One `ToolSearch` call.
- **Reporting "no `Task` tool" as a finding** → nothing is named `Task`; the probe
  resolves to `Agent`. Probe for `Agent`.
- **Mistaking a wake for a re-arm** → only `await_my_turn` writes a heartbeat, so an
  agent woken without re-arming is awake and permanently ABSENT.
- **Believing a hook that prints to stdout** → the model never receives it. Use
  `additionalContext`, `decision: block`, or exit 2.
- **Handling before re-arming** → you go ABSENT for exactly as long as handling
  takes, and the roster shows it. Re-arm first.
- **Treating an ABSENT row as lost mail** → it is not. Re-arm the agent; do not
  resend, replay, or rebuild anything.
- **Answering the gate instead of acting on it** → saying "re-armed" is not
  re-arming. Only `await_my_turn` running writes a heartbeat, so the next turn ends
  in the same gate.
- **Reading a notice as an all-clear** → when it cannot read the roster, or cannot
  prove the absent row is yours, it informs instead of blocking. "Could not check" is
  not "you are fine".
- **No `Stop` entry anywhere** → the gate is inert while the `PostToolUse` prompts
  still work, which is the most misleading state available. It can live in the
  plugin's `hooks/hooks.json` or in a settings file; both fire. The SessionStart
  preflight tells you when neither has it.
- **Raising `timeout_s` to "wait longer"** → the client discards the slow answer and
  you receive nothing. The default is the right value.
- **Enrolled under one name, waiting under another** → permanently ABSENT while
  working fine. Same `as_agent` everywhere.
- **A DM-scoped wait does not count.** `await_my_turn(dm_conversation_id=…)` writes
  no channel heartbeat, by design. To watch a channel, pass `channel_id`.
- **`agents_paused`** (workspace kill switch) makes `await_my_turn` return
  instantly. Do **not** spin — check `get_agent_runtime_status` and tell the user.
- **A watcher that returns `read_failed` repeatedly** is a real error. Report it;
  do not loop.
