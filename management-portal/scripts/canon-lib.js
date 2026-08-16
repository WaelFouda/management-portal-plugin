#!/usr/bin/env node
/**
 * canon-lib.js — the shared machinery behind canon-gate.js.
 *
 * No dependencies, Node built-ins only, one process per hook invocation. Everything
 * here has to be safe to run on the hot path of every tool call, so: no network, no
 * read-modify-write of the append-only ledger, and no throw that escapes to the caller.
 *
 * WHY THE CREDENTIAL AND HTTPS CODE IS DUPLICATED FROM watch-alarm.js RATHER THAN
 * REFACTORED OUT OF IT. watch-alarm.js is a shipping Stop gate with measured behaviour
 * and its own hard-won handling of a credential store full of husks. Reaching into it
 * to share code would put a live production gate at risk to save a hundred lines. The
 * duplication is deliberate and is documented at both ends.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Paths and homes
// ---------------------------------------------------------------------------

/**
 * normPath — COPIED VERBATIM from watch-alarm.js:171-184.
 *
 * Do not "improve" this. Windows hands the same directory to different processes as
 * `D:\Important Trading Files\...` and `D:\IMPORT~1\...`, and a string compare between
 * the two says "different project" — which already cost one false alarm. Resolving
 * against the filesystem is the only thing that makes the two agree.
 *
 * Returns `real: true` only when the path was resolved against the filesystem. The
 * caller must treat anything less as "cannot tell".
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

/**
 * normPath for a path that MAY NOT EXIST YET — a file a Write is about to create.
 *
 * normPath can only resolve what is on disk, and a containment check between a
 * resolved project dir and an UNRESOLVED target silently fails on Windows: the project
 * resolves to `c:\users\wael fouda\...` while the not-yet-created file keeps the 8.3
 * short form `c:\users\waelfo~1\...`, and startsWith says "different project". Measured
 * in the selftest, where it made CANON-TREE-FIRST inert for every Write that creates a
 * new file — which is most of them.
 *
 * So resolve the deepest ancestor that DOES exist and re-attach the tail.
 */
function normTarget(p) {
  if (!p) return { value: null, real: false };
  const direct = normPath(p);
  if (direct.real) return direct;
  const abs = path.resolve(String(p));
  let dir = path.dirname(abs);
  const tail = [path.basename(abs)];
  for (let i = 0; i < 64; i++) {
    const n = normPath(dir);
    if (n.real) {
      let v = n.value + path.sep + tail.slice().reverse().join(path.sep);
      v = v.replace(/[\\/]+$/, '');
      if (process.platform === 'win32') v = v.toLowerCase().replace(/\//g, '\\');
      return { value: v, real: true };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    tail.push(path.basename(dir));
    dir = parent;
  }
  return direct;
}

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

const DEFAULT_HOME = path.join(os.homedir(), '.claude', 'plugins', 'data', 'management-portal-canon');

/**
 * Find the canon home a HOOK is using, from a process that has no CLAUDE_PLUGIN_DATA.
 *
 * MEASURED BUG. `CLAUDE_PLUGIN_DATA` is set for hook invocations and UNSET for a plain CLI
 * one — and `/portal-continue` opens by telling the agent to run `canon-gate.js run-promote`
 * from Bash. So the promotion wrote a run to `data/management-portal-canon/runs/` while every
 * hook read `data/management-portal-inline/canon/`. The two never met: the run existed, the
 * gates could not see it, and the session card kept saying "no run declared" however many
 * times it was promoted. The command's own first step was silently a no-op.
 *
 * Guessing the folder name is not available: this machine carries THREE of them
 * (`management-portal-canon`, `-inline`, `-portal`), because the plugin has been installed
 * under different marketplace names over time. So find it by evidence instead — the home
 * whose `sessions/` was written to most recently is the one the hooks are live in.
 *
 * This runs ONLY on the CLI branch, never when CLAUDE_PLUGIN_DATA is set, so it adds nothing
 * to the hook hot path. Returns null when there is no evidence either way.
 */
function discoverHome() {
  try {
    const base = path.join(os.homedir(), '.claude', 'plugins', 'data');
    let best = null;
    for (const entry of fs.readdirSync(base)) {
      // Both layouts are real and both are on this machine: `<data>/<name>/canon/sessions`
      // (set via CLAUDE_PLUGIN_DATA) and `<data>/<name>/sessions` (the default home).
      for (const home of [path.join(base, entry, 'canon'), path.join(base, entry)]) {
        let names;
        try { names = fs.readdirSync(path.join(home, 'sessions')); } catch (_) { continue; }
        let newest = 0;
        // Capped: a long run can leave a lot of shards, and this is a startup path.
        for (const n of names.slice(0, 200)) {
          try {
            const m = fs.statSync(path.join(home, 'sessions', n)).mtimeMs;
            if (m > newest) newest = m;
          } catch (_) { /* a shard racing us is not worth failing over */ }
        }
        if (newest && (!best || newest > best.newest)) best = { home, newest };
      }
    }
    return best ? best.home : null;
  } catch (_) { return null; }
}

// HOW the home was chosen, for `doctor`. Printing the path alone is what let the split go
// unnoticed: two processes printed two different paths and neither said why, so the output
// looked equally plausible either way.
let HOME_SOURCE = 'default';

function canonHome() {
  if (process.env.PORTAL_CANON_HOME) { HOME_SOURCE = 'PORTAL_CANON_HOME (explicit)'; return process.env.PORTAL_CANON_HOME; }
  if (process.env.CLAUDE_PLUGIN_DATA) { HOME_SOURCE = 'CLAUDE_PLUGIN_DATA (hook runtime)'; return path.join(process.env.CLAUDE_PLUGIN_DATA, 'canon'); }
  const found = discoverHome();
  if (found) { HOME_SOURCE = 'discovered (most recent sessions/)'; return found; }
  HOME_SOURCE = 'default (nothing else resolved)';
  return DEFAULT_HOME;
}

const HOME = canonHome();
const DIR_SESSIONS = path.join(HOME, 'sessions');
const DIR_RUNS = path.join(HOME, 'runs');
const DIR_BYPROJ = path.join(DIR_RUNS, 'by-project');

function ensureDirs() {
  for (const d of [HOME, DIR_SESSIONS, DIR_RUNS, DIR_BYPROJ]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  }
}

function projHash(cwd) {
  const n = normPath(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  return sha1(n.value || 'unknown').slice(0, 16);
}

function nowS() { return Math.floor(Date.now() / 1000); }

/**
 * session_key — measured, not guessed.
 *
 * session_id is PRESENT on Pre/PostToolUse (confirmed in a payload dump), so keying on
 * it is safe. Subagent tool calls carry the PARENT session_id plus their own agent_id
 * (measured: one Task dispatch produced SubagentStart/PostToolUse/SubagentStop rows all
 * bearing the parent's session_id and a distinct agent_id). Appending agent_id keeps
 * concurrent subagents writing to separate files; Stop folds the whole family.
 */
function sessionKey(payload) {
  let base = payload && payload.session_id;
  if (!base && payload && payload.transcript_path) base = sha1(payload.transcript_path).slice(0, 16);
  if (!base) base = 'proj-' + projHash(payload && payload.cwd);
  base = String(base).replace(/[^a-zA-Z0-9._-]/g, '');
  const agent = payload && payload.agent_id;
  if (agent) return base + '.' + String(agent).replace(/[^a-zA-Z0-9._-]/g, '');
  return base;
}

function sessionFile(key) { return path.join(DIR_SESSIONS, key + '.jsonl'); }

// ---------------------------------------------------------------------------
// The ledger — append-only, one line per invocation, never read-modify-write
// ---------------------------------------------------------------------------

/**
 * One appendFileSync of one line. Append of a sub-4KB line is atomic enough on both
 * NTFS and ext4 that concurrent subagents do not interleave partial lines, which is why
 * the format is one-line-JSON and why nothing derived is ever written back.
 */
/**
 * Trim an id list to `keep` entries, TAKING FROM BOTH ENDS.
 *
 * MEASURED BUG, and the cause of two gates being stood down on a live machine. Every
 * truncation here used to be `slice(0, N)` — the first N ids. But a read-back is ALWAYS
 * about a record that was just written, and a freshly created row is the LAST entry a
 * list response returns. So the head-slice discarded precisely the id the obligation was
 * waiting for, and the more crowded the workspace got, the more reliably it did it.
 *
 * Observed: `list_flow_clusters` returned 104 clusters with the new one last. Its id was
 * cut from the ledger row, the obligation never discharged, and the gate then demanded a
 * filtered re-read of a tool that accepts no arguments — an unclearable latch produced
 * entirely by this line. The same shape hit `list_flow_connections` at 101 rows.
 *
 * Both ends, because both matter: the head is what a "does this list still contain X"
 * check reads, the tail is what a "did my write land" check reads.
 */
function trimIds(arr, keep) {
  if (!Array.isArray(arr) || arr.length <= keep) return arr || [];
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return [...new Set([...arr.slice(0, head), ...arr.slice(arr.length - tail)])];
}

function append(key, obj) {
  try {
    ensureDirs();
    let line = JSON.stringify(obj);
    if (line.length > 4000) {
      // Truncating is better than dropping: the kinds and ids matter more than the tail.
      if (Array.isArray(obj.ids)) obj.ids = trimIds(obj.ids, 40);
      if (obj.inner && obj.inner.length > 20) obj.inner = obj.inner.slice(0, 20);
      obj.trunc = 1;
      line = JSON.stringify(obj);
      // SHRINK STRUCTURALLY, NEVER BY SLICING THE SERIALISED LINE. The old code did
      // `JSON.stringify(obj).slice(0, 3990)` and patched the tail with `"}`, which does
      // not produce valid JSON except by luck — and readLines() drops an unparseable line
      // in silence, so an over-long row vanished entirely instead of arriving trimmed.
      // Whole rows disappearing from the ledger is precisely the class of bug that makes
      // a gate refuse honest work, so this now discards fields in order of expendability
      // and re-serialises, and the line it writes always parses.
      if (line.length > 4000 && obj.inner) {
        obj.inner = obj.inner.map((r) => ({ i: r.i, tool: r.tool, ok: r.ok, ids: trimIds(r.ids, 8) }));
        line = JSON.stringify(obj);
      }
      if (line.length > 4000 && obj.args) { delete obj.args; line = JSON.stringify(obj); }
      if (line.length > 4000 && Array.isArray(obj.ids)) { obj.ids = trimIds(obj.ids, 16); line = JSON.stringify(obj); }
      // `inner` is dropped LAST and only when nothing else will fit, because each inner row
      // is a call whose ids can discharge an obligation. When it does go, the coarse
      // top-level `ids` still carries the harvest — which is why that field exists.
      if (line.length > 4000 && obj.inner) { delete obj.inner; line = JSON.stringify(obj); }
      // `idh` is shed only after args, ids and inner, and trimmed rather than dropped: it is
      // the ONLY field that can discharge a read-back obligation for a long listing, because
      // the full ids never fit and their position is no guide to which one matters.
      if (line.length > 4000 && Array.isArray(obj.idh)) { obj.idh = obj.idh.slice(0, 150); line = JSON.stringify(obj); }
      if (line.length > 4000) {
        // Last resort: a minimal row that still carries what the fold reads.
        line = JSON.stringify({
          v: obj.v, t: obj.t, k: obj.k, s: obj.s, a: obj.a, tool: obj.tool, ok: obj.ok,
          ids: trimIds(obj.ids, 16), idh: (obj.idh || []).slice(0, 150), trunc: 1,
        });
      }
    }
    fs.appendFileSync(sessionFile(key), line + '\n', 'utf8');
  } catch (_) { /* the ledger is an optimisation; losing a line must never break a turn */ }
}

const MAX_FOLD_LINES = 5000;

function readLines(key) {
  let raw;
  try { raw = fs.readFileSync(sessionFile(key), 'utf8'); } catch (_) { return []; }
  const lines = raw.split('\n');
  const start = Math.max(0, lines.length - MAX_FOLD_LINES);
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.charCodeAt(0) !== 123 /* { */) continue;
    try { out.push(JSON.parse(l)); } catch (_) { /* a torn line is skipped, never fatal */ }
  }
  return out;
}

/** Every ledger line for this session AND its subagents (key `<sess>.<agent>`). */
function readFamily(key) {
  const base = String(key).split('.')[0];
  let names = [];
  try { names = fs.readdirSync(DIR_SESSIONS); } catch (_) { return readLines(key); }
  const mine = names.filter((n) => n === base + '.jsonl' || n.startsWith(base + '.'));
  const rows = [];
  for (const n of mine) rows.push(...readLines(n.replace(/\.jsonl$/, '')));
  rows.sort((a, b) => (a.t || 0) - (b.t || 0));
  return rows;
}

// ---------------------------------------------------------------------------
// Id harvesting
//
// TWO DIFFERENT JOBS, AND CONFLATING THEM IS A MEASURED BUG.
//
//  * SEEN ids (what this session has legitimately observed) are harvested WIDE, from
//    tool_response text and user prompts. A false positive there only weakens P1.
//
//  * CANDIDATE ids (what a call is about to write with) are lifted from `tool_input`
//    ONLY — never from the raw hook payload. The payload envelope carries session_id,
//    tool_use_id and transcript_path, all of which are uuid-shaped or contain a uuid.
//    A probe that regexed the raw stdin string denied an `echo` because it found the
//    SESSION'S OWN id in the envelope, and the model correctly reported the gate as
//    broken. Scan the arguments, not the envelope.
// ---------------------------------------------------------------------------

const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const RE_UUID_G = new RegExp(UUID_SRC, 'g');
// Copied from backend/routers/mcp_server.py:278-283 so the two ends cannot drift.
const RE_ID_BRACKET = new RegExp('\\[id:\\s*(' + UUID_SRC + ')\\]', 'ig');
const RE_ID_LOOSE = new RegExp('(?<![a-zA-Z])id[:\\s]+\\(?(' + UUID_SRC + ')\\)?', 'ig');

// ---------------------------------------------------------------------------
// ID SHAPES — because a uuid is not the only kind of id this product has.
//
// CANON-ID only ever treated uuid-shaped values as candidates, which meant the two other
// shapes the portal really issues walked straight through it:
//
//   * `col-<hex>` — note-column ids are a TEXT slug, not a uuid
//     (backend/ai/tools/write_tools.py:1665 `"col-" + uuid.uuid4().hex`), and the whole
//     note-board surface addresses columns by it.
//   * plain integers, wherever a table uses a serial key.
//
// A fabricated one of either was never even looked at. Both are added here.
//
// THE ASYMMETRY IS DELIBERATE AND IS THE SAFE DIRECTION. Bare integers are harvested WIDE
// from responses (a response is full of counts, costs and years, and every one of them
// lands in the seen set) but a bare integer is only ever a CANDIDATE when it sits under a
// key that names an id. A false positive in the seen set can only weaken the gate; a false
// positive in the candidate set REFUSES HONEST WORK, and that is the failure this file
// spends most of its comments warning about. Values that are not id-shaped at all — a
// channel slug like "general", a name — are never candidates, because there is no marker
// by which they could ever have become "seen" and refusing them would be a pure trap.
// ---------------------------------------------------------------------------

const RE_PREFIX_HEX_G = /\b[a-z][a-z0-9]{1,15}-[0-9a-f]{6,}\b/gi;
// `\b` is the WRONG boundary for an integer id: a hyphen is a word boundary, so `\b\d{4,20}\b`
// happily lifts `3333` out of the middle of `cccccccc-3333-4333-8333-cccccccccccc`. That put a
// phantom child id into the list_subtasks fold and CANON-BOTTOM-UP refused a parent whose every
// real child was complete — an unclearable refusal, since there is no task `3333` to complete.
// Caught by the existing suite the moment the integer shape was added, which is what it is for.
const RE_INT_G = /(?<![\w-])\d{4,20}(?![\w-])/g;
const RE_IS_UUID = new RegExp('^' + UUID_SRC + '$');
const RE_IS_PREFIX_HEX = /^[a-z][a-z0-9]{1,15}-[0-9a-f]{6,}$/i;
const RE_IS_INT_ID = /^\d{4,20}$/;
/** `{{0.id}}` — the documented bulk chaining reference, NOT a fabricated id. */
const RE_BULK_REF = /^\{\{\s*\d+\s*\.\s*id\s*\}\}$/;
/** id, ids, task_id, parent_task_id, column_ids … */
const RE_ID_KEY = /(^|_)ids?$/i;

const RESP_SCAN_CAP = 65536;
/** Bare integers are noisy; cap them so they can never crowd real ids out of a ledger line. */
const INT_SEEN_CAP = 30;
/**
 * Per-tier id budgets, sized so a harvested row still fits the 4 KB ledger line WITHOUT
 * append() having to trim it. That matters: append cannot tell a portal-marked id from a
 * uuid that merely appeared in some prose, so any trimming it does is blind. Bounding here
 * keeps the decision where the information is.
 *
 * 40 marked ids at ~39 bytes is ~1.6 KB, 20 wide is ~0.8 KB -- comfortably inside the line
 * with the other fields, so the blind trim downstream almost never fires.
 */
const MARKED_SEEN_CAP = 40;
const WIDE_SEEN_CAP = 20;
/** Compact id fingerprints per row — 8 hex chars each, so a 300-row listing costs ~2.7 KB. */
const ID_HEAD_CAP = 300;

/**
 * Wide harvest, for the SEEN set. Deliberately generous.
 *
 * ORDER IS LOad-BEARING: canon-lib append() truncates an over-long `ids` array to the
 * first 20 entries, so uuids and slug ids are emitted before integers and can never be
 * evicted by a response that happened to contain a lot of numbers.
 */
function harvestSeen(text) {
  if (!text) return [];
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  const body = s.length > RESP_SCAN_CAP ? s.slice(0, RESP_SCAN_CAP) : s;
  // TWO TIERS, AND THE SPLIT IS LOAD-BEARING.
  //
  // `marked` are ids the portal explicitly labelled -- `[id: ...]` or `id: ...`. Every
  // create response and every row of every listing announces its id that way, so this is
  // the authoritative tier. `wide` is the generous sweep for any other uuid in the text.
  //
  // They used to share one Set, and that is what broke read-back on a busy workspace. The
  // ledger line is capped, so a long response had its id list trimmed -- and because the
  // marked ids were collected first and the wide sweep appended after them, the NEWEST
  // marked id (a freshly created row is the LAST line of a listing) sat in the MIDDLE of
  // the array. Trimming from either end, or from both, discarded precisely the id the
  // read-back was waiting for. Measured on a live machine at 104 clusters and 101
  // connections: the obligation could not be discharged by any call, because the gate then
  // demanded a filtered re-read of tools that accept no arguments.
  //
  // Bounding each tier HERE, where the two can still be told apart, is the fix. Keeping
  // both ends of the marked tier keeps both the head of a listing and the row just written.
  const marked = new Set();
  const wide = new Set();
  const ints = [];
  let m;
  RE_ID_BRACKET.lastIndex = 0;
  while ((m = RE_ID_BRACKET.exec(body))) marked.add(m[1].toLowerCase());
  RE_ID_LOOSE.lastIndex = 0;
  while ((m = RE_ID_LOOSE.exec(body))) marked.add(m[1].toLowerCase());
  RE_UUID_G.lastIndex = 0;
  while ((m = RE_UUID_G.exec(body))) { const v = m[0].toLowerCase(); if (!marked.has(v)) wide.add(v); }
  // A UUID CONTAINS THINGS THAT LOOK LIKE A SLUG ID, and treating one as real is not a
  // harmless false positive. The tail of `72ce4477-f495-4306-ab5a-d768e61ac91c` matches the
  // `col-<hex>` slug shape as `ab5a-d768e61ac91c`. Harvested from a list_subtasks response
  // it was recorded as a CHILD of that very task, and CANON-BOTTOM-UP then refused a
  // legitimate complete_task because a "subtask" it had never issued was not completed —
  // a refusal nothing could clear, since there is no such subtask to complete. Measured.
  //
  // This file already warns that a false child is unclearable where a false seen-id is
  // merely weakening; the guard for it was just never written. Any candidate that appears
  // INSIDE a uuid we already harvested is a fragment, not an id.
  const uuidBlob = [...marked, ...wide].join(' ');
  RE_PREFIX_HEX_G.lastIndex = 0;
  while ((m = RE_PREFIX_HEX_G.exec(body))) {
    const v = m[0].toLowerCase();
    if (marked.has(v) || uuidBlob.includes(v)) continue;
    wide.add(v);
  }
  RE_INT_G.lastIndex = 0;
  while ((m = RE_INT_G.exec(body)) && ints.length < INT_SEEN_CAP) ints.push(m[0]);

  const keep = trimIds([...marked], MARKED_SEEN_CAP);
  const rest = trimIds([...wide], WIDE_SEEN_CAP);
  const seen = new Set([...keep, ...rest]);
  return [...seen, ...ints.filter((i) => !seen.has(i))];
}

/**
 * Every portal-MARKED id in a response, compressed to its first 8 hex characters.
 *
 * THIS EXISTS BECAUSE POSITION CANNOT BE TRUSTED. The ledger line is capped, a listing can
 * carry hundreds of ids, and a full uuid costs ~39 bytes — so some always had to be
 * dropped. Every rule for choosing WHICH to drop assumed something about ordering: keep the
 * head (assumes the record is early), keep both ends (assumes a new record is last). Both
 * were wrong. Measured: `list_flow_connections` returned 101 rows with the just-created one
 * at position 78 — the middle — so head, tail and both-ends trimming all discarded it, and
 * the read-back obligation could not be discharged by any call the tool could accept.
 *
 * Eight hex characters is 4 bytes of entropy, ~9 bytes on the wire. A whole listing fits.
 * Collision risk is a birthday problem over 4.3 billion values across a few hundred ids per
 * response: negligible, and the failure mode of a collision is a read-back that clears
 * slightly too easily — strictly better than one that can never clear at all.
 *
 * This is a DISCHARGE aid only. It never feeds the seen set, because CANON-ID must keep
 * comparing whole ids: a prefix match there would weaken a gate whose entire job is to
 * refuse an id nobody issued.
 */
function harvestIdHeads(text, cap) {
  if (!text) return [];
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  const body = s.length > RESP_SCAN_CAP ? s.slice(0, RESP_SCAN_CAP) : s;
  const heads = new Set();
  const limit = cap || ID_HEAD_CAP;
  let m;
  RE_ID_BRACKET.lastIndex = 0;
  while ((m = RE_ID_BRACKET.exec(body)) && heads.size < limit) heads.add(m[1].toLowerCase().slice(0, 8));
  RE_ID_LOOSE.lastIndex = 0;
  while ((m = RE_ID_LOOSE.exec(body)) && heads.size < limit) heads.add(m[1].toLowerCase().slice(0, 8));
  return [...heads];
}

/** Does a stored row's compact head list vouch for this id? */
function headsVouchFor(heads, id) {
  if (!Array.isArray(heads) || !heads.length || !id) return false;
  return heads.includes(String(id).toLowerCase().slice(0, 8));
}

/** Is this value shaped like an id this product issues? */
function idShape(v) {
  if (typeof v === 'number') return Number.isInteger(v) && String(v).length >= 4 ? 'integer' : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 128) return null;
  if (RE_IS_UUID.test(s)) return 'uuid';
  if (RE_IS_PREFIX_HEX.test(s)) return 'slug';
  if (RE_IS_INT_ID.test(s)) return 'integer';
  return null;
}

/**
 * Narrow harvest, for CANDIDATE ids. tool_input only.
 *
 * Two passes, and they answer different questions:
 *   * every uuid anywhere in the arguments (unchanged — a uuid is unmistakable, and this
 *     catches one quoted inside a longer argument);
 *   * every id-SHAPED value sitting under an id-NAMED key, which is the only safe way to
 *     see a `col-<hex>` or an integer without treating every `limit: 50` as an id.
 *
 * Returns [{ id, key }] so a refusal can name the argument it is talking about.
 */
function harvestArgIds(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const found = new Map();
  const add = (id, key) => { if (!found.has(id)) found.set(id, key); };

  let s;
  try { s = JSON.stringify(toolInput); } catch (_) { return []; }
  if (s.length > RESP_SCAN_CAP) s = s.slice(0, RESP_SCAN_CAP);
  let m;
  RE_UUID_G.lastIndex = 0;
  while ((m = RE_UUID_G.exec(s))) add(m[0].toLowerCase(), null);

  const walk = (node, key, depth) => {
    if (node === null || node === undefined || depth > 6) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, key, depth + 1); return; }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], k, depth + 1);
      return;
    }
    if (!key || !RE_ID_KEY.test(key)) return;
    if (typeof node === 'string' && RE_BULK_REF.test(node.trim())) return;
    if (!idShape(node)) return;
    add(String(node).trim().toLowerCase(), key);
  };
  walk(toolInput, null, 0);

  return [...found].map(([id, key]) => ({ id, key }));
}

// ---------------------------------------------------------------------------
// EFFECT CLASSIFICATION — what does this call DO, not what is it CALLED?
//
// A GATE THAT WATCHES A TOOL INSTEAD OF AN EFFECT IS A GATE WITH A DOOR NEXT TO IT. Every
// hole closed here was the same hole: the gate named `Write`, `Edit` and `Bash`, and the
// effect walked in through `PowerShell`, through `sed -i`, through `cat > file`, through
// `mcp__Desktop_Commander__write_file`. Measured, all of them, on a live session — the
// model created a source file with the stock Windows `PowerShell` tool and the debug log
// contained ZERO `Hook PreToolUse` entries, because the matcher had never heard of it.
//
// So nothing below asks "is this tool called Bash". It asks two questions of the ARGUMENTS:
//
//   1. Is there a command line in here?  (any key that carries a shell command, any tool)
//   2. Is a file about to be written, and WHICH one?
//
// Both are answered from shape, so the next MCP server the owner installs is covered on
// the day it is installed rather than on the day someone notices. The cost of the general
// answer is that it can only be as good as its patterns, so every refusal below names the
// concrete evidence it found — the program it saw, or the path it is about to write — and
// when it can name nothing concrete it says nothing at all.
// ---------------------------------------------------------------------------

/** Keys that carry a shell command line, across every tool that takes one. */
const SHELL_KEYS = new Set(['command', 'cmd', 'commands', 'commandline', 'command_line',
  'script', 'shell', 'powershell', 'pwsh', 'bash', 'sh']);

/** Keys that name a file this call may write. */
const PATH_KEYS = new Set(['file_path', 'filepath', 'path', 'notebook_path', 'notebookpath',
  'target_file', 'targetfile', 'file', 'filename', 'file_name', 'destination', 'dest',
  'output', 'output_path', 'out_file', 'absolute_path', 'full_path', 'fullpath']);

/** Keys that carry the bytes going into that file. */
const CONTENT_KEYS = new Set(['content', 'contents', 'text', 'new_string', 'new_str',
  'new_text', 'newtext', 'new_source', 'newsource', 'edits', 'patch', 'diff', 'replacement', 'body']);

/** A verb, in any tool's name, that means "this changes a file". */
const WRITE_VERB_RE = /(write|edit|create|append|patch|replace|save|move|rename|copy|delete|remove|mkdir|touch|put|upload)/i;

/** Programs that mutate by name alone. */
const MUT_ALWAYS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'deno', 'pip', 'pip3', 'pipx', 'poetry', 'uv', 'conda',
  'make', 'gmake', 'nmake', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'msbuild', 'dotnet',
  'cargo', 'go', 'rustc', 'rustup', 'tsc', 'webpack', 'vite', 'gem', 'bundle', 'composer',
  'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'brew', 'choco', 'winget', 'scoop',
  'docker', 'docker-compose', 'podman', 'terraform', 'kubectl', 'helm', 'ansible', 'vagrant',
  'rm', 'del', 'erase', 'rmdir', 'mv', 'move', 'cp', 'copy', 'mkdir', 'md', 'touch', 'tee',
  'dd', 'ln', 'install', 'patch', 'truncate', 'shred', 'chmod', 'chown', 'icacls', 'attrib',
  'rsync', 'scp', 'unzip', 'rename', 'mklink',
  'set-content', 'add-content', 'out-file', 'new-item', 'remove-item', 'move-item',
  'copy-item', 'rename-item', 'clear-content', 'set-itemproperty', 'new-itemproperty',
  'remove-itemproperty', 'start-process', 'invoke-expression', 'invoke-webrequest',
  'invoke-restmethod', 'export-csv', 'export-clixml', 'set-acl', 'new-service',
]);

/** Programs that mutate only in some forms. The pattern is tested against the segment. */
const MUT_CONDITIONAL = {
  git: /(^|\s)(commit|push|merge|rebase|reset|revert|restore|checkout|switch|clean|apply|am|cherry-pick|stash|tag|init|add|rm|mv|worktree|submodule|config|fetch\s+--prune|remote\s+(add|remove|set-url))(\s|$)/,
  gh: /(^|\s)(pr|issue|release|repo|api|secret|workflow|gist)\s+(create|edit|merge|close|delete|comment|upload|set|run)(\s|$)/,
  hg: /(^|\s)(commit|push|add|remove)(\s|$)/,
  svn: /(^|\s)(commit|add|delete|move)(\s|$)/,
  sed: /(^|\s)-[a-z]*i([a-z0-9.]*)?(\s|$)/,
  perl: /(^|\s)-[a-z]*i([a-z0-9.]*)?(\s|$)|open\s*\(|>>?\s*\S/,
  tar: /(^|\s)-?-?(c|x|extract|create)/,
  zip: /\S/,
  '7z': /(^|\s)(a|x|e|u|d)(\s|$)/,
  curl: /(^|\s)(-o|-O|--output|--upload-file|-T|-d\s|--data|-X\s*(POST|PUT|PATCH|DELETE))/i,
  wget: /\S/,
  python: null, python3: null, py: null, node: null, ruby: null, php: null,
};

/**
 * Code-level file writes, for the language one-liners. `python -c "open(f,'w')"` is a
 * measured evasion of every file gate this plugin had.
 */
const CODE_WRITE_RE = /open\s*\([^)]*['"][wax][b+]?['"]|write_?(?:file|text|bytes|all_?text|all_?bytes)|createwritestream|appendfile|fs\.write|\.write\s*\(|>\s*file|file\.(?:write|create|append|delete|move|copy)|shutil\.(?:copy|move|rmtree)|os\.(?:remove|rename|unlink|mkdir|makedirs)|pathlib/i;

/** A redirection to a file. `2>&1` and `>&2` are not that. */
const REDIRECT_RE = /(?<![0-9&>=\-])>>?\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s;|&<>()]+))/g;

/**
 * The same operator, found only where a SHELL would find it — outside quotes.
 *
 * MEASURED FALSE POSITIVE. `node -e '... Date.now() - mtime > 3600000 ...'` was refused as
 * "writes 3600000 (via a redirection)". The `>` is a comparison inside a single-quoted
 * argument; no shell would ever redirect there. Scanning the raw segment text cannot tell
 * the difference, and the cost is not cosmetic: the same regex decides `shellMutation`, so
 * ANY quoted `>` also made a read-only command look state-changing.
 *
 * Quoted spans are masked to a placeholder before the operator is located, which preserves
 * offsets and the existing lookbehind exactly — then the TARGET is read back out of the
 * ORIGINAL string, because a legitimate target is very often quoted (`> "my file.txt"`).
 * Masking and then reading the mask would have swapped one wrong answer for another.
 */
function maskQuoted(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      // A backslash escape inside double quotes hides the next character, including a quote.
      if (c === '\\' && q === '"' && i + 1 < s.length) { out += '\x01\x01'; i++; continue; }
      if (c === q) { q = null; out += c; continue; }
      out += '\x01';
      continue;
    }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    out += c;
  }
  return out;
}

const REDIRECT_OP_RE = /(?<![0-9&>=\-])>>?/g;
const REDIRECT_TARGET_RE = /^>>?\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s;|&<>()]+))/;

/** Redirection targets on this command line, ignoring any `>` that is inside quotes. */
function redirectTargets(text) {
  const s = String(text || '');
  if (s.indexOf('>') === -1) return [];
  const masked = maskQuoted(s);
  const out = [];
  let m;
  REDIRECT_OP_RE.lastIndex = 0;
  while ((m = REDIRECT_OP_RE.exec(masked))) {
    const t = s.slice(m.index).match(REDIRECT_TARGET_RE);
    if (t) out.push(t[1] || t[2] || t[3]);
  }
  return out;
}

/** Shells and prefixes whose ARGUMENT is another command — `bash -c "npm install"`. */
const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'powershell',
  'pwsh', 'env', 'nohup', 'sudo', 'doas', 'time', 'nice', 'xargs', 'winpty', 'busybox', 'start', 'exec']);

/** Every shell command line this call carries, whatever tool it is. */
function shellStrings(toolInput) {
  const out = [];
  if (!toolInput || typeof toolInput !== 'object') return out;
  for (const k of Object.keys(toolInput)) {
    if (!SHELL_KEYS.has(String(k).toLowerCase())) continue;
    const v = toolInput[k];
    if (typeof v === 'string' && v.trim()) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) out.push(x);
  }
  return out;
}

function baseName(word) {
  const w = String(word || '').replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '');
  const parts = w.split(/[\\/]/);
  return parts[parts.length - 1].toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
}

function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  }
  return out;
}

/**
 * Split a command line into segments, each with its program and its arguments, recursing
 * into the payload of a wrapping shell.
 *
 * HEREDOC BODIES ARE DROPPED. `cat > f <<EOF ... EOF` splits on newlines like everything
 * else, and without this the BODY's words become "programs" — a heredoc containing the
 * text `rm -rf` would otherwise be reported as a command that runs rm, which is exactly
 * the kind of refusal-that-is-not-true-about-the-call this whole design forbids.
 */
function shellSegments(cmd, depth) {
  const segs = [];
  if (!cmd || (depth || 0) > 3) return segs;
  const lines = String(cmd).split(/[\r\n]+/);
  let skipUntil = null;
  const flat = [];
  for (const line of lines) {
    if (skipUntil !== null) { if (line.trim() === skipUntil) skipUntil = null; continue; }
    const h = line.match(/<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/);
    flat.push(h ? line.slice(0, h.index) : line);
    if (h) skipUntil = h[1];
  }
  for (const piece of flat.join('\n').split(/(?:\|\||&&|[;|&\n])+/)) {
    let rest = piece.trim();
    if (!rest) continue;
    for (let i = 0; i < 12; i++) {
      const m = rest.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+|\(\s*|\{\s*)/);
      if (!m) break;
      rest = rest.slice(m[0].length);
    }
    const words = splitArgs(rest);
    if (!words.length) continue;
    const head = baseName(words[0]);
    segs.push({ text: rest, head, args: words.slice(1) });
    if (SHELL_WRAPPERS.has(head)) {
      const after = rest.slice(rest.indexOf(words[0]) + words[0].length);
      const q = after.match(/(?:-c|\/c|\/k|-Command|-EncodedCommand)?\s*(?:"([\s\S]*)"|'([\s\S]*)')\s*$/i);
      const inner = q ? (q[1] || q[2]) : after.replace(/^\s*(?:-c|\/c|\/k|-Command)\s+/i, '');
      if (inner && inner.trim() && inner.trim() !== rest) {
        for (const s of shellSegments(inner, (depth || 0) + 1)) segs.push(s);
      }
    }
  }
  return segs;
}

/**
 * Does this command line change state? Returns the concrete evidence, or null.
 *
 * The old detector was `(^|[\s;&|])(git\s+(commit|push)|npm|…)`, and a single pair of
 * quotes defeated it: `bash -c "npm install"` has no whitespace before `npm` that the
 * anchor could see. Measured ALLOW, along with `CI=1 make build` (make was simply absent)
 * and `mcp__Desktop_Commander__start_process` (a different tool name entirely). Looking at
 * the PROGRAM IN COMMAND POSITION of each segment — after unwrapping the shell and after
 * stripping env assignments — answers the real question and cannot be quoted around.
 */
function shellMutation(cmd) {
  const s = String(cmd || '');
  const segs = shellSegments(s, 0);
  for (const seg of segs) {
    if (MUT_ALWAYS.has(seg.head)) return { kind: 'program', evidence: seg.head };
    if (Object.prototype.hasOwnProperty.call(MUT_CONDITIONAL, seg.head)) {
      const rx = MUT_CONDITIONAL[seg.head];
      if (rx === null) {
        if (CODE_WRITE_RE.test(seg.text)) return { kind: 'program', evidence: seg.head };
      } else if (rx.test(seg.text.slice(seg.text.indexOf(' ') + 1)) || rx.test(seg.text)) {
        return { kind: 'program', evidence: seg.head };
      }
    }
  }
  for (const seg of segs) {
    if (redirectTargets(seg.text).length) return { kind: 'redirect', evidence: null };
  }
  return null;
}

const PS_WRITE_CMDLETS = /^(set-content|add-content|out-file|new-item|set-itemproperty|export-csv|export-clixml|clear-content)$/;
const FLAGGY = (a) => /^[-/]/.test(String(a || ''));

/** Files this shell command line will write, by name. Only what can be named concretely. */
function shellWriteTargets(cmd) {
  const out = [];
  const push = (p, via) => {
    if (!p) return;
    const v = String(p).replace(/^["']|["']$/g, '').trim();
    if (!v || v === '&1' || v === '&2' || /^[-&|>]/.test(v)) return;
    if (/^\/dev\/(null|stdout|stderr)$/i.test(v) || /^(nul|con)$/i.test(v)) return;
    out.push({ path: v, via });
  };
  for (const seg of shellSegments(cmd, 0)) {
    let m;
    for (const t of redirectTargets(seg.text)) push(t, 'a redirection');
    const nonFlag = seg.args.filter((a) => !FLAGGY(a));
    if (seg.head === 'tee') { if (nonFlag[0]) push(nonFlag[0], 'tee'); }
    if (seg.head === 'sed' && /(^|\s)-[a-z]*i/.test(seg.text)) {
      if (nonFlag.length > 1) push(nonFlag[nonFlag.length - 1], 'sed -i');
    }
    if (/^(cp|copy|mv|move|install|rsync|scp)$/.test(seg.head) && nonFlag.length > 1) {
      push(nonFlag[nonFlag.length - 1], seg.head);
    }
    if (/^(touch|mkdir|md|rm|del|rmdir|truncate|shred|unlink)$/.test(seg.head)) {
      for (const a of nonFlag) push(a, seg.head);
    }
    if (seg.head === 'dd') { for (const a of seg.args) if (/^of=/.test(a)) push(a.slice(3), 'dd'); }
    if (/^(curl|wget)$/.test(seg.head)) {
      for (let i = 0; i < seg.args.length; i++) {
        if (/^(-o|--output|-O)$/.test(seg.args[i]) && seg.args[i + 1]) push(seg.args[i + 1], seg.head);
      }
    }
    // PowerShell cmdlets can appear as the program OR downstream of a pipe.
    for (const w of [seg.head].concat(seg.args.map((a) => String(a).toLowerCase()))) {
      if (!PS_WRITE_CMDLETS.test(w)) continue;
      const idx = seg.args.findIndex((a) => /^-(path|filepath|literalpath)$/i.test(String(a)));
      if (idx > -1 && seg.args[idx + 1]) push(seg.args[idx + 1], w);
      else if (nonFlag.length) push(nonFlag[nonFlag.length - 1], w);
      break;
    }
    // Language one-liners: open('p','w'), writeFileSync('p', …), Path('p').write_text(…)
    const RE_CODE_PATH = /(?:open|writefilesync|writefile|appendfile|createwritestream|writealltext|writeallbytes|path)\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/gi;
    RE_CODE_PATH.lastIndex = 0;
    while ((m = RE_CODE_PATH.exec(seg.text))) {
      if (!CODE_WRITE_RE.test(seg.text)) break;
      push(m[1] || m[2] || m[3], 'a file write in the code it runs');
    }
  }
  return out;
}

/** Files this call will write, from its structured arguments. */
function argWriteTargets(name, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const keys = Object.keys(toolInput);
  const pathKeys = keys.filter((k) => PATH_KEYS.has(String(k).toLowerCase()));
  if (!pathKeys.length) return [];
  const hasContent = keys.some((k) => CONTENT_KEYS.has(String(k).toLowerCase()));
  if (!hasContent && !WRITE_VERB_RE.test(String(name || ''))) return [];
  const out = [];
  for (const k of pathKeys) {
    const v = toolInput[k];
    if (typeof v === 'string' && v.trim()) out.push({ path: v.trim(), via: k });
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) out.push({ path: x.trim(), via: k });
  }
  return out;
}

/** Everything this call will write: structured arguments plus any command line it carries. */
function writeTargets(name, toolInput, shells) {
  const out = argWriteTargets(name, toolInput);
  for (const s of (shells || shellStrings(toolInput))) {
    for (const t of shellWriteTargets(s)) out.push(t);
  }
  const seen = new Set();
  return out.filter((t) => { const k = t.path.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------
// PRIVACY — an ALLOW-list, never a deny-list (§4.7)
//
// The ledger is a plaintext file with ordinary user ACLs. The journal is somebody's
// private account of how their days actually went; this records THAT a journal entry
// happened and never a word of what it said. Adding a key here is a privacy decision.
// ---------------------------------------------------------------------------

const ARG_ALLOW = new Set([
  'project_id', 'client_id', 'proposal_id', 'phase_id', 'milestone_id', 'task_id',
  'parent_task_id', 'subtask_id', 'board_id', 'block_id', 'cluster_id', 'connection_id',
  'note_id', 'note_column_id', 'folder_id', 'journal_id', 'graph_id', 'node_id', 'edge_id',
  'channel_id', 'entity_id', 'entity_type', 'source_type', 'type', 'status', 'as_agent',
  'agent_name', 'logged_at', 'stop_on_error',
]);

function safeArgs(toolInput) {
  const out = {};
  if (!toolInput || typeof toolInput !== 'object') return out;
  for (const k of Object.keys(toolInput)) {
    if (!ARG_ALLOW.has(k)) continue;
    const v = toolInput[k];
    const t = typeof v;
    if (v === null || t === 'boolean' || t === 'number') { out[k] = v; continue; }
    if (t === 'string') {
      // logged_at is a date only; everything else here is an id or a short enum.
      out[k] = v.length > 64 ? v.slice(0, 64) : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Portal tool identity
// ---------------------------------------------------------------------------

/**
 * A call is PORTAL iff the raw MCP name ends in a bare name this server actually
 * registers. Matchers in hooks.json are deliberately BROAD (`mcp__.*`) because a full
 * match on the tool name is the only thing the runtime supports and the shipped narrow
 * matcher was INERT for `mcp__claude_ai_management-portal__*` and `mcp__<uuid>__*`
 * installs. Scoping therefore happens HERE, at runtime, against the frozen list.
 *
 * Unknown MCP tools are ignored entirely — never denied. That is what keeps this from
 * gating Supabase, Desktop_Commander, chrome-devtools and playwright. A measured probe
 * confirmed the cost of getting this wrong: a portal invariant applied to an unrelated
 * tool surface was reported by the model as a broken gate, not obeyed.
 */
function bareToolName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^mcp__.+?__(.+)$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// bulk expansion (§4.4) — mandatory, because canon (f) blinds Gate 1 without it
// ---------------------------------------------------------------------------

const RE_BULK_ITEM = /^\[(\d+)\]\s+(?:([A-Za-z0-9_]+):\s*)?([\s\S]*?)$/gm;

/**
 * The TEXT of a tool_response, with its line breaks intact.
 *
 * MEASURED BUG, and it silently emptied every bulk row in the ledger. `tool_response`
 * for an MCP call is NOT a string — it arrives as content blocks, and the old
 * `JSON.stringify(resp)` fallback turned every real newline into the two characters
 * `\` `n`. RE_BULK_ITEM is anchored with `^` under /m, which needs a REAL newline, so it
 * matched nothing and `parseBulkResponse` returned []. Seven bulk rows this session, all
 * `inner: []`, so not one id the portal issued inside a `bulk` ever reached the seen set
 * and CANON-ID refused ids it had just handed out — three times in one session.
 *
 * Stringify is kept only as the last resort for a shape with no text in it at all.
 */
function responseText(resp) {
  if (resp === null || resp === undefined) return '';
  if (typeof resp === 'string') return resp;
  const parts = [];
  const walk = (n, d) => {
    if (n === null || n === undefined || d > 6) return;
    if (typeof n === 'string') { parts.push(n); return; }
    if (typeof n === 'number' || typeof n === 'boolean') { parts.push(String(n)); return; }
    if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
    if (typeof n === 'object') {
      // An MCP content block carries the whole payload on `.text`; take it and stop, so
      // sibling metadata keys cannot interleave junk between the numbered items.
      if (typeof n.text === 'string') { parts.push(n.text); return; }
      for (const k of Object.keys(n)) walk(n[k], d + 1);
    }
  };
  walk(resp, 0);
  const joined = parts.join('\n');
  if (joined) return joined;
  try { return JSON.stringify(resp); } catch (_) { return ''; }
}

/**
 * Parse a bulk tool_response into per-item {i, tool, ok, ids}.
 *
 * Item shapes emitted by backend/routers/mcp_server.py:_handle_bulk —
 *   `[0] create_board: Created board [id: ...]`     ran
 *   `[1] create_task: FAILED — TypeError: ...`      ran the tool, it threw
 *   `[2] FAILED — missing tool name`                never reached a tool
 * so "failed" is `FAILED —` (em dash) at the start of the item text, with or without a
 * tool name in front of it.
 */
function parseBulkResponse(text, inputCalls) {
  const out = [];
  if (!text) return out;
  let s = responseText(text);
  // Second line of defence for the same failure: if something upstream still hands us an
  // escaped blob, un-escape it rather than silently parsing zero items. A bulk row that
  // reports no inner calls is indistinguishable from a bulk that did nothing, which is
  // why this failed silently for so long.
  if (s.indexOf('\n') === -1 && s.indexOf('\\n') !== -1) s = s.replace(/\\r\\n|\\n/g, '\n');
  const body = s.length > RESP_SCAN_CAP ? s.slice(0, RESP_SCAN_CAP) : s;
  let m;
  RE_BULK_ITEM.lastIndex = 0;
  while ((m = RE_BULK_ITEM.exec(body))) {
    const i = Number(m[1]);
    let tool = m[2] || null;
    const itemText = m[3] || '';
    if (!tool && Array.isArray(inputCalls) && inputCalls[i]) {
      const c = inputCalls[i];
      tool = (c && (c.tool || c.name)) || null;
    }
    const ok = !/^\s*(?:FAILED|SKIPPED)\s+[—-]/.test(itemText);
    out.push({ i, tool: tool || null, ok, ids: ok ? harvestSeen(itemText) : [] });
  }
  return out;
}

function bulkInnerNames(toolInput) {
  const calls = toolInput && toolInput.calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((c) => (c && (c.tool || c.name)) || null);
}

// ---------------------------------------------------------------------------
// Sentinels and env — re-read on EVERY invocation so they work MID-SESSION (§5)
// ---------------------------------------------------------------------------

function sentinel(name) {
  try { return fs.existsSync(path.join(HOME, name)); } catch (_) { return false; }
}

function canonMode() {
  const v = String(process.env.PORTAL_CANON || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return 'off';
  if (v === 'advisory' || v === 'advise') return 'advisory';
  return 'on';
}

/**
 * Is this gate allowed to REFUSE or BLOCK right now?
 *
 * Every escape is checked here, on every single invocation, because the env escape is
 * fixed for the session's lifetime and the owner needs one that works mid-session.
 */
function gateArmed(gateId, run) {
  const mode = canonMode();
  if (mode !== 'on') return { armed: false, why: 'PORTAL_CANON=' + mode };
  if (sentinel('STAND-DOWN')) return { armed: false, why: 'stand-down sentinel (all gates)' };
  if (run && run.run_id && sentinel('STAND-DOWN-' + run.run_id)) {
    return { armed: false, why: 'stand-down sentinel for run ' + run.run_id };
  }
  if (sentinel('STAND-DOWN-' + gateId)) return { armed: false, why: 'stand-down sentinel for ' + gateId };
  if (run && run.degraded && run.degraded[gateId]) {
    return { armed: false, why: 'degraded: ' + run.degraded[gateId] };
  }
  return { armed: true, why: null };
}

// ---------------------------------------------------------------------------
// Run manifests
// ---------------------------------------------------------------------------

const RUN_STALE_S = 24 * 60 * 60;

function runFile(runId) { return path.join(DIR_RUNS, runId + '.json'); }
function pointerFile(ph) { return path.join(DIR_BYPROJ, ph + '.json'); }

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function writeJSON(file, obj) {
  try {
    ensureDirs();
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (_) { return false; }
}

function newRunId() { return 'r-' + crypto.randomBytes(4).toString('hex'); }

/**
 * The active run for this project, or null.
 *
 * A run lives on disk keyed by PROJECT, not by session — that is the whole reason canon
 * (b) survives a session death or a compaction. The cost is the failure mode named in
 * the docs: a session that dies mid-run leaves state RUN behind. The 24h no-progress TTL
 * is the primary defence, and it is applied here so every entry point gets it.
 */
function resolveRun(cwd) {
  const ph = projHash(cwd);
  const ptr = readJSON(pointerFile(ph));
  if (!ptr || !ptr.run_id) return null;
  const run = readJSON(runFile(ptr.run_id));
  if (!run) return null;
  if (run.state === 'CLOSED') return run;
  const last = Number(run.last_progress_at || run.created_at || 0);
  if (last && (nowS() - last) > RUN_STALE_S) {
    run.state = 'CLOSED';
    run.closed_at = nowS();
    run.close_reason = 'no progress for 24h';
    writeJSON(runFile(run.run_id), run);
  }
  return run;
}

function saveRun(run) { return writeJSON(runFile(run.run_id), run); }

function openRun(opts) {
  ensureDirs();
  const ph = projHash(opts.cwd);
  const run = {
    run_id: newRunId(),
    created_at: nowS(),
    last_progress_at: nowS(),
    state: opts.state || 'ALIGN',
    mode: opts.mode || 'solo',
    client: opts.client || null,
    project: opts.project || null,
    project_id: opts.project_id || null,
    channel: opts.channel || null,
    identity: opts.identity || null,
    journal_folder: null,
    projhash: ph,
    cwd: normPath(opts.cwd).value,
    blocks: {},
    degraded: {},
  };
  saveRun(run);
  writeJSON(pointerFile(ph), { run_id: run.run_id });
  return run;
}

function closeRun(run, reason) {
  run.state = 'CLOSED';
  run.closed_at = nowS();
  run.close_reason = reason || 'closed';
  saveRun(run);
  return run;
}

/** Per-run per-gate block budget (§5 E4). Returns true when the gate may still block. */
function spendBlock(run, gateId, budget) {
  if (!run) return true;
  run.blocks = run.blocks || {};
  const n = (run.blocks[gateId] || 0) + 1;
  run.blocks[gateId] = n;
  if (n >= budget) {
    run.degraded = run.degraded || {};
    run.degraded[gateId] = 'block budget of ' + budget + ' exhausted in this run';
  }
  saveRun(run);
  return n <= budget;
}

/**
 * A phase boundary was reached — give every gate its block budget back.
 *
 * REPORTED BY THE OWNER, and the complaint was exactly right: "I keep telling you
 * to continue." CANON-ACCOUNT is the gate whose whole job is refusing a silent
 * stop mid-run. It gets three blocks and then degrades to a notice FOREVER,
 * because the budget was per-run and monotonic. On a run that lasts a working day
 * the safety net is gone by mid-morning and never comes back, so the owner became
 * the mechanism.
 *
 * The budget exists to stop a gate trapping a session that genuinely cannot
 * proceed — a real hazard, and the cap should stay for that. But "cannot proceed"
 * and "has been going for hours" are different states, and only the first
 * deserves a silenced gate. Delivering a milestone is proof of the second.
 *
 * So the counter resets on evidence of progress rather than never. A stuck run
 * still exhausts its three and stays un-trapped; a moving run keeps its net.
 */
function creditProgress(run) {
  if (!run) return run;
  if (!run.blocks && !run.degraded) return run;
  run.blocks = {};
  run.degraded = {};
  run.last_progress_at = nowS();
  saveRun(run);
  return run;
}

function blocksSpent(run) {
  if (!run || !run.blocks) return 0;
  return Object.values(run.blocks).reduce((a, b) => a + (b || 0), 0);
}

// ---------------------------------------------------------------------------
// CARRIED DEBT — the after-action obligation, parked where the next action will find it
//
// WHY THIS IS A FILE AND NOT A STOP HOOK. Stop gates are one-shot per turn, and that is
// deliberate: `stop_hook_active` short-circuits before the gate can decide, so Stop can
// never wedge a session. Measured consequence — stop#1 BLOCK, stop#2 SPEAK, and then the
// turn ENDS with the write still unverified and the close-out still missing. The Stop half
// delays a violating turn by one exchange; it does not prevent it, and it cannot be made to
// without destroying the property that makes Stop safe.
//
// So the obligation is written down when a turn ends on it, and the NEXT turn's first
// action is refused instead. The turn ending is not the violation; continuing to work as
// though the debt were paid is.
//
// KEYED BY PROJECT, NOT BY SESSION, for the same reason the run manifest is: the session
// ledger is swept at 48h and deleted outright by SessionEnd, and an obligation that
// evaporates because the owner opened a new terminal is the same leak in a different shape.
// The price is the cold return, and it is paid deliberately — see canon-gate.js.
//
// TTL. Seven days, because past that the evidence is too stale to act on and the ids may
// not exist any more. A debt no gate can settle must eventually stop being a debt.
// ---------------------------------------------------------------------------

const DEBT_TTL_S = 7 * 24 * 60 * 60;

function debtFile(ph) { return path.join(DIR_BYPROJ, ph + '.debt.json'); }

/** The project's carried debt, or null. Expired debt is deleted on sight, never returned. */
function readDebt(cwd) {
  const f = debtFile(projHash(cwd));
  const d = readJSON(f);
  if (!d) return null;
  if (!d.at || (nowS() - d.at) > DEBT_TTL_S) {
    try { fs.unlinkSync(f); } catch (_) {}
    return null;
  }
  return d;
}

function writeDebt(cwd, obj) { return writeJSON(debtFile(projHash(cwd)), obj); }

function clearDebt(cwd) {
  try { fs.unlinkSync(debtFile(projHash(cwd))); return true; } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Retention (§4.6)
// ---------------------------------------------------------------------------

const SESSION_TTL_S = 48 * 60 * 60;
const SWEEP_EVERY_S = 60 * 60;
const SWEEP_MAX = 50;

function sweep() {
  try {
    ensureDirs();
    const stamp = path.join(HOME, '.last-sweep');
    const prev = Number((readJSON(stamp) || {}).at || 0);
    if (prev && (nowS() - prev) < SWEEP_EVERY_S) return;
    writeJSON(stamp, { at: nowS() });

    let n = 0;
    for (const f of fs.readdirSync(DIR_SESSIONS)) {
      if (n >= SWEEP_MAX) break;
      const full = path.join(DIR_SESSIONS, f);
      try {
        const st = fs.statSync(full);
        if ((Date.now() - st.mtimeMs) / 1000 > SESSION_TTL_S) { fs.unlinkSync(full); n++; }
      } catch (_) {}
    }
    for (const f of fs.readdirSync(DIR_RUNS)) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(DIR_RUNS, f);
      const r = readJSON(full);
      if (r && r.state === 'CLOSED' && r.closed_at && (nowS() - r.closed_at) > 14 * 24 * 3600) {
        try { fs.unlinkSync(full); } catch (_) {}
      }
    }
    // Expired debt, for a project nobody has opened since. readDebt() collects the rest.
    for (const f of fs.readdirSync(DIR_BYPROJ)) {
      if (!f.endsWith('.debt.json')) continue;
      const full = path.join(DIR_BYPROJ, f);
      const d = readJSON(full);
      if (!d || !d.at || (nowS() - d.at) > DEBT_TTL_S) { try { fs.unlinkSync(full); } catch (_) {} }
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// stdin
// ---------------------------------------------------------------------------

function readStdin(cb) {
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; cb(buf); };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  } catch (_) { finish(); return; }
  // Never hang the runtime. The hook timeout kills us anyway, and a killed hook is
  // indistinguishable from a live one from inside the conversation.
  setTimeout(finish, 2500).unref?.();
}

module.exports = {
  normPath, normTarget, sha1, HOME, HOME_SOURCE, DIR_SESSIONS, DIR_RUNS, DIR_BYPROJ, ensureDirs, projHash, nowS,
  sessionKey, sessionFile, append, readLines, readFamily,
  harvestSeen, harvestArgIds, harvestIdHeads, headsVouchFor, trimIds, idShape, safeArgs, bareToolName,
  shellStrings, shellSegments, shellMutation, shellWriteTargets, redirectTargets, argWriteTargets, writeTargets,
  parseBulkResponse, bulkInnerNames, responseText,
  sentinel, canonMode, gateArmed,
  resolveRun, saveRun, openRun, closeRun, spendBlock, blocksSpent, creditProgress, runFile, pointerFile,
  debtFile, readDebt, writeDebt, clearDebt,
  readJSON, writeJSON, newRunId, sweep, readStdin,
  UUID_SRC, RUN_STALE_S, DEBT_TTL_S,
};
