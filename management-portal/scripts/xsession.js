#!/usr/bin/env node
/**
 * xsession.js — the Claude Code half of HelmOS cross-session AI messaging.
 *
 * A HelmOS Thoth chat session and this Claude Code session message each other by SESSION NAME.
 * The backend keeps the mailbox; this file only gives the session a name, keeps its inbox token,
 * and tells the backend when a human typed. The wake-up itself is xsession-monitor.js.
 *
 *   node xsession.js session-start   SessionStart  — resolve the display name, record
 *                                    {session_id, name, cwd, pid}, ask Claude to register
 *   node xsession.js post            PostToolUse on register_claude_session (and bulk) —
 *                                    capture `inbox_token:` into <session_id>.token
 *   node xsession.js prompt          UserPromptSubmit — fire-and-forget POST agent-mail/human
 *                                    (a human typed, so the loop guard resets)
 *
 * Files, under ${CLAUDE_PLUGIN_DATA}/xsession/:
 *   <session_id>.json   {session_id, name, name_source, cwd, pid, source, host, t}
 *   <session_id>.token  the inbox token, mode 0600 where the OS honours it
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
    + 'plugin stores for its wake-up monitor; do not repeat it. If the tool is not available, carry on.';
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
  // A compaction is the same live session with the same live link: asking again after every
  // compaction would be noise. Startup, resume and /clear always ask.
  if (payload.source === 'compact' && hasToken) return quiet();
  const resumed = payload.source === 'resume' || hasToken;
  return context('SessionStart', registerInstruction(r.name, sid, host, resumed));
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
  return context('PostToolUse', '[helmos-xsession] Inbox link stored for this session; the plugin\'s monitor '
    + 'will wake it when a Thoth session sends a message. No need to repeat the token.');
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
  return quiet();
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
  TOKEN_HEADER,
};

if (require.main === module) {
  const mode = process.argv[2];
  const run = mode === 'session-start' ? modeSessionStart
    : mode === 'post' ? modePost
    : mode === 'prompt' ? modePrompt
    : mode === 'human-post' ? () => modeHumanPost(process.argv[3])
    : null;
  if (!run) quiet();
  else Promise.resolve().then(run).catch(() => process.exit(0));
}
