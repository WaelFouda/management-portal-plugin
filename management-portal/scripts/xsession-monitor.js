#!/usr/bin/env node
/**
 * xsession-monitor.js — wakes this Claude Code session when a HelmOS Thoth session writes to it.
 *
 * Started by Claude Code itself as a plugin MONITOR (monitors/monitors.json), one per session:
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/xsession-monitor.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Every stdout line becomes a notification that wakes an idle session, so STDOUT CARRIES ONLY
 * THE WAKE-UP LINE. Diagnostics go to stderr (the monitor's output file, never a notification),
 * and neither stream ever carries the token or a URL that contains it.
 *
 * The data directory is an ARGUMENT because monitor processes are not given CLAUDE_PLUGIN_DATA in
 * their environment (plugins manifest reference, "Where each variable resolves": monitor commands
 * get ${...} substituted in `command`, nothing exported). The env var is honoured if it is there.
 *
 * WHICH SESSION AM I? A monitor is told nothing about its session, so it works it out, in order:
 *   1. CLAUDE_PID — the claude process that spawned it. Measured 2026-10-29 on 2.1.309 (desktop):
 *      a Monitor-tool command saw CLAUDE_PID and CLAUDE_CODE_SESSION_ID in its environment.
 *      The newest xsession/<id>.json whose `pid` is that process wins — so after /clear (same
 *      process, new session id, a new SessionStart record) the monitor follows the new session.
 *   2. CLAUDE_CODE_SESSION_ID — the record with that id.
 *   3. Process ancestry — walk parent pids up until one is a `pid` listed by `claude agents --json`.
 *   4. The newest record whose cwd is this process's cwd (monitors run in the session's cwd).
 * It re-resolves on every cycle, so a record written after the monitor started is picked up.
 *
 * THE LOOP: wait (polling the files every few seconds) until the session has a token, then long-poll
 *   GET /api/v1/agent-mail/wait?timeout=25   (token in the X-Inbox-Token header, never the URL)
 * → {"pending": N, "from": [...]} prints ONE line, deduped by the Notifier below; {"pending":0} polls
 * again; 401 re-reads the token file (re-registration rotates it); network errors back off 5 → 60 s.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const X = require('./xsession.js');

const REMIND_MS = 120 * 1000;      // still pending and unchanged → remind after ~2 minutes
const REMIND_MAX = 3;              // … at most this many times per unchanged set
const LATE_REMIND_MS = 30 * 60 * 1000; // then no more often than every 30 minutes
const PENDING_PAUSE_MS = 15 * 1000;    // the server answers at once while mail waits; don't spin on it
const TOKEN_POLL_MS = 3000;
const WAIT_TIMEOUT_S = 25;

// ---------------------------------------------------------------------------
// Pure, testable pieces
// ---------------------------------------------------------------------------

/** Decides whether a wait result deserves a line. No clock of its own: callers pass `now`. */
class Notifier {
  constructor() { this.key = null; this.lastAt = 0; this.reminders = 0; }

  /** @returns {string|null} the line to print, or null. */
  onResult(res, now, sid) {
    const n = Number(res && res.pending) || 0;
    if (n <= 0) { this.key = null; this.reminders = 0; return null; }
    const from = [...new Set(((res && res.from) || []).map((x) => String(x)))].sort();
    const key = n + '|' + from.join('\u0001');
    if (key !== this.key) {
      this.key = key; this.lastAt = now; this.reminders = 0;
      return wakeLine(n, from, sid, false);
    }
    const gap = this.reminders < REMIND_MAX ? REMIND_MS : LATE_REMIND_MS;
    if (now - this.lastAt >= gap) {
      this.lastAt = now; this.reminders++;
      return wakeLine(n, from, sid, true);
    }
    return null;
  }
}

function wakeLine(n, from, sid, reminder) {
  const who = from.length
    ? (from.length === 1 ? 'Thoth session "' + from[0] + '"' : 'Thoth sessions ' + from.map((f) => '"' + f + '"').join(', '))
    : 'a Thoth session';
  const what = n === 1 ? 'a new message' : n + ' new messages';
  return 'HelmOS: ' + (reminder ? 'still waiting — ' : '') + what + ' for this session from ' + who
    + ' — call check_session_inbox(cc_session_id="' + sid + '") and reply with message_thoth_session if useful.';
}

/** 5 → 10 → 20 → 40 → 60 → 60 … seconds; reset() after a good answer. */
class Backoff {
  constructor(minMs, maxMs) { this.min = minMs || 5000; this.max = maxMs || 60000; this.cur = 0; }
  next() { this.cur = this.cur ? Math.min(this.max, this.cur * 2) : this.min; return this.cur; }
  reset() { this.cur = 0; }
}

/** Parses the wait endpoint's body; anything unreadable is treated as "no news". */
function parseWait(body) {
  try {
    const j = JSON.parse(String(body || ''));
    return { pending: Number(j.pending) || 0, from: Array.isArray(j.from) ? j.from : [] };
  } catch (_) { return { pending: 0, from: [] }; }
}

/** The session record this monitor belongs to, from the files SessionStart wrote. */
function pickSession(records, who) {
  const recs = (records || []).filter((r) => r && X.safeId(r.session_id));
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

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

function log(msg) {
  try { process.stderr.write('[xsession-monitor ' + new Date().toISOString() + '] ' + msg + '\n'); } catch (_) { /* */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** pid → ppid for every process, or null. One call, at startup only. */
function processTable() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'],
      { timeout: 15000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 });
      return parseTable(out);
    }
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseTable(out);
  } catch (_) { return null; }
}

function parseTable(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length >= 2 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) m.set(Number(p[0]), Number(p[1]));
  }
  return m;
}

/** Walk up from `start` until a pid in `wanted`. */
function ancestorIn(table, start, wanted) {
  let p = start;
  for (let i = 0; i < 64 && p && table; i++) {
    if (wanted.has(p)) return p;
    const parent = table.get(p);
    if (!parent || parent === p) break;
    p = parent;
  }
  return null;
}

function whoAmI() {
  const who = { pid: Number(process.env.CLAUDE_PID) || null, sid: X.safeId(process.env.CLAUDE_CODE_SESSION_ID),
    cwd: process.cwd(), since: Date.now() - 10 * 60 * 1000, how: null };
  if (who.pid) { who.how = 'CLAUDE_PID'; return who; }
  if (who.sid) { who.how = 'CLAUDE_CODE_SESSION_ID'; return who; }
  const agents = X.listAgents(8000);
  const pids = new Set(agents.map((a) => Number(a.pid)).filter(Boolean));
  if (pids.size) {
    const hit = ancestorIn(processTable(), process.pid, pids);
    if (hit) { who.pid = hit; who.how = 'process ancestry'; return who; }
  }
  who.how = 'cwd';
  return who;
}

function alive(pid) {
  if (!pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function readRecords(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => X.readJson(path.join(dir, f))).filter(Boolean);
  } catch (_) { return []; }
}

async function main() {
  const dir = X.dataDir(process.argv[2] || process.env.CLAUDE_PLUGIN_DATA);
  if (!dir) { log('no data directory given; exiting'); return; }
  const origin = X.backendOrigin(path.join(__dirname, '..'));
  const who = whoAmI();
  log('owner resolved by ' + who.how + (who.pid ? ' (pid ' + who.pid + ')' : ''));

  const notifier = new Notifier();
  const backoff = new Backoff(5000, 60000);
  let sid = null;
  let token = null;
  let rejected = null; // a token the server refused; wait for a different one

  for (;;) {
    if (who.pid && !alive(who.pid)) { log('owning claude process is gone; exiting'); return; }

    const rec = pickSession(readRecords(dir), who);
    const nextSid = rec ? rec.session_id : null;
    if (nextSid !== sid) { sid = nextSid; token = null; rejected = null; notifier.onResult({ pending: 0 }, Date.now(), sid); if (sid) log('watching session ' + sid); }
    if (!sid) { await sleep(TOKEN_POLL_MS); continue; }

    const fileTok = X.readToken(dir, sid);
    if (!fileTok || fileTok === rejected) { token = null; await sleep(TOKEN_POLL_MS); continue; }
    token = fileTok;

    const started = Date.now();
    let res;
    try {
      res = await X.request('GET', origin + '/api/v1/agent-mail/wait?timeout=' + WAIT_TIMEOUT_S,
        (WAIT_TIMEOUT_S + 15) * 1000, { [X.TOKEN_HEADER]: token });
    } catch (e) {
      const d = backoff.next();
      log('wait failed (' + ((e && e.code) || (e && e.message) || 'error') + '); retrying in ' + Math.round(d / 1000) + ' s');
      await sleep(d);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      rejected = token; token = null;
      // No backoff: the token-file poll above waits (every few seconds) for a DIFFERENT token.
      log('token refused (' + res.status + '); waiting for re-registration to rotate it');
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      const d = backoff.next();
      log('wait answered HTTP ' + res.status + '; retrying in ' + Math.round(d / 1000) + ' s');
      await sleep(d);
      continue;
    }
    backoff.reset();

    const w = parseWait(res.body);
    const line = notifier.onResult(w, Date.now(), sid);
    if (line) process.stdout.write(line + '\n');
    if (w.pending > 0) await sleep(PENDING_PAUSE_MS);
    else if (Date.now() - started < 2000) await sleep(5000); // a server that does not long-poll
  }
}

module.exports = { Notifier, Backoff, parseWait, pickSession, parseTable, ancestorIn, wakeLine,
  REMIND_MS, REMIND_MAX, LATE_REMIND_MS };

if (require.main === module) {
  process.on('uncaughtException', (e) => { log('fatal: ' + ((e && e.message) || e)); process.exit(0); });
  main().then(() => process.exit(0), (e) => { log('fatal: ' + ((e && e.message) || e)); process.exit(0); });
}
