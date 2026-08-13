# WATCH-LAYERS.md — what actually watches Team Chat, per adapter

> Where the Team Chat watch system exists on each platform bundle, where it does **not**, and what the
> fallback is when it does not. Companion to the `team-chat-reachability` skill (the procedure) and
> `agent-onboarding/DISCIPLINE.md` (the canon). The facts below were **measured**, and the measurement
> conditions are stated so you can re-run them — do not treat them as settled on a platform where they
> were not run.

## Read this first: this is a latency problem, not a delivery problem

**Messages are never lost.** `await_my_turn` resumes from a `since` cursor, so whenever an agent next
looks, it is handed everything that arrived while it was not looking. An agent that stops watching for
ten minutes loses ten minutes of responsiveness and **zero messages**.

Every layer below exists to **shorten that gap**, not to rescue dropped mail. If you find yourself
designing a queue, a retry, a dead-letter path, or a delivery receipt, you have misdiagnosed the
problem. Two things actually go wrong, and only two: nobody can reach an agent **for a while**, and —
the part that hurt — **nobody is told**. Four agents went unreachable and the system told nobody. Every
layer here is an answer to "who says so, and when" — and, at the gate, "and what may not happen until it
is fixed" — never to "where did the message go".

## The layers

1. **The MCP watch roster** (server-side, every adapter). `start_watching_channel(channel_id)` enrols
   you; `list_channel_watchers(channel_id)` shows who is actually present; the coordinator holds
   `require_channel_watch` / `release_channel_watch`. A watcher is marked `ABSENT` after **300 s**
   without a heartbeat, and the heartbeat is written by `await_my_turn` itself. This is the source of
   truth for every other layer — and it is **passive**. It never contacts anyone. Someone, or something,
   has to *read* it.
2. **The Stop gate hook** (turn end). Runs `watch-alarm.js check`. This is the only layer *inside the
   session* that speaks without being asked — and the only one anywhere that can refuse to let the turn
   end. When the roster says this
   session's identity is `ABSENT` and attribution is certain, it returns `decision: block` and **the turn
   does not end** until the watcher is spawned. See **The gate** below for the three cases where it
   deliberately declines to block and speaks instead.
3. **The recorder / join-moment hook** (`PostToolUse` on `await_my_turn` / `start_watching_channel`).
   Notes locally that this machine really made the call, and under which agent name — that local record is
   what later lets the gate attribute an `ABSENT` row to *this* session. It also speaks at the two moments
   a watch exists but nothing is listening: when `start_watching_channel` returns (you are on the roster
   now, and deaf, so spawn the watcher) and when `await_my_turn` hands control back with `my_turn` true
   (the watcher has stopped; re-arm in this same turn). It stays quiet on the watcher's ordinary polling
   returns, where nothing has changed. It is **not** a heartbeat — see the last section.
4. **The preflight hook** (`SessionStart`). Says out loud, at session start, when the Stop gate is not
   actually armed, so a bundle cannot degrade to instructions-only in silence. It never edits your
   configuration; it only tells you.
5. **The script** — `watch-alarm.js`, Node, no dependencies, so one implementation serves
   Windows and macOS. It never embeds a credential. It accepts **both** families the server takes —
   a platform API key as `X-API-Key`, or an **OAuth access token as `Authorization: Bearer`** — and
   resolves candidates best-first: the environment
   (`CLAUDE_PLUGIN_OPTION_MCP_OAUTH_TOKEN` / `MCP_OAUTH_TOKEN` / `PORTAL_OAUTH_TOKEN`, then
   `CLAUDE_PLUGIN_OPTION_MCP_API_KEY` / `MCP_API_KEY` / `PORTAL_API_KEY`), then your own existing MCP
   client config (`~/.claude.json`, `.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`,
   `.roo/mcp.json`, either header form), then **this plugin's own OAuth entry in Claude Code's
   credential store** — see "The alarm under OAuth" below. It never writes or prints a credential.
   Its one network call is a **read**: a raw JSON-RPC `POST /mcp` calling `list_channel_watchers`,
   bounded at 6 s, rate limited to once per 30 s, and skipped entirely when the local record is
   fresh — this project runs near a 5 GB/month egress cap. A **401/403 is a refusal, not flakiness**:
   that exact credential is stood down for an hour and the next candidate is tried on the following
   turn, so a revoked key cannot produce one failed request per turn indefinitely.
6. **The idle keepalive** — **two** recurring schedulers, both armed at the join moment alongside the
   watcher: `CronCreate` (in-session, runs as you, so it can re-arm) and the portal's
   `create_scheduled_task` (server-side, runs headless, so it can only raise the alarm). Every hook above
   fires on *activity*; this is the only layer that fires when there is none. Neither scheduler alone
   closes the gap. See **The idle layer** below for exactly what each can and cannot do.
7. **The `team-chat-watcher` sub-agent** — the background loop that actually performs the blocking wait.
   You **spawn** it, from the model, with the Agent tool. Of layers 7–9 it is the only one that makes you
   reachable; the other two only tell you to make yourself reachable.
8. **The `team-chat-reachability` skill** — a topic, loaded into context. It **teaches**: the roster, the
   re-arm-FIRST-then-handle rule, the coordinator title. Loading it changes what you know, never whether
   anyone can reach you.
9. **The `/rearm-watch` command** — an imperative, and a **human types it**. The explicit entry point when
   a person wants to check the roster or re-arm by hand.
10. **The human** — universal, and on instruction-only adapters the *only* backstop.

## The matrix

`Yes` = ships and works. `Partial` = the harness supports it but this bundle does not ship one, or it works
only in a reduced form. `No` = the harness has no such mechanism.

| Adapter | MCP roster | Stop gate hook | Idle (scheduled task) | Recorder / join hook | Script | Sub-agent | Skill | Slash command | Human |
|---|---|---|---|---|---|---|---|---|---|
| **claude-code** (file bundle) | Yes | Yes [1] | Yes [7] | Yes | Yes | Yes | Yes | Yes | Yes |
| **plugin** (one-install) | Yes | Yes [2] | Yes [7] | Yes | Yes | Yes | Yes | Yes | Yes |
| **copilot** | Yes | No [3] | Partial [7] | Partial [4] | No | Partial [5] | Partial [5] | Partial [5] | Yes |
| **cursor** | Yes | No | Partial [7] | No | No | No | No | Partial [6] | Yes |
| **roo** | Yes | No | Partial [7] | No | No | No | No | No | Yes |

[1] `.claude/settings.json`, `hooks.Stop` → `node "$CLAUDE_PROJECT_DIR/.claude/scripts/watch-alarm.js" check`.
This is what the file bundle uses, because a file bundle has no plugin to declare it in. Verified to fire and to gate.

[2] The plugin's `hooks/hooks.json` declares the `Stop` entry and **it fires from there** — installing the
plugin arms the gate with nothing hand-added (fact 2 below). The plugin also ships the `SessionStart`
preflight, which announces at session start if no `Stop` entry is found in either the plugin or a settings
file. A settings file remains a valid home, and is what the file bundle uses; to declare it there, add to
`.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/watch-alarm.js\" check",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

[3] Copilot hooks (`.github/hooks/*.json`) support **`PreToolUse` and `PostToolUse` only**. There is no
`Stop` equivalent, so neither the turn-end alarm nor the gate can be ported: nothing on Copilot will
interrupt an agent that has stopped watching, and nothing there can hold a turn open.

[4] The mechanism exists and the bundle uses it twice: `.github/hooks/portal-read-after-write.json`
reinforces Gate 1 on portal writes, and `.github/hooks/portal-watch-rearm.json` fires on the way out
of every `await_my_turn` to say "re-arm now". Note what that can and cannot be — on Copilot it is a
**static reminder in the tool path**, not a turn-end gate. It carries no roster lookup (there is no
turn-end event to hang one on, so it needs no script, no key, and no network), and it fires only while the
agent is still calling the tool. It cannot tell you about an agent that has **stopped** calling it, which
is exactly the failure case.

[5] Copilot supports custom agents (`.github/agents/*.agent.md`), skills (`.github/skills/`), and prompt
files (`.github/prompts/*.prompt.md`), and this bundle ships one of each — but for the portal operator,
not for the watch. Copy `agent-onboarding/shared/skills/team-chat-reachability/` into `.github/skills/` if
you want the procedure to load on Copilot.

[6] Cursor registers `.cursor/commands/*.md` as slash commands and this bundle ships `/portal`. A command
cannot loop and cannot fire on its own: it is a way for **you** to ask, never a way to be told.

[7] **Two different mechanisms sit in this column and they are not interchangeable.** `CronCreate` is a
**harness** tool — in-session, runs *as the agent*, and therefore the only one that can actually re-arm a
watch. `create_scheduled_task` is a **portal MCP** capability, so any adapter that can call MCP tools can
arm one, but it runs headless and can only *raise the alarm*. Hence `Yes` where both are available and
`Partial` where only the alarm half is: copilot, cursor and roo can report an idle absence, never repair
one. On claude-code and the plugin the `PostToolUse` join hook prompts you to arm both at
`start_watching_channel`; everywhere else nothing prompts you, so the agent must arm what it can from
instructions alone. Do not read this column as "the harness has a scheduler" — outside `CronCreate` on
Claude Code, it does not.

## The gate: the turn-end alarm is no longer just a notice

The `Stop` hook used to only speak. It now **gates**. When the roster says this session's identity is
`ABSENT` and attribution is certain, the hook returns `{"decision":"block","reason":"…"}` and **the turn
does not end** until a watcher is spawned. Verified, not designed-on-paper: the turn was held open and the
model was re-invoked with the block reason as its next input.

Everything below is a limit on that power, and every limit is deliberate.

- **At most once per turn.** The runtime sets `stop_hook_active` when it re-enters `Stop` after a block.
  From that point the hook may inform but never gate again: it releases the turn with a loud notice that
  repeats the facts the block was built on, and says plainly that it will gate again next turn and keep
  gating until a watcher is really running. A session that can never finish a turn is worse than a session
  that is briefly unreachable.
- **Never on a transient roster-read failure.** The roster read is bounded at 6 s. A timeout or an error
  does not gate and does not claim you are fine — it counts a strike, and only after **three consecutive
  failures** does it say out loud that it does not know (and then at most once every ten minutes). One bad
  read is noise, not evidence.
- **Never on a watch it cannot prove is yours.** Gating requires both that the session knows its own agent
  **name** (so the roster row was matched by identity, not merely by channel) and that at least one
  recorded watch resolves, against the filesystem, to **this** project. Anything less and it emits a
  notice — "you may not be watching" — and lets the turn end. A session that has no business watching must
  never be wedged.

The asymmetry is the point: **blocking turns a false positive from noise into obstruction, so the bar for
gating is higher than the bar for speaking.** When in doubt the hook speaks.

**A hook still cannot spawn a sub-agent.** No hook can call the Agent tool; spawning the watcher is a model
action and remains one. What the gate changes is not who spawns it — it is that **stopping is now
conditional on it**.

## The idle layer: the hole no hook can cover

Every hook above fires on **activity**. A `Stop` hook fires at turn *end*, so an agent with no turns to end
is invisible to it. That is not a theoretical corner: measured tonight, the coordinator sat `ABSENT` for
**3 h 06 m** while two workers stayed up beside it and logged **326** and **372** heartbeats. Nothing was
wrong with the hooks. There was simply nothing for them to fire on.

State it plainly: **hooks cover "active but forgetful"; they cannot cover "alive and idle".** Where the
gate and **both** schedulers are armed — which today means Claude Code — there is no remaining state in
which an agent is alive and unreachable with nothing to wake it. Where only the server-side half is
available, an idle agent can still be *reported* but not *woken*; see the matrix.

**The server-side half is the portal's own `create_scheduled_task`** — it ships with this MCP, so there is
nothing to install. Verified in the backend: Supabase **pg_cron ticks every minute inside Postgres** and
POSTs `/scheduled-tasks/run-due`, which runs the task's prompt through the same AI pipeline a user turn
uses, headless. The consequences that matter:

- **It fires server-side, even when every client is closed.** That is the whole point of choosing it.
- **It runs as a headless turn, not as the agent that created it.** So it **cannot spawn your watcher and
  cannot make anyone reachable.** All it can do is **read the roster and raise the alarm** — post to the
  channel naming the absent agent. That is still the missing piece: four agents went absent and the system
  told a human **zero** times.
- **Arm it at the join moment**, alongside the watcher and alongside `CronCreate` — which is exactly where
  the `PostToolUse` hook on `start_watching_channel` tells you to.
- **The off-switch is the existing authority model.** Only a coordinator can release a watch, so the task
  deletes itself (`delete_scheduled_task`) once its own roster row reads `released`. Do not invent a second
  off-switch; a watch that could be cancelled from the worker side is not an obligation.
- **Keep it terse.** On the healthy path it replies with one short line and posts nothing to the channel. A
  keepalive that floods a channel gets switched off, and a switched-off keepalive protects nothing.

### Two schedulers, and why you need both

They are complementary, not alternatives. Each covers the hole the other cannot:

1. **`CronCreate`** — in-session. It reports itself as firing **while the REPL is idle**, running **as the
   agent** (so it is the only one of the two that could spawn a watcher and actually restore
   reachability), session-only, not written to disk, dying when Claude exits, and auto-expiring after seven
   days. This is the layer *aimed at* the three-hour idle gap.

   > **NOT OBSERVED TO FIRE. Do not read the paragraph above as a measurement.** On Claude Code 2.1.222
   > (Windows), a job was armed on a four-minute schedule on a session that then went ABSENT for about
   > eight minutes with heartbeats frozen at 135, and no wake was attributable to it. That is **not**
   > evidence the layer failed. Two possibilities were never separated: it **never fired**, because the
   > session was in continuous conversation and this tool fires only while the REPL is idle; or it **fired
   > and did nothing observable**. `CronList` shows the job still registered and recurring but exposes
   > **no last-fired timestamp and no run count**, so nothing on that machine settles it.
   >
   > The first possibility is itself only a prediction read off the tool's own description — the register
   > this document refuses to accept from anyone else. So the honest state is **unmeasured in both
   > directions**, and it could not be measured, because the only session available never went idle. Arm
   > it; do not rely on it; and do not conclude the opposite either — "the idle layer does not work" is the
   > same unevidenced claim wearing the other sign.
   >
   > One piece of apparent positive evidence was produced and then dissolved, which is why this warning is
   > here rather than a footnote: a second agent read a frozen heartbeat counter moving 135 → 138 as the
   > cron firing and waking the session without re-arming it. Well-reasoned, and wrong — the wake was a
   > hand-dispatched re-arm agent that cleared a 538.7 s absence "on contact", timestamps matching. The
   > inference was sound; it was built on a fact only one party held.

   **Keep the distinction that came out of that mistake, because it outlives the question that produced
   it: waking an agent and restoring its liveness signal are different things.** A cron that revives a
   session without re-arming its watcher leaves that agent permanently reachable *and* permanently ABSENT.
   That is worse than either failure alone — the row is wrong in the **reassuring** direction, and a
   reassuring wrong row is precisely what stops anyone from looking.

   *Provenance, stated because everything else in this file names where it was measured:* these properties
   come from the tool's **own return string**, observed in a **parent/coordinator session** that had the
   tool and had armed a job on a four-minute schedule. They were **not** independently re-measured the way
   the hook facts below were, and they could not be — the sub-agent that wrote this file cannot see
   `CronCreate` at all. That absence is evidence of nothing (see the trap below); it is also the reason
   this entry is attributed rather than asserted flat.
2. **The portal's own `create_scheduled_task`** — server-side pg_cron, described above. Fires **when
   every client is closed**, which `CronCreate` cannot, and it ships in the plugin. But it runs headless,
   **not as you**, so it can only **raise the alarm**, never re-arm. This is what covers the ended session.

Arm both at the join moment. Neither alone closes the gap.

> **A TRAP THAT WILL CATCH SOMEONE, INCLUDING A CAREFUL SOMEONE.**
> **A sub-agent may not see `CronCreate` even when its parent can.** This was written into an earlier draft
> of this file as "there is no `CronCreate` tool in this harness" — a claim produced by searching a
> *sub-agent's* tool registry and reporting the result as the *harness's* capability. The tool was live at
> the time, on a four-minute schedule, called from the parent session.
>
> That is the same defect as the `Agent` tool vanishing in three watcher generations at the same declared
> type: **tool availability varies by context, and an instrument that reports its own scope as the world's
> will produce a confident, verified, wrong answer.** Before concluding a capability does not exist, ask
> where you are standing. "I cannot see it" and "it is not there" are different claims, and only one of
> them is usually true.
>
> **And it does not stay in the tools.** While this file was being written the same shape recurred three
> more times, every one of them in a *report* rather than in code: a capability declared absent because one
> registry could not see it; a file declared fixed because one section of it was; a rule credited to an
> agent who had never stated it, rather than to the one who wrote it. The code was right each time. The
> claim *about* the code was wrong.
>
> So the rule generalises past tools, and it is the one worth carrying out of this document: **say which of
> your statements you observed and which you were told.** They cost the same to write and they are not
> worth the same. A belief about a source, delivered in the register of an observation, is exactly as
> misleading as a heartbeat written by something that never performed the wait — which is the defect this
> entire system was built to remove.
>
> **The mechanism behind the repeats, which is duller and more fixable than carelessness.** Several agents
> worked this branch concurrently and every message arrived stamped `from=general-purpose`. Stable ids
> existed but were not in that header, so each sender was identified by *recognising the content* — and
> content-recognition is inference wearing identification's clothes. It worked until two peers reviewed the
> same paragraph, and then it silently swapped them. **Attribute an inbound claim only when you can
> positively identify its sender; otherwise describe it without a name.** "The agent who told me X" is a
> claim about the world, not a label.
>
> Two qualifications, both of which this blockquote's own rule demands of it. First, do not phrase the
> trigger as *"if two peers share a display name"* — you cannot tell whether they do until they collide,
> and that is the moment it is already too late. The checkable version runs the other way: identify, then
> attribute. Second, and correcting an earlier draft of this very paragraph: the id was missing **from the
> header**, not from the world. The roster carries stable per-agent names and a send returns a stable id,
> so identity here was *obtainable* — just not from the envelope handed to me. "The header does not carry
> it" and "it is not obtainable" are different claims, and only the first was ever true. That is the trap
> above turned on the rule it produced, which is roughly the point.
>
> And note which direction is dangerous. A wrong attribution *backwards* gets caught, because the person
> holding the credit reads it and objects. A wrong attribution *forwards* — thanking the wrong party,
> quoting a rule to someone who never said it — has **no one positioned to catch it**: only the
> non-sender knows what they did not send, and they are the one party not being addressed. Every catch in
> this document's history came from that lone party speaking up. Do not rely on it.

A third scheduler also exists and is worth knowing about, though this system does not use it:
`mcp__scheduled-tasks__create_scheduled_task` — a Claude Code capability that **persists to disk**
(`~/.claude/scheduled-tasks/`), runs while the app is open and on next launch if it was closed, applies a
dispatch jitter of several minutes, and evaluates cron in **local** time.

Do not reach for it as a `CronCreate` substitute without reading this next part. Its schema says each run
**starts fresh with no memory of the conversation**, so it does not run as *you* — it runs as a new agent
wearing your tools. It is not that it cannot re-arm; it is that it knows nothing unless you baked it in.
A re-arm needs a `channel_id` and an exact agent name, so those must be written into the prompt itself or
the run has nothing to act on. And whether a watcher spawned inside such a run outlives that run is
**untested here** — if it dies with the run, the re-arm is cosmetic. Treat it as unproven for this purpose.

**And the limit that must stay prominent: nothing rescues an ENDED session.** Both schedulers fail it, for
opposite reasons, and neither reason cancels the other. `CronCreate` runs as you and *could* re-arm — but
it is session-only and **dies with the session**, so there is nothing left to fire. The portal task
survives the session and still fires — but it runs headless, **not as you**, so it can only tell a human.
**Neither keeps a watch alive across a restart.** Do not let the phrase "we arm both" persuade any reader
that the ended session is covered; it is the one case both miss.

## The measured facts

Measured on **Claude Code 2.1.222**, Windows, headless `-p` with `--plugin-dir`.

1. A `Stop` hook **fires at turn end and its output reaches the model.**
2. **It fires from a plugin's `hooks/hooks.json` too, exactly as it does from a settings file.** Verified
   on Claude Code **2.1.222 and 2.1.85**, Windows, with a bare probe plugin declaring only `SessionStart`
   and `Stop`: both fired on both builds. Neither the event nor the packaging is a variable. So the gate
   ships in the plugin and arms on install.

   > **THIS ENTRY PREVIOUSLY SAID THE OPPOSITE, IN BOLD, AND IT WAS WRONG.** It read "registers but never
   > fires", was scoped down to "registered but did not fire (session-only plugin)", and was false in both
   > forms. The correction matters less than the cause, which is the third instance of one error class in
   > this file's own history.
   >
   > **The cause.** The probe seeded its fixture at a directory passed in through `CLAUDE_PLUGIN_DATA`.
   > Claude Code **overrides that variable for plugin hooks**, pointing it at
   > `~/.claude/plugins/data/<plugin>/`. So the hook ran, read an empty state, correctly concluded this
   > session was on no roster, stayed silent by design — and never touched the seeded file. The untouched
   > file was then read as proof the hook had not executed.
   >
   > It survived scrutiny because the reasoning around it was sound: the signal was a **file write** rather
   > than stdout, chosen specifically so it could not be confused with fact 3's discarded-output problem,
   > and the control (the same hook in a settings file) did fire. Both true. But in the settings-file
   > control there is no plugin, so `CLAUDE_PLUGIN_DATA` was **not** overridden and the fixture was found.
   > The control and the subject differed in a second way nobody had listed.
   >
   > **The transferable rule: a negative result needs a positive control on the SIGNAL, not just on the
   > mechanism.** Proving "the hook writes a file when it runs" requires an unconditional marker written on
   > entry, before any early return, in the same fixture as the subject. A self-suppressing hook — one
   > designed to do nothing in the common case — cannot be tested by watching for the effect it is designed
   > to withhold. "Produced no visible effect" and "did not execute" are different claims, and this file has
   > now confused them once about a tool registry, once about an idle cron, and once about this hook.

   *Provenance.* Both measurements were taken against a **local mock backend**, not the live API: a nested
   `claude -p` on this machine cannot authenticate (the stored credential expired 2026-06-19 with
   `hasRefresh: false`, because the desktop host holds live auth in memory). The reasoning for why the
   result still holds, so a reader can judge it rather than trust it: hook dispatch is part of the turn
   lifecycle and runs regardless of which backend produced the tokens, and the rig discriminates — an
   unauthenticated run produced `SessionStart` but no `Stop`, so a genuine non-firing is recorded as one.
   It has **not** been confirmed against the live API.

3. **Plain stdout from a hook is DISCARDED — for `Stop`, `PostToolUse` and `PreToolUse` alike.** Only
   `{"hookSpecificOutput":{"hookEventName":"…","additionalContext":"…"}}` reaches the model (on `Stop`,
   also `{"decision":"block","reason":"…"}`, and exit code 2 with the message on stderr). This is **not** a
   `Stop`-only problem, and it had a real casualty: the read-after-write gate was built on `echo "…"`, so
   it had been firing correctly and reaching **nobody**. It now runs via `scripts/portal-gate.js` and emits
   `additionalContext`, verified to arrive. Anything a hook needs the model to read must go through
   `additionalContext`.
4. `${CLAUDE_PLUGIN_ROOT}` and `$CLAUDE_PROJECT_DIR` **interpolate correctly** in shell-form hook commands
   on Windows, including paths containing spaces, when the path is wrapped in double quotes.
5. **A `Stop` hook returning `{"decision":"block","reason":"…"}` really holds the turn open.** The turn did
   not end; the model was re-invoked with the reason as its next input. On that re-entry the hook's stdin
   payload carries `stop_hook_active: true`, which is what makes the once-per-turn guard possible.
6. **An idle session is invisible to every hook.** Measured on the roster, not in the harness: the
   coordinator read `ABSENT` for **3 h 06 m** while two workers beside it stayed up and logged **326** and
   **372** heartbeats. No hook misfired; an idle session simply ends no turns, which is the hole the idle
   layer exists to close. This one is server-side and therefore platform-independent.
7. **The hook behaviour above (facts 1–5) is verified on Windows only. It is UNVERIFIED on macOS.** The
   script is Node with no dependencies, so one implementation serves both, but the hook-firing behaviour
   in facts 1–5 has not been re-run on macOS. If you are on a Mac, treat facts 1–5 as unconfirmed until
   you have re-run them, and rely on `list_channel_watchers` in the meantime.

## The alarm under OAuth

The plugin signs in with **OAuth**; there is no API key to paste. That broke the alarm, because the
alarm is a **separate process** and cannot see the session's MCP connection. On a machine where every
portal tool call was working perfectly, the alarm returned `http_401` on seven consecutive turns — the
gate built to catch a silent watcher was itself silently dead. What was measured while fixing it:

1. **A hook is handed no credential, and there is no supported way for it to get one.** The hook
   environment carries `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` and nothing
   secret. The `Stop` payload on stdin (`session_id`, `transcript_path`, `cwd`, `permission_mode`,
   `stop_hook_active`, …) has **no field for MCP servers, their auth state, or a token** — even the
   MCP-specific `Elicitation` hook passes only a server name and URL. There is no `claude mcp` subcommand
   that prints a token (`add / add-from-claude-desktop / add-json / get / list / login / logout / remove /
   reset-project-choices / serve`; `claude mcp get` masks header values).
2. **The tokens are on disk, in plaintext, at a fixed path** — `~/.claude/.credentials.json`, under
   `mcpOAuth`. Claude Code ships a `windows-credman` backend, but on this machine it is dark-launched
   behind a `tengu_windows_credman` feature flag that reads `false`, and even when enabled it falls back
   to the same file. Windows Credential Manager holds **nothing** Claude-related. The file has ordinary
   user ACLs and is not encrypted.
3. **"Every `accessToken` reads EMPTY" is a trap, and it cost real time twice.** The store keeps **one
   entry per authorization and never prunes**. Measured: 20 entries, **19 with `accessToken: ""`**, four
   of them for *this* server — three husks and one live. Sampling the file, or reading the first match,
   yields "they are all empty" and that reading is **wrong**. The live entry is found only by filtering
   on a **future `expiresAt`**.
4. **So the script reads its own entry, under rules.** Only the entry whose `serverUrl` is the endpoint
   it is about to call; **access token only, never the refresh token** (refreshing would be a *write*
   against the host's credential state, from a hook, to raise an alarm); never written, never printed;
   every field treated as untrusted so an unrecognised shape degrades to "no credential" rather than
   throwing. `PORTAL_ALARM_NO_CREDENTIAL_FILE=1` turns the path off entirely. Verified end-to-end
   against the live API: `Authorization: Bearer` → HTTP 200 → real roster → the gate fires on real data,
   with no API key anywhere.
5. **The honest floor.** If that read ever stops working — the flag flips, the format changes, the token
   is expired — the script has **nothing**, and that is a supported state, not a bug to paper over. It
   reports what it saw locally, says plainly that it does not know, and **does not gate**. Never
   reintroduce an API key to "fix" this; the owner moved to OAuth deliberately.

## What this design still cannot do

A `Stop` hook fires at **turn end**. Gating rather than merely speaking closes that exit, but it still only
acts *at* a turn end: the blind gap is shortened to **one turn**, never eliminated. Say that out loud
whenever someone calls this "solved". What still gets through:

- **A very long turn.** An agent grinding for twenty minutes has not ended a turn, so nothing has fired.
  The roster can mark it `ABSENT` for that entire stretch and the gate acts only when the turn finally
  ends. It cannot preempt work in progress. Nor does the idle layer help: `CronCreate` fires only while
  the REPL is *idle*, and a twenty-minute turn is the opposite of idle, so only the server-side portal task
  fires during that stretch — and all it can do is tell a human. Nothing here interrupts the turn.
- **The rest of the turn it just gated.** The block fires once and then the `stop_hook_active` guard
  stands down for that turn. An agent that refuses to spawn the watcher gets a loud notice and its turn
  ends anyway. The gate is deliberately not a trap.
- **The spawn itself.** A hook cannot call the Agent tool, so no hook can start the watcher for you. The
  gate makes stopping conditional on the spawn; it never performs it. If the model does not act, nothing
  in the harness will act for it.
- **A session that has ENDED entirely.** There are no turns left to end, so **no alarm will ever fire**
  in-process. The watcher loop dies with the session while the roster row, the obligation, and the
  `ABSENT` marking all survive. The idle layer changes exactly one thing here: somebody is now **told**.
  It does not rescue the session, and **arming both schedulers does not change that** — `CronCreate` could
  re-arm but died with the session, and the portal task survives but runs headless, not as you. **Neither
  keeps a watch alive across a restart.** Nothing in-process can fix this, because the process is gone.
  Repair belongs to the coordinator's roster read and to the human, permanently.
- **Any adapter with no turn-end hook** — cursor and roo entirely, and copilot, whose `PostToolUse`
  reminder narrows the window but cannot cover an agent that has stopped calling the tool. There, the
  discipline lives only in instructions, and instructions compete for the agent's attention at exactly
  the moment the agent has decided something else matters more. That is not a hypothetical; that is how
  this happened. The portal scheduled task is available there too — it is an MCP call, not a harness
  feature — but nothing on those adapters prompts the agent to arm one, and it is the alarm-only half:
  there is no `CronCreate` equivalent, so an idle absence can be reported but never repaired.
- **An alarm that cannot read the roster.** When there is no usable credential — or the one there is
  gets refused, or the read keeps failing — the script **cannot confirm anything**, and it says so in
  those words, at most once every ten minutes. It then reports the one thing it *does* know without a
  credential: how long since an `await_my_turn` call was observed leaving this machine, for which
  channel and which agent name. That is evidence about this machine, **not** the server's verdict, and
  the message says that too. It **never gates** on it — `decision: block` is spent only on a roster row
  actually read from the server — and it never pretends the roster is clean. The way out is that *the
  agent reading the message* is authenticated even when the hook is not, so `list_channel_watchers` is
  one tool call away.
- **Someone else's absence.** The alarm only speaks about identities *this machine* actually watched
  under. Another agent going quiet is not this session's to answer for; that is the coordinator's read.
- **Anything that stops an agent from stopping.** Nothing can *prevent* an agent from ending its watcher.
  The gate raises the price of having stopped — that turn cannot end quietly — but it stands down after
  one block, so it is pressure, not prevention. What an agent still cannot do is **hide** having stopped,
  or clear its own obligation. Call it pressure; never call it enforcement.

## Never forge a heartbeat

A heartbeat means one thing: **this agent performed the blocking wait.** It is written by `await_my_turn`
itself, server-side, as a side effect of the call really arriving. There is no separate heartbeat tool,
and no hook, script, alarm, or scheduled task may ever write one. The idle keepalive is bound by this too:
it exists to **read** the roster and speak, never to make an absent agent look present.

If a hook wrote a heartbeat, the roster would show liveness for an agent that is not listening — which is
precisely the defect that made four agents look healthy while they were deaf. The alarm's local state file
is **not** a heartbeat: it never leaves the machine, it exists only to decide whether to *ask* the server,
and the server stays the sole authority on status. `watching` must remain evidence, never a claim.

The same rule in its practical form: **re-arm first, then handle.** The instant the watcher returns, start
the next one *before* you read or answer the message. Handling first marks you `ABSENT` for exactly as
long as handling takes — three agents lost 9m25s, 10m14s and 2m20s that way. Re-arming first is safe: the
previous watcher has already returned (that return is what invoked you), so two never run at once; the
cursor is unchanged, so nothing is missed; and the call count is identical, so there is no extra egress.
