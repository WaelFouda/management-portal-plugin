#!/usr/bin/env node
/**
 * xsession-selftest.js — proves the cross-session messaging hooks and monitor BY EFFECT.
 *
 * The hooks are driven as the runtime drives them: the real xsession.js spawned with a fixture
 * payload on stdin and an isolated CLAUDE_PLUGIN_DATA. The monitor's decisions (dedupe, reminders,
 * backoff, which session it belongs to) are pure and tested in-process; its network loop is run
 * end to end against a throwaway HTTP server on 127.0.0.1. Nothing here touches the real plugin
 * data directory, the real backend or the owner's installed plugin.
 *
 *   node scripts/xsession-selftest.js
 */

'use strict';

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const X = require('./xsession.js');
const M = require('./xsession-monitor.js');

const HOOK = path.join(__dirname, 'xsession.js');
const MONITOR = path.join(__dirname, 'xsession-monitor.js');
const SID = '11111111-aaaa-4aaa-8aaa-111111111111';
const TOKEN = 'tok_SELFTEST_7f3a9c_never_real';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  — ' + String(detail).slice(0, 300) : '')); }
}

function tmpData() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xsession-selftest-')); }

function hook(mode, payload, env) {
  const r = spawnSync(process.execPath, [HOOK, mode], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
    env: Object.assign({}, process.env, { CLAUDE_CODE_EXECPATH: '', CLAUDE_PID: '' }, env || {}),
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const FAKE_AGENTS = JSON.stringify([
  { pid: 4242, cwd: 'D:\\work\\other', kind: 'interactive', sessionId: '22222222-bbbb-4bbb-8bbb-222222222222', name: 'Some other session', status: 'idle' },
  { pid: 31337, cwd: 'D:\\work\\cmp', kind: 'interactive', sessionId: SID, name: 'Client Management Platform', status: 'busy' },
], null, 2);

// ---------------------------------------------------------------------------

function caseNameResolution() {
  console.log('\nname resolution');
  const agents = X.parseAgents(FAKE_AGENTS);
  check('parses a fake `claude agents --json`', agents.length === 2);
  check('tolerates a banner before the JSON', X.parseAgents('warning: something\n' + FAKE_AGENTS).length === 2);
  check('garbage parses to []', X.parseAgents('not json').length === 0);

  let r = X.resolveName({ session_id: SID, cwd: 'D:\\work\\cmp' }, agents);
  check('matches sessionId and takes `name`', r.name === 'Client Management Platform' && r.source === 'agents' && r.pid === 31337, JSON.stringify(r));
  r = X.resolveName({ session_id: 'nope-0000-not-listed', session_title: 'My titled run', cwd: 'D:\\work\\cmp' }, agents);
  check('falls back to session_title', r.name === 'My titled run' && r.source === 'session_title', JSON.stringify(r));
  r = X.resolveName({ session_id: 'nope-0000-not-listed', cwd: 'D:\\work\\cmp-folder\\' }, []);
  check('then to the cwd folder name', r.name === 'cmp-folder' && r.source === 'cwd', JSON.stringify(r));

  // The real hook, with the fake listing injected through its test seam.
  const data = tmpData();
  const out = hook('session-start', { session_id: SID, source: 'startup', cwd: 'D:\\work\\cmp', hook_event_name: 'SessionStart' },
    { CLAUDE_PLUGIN_DATA: data, HELMOS_XSESSION_AGENTS_JSON: FAKE_AGENTS });
  let ctx = null;
  try { ctx = JSON.parse(out.stdout).hookSpecificOutput; } catch (_) { /* */ }
  check('SessionStart exits 0 with additionalContext', out.code === 0 && ctx && ctx.hookEventName === 'SessionStart', out.stdout + out.stderr);
  const text = (ctx && ctx.additionalContext) || '';
  check('…asking for register_claude_session with the name and id',
    text.includes('register_claude_session(name="Client Management Platform", cc_session_id="' + SID + '"'), text);
  check('…and a host_label', /host_label="[^"]+"/.test(text), text);
  check('…and never tells Claude to ignore or skip messages', !/ignore|skip/i.test(text.replace(/If the tool is not available, carry on\./, '')), text);
  const rec = X.readJson(path.join(data, 'xsession', SID + '.json'));
  check('writes {session_id, name, cwd, pid}', rec && rec.session_id === SID && rec.name === 'Client Management Platform'
    && rec.cwd === 'D:\\work\\cmp' && rec.pid === 31337, JSON.stringify(rec));

  // Resume: token already there → still asks, and says why.
  fs.writeFileSync(path.join(data, 'xsession', SID + '.token'), TOKEN);
  const again = hook('session-start', { session_id: SID, source: 'resume', cwd: 'D:\\work\\cmp' },
    { CLAUDE_PLUGIN_DATA: data, HELMOS_XSESSION_AGENTS_JSON: FAKE_AGENTS });
  check('on resume it registers again', /register_claude_session/.test(again.stdout) && /resumed/.test(again.stdout), again.stdout);
  check('…and never prints the stored token', !again.stdout.includes(TOKEN) && !again.stderr.includes(TOKEN));

  const bad = hook('session-start', 'not json at all', { CLAUDE_PLUGIN_DATA: data });
  check('a malformed payload exits 0 silently', bad.code === 0 && bad.stdout === '', bad.stdout + bad.stderr);
  const noData = hook('session-start', { session_id: SID }, { CLAUDE_PLUGIN_DATA: '' });
  check('no CLAUDE_PLUGIN_DATA exits 0 silently', noData.code === 0 && noData.stdout === '');
}

function caseTokenCapture() {
  console.log('\ntoken capture (PostToolUse)');
  const shapes = [
    ['content blocks', [{ type: 'text', text: 'Registered "Client Management Platform".\ninbox_token: ' + TOKEN + '\nKeep it.' }]],
    ['{content:[…]}', { content: [{ type: 'text', text: 'ok\ninbox_token: ' + TOKEN }] }],
    ['a plain string', 'inbox_token: `' + TOKEN + '`'],
  ];
  for (const [label, resp] of shapes) check('parses the token from ' + label, X.parseInboxToken(resp) === TOKEN, JSON.stringify(resp));
  check('no token line → null', X.parseInboxToken([{ type: 'text', text: 'Registered.' }]) === null);

  for (const tool of ['mcp__plugin_management-portal_management-portal__register_claude_session',
    'mcp__management-portal__register_claude_session', 'mcp__claude_ai_management-portal__register_claude_session']) {
    const data = tmpData();
    const out = hook('post', { session_id: SID, tool_name: tool,
      tool_input: { name: 'Client Management Platform', cc_session_id: SID, host_label: 'h' },
      tool_response: shapes[0][1] }, { CLAUDE_PLUGIN_DATA: data });
    const f = path.join(data, 'xsession', SID + '.token');
    const got = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    check('stores the token for ' + tool.split('__')[1], got === TOKEN, got);
    check('  …without echoing it on stdout or stderr', !out.stdout.includes(TOKEN) && !out.stderr.includes(TOKEN), out.stdout);
    if (process.platform !== 'win32') check('  …with mode 0600', (fs.statSync(f).mode & 0o777) === 0o600, (fs.statSync(f).mode & 0o777).toString(8));
  }

  // Inside a bulk.
  let data = tmpData();
  hook('post', { session_id: SID, tool_name: 'mcp__management-portal__bulk',
    tool_input: { calls: [{ tool: 'register_claude_session', arguments: { name: 'N', cc_session_id: SID } }] },
    tool_response: [{ type: 'text', text: '[0] register_claude_session ✓\ninbox_token: ' + TOKEN }] }, { CLAUDE_PLUGIN_DATA: data });
  check('captures a token from a bulk that registered', fs.existsSync(path.join(data, 'xsession', SID + '.token')));

  data = tmpData();
  hook('post', { session_id: SID, tool_name: 'mcp__management-portal__bulk',
    tool_input: { calls: [{ tool: 'list_tasks', arguments: {} }] },
    tool_response: [{ type: 'text', text: 'inbox_token: ' + TOKEN }] }, { CLAUDE_PLUGIN_DATA: data });
  check('ignores a bulk that did not register', !fs.existsSync(path.join(data, 'xsession', SID + '.token')));

  data = tmpData();
  hook('post', { session_id: SID, tool_name: 'mcp__management-portal__list_tasks', tool_input: {},
    tool_response: 'inbox_token: ' + TOKEN }, { CLAUDE_PLUGIN_DATA: data });
  check('ignores any other tool', !fs.existsSync(path.join(data, 'xsession', SID + '.token')));

  data = tmpData();
  hook('post', { session_id: SID, tool_name: 'mcp__management-portal__register_claude_session',
    tool_input: { cc_session_id: '../../evil' }, tool_response: 'inbox_token: ' + TOKEN }, { CLAUDE_PLUGIN_DATA: data });
  check('an unsafe cc_session_id falls back to the hook\'s own session_id', fs.existsSync(path.join(data, 'xsession', SID + '.token'))
    && !fs.existsSync(path.join(data, 'evil.token')));

  // Re-registration rotates the token: the file is replaced, never appended.
  data = tmpData();
  const reg = (tok) => hook('post', { session_id: SID, tool_name: 'mcp__management-portal__register_claude_session',
    tool_input: { cc_session_id: SID }, tool_response: 'inbox_token: ' + tok }, { CLAUDE_PLUGIN_DATA: data });
  reg(TOKEN); reg('tok_SELFTEST_rotated_000');
  check('a second registration replaces the token', fs.readFileSync(path.join(data, 'xsession', SID + '.token'), 'utf8') === 'tok_SELFTEST_rotated_000');
}

function caseNotifier() {
  console.log('\nmonitor dedupe');
  const n = new M.Notifier();
  let t = 1000000;
  check('pending 0 prints nothing', n.onResult({ pending: 0 }, t, SID) === null);
  const first = n.onResult({ pending: 1, from: ['Planner'] }, t, SID);
  check('first pending prints one line', typeof first === 'string' && !/\n/.test(first), first);
  check('  …naming the sender and the call to make', /Thoth session "Planner"/.test(first || '')
    && (first || '').includes('check_session_inbox(cc_session_id="' + SID + '")') && /message_thoth_session/.test(first || ''), first);
  check('the same set again prints nothing', n.onResult({ pending: 1, from: ['Planner'] }, t + 30000, SID) === null);
  check('…nor at 119 s', n.onResult({ pending: 1, from: ['Planner'] }, t + 119000, SID) === null);
  const rem = n.onResult({ pending: 1, from: ['Planner'] }, t + M.REMIND_MS, SID);
  check('still pending after ~2 minutes prints a reminder', /still waiting/.test(rem || ''), rem);
  check('a new message (count changes) prints at once', /2 new messages/.test(n.onResult({ pending: 2, from: ['Planner'] }, t + M.REMIND_MS + 1000, SID) || ''));
  check('a new sender prints at once', /"Coder"/.test(n.onResult({ pending: 2, from: ['Coder', 'Planner'] }, t + M.REMIND_MS + 2000, SID) || ''));
  check('the same senders in another order is NOT a change', n.onResult({ pending: 2, from: ['Planner', 'Coder'] }, t + M.REMIND_MS + 3000, SID) === null);
  check('delivered (pending 0) resets', n.onResult({ pending: 0 }, t + M.REMIND_MS + 4000, SID) === null);
  check('…so the same set later prints again', typeof n.onResult({ pending: 1, from: ['Planner'] }, t + M.REMIND_MS + 5000, SID) === 'string');

  // Reminders are capped, then slow down — never a stream.
  const c = new M.Notifier();
  let lines = 0;
  t = 0;
  for (let s = 0; s <= 3600; s += 15) if (c.onResult({ pending: 1, from: ['P'] }, t + s * 1000, SID)) lines++;
  check('an hour of one unread message prints at most 1 + ' + M.REMIND_MAX + ' + 2 lines', lines <= 1 + M.REMIND_MAX + 2, lines);
  check('with no sender it still says who in general', /a Thoth session/.test(M.wakeLine(1, [], SID, false)));
}

function caseBackoff() {
  console.log('\nmonitor backoff');
  const b = new M.Backoff(5000, 60000);
  const seq = [b.next(), b.next(), b.next(), b.next(), b.next(), b.next()];
  check('5 → 10 → 20 → 40 → 60 → 60 s', JSON.stringify(seq) === JSON.stringify([5000, 10000, 20000, 40000, 60000, 60000]), seq);
  b.reset();
  check('reset starts again at 5 s', b.next() === 5000);
  check('parseWait reads pending + from', JSON.stringify(M.parseWait('{"pending":2,"from":["A","B"]}')) === JSON.stringify({ pending: 2, from: ['A', 'B'] }));
  check('parseWait treats garbage as no news', M.parseWait('<html>').pending === 0);
}

function caseSessionPick() {
  console.log('\nmonitor: which session am I');
  const recs = [
    { session_id: SID, pid: 31337, cwd: 'D:\\work\\cmp', t: 100 },
    { session_id: '33333333-cccc-4ccc-8ccc-333333333333', pid: 31337, cwd: 'D:\\work\\cmp', t: 200 }, // after /clear
    { session_id: '22222222-bbbb-4bbb-8bbb-222222222222', pid: 4242, cwd: 'D:\\work\\other', t: 300 },
  ];
  check('by CLAUDE_PID: the newest record of that process (follows /clear)',
    (M.pickSession(recs, { pid: 31337 }) || {}).session_id === '33333333-cccc-4ccc-8ccc-333333333333');
  check('by CLAUDE_CODE_SESSION_ID when the pid has no record', (M.pickSession(recs, { pid: 999, sid: SID }) || {}).session_id === SID);
  check('by cwd as the last resort', (M.pickSession(recs, { cwd: 'd:/work/other/', since: 0 }) || {}).session_id === '22222222-bbbb-4bbb-8bbb-222222222222');
  check('…never another live process\'s record', M.pickSession(recs, { pid: 999, cwd: 'D:\\work\\other', since: 0 }) === null);
  check('nothing known → null', M.pickSession(recs, { pid: 999 }) === null);
  const table = M.parseTable('  10 1\n 20 10\n 30 20\n');
  check('ancestry walks up to a listed claude pid', M.ancestorIn(table, 30, new Set([10])) === 10);
  check('ancestry with no listed pid → null', M.ancestorIn(table, 30, new Set([77])) === null);
}

// ---------------------------------------------------------------------------
// Network: the human reset and the monitor loop, against a throwaway local server.
// ---------------------------------------------------------------------------

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function caseHumanReset() {
  console.log('\nhuman reset (UserPromptSubmit)');
  const seen = [];
  const seenTok = [];
  const s = await server((req, res) => { seen.push(req.method + ' ' + req.url); seenTok.push(req.headers['x-inbox-token']); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  const base = 'http://127.0.0.1:' + s.address().port;
  process.env.HELMOS_XSESSION_BASE = base;
  check('postHuman resolves true on 200', await X.postHuman(X.backendOrigin(), TOKEN, 2000) === true);
  check('…as POST /api/v1/agent-mail/human, token NOT in the URL', seen[0] === 'POST /api/v1/agent-mail/human', seen[0]);
  check('…but in the X-Inbox-Token header', seenTok[0] === TOKEN);

  const data = tmpData();
  fs.mkdirSync(path.join(data, 'xsession'), { recursive: true });
  fs.writeFileSync(path.join(data, 'xsession', SID + '.token'), TOKEN);
  const before = seen.length;
  const t0 = Date.now();
  const r = hook('prompt', { session_id: SID, prompt: 'hi', hook_event_name: 'UserPromptSubmit' },
    { CLAUDE_PLUGIN_DATA: data, HELMOS_XSESSION_BASE: base });
  const took = Date.now() - t0;
  check('the prompt hook exits 0 with no output', r.code === 0 && r.stdout === '', r.stdout + r.stderr);
  for (let i = 0; i < 40 && seen.length === before; i++) await new Promise((z) => setTimeout(z, 100));
  check('…and the reset reached the server (fired by a detached child)', seen.length === before + 1 && /^POST \/api\/v1\/agent-mail\/human/.test(seen[seen.length - 1] || ''), seen.slice(before));
  check('…without the hook waiting on it (' + took + ' ms)', took < 3000, took);

  const none = tmpData();
  const before2 = seen.length;
  hook('prompt', { session_id: SID, prompt: 'hi' }, { CLAUDE_PLUGIN_DATA: none, HELMOS_XSESSION_BASE: base });
  await new Promise((z) => setTimeout(z, 800));
  check('no token → no request', seen.length === before2);
  s.close();

  // An unreachable backend: still exits 0, still quick.
  const dead = 'http://127.0.0.1:9';
  check('postHuman resolves false (never throws) when the backend is down', await X.postHuman(dead, TOKEN, 2000) === false);
  const r2 = hook('prompt', { session_id: SID, prompt: 'hi' }, { CLAUDE_PLUGIN_DATA: data, HELMOS_XSESSION_BASE: dead });
  check('the prompt hook exits 0 with the backend down', r2.code === 0 && r2.stdout === '');
  delete process.env.HELMOS_XSESSION_BASE;
}

async function caseMonitorLoop() {
  console.log('\nmonitor loop (standalone, fake local backend)');
  const ROTATED = 'tok_SELFTEST_rotated_after_401';
  let calls = 0;
  let pendingAfter = Date.now() + 2500;
  const urls = [];
  const toks = [];
  const s = await server((req, res) => {
    urls.push(req.url);
    const tok = req.headers['x-inbox-token'];
    toks.push(tok);
    if (tok === 'tok_SELFTEST_stale') { res.writeHead(401); res.end('{"detail":"bad token"}'); return; }
    calls++;
    const wait = Date.now() < pendingAfter ? Math.min(800, pendingAfter - Date.now()) : 0;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(Date.now() >= pendingAfter ? '{"pending":1,"from":["Planner"]}' : '{"pending":0}');
    }, wait);
  });
  const base = 'http://127.0.0.1:' + s.address().port;
  const data = tmpData();
  const dir = path.join(data, 'xsession');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SID + '.json'), JSON.stringify({ session_id: SID, pid: process.pid, cwd: process.cwd(), t: Date.now() }));
  // Start with a STALE token: the server refuses it, the monitor must wait for the rotated one.
  fs.writeFileSync(path.join(dir, SID + '.token'), 'tok_SELFTEST_stale');

  const child = spawn(process.execPath, [MONITOR, data], {
    env: Object.assign({}, process.env, { CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: '', HELMOS_XSESSION_BASE: base, CLAUDE_PLUGIN_DATA: '' }),
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });

  await new Promise((z) => setTimeout(z, 1500));
  check('a refused (401) token prints nothing', out === '', out);
  fs.writeFileSync(path.join(dir, SID + '.token'), ROTATED); // re-registration rotated it
  pendingAfter = Date.now() + 2500;
  await new Promise((z) => setTimeout(z, 9000));
  child.kill();
  s.close();

  const lines = out.split(/\r?\n/).filter(Boolean);
  check('prints exactly ONE line once mail is pending', lines.length === 1, JSON.stringify(lines));
  check('  …the wake-up line', /^HelmOS: a new message for this session from Thoth session "Planner"/.test(lines[0] || ''), lines[0]);
  check('  …naming check_session_inbox with this session id', (lines[0] || '').includes('check_session_inbox(cc_session_id="' + SID + '")'));
  check('the token never appears on stdout', !out.includes(ROTATED) && !out.includes('tok_SELFTEST_stale'));
  check('…nor on stderr', !err.includes(ROTATED) && !err.includes('tok_SELFTEST_stale'), err);
  check('it re-read the token file after the 401', toks.includes(ROTATED));
  check('it long-polls /api/v1/agent-mail/wait?timeout=25', urls.some((u) => u === '/api/v1/agent-mail/wait?timeout=25'), urls[0]);
  check('no URL ever carries a token (it rides in X-Inbox-Token)', urls.every((u) => !/token=/.test(u)
    && !u.includes(ROTATED) && !u.includes('tok_SELFTEST_stale')), urls);
  check('it did not spin (' + calls + ' accepted polls in ~10 s)', calls < 12, calls);
}

async function main() {
  console.log('xsession selftest — cross-session messaging hooks and monitor');
  for (const c of [caseNameResolution, caseTokenCapture, caseNotifier, caseBackoff, caseSessionPick, caseHumanReset, caseMonitorLoop]) {
    try { await c(); } catch (e) { fail++; console.log('  FAIL  ' + c.name + ' threw: ' + (e && e.stack || e)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
