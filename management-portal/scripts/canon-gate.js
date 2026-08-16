#!/usr/bin/env node
/**
 * canon-gate.js — the portal canon, enforced as hooks instead of reminders.
 *
 * =========================================================================
 * HOW TO STAND THESE GATES DOWN  (read this first — the escape is designed
 * before the gate, on purpose, and every form works MID-SESSION)
 * =========================================================================
 *
 *   1) A file sentinel, re-read on EVERY hook invocation:
 *        node "<this file>" stand-down --gate <GATE-ID|all> [--run <run_id>] --reason "<why>"
 *      This exact invocation is exempt from every gate, including CANON-COORD-ROLE.
 *      A gate that can block its own escape is a trap, not a gate.
 *
 *   2) The slash command:  /portal-stand-down [gate] [reason]
 *
 *   3) The environment:    PORTAL_CANON=off       (everything silent)
 *                          PORTAL_CANON=advisory  (nothing refuses or blocks)
 *      settings.json "env" propagates into hook processes, but it is FIXED for the
 *      session's life — which is exactly why (1) exists.
 *
 *   4) Delete the run pointer by hand:
 *        <CANON_HOME>/runs/by-project/<projhash>.json
 *      or run:  node "<this file>" run-close --run <run_id>
 *
 *   5) Nothing at all: every gate degrades to advisory by itself after its per-run
 *      block budget, and a run with no progress for 24h closes itself.
 *
 * AND THE RULE BEHIND ALL OF THEM: every state this ledger can enter needs a key that has
 * been PROVEN to turn, not merely documented. REGISTER's fourth column names the tools a
 * gate may never refuse, and canon-selftest.js drives each one into its latched state and
 * back out through exactly those calls. Two gates shipped without such a key and were
 * one-way latches: CANON-COORD-ROLE latched on claim_coordinator_title with nothing that
 * could un-latch it, and CANON-JOURNAL-PHASE refused the create_journal it demanded. A
 * refusal the model cannot clear by doing what it was told costs more than the gate saves,
 * because it spends the credit of the escape text along with it.
 *
 * Run `node canon-gate.js doctor` to see which gates are armed, which have stood
 * themselves down, and where the ledger lives.
 *
 * =========================================================================
 * THE MEASURED RUNTIME FACTS THIS DESIGN RESTS ON  (Claude Code 2.1.231, Windows)
 * =========================================================================
 *
 * PLAIN STDOUT FROM A HOOK IS DISCARDED — carried forward verbatim from the file this
 * replaces (portal-gate.js, measured on 2.1.222): plain stdout is discarded for
 * PreToolUse, PostToolUse and Stop alike. The hook runs, exits 0, and its output never
 * reaches the model. That is why Gate 1 and Gate 3 were enforced for months by a hook
 * that looked installed and did nothing.
 *
 * WHAT DOES REACH THE MODEL:
 *   * PreToolUse hookSpecificOutput{permissionDecision:"deny", permissionDecisionReason}
 *     REFUSES THE CALL. Measured here: `echo HELLO_FROM_BASH` never executed, the reason
 *     arrived as an is_error tool_result, and the run's `permission_denials` recorded it.
 *     This is the "before any action" half of the owner's request, and it is real.
 *   * PostToolUse and Stop {decision:"block", reason} are obeyed.
 *   * SessionStart and UserPromptSubmit additionalContext reach the model. TWO hooks on
 *     one SessionStart BOTH deliver (measured: a session asked to echo its cards
 *     returned CARD-ALPHA-11 and CARD-BRAVO-22), so this runs beside watch-alarm.js
 *     preflight without absorbing it.
 *   * Pre/PostToolUse additionalContext is NOT proven on this build. No gate depends on it.
 *
 * A DENY REASON IS BELIEVED EXACTLY AS FAR AS IT IS TRUE ABOUT THE CALL. This is the
 * single most important finding and it shapes every string below. Two probes fired a
 * correctly-worded CANON-ID refusal at a call that did not carry the id it named. Both
 * times the model cross-checked the reason against its own tool input, found the
 * mismatch, and reported the GATE as broken or as injected text — the second time it
 * also noticed the portal invariant had no jurisdiction over `echo`. So:
 *
 *   * every REFUSE reason names values lifted from THIS call — the real id, the real
 *     tool, the real missing artifact. A templated or placeholder reason discredits the
 *     whole mechanism.
 *   * REFUSE reasons state facts and carry NO imperatives, no "to clear this", no paths
 *     to run and no escape. An instruction inside a deny reason is read as an attempted
 *     bypass and is deliberately not followed — measured a third time, when a probe told
 *     the model to write an unlock file and it declined, correctly, on those grounds.
 *   * the clearing action and the escape ship through the channels the model DOES trust:
 *     the SessionStart card, PostToolUse block reasons, and Stop block reasons.
 *
 * CANDIDATE IDS COME FROM tool_input, NEVER FROM THE PAYLOAD ENVELOPE. Measured the
 * hard way: a probe that regexed the raw stdin string found the SESSION'S OWN id (the
 * envelope carries session_id, tool_use_id and transcript_path) and refused an unrelated
 * command every time. See canon-lib.js harvestArgIds vs harvestSeen.
 *
 * A GATE THAT WATCHES A TOOL INSTEAD OF AN EFFECT IS A GATE WITH A DOOR NEXT TO IT. Every
 * gate below once named the tools it governed — Write, Edit, MultiEdit, NotebookEdit, Bash —
 * and every one of them was walked around by a tool with a different name doing the same
 * thing. Measured on a live session, RUN-state project, no task tree: the model wrote
 * src/bypass.ts with the stock Windows `PowerShell` tool, `permission_denials` was empty,
 * and the debug log held ZERO `Hook PreToolUse` lines, because `PowerShell` is in none of
 * those five names. The same effect also arrived through `cat > f`, `sed -i`,
 * `python -c open(…,'w')`, `tee`, and mcp__Desktop_Commander__write_file / edit_block.
 * Separately, `bulk` — the meta-tool the canon TELLS the agent to prefer — carried the
 * refused call past all eight PreToolUse gates, because nothing inspected tool_input.calls.
 *
 * So the classification is now by SHAPE, in canon-lib.js: does this call carry a command
 * line, and does it name a file it is about to write? The matcher in hooks.json is `.*`
 * and holds no tool names at all. The portal invariants stay scoped to the 257 registered
 * portal tools; the file and shell gates apply to whatever performs the effect. The next
 * MCP server the owner installs is covered on the day it is installed, and the price of a
 * general classifier is paid honestly: every refusal names the concrete evidence it found —
 * the program in command position, or the path — and when it can name nothing it says
 * nothing.
 *
 * HOOKS FAIL OPEN AND SILENTLY. A crash or a timeout kills the process and the call
 * proceeds with the model told nothing — a dead gate is indistinguishable from a live
 * one from inside the conversation. Hence the liveness token on the card, `doctor`,
 * `selftest`, and the --include-hook-events recipe in the README.
 *
 * A BLOCKING Stop HOOK CAN TRAP A SESSION. The runtime hard-caps consecutive Stop blocks
 * at 9 and then ends the turn with an EMPTY result. Budgets here stay far below that,
 * every block names the action that clears it, and stop_hook_active is honoured.
 *
 * =========================================================================
 * WHY THE "AFTER ANY ACTION" HALF IS ENFORCED BEFORE THE NEXT ACTION
 * =========================================================================
 *
 * STOP GATES ARE ONE-SHOT PER TURN, AND THAT PROPERTY IS LOAD-BEARING. `stop_hook_active`
 * short-circuits above canBlock, so a Stop hook blocks at most once per turn — measured
 * across five consecutive turns with the portal unreachable, which is the only reason this
 * plugin cannot trap the person who installed it. It must stay exactly as it is.
 *
 * The measured price of that property is a real leak, driven by the same fixtures:
 *
 *   stop#1 BLOCK(READ-BACK-STOP) → stop#2 SPEAK → stop#3 BLOCK(ACCOUNT) → stop#4 ALLOW,
 *   and the turn ends with the write still unverified and phases remaining.
 *   stop#1 BLOCK(CLOSEOUT) → stop#2 SPEAK → ALLOW, and the turn ends with the whole
 *   close-out missing. A live run ended `stop_reason: end_turn` with 0 boundaries and no
 *   journal, and the per-run budgets (3/3/2) then degrade those gates permanently.
 *
 * So the Stop half DELAYS a violating turn by one exchange; it does not prevent it. Making
 * Stop block harder, longer or more often would buy the after-half by spending the one
 * property that keeps the whole thing safe. The two requirements are in genuine conflict
 * and cannot both be satisfied inside Stop.
 *
 * THE RESOLUTION: the obligation already persists in the ledger, so let the turn END, write
 * the debt down, and REFUSE THE NEXT ACTION while it stands. The turn ending is not the
 * violation — continuing to work as though the debt were paid is. Nothing traps: the
 * session always ends, UserPromptSubmit and SessionStart only ever speak, so the owner can
 * always talk; only WORK is refused, and only until the debt is settled.
 *
 * Four properties make that a gate rather than a latch, and each is driven by the selftest:
 *
 *   1. THE SETTLING ACTION CAN NEVER BE REFUSED. A read is how a read-back debt is settled,
 *      and no read is ever a portal write, a file write or a command — so reads pass by
 *      construction. The close-out debt has no such luck: every call that settles it IS a
 *      portal write, so CLOSEOUT_CLEARING exempts them by name and REGISTER's fourth column
 *      publishes them, exactly as JOURNAL_CLEARING does. Four gates in this feature have
 *      already shipped as one-way latches; the key is data, and the suite turns it.
 *   2. IT DEGRADES. DEBT_BUDGET refusals per distinct debt, counted from the ledger, and
 *      then that debt stands itself down for good. A debt the model cannot settle — the
 *      portal is down, the record is gone — costs three refusals and then stops costing
 *      anything. The Stop gates go on reporting it; nothing is silently forgiven.
 *   3. IT EXPIRES. Seven days (canon-lib DEBT_TTL_S), and an explicit run-close clears it.
 *   4. THE DENY REASON STATES FACTS ONLY, like every other refusal here. The call that
 *      settles the debt travels on the channels the model actually acts on: the SessionStart
 *      card and the UserPromptSubmit context, both of which fire BEFORE the first action of
 *      the turn — including the first action of a cold return, which is the one that gets
 *      refused.
 *
 * THE COLD RETURN IS DELIBERATE. Debt is keyed by PROJECT, so a debt left on Friday refuses
 * the first piece of work on Monday. That is the point: a debt that evaporates because the
 * owner opened a new terminal is the same leak wearing a different hat. It costs one call to
 * settle, that call is named on the card and again on the prompt the model has just read,
 * and it stands down after three refusals if the record genuinely cannot be read.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const L = require('./canon-lib.js');

// ---------------------------------------------------------------------------
// PORTAL_TOOLS — the frozen tool-name list this gate scopes itself to.
//
// Generated 2026-08-14 from backend/ai/tools/**/*.py registrations, plus the `bulk`
// meta-tool added at the MCP server layer (backend/routers/mcp_server.py BULK_TOOL_NAME).
// Count: 257.
//
// Regenerate with:
//   grep -rhoP '(?<=^\s{8}name=")[a-z0-9_]+(?=")' backend/ai/tools/*.py | sort -u
//   (then add 'bulk')
//
// This exists because hook matchers are a FULL match on the tool name and the shipped
// narrow matcher was INERT for `mcp__claude_ai_management-portal__*` and `mcp__<uuid>__*`
// installs. Matchers are now broad and scoping happens here. A tool NOT in this list is
// never gated — that is what keeps Supabase, Desktop_Commander, chrome-devtools and
// playwright out of the blast radius.
// ---------------------------------------------------------------------------

const PORTAL_TOOLS = new Set([
  'add_board_comment', 'add_board_member', 'add_gig_faq_item', 'add_gig_requirement',
  'add_journal_attachment', 'add_portfolio_item', 'add_proposal_milestone', 'add_proposal_phase',
  'add_source_to_knowledge_graph', 'add_work_history_entry', 'approve_scheduling_request',
  'attach_to_quick_proposal', 'await_my_turn', 'await_subagent_message', 'bulk',
  'claim_coordinator_title', 'complete_task', 'create_board', 'create_board_block',
  'create_board_folder', 'create_chart', 'create_chat_channel', 'create_chat_folder',
  'create_checkpoint', 'create_client', 'create_event', 'create_flow_cluster',
  'create_flow_connection', 'create_gig', 'create_journal', 'create_journal_folder',
  'create_knowledge_graph', 'create_knowledge_graph_edge', 'create_knowledge_graph_folder',
  'create_knowledge_graph_node', 'create_mentoring_session', 'create_note', 'create_note_column',
  'create_plotly_chart', 'create_powerpoint', 'create_project', 'create_proposal',
  'create_quick_proposal', 'create_scheduled_task', 'create_scheduling_link', 'create_subtask',
  'create_task', 'create_tradingview_chart', 'create_word_document', 'delete_board',
  'delete_board_block', 'delete_chat_channel', 'delete_chat_folder', 'delete_client',
  'delete_comment', 'delete_event', 'delete_flow_cluster', 'delete_flow_connection',
  'delete_gig', 'delete_gig_faq_item', 'delete_gig_package', 'delete_gig_requirement',
  'delete_journal', 'delete_journal_folder', 'delete_journal_reflection',
  'delete_knowledge_graph', 'delete_knowledge_graph_edge', 'delete_knowledge_graph_folder',
  'delete_knowledge_graph_node', 'delete_memory', 'delete_mentoring_session', 'delete_note',
  'delete_note_column', 'delete_portfolio_item', 'delete_project', 'delete_quick_proposal',
  'delete_scheduled_task', 'delete_task', 'delete_time_entry', 'delete_work_history_entry',
  'edit_comment', 'execute_code', 'export_journals', 'extract_knowledge_graph',
  'generate_knowledge_graph', 'generate_mermaid', 'get_agent_runtime_status', 'get_brief',
  'get_client', 'get_client_stats', 'get_current_datetime', 'get_gig', 'get_journal',
  'get_journal_reflection', 'get_knowledge_graph', 'get_knowledge_graph_node',
  'get_mentoring_session', 'get_my_full_profile', 'get_my_portfolio', 'get_my_skills',
  'get_my_work_history', 'get_note', 'get_profile', 'get_project', 'get_proposal',
  'get_proposal_detail', 'get_quick_proposal', 'get_task', 'get_time_summary', 'get_workspace',
  'get_workspace_stats', 'hide_dm_conversation', 'import_journals', 'insert_diagram',
  'interpret_knowledge_graph', 'journal_reflection_summary', 'leave_chat_channel',
  'list_board_blocks', 'list_board_comments', 'list_board_folders', 'list_boards', 'list_briefs',
  'list_channel_members', 'list_channel_watchers', 'list_chat_folders', 'list_clients',
  'list_events', 'list_flow_clusters', 'list_flow_connections', 'list_flow_layouts', 'list_gigs',
  'list_journal_attachments', 'list_journal_folders', 'list_journals',
  'list_knowledge_graph_folders', 'list_knowledge_graphs', 'list_mcp_servers',
  'list_mentoring_sessions', 'list_milestones', 'list_note_columns', 'list_notes',
  'list_projects', 'list_quick_proposals', 'list_scheduled_tasks', 'list_scheduling_links',
  'list_scheduling_requests', 'list_skills', 'list_subtasks', 'list_tasks',
  'list_team_chat_members', 'list_time_entries', 'list_workspace_members', 'log_time',
  'message_subagent', 'move_board_to_folder', 'move_chat_item', 'move_journal_to_folder',
  'pin_journal', 'promote_quick_proposal', 'react_to_comment', 'read_board',
  'read_channel_messages', 'read_channel_policy', 'read_chat_channels', 'read_dm_conversations',
  'read_dm_messages', 'read_inbox', 'recall', 'regenerate_knowledge_graph',
  'register_me_as_agent', 'reject_scheduling_request', 'release_channel_watch', 'remember',
  'remove_journal_attachment', 'remove_source_from_knowledge_graph',
  'remove_unavailable_sources', 'rename_chat_channel', 'rename_chat_folder', 'rename_dm',
  'reorder_blocks', 'reorder_journal_folders', 'reorder_journals', 'reorder_portfolio',
  'reorder_proposal_milestones', 'reorder_proposal_phases', 'require_channel_watch',
  'resolve_comment', 'run_in_sandbox', 'search_journals', 'search_knowledge_graphs',
  'semantic_search_knowledge_graph', 'send_chat_message', 'send_dm_message',
  'send_inbox_message', 'set_agents_paused', 'set_block_parent', 'set_channel_policy',
  'set_journal_reflection', 'set_scheduled_task_enabled', 'spawn_subagents',
  'stage_configure_sandbox_env', 'stage_create_skill', 'stage_install_mcp_server',
  'stage_install_skill', 'stage_set_mcp_server_enabled', 'stage_set_skill_enabled',
  'stage_update_mcp_server', 'stage_update_skill', 'start_timer', 'start_watching_channel',
  'stop_timer', 'subagent_status', 'tag_journals', 'transfer_coordinator_title', 'update_board',
  'update_board_block', 'update_brief', 'update_brief_field', 'update_client', 'update_event',
  'update_flow_cluster', 'update_flow_connection', 'update_gig', 'update_gig_faq_item',
  'update_gig_package', 'update_gig_requirement', 'update_journal', 'update_journal_folder',
  'update_knowledge_graph', 'update_knowledge_graph_edge', 'update_knowledge_graph_folder',
  'update_knowledge_graph_node', 'update_memory', 'update_mentoring_session',
  'update_milestone_status', 'update_my_profile_extended', 'update_note', 'update_note_column',
  'update_note_content', 'update_portfolio_item', 'update_profile', 'update_project',
  'update_proposal', 'update_proposal_field', 'update_proposal_milestone',
  'update_proposal_phase', 'update_quick_proposal', 'update_scheduled_task', 'update_task',
  'update_time_entry', 'update_work_history_entry', 'update_workspace', 'web_crawl',
  'web_extract', 'web_map', 'web_search', 'whoami'
]);

// ---------------------------------------------------------------------------
// WRITE_READ_MAP — mirrored from skills/management-portal/reference.md §3.
//
// CHANGING EITHER ONE REQUIRES THE SAME CHANGE TO THE OTHER IN THE SAME COMMIT.
// reference.md stays the human source of truth; this is the machine copy.
//
// Rows marked (+) are NOT in reference.md §3 today — journals, knowledge graphs and
// channel policy have no read mapping there, which reference.md itself names as a
// coverage gap. Canon (d), (e) and (g) need them, so they are added here and flagged
// for the skill to mirror.
// ---------------------------------------------------------------------------

const WRITE_READ_MAP = {
  create_client: ['get_client', 'list_clients'],
  update_client: ['get_client', 'list_clients'],
  delete_client: ['list_clients', 'get_client'],
  create_project: ['get_project', 'list_projects'],
  update_project: ['get_project', 'list_projects'],
  delete_project: ['list_projects', 'get_project'],
  update_brief: ['get_brief'],
  update_brief_field: ['get_brief'],
  create_proposal: ['get_proposal_detail', 'get_proposal'],
  update_proposal: ['get_proposal_detail', 'get_proposal'],
  update_proposal_field: ['get_proposal_detail', 'get_proposal'],
  add_proposal_phase: ['get_proposal_detail'],
  update_proposal_phase: ['get_proposal_detail'],
  reorder_proposal_phases: ['get_proposal_detail'],
  add_proposal_milestone: ['get_proposal_detail', 'list_milestones'],
  update_proposal_milestone: ['get_proposal_detail', 'list_milestones'],
  update_milestone_status: ['get_proposal_detail', 'list_milestones'],
  reorder_proposal_milestones: ['get_proposal_detail', 'list_milestones'],
  insert_diagram: ['get_proposal_detail', 'get_brief'],
  create_task: ['get_task', 'list_tasks'],
  update_task: ['get_task', 'list_tasks'],
  complete_task: ['get_task', 'list_tasks'],
  delete_task: ['list_tasks', 'get_task'],
  create_subtask: ['list_subtasks'],
  create_flow_cluster: ['list_flow_clusters'],
  update_flow_cluster: ['list_flow_clusters'],
  delete_flow_cluster: ['list_flow_clusters'],
  create_flow_connection: ['list_flow_connections'],
  update_flow_connection: ['list_flow_connections'],
  delete_flow_connection: ['list_flow_connections'],
  create_board: ['read_board', 'list_boards'],
  update_board: ['read_board', 'list_boards'],
  delete_board: ['list_boards', 'read_board'],
  create_board_block: ['list_board_blocks', 'read_board'],
  update_board_block: ['list_board_blocks', 'read_board'],
  reorder_blocks: ['list_board_blocks', 'read_board'],
  set_block_parent: ['list_board_blocks', 'read_board'],
  delete_board_block: ['list_board_blocks', 'read_board'],
  add_board_comment: ['read_board', 'list_board_comments'],
  edit_comment: ['read_board', 'list_board_comments'],
  resolve_comment: ['read_board', 'list_board_comments'],
  react_to_comment: ['read_board', 'list_board_comments'],
  create_note: ['get_note', 'list_notes'],
  update_note: ['get_note', 'list_notes'],
  update_note_content: ['get_note', 'list_notes'],
  delete_note: ['get_note', 'list_notes'],
  create_note_column: ['list_note_columns'],
  update_note_column: ['list_note_columns'],
  delete_note_column: ['list_note_columns'],
  create_event: ['list_events'],
  update_event: ['list_events'],
  delete_event: ['list_events'],
  log_time: ['list_time_entries', 'get_time_summary'],
  start_timer: ['list_time_entries', 'get_time_summary'],
  stop_timer: ['list_time_entries', 'get_time_summary'],
  update_time_entry: ['list_time_entries', 'get_time_summary'],
  delete_time_entry: ['list_time_entries', 'get_time_summary'],
  create_quick_proposal: ['get_quick_proposal', 'list_quick_proposals'],
  update_quick_proposal: ['get_quick_proposal', 'list_quick_proposals'],
  promote_quick_proposal: ['get_quick_proposal', 'list_quick_proposals'],
  attach_to_quick_proposal: ['get_quick_proposal', 'list_quick_proposals'],
  create_mentoring_session: ['get_mentoring_session', 'list_mentoring_sessions'],
  update_mentoring_session: ['get_mentoring_session', 'list_mentoring_sessions'],
  create_gig: ['get_gig', 'list_gigs'],
  update_gig: ['get_gig', 'list_gigs'],
  create_scheduling_link: ['list_scheduling_links'],
  approve_scheduling_request: ['list_scheduling_requests'],
  reject_scheduling_request: ['list_scheduling_requests'],
  send_chat_message: ['read_channel_messages'],
  send_dm_message: ['read_dm_messages'],
  send_inbox_message: ['read_inbox'],
  start_watching_channel: ['list_channel_watchers'],
  require_channel_watch: ['list_channel_watchers'],
  release_channel_watch: ['list_channel_watchers'],
  claim_coordinator_title: ['list_channel_watchers'],
  transfer_coordinator_title: ['list_channel_watchers'],
  remember: ['recall'],
  update_memory: ['recall'],
  delete_memory: ['recall'],
  // (+) additions beyond reference.md §3 — needed by canon (d), (e), (g).
  create_journal: ['get_journal', 'list_journals', 'search_journals'],
  update_journal: ['get_journal', 'list_journals', 'search_journals'],
  create_journal_folder: ['list_journal_folders'],
  update_journal_folder: ['list_journal_folders'],
  move_journal_to_folder: ['list_journals', 'list_journal_folders'],
  tag_journals: ['list_journals', 'search_journals'],
  set_journal_reflection: ['get_journal_reflection'],
  create_knowledge_graph: ['get_knowledge_graph', 'list_knowledge_graphs'],
  update_knowledge_graph: ['get_knowledge_graph', 'list_knowledge_graphs'],
  delete_knowledge_graph: ['list_knowledge_graphs'],
  add_source_to_knowledge_graph: ['get_knowledge_graph'],
  remove_source_from_knowledge_graph: ['get_knowledge_graph'],
  extract_knowledge_graph: ['get_knowledge_graph', 'semantic_search_knowledge_graph'],
  generate_knowledge_graph: ['get_knowledge_graph', 'list_knowledge_graphs'],
  regenerate_knowledge_graph: ['get_knowledge_graph', 'list_knowledge_graphs'],
  create_knowledge_graph_node: ['get_knowledge_graph', 'get_knowledge_graph_node'],
  create_knowledge_graph_edge: ['get_knowledge_graph'],
  set_channel_policy: ['read_channel_policy'],
  create_chat_channel: ['read_chat_channels'],
};

/**
 * A DELETE IS VERIFIED BY ABSENCE, AND UNTIL NOW IT WAS VERIFIED BACKWARDS.
 *
 * `clearReads` only ever discharged an obligation when the written id came BACK in the
 * mapped read. For a delete that is the precise opposite of the proof: after
 * `delete_task(X)`, `list_tasks` returning X means the delete FAILED, and `list_tasks`
 * NOT returning X — the outcome that should clear it — could never clear it. Seven rows
 * already in this map (delete_note, delete_note_column, delete_flow_cluster,
 * delete_flow_connection, delete_event, delete_time_entry, delete_memory) were therefore
 * shipping an obligation with no reachable discharge: an honest read-back left the block
 * standing, and the model had nothing to do but spend the budget. That is the one-way
 * latch this file's header spends forty lines warning about, in a seventh instance.
 *
 * So obligations carry a polarity. `delete_*` clears on ABSENCE; everything else clears on
 * presence, exactly as before. The four rows added above (task/client/project/board) could
 * not be added at all until this was true — they would have been four more latches.
 */
function isDeleteWrite(tool) { return /^delete_/.test(String(tool || '')); }

/** Every portal tool that mutates a record — the scope of CANON-ID. */
const WRITE_PREFIX = /^(create|update|add|delete|remove|set|insert|reorder|complete|promote|attach|approve|reject|log|send|react|edit|resolve|register|require|release|claim|transfer|tag|pin|move|hide|rename|import|generate|regenerate|extract|interpret|stage|leave)_|^(remember)$/;
function isPortalWrite(bare) {
  if (!bare) return false;
  if (Object.prototype.hasOwnProperty.call(WRITE_READ_MAP, bare)) return true;
  return WRITE_PREFIX.test(bare) && PORTAL_TOOLS.has(bare);
}
function isPortalTool(bare) { return Boolean(bare) && PORTAL_TOOLS.has(bare); }

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The journal writes CANON-JOURNAL-PHASE demands, and therefore must never refuse.
 *
 * create_journal is a portal write, so without this set the gate refused the one call that
 * could clear it — and with it every other portal write for the rest of the run. The read
 * half (get_journal/list_journals/search_journals) was always exempt because reads are not
 * writes. create_journal_folder is here because the folder_id the card names has to come
 * from somewhere, and a run that has not made its folder yet would otherwise be stuck one
 * step earlier. Keep this set exactly as wide as the published clearing path and no wider.
 */
const JOURNAL_CLEARING = new Set(['create_journal', 'update_journal', 'create_journal_folder']);

/**
 * The close-out writes CANON-DEBT-CLOSEOUT demands, and therefore must never refuse.
 *
 * Every single artifact the close-out is made of is written by a portal WRITE, so a gate
 * that refuses portal writes until the close-out exists refuses the close-out itself — the
 * fifth instance of the one-way latch this file keeps warning about, and the most complete
 * one, because there would be no other call left to make. The read halves
 * (get_knowledge_graph, semantic_search_knowledge_graph, get_journal, list_journals) need no
 * entry: a read is never a write, a file write or a command, so the debt gates cannot see
 * them at all.
 *
 * Kept exactly as wide as the miss list in closeoutMissing() and no wider — REGISTER's
 * fourth column publishes it and canon-selftest.js drives every member.
 */
const CLOSEOUT_CLEARING = new Set(['create_board', 'create_board_block', 'create_knowledge_graph',
  'add_source_to_knowledge_graph', 'extract_knowledge_graph', 'interpret_knowledge_graph',
  'create_journal', 'update_journal']);

/**
 * How many times ONE debt may refuse before it stands itself down for good.
 *
 * The Stop gates carry 3/3/2 per run; this is the same number for the same reason. Three
 * refusals is enough for the model to see the debt, try the call the card named, and try
 * once more. A fourth would be the gate insisting on something the environment cannot
 * deliver — the portal is unreachable, or the record really is gone — and an unsettleable
 * debt that refuses for ever is a wedged session, which is the one outcome worse than the
 * leak this closes. Counted per DISTINCT debt (see debtKey), so settling one debt and
 * incurring another does not inherit a spent budget.
 */
const DEBT_BUDGET = 3;

/**
 * Calls the debt gates may never refuse because ANOTHER gate publishes them as ITS key.
 *
 * The debt gates refuse work, and more than one gate can be live at once — which means the
 * debt gate is in a position to refuse the exact call a different gate is demanding, and to
 * recreate the one-way latch at the seam between two gates instead of inside one of them.
 * The concrete pair: CANON-ACCOUNT blocks a silent turn end and publishes
 * `create_journal(tags=["blocked"])` as the way to stop with an account instead — which is
 * precisely what a model writes when it CANNOT settle something. A debt gate that refuses
 * that call answers "you may always stop with an account" with "no, you may not".
 *
 * transfer_coordinator_title is here for the same reason: it is CANON-COORD-ROLE's only key,
 * and a session holding the title with a debt outstanding would otherwise be unable to turn
 * either lock. Kept to keys other gates actually publish, and no wider.
 */
const OTHER_GATE_KEYS = new Set(['create_journal', 'update_journal', 'create_journal_folder',
  'transfer_coordinator_title']);

// THE BASH_MUTATING REGEX THAT USED TO LIVE HERE IS GONE, and its replacement is
// canon-lib.js shellMutation(). It read:
//
//   /(^|[\s;&|])(git\s+(commit|push)|npm|pnpm|yarn|pip|rm\s|mv\s|cp\s|mkdir\s|node\s+\S+\.js)|>>?[^&]/
//
// and it was defeated by a pair of quotes. `bash -c "npm install"` has no whitespace,
// semicolon, ampersand or pipe in front of `npm` for the anchor to match, so it ran.
// `CI=1 make build` ran because make, cmake, go, cargo, msbuild and dotnet were simply
// not in the list. mcp__Desktop_Commander__start_process ran because it is not called
// Bash. All three measured ALLOW while the session held the coordinator title.
//
// A list of program names inside an anchored regex answers "does this text look like a
// mutating command"; the question worth asking is "what program is in command position
// here", which survives quoting, env prefixes and shell wrappers. The stand-down
// invocation is exempted separately and unconditionally — see standDownExempt().

function standDownExempt(cmd) {
  return typeof cmd === 'string' && /canon-gate(\.js)?["']?\s+(stand-down|run-close|doctor|selftest|tools|run-open|run-promote)/.test(cmd);
}

// ---------------------------------------------------------------------------
// The gate register, as published on the card
// ---------------------------------------------------------------------------

// [ id, what it refuses, how the card says it clears,
//   KEYS — portal tools this gate must NEVER refuse, driven by canon-selftest.js ]
//
// THE FOURTH COLUMN EXISTS BECAUSE A PUBLISHED ESCAPE IS NOT A TESTED ONE. Two gates here
// shipped as ONE-WAY LATCHES, both measured by driving the real binary:
//
//   * CANON-COORD-ROLE latched on claim_coordinator_title and nothing un-latched it. The
//     action the card published — send_chat_message — does not and should not clear it;
//     transfer_coordinator_title, release_channel_watch and leave_chat_channel did not
//     either, because no code path ever wrote a second `mode` row. Every Write/Edit/
//     mutating Bash was refused for the rest of the session.
//   * CANON-JOURNAL-PHASE refused create_journal — the exact call it demanded — because
//     create_journal is itself a portal write. Every portal write died with it.
//
// A gate that refuses the action it names is worse than no gate: the model does what the
// card says, the refusal persists, and the escape text loses its credit along with it. So
// the key is now DATA, the selftest drives it, and the card and the test cannot drift.
const REGISTER = [
  ['CANON-ID', 'a portal write carrying an id this session never saw', 'a list_*/get_* that returns that id', null],
  ['CANON-BOTTOM-UP', 'complete_task before its subtasks are listed and done', 'list_subtasks(parent_task_id), then complete each child', null],
  ['CANON-COORD-ROLE', 'any file write or mutating command while you hold the coordinator title', 'transfer_coordinator_title, or standing this one gate down', ['transfer_coordinator_title']],
  ['CANON-POLICY-FIRST', 'a participant acting before reading the channel', 'read_channel_policy + read_channel_messages', null],
  ['CANON-JOURNAL-PHASE', 'the first write after a phase boundary, unjournalled', 'create_journal(folder_id=...) + get_journal/list_journals', ['create_journal', 'update_journal', 'create_journal_folder']],
  ['CANON-KG-DESTRUCTIVE', 'regenerate/delete_knowledge_graph (both destroy nodes+edges)', 'extract_knowledge_graph, the incremental path', null],
  ['CANON-TREE-FIRST', 'any write to a project source file before the task tree and flow board exist', 'create_task + create_subtask + create_flow_cluster + create_flow_connection', null],
  ['CANON-BOARD-FIRST', 'brief/proposal/task writes before the alignment board', 'create_board + create_board_block(type mermaid) + read_board', null],
  ['CANON-READ-BACK', 'BLOCKS after a write until the mapped read returns the id', 'the mapped get_*/list_*, ideally batched in one bulk', null],
  ['CANON-ACCOUNT', 'BLOCKS a SILENT turn end while phases remain', 'continuing, or create_journal tagged "blocked"', null],
  ['CANON-CLOSEOUT', 'BLOCKS the last turn end without summary board + graph + journal', 'the exact calls it names', null],
  ['CANON-DEBT-READ-BACK', 'the NEXT turn\'s work while an earlier turn\'s write is unread', 'the mapped read — read_board / get_task / list_tasks; never refuses create_journal either', ['read_board', 'get_task', 'list_tasks', 'create_journal']],
  ['CANON-DEBT-CLOSEOUT', 'the NEXT turn\'s work while the close-out is unmade', 'create_board + create_knowledge_graph + extract_knowledge_graph + interpret_knowledge_graph + create_journal', ['create_board', 'create_knowledge_graph', 'extract_knowledge_graph', 'interpret_knowledge_graph', 'create_journal']],
];
const ADVISORY_ONLY = 'CANON-COMPLETE, CANON-BULK, CANON-STATUS advise at turn end and never block.';

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }
function quiet() { process.exit(0); }

function refuse(reason) {
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}
function blockPost(reason) { out({ decision: 'block', reason }); }
function blockStop(reason) { out({ decision: 'block', reason }); }
function speak(text, event) {
  out({ hookSpecificOutput: { hookEventName: event || 'Stop', additionalContext: text } });
}

const SELF = path.join(__dirname, 'canon-gate.js');
function standDownLine(gate) {
  return 'node "' + SELF + '" stand-down --gate ' + gate + ' --reason "<why>"';
}

// ---------------------------------------------------------------------------
// The fold — derived state, computed at read time, never written back (§4.2)
// ---------------------------------------------------------------------------

function fold(rows, run) {
  const st = {
    seen: new Set(),
    seenForeign: new Map(),
    obligations: new Map(),
    phaseBoundaries: [],
    mode: (run && run.mode) || 'solo',
    channel: (run && run.channel) || null,
    policy: { policy: false, messages: false },
    subtasks: new Map(),
    completed: new Set(),
    tree: { task: 0, subtask: 0, cluster: 0, connection: 0 },
    board: { board: 0, mermaid: 0, read: 0 },
    graphIds: new Set(),
    journalWrites: [],
    journalReads: [],
    portalWriteTimes: [],
    postBlocks: 0,
    turnStart: 0,
    blockedThisTurn: new Set(),
    lastBlockAt: 0,
    spokeThisTurn: false,
    toolCallsSinceBlock: 0,
    singleWrites: 0,
    bulkRuns: 0,
    firstPortalWriteAt: null,
    kgClose: { create: 0, sources: new Set(), extract: 0, interpret: 0, read: 0 },
    summaryBoardAfterAll: 0,
    tokens: [],
    hellos: 0,
    prompts: 0,
    closeoutDebt: null,
    debtAdoptedAt: 0,
    debtRefusals: new Map(),
  };

  // A TURN BEGINS AT A USER PROMPT — never at a `stop` row.
  //
  // Measured: the runtime re-enters Stop with stop_hook_active set after a block, and
  // modeStop appends a `stop` row on every invocation. Treating `stop` as a boundary
  // therefore made each re-entry look like a brand-new turn, which cleared the
  // once-per-turn markers and made the Stop advisory repeat on every re-entry — five
  // wasted assistant turns in a live run, each one answering the same notice. Keying on
  // `prompt` alone makes "once per turn" mean "once per user prompt", which is both the
  // intended semantics and strictly the safer direction (fewer blocks, never more).
  // ROW ORDER, NOT THE CLOCK. Ledger timestamps are whole seconds, so a fast turn puts
  // the previous turn's block and the new prompt in the SAME second and a `t >= turnStart`
  // comparison counts the old block as belonging to the new turn — which silently
  // disarmed the gate for that turn. Index is unambiguous.
  st.turnStartIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].k === 'prompt') { st.turnStartIdx = i; st.turnStart = rows[i].t || 0; break; }
  }

  const noteWrite = (tool, ids, t, tu, args) => {
    if (!WRITE_READ_MAP[tool]) return;
    const neg = isDeleteWrite(tool);
    // For a delete the RESPONSE id is the thing that must vanish, and so is the argument.
    const id = (ids && ids[0]) || (args && (args.board_id || args.task_id || args.project_id
      || args.client_id || args.graph_id || args.note_id)) || null;
    const key = tool + '|' + (id || tu || String(t));
    // A write made in THIS session keeps whatever `carried` it already had: a `debt` row
    // adopted earlier in the fold marks the same obligation, and a later re-write of it must
    // not launder a carried debt back into a fresh one.
    const prev = st.obligations.get(key);
    st.obligations.set(key, { w: tool, id, t, tu, neg, carried: Boolean(prev && prev.carried) });
  };
  const clearReads = (tool, ids, sawResponse, heads) => {
    const idset = new Set(ids || []);
    // `heads` are 8-char fingerprints of EVERY marked id in the response, kept because the
    // full id list is capped and a listing can carry hundreds. Position is no guide to which
    // id matters: the just-created row was measured at index 78 of 101 in one listing, so
    // head, tail and both-ends trimming all dropped it and the obligation could never
    // discharge. See harvestIdHeads in canon-lib for why a prefix is safe HERE and is
    // deliberately never fed to the seen set.
    const vouched = (id) => idset.has(id) || L.headsVouchFor(heads, id);
    for (const [key, o] of [...st.obligations]) {
      const maps = WRITE_READ_MAP[o.w] || [];
      if (!maps.includes(tool)) continue;
      if (o.neg) {
        // Absence discharges it. A read that still returns the id proves the delete did
        // not happen, so it deliberately leaves the obligation standing.
        if (sawResponse && (!o.id || !vouched(o.id))) st.obligations.delete(key);
        continue;
      }
      if ((!ids || !ids.length) && (!heads || !heads.length)) continue;
      if (!o.id || vouched(o.id)) st.obligations.delete(key);
    }
  };

  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const t = r.t || 0;
    const inTurn = ri > st.turnStartIdx;
    if (r.k === 'hello') { st.hellos++; if (r.tok) st.tokens.push(r.tok); continue; }
    // The owner's own message is a trusted provenance: an id they typed is an id they have.
    if (r.k === 'prompt') { st.prompts++; (r.ids || []).forEach((i) => st.seen.add(i)); continue; }
    if (r.k === 'note') { if (r.msg === 'spoke' && inTurn) st.spokeThisTurn = true; continue; }
    if (r.k === 'block') {
      st.lastBlockAt = t;
      st.toolCallsSinceBlock = 0;
      if (inTurn) st.blockedThisTurn.add(r.gate);
      if (r.event === 'PostToolUse') st.postBlocks++;
      continue;
    }
    // A refusal this gate already spent, counted per DISTINCT debt so the budget cannot be
    // inherited by a debt that has not had its three chances.
    if (r.k === 'pre' && r.dk) { st.debtRefusals.set(r.dk, (st.debtRefusals.get(r.dk) || 0) + 1); continue; }
    // DEBT ADOPTED FROM DISK. Written by a turn that ended owing something, replayed here so
    // that a brand-new session — one whose ledger SessionEnd wiped — folds to the same state
    // the owing session ended in. Everything downstream then works unchanged: clearReads
    // settles these exactly as it settles a write made ten seconds ago, which is what makes
    // "settle it in one call" true across a session boundary and not just inside one.
    if (r.k === 'debt') {
      if ((r.at || 0) > st.debtAdoptedAt) st.debtAdoptedAt = r.at || 0;
      // A debt row REPLACES the carried set rather than adding to it. Each row is a complete
      // statement of what a turn ended owing, so a later row that omits an obligation is
      // saying it is settled — which is how an owner's `run-close` tombstone, and an ordinary
      // turn that settled half its debts, both reach a session that already adopted the older
      // list. Obligations from this session's own writes are untouched; only adopted ones are
      // superseded, or a real unverified write would be laundered away by a stale row.
      const keep = new Set();
      for (const o of (r.rb || [])) {
        if (!o || !o.w || !o.id || !WRITE_READ_MAP[o.w]) continue;
        const key = o.w + '|' + o.id;
        keep.add(key);
        const prev = st.obligations.get(key);
        st.obligations.set(key, {
          w: o.w, id: o.id, t: (prev && prev.t) || t, tu: o.tu || null,
          neg: Boolean(o.neg), carried: true,
        });
      }
      for (const [k, o] of [...st.obligations]) if (o.carried && !keep.has(k)) st.obligations.delete(k);
      st.closeoutDebt = (r.co && r.co.length) ? { ids: r.co, run: r.corun || null, at: r.at || t } : null;
      continue;
    }
    if (r.k === 'mode') { if (r.mode) st.mode = r.mode; if (r.channel) st.channel = r.channel; continue; }
    // `boundary` ('milestone' | 'phase') is carried, not dropped: the P5 reason renders it,
    // and dropping it made every CANON-JOURNAL-PHASE refusal open with the literal word
    // "undefined". A reason that reads as a template is exactly what teaches the model to
    // treat these refusals as injected text rather than as facts about its own call.
    if (r.k === 'phase') { st.phaseBoundaries.push({ boundary: r.boundary || 'phase', id: r.id, status: r.status, t }); continue; }
    if (r.k !== 'post' && r.k !== 'bulk') continue;

    st.toolCallsSinceBlock++;

    const apply = (tool, ids, ok, args, heads) => {
      if (!tool) return;
      ids = ids || [];
      const a = args || {};

      // PROVENANCE. An id is not "seen" because some process printed it; it is seen
      // because THE PORTAL RETURNED IT, or because the owner typed it.
      //
      // The seen set used to be harvested from EVERY tool response, so `echo "id: <uuid>"`
      // promoted a fabricated id to trusted in one Bash call and CANON-ID waved the write
      // through — measured. Splitting the set by where the id came from is the whole fix,
      // and it costs nothing: a foreign id is still recorded, so a refusal can say exactly
      // which tool did print it instead of claiming it was never seen at all.
      //
      // The inner calls of a `bulk` are portal calls, and their ids land here too. They
      // did not before — apply() never touched st.seen and a bulk row carries no top-level
      // ids — so `bulk([create_task])` followed by `update_task(<the new id>)` was REFUSED
      // for an id the portal had just issued. The canon tells the model to batch; that was
      // a live trap on the path the canon points at.
      if (isPortalTool(tool)) ids.forEach((i) => st.seen.add(i));
      else ids.forEach((i) => { if (!st.seen.has(i) && !st.seenForeign.has(i)) st.seenForeign.set(i, tool); });
      if (tool === 'read_channel_policy') st.policy.policy = true;
      if (tool === 'read_channel_messages') st.policy.messages = true;
      if (tool === 'list_subtasks' && a.parent_task_id) {
        const set = st.subtasks.get(a.parent_task_id) || new Set();
        // Integers are harvested WIDE from responses, and a subtask listing says "1200
        // minutes logged" as readily as it says an id. A false id in the SEEN set only
        // weakens CANON-ID; a false CHILD here is a refusal nothing can clear, because
        // there is no such subtask to complete. Children are uuid/slug shaped only.
        ids.forEach((i) => { if (i !== a.parent_task_id && !/^\d+$/.test(i)) set.add(i); });
        st.subtasks.set(a.parent_task_id, set);
      }
      if (tool === 'complete_task' && a.task_id) st.completed.add(a.task_id);
      if (tool === 'create_task') st.tree.task++;
      if (tool === 'create_subtask') st.tree.subtask++;
      if (tool === 'create_flow_cluster') st.tree.cluster++;
      if (tool === 'create_flow_connection') st.tree.connection++;
      if (tool === 'create_board') { st.board.board++; st.summaryBoardAfterAll++; }
      if (tool === 'create_board_block' && String(a.type || '').toLowerCase() === 'mermaid') st.board.mermaid++;
      if (tool === 'read_board' || tool === 'list_board_blocks') st.board.read++;
      if (/knowledge_graph/.test(tool)) ids.forEach((i) => st.graphIds.add(i));
      if (tool === 'create_knowledge_graph') st.kgClose.create++;
      if (tool === 'add_source_to_knowledge_graph' && a.source_type) st.kgClose.sources.add(a.source_type);
      if (tool === 'extract_knowledge_graph') st.kgClose.extract++;
      if (tool === 'interpret_knowledge_graph') st.kgClose.interpret++;
      if (tool === 'get_knowledge_graph' || tool === 'semantic_search_knowledge_graph') st.kgClose.read++;
      if (tool === 'create_journal' || tool === 'update_journal') st.journalWrites.push({ t, idx: ri, folder: a.folder_id || null });
      if (/^(get_journal|list_journals|search_journals)$/.test(tool)) st.journalReads.push({ t });

      if (isPortalWrite(tool)) {
        st.portalWriteTimes.push(t);
        if (st.firstPortalWriteAt === null) st.firstPortalWriteAt = t;
      }
      if (ok !== false) { noteWrite(tool, ids, t, r.tu, a); clearReads(tool, ids, true, heads); }
    };

    if (r.k === 'bulk') {
      st.bulkRuns++;
      // The bulk's own fingerprints cover every inner response at once, so a read batched
      // into a bulk discharges exactly like a direct one. That symmetry is required, not
      // nice-to-have: canon (f) tells the agent to batch, and a debt that only unbatched
      // reads could settle punished the behaviour the canon asks for.
      const bulkHeads = r.idh || [];
      // The coarse channel first (see the `ids` note in modePost). A bulk IS a portal call,
      // so everything it returned is portal-issued and belongs in seen even when the
      // per-item split came back empty — which is exactly the state every bulk row written
      // before this fix is in, and those rows are still on disk being folded.
      (r.ids || []).forEach((i) => st.seen.add(i));
      for (const it of (r.inner || [])) apply(it.tool, it.ids, it.ok, it.args || {}, bulkHeads);
      // A write and its mapped read inside ONE bulk open-and-clear together — that is
      // canon (f) being obeyed correctly and must never block.
    } else {
      apply(r.tool, r.ids, r.ok, r.args || {}, r.idh || []);
      if (isPortalWrite(r.tool)) st.singleWrites++;
    }
  }
  return st;
}

function lastBoundary(st) {
  return st.phaseBoundaries.length ? st.phaseBoundaries[st.phaseBoundaries.length - 1] : null;
}

/**
 * The ONE call that settles a set of read-back obligations, or null when there isn't one.
 *
 * Null is not a formatting detail, it is the safety interlock: an obligation whose write has
 * no mapped read cannot be settled by any call the model could make, so it must never be
 * allowed to refuse anything. Every caller treats null as "say nothing, refuse nothing".
 *
 * This was three near-identical inline copies (PostToolUse, Stop, and now the card and the
 * prompt); one copy means the string the card publishes and the string the block demands
 * cannot drift into naming different calls.
 */
function settleCall(open) {
  const reads = [];
  for (const o of (open || []).slice(0, 8)) {
    const map = WRITE_READ_MAP[o.w] || [];
    if (map[0]) reads.push(map[0] + '(' + (o.id ? '"' + o.id + '"' : '…') + ')');
  }
  if (!reads.length) return null;
  return reads.length > 1 ? 'bulk([' + reads.join(', ') + '])' : reads[0];
}

/** Obligations that outlived the turn they were made in. */
function carriedDebt(st) {
  return [...st.obligations.values()].filter((o) => o.carried && (WRITE_READ_MAP[o.w] || [])[0]);
}

/**
 * What the close-out is still missing, as {id, text}.
 *
 * The id is stable and the text is not — "seen: 2" becomes "seen: 3" the moment a source is
 * added. The carried debt stores ids and renders text from the LIVE fold, so a debt can only
 * ever shrink: what was owed at the turn end, intersected with what is still absent now.
 * Storing the rendered text instead would have made a partially-completed close-out
 * unsettleable, because no stored string would ever match the live one again.
 */
function closeoutMissing(st) {
  const miss = [];
  if (!st.summaryBoardAfterAll) miss.push({ id: 'board', text: 'the (b) summary board — create_board + at least one create_board_block' });
  if (!st.kgClose.create) miss.push({ id: 'kg-create', text: 'create_knowledge_graph' });
  if (st.kgClose.sources.size < 3) miss.push({ id: 'kg-sources', text: 'add_source_to_knowledge_graph covering journal folder, note, board, project, task and a tag (seen: ' + (st.kgClose.sources.size || 'none') + ')' });
  if (!st.kgClose.extract) miss.push({ id: 'kg-extract', text: 'extract_knowledge_graph' });
  if (!st.kgClose.interpret) miss.push({ id: 'kg-interpret', text: 'interpret_knowledge_graph' });
  if (!st.kgClose.read) miss.push({ id: 'kg-read', text: 'a get_knowledge_graph / semantic_search_knowledge_graph read-back' });
  if (!st.journalWrites.length || !st.journalReads.length) miss.push({ id: 'journal', text: 'a final journal entry and a read-back of it' });
  return miss;
}

/** What the close-out debt still demands: owed at the turn end AND still absent now. */
function closeoutOwed(st) {
  if (!st.closeoutDebt) return [];
  const want = new Set(st.closeoutDebt.ids || []);
  return closeoutMissing(st).filter((m) => want.has(m.id));
}

/** One debt, one budget. Distinct debts get distinct budgets; the same debt does not. */
function debtKey(kind, parts) {
  return kind + ':' + L.sha1([...parts].sort().join('|')).slice(0, 10);
}

// ---------------------------------------------------------------------------
// The canon card (§2.8) — the only place clearing actions and escapes are published,
// and the liveness proof: no card means no gates.
// ---------------------------------------------------------------------------

/**
 * THE CARD IS ASSEMBLED IN THREE PARTS BECAUSE A BLIND slice() TRUNCATES THE ESCAPE.
 *
 * It used to be one array and `card.slice(0, 2580)`, which is fine right up until the card
 * grows — and then the first thing off the end is the STAND DOWN block, i.e. the only text
 * telling the owner how to turn any of this off. The gate list is the part that can afford
 * to lose a line, so the head (liveness token, run, carried debt) and the tail (the escape)
 * are never trimmed and the middle is.
 */
const CARD_CAP = 3000;

function buildCard(run, st, token) {
  const head = [];
  head.push('[portal-canon v1 · alive · token ' + token + ']');

  if (!run || run.state === 'CLOSED') {
    head.push(run ? ('run ' + run.run_id + ' closed (' + (run.close_reason || 'closed') + ')') : 'no run declared');
  } else {
    // Client and project names come from the owner and have no length limit; an unbounded
    // head can eat a budget the escape is supposed to be paid out of.
    const nm = (s) => { const v = String(s || '?'); return v.length > 60 ? v.slice(0, 57) + '…' : v; };
    head.push('run ' + run.run_id + ' · ' + nm(run.client) + '/' + nm(run.project)
      + ' · state ' + run.state
      + (run.journal_folder ? ' · journal folder "' + nm(run.journal_folder.name || run.journal_folder.id) + '"' : ' · no journal folder')
      + ' · blocks spent ' + L.blocksSpent(run));
  }

  // THE CARRIED DEBT, AT THE TOP, WITH THE CALL THAT SETTLES IT.
  //
  // This is the channel that has to work. A refusal reason states facts and carries no
  // instructions, by measured necessity — so if the first action of a cold return is going
  // to be refused, the model must already know what settles it before it makes that action.
  // additionalContext on SessionStart and UserPromptSubmit is where an instruction is read
  // as an instruction, and both fire before any tool call of the turn.
  if (st) {
    const carried = carriedDebt(st);
    const call = settleCall(carried);
    const owed = closeoutOwed(st);
    if (carried.length && call) {
      head.push('DEBT CARRIED IN — a turn ended with ' + carried.length + ' write(s) never read back: '
        + carried.slice(0, 4).map((o) => o.w).join(', ') + '.');
      head.push('  ONE CALL SETTLES IT — make this your first tool call: ' + call);
    }
    if (owed.length) {
      head.push('DEBT CARRIED IN — the close-out is unmade. Still absent: '
        + owed.map((m) => m.id).join(', ') + '. Work is refused until these exist:');
      head.push('  ' + owed.map((m) => m.text).join('; '));
    }
    if ((carried.length && call) || owed.length) {
      head.push('  Until then only READS proceed. Each debt refuses ' + DEBT_BUDGET
        + ' times and then stands itself down.');
    }
  }

  const gates = ['GATES — each refuses ONE thing, and clears one way:'];
  for (const [id, what, clears] of REGISTER) {
    const a = L.gateArmed(id, run);
    gates.push('· ' + id + (a.armed ? '' : ' [STOOD DOWN: ' + a.why + ']') + ' — ' + what + ' — CLEARS BY: ' + clears);
  }

  const tail = [];
  tail.push(ADVISORY_ONLY);
  tail.push('STAND DOWN (any one works, all are honoured mid-session):');
  tail.push(' 1) Bash: ' + standDownLine('<GATE-ID|all>'));
  tail.push(' 2) type /portal-stand-down [gate] [reason]');
  tail.push(' 3) set PORTAL_CANON=off (or =advisory) and restart the session');
  tail.push('Gates judge STRUCTURE, never quality. They cannot tell whether a brief is good.');

  const marker = (n) => '· …' + n + ' more gate(s) — `node canon-gate.js doctor` lists them all.';
  const fixed = head.join('\n').length + tail.join('\n').length + 2;
  const gatesLen = gates.reduce((a, l) => a + l.length + 1, 0);
  let kept = gates;
  if (gatesLen > CARD_CAP - fixed) {
    // THE MARKER HAS TO COME OUT OF THE BUDGET, NOT OUT OF THE TAIL. Adding it after the
    // budget was spent pushed the card back over the cap and the final slice() then ate the
    // last line of the escape block — the exact failure this restructure exists to prevent,
    // reproduced by its own first test run.
    let budget = CARD_CAP - fixed - (marker(99).length + 1);
    kept = [];
    let dropped = 0;
    for (const line of gates) {
      if (line.length + 1 <= budget) { kept.push(line); budget -= line.length + 1; }
      else dropped++;
    }
    kept.push(marker(dropped));
  }

  let card = head.concat(kept, tail).join('\n');
  // Last resort only — reachable solely if the head alone overruns the cap, which the name
  // clamp above makes very hard. It stays because "very hard" is not "impossible".
  if (card.length > CARD_CAP) card = card.slice(0, CARD_CAP - 20) + '\n…(truncated)';
  return card;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * Replay the project's carried debt into THIS session's ledger, once.
 *
 * Called only from SessionStart and UserPromptSubmit — both fire before any tool call of a
 * turn and neither is on the hot path, so the PreToolUse gate pays nothing for this: by the
 * time it runs, the debt is already an ordinary ledger row that fold() reads like any other.
 *
 * Idempotent by TIMESTAMP rather than by a flag written back to disk: a row is appended only
 * when the debt on disk is newer than the newest debt row already folded, so re-adopting the
 * same debt on every prompt of a long session cannot grow the ledger.
 *
 * `rows` is mutated so the caller's fold sees the adoption without a second full read of a
 * ledger that can be tens of thousands of lines.
 */
function adoptDebt(key, payload, rows) {
  const debt = L.readDebt(payload.cwd);
  if (!debt) return null;
  let newest = 0;
  for (const r of rows) if (r.k === 'debt' && (r.at || 0) > newest) newest = r.at || 0;
  if (!((debt.at || 0) > newest)) return debt;
  const row = {
    v: 1, t: L.nowS(), k: 'debt', s: key, a: payload.agent_id || null,
    at: debt.at, rb: debt.rb || [], co: debt.co || [], corun: debt.corun || null,
  };
  L.append(key, row);
  rows.push(row);
  return debt;
}

/** The debt notice, in the one voice the model treats as instructions rather than as text. */
function debtNotice(st) {
  const bits = [];
  const carried = carriedDebt(st);
  const call = settleCall(carried);
  if (carried.length && call) {
    bits.push('[portal-canon] DEBT CARRIED IN: ' + carried.length + ' write(s) from an earlier turn '
      + 'were never read back — ' + carried.slice(0, 4).map((o) => o.w).join(', ') + '. '
      + 'Work is refused until they are settled; reads are not.');
    bits.push('ONE CALL SETTLES IT — make this your first tool call: ' + call);
  }
  const owed = closeoutOwed(st);
  if (owed.length) {
    bits.push('[portal-canon] DEBT CARRIED IN: the close-out is unmade. Still absent — '
      + owed.map((m) => m.text).join('; ') + '. Work is refused until those calls are made; '
      + 'batch them in one `bulk` where they do not depend on each other.');
  }
  return bits;
}

function modeSessionStart(payload) {
  L.sweep();
  const key = L.sessionKey(payload);
  const run = L.resolveRun(payload.cwd);
  const token = require('crypto').randomBytes(3).toString('hex');
  L.append(key, {
    v: 1, t: L.nowS(), k: 'hello', s: key, a: payload.agent_id || null,
    tok: token, run: run ? run.run_id : null, cwd_hash: L.projHash(payload.cwd), cc: payload.version || null,
  });
  if (L.canonMode() === 'off') quiet();
  const rows = L.readFamily(key);
  adoptDebt(key, payload, rows);
  const st = fold(rows, run);
  speak(buildCard(run, st, token), 'SessionStart');
}

function modePrompt(payload) {
  const key = L.sessionKey(payload);
  const ids = L.harvestSeen(payload.prompt || '');
  if (L.canonMode() === 'off') {
    L.append(key, { v: 1, t: L.nowS(), k: 'prompt', s: key, a: payload.agent_id || null, ids });
    quiet();
  }

  const run = L.resolveRun(payload.cwd);
  // ADOPT BEFORE THE PROMPT ROW. fold() calls the newest `prompt` row the start of the
  // current turn, so a debt row appended after it would fold as an obligation created THIS
  // turn — and a debt that looks like this turn's own work refuses nothing. Order is the
  // whole discriminator; there is no clock involved and no second read of the ledger.
  const rows = L.readFamily(key);
  adoptDebt(key, payload, rows);
  const promptRow = { v: 1, t: L.nowS(), k: 'prompt', s: key, a: payload.agent_id || null, ids };
  L.append(key, promptRow);
  rows.push(promptRow);
  const st = fold(rows, run);

  const bits = debtNotice(st);
  if (run && run.state !== 'CLOSED') {
    const done = st.phaseBoundaries.length;
    bits.push('[portal-canon] run ' + run.run_id + ' · ' + (run.client || '?') + '/' + (run.project || '?')
      + ' · state ' + run.state + ' · phase boundaries recorded ' + done
      + (run.journal_folder ? ' · journal "' + (run.journal_folder.name || run.journal_folder.id) + '"' : '')
      + ' · blocks spent ' + L.blocksSpent(run));
    if (st.obligations.size) {
      bits.push('unverified writes right now: ' + st.obligations.size
        + ' (' + [...st.obligations.values()].slice(0, 4).map((o) => o.w).join(', ') + ')');
    }
  }
  const downs = [];
  if (L.sentinel('STAND-DOWN')) downs.push('ALL GATES');
  for (const [id] of REGISTER) if (L.sentinel('STAND-DOWN-' + id)) downs.push(id);
  if (run && run.degraded) for (const g of Object.keys(run.degraded)) downs.push(g + ' (' + run.degraded[g] + ')');
  if (downs.length) bits.push('[portal-canon] stood down: ' + downs.join('; '));

  if (!bits.length) quiet();
  let text = bits.join('\n');
  // The settling call is the payload of this message; a cap that could cut it off would
  // leave a refusal the model has no named way out of.
  if (text.length > 1400) text = text.slice(0, 1390) + '…';
  speak(text, 'UserPromptSubmit');
}

// --- PreToolUse -------------------------------------------------------------

/**
 * BOARD_FIRST_GATED — the writes that commit the shape of the work to the record.
 *
 * create_subtask and insert_diagram were missing, and both are holes you can drive the
 * whole gate through: a run in ALIGN could build the entire tree one create_subtask at a
 * time, or paste the roadmap diagram straight into the proposal, without ever making the
 * alignment board this gate exists to demand.
 */
const BOARD_FIRST_GATED = new Set(['update_brief', 'update_brief_field', 'create_proposal',
  'add_proposal_phase', 'add_proposal_milestone', 'create_task', 'create_subtask', 'insert_diagram']);

/**
 * Paths CANON-TREE-FIRST has no business refusing.
 *
 * Broadening the gate from "the Write tool" to "anything that writes a file" drags in
 * every dependency install and build output that happens to land inside the project, and
 * a gate that refuses `npm install` would burn its credit in one turn on something the
 * canon never had an opinion about. Docs and this plugin's own tree were already exempt.
 */
const TREE_FIRST_EXEMPT = new RegExp(
  '(^|[\\\\/])(node_modules|\\.git|\\.venv|venv|__pycache__|dist|build|out|coverage'
  + '|\\.next|\\.expo|\\.turbo|target|\\.pytest_cache|\\.mypy_cache|\\.cache)([\\\\/]|$)'
  + '|\\.(md|log|tmp|lock)$'
  + '|(^|[\\\\/])(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|poetry\\.lock)$'
  + '|agent-onboarding|management-portal-canon', 'i');

/** How a refusal refers to the call it is refusing — truthfully, inside a bulk or not. */
function callSite(c) {
  const name = c.bare || c.raw;
  if (!c.at) return 'This ' + name + ' call';
  return 'Call [' + c.at.i + '] of this ' + c.at.n + '-call bulk — ' + name + ' —';
}

/** The concrete thing this call was seen to do. Never a guess, never a template. */
function effectEvidence(c) {
  if (c.effect.targets.length) return 'that writes ' + c.effect.targets[0].path;
  const m = c.effect.mutation;
  if (m && m.kind === 'program') return 'whose command line runs ' + m.evidence;
  if (m && m.kind === 'redirect') return 'whose command line redirects output into a file';
  return '';
}

/**
 * The same evidence as a standalone noun phrase, for reasons that say "<site> is <this>".
 *
 * effectEvidence() is a RELATIVE clause — "that writes x.ts" — and reads as broken grammar
 * the moment it is dropped in after "is". A refusal that reads like a mangled template is
 * how a reason stops being believed, which this file has already measured twice.
 */
function workPhrase(c) {
  if (c.portalWrite) return 'a portal write';
  if (c.effect.targets.length) return 'a call that writes ' + c.effect.targets[0].path;
  const m = c.effect.mutation;
  if (m && m.kind === 'program') return 'a call whose command line runs ' + m.evidence;
  if (m && m.kind === 'redirect') return 'a call whose command line redirects output into a file';
  return 'a mutating call';
}

/**
 * ONE CALL, EVERY GATE. Returns { gate, reason } or null.
 *
 * This used to be eight `if` blocks inline in modePre, which is why `bulk` defeated all
 * eight of them: `isPortalWrite('bulk')` is false, nothing looked at `tool_input.calls`,
 * and the meta-tool sailed past every gate carrying the exact call each one would have
 * refused. Measured on all six: create_task with a fabricated id, complete_task,
 * regenerate_knowledge_graph, create_proposal in ALIGN, a post-boundary write, and a
 * participant write — ALLOW inside bulk, DENY when called directly.
 *
 * That mattered more than its blast radius. The canon TELLS the agent to use `bulk`, and
 * CANON-BULK advises it at every turn end; the one hole the gates could not see is the one
 * the discipline actively steers into. Pulling the decision into a function that takes a
 * call — any call, from anywhere — is what makes "the gates apply to bulk" true by
 * construction rather than by another eight edits somebody has to remember.
 */
function evaluateCall(ctx, c) {
  const { st, run, isRun, armed } = ctx;
  const site = callSite(c);

  // ---- P0 THE CARRIED DEBT — the "after any action" half, enforced before the next one ----
  //
  // FIRST, DELIBERATELY. The gates below judge this call on its merits; these two say no
  // call is reachable on its merits yet, because a turn already ended owing something. Put
  // last, a debt refusal would hide behind whichever other gate happened to fire, and the
  // model would be told about an id while the real reason it cannot proceed went unnamed.
  //
  // `work` is the whole scope: a portal write, a file write, or a command line that mutates
  // — the same three effects the rest of this file gates, judged the same way. READS ARE
  // NOT WORK AND ARE NEVER REFUSED, which is not a kindness: a read is how a read-back debt
  // is settled, and a gate that can refuse its own settling call is a latch, not a gate.
  const work = c.portalWrite || c.fileWrite || c.mutates;

  // THE OWNER'S OWN SETTLEMENT, HONOURED MID-SESSION LIKE EVERY OTHER ESCAPE HERE.
  // `run-close` is published as escape (4) in this file's header, and it was NOT turning:
  // it deleted the debt file, but the debt had already been replayed into the session ledger
  // and the fold went on reconstructing it from there. A published escape that only works in
  // the next session is a published escape that does not work. It rides on the run manifest,
  // which modePre has already read, so honouring it costs nothing.
  const settled = run && run.debt_settled_at && run.debt_settled_at >= st.debtAdoptedAt;

  if (work && !settled && !OTHER_GATE_KEYS.has(c.bare) && armed('CANON-DEBT-READ-BACK')) {
    const carried = carriedDebt(st);
    // A settling call must exist, or this could refuse work nothing could ever release.
    if (carried.length && settleCall(carried)) {
      const dk = debtKey('rb', carried.map((o) => o.w + '|' + o.id));
      if ((st.debtRefusals.get(dk) || 0) < DEBT_BUDGET) {
        const named = carried.slice(0, 4).map((o) => o.w + ' (id ' + o.id + ')').join(', ');
        return { gate: 'CANON-DEBT-READ-BACK', dk, reason:
          // "IN THIS PROJECT", NOT "IN THIS SESSION". Debt is keyed by project and survives a
          // session, so on a cold return "this session" would be a plain untruth about the
          // call — and a reason is believed exactly as far as it is true. Measured twice.
          '[portal-canon CANON-DEBT-READ-BACK] Refused. A turn in this project ended with '
          + carried.length + ' portal write(s) whose mapped read never came back: ' + named + '. ' + site
          + ' is ' + workPhrase(c)
          + ', not one of the reads that would settle them. Canon (Gate 1): a write that returned is '
          + 'not a write that persisted, so until the record has been read back the state of that '
          + 'write is unknown, and anything built on top of it rests on an assumption. This gate '
          + 'compares the writes in the tool stream against their mapped reads. It does not judge '
          + 'this call\'s content. The notice on the prompt that opened this turn names the single '
          + 'read that settles each one.' };
      }
    }
  }

  if (work && !settled && st.closeoutDebt && armed('CANON-DEBT-CLOSEOUT')
      && !CLOSEOUT_CLEARING.has(c.bare) && !OTHER_GATE_KEYS.has(c.bare)
      && run && run.state !== 'CLOSED'
      && (!st.closeoutDebt.run || st.closeoutDebt.run === run.run_id)) {
    const owed = closeoutOwed(st);
    if (owed.length) {
      const dk = debtKey('co', [st.closeoutDebt.run || '?'].concat(owed.map((m) => m.id)));
      if ((st.debtRefusals.get(dk) || 0) < DEBT_BUDGET) {
        return { gate: 'CANON-DEBT-CLOSEOUT', dk, reason:
          '[portal-canon CANON-DEBT-CLOSEOUT] Refused. Every phase of this project\'s declared work '
          + 'reads as terminal, and a turn ended with the close-out unmade. These are still '
          + 'absent from the tool stream:\n' + owed.map((m) => '  · ' + m.text).join('\n') + '\n'
          + site + ' is ' + workPhrase(c)
          + ' and is none of them. Canon (b): the close-out is what makes finished work findable '
          + 'again — the summary board, the knowledge graph and the final journal are the record '
          + 'that outlives the session, and work done past a missing close-out is work nobody will '
          + 'find. This gate compares those artifacts against the tool stream. It does not judge '
          + 'them. The notice on the prompt that opened this turn names the calls that make them.' };
      }
    }
  }

  // ---- P1 CANON-ID ----
  if (c.portalWrite && armed('CANON-ID') && !ctx.coldStart) {
    const cand = L.harvestArgIds(c.input);
    const known = new Set(st.seen);
    if (run) for (const v of [run.project_id, run.proposal_id, run.channel]) if (v) known.add(String(v).toLowerCase());
    if (run && run.journal_folder && run.journal_folder.id) known.add(String(run.journal_folder.id).toLowerCase());
    const unseen = cand.filter((x) => !known.has(x.id));
    if (unseen.length) {
      const u = unseen[0];
      const from = st.seenForeign.get(u.id) || null;
      return { gate: 'CANON-ID', reason:
        '[portal-canon CANON-ID] Refused. ' + site + ' carries the id ' + u.id
        + (u.key ? ' under `' + u.key + '`' : '') + ', which '
        + (from
          ? 'has appeared in this session only in the output of ' + from
            + ', and in no management-portal tool result and no message from you'
          : 'has not appeared in any management-portal tool result, and in no message from you, '
            + 'in this session')
        + '. Canon: every id must come from a list_*/get_* read or a create_* response; a wrong id '
        + 'silently writes to the wrong record. This gate compares the ids in this call\'s arguments '
        + 'against the ids the portal has actually returned to this session. It does not judge the '
        + 'call\'s content. Gate CANON-ID is listed on the canon card issued at session start.' };
    }
  }

  // ---- P2 CANON-BOTTOM-UP ----
  if (c.bare === 'complete_task' && armed('CANON-BOTTOM-UP')) {
    const tid = c.input.task_id;
    if (tid) {
      const listed = st.subtasks.get(tid);
      if (!listed) {
        return { gate: 'CANON-BOTTOM-UP', reason:
          '[portal-canon CANON-BOTTOM-UP] Refused. ' + site + ' targets task ' + tid
          + ', and no list_subtasks(parent_task_id="' + tid + '") response appears in this session. '
          + 'Canon: completion runs bottom-up — subtasks before tasks before milestones — so a parent '
          + 'cannot be known complete while its children are unread. This gate checks the tool stream '
          + 'for that read. It does not judge whether the work is done.' };
      }
      const openChild = [...listed].find((x) => !st.completed.has(x));
      if (openChild) {
        return { gate: 'CANON-BOTTOM-UP', reason:
          '[portal-canon CANON-BOTTOM-UP] Refused. ' + site + ' targets task ' + tid
          + ', whose subtask ' + openChild + ' was listed in this session and has no complete_task '
          + 'recorded against it. Canon: completion runs bottom-up — subtasks before tasks before '
          + 'milestones. This gate compares listed children against completed children. It does not '
          + 'judge whether the work is done.' };
      }
    }
  }

  // ---- P3 CANON-COORD-ROLE ----
  if (c.mutates && st.mode === 'coordinator' && armed('CANON-COORD-ROLE')) {
    return { gate: 'CANON-COORD-ROLE', reason:
      '[portal-canon CANON-COORD-ROLE] Refused. This session holds the coordinator title'
      + (st.channel ? ' on channel ' + st.channel : '') + ' and this is a ' + c.raw + ' call '
      + effectEvidence(c) + '. Canon: the coordinator counsels '
      + 'and coordinates on the owner\'s behalf and does not implement; implementation belongs to the '
      + 'participants it directs. This gate reads what the call does — the file it writes, or the '
      + 'program its command line runs — not which tool carried it. It does not judge the change.' };
  }

  // ---- P4 CANON-POLICY-FIRST ----
  if ((c.portalWrite || c.fileWrite) && st.mode === 'participant' && armed('CANON-POLICY-FIRST')) {
    if (!st.policy.policy || !st.policy.messages) {
      const missing = [!st.policy.policy ? 'read_channel_policy' : null,
        !st.policy.messages ? 'read_channel_messages' : null].filter(Boolean).join(' and ');
      return { gate: 'CANON-POLICY-FIRST', reason:
        '[portal-canon CANON-POLICY-FIRST] Refused. This session joined'
        + (st.channel ? ' channel ' + st.channel : ' a channel') + ' as a participant, this is the '
        + 'first ' + (c.bare || c.raw) + ' call of the run, and no ' + missing
        + ' response appears in this session. Canon: a participant reads the policy and the messages '
        + 'before it acts, because the coordinator\'s standing instructions live there. This gate '
        + 'checks the tool stream for those two reads. It does not judge the policy.' };
    }
  }

  // ---- P5 CANON-JOURNAL-PHASE ----
  // JOURNAL_CLEARING is excluded, or this gate refuses the very call it demands. See the
  // set's own comment; the pair of tests that hold it down are in canon-selftest.js.
  if (c.portalWrite && !JOURNAL_CLEARING.has(c.bare) && isRun && run.state === 'RUN'
      && armed('CANON-JOURNAL-PHASE')) {
    const b = lastBoundary(st);
    if (b) {
      const folder = run.journal_folder && run.journal_folder.id;
      const wrote = st.journalWrites.some((j) => j.t >= b.t && (!folder || j.folder === folder));
      const read = st.journalReads.some((j) => j.t >= b.t);
      if (!wrote || !read) {
        const missing = [!wrote ? 'no create_journal/update_journal' : null,
          !read ? 'no get_journal/list_journals/search_journals' : null].filter(Boolean).join(' and ');
        return { gate: 'CANON-JOURNAL-PHASE', reason:
          '[portal-canon CANON-JOURNAL-PHASE] Refused. A phase boundary was recorded in this session '
          + '(' + b.boundary + (b.id ? ' ' + b.id : '') + ' → status "' + b.status + '") and since that boundary '
          + 'there is ' + missing + ' in the tool stream'
          + (folder ? ' for journal folder ' + folder : '') + '. ' + site + ' is a portal write. '
          + 'Canon (d): the journal is written '
          + 'after every phase with what was learnt and what must be returned to, and it is read back. '
          + 'This gate checks that both halves happened after the boundary. It does not read the entry.' };
      }
    }
  }

  // ---- P6 CANON-KG-DESTRUCTIVE ----
  if (c.portal && armed('CANON-KG-DESTRUCTIVE') && isRun && run.state === 'RUN') {
    const gid = c.input.graph_id || null;
    // delete_knowledge_graph destroys strictly more than regenerate does and was ungated.
    const deletes = c.bare === 'delete_knowledge_graph';
    const destructive = deletes || c.bare === 'regenerate_knowledge_graph'
      || (c.bare === 'generate_knowledge_graph' && gid && st.graphIds.has(String(gid).toLowerCase()));
    if (destructive && !L.sentinel('ALLOW-KG-REGEN-' + run.run_id)) {
      return { gate: 'CANON-KG-DESTRUCTIVE', reason:
        '[portal-canon CANON-KG-DESTRUCTIVE] Refused. ' + site
        + (gid ? ' targets graph ' + gid + ', which already appears in this session, and' : '')
        + (deletes
          ? ' deleting a graph destroys its nodes and edges along with it, and they are not recoverable '
            + 'from the portal. remove_source_from_knowledge_graph narrows a graph without destroying it. '
          : ' regeneration destroys the graph\'s existing nodes and edges before rebuilding them. '
            + 'extract_knowledge_graph is the incremental path that adds to a graph instead. ')
        + 'No owner instruction authorising destruction is recorded for run ' + run.run_id + '. This gate '
        + 'checks for that authorisation. It does not judge the graph.' };
    }
  }

  // ---- P7 CANON-TREE-FIRST ----
  //
  // WAS: `if (edit && …)`, where `edit` meant the four tool names Write/Edit/MultiEdit/
  // NotebookEdit. Measured ALLOW into a gated project, all of them writing real source:
  // `cat > f <<EOF`, `sed -i`, `python -c open(…,'w')`, `tee`, the stock `PowerShell` tool,
  // and mcp__Desktop_Commander__write_file / edit_block. The gate is not about a tool. It
  // is about a file inside the project changing before the decomposition exists.
  if (c.fileWrite && isRun && armed('CANON-TREE-FIRST')) {
    const projDir = ctx.projDir;
    for (const target of c.effect.targets) {
      // normTarget, not normPath: the file usually does not exist yet, and an unresolved
      // 8.3 short name never startsWith a resolved project dir. See canon-lib.js.
      const n = L.normTarget(target.path).value || '';
      if (!projDir || !n || !n.startsWith(projDir)) continue;
      if (TREE_FIRST_EXEMPT.test(n)) continue;
      const miss = [];
      if (!st.tree.task) miss.push('create_task');
      if (!st.tree.subtask) miss.push('create_subtask');
      if (!st.tree.cluster) miss.push('create_flow_cluster');
      if (!st.tree.connection) miss.push('create_flow_connection');
      if (!miss.length) break;
      return { gate: 'CANON-TREE-FIRST', reason:
        '[portal-canon CANON-TREE-FIRST] Refused. This ' + c.raw + ' call writes ' + target.path
        + (target.via ? ' (via ' + target.via + ')' : '')
        + ' inside the project of run ' + run.run_id + ', and this run has no recorded '
        + miss.join(', ') + '. Canon (Gate 3): the task/subtask tree and the flow board come '
        + 'before implementation entities, because a decomposition written after the code merely '
        + 'describes it. This gate counts those four calls in the tool stream and reads the write '
        + 'target out of this call. It does not judge the decomposition.' };
    }
  }

  // ---- P8 CANON-BOARD-FIRST ----
  if (c.portal && BOARD_FIRST_GATED.has(c.bare) && isRun && run.state === 'ALIGN'
      && armed('CANON-BOARD-FIRST')) {
    const miss = [];
    if (!st.board.board) miss.push('create_board');
    if (!st.board.mermaid) miss.push('create_board_block(type:"mermaid")');
    if (!st.board.read) miss.push('read_board');
    if (miss.length) {
      return { gate: 'CANON-BOARD-FIRST', reason:
        '[portal-canon CANON-BOARD-FIRST] Refused. Run ' + run.run_id + ' is in state ALIGN, '
        + site.replace(/^This /, 'this is a ').replace(/ call$/, ' call') + ', and the run has no '
        + 'recorded ' + miss.join(', ') + '. Canon: for '
        + 'non-trivial work an alignment board with diagrams comes before the brief, the proposal and '
        + 'the task tree, so the human aligns on the shape before it is written down. Board-first '
        + 'governs initiation only; it is inert once the run is promoted to RUN. This gate checks for '
        + 'those calls. It does not judge the diagram.' };
    }
  }

  return null;
}

/**
 * Replay one bulk inner call's effect onto the fold, so the NEXT inner call is judged
 * against a batch that really did run in this order.
 *
 * Without this, `bulk([create_board, create_board_block(mermaid), read_board,
 * create_proposal])` — canon (f) and board-first obeyed together, in one round trip, the
 * exact thing the discipline asks for — would be refused at item [3] for a board that
 * items [0..2] build. A gate that refuses the compliant batch teaches the model to stop
 * batching, and the batch is the behaviour the canon wants.
 *
 * Deliberately NOT simulated: list_subtasks. It has no response yet, so the children are
 * unknown, and completing a parent in the same batch that first lists its children is
 * precisely what CANON-BOTTOM-UP exists to catch. The clearing path — list in one call,
 * complete in the next — stays open.
 */
function simulateInner(st, tool, args) {
  const a = args || {};
  const t = L.nowS();
  if (tool === 'read_channel_policy') st.policy.policy = true;
  if (tool === 'read_channel_messages') st.policy.messages = true;
  if (tool === 'create_task') st.tree.task++;
  if (tool === 'create_subtask') st.tree.subtask++;
  if (tool === 'create_flow_cluster') st.tree.cluster++;
  if (tool === 'create_flow_connection') st.tree.connection++;
  if (tool === 'create_board') { st.board.board++; st.summaryBoardAfterAll++; }
  if (tool === 'create_board_block' && String(a.type || '').toLowerCase() === 'mermaid') st.board.mermaid++;
  if (tool === 'read_board' || tool === 'list_board_blocks') st.board.read++;
  if (tool === 'complete_task' && a.task_id) st.completed.add(a.task_id);
  if (tool === 'create_journal' || tool === 'update_journal') {
    st.journalWrites.push({ t, idx: Number.MAX_SAFE_INTEGER, folder: a.folder_id || null });
  }
  if (/^(get_journal|list_journals|search_journals)$/.test(tool)) st.journalReads.push({ t });
  // The close-out counters, so a close-out BATCHED into one bulk — which is exactly what
  // CANON-DEBT-CLOSEOUT's block text asks for — is not refused at its own last item.
  if (tool === 'create_knowledge_graph') st.kgClose.create++;
  if (tool === 'add_source_to_knowledge_graph' && a.source_type) st.kgClose.sources.add(a.source_type);
  if (tool === 'extract_knowledge_graph') st.kgClose.extract++;
  if (tool === 'interpret_knowledge_graph') st.kgClose.interpret++;
  if (tool === 'get_knowledge_graph' || tool === 'semantic_search_knowledge_graph') st.kgClose.read++;
  // A MAPPED READ INSIDE THE BATCH SETTLES THE DEBT THE LATER ITEMS WOULD BE REFUSED FOR.
  // `bulk([read_board(x), update_task(y)])` is a carried debt being settled and the work
  // resuming, in one round trip — the precise behaviour the block text asks for, and it
  // must not be the thing that gets refused. Simulated as settled without waiting for the
  // response, including for a delete (whose proof is an ABSENCE nobody can predict here):
  // erring towards fewer refusals is the only direction that cannot invent a latch, and the
  // real response still re-opens the obligation at PostToolUse if the read disagrees.
  for (const [k, o] of [...st.obligations]) {
    if ((WRITE_READ_MAP[o.w] || []).includes(tool)) st.obligations.delete(k);
  }
}

function modePre(payload) {
  if (L.canonMode() !== 'on') quiet();

  const raw = payload.tool_name || '';
  const bare = L.bareToolName(raw);
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};

  // THE ESCAPE MUST ALWAYS BE REACHABLE — on any shell, not only on Bash. The old check
  // was `raw === 'Bash' && standDownExempt(input.command)`, so a session latched by
  // CANON-COORD-ROLE could not stand the gate down from PowerShell: the escape was
  // refused by the gate it escapes. A gate that can block its own escape is a trap.
  const shells = L.shellStrings(input);
  if (shells.some((s) => standDownExempt(s))) quiet();

  const portal = isPortalTool(bare);

  // WHAT DOES THIS CALL DO? Portal tools answer to the portal invariants and are never
  // reclassified as file or shell effects; everything else is judged by the shape of its
  // arguments, so a tool nobody has heard of yet is covered on the day it is installed.
  const effect = portal ? { mutation: null, targets: [] } : {
    mutation: shells.map((s) => L.shellMutation(s)).find(Boolean) || null,
    targets: L.writeTargets(bare || raw, input, shells),
  };
  if (EDIT_TOOLS.has(raw) && !effect.targets.length) {
    const fp = input.file_path || input.notebook_path;
    if (fp) effect.targets = [{ path: String(fp), via: null }];
  }
  const fileWrite = effect.targets.length > 0;
  const mutates = fileWrite || Boolean(effect.mutation);

  // NOTHING TO GATE. This is now the hot path for every Read, Grep, Glob and foreign MCP
  // call in the session — the PreToolUse matcher is `.*`, because a matcher is a full
  // match on a tool NAME and every name-shaped matcher this plugin has shipped was found
  // to have a door beside it. So this bails before it touches the disk.
  if (!portal && !mutates) quiet();

  const key = L.sessionKey(payload);
  const run = L.resolveRun(payload.cwd);
  const isRun = Boolean(run && run.state && run.state !== 'CLOSED');
  const rows = L.readFamily(key);
  const st = fold(rows, run);

  // THE COLD START, narrowed to the thing it was for.
  //
  // It used to be `seen.size === 0 && fewer than 3 tool calls`, which let the first writes
  // of EVERY session carry any id at all — so "fabricate the id in the first call" beat
  // CANON-ID outright. It exists for the session the gate cannot see the beginning of: a
  // resume whose ledger was swept. When SessionStart or a user prompt IS on the record
  // there is nothing to be uncertain about, and the carve-out has no reason to apply.
  const observed = rows.filter((r) => r.k === 'post' || r.k === 'bulk').length;
  const coldStart = !process.env.PORTAL_CANON_STRICT_ID
    && st.hellos === 0 && st.prompts === 0 && observed < 3;

  const ctx = {
    st, run, isRun, coldStart,
    armed: (g) => L.gateArmed(g, run).armed,
    projDir: L.normPath(process.env.CLAUDE_PROJECT_DIR || payload.cwd).value || '',
  };

  const deny = (gate, reason, innerTool, innerArgs, dk) => {
    L.append(key, {
      v: 1, t: L.nowS(), k: 'pre', s: key, a: payload.agent_id || null,
      tool: bare || raw, raw, gate, verdict: 'deny',
      args: L.safeArgs(innerArgs || input),
      inner: innerTool || undefined,
      // The debt budget lives in the ledger, not in a counter somebody has to remember to
      // save: the fold that decides whether a debt may still refuse is the same fold that
      // counts how often it already has.
      dk: dk || undefined,
    });
    refuse(reason);
  };

  const mkCall = (b, r, inp, at) => ({
    bare: b, raw: r, input: inp, at,
    portal: isPortalTool(b),
    portalWrite: isPortalTool(b) && isPortalWrite(b),
    effect: at ? { mutation: null, targets: [] } : effect,
    fileWrite: at ? false : fileWrite,
    mutates: at ? false : mutates,
  });

  if (bare === 'bulk') {
    const calls = Array.isArray(input.calls) ? input.calls : [];
    for (let i = 0; i < calls.length; i++) {
      const item = calls[i];
      if (!item || typeof item !== 'object') continue;
      const ib = String(item.tool || item.name || '') || null;
      if (!ib) continue;
      const iargs = (item.arguments || item.args || {});
      const verdict = evaluateCall(ctx, mkCall(ib, ib, (iargs && typeof iargs === 'object') ? iargs : {},
        { i, n: calls.length }));
      if (verdict) deny(verdict.gate, verdict.reason, ib, iargs, verdict.dk);
      simulateInner(st, ib, iargs);
    }
  } else {
    const verdict = evaluateCall(ctx, mkCall(bare, raw, input, null));
    if (verdict) deny(verdict.gate, verdict.reason, null, null, verdict.dk);
  }

  L.append(key, {
    v: 1, t: L.nowS(), k: 'pre', s: key, a: payload.agent_id || null,
    tool: bare || raw, raw, gate: null, verdict: 'allow', args: L.safeArgs(input),
  });
  quiet();
}

// --- PostToolUse ------------------------------------------------------------

const POST_BLOCK_CAP = 12;

function modePost(payload) {
  const key = L.sessionKey(payload);
  const raw = payload.tool_name || '';
  const bare = L.bareToolName(raw);
  const input = payload.tool_input || {};
  const respRaw = payload.tool_response;
  // MUST go through responseText: an MCP tool_response is content blocks, not a string,
  // and stringifying it escapes every newline — which made the line-anchored bulk item
  // regex match nothing and emptied `inner` on every bulk row ever written.
  let resp = L.responseText(respRaw);
  if (resp.length > 65536) resp = resp.slice(0, 65536);
  const ok = !(respRaw && typeof respRaw === 'object' && respRaw.isError);

  const ids = L.harvestSeen(resp);
  const t = L.nowS();
  const agent = payload.agent_id || null;

  if (bare === 'bulk') {
    const inner = L.parseBulkResponse(resp, (input && input.calls) || []);
    const names = L.bulkInnerNames(input);
    const calls = (input && input.calls) || [];
    const rows = inner.map((it) => ({
      i: it.i,
      tool: it.tool || names[it.i] || null,
      ok: it.ok,
      ids: it.ids,
      args: L.safeArgs((calls[it.i] && (calls[it.i].arguments || calls[it.i].args)) || {}),
    }));
    const m = resp.match(/Ran\s+(\d+)\/(\d+)\s+call\(s\);\s*(\d+)\s+failed/);
    L.append(key, {
      v: 1, t, k: 'bulk', s: key, a: agent, tool: 'bulk', idh: L.harvestIdHeads(resp),
      n: m ? Number(m[2]) : rows.length, ran: m ? Number(m[1]) : rows.filter((r) => r.ok).length,
      failed: m ? Number(m[3]) : rows.filter((r) => !r.ok).length,
      // `ids` is the SAFETY NET, and it is here because its absence is what turned one
      // parsing bug into three false refusals. Per-item ids are the precise channel; this
      // is the coarse one that survives any future failure to split the response, so an id
      // the portal demonstrably returned can never be called unseen again.
      ids, inner: rows, tu: payload.tool_use_id || null, ms: payload.duration_ms || null,
    });
  } else {
    L.append(key, {
      v: 1, t, k: 'post', s: key, a: agent, tool: bare || raw, raw, ok, ids, idh: L.harvestIdHeads(resp),
      args: L.safeArgs(input), tu: payload.tool_use_id || null, ms: payload.duration_ms || null,
    });
    // Phase boundaries drive CANON-JOURNAL-PHASE and CANON-ACCOUNT.
    //
    // BOTH MILESTONE TOOLS COUNT. This watched `update_milestone_status` alone, but the
    // tool an agent actually reaches for is `update_proposal_milestone` — it is what the
    // canon's own status guidance names, and it carries the same `status` argument. So a
    // run could deliver milestone after milestone and still report "phase boundaries
    // recorded 0", which is not a cosmetic count: it is the progress signal that
    // CANON-JOURNAL-PHASE keys on and that now restores the block budget below.
    // Measured on a live day-long run — three milestones delivered, zero boundaries seen.
    const MILESTONE_STATUS_TOOLS = ['update_milestone_status', 'update_proposal_milestone'];
    if (MILESTONE_STATUS_TOOLS.includes(bare) && /deliver|approv|complete|done/i.test(String(input.status || ''))) {
      L.append(key, { v: 1, t, k: 'phase', s: key, a: agent, boundary: 'milestone', id: input.milestone_id || null, status: String(input.status || '') });
      // Real progress buys the gates their budget back — see creditProgress.
      L.creditProgress(L.resolveRun(payload.cwd));
    }
    if (bare === 'update_proposal_phase' && /complete|done/i.test(String(input.status || ''))) {
      L.append(key, { v: 1, t, k: 'phase', s: key, a: agent, boundary: 'phase', id: input.phase_id || null, status: String(input.status || '') });
      L.creditProgress(L.resolveRun(payload.cwd));
    }
    if (bare === 'claim_coordinator_title' && ok) {
      L.append(key, { v: 1, t, k: 'mode', s: key, a: agent, mode: 'coordinator', channel: input.channel_id || null });
    }
    // THE KEY TO THE LATCH ABOVE, and the reason CANON-COORD-ROLE is a gate rather than a
    // trap. `mode` used to move one way only: the claim wrote 'coordinator', fold replayed
    // it from the ledger, and nothing anywhere ever wrote a second `mode` row — so the gate
    // refused every Write/Edit/mutating Bash for the rest of the session, including after
    // the action the card published. Handing the title on is the one event that makes the
    // gate's premise false, so it is the one event that clears it.
    //
    // `ok` is the same loose check as the claim, deliberately: a string-shaped error reads
    // as success at both ends, and here that looseness errs towards LETTING GO of the
    // title — the direction that cannot trap. The claim's identical looseness errs the
    // other way, which is why this line matters more than it looks.
    if (bare === 'transfer_coordinator_title' && ok) {
      L.append(key, { v: 1, t, k: 'mode', s: key, a: agent, mode: 'solo', channel: input.channel_id || null });
    }
  }

  if (L.canonMode() !== 'on') quiet();

  const run = L.resolveRun(payload.cwd);
  if (run && run.state !== 'CLOSED' && bare && isPortalWrite(bare)) {
    run.last_progress_at = t;
    // Learn the journal folder the run is using, so P5/S1 can name it.
    if (bare === 'create_journal_folder' && ids.length && !run.journal_folder) {
      run.journal_folder = { id: ids[0], name: null };
    }
    if (!run.project_id && bare === 'create_project' && ids.length) run.project_id = ids[0];
    if (!run.project_id && input.project_id) run.project_id = input.project_id;
    L.saveRun(run);
  }

  if (!L.gateArmed('CANON-READ-BACK', run).armed) quiet();

  const st = fold(L.readFamily(key), run);
  if (st.blockedThisTurn.has('CANON-READ-BACK')) quiet();
  if (st.postBlocks >= POST_BLOCK_CAP) quiet();
  if (!st.obligations.size) quiet();

  // DEAD-MAN (§5 E4): two blocks with no tool call in between means the model is stuck.
  if (st.lastBlockAt && st.toolCallsSinceBlock === 0) quiet();

  const open = [...st.obligations.values()];
  const reads = [];
  for (const o of open.slice(0, 8)) {
    const map = WRITE_READ_MAP[o.w] || [];
    if (map[0]) reads.push(map[0] + '(' + (o.id ? '"' + o.id + '"' : '…') + ')');
  }
  if (!reads.length) quiet();

  L.append(key, { v: 1, t, k: 'block', s: key, a: agent, gate: 'CANON-READ-BACK', event: 'PostToolUse' });

  const call = reads.length > 1 ? 'bulk([' + reads.join(', ') + '])' : reads[0];
  const anyDelete = open.slice(0, 8).some((o) => o.neg);
  blockPost(
    '[portal-canon CANON-READ-BACK] The write returned, which is not evidence it persisted.\n'
    + 'Unverified now: ' + open.length + ' write(s) — ' + open.slice(0, 8).map((o) => o.w).join(', ') + '.\n'
    + 'REQUIRED ACTION TO CLEAR — make this your next tool call:\n'
    + '  ' + call + '\n'
    + (anyDelete
      ? 'A DELETE IS VERIFIED BY ABSENCE: confirm the record is GONE from what comes back. If it is '
        + 'still there, the delete did not happen.\n'
      : '')
    + 'Confirm the specific field you wrote is present in what comes back. A success string is not a '
    + 'data effect.\n'
    + 'This gate has blocked ' + (st.postBlocks + 1) + '/' + POST_BLOCK_CAP + ' times this session; after '
    + POST_BLOCK_CAP + ' it degrades to a Stop-time report. IF YOU GENUINELY CANNOT READ IT BACK: run\n'
    + '  ' + standDownLine('CANON-READ-BACK') + '\n'
    + 'and say so in your answer.');
}

// --- Stop -------------------------------------------------------------------

const STOP_BUDGET = { 'CANON-ACCOUNT': 3, 'CANON-READ-BACK-STOP': 3, 'CANON-CLOSEOUT': 2 };

/** Did watch-alarm block this turn? Two gates on one turn spends the 9-block budget. */
function watchAlarmBlockedRecently() {
  try {
    const base = process.env.CLAUDE_PLUGIN_DATA || require('os').tmpdir();
    const s = L.readJSON(path.join(base, 'watch-alarm-state.json'));
    if (s && s.lastBlock && s.lastBlock.at && (L.nowS() - s.lastBlock.at) < 90) return true;
  } catch (_) {}
  return false;
}

function modeStop(payload) {
  const key = L.sessionKey(payload);
  const agent = payload.agent_id || null;
  const t = L.nowS();
  const run = L.resolveRun(payload.cwd);
  const st = fold(L.readFamily(key), run);
  L.append(key, { v: 1, t, k: 'stop', s: key, a: agent });

  if (L.canonMode() === 'off') quiet();
  if (watchAlarmBlockedRecently()) quiet();

  // THE ONE PORTAL READ (§6.6). Rate limited, run-scoped, and strictly optional: on
  // 401/timeout/no-credential we carry on with local ledger evidence, labelled as such.
  // S1 and S2 are stream-only and stay armed either way.
  if (run && run.state === 'RUN' && run.project_id) {
    const cached = run.cache && run.cache.at && (L.nowS() - run.cache.at) < 600 ? run.cache : null;
    if (cached) {
      run.all_phases_terminal = Boolean(cached.allTerminal);
      return stopDecide(payload, key, agent, t, run, st, cached);
    }
    let settled = false;
    const go = (summary) => {
      if (settled) return; settled = true;
      if (summary) {
        run.cache = summary;
        run.all_phases_terminal = Boolean(summary.allTerminal);
        L.saveRun(run);
      }
      stopDecide(payload, key, agent, t, run, st, summary);
    };
    setTimeout(() => go(null), 7000).unref?.();
    try {
      require('./canon-net.js').stopRead(run, (summary) => go(summary));
    } catch (_) { go(null); }
    return;
  }
  return stopDecide(payload, key, agent, t, run, st, null);
}

/**
 * THE HANDOFF FROM THE AFTER-SURFACE TO THE BEFORE-SURFACE.
 *
 * Called on every path where the turn is actually ALLOWED TO END — never on a path that
 * blocks, because a blocked turn has not ended and the model may still settle everything
 * before it does. What the turn ends owing is written down here, and the next turn's first
 * action answers for it.
 *
 * Only obligations with a mapped read are recorded. One without is a debt no call could
 * settle, and recording it would manufacture exactly the unclearable refusal this feature
 * has already had to fix four times.
 */
function recordDebt(payload, run, st) {
  if (L.canonMode() !== 'on') return;
  // AN OBLIGATION WITH NO ID IS NOT CARRIED. Two reasons, and both are the same reason: a
  // debt whose record cannot be NAMED cannot be settled by any call the model could make —
  // `read_board(…)` is not an instruction anyone can follow — and without an id the debt has
  // no stable identity across rows either, so a later row could never supersede it. It stays
  // a live obligation for the Stop gates inside this session and is simply not inherited.
  const rb = [...st.obligations.values()]
    .filter((o) => o.id && (WRITE_READ_MAP[o.w] || [])[0])
    .slice(0, 8)
    .map((o) => ({ w: o.w, id: o.id, tu: o.tu || null, neg: o.neg ? 1 : 0 }));
  const co = (run && run.state === 'RUN' && run.all_phases_terminal)
    ? closeoutMissing(st).map((m) => m.id) : [];
  if (!rb.length && !co.length) { L.clearDebt(payload.cwd); return; }
  L.writeDebt(payload.cwd, {
    v: 1, at: L.nowS(), rb, co, corun: run ? run.run_id : null,
  });
}

function stopDecide(payload, key, agent, t, run, st, net) {

  const advisories = [];
  // S4 CANON-BULK (advise only — a deny on call #4 cannot undo 1-3).
  if (st.singleWrites >= 3) {
    advisories.push('[portal-canon CANON-BULK] ' + st.singleWrites + ' single portal writes this session. '
      + 'Consecutive writes belong in one `bulk` call — one registry build, one round trip, one message.');
  }
  // S6 CANON-STATUS (advise only).
  if (st.completed.size && !st.phaseBoundaries.length) {
    advisories.push('[portal-canon CANON-STATUS] ' + st.completed.size + ' task(s) completed this session '
      + 'and no milestone or phase status write recorded. Canon (c): status follows the work.');
  }
  // S3 CANON-COMPLETE (advise only). Named EMPTY FIELDS when the portal answered;
  // local ledger evidence, explicitly labelled, when it did not.
  if (run && run.state === 'RUN') {
    if (net && net.emptyFields && net.emptyFields.length) {
      advisories.push('[portal-canon CANON-COMPLETE] ' + net.phases + ' phase(s), ' + net.terminal
        + ' terminal. These required fields read as empty in the portal: ' + net.emptyFields.join(', ')
        + '. Canon (Gate 2): deliver only when deliverables and acceptance criteria are met. '
        + 'This lists EMPTY fields; it cannot judge whether the filled ones are any good.');
    } else {
      const gaps = [];
      if (!st.tree.subtask) gaps.push('no create_subtask');
      if (!st.tree.connection) gaps.push('no create_flow_connection');
      if (!st.journalWrites.length) gaps.push('no journal entry');
      if (gaps.length) {
        advisories.push('[portal-canon CANON-COMPLETE] local evidence, not a verdict — this run has '
          + gaps.join(', ') + ' recorded in the tool stream.');
      }
    }
  }

  const advisoryOnly = L.canonMode() === 'advisory';

  // S0: never gate twice. Inform ONCE and let the turn end.
  //
  // The once-per-turn guard is not politeness — without it the runtime's Stop re-entry
  // makes this speak on every single re-entry, and the model dutifully answers each one.
  if (payload.stop_hook_active) {
    // THIS IS THE LEAK, AND THIS LINE IS WHERE IT IS HANDED ON. The runtime re-enters Stop
    // after a block, this branch cannot block again, and the turn ends here owing whatever
    // the block just named. It stays owed — on the next turn's first action.
    recordDebt(payload, run, st);
    if (advisories.length && !st.spokeThisTurn) {
      L.append(key, { v: 1, t, k: 'note', s: key, a: agent, msg: 'spoke' });
      speak(advisories.join('\n') + '\n[portal-canon] This gate fires once per turn; '
        + 'it is informing rather than blocking because it already blocked this turn. '
        + 'Anything still unsettled is refused on the next turn\'s first action, not on this one.', 'Stop');
    }
    quiet();
  }

  const canBlock = (g) => !advisoryOnly && L.gateArmed(g, run).armed && !st.blockedThisTurn.has(g);
  const recordBlock = (g) => {
    L.append(key, { v: 1, t, k: 'block', s: key, a: agent, gate: g, event: 'Stop' });
    L.spendBlock(run, g, STOP_BUDGET[g] || 3);
  };

  // ---- S2 CANON-READ-BACK-STOP ----
  if (st.obligations.size && canBlock('CANON-READ-BACK-STOP')) {
    const open = [...st.obligations.values()].slice(0, 8);
    const reads = [];
    for (const o of open) {
      const map = WRITE_READ_MAP[o.w] || [];
      if (map[0]) reads.push(map[0] + '(' + (o.id ? '"' + o.id + '"' : '…') + ')');
    }
    if (reads.length) {
      recordBlock('CANON-READ-BACK-STOP');
      blockStop('[portal-canon CANON-READ-BACK-STOP] This turn is ending with ' + st.obligations.size
        + ' write(s) that were never read back: ' + open.map((o) => o.w).join(', ') + '.\n'
        + 'A write that returned is not a write that persisted.\n'
        + 'REQUIRED ACTION TO CLEAR — make this your next tool call:\n'
        + '  ' + (reads.length > 1 ? 'bulk([' + reads.join(', ') + '])' : reads[0]) + '\n'
        + (open.some((o) => o.neg)
          ? 'A DELETE IS VERIFIED BY ABSENCE: confirm the record is GONE from what comes back.\n' : '')
        + 'Confirm the specific field you wrote is present in what comes back.\n'
        + 'TO STAND IT DOWN: ' + standDownLine('CANON-READ-BACK-STOP') + ' or type /portal-stand-down.'
        + (advisories.length ? '\n\n' + advisories.join('\n') : ''));
    }
  }

  // ---- S1 CANON-ACCOUNT — canon (b), in the only shape that cannot trap ----
  if (run && run.state === 'RUN' && canBlock('CANON-ACCOUNT')) {
    const folder = run.journal_folder && run.journal_folder.id;
    const journalledThisTurn = st.journalWrites.some((j) => j.idx > st.turnStartIdx && (!folder || j.folder === folder));
    const phasesRemain = !run.all_phases_terminal;
    if (phasesRemain && !journalledThisTurn) {
      const n = ((run.blocks && run.blocks['CANON-ACCOUNT']) || 0) + 1;
      recordBlock('CANON-ACCOUNT');
      blockStop('[portal-canon CANON-ACCOUNT] Phases remain in run ' + run.run_id
        + ' (' + st.phaseBoundaries.length + ' boundary/boundaries recorded so far'
        + (run.project ? ', project "' + run.project + '"' : '') + ') and this turn is ending.\n'
        + 'Canon (b): you proceed to the next phase without waiting for confirmation — the owner is not '
        + 'here to say continue.\n'
        + 'REQUIRED ACTION TO CLEAR — do exactly one of these now:\n'
        + '  (1) continue: start the next phase\'s first real step in this turn; or\n'
        + '  (2) if you are blocked, call create_journal(folder_id="' + (folder || '<your run log folder>')
        + '", title="<phase> — blocked", tags=["blocked"]) naming what stopped you, then read it\n'
        + '      back with get_journal/list_journals in the same turn, then end.\n'
        + 'You may not stop SILENTLY; you may always stop with an account.\n'
        + 'Blocked ' + n + '/' + STOP_BUDGET['CANON-ACCOUNT'] + ' times in this run — after '
        + STOP_BUDGET['CANON-ACCOUNT'] + ' this gate degrades to a notice and says so.\n'
        + 'TO STAND IT DOWN: ' + standDownLine('CANON-ACCOUNT') + ' or type /portal-stand-down.'
        + (advisories.length ? '\n\n' + advisories.join('\n') : ''));
    }
  }

  // ---- S5 CANON-CLOSEOUT ----
  if (run && run.state === 'RUN' && run.all_phases_terminal && canBlock('CANON-CLOSEOUT')) {
    const miss = closeoutMissing(st);
    if (miss.length) {
      recordBlock('CANON-CLOSEOUT');
      // NOT recordDebt: a blocked turn has not ended, and the model may still make every one
      // of these calls before it does. The Stop re-entry that finally lets the turn go is
      // where the debt is taken, and it sees whatever state the turn actually finished in.
      blockStop('[portal-canon CANON-CLOSEOUT] Every phase of run ' + run.run_id + ' is terminal, so this '
        + 'is the run\'s close-out, and these are missing from the tool stream:\n'
        + miss.map((m) => '  · ' + m.text).join('\n') + '\n'
        + 'REQUIRED ACTION TO CLEAR — make those calls now, batched in one `bulk` where they do not '
        + 'depend on each other.\n'
        + 'IF THIS TURN ENDS ANYWAY: this gate fires once per turn and will not block again, but the '
        + 'close-out stays owed and the next turn\'s first piece of work is refused until it exists.\n'
        + 'TO STAND IT DOWN: ' + standDownLine('CANON-CLOSEOUT') + ' or type /portal-stand-down.'
        + (advisories.length ? '\n\n' + advisories.join('\n') : ''));
    } else {
      L.closeRun(run, 'close-out artifacts recorded');
    }
  }

  // The turn is genuinely ending now, and nothing above stopped it.
  recordDebt(payload, run, st);

  if (advisories.length && !st.spokeThisTurn) {
    L.append(key, { v: 1, t, k: 'note', s: key, a: agent, msg: 'spoke' });
    speak(advisories.join('\n'), 'Stop');
  }
  quiet();
}

// --- subagent / session end -------------------------------------------------

function modeSubagent(payload, which) {
  const key = L.sessionKey(payload);
  L.append(key, {
    v: 1, t: L.nowS(), k: 'note', s: key, a: payload.agent_id || null,
    msg: which + ':' + (payload.agent_type || '?'),
  });
  quiet();
}

function modeSessionEnd(payload) {
  const key = L.sessionKey(payload);
  const base = String(key).split('.')[0];
  try {
    for (const f of fs.readdirSync(L.DIR_SESSIONS)) {
      if (f === base + '.jsonl' || f.startsWith(base + '.')) {
        try { fs.unlinkSync(path.join(L.DIR_SESSIONS, f)); } catch (_) {}
      }
    }
  } catch (_) {}
  L.sweep();
  quiet();
}

// ---------------------------------------------------------------------------
// CLI modes (no stdin)
// ---------------------------------------------------------------------------

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function cliRunOpen() {
  const run = L.openRun({
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    client: arg('client'), project: arg('project'),
    state: (arg('state', 'ALIGN') || 'ALIGN').toUpperCase(),
    mode: arg('mode', 'solo'), channel: arg('channel'), identity: arg('identity'),
  });
  process.stdout.write('portal-canon run opened: ' + run.run_id + ' · state ' + run.state
    + ' · mode ' + run.mode + '\n');
  process.exit(0);
}

function cliRunPromote() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let run = L.resolveRun(cwd);
  const state = (arg('state', 'RUN') || 'RUN').toUpperCase();
  if (!run || run.state === 'CLOSED') {
    run = L.openRun({ cwd, state, client: arg('client'), project: arg('project') });
  } else {
    run.state = state;
    run.last_progress_at = L.nowS();
    L.saveRun(run);
  }
  process.stdout.write('portal-canon run ' + run.run_id + ' → state ' + run.state + '\n');
  process.exit(0);
}

function cliRunClose() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const id = arg('run');
  const run = id ? L.readJSON(L.runFile(id)) : L.resolveRun(cwd);
  // Closing by hand is the owner saying the work is over, so it settles the account with it.
  // Without this the debt outlives the thing it was a debt against, and the next session in
  // this project is refused on behalf of a run that no longer exists.
  const hadDebt = Boolean(L.readDebt(cwd));
  L.clearDebt(cwd);
  if (!run) {
    process.stdout.write('portal-canon: no run to close' + (hadDebt ? ' (carried debt cleared)' : '') + '\n');
    process.exit(0);
  }
  // The stamp, not just the deletion — a session that already adopted this debt reads its
  // settlement from the run manifest, which is the only channel that reaches it mid-session.
  run.debt_settled_at = L.nowS();
  L.closeRun(run, arg('reason', 'closed by hand'));
  process.stdout.write('portal-canon run ' + run.run_id + ' closed'
    + (hadDebt ? ' · carried debt cleared' : '') + '\n');
  process.exit(0);
}

function cliStandDown() {
  L.ensureDirs();
  const gate = arg('gate', 'all');
  const runId = arg('run');
  const reason = arg('reason', '(no reason given)');
  const name = gate === 'all' ? (runId ? 'STAND-DOWN-' + runId : 'STAND-DOWN') : 'STAND-DOWN-' + gate;
  const file = path.join(L.HOME, name);
  try {
    fs.writeFileSync(file, JSON.stringify({ at: L.nowS(), gate, run: runId || null, reason }, null, 2), 'utf8');
    process.stdout.write('portal-canon: ' + (gate === 'all' ? 'ALL GATES' : gate)
      + ' stood down. Sentinel: ' + file + '\nDelete that file to re-arm.\n');
  } catch (e) {
    process.stdout.write('portal-canon: could not write sentinel: ' + e.message + '\n');
  }
  process.exit(0);
}

function cliDoctor() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const run = L.resolveRun(cwd);
  const lines = [];
  lines.push('portal-canon doctor');
  lines.push('  CANON_HOME      : ' + L.HOME);
  // WHY it is that path, not just what it is. A CLI run and a hook run used to resolve two
  // different homes and each printed its own with equal confidence, so the run existed in
  // one and every gate looked in the other.
  lines.push('  resolved via    : ' + L.HOME_SOURCE);
  lines.push('  exists          : ' + fs.existsSync(L.HOME));
  lines.push('  PORTAL_CANON    : ' + (process.env.PORTAL_CANON || '(unset → on)'));
  lines.push('  project dir     : ' + (process.env.CLAUDE_PROJECT_DIR || cwd));
  lines.push('  projhash        : ' + L.projHash(cwd));
  lines.push('  run             : ' + (run ? run.run_id + ' · state ' + run.state + ' · mode ' + run.mode
    + ' · blocks ' + L.blocksSpent(run) : '(none)'));
  lines.push('  portal tools    : ' + PORTAL_TOOLS.size + ' known, ' + Object.keys(WRITE_READ_MAP).length + ' write→read rows');
  lines.push('  gates:');
  for (const [id] of REGISTER) {
    const a = L.gateArmed(id, run);
    lines.push('    ' + (a.armed ? 'ARMED      ' : 'stood down ') + id + (a.why ? '  (' + a.why + ')' : ''));
  }
  let files = [];
  try { files = fs.readdirSync(L.DIR_SESSIONS); } catch (_) {}
  lines.push('  ledger sessions : ' + files.length);
  let total = 0;
  const blocks = [];
  for (const f of files.slice(-20)) {
    const rows = L.readLines(f.replace(/\.jsonl$/, ''));
    total += rows.length;
    for (const r of rows) if (r.k === 'block') blocks.push(r.gate + ' @' + new Date((r.t || 0) * 1000).toISOString());
  }
  lines.push('  ledger lines    : ' + total);
  lines.push('  last blocks     : ' + (blocks.slice(-5).join(', ') || '(none)'));
  try {
    const net = require('./canon-net.js');
    lines.push('  credential      : ' + net.probe());
  } catch (e) { lines.push('  credential      : (probe unavailable: ' + e.message + ')'); }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

function cliTools() {
  process.stdout.write([...PORTAL_TOOLS].join('\n') + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const MODE = process.argv[2];

const STDIN_MODES = {
  'session-start': modeSessionStart,
  prompt: modePrompt,
  pre: modePre,
  post: modePost,
  stop: modeStop,
  'subagent-start': (p) => modeSubagent(p, 'SubagentStart'),
  'subagent-stop': (p) => modeSubagent(p, 'SubagentStop'),
  'session-end': modeSessionEnd,
};

function main() {
  switch (MODE) {
    case 'run-open': return cliRunOpen();
    case 'run-promote': return cliRunPromote();
    case 'run-close': return cliRunClose();
    case 'stand-down': return cliStandDown();
    case 'doctor': return cliDoctor();
    case 'tools': return cliTools();
    case 'selftest': return require('./canon-selftest.js').run();
    default: break;
  }
  const fn = STDIN_MODES[MODE];
  if (!fn) process.exit(0);
  L.readStdin((raw) => {
    let payload = {};
    try { payload = JSON.parse(raw) || {}; } catch (_) { payload = {}; }
    try { fn(payload); } catch (e) {
      // FAIL-SAFE (§5 E5): our own bug must never be the reason a turn fails.
      try {
        L.append(L.sessionKey(payload), {
          v: 1, t: L.nowS(), k: 'note', s: L.sessionKey(payload), a: payload.agent_id || null,
          msg: 'crash:' + MODE + ':' + String(e && e.message).slice(0, 120),
        });
      } catch (_) {}
      process.exit(0);
    }
  });
}

// EXPORTS BEFORE THE SIDE EFFECT. `canon-gate.js selftest` requires canon-selftest.js from
// inside main(), and the selftest requires this module back to assert on REGISTER. With the
// assignment below main() that circular require handed back an empty object — the gate's
// own tests could not see the register they exist to police.
module.exports = { PORTAL_TOOLS, WRITE_READ_MAP, REGISTER, JOURNAL_CLEARING, BOARD_FIRST_GATED,
  CLOSEOUT_CLEARING, OTHER_GATE_KEYS, CARD_CAP, DEBT_BUDGET,
  fold, isPortalWrite, isPortalTool, isDeleteWrite, buildCard, standDownExempt, evaluateCall,
  settleCall, carriedDebt, closeoutMissing, closeoutOwed };

// Only run when invoked directly, so `selftest` can import this module and drive the
// gates with fixture payloads instead of a live session.
if (require.main === module) {
  try { main(); } catch (_) { process.exit(0); }
}
