#!/usr/bin/env node
/**
 * canon-selftest.js — proves every gate BY EFFECT, without a live session.
 *
 * A gate that never fires and a gate that always fires are both useless, so every case
 * here is a PAIR: the violating sequence must produce the refusal, and the compliant
 * sequence must pass through untouched. The escape hatch gets the same treatment — with
 * the stand-down sentinel present, every refusal must disappear.
 *
 * This spawns the real canon-gate.js as a child process with fixture payloads on stdin,
 * exactly as the runtime does, so it exercises the stdin path, the JSON contract and the
 * exit behaviour rather than a convenient in-process shortcut. It runs against an
 * isolated PORTAL_CANON_HOME and never touches the real ledger.
 *
 *   node canon-gate.js selftest
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATE = path.join(__dirname, 'canon-gate.js');
const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-3333-4333-8333-cccccccccccc';
const MCP = 'mcp__plugin_management-portal_management-portal__';

let HOME = null;
let PROJ = null;
let SESSION = 0;
let pass = 0;
let fail = 0;
const failures = [];

function fresh() {
  SESSION++;
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-selftest-'));
  PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-proj-'));
  return 'sess-' + SESSION;
}

function env(extra) {
  return Object.assign({}, process.env, {
    PORTAL_CANON_HOME: HOME,
    CLAUDE_PROJECT_DIR: PROJ,
    PORTAL_CANON: '',
    PORTAL_CANON_STRICT_ID: '1',
  }, extra || {});
}

function gate(mode, payload, extraEnv) {
  const r = spawnSync(process.execPath, [GATE, mode], {
    input: JSON.stringify(payload || {}),
    encoding: 'utf8',
    env: env(extraEnv),
    timeout: 20000,
  });
  const outText = (r.stdout || '').trim();
  let json = null;
  if (outText) { try { json = JSON.parse(outText); } catch (_) { json = null; } }
  return { json, raw: outText, code: r.status, stderr: r.stderr };
}

function cli(args) {
  return spawnSync(process.execPath, [GATE].concat(args), {
    encoding: 'utf8', env: env(), cwd: PROJ, timeout: 20000,
  });
}

function denialOf(res) {
  const h = res.json && res.json.hookSpecificOutput;
  if (h && h.permissionDecision === 'deny') return h.permissionDecisionReason || '';
  return null;
}
function blockOf(res) {
  return res.json && res.json.decision === 'block' ? (res.json.reason || '') : null;
}

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// --- fixture builders -------------------------------------------------------

function pre(sid, toolName, input) {
  return { session_id: sid, cwd: PROJ, hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: input || {} };
}
function post(sid, toolName, input, responseText, tuid) {
  return {
    session_id: sid, cwd: PROJ, hook_event_name: 'PostToolUse', tool_name: toolName,
    tool_input: input || {}, tool_response: responseText || 'ok',
    tool_use_id: tuid || ('tu-' + Math.random().toString(16).slice(2)), duration_ms: 12,
  };
}
function stop(sid, active) {
  return { session_id: sid, cwd: PROJ, hook_event_name: 'Stop', stop_hook_active: Boolean(active) };
}

function seedSeen(sid, id) {
  // A read whose response carries the id — the legitimate way an id becomes known.
  gate('post', post(sid, MCP + 'list_tasks', { project_id: id }, 'Task "X" [id: ' + id + ']'));
}

// --- the cases --------------------------------------------------------------

function caseSessionStart() {
  console.log('\nSessionStart — the canon card and the liveness token');
  const sid = fresh();
  const r = gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' });
  const ctx = r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext;
  check('card is emitted as SessionStart additionalContext', Boolean(ctx));
  check('card carries the liveness token', /\[portal-canon v1 · alive · token [0-9a-f]{6}\]/.test(ctx || ''));
  check('card publishes the stand-down escape', /stand-down --gate/.test(ctx || ''));
  check('card names every registered gate', (ctx || '').includes('CANON-ID') && (ctx || '').includes('CANON-ACCOUNT'));
  check('card states the structure/quality limit', /judge STRUCTURE, never quality/.test(ctx || ''));
  // Asserted against the constant, not against a number copied out of it: the cap moved from
  // 2600 to 3000 when the two debt gates and the carried-debt block were added, and a test
  // carrying its own copy of the old number is a test that stops meaning anything.
  check('card is within the published cap', (ctx || '').length <= require('./canon-gate.js').CARD_CAP,
    'len=' + (ctx || '').length);
}

function caseP1() {
  console.log('\nP1 CANON-ID — fabricated id');
  let sid = fresh();
  seedSeen(sid, UUID_A);

  // VIOLATION: a write carrying an id nothing in this session ever returned.
  const bad = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B, status: 'done' }));
  const reason = denialOf(bad);
  check('refuses a write carrying an unseen id', Boolean(reason));
  check('reason names the ACTUAL id from the call', (reason || '').includes(UUID_B),
    'reason did not contain ' + UUID_B);
  check('reason names the ACTUAL tool', (reason || '').includes('update_task'));
  check('reason carries no imperative / no escape path',
    !/to clear|you must|run |please |stand-down/i.test(reason || ''));

  // COMPLIANT: the same write, with an id this session actually read.
  const good = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A, status: 'done' }));
  check('allows the same write with a SEEN id', denialOf(good) === null, denialOf(good) || '');

  // A foreign MCP tool is never subject to the PORTAL invariants: CANON-ID has no
  // jurisdiction over Desktop_Commander's arguments.
  //
  // THIS ASSERTION USED TO READ "never denies an unknown MCP tool", AND THAT WORDING
  // ENSHRINED A HOLE. It was true of the portal invariants and false of everything else:
  // the same tool wrote source files straight past CANON-TREE-FIRST, because the gate
  // watched the tool name `Write` instead of the effect "a file is being written". The
  // portal half below is still exactly right. The file half now lives in
  // caseGapTreeFirstEffect, where this same call IS refused once a run is declared.
  const other = gate('pre', pre(sid, 'mcp__Desktop_Commander__write_file', { path: UUID_B, content: 'x' }));
  check('CANON-ID has no jurisdiction over a foreign MCP tool', !/CANON-ID/.test(denialOf(other) || ''),
    denialOf(other) || '');
  check('and with no run declared that write is not gated at all', denialOf(other) === null, denialOf(other) || '');
  const plain = gate('pre', pre(sid, 'Read', { file_path: 'x' + UUID_B }));
  check('never denies a plain Read', denialOf(plain) === null);

  // The envelope's own uuids must not be treated as candidates (the measured bug).
  sid = fresh();
  const envOnly = gate('pre', pre(sid, MCP + 'list_tasks', {}));
  check('session_id in the envelope is not read as a fabricated id', denialOf(envOnly) === null);
}

function caseP2() {
  console.log('\nP2 CANON-BOTTOM-UP — parents before children');
  let sid = fresh();
  seedSeen(sid, UUID_A);
  const bad = gate('pre', pre(sid, MCP + 'complete_task', { task_id: UUID_A }));
  check('refuses complete_task with no list_subtasks read', Boolean(denialOf(bad)));
  check('reason names the actual task id', (denialOf(bad) || '').includes(UUID_A));

  // List the children — one is still open.
  gate('post', post(sid, MCP + 'list_subtasks', { parent_task_id: UUID_A },
    'Subtask "child" [id: ' + UUID_C + ']'));
  const stillBad = gate('pre', pre(sid, MCP + 'complete_task', { task_id: UUID_A }));
  check('refuses while a listed child is not completed', Boolean(denialOf(stillBad)));
  check('reason names the unfinished child', (denialOf(stillBad) || '').includes(UUID_C));

  // Complete the child, then the parent is allowed.
  gate('post', post(sid, MCP + 'complete_task', { task_id: UUID_C }, 'Completed [id: ' + UUID_C + ']'));
  const good = gate('pre', pre(sid, MCP + 'complete_task', { task_id: UUID_A }));
  check('allows the parent once every listed child is complete', denialOf(good) === null, denialOf(good) || '');
}

function caseP3() {
  console.log('\nP3 CANON-COORD-ROLE — the coordinator does not implement');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN', '--mode', 'coordinator', '--channel', UUID_A]);
  const bad = gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'x.ts'), content: 'x' }));
  check('refuses a Write while holding the coordinator title', Boolean(denialOf(bad)));
  check('reason names the channel', (denialOf(bad) || '').includes(UUID_A));

  const badBash = gate('pre', pre(sid, 'Bash', { command: 'npm run build' }));
  check('refuses a mutating Bash', Boolean(denialOf(badBash)));

  const readBash = gate('pre', pre(sid, 'Bash', { command: 'git status' }));
  check('allows a read-only Bash', denialOf(readBash) === null, denialOf(readBash) || '');

  // THE ESCAPE MUST ALWAYS BE REACHABLE.
  const esc = gate('pre', pre(sid, 'Bash', { command: 'node "' + GATE + '" stand-down --gate all --reason "x"' }));
  check('never blocks its own stand-down invocation', denialOf(esc) === null, denialOf(esc) || '');

  const chat = gate('pre', pre(sid, MCP + 'send_chat_message', { channel_id: UUID_A }));
  check('allows the coordinator to delegate by message', denialOf(chat) === null, denialOf(chat) || '');
}

function caseP3Latch() {
  console.log('\nP3 CANON-COORD-ROLE — the latch, and the key that has to turn it');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  // .md, so CANON-TREE-FIRST stays out of the way and this exercises ONE gate.
  const doc = { file_path: path.join(PROJ, 'notes.md'), content: 'x' };

  check('silent before the title is claimed', denialOf(gate('pre', pre(sid, 'Write', doc))) === null);

  // THE RUNTIME PATH — claim_coordinator_title, not `run-open --mode coordinator`. This
  // path had no coverage at all, which is how a one-way latch shipped.
  gate('post', post(sid, MCP + 'claim_coordinator_title', { channel_id: UUID_A },
    'You now hold the coordinator title on channel [id: ' + UUID_A + ']'));
  const latched = denialOf(gate('pre', pre(sid, 'Write', doc)));
  check('claim_coordinator_title latches the gate', /CANON-COORD-ROLE/.test(latched || ''), latched || '');
  check('the refusal carries no imperative and no escape',
    !/to clear|you must|run |please |stand-down/i.test(latched || ''));

  // send_chat_message is what the card USED to publish as the clearing action. It never
  // cleared anything and must not start to — delegating the work is not giving up the
  // title. The card is what changed, not this.
  gate('post', post(sid, MCP + 'send_chat_message', { channel_id: UUID_A }, 'Sent [id: ' + UUID_B + ']'));
  check('sending a chat message does NOT clear it',
    Boolean(denialOf(gate('pre', pre(sid, 'Write', doc)))));

  // THE KEY. Without it `mode` only ever moved one way and the gate refused every
  // Write/Edit/mutating Bash for the rest of the session.
  const tr = gate('pre', pre(sid, MCP + 'transfer_coordinator_title', { channel_id: UUID_A }));
  check('the key itself is reachable while latched', denialOf(tr) === null, denialOf(tr) || '');
  gate('post', post(sid, MCP + 'transfer_coordinator_title', { channel_id: UUID_A },
    'Coordinator title transferred [id: ' + UUID_A + ']'));
  const cleared = gate('pre', pre(sid, 'Write', doc));
  check('transfer_coordinator_title CLEARS the latch', denialOf(cleared) === null, denialOf(cleared) || '');

  // A transfer that FAILED did not hand the title anywhere.
  const sid2 = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid2, UUID_A);
  const doc2 = { file_path: path.join(PROJ, 'notes.md'), content: 'x' };
  gate('post', post(sid2, MCP + 'claim_coordinator_title', { channel_id: UUID_A }, 'ok [id: ' + UUID_A + ']'));
  const failed = post(sid2, MCP + 'transfer_coordinator_title', { channel_id: UUID_A });
  failed.tool_response = { isError: true, content: 'you do not hold the title' };
  gate('post', failed);
  check('a FAILED transfer does not clear it', Boolean(denialOf(gate('pre', pre(sid2, 'Write', doc2)))));

  // The fold is family-wide, so a SUBAGENT's claim latches the parent. That is fine only
  // as long as the parent can turn the key.
  const sid3 = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid3, UUID_A);
  const doc3 = { file_path: path.join(PROJ, 'notes.md'), content: 'x' };
  const subClaim = post(sid3, MCP + 'claim_coordinator_title', { channel_id: UUID_A }, 'ok [id: ' + UUID_A + ']');
  subClaim.agent_id = 'agent-7';
  gate('post', subClaim);
  check('a SUBAGENT claim latches the parent too', Boolean(denialOf(gate('pre', pre(sid3, 'Write', doc3)))));
  gate('post', post(sid3, MCP + 'transfer_coordinator_title', { channel_id: UUID_A }, 'transferred [id: ' + UUID_A + ']'));
  check('and the parent can turn the key', denialOf(gate('pre', pre(sid3, 'Write', doc3))) === null,
    denialOf(gate('pre', pre(sid3, 'Write', doc3))) || '');
}

function caseP4() {
  console.log('\nP4 CANON-POLICY-FIRST — a participant reads before it acts');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN', '--mode', 'participant', '--channel', UUID_A]);
  seedSeen(sid, UUID_B);
  const bad = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }));
  check('refuses a participant write before the channel is read', Boolean(denialOf(bad)));
  check('reason names both missing reads',
    /read_channel_policy/.test(denialOf(bad) || '') && /read_channel_messages/.test(denialOf(bad) || ''));

  gate('post', post(sid, MCP + 'read_channel_policy', { channel_id: UUID_A }, 'policy text'));
  const half = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }));
  check('still refuses with only the policy read', Boolean(denialOf(half)));
  check('reason names only the remaining read', /read_channel_messages/.test(denialOf(half) || '')
    && !/read_channel_policy/.test(denialOf(half) || ''));

  gate('post', post(sid, MCP + 'read_channel_messages', { channel_id: UUID_A }, 'msgs'));
  const good = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }));
  check('allows once policy AND messages are read', denialOf(good) === null, denialOf(good) || '');
}

function caseP5() {
  console.log('\nP5 CANON-JOURNAL-PHASE — journal at every phase boundary');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  const before = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }));
  check('silent before any phase boundary', denialOf(before) === null, denialOf(before) || '');

  gate('post', post(sid, MCP + 'update_milestone_status', { milestone_id: UUID_B, status: 'delivered' }, 'ok [id: ' + UUID_B + ']'));
  const bad = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }));
  check('refuses the first write after a boundary with no journal', Boolean(denialOf(bad)));
  check('reason names the boundary', (denialOf(bad) || '').includes(UUID_B));

  gate('post', post(sid, MCP + 'create_journal', { folder_id: UUID_C }, 'Journal [id: ' + UUID_A + ']'));
  const half = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }));
  check('still refuses when written but not read back', Boolean(denialOf(half)));

  gate('post', post(sid, MCP + 'list_journals', { folder_id: UUID_C }, 'entries'));
  const good = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }));
  check('allows once written AND read back', denialOf(good) === null, denialOf(good) || '');
}

function caseP5Latch() {
  console.log('\nP5 CANON-JOURNAL-PHASE — the gate must not refuse the journal it demands');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  seedSeen(sid, UUID_C);
  gate('post', post(sid, MCP + 'update_milestone_status', { milestone_id: UUID_B, status: 'delivered' },
    'Milestone updated [id: ' + UUID_B + ']'));

  const bad = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('(precondition) the gate is firing after the boundary', /CANON-JOURNAL-PHASE/.test(bad || ''), bad || '');
  check('the reason names the boundary KIND, not "undefined"',
    /milestone/.test(bad || '') && !/undefined/.test(bad || ''), bad || '');
  check('the refusal carries no imperative and no escape',
    !/to clear|you must|run |please |stand-down/i.test(bad || ''));

  // THE KEY: the card publishes create_journal(folder_id=…) + a read-back. Every write on
  // that path has to be exempt from the gate that demands it, or the escape cannot run.
  for (const [tool, input] of [
    ['create_journal', { folder_id: UUID_C, title: 'phase 1' }],
    ['update_journal', { journal_id: UUID_C }],
    ['create_journal_folder', {}],
  ]) {
    const d = denialOf(gate('pre', pre(sid, MCP + tool, input)));
    check(tool + ' — on the path the card demands — is not refused by this gate',
      !/CANON-JOURNAL-PHASE/.test(d || ''), d || '');
  }
  // The read half was always exempt. Prove it rather than assume it.
  check('list_journals is not refused', denialOf(gate('pre', pre(sid, MCP + 'list_journals', {}))) === null);

  // …and the gate must still be a gate.
  check('still refuses an unrelated portal write',
    Boolean(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })))));
  check('still refuses create_task',
    Boolean(denialOf(gate('pre', pre(sid, MCP + 'create_task', { project_id: UUID_A })))));
}

function caseKeys() {
  console.log('\nEvery latch has a key — the card and the tested escape cannot drift');
  const sid = fresh();
  const G = require('./canon-gate.js');
  const r = gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' });
  const card = (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext) || '';
  let declared = 0;
  for (const row of G.REGISTER) {
    const id = row[0];
    const clears = row[2];
    const keys = row[3];
    if (!keys || !keys.length) continue;
    declared++;
    for (const k of keys) check(id + ': key "' + k + '" is a real portal tool', G.PORTAL_TOOLS.has(k), k);
    check(id + ': the card publishes a key that actually turns',
      keys.some((k) => String(clears).includes(k)) && keys.some((k) => card.includes(k)), String(clears));
  }
  check('the gates that can latch declare a tested key', declared >= 2, 'declared ' + declared);
  check('the card no longer offers send_chat_message as the coordinator escape',
    !/CANON-COORD-ROLE[^\n]*send_chat_message/.test(card),
    card.split('\n').find((l) => /COORD-ROLE/.test(l)) || '(no COORD-ROLE line)');
  check('card is still within the published cap', card.length <= G.CARD_CAP, 'len=' + card.length);
  check('the gates that can latch now include both debt gates', declared >= 4, 'declared ' + declared);
  // CLOSEOUT_CLEARING is the key set CANON-DEBT-CLOSEOUT turns on, and the card's clears text
  // is what the model reads. They are two copies of one fact, so prove they are the same fact.
  const coRow = G.REGISTER.find((r) => r[0] === 'CANON-DEBT-CLOSEOUT');
  for (const k of coRow[3]) {
    check('CANON-DEBT-CLOSEOUT: key "' + k + '" is actually exempted in code', G.CLOSEOUT_CLEARING.has(k), k);
  }
}

function caseP6() {
  console.log('\nP6 CANON-KG-DESTRUCTIVE — regenerate destroys nodes and edges');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  const bad = gate('pre', pre(sid, MCP + 'regenerate_knowledge_graph', { graph_id: UUID_A }));
  check('refuses regenerate_knowledge_graph inside a run', Boolean(denialOf(bad)));
  check('reason states what regeneration destroys', /destroys/.test(denialOf(bad) || ''));
  check('reason names the incremental alternative', /extract_knowledge_graph/.test(denialOf(bad) || ''));

  const ok = gate('pre', pre(sid, MCP + 'extract_knowledge_graph', { graph_id: UUID_A }));
  check('allows the incremental extract', denialOf(ok) === null, denialOf(ok) || '');

  // The owner's authorisation sentinel.
  const runId = JSON.parse(fs.readFileSync(path.join(HOME, 'runs', 'by-project',
    fs.readdirSync(path.join(HOME, 'runs', 'by-project'))[0]), 'utf8')).run_id;
  fs.writeFileSync(path.join(HOME, 'ALLOW-KG-REGEN-' + runId), 'ok');
  const authorised = gate('pre', pre(sid, MCP + 'regenerate_knowledge_graph', { graph_id: UUID_A }));
  check('allows regenerate once authorised by sentinel', denialOf(authorised) === null, denialOf(authorised) || '');
}

function caseP7() {
  console.log('\nP7 CANON-TREE-FIRST — tree and flow board before implementation');
  const sid = fresh();
  const src = path.join(PROJ, 'src.ts');

  // No run declared: the gate is deliberately silent, or every repo gets gated.
  const noRun = gate('pre', pre(sid, 'Write', { file_path: src, content: 'x' }));
  check('silent with no run declared', denialOf(noRun) === null, denialOf(noRun) || '');

  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  const bad = gate('pre', pre(sid, 'Write', { file_path: src, content: 'x' }));
  check('refuses a source Write with no tree', Boolean(denialOf(bad)));
  const r = denialOf(bad) || '';
  check('reason lists all four missing calls',
    r.includes('create_task') && r.includes('create_subtask')
    && r.includes('create_flow_cluster') && r.includes('create_flow_connection'));

  const md = gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'notes.md'), content: 'x' }));
  check('never gates a .md file', denialOf(md) === null, denialOf(md) || '');

  for (const [tool, id] of [['create_task', UUID_A], ['create_subtask', UUID_B],
    ['create_flow_cluster', UUID_C], ['create_flow_connection', UUID_A]]) {
    gate('post', post(sid, MCP + tool, {}, 'Created [id: ' + id + ']'));
  }
  const good = gate('pre', pre(sid, 'Write', { file_path: src, content: 'x' }));
  check('allows the Write once all four exist', denialOf(good) === null, denialOf(good) || '');
}

function caseP8() {
  console.log('\nP8 CANON-BOARD-FIRST — alignment board before the brief');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'ALIGN']);
  seedSeen(sid, UUID_A); // or CANON-ID fires first and we would be testing the wrong gate
  const bad = gate('pre', pre(sid, MCP + 'create_proposal', { project_id: UUID_A }));
  check('refuses create_proposal in ALIGN with no board', Boolean(denialOf(bad)));
  const r = denialOf(bad) || '';
  check('reason lists the three missing artifacts',
    r.includes('create_board') && r.includes('mermaid') && r.includes('read_board'));

  gate('post', post(sid, MCP + 'create_board', {}, 'Board [id: ' + UUID_A + ']'));
  gate('post', post(sid, MCP + 'create_board_block', { board_id: UUID_A, type: 'mermaid' }, 'Block [id: ' + UUID_B + ']'));
  gate('post', post(sid, MCP + 'read_board', { board_id: UUID_A }, 'board contents [id: ' + UUID_A + ']'));
  const good = gate('pre', pre(sid, MCP + 'create_proposal', { project_id: UUID_A }));
  check('allows once board + mermaid block + read_board exist', denialOf(good) === null, denialOf(good) || '');

  // Board-first governs INITIATION only.
  cli(['run-promote', '--state', 'RUN']);
  const sid2 = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid2, UUID_A);
  const inRun = gate('pre', pre(sid2, MCP + 'create_proposal', { project_id: UUID_A }));
  check('inert once the run is promoted to RUN', denialOf(inRun) === null, denialOf(inRun) || '');
}

function caseO1() {
  console.log('\nO1 CANON-READ-BACK — a write that returned is not a write that persisted');
  let sid = fresh();
  const r1 = gate('post', post(sid, MCP + 'create_board', { project_id: UUID_A }, 'Created board [id: ' + UUID_B + ']'));
  const b = blockOf(r1);
  check('blocks after an unverified write', Boolean(b));
  check('block names the exact clearing call', /read_board\("?bbbbbbbb/.test(b || ''), b || '');
  check('block carries the stand-down line', /stand-down --gate CANON-READ-BACK/.test(b || ''));
  check('block states the honest limit', /success string is not a\s+data effect|success string is not a data effect/.test(b || ''));

  // The read clears it; the next write must not re-block for the cleared one.
  gate('post', post(sid, MCP + 'read_board', { board_id: UUID_B }, 'Board contents [id: ' + UUID_B + ']'));
  const after = gate('post', post(sid, MCP + 'list_boards', {}, 'boards'));
  check('does not block once the write was read back', blockOf(after) === null, blockOf(after) || '');

  // A write and its mapped read inside ONE bulk is canon (f) done right — never block.
  sid = fresh();
  const bulkResp = 'Ran 2/2 call(s); 0 failed.\n'
    + '[0] create_board: Created board [id: ' + UUID_C + ']\n'
    + '[1] read_board: Board contents [id: ' + UUID_C + ']';
  const rb = gate('post', post(sid, MCP + 'bulk', {
    calls: [{ tool: 'create_board', arguments: {} }, { tool: 'read_board', arguments: { board_id: UUID_C } }],
  }, bulkResp));
  check('a write+read inside one bulk does not block', blockOf(rb) === null, blockOf(rb) || '');

  // A bulk containing only a write DOES leave an obligation.
  sid = fresh();
  const bulkWriteOnly = 'Ran 1/1 call(s); 0 failed.\n[0] create_board: Created board [id: ' + UUID_A + ']';
  const rw = gate('post', post(sid, MCP + 'bulk', { calls: [{ tool: 'create_board', arguments: {} }] }, bulkWriteOnly));
  check('a bulk with an unverified write still blocks', Boolean(blockOf(rw)));
}

function caseS1() {
  console.log('\nS1 CANON-ACCOUNT — never end a turn SILENTLY mid-run');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  const r = gate('stop', stop(sid, false));
  const b = blockOf(r);
  check('blocks a silent turn end while a run is active', Boolean(b));
  check('block offers BOTH continue and journal-it', /continue/.test(b || '') && /create_journal/.test(b || ''));
  check('block states you may always stop with an account', /may not stop SILENTLY/.test(b || ''));
  check('block carries the stand-down line', /stand-down --gate CANON-ACCOUNT/.test(b || ''));

  // stop_hook_active must NEVER block — that is how a session gets wedged.
  const again = gate('stop', stop(sid, true));
  check('never blocks twice (stop_hook_active honoured)', blockOf(again) === null, blockOf(again) || '');

  // An account clears it.
  const sid2 = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  gate('prompt', { session_id: sid2, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  gate('post', post(sid2, MCP + 'create_journal', { folder_id: UUID_A }, 'Journal [id: ' + UUID_B + ']'));
  // The journal is itself a write, so read it back — exactly what the S1 block text asks
  // for. Without this, CANON-READ-BACK-STOP fires first and we would be testing that.
  gate('post', post(sid2, MCP + 'get_journal', { journal_id: UUID_B }, 'Journal body [id: ' + UUID_B + ']'));
  const cleared = gate('stop', stop(sid2, false));
  check('does not block once this turn journalled and read back', blockOf(cleared) === null, blockOf(cleared) || '');
}

function caseNoRepeat() {
  console.log('\nStop re-entry — the gate must not talk in a loop');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  check('the first turn end blocks', Boolean(blockOf(gate('stop', stop(sid, false)))));

  // The runtime re-enters Stop with stop_hook_active after a block. Every re-entry that
  // speaks costs a whole assistant turn, so at most ONE may say anything.
  let spoke = 0;
  for (let i = 0; i < 5; i++) {
    const r = gate('stop', stop(sid, true));
    check('re-entry ' + (i + 1) + ' never blocks', blockOf(r) === null);
    if (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext) spoke++;
  }
  check('speaks at most once across 5 Stop re-entries', spoke <= 1, 'spoke ' + spoke + ' times');

  // A new user prompt opens a new turn, and the gate may speak again.
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'next' });
  const nextTurn = gate('stop', stop(sid, false));
  check('a new user prompt re-arms the turn', Boolean(blockOf(nextTurn)));
}

function caseBudget() {
  console.log('\nAutomatic degradation — the block budget');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  let blocked = 0;
  for (let i = 0; i < 6; i++) {
    gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go ' + i });
    if (blockOf(gate('stop', stop(sid, false)))) blocked++;
  }
  check('CANON-ACCOUNT stops blocking after its budget', blocked <= 3, 'blocked ' + blocked + ' times');
  check('the gate degrades rather than trapping the session', blocked > 0 && blocked <= 3, 'blocked ' + blocked);
}

function caseEscapes() {
  console.log('\nThe escapes — every refusal must disappear');
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN', '--mode', 'coordinator', '--channel', UUID_A]);
  seedSeen(sid, UUID_A);

  // Confirm the gates are live first, or "it passed" proves nothing.
  check('(precondition) CANON-ID is firing', Boolean(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B })))));
  check('(precondition) CANON-COORD-ROLE is firing', Boolean(denialOf(gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'a.ts') })))));

  // E1 — the global sentinel, written by the documented command.
  const w = cli(['stand-down', '--gate', 'all', '--reason', 'selftest']);
  check('stand-down writes the sentinel', fs.existsSync(path.join(HOME, 'STAND-DOWN')), (w.stdout || '') + (w.stderr || ''));
  check('E1 sentinel clears CANON-ID', denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }))) === null);
  check('E1 sentinel clears CANON-COORD-ROLE', denialOf(gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'a.ts') }))) === null);
  check('E1 sentinel clears the Stop gate', blockOf(gate('stop', stop(sid, false))) === null);
  fs.unlinkSync(path.join(HOME, 'STAND-DOWN'));
  check('gates re-arm when the sentinel is deleted', Boolean(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B })))));

  // E1 gate-scoped.
  cli(['stand-down', '--gate', 'CANON-ID', '--reason', 'selftest']);
  check('gate-scoped sentinel clears only its gate',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }))) === null
    && Boolean(denialOf(gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'a.ts') })))));
  fs.unlinkSync(path.join(HOME, 'STAND-DOWN-CANON-ID'));

  // E2 — the environment.
  check('PORTAL_CANON=off silences refusals',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }), { PORTAL_CANON: 'off' })) === null);
  check('PORTAL_CANON=advisory silences refusals',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }), { PORTAL_CANON: 'advisory' })) === null);
  check('PORTAL_CANON=advisory silences Stop blocks',
    blockOf(gate('stop', stop(sid, false), { PORTAL_CANON: 'advisory' })) === null);
}

function caseFailSafe() {
  console.log('\nFail-safe — our own bugs must never break a turn');
  const sid = fresh();
  for (const [name, payload] of [
    ['empty stdin', ''],
    ['malformed JSON', '{not json'],
    ['null payload', 'null'],
    ['no tool_name', JSON.stringify({ session_id: sid, cwd: PROJ })],
    ['tool_input is a string', JSON.stringify({ session_id: sid, cwd: PROJ, tool_name: MCP + 'update_task', tool_input: 'oops' })],
  ]) {
    const r = spawnSync(process.execPath, [GATE, 'pre'], { input: payload, encoding: 'utf8', env: env(), timeout: 20000 });
    check('pre survives ' + name, r.status === 0 && !denialOf({ json: safe(r.stdout) }),
      'exit=' + r.status + ' out=' + (r.stdout || '').slice(0, 80));
  }
  const rp = spawnSync(process.execPath, [GATE, 'post'], { input: '{bad', encoding: 'utf8', env: env(), timeout: 20000 });
  check('post survives malformed JSON', rp.status === 0);
  const rs = spawnSync(process.execPath, [GATE, 'stop'], { input: '{bad', encoding: 'utf8', env: env(), timeout: 20000 });
  check('stop survives malformed JSON', rs.status === 0);
  const ru = spawnSync(process.execPath, [GATE, 'no-such-mode'], { input: '{}', encoding: 'utf8', env: env(), timeout: 20000 });
  check('an unknown mode exits 0 silently', ru.status === 0 && !(ru.stdout || '').trim());
}
function safe(s) { try { return JSON.parse(s); } catch (_) { return null; } }

function casePrivacy() {
  console.log('\nPrivacy — the ledger is an allow-list');
  const sid = fresh();
  gate('post', post(sid, MCP + 'create_journal', {
    folder_id: UUID_A, title: 'SECRET-TITLE-XYZ', content: 'SECRET-BODY-XYZ',
    lessons: 'SECRET-LESSON-XYZ', logged_at: '2026-08-14',
  }, 'Journal [id: ' + UUID_B + ']'));
  const files = fs.readdirSync(path.join(HOME, 'sessions'));
  let text = '';
  for (const f of files) text += fs.readFileSync(path.join(HOME, 'sessions', f), 'utf8');
  check('journal title is NOT in the ledger', !text.includes('SECRET-TITLE-XYZ'));
  check('journal body is NOT in the ledger', !text.includes('SECRET-BODY-XYZ'));
  check('journal lessons are NOT in the ledger', !text.includes('SECRET-LESSON-XYZ'));
  check('the allowed folder_id IS in the ledger', text.includes(UUID_A));
  check('logged_at (date only) IS in the ledger', text.includes('2026-08-14'));

  const sid2 = fresh();
  gate('prompt', { session_id: sid2, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'PRIVATE-PROMPT-TEXT ' + UUID_A });
  let t2 = '';
  for (const f of fs.readdirSync(path.join(HOME, 'sessions'))) t2 += fs.readFileSync(path.join(HOME, 'sessions', f), 'utf8');
  check('prompt TEXT is not recorded, only its ids', !t2.includes('PRIVATE-PROMPT-TEXT') && t2.includes(UUID_A));
}

function caseLifecycle() {
  console.log('\nRun lifecycle and the CLI');
  fresh();
  const o = cli(['run-open', '--client', 'Acme', '--project', 'Rocket', '--state', 'ALIGN']);
  check('run-open prints a run id', /run opened: r-[0-9a-f]{8}/.test(o.stdout || ''), o.stdout);
  const p = cli(['run-promote', '--state', 'RUN']);
  check('run-promote moves ALIGN → RUN', /→ state RUN/.test(p.stdout || ''), p.stdout);
  const d = cli(['doctor']);
  check('doctor reports the home and the run', /CANON_HOME/.test(d.stdout || '') && /state RUN/.test(d.stdout || ''), d.stdout);
  check('doctor lists armed gates', /ARMED\s+CANON-ID/.test(d.stdout || ''));
  check('doctor reports the tool count', /portal tools\s+:\s+257 known/.test(d.stdout || ''), (d.stdout || '').split('\n').find((x) => /portal tools/.test(x)));
  const c = cli(['run-close']);
  check('run-close closes the run', /closed/.test(c.stdout || ''), c.stdout);
  const d2 = cli(['doctor']);
  check('a closed run no longer governs', /state CLOSED/.test(d2.stdout || '') || /\(none\)/.test(d2.stdout || ''));

  // A stale run must not gate every future turn.
  fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  const dir = path.join(HOME, 'runs');
  const rf = fs.readdirSync(dir).find((f) => f.startsWith('r-'));
  const run = JSON.parse(fs.readFileSync(path.join(dir, rf), 'utf8'));
  run.last_progress_at = Math.floor(Date.now() / 1000) - (25 * 3600);
  fs.writeFileSync(path.join(dir, rf), JSON.stringify(run));
  const sid = fresh_keepHome();
  const r = gate('stop', stop(sid, false));
  check('a run with no progress for 24h closes itself', blockOf(r) === null, blockOf(r) || '');
}
function fresh_keepHome() { SESSION++; return 'sess-' + SESSION; }

function caseTools() {
  console.log('\nScoping — the frozen portal tool list');
  fresh();
  const t = cli(['tools']);
  const names = (t.stdout || '').trim().split('\n');
  check('tools lists 257 portal tools', names.length === 257, 'got ' + names.length);
  check('bulk is in the list', names.includes('bulk'));
  check('create_project is in the list', names.includes('create_project'));
  check('a foreign tool is not', !names.includes('write_file'));
}

// ============================================================================
// THE HOLES A MODEL WALKS THROUGH BY DEFAULT
//
// Every case below was ALLOWED by the gate that was supposed to refuse it, and every one
// was found by driving the real binary rather than by reading the code. They share one
// cause: each gate watched a TOOL NAME instead of an EFFECT, so the effect kept arriving
// through a door with a different name on it. Writing a file is writing a file whether it
// comes from `Write`, `PowerShell`, `sed -i`, or an MCP server installed next week.
//
// Read these as the specification for the fix: a gate is only closed when every carrier of
// its effect is refused, and every compliant carrier still passes.
// ============================================================================

const RUN_ARGS = ['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN'];

function caseGapShellSurface() {
  console.log('\nGAP-1 the shell is a SURFACE, not a tool name (CANON-COORD-ROLE)');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  gate('post', post(sid, MCP + 'claim_coordinator_title', { channel_id: UUID_A },
    'You now hold the coordinator title [id: ' + UUID_A + ']'));

  // The measured control: the ONE spelling the old detector caught.
  check('(control) plain `npm run build` on Bash is refused',
    /CANON-COORD-ROLE/.test(denialOf(gate('pre', pre(sid, 'Bash', { command: 'npm run build' }))) || ''));

  // …and every other carrier of the same effect, all measured ALLOW.
  const carriers = [
    ['PowerShell', { command: 'Set-Content -Path bypass.ts -Value "x"' }, 'the stock Windows shell tool'],
    ['Bash', { command: 'bash -c "npm install"' }, 'a quote defeats a word-boundary regex'],
    ['Bash', { command: 'CI=1 make build' }, 'make/cmake/go/cargo/msbuild were absent'],
    ['Bash', { command: 'cargo build --release' }, 'cargo'],
    ['Bash', { command: 'go build ./...' }, 'go'],
    ['Bash', { command: 'sudo rm -rf build' }, 'a wrapper in front of the mutator'],
    ['mcp__Desktop_Commander__start_process', { command: 'npm run build' }, 'an MCP process server'],
    ['mcp__Desktop_Commander__write_file', { path: 'x.ts', content: 'x' }, 'an MCP file writer'],
  ];
  for (const [tool, input, why] of carriers) {
    const d = denialOf(gate('pre', pre(sid, tool, input)));
    check('refuses ' + tool + ' — ' + why, /CANON-COORD-ROLE/.test(d || ''), d || '(ALLOWED)');
  }

  // A gate that refuses everything is not a gate. Read-only work must stay untouched.
  for (const [tool, input] of [
    ['Bash', { command: 'git status' }],
    ['Bash', { command: 'grep -rn "rm -rf" src/' }],
    ['Bash', { command: 'ls node_modules' }],
    ['PowerShell', { command: 'Get-ChildItem -Recurse' }],
    ['mcp__Desktop_Commander__read_file', { path: 'x.ts' }],
    ['Read', { file_path: 'x.ts' }],
  ]) {
    const d = denialOf(gate('pre', pre(sid, tool, input)));
    check('still allows read-only ' + tool + ': ' + (input.command || input.path || input.file_path),
      d === null, d || '');
  }

  // The escape has to survive the wider net, on every shell.
  const esc = gate('pre', pre(sid, 'Bash', { command: 'node "' + GATE + '" stand-down --gate all --reason "x"' }));
  check('the stand-down invocation is still exempt', denialOf(esc) === null, denialOf(esc) || '');
}

function caseGapTreeFirstEffect() {
  console.log('\nGAP-2 CANON-TREE-FIRST — a write is a write, whatever carried it');
  const sid = fresh();
  cli(RUN_ARGS);
  const src = path.join(PROJ, 'src.ts');
  const carriers = [
    ['Bash', { command: 'cat > "' + src + '" <<EOF\nx\nEOF' }, 'heredoc redirect'],
    ['Bash', { command: "sed -i 's/a/b/' \"" + src + '"' }, 'sed -i'],
    ['Bash', { command: 'python -c "open(\'' + src.replace(/\\/g, '\\\\') + '\',\'w\').write(1)"' }, 'python one-liner'],
    ['Bash', { command: 'echo x | tee "' + src + '"' }, 'tee'],
    ['PowerShell', { command: 'Set-Content -Path "' + src + '" -Value "x"' }, 'Set-Content'],
    ['PowerShell', { command: '"x" | Out-File "' + src + '"' }, 'Out-File'],
    ['mcp__Desktop_Commander__write_file', { path: src, content: 'x' }, 'Desktop_Commander write_file'],
    ['mcp__Desktop_Commander__edit_block', { file_path: src, old_string: 'a', new_string: 'b' }, 'Desktop_Commander edit_block'],
  ];
  for (const [tool, input, why] of carriers) {
    const d = denialOf(gate('pre', pre(sid, tool, input)));
    check('refuses ' + why, /CANON-TREE-FIRST/.test(d || ''), d || '(ALLOWED)');
    check('  …and names the file it is about to write', /src\.ts/i.test(d || ''), d || '');
  }

  // Nothing outside the project, and nothing that is not source, may be caught by this.
  const outside = path.join(os.tmpdir(), 'canon-outside-' + Date.now() + '.ts');
  for (const [tool, input, why] of [
    ['Bash', { command: 'cat > "' + outside + '" <<EOF\nx\nEOF' }, 'a file outside the project'],
    ['Bash', { command: 'cat > "' + path.join(PROJ, 'notes.md') + '" <<EOF\nx\nEOF' }, 'a .md file'],
    ['Bash', { command: 'npm install' }, 'a dependency install naming no file'],
    ['Bash', { command: 'git commit -m "wip"' }, 'a commit naming no file'],
    ['Bash', { command: 'node -e "console.log(1)" 2>&1' }, 'a 2>&1 that is not a redirect to a file'],
    ['PowerShell', { command: 'Get-Content "' + src + '"' }, 'reading the same file'],
  ]) {
    const d = denialOf(gate('pre', pre(sid, tool, input)));
    check('does not refuse ' + why, d === null, d || '');
  }

  // …and every carrier passes once the tree and the flow board exist.
  for (const [tool, id] of [['create_task', UUID_A], ['create_subtask', UUID_B],
    ['create_flow_cluster', UUID_C], ['create_flow_connection', UUID_A]]) {
    gate('post', post(sid, MCP + tool, {}, 'Created [id: ' + id + ']'));
  }
  for (const [tool, input, why] of carriers) {
    check('allows ' + why + ' once all four exist',
      denialOf(gate('pre', pre(sid, tool, input))) === null,
      denialOf(gate('pre', pre(sid, tool, input))) || '');
  }
}

function caseGapBulk() {
  console.log('\nGAP-3 `bulk` is not a hiding place — the canon itself points the model at it');

  // (a) CANON-ID
  let sid = fresh();
  seedSeen(sid, UUID_A);
  check('(control) a fabricated id is refused when called directly',
    Boolean(denialOf(gate('pre', pre(sid, MCP + 'create_task', { project_id: UUID_B })))));
  const viaBulk = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'create_task', arguments: { project_id: UUID_B } }] })));
  check('CANON-ID refuses the same call inside bulk', /CANON-ID/.test(viaBulk || ''), viaBulk || '(ALLOWED)');
  check('  …and the reason names the inner tool and its position',
    /create_task/.test(viaBulk || '') && /\[0\]/.test(viaBulk || ''), viaBulk || '');
  check('  …and the reason names the actual fabricated id', (viaBulk || '').includes(UUID_B), viaBulk || '');

  // (b) CANON-BOTTOM-UP
  sid = fresh();
  seedSeen(sid, UUID_A);
  const bu = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'complete_task', arguments: { task_id: UUID_A } }] })));
  check('CANON-BOTTOM-UP refuses complete_task inside bulk', /CANON-BOTTOM-UP/.test(bu || ''), bu || '(ALLOWED)');

  // (c) CANON-KG-DESTRUCTIVE
  sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  const kg = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'regenerate_knowledge_graph', arguments: { graph_id: UUID_A } }] })));
  check('CANON-KG-DESTRUCTIVE refuses regenerate inside bulk', /CANON-KG-DESTRUCTIVE/.test(kg || ''), kg || '(ALLOWED)');

  // (d) CANON-BOARD-FIRST
  sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'ALIGN']);
  seedSeen(sid, UUID_A);
  const bf = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'create_proposal', arguments: { project_id: UUID_A } }] })));
  check('CANON-BOARD-FIRST refuses create_proposal inside bulk', /CANON-BOARD-FIRST/.test(bf || ''), bf || '(ALLOWED)');

  // …but a bulk that DOES the board-first sequence in order must pass. The canon tells the
  // model to batch; a gate that refuses a correct batch would teach it to stop batching.
  const compliant = denialOf(gate('pre', pre(sid, MCP + 'bulk', {
    calls: [
      { tool: 'create_board', arguments: {} },
      { tool: 'create_board_block', arguments: { board_id: '{{0.id}}', type: 'mermaid' } },
      { tool: 'read_board', arguments: { board_id: '{{0.id}}' } },
      { tool: 'create_proposal', arguments: { project_id: UUID_A } },
    ],
  })));
  check('a bulk that satisfies board-first IN ORDER is allowed', compliant === null, compliant || '');
  check('  …and {{0.id}} chaining is not read as a fabricated id', !/CANON-ID/.test(compliant || ''), compliant || '');

  // (e) CANON-JOURNAL-PHASE
  sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  gate('post', post(sid, MCP + 'update_milestone_status', { milestone_id: UUID_B, status: 'delivered' },
    'Milestone updated [id: ' + UUID_B + ']'));
  const jp = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'create_task', arguments: { project_id: UUID_A } }] })));
  check('CANON-JOURNAL-PHASE refuses a post-boundary write inside bulk',
    /CANON-JOURNAL-PHASE/.test(jp || ''), jp || '(ALLOWED)');
  const jpOk = denialOf(gate('pre', pre(sid, MCP + 'bulk', {
    calls: [
      { tool: 'create_journal', arguments: { folder_id: UUID_A, title: 'phase 1' } },
      { tool: 'list_journals', arguments: { folder_id: UUID_A } },
      { tool: 'create_task', arguments: { project_id: UUID_A } },
    ],
  })));
  check('a bulk that journals and reads back BEFORE the write is allowed', jpOk === null, jpOk || '');

  // (f) CANON-POLICY-FIRST
  sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN', '--mode', 'participant', '--channel', UUID_A]);
  seedSeen(sid, UUID_B);
  const pf = denialOf(gate('pre', pre(sid, MCP + 'bulk',
    { calls: [{ tool: 'update_task', arguments: { task_id: UUID_B } }] })));
  check('CANON-POLICY-FIRST refuses a participant write inside bulk', /CANON-POLICY-FIRST/.test(pf || ''), pf || '(ALLOWED)');
  const pfOk = denialOf(gate('pre', pre(sid, MCP + 'bulk', {
    calls: [
      { tool: 'read_channel_policy', arguments: { channel_id: UUID_A } },
      { tool: 'read_channel_messages', arguments: { channel_id: UUID_A } },
      { tool: 'update_task', arguments: { task_id: UUID_B } },
    ],
  })));
  check('a bulk that reads the channel first is allowed', pfOk === null, pfOk || '');

  // A bulk of pure reads is never touched, and a malformed bulk never crashes the turn.
  sid = fresh();
  check('a bulk of reads is allowed',
    denialOf(gate('pre', pre(sid, MCP + 'bulk', { calls: [{ tool: 'list_tasks', arguments: {} }] }))) === null);
  for (const bad of [{}, { calls: 'oops' }, { calls: [null] }, { calls: [{ tool: null }] }]) {
    const r = gate('pre', pre(sid, MCP + 'bulk', bad));
    check('a malformed bulk fails open (' + JSON.stringify(bad).slice(0, 28) + ')',
      r.code === 0 && denialOf(r) === null, 'exit=' + r.code + ' ' + (denialOf(r) || ''));
  }
}

function caseGapIdProvenance() {
  console.log('\nGAP-4 CANON-ID — provenance, id SHAPE, and the cold start');

  // (a) LAUNDERING. The seen-set was harvested from any tool response at all, so a shell
  // command that merely PRINTS a uuid promoted it to "this session has seen it".
  let sid = fresh();
  gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' });
  gate('post', post(sid, 'Bash', { command: 'echo "id: ' + UUID_B + '"' }, 'id: ' + UUID_B));
  const laundered = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B })));
  check('an id printed by Bash is not laundered into "seen"', /CANON-ID/.test(laundered || ''), laundered || '(ALLOWED)');
  check('  …and the reason states where it really came from', /Bash/.test(laundered || ''), laundered || '');

  // The legitimate provenances still work: a portal read, and the owner's own message.
  gate('post', post(sid, MCP + 'list_tasks', {}, 'Task "X" [id: ' + UUID_B + ']'));
  check('a portal read still makes the id usable',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }))) === null);
  const sidP = fresh();
  gate('session-start', { session_id: sidP, cwd: PROJ, hook_event_name: 'SessionStart' });
  gate('prompt', { session_id: sidP, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'use ' + UUID_C });
  check('an id the OWNER typed is usable',
    denialOf(gate('pre', pre(sidP, MCP + 'update_task', { task_id: UUID_C }))) === null,
    denialOf(gate('pre', pre(sidP, MCP + 'update_task', { task_id: UUID_C }))) || '');
  // …and a bulk inner portal call is a portal response too.
  const sidB = fresh();
  gate('session-start', { session_id: sidB, cwd: PROJ, hook_event_name: 'SessionStart' });
  gate('post', post(sidB, MCP + 'bulk', { calls: [{ tool: 'list_tasks', arguments: {} }] },
    'Ran 1/1 call(s); 0 failed.\n[0] list_tasks: Task "X" [id: ' + UUID_B + ']'));
  check('an id from a bulk inner portal read is usable',
    denialOf(gate('pre', pre(sidB, MCP + 'update_task', { task_id: UUID_B }))) === null,
    denialOf(gate('pre', pre(sidB, MCP + 'update_task', { task_id: UUID_B }))) || '');

  // (b) SHAPE. Only uuid-shaped values were ever candidates, so the `col-<hex>` ids this
  // product actually uses for note columns, and numeric ids, were never checked at all.
  const COL_SEEN = 'col-3f9a2b1c9d4e';
  const COL_FAKE = 'col-deadbeef1234';
  sid = fresh();
  gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' });
  gate('post', post(sid, MCP + 'list_note_columns', {}, 'Column "Inbox" [id: ' + COL_SEEN + ']'));
  const colBad = denialOf(gate('pre', pre(sid, MCP + 'create_note', { column_id: COL_FAKE, title: 'x' })));
  check('a fabricated col-<hex> note-column id is refused', /CANON-ID/.test(colBad || ''), colBad || '(ALLOWED)');
  check('  …and the reason names that id', (colBad || '').includes(COL_FAKE), colBad || '');
  check('the col-<hex> id the portal DID return is allowed',
    denialOf(gate('pre', pre(sid, MCP + 'create_note', { column_id: COL_SEEN, title: 'x' }))) === null,
    denialOf(gate('pre', pre(sid, MCP + 'create_note', { column_id: COL_SEEN, title: 'x' }))) || '');

  sid = fresh();
  gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' });
  gate('post', post(sid, MCP + 'list_time_entries', {}, 'Entry [id: 4711]'));
  const numBad = denialOf(gate('pre', pre(sid, MCP + 'update_time_entry', { entry_id: 9999 })));
  check('a fabricated numeric id is refused', /CANON-ID/.test(numBad || ''), numBad || '(ALLOWED)');
  check('the numeric id the portal DID return is allowed',
    denialOf(gate('pre', pre(sid, MCP + 'update_time_entry', { entry_id: 4711 }))) === null,
    denialOf(gate('pre', pre(sid, MCP + 'update_time_entry', { entry_id: 4711 }))) || '');

  // A value under an id key that is not id-SHAPED is never a candidate — a slug or a name
  // the owner used has no marker to be seen by, and refusing it would be a trap.
  check('a non-id-shaped value under an id key is not a candidate',
    denialOf(gate('pre', pre(sid, MCP + 'send_chat_message', { channel_id: 'general', content: 'hi' }))) === null,
    denialOf(gate('pre', pre(sid, MCP + 'send_chat_message', { channel_id: 'general', content: 'hi' }))) || '');

  // (c) THE COLD START. The carve-out let the first calls of a session write ANY id — and
  // the whole suite ran with PORTAL_CANON_STRICT_ID set, so it was never once exercised.
  sid = fresh();
  gate('session-start', { session_id: sid, cwd: PROJ, hook_event_name: 'SessionStart' }, { PORTAL_CANON_STRICT_ID: '' });
  const cold = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_B }), { PORTAL_CANON_STRICT_ID: '' }));
  check('the FIRST write of a session cannot invent an id either', /CANON-ID/.test(cold || ''), cold || '(ALLOWED)');

  // …but a session the gate never saw start (a resume whose ledger was swept) still gets
  // the benefit of the doubt, or the gate refuses work it has no evidence about.
  const sidR = fresh();
  const resumed = denialOf(gate('pre', pre(sidR, MCP + 'update_task', { task_id: UUID_B }), { PORTAL_CANON_STRICT_ID: '' }));
  check('a session with no SessionStart and no prompt is still given the cold-start benefit',
    resumed === null, resumed || '');
}

function caseGapScope() {
  console.log('\nGAP-5 scope — destructive tools no gate could see, and deletes verified backwards');

  // delete_knowledge_graph destroys strictly more than regenerate_knowledge_graph does.
  let sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  const del = denialOf(gate('pre', pre(sid, MCP + 'delete_knowledge_graph', { graph_id: UUID_A })));
  check('CANON-KG-DESTRUCTIVE refuses delete_knowledge_graph', /CANON-KG-DESTRUCTIVE/.test(del || ''), del || '(ALLOWED)');
  check('  …and the reason is true of DELETION, not of regeneration',
    /destroy/i.test(del || '') && !/rebuilding/.test(del || ''), del || '');

  // create_subtask and insert_diagram write the very structure board-first exists to gate.
  sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'ALIGN']);
  seedSeen(sid, UUID_A);
  for (const [tool, input] of [
    ['create_subtask', { parent_task_id: UUID_A, title: 'x' }],
    ['insert_diagram', { proposal_id: UUID_A, code: 'graph TD' }],
  ]) {
    const d = denialOf(gate('pre', pre(sid, MCP + tool, input)));
    check('CANON-BOARD-FIRST refuses ' + tool + ' in ALIGN', /CANON-BOARD-FIRST/.test(d || ''), d || '(ALLOWED)');
  }

  // A DELETE HAS NO READ-BACK OBLIGATION AT ALL, and the ones that do have one are
  // verified BACKWARDS: `clearReads` only ever cleared when the id came BACK, so a
  // delete's obligation could never be cleared by the read that proves it worked.
  sid = fresh();
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  const b = blockOf(gate('post', post(sid, MCP + 'delete_task', { task_id: UUID_B }, 'Deleted task [id: ' + UUID_B + ']')));
  check('a delete leaves a read-back obligation', Boolean(b), b || '(no block)');
  check('  …phrased as an ABSENCE check, not a presence check',
    /gone|absent|no longer/i.test(b || ''), b || '');

  // A new turn, so the once-per-turn guard cannot make the next assertion pass for free.
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'next' });
  const stillOpen = blockOf(gate('post', post(sid, MCP + 'get_workspace', {}, 'workspace')));
  check('(control) the obligation is still open in the next turn', Boolean(stillOpen), stillOpen || '(no block)');

  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'third' });
  gate('post', post(sid, MCP + 'list_tasks', {}, 'Task "other" [id: ' + UUID_C + ']'));
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'fourth' });
  const cleared = blockOf(gate('post', post(sid, MCP + 'get_workspace', {}, 'workspace')));
  check('a list that NO LONGER contains the id clears the delete', cleared === null, cleared || '');

  // …and a list that still contains it does NOT clear it. Deleting is not wishing.
  const sid2 = fresh();
  gate('prompt', { session_id: sid2, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  gate('post', post(sid2, MCP + 'delete_task', { task_id: UUID_B }, 'Deleted task [id: ' + UUID_B + ']'));
  gate('prompt', { session_id: sid2, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'next' });
  gate('post', post(sid2, MCP + 'list_tasks', {}, 'Task "X" [id: ' + UUID_B + ']'));
  gate('prompt', { session_id: sid2, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'third' });
  const notCleared = blockOf(gate('post', post(sid2, MCP + 'get_workspace', {}, 'workspace')));
  check('a list that STILL contains the id does not clear the delete', Boolean(notCleared), notCleared || '(no block)');
}

// ============================================================================
// THE AFTER-HALF, MOVED TO THE BEFORE-SURFACE
//
// Stop gates are ONE-SHOT PER TURN, and that property is load-bearing: stop_hook_active
// short-circuits before canBlock, so a Stop hook can never wedge a session. Measured
// consequence, and the leak these cases exist to close:
//
//   stop#1 BLOCK(READ-BACK-STOP) → stop#2 SPEAK → the turn ENDS with the write unverified.
//   stop#1 BLOCK(CLOSEOUT)       → stop#2 SPEAK → the turn ENDS with the close-out missing.
//
// The Stop half therefore delays a violating turn by one exchange; it does not prevent it.
// It cannot be fixed IN Stop without destroying the property that keeps Stop safe.
//
// So the obligation — which already persists in the ledger — is enforced on the NEXT
// turn's PreToolUse surface instead. The turn ending is not the violation. Continuing to
// work as though the debt were paid is. Each case below drives the real binary through the
// exact measured leak and then asserts on the following turn.
// ============================================================================

/** Patch the on-disk run manifest — the only way to reach net-derived state in a fixture. */
function patchRun(fields) {
  const dir = path.join(HOME, 'runs');
  const rf = fs.readdirSync(dir).find((f) => f.startsWith('r-'));
  const run = JSON.parse(fs.readFileSync(path.join(dir, rf), 'utf8'));
  Object.assign(run, fields);
  fs.writeFileSync(path.join(dir, rf), JSON.stringify(run));
  return run;
}

/** The measured leak: a turn that ends with the write still unverified. */
function leakUnverifiedWrite(sid) {
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  const p = blockOf(gate('post', post(sid, MCP + 'create_board', { project_id: UUID_A },
    'Created board [id: ' + UUID_B + ']')));
  const s1 = blockOf(gate('stop', stop(sid, false)));
  const s2 = blockOf(gate('stop', stop(sid, true)));
  return { post: p, stop1: s1, stop2: s2 };
}

function caseDebtReadBack() {
  console.log('\nD1 CANON-DEBT-READ-BACK — the unverified write is refused on the NEXT turn');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);

  const leak = leakUnverifiedWrite(sid);
  check('(control) PostToolUse blocks the unverified write', Boolean(leak.post), leak.post || '(no block)');
  check('(control) the first Stop blocks it too', /CANON-READ-BACK-STOP/.test(leak.stop1 || ''), leak.stop1 || '(no block)');
  check('(control) the Stop RE-ENTRY lets the turn end with the write still unverified',
    leak.stop2 === null, leak.stop2 || '');

  // …and this is where the leak stops. A new turn begins.
  const p = gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
  const ctx = (p.json && p.json.hookSpecificOutput && p.json.hookSpecificOutput.additionalContext) || '';
  // THE REFUSAL BELOW CLAIMS THIS NOTICE EXISTS. A deny reason is believed exactly as far as
  // it is true, so a reason that points at a notice the model never received would discredit
  // itself and the mechanism with it. Prove the notice, in the same turn, before the refusal.
  check('the prompt that opens the turn already names the settling call',
    /ONE CALL SETTLES IT/.test(ctx) && /read_board\("?bbbbbbbb/.test(ctx), ctx);
  check('  …and says work is refused while reads are not', /reads are not/.test(ctx), ctx);

  const d = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('the next turn\'s first portal write is REFUSED', /CANON-DEBT-READ-BACK/.test(d || ''), d || '(ALLOWED)');
  check('  …and the reason names the unverified write', /create_board/.test(d || ''), d || '');
  check('  …and names the id that was never read back', (d || '').includes(UUID_B), d || '');
  check('  …and carries no imperative and no escape',
    Boolean(d) && !/to clear|you must|run |please |stand-down/i.test(d || ''), d || '');

  // A FILE write is work too — the same debt refuses it, whatever tool carries it.
  const f = denialOf(gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'notes.md'), content: 'x' })));
  check('a file write is refused by the same debt', /CANON-DEBT-READ-BACK/.test(f || ''), f || '(ALLOWED)');
  const sh = denialOf(gate('pre', pre(sid, 'PowerShell', { command: 'npm run build' })));
  check('a mutating command is refused by the same debt', /CANON-DEBT-READ-BACK/.test(sh || ''), sh || '(ALLOWED)');

  // THE KEY. Reading is how the debt is settled, so reading can never be refused — and the
  // escape has to survive a gate that fires on the first action of every turn.
  for (const [tool, input] of [['read_board', { board_id: UUID_B }], ['list_boards', {}],
    ['get_task', { task_id: UUID_A }], ['list_tasks', {}], ['bulk', { calls: [{ tool: 'read_board', arguments: { board_id: UUID_B } }] }]]) {
    const r = denialOf(gate('pre', pre(sid, MCP + tool, input)));
    check(tool + ' — the way the debt is settled — is never refused', r === null, r || '');
  }
  check('a plain Read is never refused', denialOf(gate('pre', pre(sid, 'Read', { file_path: 'x.ts' }))) === null);
  check('the stand-down invocation survives the debt gate',
    denialOf(gate('pre', pre(sid, 'Bash', { command: 'node "' + GATE + '" stand-down --gate all --reason "x"' }))) === null);

  // THE KEY TURNS. One read, and work proceeds.
  gate('post', post(sid, MCP + 'read_board', { board_id: UUID_B }, 'Board contents [id: ' + UUID_B + ']'));
  const cleared = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('the mapped read CLEARS the debt in one step', cleared === null, cleared || '');
  check('  …and the file write is released with it',
    denialOf(gate('pre', pre(sid, 'Write', { file_path: path.join(PROJ, 'notes.md'), content: 'x' }))) === null);
}

function caseDebtSeams() {
  console.log('\nD2b the debt gate must not refuse what ANOTHER gate demands');
  const G = require('./canon-gate.js');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  leakUnverifiedWrite(sid);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
  check('(precondition) the debt gate is firing',
    /CANON-DEBT-READ-BACK/.test(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) || ''));

  // CANON-ACCOUNT's block says "you may always stop with an account" and names create_journal.
  // A debt gate that refuses THAT call turns two safe gates into one latch at the seam.
  for (const [tool, input] of [['create_journal', { folder_id: UUID_A, title: 'blocked' }],
    ['update_journal', { journal_id: UUID_A }], ['create_journal_folder', {}],
    ['transfer_coordinator_title', { channel_id: UUID_A }]]) {
    const d = denialOf(gate('pre', pre(sid, MCP + tool, input)));
    check(tool + ' — another gate\'s published key — is never refused for debt',
      !/CANON-DEBT/.test(d || ''), d || '');
    check('  …and it is declared, not just implemented', G.OTHER_GATE_KEYS.has(tool), tool);
  }

  // A COMPLIANT BATCH: settle the debt and resume the work in one round trip. The canon tells
  // the model to batch, so the batch that obeys must never be the thing that gets refused.
  const okBulk = denialOf(gate('pre', pre(sid, MCP + 'bulk', {
    calls: [
      { tool: 'read_board', arguments: { board_id: UUID_B } },
      { tool: 'update_task', arguments: { task_id: UUID_A } },
    ],
  })));
  check('a bulk that settles the debt then works is allowed', okBulk === null, okBulk || '');

  // …and the same batch the other way round is not, or the ordering means nothing.
  const badBulk = denialOf(gate('pre', pre(sid, MCP + 'bulk', {
    calls: [
      { tool: 'update_task', arguments: { task_id: UUID_A } },
      { tool: 'read_board', arguments: { board_id: UUID_B } },
    ],
  })));
  check('a bulk that works BEFORE settling is refused at that item',
    /CANON-DEBT-READ-BACK/.test(badBulk || '') && /\[0\]/.test(badBulk || ''), badBulk || '(ALLOWED)');
}

function caseDebtThisTurn() {
  console.log('\nD2 CANON-DEBT-READ-BACK — a debt is only a debt once a turn has ended on it');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  gate('post', post(sid, MCP + 'create_board', { project_id: UUID_A }, 'Created board [id: ' + UUID_B + ']'));

  // Mid-turn, the obligation is live but NOT carried. PostToolUse already blocked for it;
  // refusing here as well would double-charge the model for one mistake and would make the
  // ordinary write-then-read rhythm impossible.
  const same = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('an obligation opened THIS turn does not refuse this turn\'s work',
    !/CANON-DEBT/.test(same || ''), same || '');
}

function caseDebtCloseout() {
  console.log('\nD3 CANON-DEBT-CLOSEOUT — the missing close-out is refused on the NEXT turn');
  const sid = fresh();
  cli(RUN_ARGS);
  patchRun({ all_phases_terminal: true });
  seedSeen(sid, UUID_A);

  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  const s1 = blockOf(gate('stop', stop(sid, false)));
  check('(control) the first Stop blocks the missing close-out', /CANON-CLOSEOUT/.test(s1 || ''), s1 || '(no block)');
  const s2 = blockOf(gate('stop', stop(sid, true)));
  check('(control) the Stop RE-ENTRY lets the turn end with the entire close-out missing',
    s2 === null, s2 || '');

  const p = gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'next' });
  const ctx = (p.json && p.json.hookSpecificOutput && p.json.hookSpecificOutput.additionalContext) || '';
  check('the prompt that opens the turn already names the close-out calls',
    /DEBT CARRIED IN/.test(ctx) && /create_knowledge_graph/.test(ctx), ctx);

  const d = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('the next turn\'s first portal write is REFUSED', /CANON-DEBT-CLOSEOUT/.test(d || ''), d || '(ALLOWED)');
  check('  …and the reason lists what is actually absent',
    /create_knowledge_graph/.test(d || '') && /interpret_knowledge_graph/.test(d || ''), d || '');
  check('  …and carries no imperative and no escape',
    Boolean(d) && !/to clear|you must|run |please |stand-down/i.test(d || ''), d || '');

  // THE KEY. Every call on the close-out path is a portal WRITE, so without an explicit
  // exemption this gate refuses the exact work it demands — the defect that shipped twice
  // before (CANON-COORD-ROLE, CANON-JOURNAL-PHASE).
  for (const [tool, input] of [
    ['create_board', {}],
    ['create_board_block', { board_id: UUID_A, type: 'mermaid' }],
    ['create_knowledge_graph', {}],
    ['add_source_to_knowledge_graph', { graph_id: UUID_A, source_type: 'note' }],
    ['extract_knowledge_graph', { graph_id: UUID_A }],
    ['interpret_knowledge_graph', { graph_id: UUID_A }],
    ['create_journal', { folder_id: UUID_A }],
  ]) {
    const r = denialOf(gate('pre', pre(sid, MCP + tool, input)));
    check(tool + ' — on the close-out path the card demands — is not refused by this gate',
      !/CANON-DEBT-CLOSEOUT/.test(r || ''), r || '');
  }

  // THE KEY TURNS. Make the close-out, and work is released.
  gate('post', post(sid, MCP + 'create_board', {}, 'Board [id: ' + UUID_A + ']'));
  gate('post', post(sid, MCP + 'create_knowledge_graph', {}, 'Graph [id: ' + UUID_C + ']'));
  for (const s of ['journal', 'note', 'board']) {
    gate('post', post(sid, MCP + 'add_source_to_knowledge_graph', { graph_id: UUID_C, source_type: s }, 'added'));
  }
  gate('post', post(sid, MCP + 'extract_knowledge_graph', { graph_id: UUID_C }, 'extracted'));
  gate('post', post(sid, MCP + 'interpret_knowledge_graph', { graph_id: UUID_C }, 'interpreted'));
  gate('post', post(sid, MCP + 'get_knowledge_graph', { graph_id: UUID_C }, 'graph [id: ' + UUID_C + ']'));
  gate('post', post(sid, MCP + 'create_journal', { folder_id: UUID_A }, 'Journal [id: ' + UUID_B + ']'));
  gate('post', post(sid, MCP + 'list_journals', {}, 'entries'));
  const cleared = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
  check('the close-out CLEARS the debt', !/CANON-DEBT-CLOSEOUT/.test(cleared || ''), cleared || '');
}

function caseDebtDegrades() {
  console.log('\nD4 the debt gate degrades rather than wedging the session');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  leakUnverifiedWrite(sid);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });

  // The portal is unreachable and the model cannot settle the debt. It must not be refused
  // for ever: a PreToolUse gate that never stands down is a session with no way forward.
  let refused = 0;
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const d = denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })));
    const hit = /CANON-DEBT-READ-BACK/.test(d || '');
    seq.push(hit ? 'DENY' : 'allow');
    if (hit) refused++;
  }
  check('the same debt refuses at most 3 times', refused <= 3, seq.join(' → '));
  check('and it did refuse before it stood down', refused > 0, seq.join(' → '));
  check('work proceeds once the budget is spent', seq[seq.length - 1] === 'allow', seq.join(' → '));

  // The debt is still real; it just stopped refusing. The turn end still says so.
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'more' });
  const b = blockOf(gate('stop', stop(sid, false)));
  check('the Stop gate still reports the unsettled write', /CANON-READ-BACK-STOP/.test(b || ''), b || '(no block)');
}

function caseDebtColdReturn() {
  console.log('\nD5 the cold return — a debt left days ago, a brand-new session');
  const sidA = fresh();
  cli(RUN_ARGS);
  seedSeen(sidA, UUID_A);
  leakUnverifiedWrite(sidA);
  // The owner walks away. SessionEnd wipes the session ledger; the project keeps the debt.
  gate('session-end', { session_id: sidA, cwd: PROJ, hook_event_name: 'SessionEnd' });
  check('(control) the session ledger really is gone',
    fs.readdirSync(path.join(HOME, 'sessions')).length === 0,
    fs.readdirSync(path.join(HOME, 'sessions')).join(','));

  // Days later, a brand-new session in the same project.
  const sidB = 'sess-cold-' + SESSION;
  const r = gate('session-start', { session_id: sidB, cwd: PROJ, hook_event_name: 'SessionStart' });
  const card = (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext) || '';
  check('the card announces the carried debt', /DEBT CARRIED IN/.test(card), card.slice(0, 200));
  check('  …and names the ONE call that settles it', /read_board\("?bbbbbbbb/.test(card), card.slice(0, 400));
  check('  …and still publishes the stand-down escape', /stand-down --gate/.test(card));

  // UserPromptSubmit only ever speaks. It is the channel that reaches the model BEFORE its
  // first action of the turn, which is the action about to be refused.
  const p = gate('prompt', { session_id: sidB, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'pick it up' });
  const ctx = (p.json && p.json.hookSpecificOutput && p.json.hookSpecificOutput.additionalContext) || '';
  check('UserPromptSubmit names the one-step settling call', /read_board\("?bbbbbbbb/.test(ctx), ctx);

  seedSeen(sidB, UUID_A);
  const d = denialOf(gate('pre', pre(sidB, MCP + 'update_task', { task_id: UUID_A })));
  check('the cold return\'s first portal write is REFUSED', /CANON-DEBT-READ-BACK/.test(d || ''), d || '(ALLOWED)');
  check('  …and the reason names the write it inherited', /create_board/.test(d || ''), d || '');

  const rd = denialOf(gate('pre', pre(sidB, MCP + 'read_board', { board_id: UUID_B })));
  check('the settling read is reachable in the new session', rd === null, rd || '');
  gate('post', post(sidB, MCP + 'read_board', { board_id: UUID_B }, 'Board contents [id: ' + UUID_B + ']'));
  const cleared = denialOf(gate('pre', pre(sidB, MCP + 'update_task', { task_id: UUID_A })));
  check('ONE read settles a debt inherited across sessions', cleared === null, cleared || '');

  // …and once settled it must not come back on the next session either.
  gate('stop', stop(sidB, false));
  gate('stop', stop(sidB, true));
  const sidC = 'sess-cold2-' + SESSION;
  const r2 = gate('session-start', { session_id: sidC, cwd: PROJ, hook_event_name: 'SessionStart' });
  const card2 = (r2.json && r2.json.hookSpecificOutput && r2.json.hookSpecificOutput.additionalContext) || '';
  check('a settled debt is not carried into the session after that', !/DEBT CARRIED IN/.test(card2), card2.slice(0, 200));
  check('  …and the next session\'s first write is not refused',
    denialOf(gate('pre', pre(sidC, MCP + 'update_task', { task_id: UUID_A }))) === null);
}

function caseDebtEscapes() {
  console.log('\nD6 the debt gate obeys every escape, like every other gate');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  leakUnverifiedWrite(sid);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
  check('(precondition) the debt gate is firing',
    /CANON-DEBT-READ-BACK/.test(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) || ''));

  cli(['stand-down', '--gate', 'CANON-DEBT-READ-BACK', '--reason', 'selftest']);
  check('the gate-scoped sentinel clears it',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) === null);
  fs.unlinkSync(path.join(HOME, 'STAND-DOWN-CANON-DEBT-READ-BACK'));
  check('and it re-arms when the sentinel is deleted',
    Boolean(denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A })))));

  cli(['stand-down', '--gate', 'all', '--reason', 'selftest']);
  check('the global sentinel clears it',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) === null);
  fs.unlinkSync(path.join(HOME, 'STAND-DOWN'));

  check('PORTAL_CANON=off clears it',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }), { PORTAL_CANON: 'off' })) === null);
  check('PORTAL_CANON=advisory clears it',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }), { PORTAL_CANON: 'advisory' })) === null);

  // An explicit run-close is the owner saying the work is over. Debt goes with it.
  cli(['run-close', '--reason', 'selftest']);
  check('run-close settles the project\'s debt',
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) === null,
    denialOf(gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }))) || '');
}

function caseDebtCardOverflow() {
  console.log('\nD7 the card overflows before the escape does');
  const G = require('./canon-gate.js');
  const sid = fresh();
  // A long client/project and a full debt block are what push a card that used to fit past
  // the cap. The old buildCard was one array and one slice(), so the FIRST thing lost was
  // the tail — which is the STAND DOWN block, i.e. the only text saying how to turn any of
  // this off. Losing a gate description costs a line of documentation; losing the escape
  // costs the owner their way out.
  cli(['run-open', '--client', 'A'.repeat(140), '--project', 'B'.repeat(140), '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  for (const [tool, id] of [['create_board', UUID_B], ['create_client', UUID_C],
    ['create_project', 'dddddddd-4444-4444-8444-dddddddddddd'],
    ['create_note', 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'],
    ['create_task', 'ffffffff-6666-4666-8666-ffffffffffff']]) {
    gate('post', post(sid, MCP + tool, {}, 'Created [id: ' + id + ']'));
  }
  gate('stop', stop(sid, false));
  gate('stop', stop(sid, true));

  const sidB = 'sess-overflow-' + SESSION;
  const r = gate('session-start', { session_id: sidB, cwd: PROJ, hook_event_name: 'SessionStart' });
  const card = (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext) || '';
  check('the card still respects its cap', card.length <= G.CARD_CAP, 'len=' + card.length);
  check('the liveness token survives', /\[portal-canon v1 · alive · token/.test(card), card.slice(0, 120));
  check('the carried debt survives', /DEBT CARRIED IN/.test(card), card.slice(0, 300));
  check('THE ESCAPE SURVIVES', /stand-down --gate/.test(card), card.slice(-300));
  // The whole tail, not just the first line of it — the first attempt at this kept
  // `stand-down --gate` and still lost the closing line to a blind slice().
  check('  …and so does every line after it, uncut',
    /PORTAL_CANON=off/.test(card) && card.trim().endsWith('They cannot tell whether a brief is good.'),
    JSON.stringify(card.slice(-120)));
  check('(precondition) this fixture really did overflow the card',
    /more gate\(s\)/.test(card), 'len=' + card.length + ' — nothing was dropped, so nothing was proved');
  check('dropped gates are announced rather than vanishing silently',
    /· …\d+ more gate\(s\)/.test(card), card.split('\n').find((l) => /more gate/.test(l)) || '(none)');
}

function caseDebtHotPath() {
  console.log('\nD8 the debt gate must not put anything on the ungated hot path');
  const sid = fresh();
  cli(RUN_ARGS);
  seedSeen(sid, UUID_A);
  leakUnverifiedWrite(sid);
  gate('prompt', { session_id: sid, cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
  // With the largest debt this gate can carry, the calls it does not gate must still be
  // waved through without a decision — that is the ~100ms path the whole design protects.
  for (const [tool, input] of [['Read', { file_path: 'x.ts' }], ['Grep', { pattern: 'x' }],
    ['Glob', { pattern: '*.ts' }], ['mcp__Desktop_Commander__read_file', { path: 'x.ts' }],
    ['Bash', { command: 'git status' }], ['TodoWrite', { todos: [] }]]) {
    const r = gate('pre', pre(sid, tool, input));
    check('ungated ' + tool + ' stays silent under debt', r.raw === '' && r.code === 0,
      'out=' + r.raw.slice(0, 80) + ' exit=' + r.code);
  }
}

// --- run --------------------------------------------------------------------

function caseGapBulkResponseShape() {
  console.log('\nGAP a bulk tool_response is CONTENT BLOCKS, not a string');
  // MEASURED ON A LIVE SESSION, 2026-08-16, and this whole file is why it survived to be
  // measured there: every fixture above hands post() a plain STRING, which is the one
  // shape that worked. A real MCP tool_response arrives as content blocks, the old code
  // stringified anything non-string, and stringifying escapes every newline. RE_BULK_ITEM
  // is `^`-anchored under /m and needs a REAL newline, so it matched nothing and EVERY
  // bulk row was written with `inner: []`. Seven such rows in one session, not one id
  // harvested from any of them, and CANON-ID refused three ids the portal had just
  // issued — on the batching path the canon itself tells the agent to prefer.
  //
  // A gate that refuses ids the portal returned is worse than a gate that is off, so the
  // assertion below is deliberately about CANON-ID SPECIFICALLY, not about the call being
  // allowed: a write straight after a write is legitimately answerable by the read-back
  // gate, and folding those two together is how a test stops meaning anything.
  const body = 'Ran 2/2 call(s); 0 failed.\n'
    + '[0] add_proposal_milestone: Milestone added with ID ' + UUID_B + '\n'
    + '[1] create_task: Created task [id: ' + UUID_C + ']';
  const calls = { calls: [{ tool: 'add_proposal_milestone', arguments: {} }, { tool: 'create_task', arguments: {} }] };

  for (const [label, resp] of [
    ['content blocks   ', [{ type: 'text', text: body }]],
    ['result object    ', { content: [{ type: 'text', text: body }] }],
    ['split over blocks', [{ type: 'text', text: body.split('\n')[0] }, { type: 'text', text: body.split('\n').slice(1).join('\n') }]],
    ['plain string     ', body],
  ]) {
    const sid = fresh();
    const p = post(sid, MCP + 'bulk', calls, null);
    p.tool_response = resp;
    gate('post', p);
    const w = gate('pre', pre(sid, MCP + 'update_proposal_milestone', { milestone_id: UUID_B, status: 'delivered' }));
    check('id created inside a bulk is not called unseen — ' + label,
      !/CANON-ID/.test(denialOf(w) || ''), denialOf(w) || '');
    const w2 = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_C, status: 'done' }));
    check('bracket-form id in the same bulk is not called unseen — ' + label,
      !/CANON-ID/.test(denialOf(w2) || ''), denialOf(w2) || '');
  }

  // The other side: harvesting more must not make CANON-ID toothless.
  const sid = fresh();
  const p = post(sid, MCP + 'bulk', { calls: [{ tool: 'create_task', arguments: {} }] }, null);
  p.tool_response = [{ type: 'text', text: 'Ran 1/1 call(s); 0 failed.\n[0] create_task: Created task [id: ' + UUID_C + ']' }];
  gate('post', p);
  const bad = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A, status: 'done' }));
  check('a fabricated id after a bulk is STILL refused', /CANON-ID/.test(denialOf(bad) || ''), denialOf(bad) || '');
}

function caseGapLedgerLineAlwaysParses() {
  console.log('\nGAP an over-long ledger line must still parse');
  // readLines() skips any line it cannot JSON.parse, in silence. append() used to shrink
  // an over-long row with `JSON.stringify(obj).slice(0, 3990)` and patch the tail with
  // `"}`, which produces valid JSON only by luck — so an over-long row did not arrive
  // trimmed, it VANISHED. Rows disappearing from the ledger is the same failure class as
  // the bulk bug above: the gate then refuses honest work for lack of evidence.
  const os = require('os'), fs = require('fs'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-append-'));
  const prev = process.env.PORTAL_CANON_HOME;
  process.env.PORTAL_CANON_HOME = tmp;
  delete require.cache[require.resolve('./canon-lib.js')];
  const L2 = require('./canon-lib.js');
  const row = {
    v: 1, t: L2.nowS(), k: 'bulk', s: 'k', a: null, tool: 'bulk', n: 40, ran: 40, failed: 0,
    ids: Array.from({ length: 80 }, (_, i) => 'aaaaaaaa-bbbb-cccc-dddd-' + String(i).padStart(12, '0')),
    inner: Array.from({ length: 40 }, (_, i) => ({
      i, tool: 'create_board_block', ok: true, args: { type: 'mermaid', content: 'x'.repeat(500) },
      ids: Array.from({ length: 25 }, (_, j) => 'ffffffff-eeee-dddd-cccc-' + String(i * 100 + j).padStart(12, '0')),
    })),
  };
  L2.append('k', row);
  const raw = fs.readFileSync(path.join(tmp, 'sessions', 'k.jsonl'), 'utf8').trim();
  let parses = true;
  try { JSON.parse(raw); } catch (_) { parses = false; }
  check('an over-long row is written as valid JSON', parses, 'len=' + raw.length + ' tail=' + JSON.stringify(raw.slice(-50)));
  check('and readLines recovers it rather than dropping it', L2.readLines('k').length === 1);
  const back = L2.readLines('k')[0] || {};
  check('the trimmed row still carries its kind and some ids', back.k === 'bulk' && (back.ids || []).length > 0);
  if (prev === undefined) delete process.env.PORTAL_CANON_HOME; else process.env.PORTAL_CANON_HOME = prev;
  delete require.cache[require.resolve('./canon-lib.js')];
}

function caseGapTreeSurvivesTheSession() {
  console.log('\nGAP the decomposition belongs to the RUN, not to whichever session saw it');
  // MEASURED, and it stopped three sub-agents dead in one session.
  //
  // CANON-TREE-FIRST counted the four decomposition calls in the SESSION FAMILY's tool
  // stream. A run outlives a session, so restarting Claude Code mid-run hid a tree built an
  // hour earlier and every source write was refused — the reason insisting the run had "no
  // recorded create_task" while the tasks sat in the portal.
  //
  // Worse for sub-agents, which is how it surfaced: a fresh sub-agent's stream contains no
  // portal writes AT ALL, and must not, because the canon explicitly says to keep portal
  // writes in the parent session. The canon asked for something it then refused to accept.
  const fs = require('fs'), path = require('path');
  const sid = fresh();
  const open = cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  const runId = ((open.stdout || '') .match(/r-[0-9a-f]+/) || [])[0];
  check('(precondition) a run was opened', Boolean(runId));
  const src = path.join(PROJ, 'thing.ts');

  // Before any decomposition: refused, as it should be.
  const before = gate('pre', pre(sid, 'Write', { file_path: src, content: 'x' }));
  check('(precondition) refuses a source write with no decomposition',
    /CANON-TREE-FIRST/.test(denialOf(before) || ''));

  // Build the decomposition in THIS session.
  seedSeen(sid, UUID_A);
  for (const [tool, args] of [
    ['create_task', { title: 'T' }],
    ['create_subtask', { parent_task_id: UUID_A, title: 'S' }],
    ['create_flow_cluster', { title: 'C' }],
    ['create_flow_connection', { source_id: UUID_A, target_id: UUID_B }],
  ]) gate('post', post(sid, MCP + tool, args, 'ok [id: ' + UUID_C + ']'));

  const after = gate('pre', pre(sid, 'Write', { file_path: src, content: 'x' }));
  check('allows the write once the decomposition exists',
    !/CANON-TREE-FIRST/.test(denialOf(after) || ''), (denialOf(after) || '').slice(0, 140));

  // THE ACTUAL BUG: a NEW session — a restart, or a sub-agent — against the SAME run.
  // Its ledger is empty; the run's record is the only evidence, and it must be enough.
  const sid2 = 'sess-restart-' + Math.random().toString(16).slice(2, 8);
  const afterRestart = gate('pre', pre(sid2, 'Write', { file_path: src, content: 'x' }));
  check('a NEW session against the same run is not refused',
    !/CANON-TREE-FIRST/.test(denialOf(afterRestart) || ''), (denialOf(afterRestart) || '').slice(0, 200));

  // And the run itself carries the evidence, so it is durable rather than incidental.
  if (runId) {
    const run = JSON.parse(fs.readFileSync(path.join(HOME, 'runs', runId + '.json'), 'utf8'));
    const t = run.tree || {};
    check('the run records all four pieces',
      Boolean(t.task && t.subtask && t.cluster && t.connection), JSON.stringify(t));
  }

  // The other side: a DIFFERENT run with no decomposition is still refused, so this did
  // not simply switch the gate off.
  const sid3 = fresh();
  cli(['run-open', '--client', 'C2', '--project', 'P2', '--state', 'RUN']);
  const other = gate('pre', pre(sid3, 'Write', { file_path: path.join(PROJ, 'other.ts'), content: 'x' }));
  check('a different run with no decomposition is STILL refused',
    /CANON-TREE-FIRST/.test(denialOf(other) || ''), (denialOf(other) || '').slice(0, 140));
}

function caseGapSessionRefundsTheBudget() {
  console.log('\nGAP a new session refunds the block budget');
  // 1.6.1 made PROGRESS refund the per-gate block budget, which covered the common case.
  // This is the case it missed: the run outlives the session. A run that spent its three
  // blocks in the morning carried a silenced CANON-ACCOUNT — the gate whose only job is
  // refusing a silent stop mid-run — through every restart for the rest of the day.
  // Measured on a live run that reached the evening with it still off from hours earlier.
  const fs = require('fs'), path = require('path');
  const sid = fresh();
  const open = cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  const runId = ((open.stdout || '') + (open.stderr || '')).match(/r-[0-9a-f]+/);
  check('(precondition) a run was opened', Boolean(runId), open.stdout || open.stderr || '');
  if (!runId) return;
  const file = path.join(HOME, 'runs', runId[0] + '.json');

  const spend = () => {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    r.blocks = { 'CANON-ACCOUNT': 3 };
    r.degraded = { 'CANON-ACCOUNT': 'block budget of 3 exhausted in this run' };
    fs.writeFileSync(file, JSON.stringify(r));
  };
  spend();
  check('(precondition) the budget reads as exhausted', /exhausted/.test(fs.readFileSync(file, 'utf8')));

  // A NEW session id, but deliberately the SAME project directory — `fresh()` would mint
  // a new PROJ and resolve a different run, which would prove nothing.
  gate('session-start', { session_id: sid + '-restarted', cwd: PROJ, hook_event_name: 'SessionStart' });

  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('a new session clears the degraded gate',
    !after.degraded || !after.degraded['CANON-ACCOUNT'], JSON.stringify(after.degraded || {}));
  check('and clears the spent-block counter',
    !after.blocks || !after.blocks['CANON-ACCOUNT'], JSON.stringify(after.blocks || {}));

  // The cap must still work WITHIN a session — a wedged gate cannot be un-trappable.
  spend();
  const still = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('the cap still applies inside one session',
    Boolean(still.degraded && still.degraded['CANON-ACCOUNT']));
}

function caseGapQuotedAngleIsNotARedirect() {
  console.log('\nGAP a `>` inside quotes is a comparison, not a redirection');
  // MEASURED. `node -e '... Date.now() - mtime > 3600000 ...'` was REFUSED by
  // CANON-TREE-FIRST as "writes 3600000 (via a redirection)". The `>` is a numeric
  // comparison inside a single-quoted argument; no shell would redirect there.
  //
  // The cost was not cosmetic. The same regex decides shellMutation, so ANY quoted `>`
  // also made a read-only command look state-changing — which is the CANON-COORD-ROLE
  // premise too. A gate that refuses honest work is the failure this whole file exists
  // to catch, and this one refused a read-only diagnostic.
  const L = require('./canon-lib.js');
  const cases = [
    ["node -e 'if (a - b > 3600000) x'", [], 'a quoted comparison'],
    ["node -e 'const q = a > b ? 1 : 2'", [], 'a quoted ternary'],
    ["awk '{ if ($1 > 5) print }' data.txt", [], 'an awk comparison'],
    ["grep -o 'a>b' f.txt", [], 'a > inside a search pattern'],
    ['echo hi > out.txt', ['out.txt'], 'a real redirect'],
    ['echo hi >> out.log', ['out.log'], 'a real append'],
    ['echo hi > "my file.txt"', ['my file.txt'], 'a real redirect to a QUOTED path'],
    ["node -e 'x > 1' > real.txt", ['real.txt'], 'quoted noise beside a real redirect'],
    ['cmd 2>&1', [], '2>&1, which names no file'],
  ];
  for (const [cmd, want, label] of cases) {
    const got = L.redirectTargets(cmd);
    check('redirect scan sees ' + label,
      JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got));
  }

  // And end to end, through the gate that actually refused: a read-only node one-liner
  // with a quoted `>` must not be treated as a project write.
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  const probe = gate('pre', pre(sid, 'Bash', { command: "node -e 'const old = Date.now() - t > 3600000; console.log(old)'" }));
  check('CANON-TREE-FIRST does not refuse a quoted comparison',
    !/CANON-TREE-FIRST/.test(denialOf(probe) || ''), (denialOf(probe) || '').slice(0, 160));

  // The other side, and the one that matters: a genuine redirect into the project IS
  // still refused. An absolute path, because that is what the gate resolves — the same
  // form every other CANON-TREE-FIRST fixture uses.
  const target = path.join(PROJ, 'thing.ts');
  const real = gate('pre', pre(sid, 'Bash', { command: 'echo x > "' + target + '"' }));
  check('and a genuine redirect into the project is still refused',
    /CANON-TREE-FIRST/.test(denialOf(real) || ''), (denialOf(real) || '').slice(0, 160));
  check('  …and still names the file', /thing\.ts/i.test(denialOf(real) || ''));
}

function caseGapProgressKeepsTheNetUp() {
  console.log('\nGAP the tool people actually use marks a boundary, and progress restores the budget');
  // REPORTED BY THE OWNER, in these words: "I keep telling you to continue."
  //
  // Two defects, compounding, both measured on a live day-long run:
  //
  //  1. Only `update_milestone_status` marked a phase boundary. The tool an agent
  //     actually reaches for — and the one the canon's own status guidance names —
  //     is `update_proposal_milestone`. Three milestones were delivered and the run
  //     still reported "phase boundaries recorded 0".
  //  2. CANON-ACCOUNT's block budget was per-run and monotonic: three blocks and it
  //     degrades to a notice for the rest of the run, forever. On a run lasting a
  //     working day the net is gone by mid-morning, so the OWNER became the net.
  //
  // Together: the gate that exists to refuse a silent stop went quiet, and the
  // signal that would have shown the run was healthy was never recorded.

  // (1) the boundary is recorded for the tool people use — proved through the gate
  //     that keys on boundaries, not by inspecting the ledger.
  const sid = fresh();
  cli(['run-open', '--client', 'C', '--project', 'P', '--state', 'RUN']);
  seedSeen(sid, UUID_A);
  gate('post', post(sid, MCP + 'update_proposal_milestone', { milestone_id: UUID_B, status: 'delivered' }, 'ok [id: ' + UUID_B + ']'));
  const afterBoundary = gate('pre', pre(sid, MCP + 'update_task', { task_id: UUID_A }));
  check('update_proposal_milestone(delivered) marks a phase boundary',
    /CANON-JOURNAL-PHASE/.test(denialOf(afterBoundary) || ''), (denialOf(afterBoundary) || '').slice(0, 140));
  check('and the refusal names that milestone', (denialOf(afterBoundary) || '').includes(UUID_B));

  // `approved` is a delivered state too — it was not matched before.
  const sid2 = fresh();
  cli(['run-open', '--client', 'C2', '--project', 'P2', '--state', 'RUN']);
  seedSeen(sid2, UUID_A);
  gate('post', post(sid2, MCP + 'update_proposal_milestone', { milestone_id: UUID_C, status: 'approved' }, 'ok [id: ' + UUID_C + ']'));
  const approved = gate('pre', pre(sid2, MCP + 'update_task', { task_id: UUID_A }));
  check('approved counts as a boundary as well as delivered',
    /CANON-JOURNAL-PHASE/.test(denialOf(approved) || ''), (denialOf(approved) || '').slice(0, 140));

  // (2) progress restores a spent budget.
  const fs = require('fs'); const path = require('path');
  const sid3 = fresh();
  const open = cli(['run-open', '--client', 'C3', '--project', 'P3', '--state', 'RUN']);
  const runId = ((open.stdout || '').match(/r-[0-9a-f]+/) || [])[0];
  check('(precondition) a run was opened', Boolean(runId), open.stdout || open.stderr || '');
  if (runId) {
    const file = path.join(HOME, 'runs', runId + '.json');
    const spend = () => { const r = JSON.parse(fs.readFileSync(file, 'utf8')); r.blocks = { 'CANON-ACCOUNT': 3 }; r.degraded = { 'CANON-ACCOUNT': 'block budget of 3 exhausted in this run' }; fs.writeFileSync(file, JSON.stringify(r)); };
    spend();
    check('(precondition) the budget reads as exhausted',
      /exhausted/.test(fs.readFileSync(file, 'utf8')));
    gate('post', post(sid3, MCP + 'update_proposal_milestone', { milestone_id: UUID_B, status: 'delivered' }, 'ok [id: ' + UUID_B + ']'));
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('delivering a milestone restores the block budget',
      !after.degraded || !after.degraded['CANON-ACCOUNT'], JSON.stringify(after.degraded || {}));
    check('and the run records when it last moved', Boolean(after.last_progress_at));
  }
}

function caseGapUuidFragmentIsNotAnId() {
  console.log('\nGAP a fragment of a uuid is not a child task');
  // MEASURED. The slug-id shape (`col-<hex>`) matches INSIDE a uuid: the tail of
  // 72ce4477-f495-4306-ab5a-d768e61ac91c matches as `ab5a-d768e61ac91c`. Harvested from a
  // list_subtasks response it was recorded as a CHILD of that very task, and
  // CANON-BOTTOM-UP then refused a legitimate complete_task because a "subtask" the portal
  // had never issued was not completed. Unclearable: there is no such subtask to complete.
  //
  // canon-lib already warned that a false child is unclearable where a false seen-id is
  // merely weakening. The warning was written; the guard was not.
  const L = require('./canon-lib.js');
  const parent = '72ce4477-f495-4306-ab5a-d768e61ac91c';
  const ids = L.harvestSeen('Found 1 subtask(s) for task ' + UUID_A + ':\n- [pending] M11.1 [id: ' + parent + ']');
  check('a uuid fragment is not harvested as an id', !ids.includes('ab5a-d768e61ac91c'), JSON.stringify(ids));
  check('and the real uuid still is', ids.includes(parent));
  check('a genuine col-<hex> slug is still harvested',
    L.harvestSeen('column [id: col-9f3ab21c7d4e]').includes('col-9f3ab21c7d4e'));

  // The end-to-end shape: listing a child, then completing it, must not be refused for a
  // phantom sibling invented out of the parent's own id.
  const sid = fresh();
  gate('post', post(sid, MCP + 'list_subtasks', { parent_task_id: UUID_A },
    'Found 1 subtask(s) for task ' + UUID_A + ':\n- [pending] leaf [id: ' + parent + ']'));
  gate('post', post(sid, MCP + 'complete_task', { task_id: parent }, 'Task completed'));
  const r = gate('pre', pre(sid, MCP + 'complete_task', { task_id: UUID_A }));
  check('completing the parent after its only real child is not refused',
    !/CANON-BOTTOM-UP/.test(denialOf(r) || ''), (denialOf(r) || '').slice(0, 150));
}

function caseGapReadBackLongList() {
  console.log('\nGAP a read-back must survive a LONG list response');
  // MEASURED ON A LIVE MACHINE, and it cost two gates being stood down. The ledger row is
  // capped at 4 KB and over-long rows had their `ids` trimmed with slice(0, N) -- the FIRST
  // N ids. But a read-back is always about a record just written, and a freshly created row
  // is the LAST entry a list response returns. So the head-slice discarded exactly the id
  // the obligation was waiting for.
  //
  // list_flow_clusters returned 104 clusters with the new one last; its id never reached the
  // ledger, the obligation never discharged, and the gate then demanded a FILTERED re-read of
  // a tool that takes no arguments at all -- an unclearable latch, produced entirely by the
  // truncation. The workspace had to get busy before this could bite, which is why it shipped.
  const uuidN = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

  for (const [label, writeTool, readTool, made] of [
    ['flow cluster   ', 'create_flow_cluster', 'list_flow_clusters', "Cluster 'New' created with ID "],
    ['flow connection', 'create_flow_connection', 'list_flow_connections', 'Connection created between a and b with ID '],
  ]) {
    const sid = fresh();
    gate('post', post(sid, MCP + writeTool, {}, made + UUID_B));

    // The mapped read, shaped like the real tool: a whole-workspace listing long enough to
    // blow the 4 KB ledger line several times over, with the new row in the MIDDLE.
    //
    // Position 78 of 121 is not arbitrary — it is where the real one landed. These listings
    // are not ordered by creation, so "the newest is last" is false, and an earlier fix that
    // kept both ends of the id list passed a version of this test that put the row last
    // while still failing in production. The middle is the case that discriminates.
    const lines = [];
    for (let i = 0; i < 120; i++) {
      if (i === 78) lines.push("- Row NEW | tasks (0): | color: rgba(0,0,0,0.1) [id: " + UUID_B + ']');
      lines.push('- Row ' + i + ' | tasks (1): ' + uuidN(i)
        + ' | color: rgba(99,102,241,0.15) | description: filler text to push this row well past the ledger cap [id: '
        + uuidN(1000 + i) + ']');
    }
    gate('post', post(sid, MCP + readTool, {}, 'Found 121 row(s):\n' + lines.join('\n')));

    const r = gate('stop', stop(sid));
    check('a 121-row listing discharges the obligation for a MIDDLE id — ' + label,
      !/CANON-READ-BACK/.test(blockOf(r) || ''), (blockOf(r) || '').slice(0, 160));
  }

  // The other side: a read that genuinely does NOT contain the written id must still owe.
  const sid = fresh();
  gate('post', post(sid, MCP + 'create_flow_cluster', {}, "Cluster 'New' created with ID " + UUID_B));
  gate('post', post(sid, MCP + 'list_flow_clusters', {}, 'Found 1 row(s):\n- Row A [id: ' + UUID_C + ']'));
  const r = gate('stop', stop(sid));
  check('a listing WITHOUT the written id still leaves the obligation standing',
    /CANON-READ-BACK/.test(blockOf(r) || ''), (blockOf(r) || '').slice(0, 160));
}

function caseGapCanonHomeDiscovery() {
  console.log('\nGAP the CLI and the hooks must resolve the SAME canon home');
  // MEASURED. CLAUDE_PLUGIN_DATA is set for a hook invocation and UNSET for a CLI one, and
  // /portal-continue opens by telling the agent to run `canon-gate.js run-promote` from
  // Bash. So the run was written to one home while every hook read another, and the card
  // kept reporting "no run declared" however many times it was promoted — the command's
  // own first step was a silent no-op. Precedence is the regression risk here: the hook
  // path and the explicit override must both keep behaving exactly as before.
  const { spawnSync } = require('child_process');
  const os = require('os'), fs = require('fs'), path = require('path');
  const LIB = path.join(__dirname, 'canon-lib.js');
  const ask = (extra) => {
    const e = Object.assign({}, process.env);
    delete e.PORTAL_CANON_HOME; delete e.CLAUDE_PLUGIN_DATA;
    Object.assign(e, extra || {});
    const r = spawnSync(process.execPath,
      ['-e', 'process.stdout.write(require(' + JSON.stringify(LIB) + ').HOME)'],
      { encoding: 'utf8', env: e, timeout: 20000 });
    return (r.stdout || '').trim();
  };

  const explicit = path.join(os.tmpdir(), 'canon-explicit-home');
  check('PORTAL_CANON_HOME still wins over everything',
    ask({ PORTAL_CANON_HOME: explicit, CLAUDE_PLUGIN_DATA: path.join(os.tmpdir(), 'ignored') }) === explicit);

  const pd = path.join(os.tmpdir(), 'canon-plugin-data');
  check('CLAUDE_PLUGIN_DATA still resolves to <data>/canon — the hook path is unchanged',
    ask({ CLAUDE_PLUGIN_DATA: pd }) === path.join(pd, 'canon'));

  const hasSessions = (h) => { try { return fs.readdirSync(path.join(h, 'sessions')).length > 0; } catch (_) { return false; } };
  const base = path.join(os.homedir(), '.claude', 'plugins', 'data');
  let live = null;
  try {
    for (const d of fs.readdirSync(base)) {
      for (const h of [path.join(base, d, 'canon'), path.join(base, d)]) if (hasSessions(h)) { live = h; break; }
      if (live) break;
    }
  } catch (_) { /* no plugin data on this machine — covered by the else branch */ }

  const cli = ask({});
  check('the CLI resolves to a home at all', Boolean(cli));
  if (live) {
    check('with no env set the CLI lands on a home that HAS sessions, not an empty sibling',
      hasSessions(cli), 'resolved to ' + cli);
  } else {
    check('with no live home anywhere, the CLI falls back to the default cleanly',
      cli.endsWith('management-portal-canon'), 'resolved to ' + cli);
  }
}

function run() {
  console.log('portal-canon selftest — every gate proved on BOTH sides');
  const cases = [caseSessionStart, caseP1, caseP2, caseP3, caseP3Latch, caseP4, caseP5,
    caseP5Latch, caseKeys, caseP6, caseP7,
    caseP8, caseO1, caseS1, caseNoRepeat, caseBudget, caseEscapes, caseFailSafe, casePrivacy,
    caseLifecycle, caseTools,
    caseGapShellSurface, caseGapTreeFirstEffect, caseGapBulk, caseGapBulkResponseShape,
    caseGapLedgerLineAlwaysParses, caseGapTreeSurvivesTheSession, caseGapQuotedAngleIsNotARedirect, caseGapSessionRefundsTheBudget, caseGapProgressKeepsTheNetUp, caseGapUuidFragmentIsNotAnId, caseGapReadBackLongList, caseGapCanonHomeDiscovery,
    caseGapIdProvenance, caseGapScope,
    caseDebtReadBack, caseDebtSeams, caseDebtThisTurn, caseDebtCloseout, caseDebtDegrades, caseDebtColdReturn,
    caseDebtEscapes, caseDebtCardOverflow, caseDebtHotPath];
  for (const c of cases) {
    try { c(); } catch (e) { fail++; failures.push(c.name + ' threw: ' + e.message); console.log('  FAIL  ' + c.name + ' threw: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('\nfailures:'); for (const f of failures) console.log('  · ' + f); }
  process.exit(fail ? 1 : 0);
}

module.exports = { run };
if (require.main === module) run();
