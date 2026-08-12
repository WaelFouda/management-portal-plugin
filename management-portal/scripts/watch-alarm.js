#!/usr/bin/env node
/**
 * watch-alarm.js — the ABSENT alarm for the Team Chat watch roster.
 *
 * THE PROBLEM THIS SOLVES IS LATENCY, NOT DELIVERY.
 * Messages are never lost. The `since` cursor guarantees that whenever an agent
 * next calls await_my_turn it receives everything it missed. An agent that stops
 * watching for ten minutes loses ten minutes of responsiveness and zero messages.
 * This script exists to shorten that gap, not to rescue dropped mail.
 *
 * WHY A HOOK. Skills and instructions failed repeatedly because they compete for
 * the agent's attention at exactly the moment the agent has decided something else
 * matters more. A hook has no agent in its failure path: the runtime runs it at
 * turn end whether or not the model remembers it exists.
 *
 * THREE MODES
 *   record    (PostToolUse)  Notes locally that THIS machine really did call
 *                            await_my_turn / start_watching_channel, and for whom.
 *                            Always silent, always exit 0.
 *   check     (Stop)         At turn end, decides whether to raise the alarm.
 *   preflight (SessionStart) Says out loud when the alarm is not actually armed.
 *
 * WHY preflight EXISTS.
 * A hook that looks installed and does nothing is worse than no hook. Preflight checks
 * at session start that a `Stop` entry running this script actually exists — in the
 * plugin's own hooks.json when running as a plugin, or in a settings file otherwise —
 * and says so out loud when it does not. It never edits your configuration.
 *
 * A CORRECTION WORTH KEEPING, because an earlier version of this file asserted the
 * opposite in capitals. This once read "a Stop hook in a plugin registers but NEVER
 * FIRES". That was wrong. A plugin `Stop` hook fires normally — verified on Claude
 * Code 2.1.222 and 2.1.85 with a bare probe plugin.
 *
 * The false result came from the probe, not the runtime: the test seeded its fixture
 * at a path passed via CLAUDE_PLUGIN_DATA, but Claude Code OVERRIDES that variable for
 * plugin hooks, pointing it at ~/.claude/plugins/data/<plugin>/. So the hook ran, read
 * an empty state, correctly stayed silent, and never touched the seeded file — and the
 * untouched file was read as "the hook did not fire". Produced-no-visible-effect is not
 * did-not-execute. If you ever need to prove a self-suppressing hook ran, make it write
 * an unconditional marker on entry, before any early return, and do not assume your
 * environment reaches it.
 *
 * ==========================================================================
 * IT NEVER WRITES A HEARTBEAT. THIS IS THE ONE RULE THAT MUST NOT BE RELAXED.
 * ==========================================================================
 * A heartbeat means "this agent performed the blocking wait." It is written by
 * await_my_turn itself, server-side, as a side effect of the call really arriving.
 * If a hook or a script wrote one, the roster would show liveness for an agent that
 * is not listening — which is precisely the defect that made four agents look
 * healthy while they were deaf. The local state file below is NOT a heartbeat: it
 * never leaves this machine, it is only ever used to decide whether to ASK the
 * server, and the server remains the sole authority on status.
 *
 * The only network call is a READ: list_channel_watchers.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// The server marks a watcher ABSENT after 300s without a heartbeat
// (_WATCH_ABSENT_AFTER_S in backend/ai/tools/team_chat_tools.py). We start
// suspecting slightly earlier so the alarm can beat the roster to it.
const LOCAL_STALE_S = 240;

// Hard ceiling on the roster read. A turn must never wait long on the network.
// Measured: this backend is on Render and a cold instance answered in ~3.3s, so a
// 3s bound produced false "could not read the roster" notices for a PERFECTLY
// HEALTHY agent. An alarm that cries wolf gets tuned out exactly like one that
// never fires, so this is deliberately generous — and it is only ever paid on the
// path where we already suspect something is wrong.
const NET_TIMEOUT_MS = 6000;

// One flaky request is not news. Only report a read failure once it has persisted,
// so a single slow response never produces a scary message.
const FAILURES_BEFORE_NOTICE = 3;

// Egress guard. This project runs near a 5 GB/month Supabase cap, and Stop fires
// on every turn. Never poll the roster more than once per this interval.
const MIN_CHECK_INTERVAL_S = 30;

// Failures are loud, but not once-per-turn loud.
const FAILURE_NOTICE_INTERVAL_S = 600;

// Forget stale bookkeeping so the state file cannot grow without bound.
const ENTRY_TTL_S = 24 * 60 * 60;

const DEFAULT_MCP_URL = 'https://client-management-api-1uk1.onrender.com/mcp';

// Statuses the server computes. "watching" and "released" are fine; these are not.
const ALARM_STATUSES = new Set(['ABSENT', 'NEVER_STARTED']);

// ---------------------------------------------------------------------------
// Local state (never transmitted, never a heartbeat)
// ---------------------------------------------------------------------------

function stateFile() {
  const base = process.env.CLAUDE_PLUGIN_DATA || os.tmpdir();
  return path.join(base, 'watch-alarm-state.json');
}

function readState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* first run, or unreadable — treat as empty */ }
  return { watches: {}, lastCheckAt: 0, lastFailureNoticeAt: 0 };
}

function writeState(state) {
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch (_) { /* state is an optimisation; losing it must never break a turn */ }
}

function nowS() { return Math.floor(Date.now() / 1000); }

/**
 * Compare two project paths without being fooled by the ways Windows spells the
 * same directory. `C:\Users\WAELFO~1\...` and `C:\Users\Wael Fouda\...` are the same
 * place; so are `/` and `\` separators and differing case. A test caught this: the
 * alarm went silent for a genuinely ABSENT agent purely because the 8.3 short name
 * did not string-match the long one.
 *
 * Returns `real: true` only when the path was resolved against the filesystem. The
 * caller must treat anything less as "cannot tell" and KEEP the entry — going quiet
 * because two strings disagree is the failure mode this whole file exists to prevent.
 */
function normPath(p) {
  if (!p) return { value: null, real: false };
  let value = String(p);
  let real = false;
  try {
    value = fs.realpathSync.native(value);
    real = true;
  } catch (_) {
    try { value = path.resolve(value); } catch (_) { /* keep as given */ }
  }
  value = value.replace(/[\\/]+$/, '');
  if (process.platform === 'win32') value = value.toLowerCase().replace(/\//g, '\\');
  return { value, real };
}

// ---------------------------------------------------------------------------
// Credentials
//
// The key is NEVER embedded in any file this plugin ships, and this script never
// writes it anywhere or prints it. Resolution order, first hit wins:
//   1. CLAUDE_PLUGIN_OPTION_MCP_API_KEY — the plugin's own userConfig value,
//      handed to the hook process as an environment variable.
//   2. MCP_API_KEY / PORTAL_API_KEY — what agent-onboarding/shared/mcp.config.md
//      already tells every adapter to use.
//   3. The user's OWN existing MCP client config, which they wrote themselves.
//      We read it; we never create or modify it.
// ---------------------------------------------------------------------------

function keyFromEnv() {
  const names = ['CLAUDE_PLUGIN_OPTION_MCP_API_KEY', 'MCP_API_KEY', 'PORTAL_API_KEY'];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim().startsWith('pfk_live_')) return { key: v.trim(), source: n };
  }
  return null;
}

function pickServer(servers) {
  if (!servers || typeof servers !== 'object') return null;
  const entry = servers['management-portal'];
  if (!entry || !entry.headers) return null;
  const key = entry.headers['X-API-Key'] || entry.headers['x-api-key'];
  if (!key || !String(key).startsWith('pfk_live_')) return null; // skip ${...} placeholders
  return { key: String(key), url: entry.url || DEFAULT_MCP_URL };
}

function keyFromClientConfig() {
  const candidates = [];
  const home = os.homedir();
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  candidates.push({ file: path.join(home, '.claude.json'), project: cwd });
  for (const rel of ['.mcp.json', '.vscode/mcp.json', '.cursor/mcp.json', '.roo/mcp.json']) {
    candidates.push({ file: path.join(cwd, rel), project: null });
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(c.file, 'utf8'));
      if (c.project && parsed.projects) {
        // ~/.claude.json keys projects by absolute path; try a few spellings.
        const variants = [c.project, c.project.replace(/\\/g, '/'), c.project.replace(/\//g, '\\')];
        for (const v of variants) {
          const hit = pickServer(parsed.projects[v] && parsed.projects[v].mcpServers);
          if (hit) return { ...hit, source: c.file };
        }
      }
      const hit = pickServer(parsed.mcpServers || parsed.servers);
      if (hit) return { ...hit, source: c.file };
    } catch (_) { /* absent or malformed — try the next */ }
  }
  return null;
}

function resolveCredentials() {
  const env = keyFromEnv();
  if (env) return { key: env.key, url: process.env.PORTAL_MCP_URL || DEFAULT_MCP_URL, source: env.source };
  const cfg = keyFromClientConfig();
  if (cfg) return { key: cfg.key, url: process.env.PORTAL_MCP_URL || cfg.url, source: cfg.source };
  return null;
}

// ---------------------------------------------------------------------------
// The one network call: a READ of the roster
// ---------------------------------------------------------------------------

function callListWatchers(creds, channelId) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(creds.url); } catch (_) { return resolve({ error: 'bad_url' }); }

    const args = channelId ? { channel_id: channelId } : {};
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_channel_watchers', arguments: args },
    });

    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Key': creds.key,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: NET_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve({ error: `http_${res.statusCode}` });
          try {
            const env = JSON.parse(data);
            const text = env && env.result && env.result.content && env.result.content[0]
              && env.result.content[0].text;
            if (typeof text !== 'string') return resolve({ error: 'unexpected_envelope' });
            // The payload is double-encoded, and failure modes come back as plain prose.
            let payload;
            try { payload = JSON.parse(text); } catch (_) { return resolve({ error: 'tool_error' }); }
            resolve({ payload });
          } catch (_) {
            resolve({ error: 'bad_json' });
          }
        });
      }
    );

    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', () => resolve({ error: 'network' }));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Output. Only additionalContext reaches the model on Stop — VERIFIED, see
// agent-onboarding/WATCH-LAYERS.md. Plain stdout on exit 0 is silently discarded.
// ---------------------------------------------------------------------------

function speak(text, event) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event || 'Stop', additionalContext: text },
  }));
  process.exit(0);
}

/**
 * REFUSE TO LET THE TURN END.
 *
 * This is the difference between a reminder and a gate. `additionalContext` tells an
 * agent it is absent at the exact moment it is trying to leave — which is the same
 * class of mechanism that failed four times in one evening, three of them the
 * coordinator ignoring its own rule. `decision: block` does not ask: the turn does
 * not end until the watcher has been spawned.
 *
 * A hook still cannot spawn a sub-agent — that is a model action and no hook can
 * call the Agent tool. What a hook CAN do is make stopping conditional on it.
 *
 * Only ever called when we are CERTAIN this session owns the absent watch, and never
 * when `stop_hook_active` is set. A wedged session is worse than an absent one.
 */
function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function stayQuiet() { process.exit(0); }

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(raw); } };
    // Never hang a turn waiting on stdin.
    setTimeout(finish, 2000).unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

// ---------------------------------------------------------------------------
// Mode: record  (PostToolUse on await_my_turn / start_watching_channel)
// ---------------------------------------------------------------------------

async function modeRecord() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch (_) { return stayQuiet(); }

  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  const channelId = input.channel_id || null;
  const agentName = input.as_agent || input.agent_name || null;
  if (!channelId) return stayQuiet();

  const state = readState();
  const key = `${channelId}::${agentName || ''}`;
  const prev = state.watches[key] || {};
  state.watches[key] = {
    channelId,
    agentName: agentName || prev.agentName || null,
    // The state file is machine-global, so remember which project took this watch
    // on. Without it, a stale watch from another project would raise an alarm in a
    // session that can do nothing about it, and an alarm you cannot act on is the
    // fastest way to teach yourself to ignore alarms.
    project: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    // "I observed this client really make the call" — local evidence only.
    lastCallAt: nowS(),
    lastTool: tool,
  };

  const cutoff = nowS() - ENTRY_TTL_S;
  for (const k of Object.keys(state.watches)) {
    if ((state.watches[k].lastCallAt || 0) < cutoff) delete state.watches[k];
  }

  writeState(state);

  // --- the two moments an agent is one step from going deaf ---------------
  //
  // Both of these use additionalContext, NOT a bare echo. Measured: plain stdout
  // from a PostToolUse hook is DISCARDED and never reaches the model, exactly as it
  // is for Stop. Only hookSpecificOutput.additionalContext arrives.

  const named = agentName ? ` as "${agentName}"` : '';

  if (tool.endsWith('start_watching_channel')) {
    // You have just accepted an obligation and are one step from forgetting it.
    // Nothing else in the system fires here, and this is where the obligation is
    // taken on — so this is the cheapest possible place to close the gap.
    const nameArg = agentName ? ` the name "${agentName}"` : ' your exact agent name';
    return speak(
      'YOU ARE NOW ON THE WATCH ROSTER — BUT NOTHING IS WATCHING YET.\n'
      + `You just took on channel ${channelId}${named}. start_watching_channel only records `
      + 'the obligation; it does not listen. Until something calls await_my_turn you are on '
      + 'the roster and deaf, and you will read NEVER_STARTED.\n\n'
      + `1. Spawn the team-chat-watcher sub-agent in the background NOW, with that channel_id and${nameArg}. `
      + 'Do it before you reply to anything, including the message that sent you here.\n'
      + '2. Arm the idle checks, because a hook cannot help you when nobody is talking to you. '
      + 'A Stop hook fires at turn END; an idle session has no turns, which is how an agent '
      + 'sits absent for hours. Arm BOTH — they cover different holes and neither alone is '
      + 'enough:\n'
      + '   (a) CronCreate, every few minutes. It fires while you are idle and runs AS YOU, so '
      + 'it is the only one that can actually spawn the watcher and make you reachable again. '
      + 'It is session-only and dies with this session. If you cannot see this tool, say so '
      + 'rather than assuming it is absent — a sub-agent may not see it when the parent can.\n'
      + '   (b) create_scheduled_task(type="recurring", cron_expr="*/5 * * * *") with a '
      + `self-contained prompt: read list_channel_watchers for channel ${channelId}; if `
      + `${agentName ? `"${agentName}"` : 'your agent'} is watching, reply with ONE short line and stop; `
      + 'if it is ABSENT or NEVER_STARTED, post to the channel naming it so a human sees it; '
      + 'if its row is released, call delete_scheduled_task on yourself. This one runs '
      + 'SERVER-SIDE and fires even when every client is closed — but it runs headless, NOT as '
      + 'you, so it can only raise the alarm, never re-arm.\n'
      + '   Keep both terse: a keepalive that floods a channel gets switched off, and a '
      + 'switched-off keepalive protects nothing.'
      // Warning here, at the moment the obligation is accepted, beats warning at the
      // next session start.
      + (stopHookIsArmed() ? '' :
        '\n\nWARNING: the turn-end gate is NOT armed in this session — no Stop hook '
        + 'running watch-alarm.js was found in this plugin or in any settings file. '
        + 'Nothing will stop you from walking away from this watch until that is fixed. '
        + 'Arm it, or treat the two steps above as the only things keeping you reachable.'),
      'PostToolUse'
    );
  }

  // await_my_turn returning with my_turn true is the watcher handing control back.
  // That is the precise instant every re-arm failure happened: the agent gets a
  // message, answers it, and never spawns the watcher again. A quiet return
  // (my_turn false) is the watcher still looping, so say nothing.
  const response = JSON.stringify(payload.tool_response || '');
  const handedBack = /"my_turn"\s*:\s*true/.test(response);
  if (handedBack) {
    return speak(
      'THE WATCHER JUST HANDED CONTROL BACK, WHICH MEANS IT HAS STOPPED WATCHING.\n'
      + 'Answer what it brought you if you need to — but spawn team-chat-watcher again '
      + `for channel ${channelId}${named} in the same turn. Handling a message without `
      + 're-arming is how an agent goes silently deaf, and the roster will show you ABSENT '
      + 'about five minutes from now.',
      'PostToolUse'
    );
  }

  stayQuiet();
}

// ---------------------------------------------------------------------------
// Mode: check  (Stop)
// ---------------------------------------------------------------------------

async function modeCheck() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch (_) { /* still worth checking */ }

  // The loop guard. The runtime sets this when we are re-entering Stop because we
  // already blocked this turn. Blocking again from here is how you build a session
  // that can never finish a turn, so from this point we may INFORM but never GATE.
  const alreadyBlocked = Boolean(payload.stop_hook_active);

  const state = readState();

  // If we gated this turn, the re-entry must be answered from what we already
  // learned, BEFORE the egress guard below can silence it. Otherwise the gate lets
  // the turn go without a word and the agent never finds out it is still deaf.
  // This path costs no network at all: it replays the facts the block was built on.
  if (alreadyBlocked && state.lastBlock && (nowS() - state.lastBlock.at) < 300) {
    const facts = state.lastBlock.facts;
    delete state.lastBlock;
    writeState(state);
    return speak(
      'STILL NOT WATCHING TEAM CHAT — and this turn is being allowed to end anyway.\n'
      + facts + '\n\n'
      + 'The gate fires once per turn on purpose: a session that can never finish a turn '
      + 'is worse than one that is briefly unreachable. It will gate again on your next '
      + 'turn, and keep doing so until a watcher is actually running.'
    );
  }

  const here = normPath(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  // Drop an entry ONLY when we are sure it belongs to a different project. No
  // project recorded (older version), or either side unresolvable, means keep it:
  // a spurious alarm is recoverable, a silent one is the bug we are fixing.
  const watches = Object.values(state.watches || {}).filter((w) => {
    if (!w.project) return true;
    const theirs = normPath(w.project);
    if (!theirs.real || !here.real) return true;
    return theirs.value === here.value;
  });

  // Not on any roster this session could act on -> perfect silence, zero network.
  if (watches.length === 0) return stayQuiet();

  // If every tracked watch made a call recently, the agent is demonstrably
  // watching. Stay silent and do not spend a request.
  const now = nowS();
  const suspect = watches.filter((w) => (now - (w.lastCallAt || 0)) > LOCAL_STALE_S);
  if (suspect.length === 0) return stayQuiet();

  // Egress guard.
  if (now - (state.lastCheckAt || 0) < MIN_CHECK_INTERVAL_S) return stayQuiet();

  const creds = resolveCredentials();
  if (!creds) {
    if (now - (state.lastFailureNoticeAt || 0) > FAILURE_NOTICE_INTERVAL_S) {
      state.lastFailureNoticeAt = now;
      writeState(state);
      return speak(
        '[watch-alarm] The ABSENT alarm cannot check the roster: no management-portal '
        + 'API key found. It looked at CLAUDE_PLUGIN_OPTION_MCP_API_KEY, MCP_API_KEY, '
        + 'PORTAL_API_KEY, and your MCP client config. Until this is fixed the alarm is '
        + 'INERT — it will not tell you when a watcher goes ABSENT. Verify your watch '
        + 'yourself with list_channel_watchers.'
      );
    }
    return stayQuiet();
  }

  state.lastCheckAt = now;
  writeState(state);

  // One read covering every roster in the workspace.
  const { payload: roster, error } = await callListWatchers(creds, null);

  if (error) {
    state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
    const persistent = state.consecutiveFailures >= FAILURES_BEFORE_NOTICE;
    const dueAgain = now - (state.lastFailureNoticeAt || 0) > FAILURE_NOTICE_INTERVAL_S;
    if (persistent && dueAgain) {
      state.lastFailureNoticeAt = now;
      writeState(state);
      return speak(
        `[watch-alarm] The ABSENT alarm could not read the watch roster `
        + `(${error}, ${state.consecutiveFailures} tries in a row). It is NOT telling you `
        + 'that you are fine — it does not know. Check with list_channel_watchers, and '
        + 're-arm if you have stopped watching.'
      );
    }
    writeState(state);
    return stayQuiet();
  }
  state.consecutiveFailures = 0;
  writeState(state);

  const rows = (roster && roster.watchers) || [];
  const trackedNames = new Set(watches.map((w) => (w.agentName || '').toLowerCase()).filter(Boolean));
  const trackedChannels = new Set(watches.map((w) => w.channelId).filter(Boolean));

  // Only alarm about what this session actually took on. Another agent's absence
  // on another channel is not this session's to answer for, and shouting about it
  // is how an alarm earns the right to be ignored.
  //
  // Channel is always known (both recorded tools require channel_id). The agent
  // NAME is only known when as_agent was passed — it is optional on
  // start_watching_channel — so when we have no name we still narrow to the
  // channels this session watched rather than the whole workspace.
  const mine = rows.filter((r) => {
    if (!ALARM_STATUSES.has(r.status)) return false;
    if (trackedChannels.size && r.channel_id && !trackedChannels.has(r.channel_id)) return false;
    if (trackedNames.size === 0) return true;
    return trackedNames.has(String(r.agent_name || '').toLowerCase());
  });

  if (mine.length === 0) return stayQuiet();

  const lines = mine.map((r) => {
    const age = r.seconds_since_heartbeat == null
      ? 'never started'
      : `${Math.round(r.seconds_since_heartbeat)}s since its last heartbeat`;
    return `  - ${r.agent_name} on channel ${r.channel_id} -> ${r.status} (${age})`;
  });

  const facts =
    'The watch roster says this identity is not listening:\n'
    + lines.join('\n') + '\n\n'
    + 'No message has been lost — await_my_turn resumes from its cursor and will hand you '
    + 'everything you missed. What you are losing is TIME: nobody can reach you until a '
    + 'watcher is really waiting.\n\n'
    + 'Spawn the team-chat-watcher sub-agent in the background now, with that exact '
    + 'channel_id and that exact agent name. If you cannot work those out, run /rearm-watch '
    + 'with no arguments.\n'
    + 'A heartbeat is written only by await_my_turn actually running. Nothing else — not '
    + 'this message, not a claim that you re-armed — makes you reachable.';

  // Are we CERTAIN this session owns the absent watch? Blocking turns a false
  // positive from noise into obstruction, so the bar for gating is higher than the
  // bar for speaking:
  //   - we know our own agent NAME, so the roster row was matched by identity and
  //     not merely by channel, and
  //   - at least one watch entry is positively confirmed to belong to THIS project,
  //     resolved against the filesystem rather than string-compared.
  // Anything less and we inform instead. A session that has no business watching
  // must never be wedged.
  const certainlyOurs = trackedNames.size > 0 && here.real && watches.some((w) => {
    if (!w.project) return false;
    const theirs = normPath(w.project);
    return theirs.real && theirs.value === here.value;
  });

  if (alreadyBlocked) {
    // Reached only when the cached-facts path above did not fire. Still never gate
    // twice in one turn.
    return speak(
      'STILL NOT WATCHING TEAM CHAT — and this turn is being allowed to end anyway.\n'
      + facts + '\n\n'
      + 'This gate fires once per turn on purpose. It will gate again on your next turn, '
      + 'and it will keep doing so until a watcher is actually running.'
    );
  }

  if (!certainlyOurs) {
    // Right channel, but we cannot prove the identity or the project is ours.
    return speak(
      'YOU MAY NOT BE WATCHING TEAM CHAT.\n'
      + facts + '\n\n'
      + 'This is a notice rather than a hard stop because this session could not confirm '
      + 'the absent identity is its own. Check with list_channel_watchers before assuming '
      + 'it is someone else.'
    );
  }

  // Remember what this block was built on, so the re-entry can speak without
  // spending another roster read.
  state.lastBlock = { at: now, facts };
  writeState(state);

  block(
    'STOP. YOU ARE NOT WATCHING TEAM CHAT, AND THIS TURN WILL NOT END UNTIL YOU ARE.\n'
    + facts + '\n\n'
    + 'Do it now, in this turn. Telling the user you will re-arm is not re-arming, and '
    + 'finishing your other work first is how every one of tonight\'s four failures '
    + 'happened — three of them by the coordinator, twice after it had already ruled on '
    + 'this exact fix.'
  );
}

// ---------------------------------------------------------------------------
// Mode: preflight  (SessionStart)
//
// Refuses to let the plugin degrade quietly. If the Stop entry is not present in a
// settings file, the ABSENT alarm is INERT, and this says so at session start.
// ---------------------------------------------------------------------------

function stopHookIsArmed() {
  const home = os.homedir();
  const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const files = [
    path.join(proj, '.claude', 'settings.json'),
    path.join(proj, '.claude', 'settings.local.json'),
    path.join(home, '.claude', 'settings.json'),
  ];
  // When we are running as a plugin, the plugin's own hooks.json is a valid home for
  // the Stop entry and it fires from there. Checking only settings files would report
  // a correctly-armed plugin install as unarmed — a false alarm, in the one place that
  // exists to prevent false confidence.
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    files.unshift(path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'hooks.json'));
  }
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      const stop = parsed && parsed.hooks && parsed.hooks.Stop;
      if (!Array.isArray(stop)) continue;
      const found = JSON.stringify(stop).includes('watch-alarm');
      if (found) return true;
    } catch (_) { /* missing or malformed — keep looking */ }
  }
  return false;
}

async function modePreflight() {
  await readStdin(); // drain; content is not needed
  if (stopHookIsArmed()) return stayQuiet();

  // Only nag a session that plausibly cares: one that has watched before.
  const state = readState();
  if (Object.keys(state.watches || {}).length === 0) return stayQuiet();

  return speak(
    '[watch-alarm] The ABSENT alarm is NOT ARMED in this session.\n'
    + 'The turn-end check lives in a Stop hook, and no Stop entry running watch-alarm.js '
    + 'was found — not in this plugin\'s hooks/hooks.json, not in any settings file.\n'
    + 'Until it is armed, NOTHING will tell you when you stop watching Team Chat. '
    + 'Declare it in the plugin, or add this to .claude/settings.json:\n'
    + '  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": '
    + '"node \\"${CLAUDE_PLUGIN_ROOT}/scripts/watch-alarm.js\\" check", '
    + '"timeout": 10 } ] } ] }\n'
    + 'Meanwhile, check your watch by hand with list_channel_watchers, or run '
    + '/rearm-watch.',
    'SessionStart'
  );
}

// ---------------------------------------------------------------------------

const mode = process.argv[2];
if (mode === 'record') {
  modeRecord();
} else if (mode === 'check') {
  modeCheck();
} else if (mode === 'preflight') {
  modePreflight();
} else {
  // Unknown invocation must never break a turn.
  stayQuiet();
}
