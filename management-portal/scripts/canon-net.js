#!/usr/bin/env node
/**
 * canon-net.js — the ONE portal read this gate is allowed to make, at Stop only.
 *
 * ZERO NETWORK ON THE HOT PATH. PreToolUse, PostToolUse and UserPromptSubmit never come
 * here. A portal query per write would add a round trip to every tool call, and the
 * existing hooks run on 5s timeouts. Everything those gates need is folded from the
 * local ledger instead.
 *
 * THE CREDENTIAL CODE IS DELIBERATELY DUPLICATED FROM watch-alarm.js:355-413 RATHER THAN
 * SHARED. watch-alarm.js is a shipping Stop gate whose credential handling was hardened
 * against a store full of husks; reaching into it to save a hundred lines would put a
 * live production gate at risk. Both ends carry this note.
 *
 * THE RULES THIS FILE HOLDS ITSELF TO, copied from that hardening:
 *   * ACCESS TOKEN ONLY, NEVER THE REFRESH TOKEN. Refreshing would mint credentials and
 *     rotate the host's state — a write against somebody else's store, from a hook.
 *   * NEVER WRITTEN, NEVER PRINTED, NEVER LOGGED. It lives in memory for one request.
 *   * UNDOCUMENTED, THEREFORE UNTRUSTED. Every field is treated as hostile and an
 *     unrecognised shape degrades to "no credential", which is a fully supported state.
 *   * SWITCHABLE OFF with PORTAL_ALARM_NO_CREDENTIAL_FILE=1, same flag watch-alarm uses.
 *
 * ON FAILURE (401, timeout, no credential — this happens routinely on OAuth installs)
 * the caller falls back to local ledger evidence and must LABEL it "local evidence, not
 * a verdict". It must never block on an absent answer.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const L = require('./canon-lib.js');

const DEFAULT_MCP_URL = 'https://client-management-api-1uk1.onrender.com/mcp';
const NET_TIMEOUT_MS = 6000;
const API_KEY_PREFIX = 'sk-';

const MIN_INTERVAL_S = 120;      // at most one read per run per 2 minutes
const WATCH_QUIET_S = 30;        // skip if watch-alarm went to the network just now

function sameResource(u) {
  try {
    const p = new URL(String(u));
    return (p.origin + p.pathname).replace(/\/+$/, '').toLowerCase();
  } catch (_) { return String(u || '').trim().toLowerCase(); }
}

function credFromEnv() {
  const t = (process.env.PORTAL_MCP_TOKEN || process.env.MCP_API_KEY || '').trim();
  return t ? { kind: 'bearer', value: t, source: 'environment' } : null;
}

function credFromHostOAuthStore(wantUrl) {
  if (process.env.PORTAL_ALARM_NO_CREDENTIAL_FILE === '1') return null;
  let store;
  try {
    store = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
  } catch (_) { return null; }
  const entries = store && store.mcpOAuth;
  if (!entries || typeof entries !== 'object') return null;

  const want = sameResource(wantUrl);
  // Never hand over a token that would expire mid-flight. The store NEVER PRUNES, so most
  // entries are husks with no expiry — selecting by a FUTURE expiresAt is what separates
  // the one live token from them.
  const floor = Date.now() + NET_TIMEOUT_MS + 30000;
  let best = null;
  for (const e of Object.values(entries)) {
    if (!e || typeof e !== 'object') continue;
    if (sameResource(e.serverUrl) !== want) continue;
    const token = typeof e.accessToken === 'string' ? e.accessToken.trim() : '';
    if (!token || token.startsWith(API_KEY_PREFIX)) continue;
    const exp = Number(e.expiresAt);
    if (!Number.isFinite(exp) || exp <= floor) continue;
    if (!best || exp > best.exp) best = { exp, token };
  }
  if (!best) return null;
  return { kind: 'bearer', value: best.token, source: "Claude Code's own OAuth entry for this server" };
}

function credentials() {
  const url = process.env.PORTAL_MCP_URL || DEFAULT_MCP_URL;
  const out = [];
  const e = credFromEnv();
  if (e) out.push({ ...e, url });
  const h = credFromHostOAuthStore(url);
  if (h) out.push({ ...h, url });
  return out;
}

/** A label, never the credential. */
function probe() {
  const c = credentials();
  if (!c.length) return 'none available (Stop-time portal read degrades to local evidence)';
  return c.length + ' candidate(s): ' + c.map((x) => x.source).join(', ');
}

function budgetFile() { return path.join(L.HOME, 'net-budget.json'); }

function mayCall(run) {
  if (!run || !run.project_id) return { ok: false, why: 'no run project_id' };
  const b = L.readJSON(budgetFile()) || {};
  const today = new Date().toISOString().slice(0, 10);
  if (b.day !== today) { b.day = today; b.calls = 0; }
  if (b.lastCallAt && (L.nowS() - b.lastCallAt) < MIN_INTERVAL_S) {
    return { ok: false, why: 'rate limited (one read per ' + MIN_INTERVAL_S + 's)' };
  }
  try {
    const base = process.env.CLAUDE_PLUGIN_DATA || os.tmpdir();
    const w = L.readJSON(path.join(base, 'watch-alarm-state.json'));
    if (w && w.lastCheckAt && (L.nowS() - w.lastCheckAt) < WATCH_QUIET_S) {
      return { ok: false, why: 'watch-alarm just used the network' };
    }
  } catch (_) {}
  return { ok: true, budget: b };
}

function noteCall(b) {
  b.lastCallAt = L.nowS();
  b.calls = (b.calls || 0) + 1;
  L.writeJSON(budgetFile(), b);
}

/**
 * ONE round trip settles S1's phases-remain, S3, S5 and S6 — and demonstrates canon (f)
 * in the plugin's own code.
 */
function stopRead(run, cb) {
  const gate = mayCall(run);
  if (!gate.ok) return cb(null, gate.why);
  const creds = credentials();
  if (!creds.length) return cb(null, 'no credential');
  noteCall(gate.budget);

  const cred = creds[0];
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {
      name: 'bulk',
      arguments: {
        stop_on_error: false,
        calls: [
          { tool: 'get_proposal_detail', arguments: { project_id: run.project_id } },
          { tool: 'list_tasks', arguments: { project_id: run.project_id } },
          { tool: 'list_flow_clusters', arguments: {} },
          { tool: 'list_flow_connections', arguments: {} },
        ],
      },
    },
  });

  let u;
  try { u = new URL(cred.url); } catch (_) { return cb(null, 'bad url'); }
  const req = https.request({
    hostname: u.hostname, port: u.port || 443, path: u.pathname,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + cred.value,
      'content-length': Buffer.byteLength(body),
    },
    timeout: NET_TIMEOUT_MS,
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { if (data.length < 200000) data += d; });
    res.on('end', () => {
      if (res.statusCode !== 200) return cb(null, 'http_' + res.statusCode);
      cb(summarise(data), null);
    });
  });
  req.on('error', () => cb(null, 'network error'));
  req.on('timeout', () => { try { req.destroy(); } catch (_) {} cb(null, 'timeout'); });
  req.end(body);
}

/**
 * STRUCTURE ONLY. Counts phases and their statuses and looks for EMPTY required fields.
 * It never judges whether any of the text is good — that is §9, and no hook can do it.
 */
function summarise(raw) {
  const text = String(raw);
  const phases = [];
  const RE_PHASE = /phase[^\n]*?status[:\s]+([a-z_]+)/gi;
  let m;
  while ((m = RE_PHASE.exec(text))) phases.push(m[1].toLowerCase());
  const terminal = phases.filter((s) => /complete|delivered|done|cancelled/.test(s)).length;
  const emptyFields = [];
  for (const f of ['objective', 'deliverables', 'acceptance_criteria', 'timeline', 'deadline', 'description']) {
    const re = new RegExp(f + '[:\\s]+(?:\\(none\\)|none|null|-|$)', 'i');
    if (re.test(text)) emptyFields.push(f);
  }
  return {
    at: L.nowS(),
    phases: phases.length,
    terminal,
    allTerminal: phases.length > 0 && terminal === phases.length,
    emptyFields,
  };
}

module.exports = { stopRead, probe, credentials, summarise, mayCall };
