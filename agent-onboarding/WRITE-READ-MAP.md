# Write-tool → Read-tool verification map

> Companion to `DISCIPLINE.md` (Gate 1, read-after-write). For every write tool, this is the read tool
> you call afterward to confirm the change actually landed. **If a write has no read path here, that is
> a coverage gap** — record it for the Phase 1.3 read=write coverage audit and close it.

| Write tool(s) | Verify by reading | Confirms |
|---|---|---|
| `create_client`, `update_client` | `get_client` / `list_clients` | client fields persisted |
| `create_project`, `update_project` | `get_project` / `list_projects` | project fields persisted |
| `update_brief`, `update_brief_field` | `get_brief` | every brief field (overview/goals/deliverables/requirements/notes + diagram) |
| `create_proposal`, `update_proposal` | `get_proposal_detail` | title, introduction (+roadmap diagram), disclaimers |
| `add_proposal_phase`, `update_proposal_phase`, `reorder_proposal_phases` | `get_proposal_detail` | phase name/objective/deliverables/acceptance/deadline/order |
| `add_proposal_milestone`, `update_proposal_milestone`, `reorder_proposal_milestones` | `get_proposal_detail` (+ `list_milestones`) | every milestone field (objective/description/diagram/deliverables/acceptance/time/cost/deadline/status) |
| `insert_diagram` (proposal/brief/milestone/phase) | `get_proposal_detail` / `get_brief` | the diagram is in the target field |
| `create_task`, `update_task`, `complete_task` | `get_task` / `list_tasks` | task fields + status |
| `create_subtask` | `list_subtasks(parent_task_id)` | subtask exists under the right parent (and bottom-up completion) |
| `create_flow_cluster`, `update_flow_cluster`, `delete_flow_cluster` | `list_flow_clusters` | cluster + its `task_ids` |
| `create_flow_connection`, `update_flow_connection`, `delete_flow_connection` | `list_flow_connections` | the edge (may land even if the call reports a timeout) |
| `create_board`, `update_board` | `read_board` / `list_boards` | board metadata |
| `create_board_block`, `update_board_block`, `reorder_blocks`, `set_block_parent`, `delete_board_block` | `list_board_blocks` / `read_board` | block content, type, order, parent |
| `add_board_comment`, `edit_comment`, `resolve_comment`, `react_to_comment` | `read_board` (comment counts) | comment state |
| `create_note`, `update_note`, `update_note_content`, `delete_note` | `get_note` / `list_notes` | note fields |
| `create_note_column`, `update_note_column`, `delete_note_column` | `list_note_columns` | category/column state |
| `create_event`, `update_event`, `delete_event` | `list_events` | event fields |
| `log_time`, `start_timer`, `stop_timer`, `update_time_entry`, `delete_time_entry` | `list_time_entries` / `get_time_summary` | time entries/totals |
| `create_quick_proposal`, `update_quick_proposal`, `promote_quick_proposal`, `attach_to_quick_proposal` | `get_quick_proposal` / `list_quick_proposals` | quick-proposal fields |
| `create_mentoring_session`, `update_mentoring_session` | `get_mentoring_session` / `list_mentoring_sessions` | session fields |
| `create_gig`, `update_gig`, `add/update/delete_gig_*` | `get_gig` / `list_gigs` | gig + packages/faq/requirements |
| `update_my_profile_extended`, `update_profile`, portfolio/work-history/skills writes | `get_my_full_profile` / `get_my_portfolio` / `get_my_work_history` / `get_my_skills` | profile fields |
| `create_scheduling_link`, `approve/reject_scheduling_request` | `list_scheduling_links` / `list_scheduling_requests` | scheduling state |
| `send_chat_message`, `send_dm_message`, `send_inbox_message` | `read_channel_messages` / `read_dm_messages` / `read_inbox` | message posted |
| `remember`, `update_memory`, `delete_memory` | `recall` | memory state |

**Rule:** after a write, call the mapped read tool and confirm the *specific field you wrote* is
present and correct. Trust the data effect, not the success message or the schema.
