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
 *
 * ==========================================================================
 * AND IT CANNOT ALWAYS MAKE THAT READ. THAT IS THE SECOND RULE.
 * ==========================================================================
 * Nothing hands a hook a credential. This script finds one anyway — including
 * on an OAuth install, where it reads its own token out of Claude Code's
 * credential store — but that source is an internal file with no compatibility
 * promise, so having a credential is a convenience and never an assumption. See
 * the Credentials section for what was measured. The alarm therefore has two
 * halves, and only one of them needs the network:
 *
 *   SUSPECT  is local. `record` mode notes every await_my_turn this machine
 *            really made; when the newest one goes stale, something is wrong.
 *            Costs nothing, needs no credential, and is measured evidence about
 *            THIS machine's own behaviour.
 *   CONFIRM  is the roster read. It needs a credential, and it is the only
 *            thing that can turn a suspicion into a fact about the server.
 *
 * The gate — `decision: block` — is spent only on a CONFIRMED roster row. When
 * the script cannot confirm, it reports the local evidence, says in as many
 * words that it does not know, and lets the turn end. An alarm that gated on an
 * unconfirmed guess would be forging a verdict, which is the same sin as forging
 * a heartbeat pointed the other way.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

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

// A credential the server has REFUSED will be refused again. Measured: a revoked
// key sat in the environment and this script spent one request per turn on it,
// seven turns in a row, every one a 401. A refusal is not flakiness and must not
// be retried on the flakiness schedule, so the exact credential that was refused
// is stood down for this long. A DIFFERENT credential is tried immediately.
const CREDENTIAL_RETRY_S = 60 * 60;

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
// WHAT A HOOK CAN REACH, AND WHAT IT CANNOT. Measured on this runtime, because
// guessing here is how the alarm ended up returning 401 seven turns in a row.
//
// This script is a SEPARATE PROCESS. It does not share the session's MCP
// connection, and NOTHING IS HANDED TO IT:
//   * The environment Claude Code gives a hook carries CLAUDE_PROJECT_DIR,
//     CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA. None of them is a credential.
//   * The Stop event JSON on stdin describes the session (session_id,
//     transcript_path, cwd, stop_hook_active, …). It has no field for MCP
//     servers, their auth state, or a token.
//   * There is no `claude mcp …` subcommand that emits a bearer token, and no
//     documented hook-side API for one.
//
// So there is no SUPPORTED channel. There is, however, an observable one: Claude
// Code writes MCP OAuth tokens to ~/.claude/.credentials.json in plaintext, and
// this script reads ITS OWN entry out of that file — see credFromHostOAuthStore
// below for the rules it holds itself to and for why the obvious reading of that
// file ("every accessToken is empty") is wrong. That path is the difference
// between a working alarm and an inert one on an OAuth install.
//
// IT IS ALSO NOT GUARANTEED. It is an internal file with no compatibility
// promise, the token can be expired, and the owner can switch the path off. So
// the resolution below is allowed to come back EMPTY, and everything downstream
// is built to stay useful when it does: report the local evidence, say plainly
// that the roster could not be read, and never gate on a guess. Never "fix" an
// empty result by telling the owner to go back to an API key they deliberately
// stopped using.
//
// Both credential families the server accepts are supported
// (backend/routers/mcp_server.py -> resolve_mcp_credential):
//   * a platform API key    -> `X-API-Key: pfk_live_…`
//   * an OAuth access token -> `Authorization: Bearer …`
//
// Candidates are collected best-first by credentialCandidates(). Explicit
// operator configuration outranks anything inferred, because it is an
// instruction rather than a guess:
//   1. environment — the OAuth names first, then the API-key names.
//   2. the user's OWN existing MCP client config, in either header form. We read
//      it; we never create or modify it.
//   3. this plugin's own OAuth entry in Claude Code's credential store.
// A candidate the server REFUSES is stood down and the next one is tried on the
// following turn. The credential is never embedded in any file this plugin
// ships, and this script never prints, logs or writes one.
// ---------------------------------------------------------------------------

// The server's own discriminator (mcp_inbound_oauth.looks_like_oauth_bearer):
// platform keys are `pfk_live_…`, and anything else is offered to the OAuth
// verifier. Mirroring it here stops the two ends disagreeing about which header
// a given string belongs in.
const API_KEY_PREFIX = 'pfk_live_';

const BEARER_ENV_NAMES = [
  'CLAUDE_PLUGIN_OPTION_MCP_OAUTH_TOKEN', 'MCP_OAUTH_TOKEN', 'PORTAL_OAUTH_TOKEN',
];
const API_KEY_ENV_NAMES = [
  'CLAUDE_PLUGIN_OPTION_MCP_API_KEY', 'MCP_API_KEY', 'PORTAL_API_KEY',
];

/** A token that is really an unexpanded `${VAR}` is not a token. */
function isPlaceholder(v) { return !v || v.includes('${'); }

function credFromEnv() {
  for (const n of BEARER_ENV_NAMES) {
    const v = String(process.env[n] || '').trim().replace(/^Bearer\s+/i, '');
    if (!isPlaceholder(v) && !v.startsWith(API_KEY_PREFIX)) {
      return { kind: 'bearer', value: v, source: n };
    }
  }
  for (const n of API_KEY_ENV_NAMES) {
    const v = String(process.env[n] || '').trim();
    if (v.startsWith(API_KEY_PREFIX)) return { kind: 'api_key', value: v, source: n };
  }
  return null;
}

function pickServer(servers) {
  if (!servers || typeof servers !== 'object') return null;
  const entry = servers['management-portal'];
  if (!entry || !entry.headers) return null;
  const headers = entry.headers;
  const url = entry.url || DEFAULT_MCP_URL;

  const key = headers['X-API-Key'] || headers['x-api-key'];
  if (key && String(key).startsWith(API_KEY_PREFIX)) {
    return { kind: 'api_key', value: String(key), url };
  }
  // An OAuth-era config may carry the token in an Authorization header instead.
  const auth = String(headers.Authorization || headers.authorization || '').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) {
    const token = bearer[1].trim();
    if (token.startsWith(API_KEY_PREFIX)) return { kind: 'api_key', value: token, url };
    if (!isPlaceholder(token)) return { kind: 'bearer', value: token, url };
  }
  return null;
}

function credFromClientConfig() {
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

/** Trailing slash and case are not identity. Used to match one resource, exactly. */
function sameResource(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * THE OAUTH PATH: this plugin's OWN access token, where the host already keeps it.
 *
 * Measured on Claude Code 2.1.227/2.1.231 (Windows): MCP OAuth tokens are written to
 * `~/.claude/.credentials.json` under `mcpOAuth`, in plaintext. A `windows-credman`
 * backend exists in the binary but is dark-launched behind a feature flag and, even
 * when enabled, falls back to this same file. macOS/Linux use the same file.
 *
 * WHY THE FILE "LOOKS EMPTY", which cost real time before it was understood: the store
 * accumulates ONE ENTRY PER AUTHORIZATION and never prunes the old ones. Measured here:
 * 20 entries, 19 with `accessToken: ""`, four of them for this very server — three husks
 * and one live. Reading the first match, or eyeballing the file, yields "every token is
 * empty" and that reading is WRONG. The live entry is found only by filtering on a
 * FUTURE `expiresAt`, which is what the loop below does.
 *
 * THE RULES THIS READ HOLDS ITSELF TO, because a plugin rummaging in its host's
 * credential store is a thing that needs limits rather than cleverness:
 *   * OUR RESOURCE ONLY. An entry is considered only when its `serverUrl` is the MCP
 *     endpoint this script is about to call. This plugin's token, for this plugin's
 *     server, to make one read-only call as the identity the session already uses.
 *     Every other entry in that file — sixteen Anthropic connectors, github, figma —
 *     is never looked at, never parsed for value, never sent anywhere.
 *   * ACCESS TOKEN ONLY, NEVER THE REFRESH TOKEN. Refreshing would mint credentials and
 *     rotate the host's state — a WRITE against somebody else's store, from a hook, to
 *     raise an alarm. Not worth it and not ours to do. An expired token simply means we
 *     have nothing this turn; the session refreshes it in its own time and the next turn
 *     picks the new one up.
 *   * NEVER WRITTEN, NEVER PRINTED, NEVER LOGGED. It exists in memory for one request.
 *   * UNDOCUMENTED, THEREFORE UNTRUSTED. This is an internal file of the host
 *     application with no compatibility promise. Every field is treated as hostile,
 *     nothing throws, and a shape this code does not recognise degrades to "no
 *     credential" — which is a fully supported state with its own honest message. The
 *     alarm must never go silent because a format changed underneath it.
 *   * SWITCHABLE OFF. `PORTAL_ALARM_NO_CREDENTIAL_FILE=1` disables this path entirely
 *     for anyone who would rather the alarm stay inert than have a hook read that file.
 */
function credFromHostOAuthStore(wantUrl) {
  if (process.env.PORTAL_ALARM_NO_CREDENTIAL_FILE === '1') return null;

  let store;
  try {
    const file = path.join(os.homedir(), '.claude', '.credentials.json');
    store = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return null; }

  const entries = store && store.mcpOAuth;
  if (!entries || typeof entries !== 'object') return null;

  const want = sameResource(wantUrl);
  // Never hand over a token that would expire mid-flight.
  const floor = Date.now() + NET_TIMEOUT_MS + 30_000;

  let best = null;
  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== 'object') continue;
    if (sameResource(entry.serverUrl) !== want) continue;
    const token = typeof entry.accessToken === 'string' ? entry.accessToken.trim() : '';
    if (!token || token.startsWith(API_KEY_PREFIX)) continue;
    // A missing expiry is a husk, not a token with an unknown life. Require a real one.
    const exp = Number(entry.expiresAt);
    if (!Number.isFinite(exp) || exp <= floor) continue;
    if (!best || exp > best.exp) best = { exp, token };
  }
  if (!best) return null;

  return {
    kind: 'bearer',
    value: best.token,
    url: wantUrl,
    // A label, never the credential.
    source: "Claude Code's own OAuth entry for this server",
  };
}

/**
 * Every credential this machine can offer, best first.
 *
 * A LIST rather than a single answer, because the two can disagree and the machine
 * this was fixed on is the proof: a revoked `MCP_API_KEY` sat in the environment
 * while a perfectly good OAuth token sat in the host's store, and returning only the
 * first hit meant the alarm 401'd for seven turns beside a credential that worked.
 * Explicit operator configuration still wins — it is an instruction, not a guess —
 * but a candidate the server has REFUSED is stood down and the next one gets its turn.
 */
function credentialCandidates() {
  const url = process.env.PORTAL_MCP_URL || DEFAULT_MCP_URL;
  const out = [];
  const env = credFromEnv();
  if (env) out.push({ ...env, url });
  const cfg = credFromClientConfig();
  if (cfg) out.push({ ...cfg, url: process.env.PORTAL_MCP_URL || cfg.url });
  const host = credFromHostOAuthStore(url);
  if (host) out.push(host);
  return out;
}

/**
 * A truncated SHA-256 of a credential — never the credential.
 *
 * This is written to the local state file so a REFUSED credential can be stood down
 * without standing down credentials in general, and so a freshly-rotated OAuth token
 * is recognised as a different one and tried at once. It has to survive landing in a
 * plaintext file on disk, so it is a one-way digest and it is truncated: the same
 * construction, and the same reasoning, as the backend's own bearer cache keys.
 */
function credFingerprint(cred) {
  return crypto.createHash('sha256')
    .update(`${cred.kind}:${cred.value}`)
    .digest('hex')
    .slice(0, 12);
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
          // The server takes either family and resolves both to the same identity
          // (backend/routers/mcp_server.py -> resolve_mcp_credential).
          ...(creds.kind === 'bearer'
            ? { Authorization: `Bearer ${creds.value}` }
            : { 'X-API-Key': creds.value }),
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: NET_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          // A REFUSAL is not a flaky network. It will be refused again in thirty
          // seconds and in thirty minutes, so it is reported on sight and the
          // credential is stood down rather than retried on the flakiness schedule.
          if (res.statusCode === 401 || res.statusCode === 403) {
            return resolve({ error: `http_${res.statusCode}`, refused: true });
          }
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

/**
 * What this machine saw by itself, with no server and no credential involved.
 *
 * Every line is an observation about THIS process's own bookkeeping — "no
 * await_my_turn was recorded leaving here for N seconds" — and never a claim about
 * what the server thinks. That distinction is the whole reason this text exists
 * separately from the roster text below.
 */
function describeLocalEvidence(suspects, now) {
  return suspects.map((w) => {
    const age = Math.max(0, now - (w.lastCallAt || 0));
    const who = w.agentName ? `"${w.agentName}"` : 'this session (no agent name was recorded)';
    return `  - ${who} on channel ${w.channelId}: no await_my_turn call has been observed `
      + `leaving this machine for ${age}s.`;
  }).join('\n');
}

/**
 * THE HONEST DEGRADED PATH — the one that runs when the roster cannot be read.
 *
 * It reports local evidence, states plainly that it is not a verdict, and does NOT
 * gate. Its one job is to be impossible to mistake for "you are fine": the old
 * version of this said only that the alarm was inert, which was true and useless —
 * it named no channel, no agent and no elapsed time, so there was nothing to act on.
 *
 * The way out is the point. This hook cannot authenticate, but the AGENT READING
 * THIS CAN: the session's own MCP connection is working, so `list_channel_watchers`
 * is one tool call away. The alarm hands the verification to the only party in the
 * room that can perform it.
 */
function reportUnverified(state, now, evidence, why, detail) {
  if (now - (state.lastFailureNoticeAt || 0) <= FAILURE_NOTICE_INTERVAL_S) return stayQuiet();
  state.lastFailureNoticeAt = now;
  writeState(state);

  const cause = {
    absent:
      'It has no credential to check with. If you signed in with OAuth, that is the NORMAL '
      + 'state and there is nothing to fix: this hook is a separate process from your '
      + 'session, it does not share your MCP connection, and Claude Code gives a hook no '
      + 'supported way to borrow it. Do not paste an API key on account of this message.',
    refused:
      'The credential it found was REFUSED by the server (401/403) — revoked, expired or '
      + 'meant for somewhere else. It has stopped retrying that one, rather than spend a '
      + 'request every turn on a credential that will not start working.',
    flaky:
      'The roster read keeps failing, so this is a network or backend problem rather than a '
      + 'credential one.',
  }[why];

  return speak(
    'THE ABSENT ALARM COULD NOT READ THE WATCH ROSTER — SO IT IS NOT TELLING YOU THAT YOU '
    + 'ARE FINE. IT DOES NOT KNOW.\n'
    + cause + (detail ? ` (${detail})` : '') + '\n\n'
    + 'What this machine did observe by itself, which needs no credential:\n'
    + evidence + '\n'
    + '  (The server marks a watcher ABSENT after 300s with no heartbeat, and only '
    + 'await_my_turn actually arriving writes one.)\n\n'
    + 'That is evidence about calls leaving this machine. It is NOT the roster: it cannot '
    + 'prove you are absent, and it cannot prove you are present.\n\n'
    + 'YOU can settle it in one call, because your session is authenticated even though this '
    + 'hook is not. Run list_channel_watchers now and read your own row. If it says ABSENT or '
    + 'NEVER_STARTED, spawn the team-chat-watcher sub-agent in the background for that exact '
    + 'channel_id and agent name — or run /rearm-watch with no arguments and let it work them '
    + 'out. No message has been lost either way; what you are losing is the time until '
    + 'somebody can reach you.'
  );
}

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

  // Everything from here is a claim about the SERVER, so from here it can fail. The
  // local evidence is gathered first precisely because it cannot.
  const evidence = describeLocalEvidence(suspect, now);

  // Pick the best credential that is not currently stood down. A refusal stands down
  // exactly the credential that was refused — by fingerprint, so an OAuth token that
  // has since rotated counts as a new one and is tried immediately.
  const refused = state.refusedCred || null;
  const stillStoodDown = (fp) => Boolean(refused)
    && refused.fp === fp
    && (now - (refused.at || 0)) < CREDENTIAL_RETRY_S;

  const candidates = credentialCandidates();
  let creds = null;
  for (const c of candidates) {
    const fp = credFingerprint(c);
    if (stillStoodDown(fp)) continue;
    creds = { ...c, fp };
    break;
  }

  if (!creds) {
    // Either nothing was found at all, or the only thing found is a known-bad one.
    return reportUnverified(state, now, evidence, candidates.length ? 'refused' : 'absent');
  }

  // Egress guard. Only the network path is rate limited: the messages above and below
  // cost nothing and must not be silenced by a budget that exists for requests.
  if (now - (state.lastCheckAt || 0) < MIN_CHECK_INTERVAL_S) return stayQuiet();

  state.lastCheckAt = now;
  writeState(state);

  // One read covering every roster in the workspace.
  const { payload: roster, error, refused: wasRefused } = await callListWatchers(creds, null);

  if (error) {
    if (wasRefused) {
      // Stand this credential down and say so at once. Waiting for three tries would
      // mean three turns of silence about a credential that is never coming back.
      state.refusedCred = { fp: creds.fp, at: now };
      state.consecutiveFailures = 0;
      writeState(state);
      return reportUnverified(state, now, evidence, 'refused', `${error}, from ${creds.source}`);
    }
    state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
    if (state.consecutiveFailures >= FAILURES_BEFORE_NOTICE) {
      writeState(state);
      return reportUnverified(
        state, now, evidence, 'flaky', `${error}, ${state.consecutiveFailures} tries in a row`
      );
    }
    writeState(state);
    return stayQuiet();
  }
  state.consecutiveFailures = 0;
  delete state.refusedCred;
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
