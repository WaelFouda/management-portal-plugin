#!/usr/bin/env node
/**
 * xsession.js — the Claude Code half of HelmOS cross-session AI messaging.
 *
 * A HelmOS Thoth chat session and this Claude Code session message each other by SESSION NAME.
 * The backend keeps the mailbox; this file only gives the session a name, keeps its inbox token,
 * and tells the backend when a human typed. The wake-up itself is xsession-monitor.js, which Claude
 * arms with the Monitor tool when these hooks ask for it (see ARMING below).
 *
 *   node xsession.js session-start   SessionStart  — resolve the display name, record
 *                                    {session_id, name, cwd, pid}, ask Claude to register
 *   node xsession.js post            PostToolUse on register_claude_session (and bulk) —
 *                                    capture `inbox_token:` into <session_id>.token
 *   node xsession.js prompt          UserPromptSubmit — fire-and-forget POST agent-mail/human
 *                                    (a human typed, so the loop guard resets)
 *   node xsession.js stop            Stop — once per 30 minutes, block the turn end while a
 *                                    registered session has no live inbox monitor
 *
 *   node xsession.js monitor-status|monitor-arm|monitor-rearm|monitor-disarm [session_id]
 *                                    the /monitor-* commands, run from Bash
 *
 * ARMING (1.9.5). Measured 2026-10-30 on 2.1.309: Claude Code never starts the plugin's declared
 * monitor in a desktop-app session (Windows and Mac), while an interactive CLI session does. So
 * Claude arms it itself with the Monitor tool, and the hooks ask for that: SessionStart and the
 * token capture say so, UserPromptSubmit reminds (at most every 10 minutes) and Stop blocks once
 * (at most every 30 minutes — a Monitor run is capped at 30 minutes, so this is the re-arm). All of
 * them stay quiet while a monitor is LIVE (its lock has a running pid and a heartbeat < 90 s old)
 * or the session is disarmed.
 *
 * Files, under ${CLAUDE_PLUGIN_DATA}/xsession/:
 *   <session_id>.json      {session_id, name, name_source, cwd, pid, source, host, t}
 *   <session_id>.token     the inbox token, mode 0600 where the OS honours it
 *   <session_id>.monitor   the live monitor's lock and heartbeat, {pid, t, via}
 *   <session_id>.disarmed  present while /monitor-disarm is in force
 *   <session_id>.nudge     {prompt, stop}: when each hook last asked for the monitor
 *
 * RULES THIS FILE KEEPS, BECAUSE A HOOK IS NOT ALLOWED TO BREAK A SESSION:
 *   · every mode is wrapped; any failure exits 0 with no output;
 *   · the token is never written to stdout, stderr or any log — only to its own file;
 *   · nothing here blocks: the human reset is handed to a detached child and the hook returns.
 *
 * Required by xsession-monitor.js and xsession-selftest.js for the shared helpers, so the CLI
 * only runs when this file is the entry point.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Shared helpers (exported)
// ---------------------------------------------------------------------------

/** A session id is used as a file name, so it must be one. */
function safeId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{5,100}$/.test(s) ? s : null;
}

function dataDir(explicit) {
  const base = explicit || process.env.CLAUDE_PLUGIN_DATA;
  if (!base) return null;
  return path.join(base, 'xsession');
}

function sessionFile(dir, sid) { return path.join(dir, sid + '.json'); }
function tokenFile(dir, sid) { return path.join(dir, sid + '.token'); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** Write via a temp file and rename, so a reader never sees half a file. */
function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  if (mode) { try { fs.chmodSync(tmp, mode); } catch (_) { /* Windows: no POSIX modes */ } }
  fs.renameSync(tmp, file);
  if (mode) { try { fs.chmodSync(file, mode); } catch (_) { /* ditto */ } }
}

function readToken(dir, sid) {
  try {
    const t = fs.readFileSync(tokenFile(dir, sid), 'utf8').trim();
    return t || null;
  } catch (_) { return null; }
}

/**
 * The claude binary to ask for `agents --json`. The desktop app and the CLI both export
 * CLAUDE_CODE_EXECPATH to their children (measured on 2.1.309); a bare `claude` is the fallback.
 */
function claudeBinary() {
  const p = process.env.CLAUDE_CODE_EXECPATH;
  if (p) { try { if (fs.statSync(p).isFile()) return { file: p, shell: false }; } catch (_) { /* fall through */ } }
  return { file: 'claude', shell: process.platform === 'win32' };
}

/** `claude agents --json`, parsed, or [] on any failure. Never throws. */
function listAgents(timeoutMs) {
  try {
    const bin = claudeBinary();
    const opts = { timeout: timeoutMs || 4000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 };
    // A bare `claude` on Windows is claude.cmd, which only a shell can run; a fixed command string
    // (no user input in it) avoids passing args alongside shell:true.
    const out = bin.shell
      ? execSync('claude agents --json', opts)
      : execFileSync(bin.file, ['agents', '--json'], opts);
    return parseAgents(out);
  } catch (_) { return []; }
}

function parseAgents(text) {
  try {
    const s = String(text || '');
    const i = s.indexOf('[');
    const arr = JSON.parse(i > 0 ? s.slice(i) : s);
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a === 'object') : [];
  } catch (_) { return []; }
}

function cleanName(v) {
  const s = String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 120) : null;
}

/**
 * This session's display name: the `name` that `claude agents --json` lists for our sessionId,
 * then the custom title SessionStart carries, then the working directory's folder name.
 */
function resolveName(payload, agents) {
  const sid = String((payload && payload.session_id) || '');
  const hit = (agents || []).find((a) => String(a.sessionId || a.session_id || '') === sid);
  const fromAgents = hit && cleanName(hit.name);
  if (fromAgents) return { name: fromAgents, source: 'agents', pid: Number(hit.pid) || null };
  const title = cleanName(payload && (payload.session_title || payload.title));
  if (title) return { name: title, source: 'session_title', pid: hit ? Number(hit.pid) || null : null };
  const cwd = (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const folder = cleanName(path.basename(String(cwd).replace(/[\\/]+$/, '')));
  return { name: folder || 'Claude Code session', source: 'cwd', pid: hit ? Number(hit.pid) || null : null };
}

/** Every string inside a tool_response, whatever shape the runtime hands over. */
function flattenText(node, depth, acc) {
  const out = acc || [];
  if (node === null || node === undefined || (depth || 0) > 8) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const x of node) flattenText(x, (depth || 0) + 1, out); return out; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) flattenText(node[k], (depth || 0) + 1, out); }
  return out;
}

/** The `inbox_token: <token>` line the backend returns once from register_claude_session. */
function parseInboxToken(toolResponse) {
  const text = flattenText(toolResponse).join('\n');
  const m = text.match(/inbox_token\s*[:=]\s*[`"']?([A-Za-z0-9._~+\/=-]{8,512})/);
  return m ? m[1] : null;
}

/** The backend origin, from the plugin's own .mcp.json (its URL ends with /mcp). */
function backendOrigin(pluginRoot) {
  if (process.env.HELMOS_XSESSION_BASE) {
    const b = String(process.env.HELMOS_XSESSION_BASE).replace(/\/+$/, '');
    if (/^https?:\/\//.test(b)) return b;
  }
  const fallback = 'https://client-management-api-1uk1.onrender.com';
  try {
    const cfg = readJson(path.join(pluginRoot || path.join(__dirname, '..'), '.mcp.json')) || {};
    const servers = cfg.mcpServers || cfg;
    const s = servers['management-portal'] || Object.values(servers).find((v) => v && v.url);
    const u = new URL(String(s.url));
    return u.origin;
  } catch (_) { return fallback; }
}

/** Bare tool name for both spellings (and the claude.ai / uuid server names). */
function bareTool(raw) {
  const s = String(raw || '');
  const i = s.lastIndexOf('__');
  return s.startsWith('mcp__') && i > 4 ? s.slice(i + 2) : s;
}

/**
 * The inbox token goes in this header, never in the URL: the backend's access log prints the full
 * request line, query string included, so a `?token=` URL put the live token in the server log on
 * every long-poll (measured in the 2026-10-29 live E2E).
 */
const TOKEN_HEADER = 'X-Inbox-Token';

/** A tiny HTTP(S) request with a hard timeout. Resolves {status, body} or rejects. */
function request(method, urlStr, timeoutMs, extraHeaders) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const mod = u.protocol === 'http:' ? require('http') : require('https');
    const headers = Object.assign({ 'accept': 'application/json', 'content-length': 0 }, extraHeaders || {});
    const req = mod.request(u, { method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 65536) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

/** POST /api/v1/agent-mail/human (token in X-Inbox-Token) — true on 2xx, false otherwise. Never throws. */
async function postHuman(origin, token, timeoutMs) {
  try {
    const r = await request('POST', origin + '/api/v1/agent-mail/human', timeoutMs || 2000, { [TOKEN_HEADER]: token });
    return r.status >= 200 && r.status < 300;
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Which session, and is its monitor live (shared with xsession-monitor.js)
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const LOCK_FRESH_MS = 90 * 1000;          // a heartbeat older than this is not a live monitor
const PROMPT_NUDGE_MS = 10 * 60 * 1000;   // UserPromptSubmit reminds at most this often
const STOP_NUDGE_MS = 30 * 60 * 1000;     // Stop blocks at most this often
const MONITOR_DESCRIPTION = 'HelmOS inbox: a Thoth session sent this session a message';
const MONITOR_TIMEOUT_MS = 1800000;       // the Monitor tool's cap

function lockFile(dir, sid) { return path.join(dir, sid + '.monitor'); }
function disarmFile(dir, sid) { return path.join(dir, sid + '.disarmed'); }
function nudgeFile(dir, sid) { return path.join(dir, sid + '.nudge'); }

function readRecords(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f))).filter(Boolean);
  } catch (_) { return []; }
}

/** The session record a monitor (or a CLI) belongs to, from the files SessionStart wrote. */
function pickSession(records, who) {
  const recs = (records || []).filter((r) => r && safeId(r.session_id));
  const newest = (xs) => xs.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))[0] || null;
  if (who.pid) {
    const byPid = newest(recs.filter((r) => Number(r.pid) === Number(who.pid)));
    if (byPid) return byPid;
  }
  if (who.sid) {
    const bySid = recs.find((r) => r.session_id === who.sid);
    if (bySid) return bySid;
  }
  // Last resort: a fresh record for this cwd that does not belong to some OTHER live process.
  if (who.cwd) {
    const norm = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
    return newest(recs.filter((r) => norm(r.cwd) === norm(who.cwd) && (Number(r.t) || 0) >= (who.since || 0)
      && (!r.pid || !who.pid || Number(r.pid) === Number(who.pid))));
  }
  return null;
}

/** process.kill(pid, 0): true while it runs (EPERM is someone else's live process). */
function pidAlive(pid) {
  const n = Number(pid);
  if (!n || n < 1) return false;
  try { process.kill(n, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

/** {live, pid, age, lock}. Live = the lock's pid is running AND its heartbeat is under 90 s old. */
function monitorState(dir, sid, now) {
  const lock = readJson(lockFile(dir, sid));
  if (!lock) return { live: false, pid: null, age: null, lock: null };
  const pid = Number(lock.pid) || null;
  const age = (now || Date.now()) - (Number(lock.t) || 0);
  return { live: Boolean(pid && age > -5000 && age < LOCK_FRESH_MS && pidAlive(pid)), pid, age, lock };
}

function isDisarmed(dir, sid) { return fs.existsSync(disarmFile(dir, sid)); }

/**
 * True, and recorded, when this hook last nudged more than `gapMs` ago. A nudge that cannot be
 * recorded is not made: an unrecorded Stop block would block every turn end.
 */
function takeNudge(dir, sid, kind, gapMs, now) {
  const t = now || Date.now();
  const rec = readJson(nudgeFile(dir, sid)) || {};
  if (t - (Number(rec[kind]) || 0) < gapMs) return false;
  rec[kind] = t;
  try { writeAtomic(nudgeFile(dir, sid), JSON.stringify(rec)); } catch (_) { return false; }
  return true;
}

/** The exact command the Monitor tool runs. Forward slashes on Windows: the Monitor shell is bash. */
function monitorCommand(base, sid) {
  const fwd = (p) => (process.platform === 'win32' ? String(p).replace(/\\/g, '/') : String(p));
  return 'node "' + fwd(path.join(PLUGIN_ROOT, 'scripts', 'xsession-monitor.js')) + '" "' + fwd(path.resolve(base)) + '" "' + sid + '"';
}

/** The arming call on one line, for hook text. */
function armCall(base, sid) {
  return 'the Monitor tool with command `' + monitorCommand(base, sid) + '`, description "' + MONITOR_DESCRIPTION
    + '" and timeout_ms ' + MONITOR_TIMEOUT_MS;
}

/**
 * Every plugin data directory a CLI process could mean, best evidence first. A Bash command is not
 * given CLAUDE_PLUGIN_DATA (measured on 2.1.309), so it is derived: an installed plugin lives at
 * <config>/plugins/cache/<marketplace>/<plugin>/<version> and keeps its data at
 * <config>/plugins/data/<plugin>-<marketplace> (cache/portal/management-portal/1.9.4 →
 * data/management-portal-portal on the owner's machine). Every other data directory follows, so a
 * --plugin-dir copy (data/<plugin>-inline) is found by the record it holds.
 */
function dataBaseCandidates() {
  if (process.env.CLAUDE_PLUGIN_DATA) return [process.env.CLAUDE_PLUGIN_DATA];
  const out = [];
  const parts = PLUGIN_ROOT.split(/[\\/]+/);
  const n = parts.length;
  if (n >= 5 && /^cache$/i.test(parts[n - 4]) && /^plugins$/i.test(parts[n - 5])) {
    out.push(path.join(PLUGIN_ROOT, '..', '..', '..', '..', 'data', parts[n - 2] + '-' + parts[n - 3]));
  }
  const all = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins', 'data');
  try { for (const e of fs.readdirSync(all)) out.push(path.join(all, e)); } catch (_) { /* none */ }
  const seen = new Set();
  return out.filter((p) => { const k = path.resolve(p).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * This session, for a CLI run from Bash: an explicit id, then CLAUDE_CODE_SESSION_ID, then the newest
 * record of CLAUDE_PID, then the newest record for this cwd. → {base, dir, sid, rec, how} or null.
 */
function resolveSession(explicitSid) {
  const explicit = safeId(explicitSid);
  const who = { sid: explicit || safeId(process.env.CLAUDE_CODE_SESSION_ID), pid: Number(process.env.CLAUDE_PID) || null,
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), since: 0 };
  const homes = dataBaseCandidates().map((base) => {
    const dir = path.join(base, 'xsession');
    return { base, dir, recs: readRecords(dir) };
  });
  const steps = [
    who.sid && ['session id', (recs) => recs.find((r) => r.session_id === who.sid)],
    !explicit && who.pid && ['CLAUDE_PID', (recs) => pickSession(recs, { pid: who.pid })],
    !explicit && ['cwd', (recs) => pickSession(recs, { cwd: who.cwd, since: 0, pid: who.pid })],
  ].filter(Boolean);
  for (const [how, pick] of steps) {
    for (const h of homes) {
      const rec = pick(h.recs);
      if (rec) return { base: h.base, dir: h.dir, sid: rec.session_id, rec, how };
    }
  }
  if (!explicit) return null;
  const h = homes.find((x) => fs.existsSync(x.dir)) || homes[0];
  return h ? { base: h.base, dir: h.dir, sid: explicit, rec: null, how: 'session id (no record)' } : null;
}

// ---------------------------------------------------------------------------
// Hook plumbing
// ---------------------------------------------------------------------------

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(raw); } };
    const t = setTimeout(finish, 2000);
    if (t.unref) t.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

function quiet() { process.exit(0); }

function context(event, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
  process.exit(0);
}

/** The text SessionStart hands Claude. Exported so the selftest can hold its wording. */
function registerInstruction(name, sid, host, resumed) {
  return '[helmos-xsession] HelmOS cross-session messaging: this Claude Code session is "' + name + '" '
    + '(session ' + sid + '). Once, briefly and without commentary, call the management-portal tool '
    + 'register_claude_session(name="' + name.replace(/"/g, '\\"') + '", cc_session_id="' + sid + '", '
    + 'host_label="' + host.replace(/"/g, '\\"') + '")'
    + (resumed ? ' again — this session was resumed, and registering refreshes its link' : '')
    + ', so HelmOS Thoth sessions can message it by name. The reply carries a one-time inbox token that the '
    + 'plugin stores for the wake-up monitor; do not repeat it. If the tool is not available, carry on.';
}

/** SessionStart's arming text, or '' while disarmed or while a monitor is already live. */
function armAdvice(dir, sid, base) {
  if (!base || isDisarmed(dir, sid) || monitorState(dir, sid).live) return '';
  return '[helmos-xsession] Once registered, arm the wake-up monitor yourself — Claude Code does not start the '
    + 'plugin\'s declared monitor in every session (desktop-app sessions never do): call ' + armCall(base, sid)
    + '. If it exits at once, another monitor already watches this session. A Monitor run lasts at most 30 '
    + 'minutes; when it ends, arm it again the same way (/monitor-arm prints the call).';
}

async function modeSessionStart() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw) || {}; } catch (_) { return quiet(); }
  const sid = safeId(payload.session_id);
  const dir = dataDir();
  if (!sid || !dir) return quiet();
  if (process.env.HELMOS_XSESSION === 'off') return quiet();

  const agents = process.env.HELMOS_XSESSION_AGENTS_JSON !== undefined
    ? parseAgents(process.env.HELMOS_XSESSION_AGENTS_JSON) // test seam: a fake `claude agents --json`
    : listAgents(4000);
  const r = resolveName(payload, agents);
  const pid = r.pid || Number(process.env.CLAUDE_PID) || null;
  const host = cleanName(os.hostname()) || 'host';
  const rec = {
    session_id: sid, name: r.name, name_source: r.source,
    cwd: payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    pid, source: payload.source || null, host, t: Date.now(),
  };
  try { writeAtomic(sessionFile(dir, sid), JSON.stringify(rec, null, 2)); } catch (_) { /* still ask */ }
  const hasToken = fs.existsSync(tokenFile(dir, sid));
  const arm = armAdvice(dir, sid, process.env.CLAUDE_PLUGIN_DATA);
  // A compaction is the same live session with the same live link: asking again after every
  // compaction would be noise. Startup, resume and /clear always ask. The monitor is asked for
  // only if none is live.
  if (payload.source === 'compact' && hasToken) return arm ? context('SessionStart', arm) : quiet();
  const resumed = payload.source === 'resume' || hasToken;
  return context('SessionStart', registerInstruction(r.name, sid, host, resumed) + (arm ? '\n' + arm : ''));
}

async function modePost() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw) || {}; } catch (_) { return quiet(); }
  const dir = dataDir();
  if (!dir) return quiet();
  const bare = bareTool(payload.tool_name);
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  let ccId = null;
  if (bare === 'register_claude_session') {
    ccId = input.cc_session_id;
  } else if (bare === 'bulk') {
    const calls = Array.isArray(input.calls) ? input.calls : [];
    const reg = calls.find((c) => c && String(c.tool || c.name || '') === 'register_claude_session');
    if (!reg) return quiet();
    ccId = (reg.arguments || reg.args || {}).cc_session_id;
  } else {
    return quiet();
  }

  const token = parseInboxToken(payload.tool_response);
  if (!token) return quiet();
  // The id Claude registered under is the one whose monitor must find the token; the hook's own
  // session_id stands in when the call did not carry a usable one.
  const sid = safeId(ccId) || safeId(payload.session_id);
  if (!sid) return quiet();
  try { writeAtomic(tokenFile(dir, sid), token, 0o600); } catch (_) { return quiet(); }
  if (isDisarmed(dir, sid)) {
    return context('PostToolUse', '[helmos-xsession] Inbox link stored for this session. Its inbox monitor is '
      + 'disarmed (/monitor-arm re-enables it). No need to repeat the token.');
  }
  if (!monitorState(dir, sid).live) {
    return context('PostToolUse', '[helmos-xsession] Inbox link stored for this session. No inbox monitor is '
      + 'watching it yet, so a Thoth message would not wake it: arm one now — call ' + armCall(process.env.CLAUDE_PLUGIN_DATA, sid)
      + '. No need to repeat the token.');
  }
  return context('PostToolUse', '[helmos-xsession] Inbox link stored for this session; the inbox monitor already '
    + 'running for it will wake it when a Thoth session sends a message. No need to repeat the token.');
}

async function modePrompt() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw) || {}; } catch (_) { return quiet(); }
  const sid = safeId(payload.session_id);
  const dir = dataDir();
  if (!sid || !dir || process.env.HELMOS_XSESSION === 'off') return quiet();
  if (!fs.existsSync(tokenFile(dir, sid))) return quiet();
  // Fire and forget: a detached child makes the request, so the prompt never waits on the network.
  // The token travels by FILE PATH, never on a command line where a process listing would show it.
  try {
    const child = spawn(process.execPath, [__filename, 'human-post', tokenFile(dir, sid)], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    });
    child.unref();
  } catch (_) { /* never fail the prompt */ }
  if (!isDisarmed(dir, sid) && !monitorState(dir, sid).live
      && takeNudge(dir, sid, 'prompt', PROMPT_NUDGE_MS)) {
    return context('UserPromptSubmit', '[helmos-xsession] No HelmOS inbox monitor is watching this session, so a '
      + 'Thoth message will not wake it. Arm one: call ' + armCall(process.env.CLAUDE_PLUGIN_DATA, sid) + '.');
  }
  return quiet();
}

/**
 * Stop — the re-arm. A Monitor run expires after 30 minutes; the expiry notice wakes the session, the
 * turn ends, and this asks for a new one. Blocks only when the session is registered, not disarmed,
 * has no live monitor, the runtime is not already continuing a Stop block, and Stop has not asked in
 * the last 30 minutes — so it can never block twice in a row.
 */
function stopWanted(dir, sid, payload) {
  if (!sid || !dir || process.env.HELMOS_XSESSION === 'off') return false;
  if (payload && payload.stop_hook_active) return false;
  return fs.existsSync(tokenFile(dir, sid)) && !isDisarmed(dir, sid) && !monitorState(dir, sid).live;
}

/**
 * Did this Stop hook block this turn end, or will it? Asked by canon-gate's Stop, which steps aside
 * rather than spend a second block on the same turn. The hooks may run concurrently, so "it just
 * recorded a Stop nudge (< 20 s ago)" and "it is about to" both count.
 */
function stopBlocks(dir, sid, payload, now) {
  if (!stopWanted(dir, sid, payload)) return false;
  const last = Number((readJson(nudgeFile(dir, sid)) || {}).stop) || 0;
  const age = (now || Date.now()) - last;
  return age < 20 * 1000 || age >= STOP_NUDGE_MS;
}

async function modeStop() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw) || {}; } catch (_) { return quiet(); }
  const sid = safeId(payload.session_id);
  const dir = dataDir();
  const base = process.env.CLAUDE_PLUGIN_DATA;
  if (!stopWanted(dir, sid, payload)) return quiet();
  if (!takeNudge(dir, sid, 'stop', STOP_NUDGE_MS)) return quiet();
  process.stdout.write(JSON.stringify({ decision: 'block', reason: '[helmos-xsession] This session is registered '
    + 'for HelmOS cross-session messages, but no inbox monitor is watching it (a Monitor run lasts at most 30 '
    + 'minutes, and desktop-app sessions never start the plugin\'s own), so a Thoth message would not wake it. '
    + 'Call ' + armCall(base, sid) + ', then end the turn. This asks at most once every 30 minutes; '
    + '/monitor-disarm turns it off.' }));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The /monitor-* commands (run from Bash; plain text out, always exit 0)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function say(lines) { process.stdout.write([].concat(lines).join('\n') + '\n'); }

function ageText(ms) { return ms === null || ms === undefined ? '?' : Math.max(0, Math.round(ms / 1000)) + ' s'; }

function unresolved() {
  say(['No HelmOS cross-session record was found for this session (looked in: '
    + (dataBaseCandidates().map((b) => path.join(b, 'xsession')).join(', ') || 'no plugin data directory') + ').',
  'The SessionStart hook writes one when the session starts; if the session predates the plugin, start a new '
    + 'session or run /clear, then try again.']);
}

/**
 * Stop this session's live monitor and remove its lock. Only a LIVE lock's pid is killed: a stale
 * lock's pid may by now belong to an unrelated process. process.kill terminates on Windows and
 * sends SIGTERM on macOS/Linux (SIGKILL if it is still running 2 s later).
 */
async function stopMonitor(dir, sid) {
  const st = monitorState(dir, sid);
  let stopped = null;
  if (st.live && st.pid !== process.pid) {
    try { process.kill(st.pid, 'SIGTERM'); } catch (_) { /* gone already */ }
    for (let i = 0; i < 20 && pidAlive(st.pid); i++) await sleep(100);
    if (pidAlive(st.pid) && process.platform !== 'win32') { try { process.kill(st.pid, 'SIGKILL'); } catch (_) { /* */ } }
    stopped = st.pid;
  }
  try { fs.unlinkSync(lockFile(dir, sid)); } catch (_) { /* none */ }
  return { stopped, still: stopped ? pidAlive(stopped) : false };
}

function armLines(s) {
  return ['Call the Monitor tool now with exactly:',
    '  command: ' + monitorCommand(s.base, s.sid),
    '  description: "' + MONITOR_DESCRIPTION + '"',
    '  timeout_ms: ' + MONITOR_TIMEOUT_MS,
    'A Monitor run ends after 30 minutes; when it does, arm it again the same way (/monitor-arm).'
      + ' If it exits at once, another monitor already watches this session.'];
}

function title(s) { return '"' + ((s.rec && s.rec.name) || 'unnamed session') + '" (session ' + s.sid + ')'; }

function modeMonitorStatus(sidArg) {
  const s = resolveSession(sidArg);
  if (!s) return unresolved();
  const st = monitorState(s.dir, s.sid);
  const registered = fs.existsSync(tokenFile(s.dir, s.sid));
  say(['HelmOS inbox monitor — ' + title(s),
    '  registered: ' + (registered ? 'yes (inbox token stored)' : 'no — register_claude_session has not stored an inbox token yet'),
    '  monitor:    ' + (st.live ? 'live — pid ' + st.pid + ', heartbeat ' + ageText(st.age) + ' ago'
      : 'not running' + (st.lock ? ' (stale lock: pid ' + st.pid + ', heartbeat ' + ageText(st.age) + ' ago)' : '')),
    '  disarmed:   ' + (isDisarmed(s.dir, s.sid) ? 'yes — the hooks will not ask to arm it; /monitor-arm clears this' : 'no'),
    '  found by:   ' + s.how,
    '  data:       ' + s.dir]);
}

async function modeMonitorArm(sidArg, rearm) {
  const s = resolveSession(sidArg);
  if (!s) return unresolved();
  try { fs.unlinkSync(disarmFile(s.dir, s.sid)); } catch (_) { /* was not disarmed */ }
  const head = [];
  if (rearm) {
    const r = await stopMonitor(s.dir, s.sid);
    head.push(r.stopped ? 'Stopped the inbox monitor for ' + title(s) + ' (pid ' + r.stopped + (r.still ? ', STILL RUNNING' : '') + ').'
      : 'No live inbox monitor for ' + title(s) + ' to stop.');
  } else {
    const st = monitorState(s.dir, s.sid);
    if (st.live) {
      return say('Already armed: an inbox monitor is live for ' + title(s) + ' — pid ' + st.pid + ', heartbeat '
        + ageText(st.age) + ' ago. Nothing to do.');
    }
    head.push('No live inbox monitor for ' + title(s) + '.');
  }
  if (!fs.existsSync(tokenFile(s.dir, s.sid))) {
    head.push('This session is not registered yet: the monitor will wait for register_claude_session to store its inbox token.');
  }
  say(head.concat(armLines(s)));
}

async function modeMonitorDisarm(sidArg) {
  const s = resolveSession(sidArg);
  if (!s) return unresolved();
  try { writeAtomic(disarmFile(s.dir, s.sid), JSON.stringify({ t: Date.now() })); } catch (_) { /* reported below */ }
  const r = await stopMonitor(s.dir, s.sid);
  say(['Disarmed the inbox monitor for ' + title(s) + '.'
      + (r.stopped ? ' Stopped pid ' + r.stopped + (r.still ? ' (STILL RUNNING — it exits on its own within 15 s).' : '.') : ''),
    'The hooks will not ask to arm it again until /monitor-arm. If this session has a Monitor task running '
      + 'xsession-monitor.js, stop it with TaskStop too.',
    'No message is lost: mail waits in the inbox, and check_session_inbox reads it.']);
}

/** The detached child of modePrompt. */
async function modeHumanPost(file) {
  try {
    const token = fs.readFileSync(file, 'utf8').trim();
    if (token) await postHuman(backendOrigin(), token, 2000);
  } catch (_) { /* nothing to report to anyone */ }
  process.exit(0);
}

module.exports = {
  safeId, dataDir, sessionFile, tokenFile, readJson, writeAtomic, readToken, listAgents, parseAgents,
  resolveName, parseInboxToken, backendOrigin, bareTool, request, postHuman, registerInstruction,
  readRecords, pickSession, pidAlive, monitorState, isDisarmed, takeNudge, lockFile, disarmFile, nudgeFile,
  monitorCommand, armCall, dataBaseCandidates, resolveSession, stopBlocks,
  TOKEN_HEADER, LOCK_FRESH_MS, PROMPT_NUDGE_MS, STOP_NUDGE_MS, MONITOR_DESCRIPTION, MONITOR_TIMEOUT_MS,
};

if (require.main === module) {
  const mode = process.argv[2];
  const run = mode === 'session-start' ? modeSessionStart
    : mode === 'post' ? modePost
    : mode === 'prompt' ? modePrompt
    : mode === 'stop' ? modeStop
    : mode === 'human-post' ? () => modeHumanPost(process.argv[3])
    : mode === 'monitor-status' ? () => modeMonitorStatus(process.argv[3])
    : mode === 'monitor-arm' ? () => modeMonitorArm(process.argv[3], false)
    : mode === 'monitor-rearm' ? () => modeMonitorArm(process.argv[3], true)
    : mode === 'monitor-disarm' ? () => modeMonitorDisarm(process.argv[3])
    : null;
  if (!run) quiet();
  else Promise.resolve().then(run).catch(() => process.exit(0));
}
