# Read=Write Coverage Audit (Milestone 1.3)

> Goal: every WRITABLE field must be READABLE BACK through some read tool, so a
> tool-only agent can verify its own writes (DISCIPLINE.md Gate 1, read-after-write).
> This audit validates `WRITE-READ-MAP.md` against the actual tool registry, lists the
> field-level gaps found, and records what was fixed.
>
> Source of truth checked: `backend/ai/tools/read_tools.py`, `write_tools.py`,
> `content_write_tools.py`, `board_tools.py`, `gig_tools.py`; enumerated via
> `registry.py::build_registry`.

## 1. Write tool → verification read inventory (validated)

Every write tool in the registry maps to an **existing** read tool. No write tool was
found with *no* read path. The named read tools in `WRITE-READ-MAP.md` all exist in the
registry. Summary by entity (high-value entities checked field-level in §2):

| Write tool(s) | Verify read | Read exists? | Notes |
|---|---|---|---|
| create/update_client | get_client / list_clients | ✅ | get_client `select("*")` — all cols |
| create/update_project | get_project / list_projects | ✅ | get_project `select("*")` |
| update_brief, update_brief_field, insert_diagram(brief) | get_brief | ✅ | see §2 (diagram gap, fixed) |
| create/update_proposal, update_proposal_field, insert_diagram(proposal) | get_proposal_detail / get_proposal | ✅ | see §2 (intro/disclaimers gap, fixed) |
| add/update/reorder_proposal_phase(s), insert_diagram(phase) | get_proposal_detail | ✅ | see §2 (phase diagram, fixed) |
| add/update/reorder_proposal_milestone(s), update_milestone_status, insert_diagram(milestone) | get_proposal_detail / list_milestones | ✅ | see §2 (milestone diagram, fixed) |
| create/update/complete/delete_task | get_task / list_tasks | ✅ | get_task `select("*")` |
| create_subtask | list_subtasks | ✅ | see §2 (nesting gap, fixed) |
| create/update/delete_flow_cluster | list_flow_clusters | ✅ | see §2 (task_ids gap, fixed) |
| create/update/delete_flow_connection | list_flow_connections | ✅ | returns source/target/title/details — full |
| create/update/delete_board, *_block, reorder_blocks, set_block_parent | read_board / list_board_blocks | ✅ | see §2 (content preview limitation, documented) |
| add/edit/resolve/react_board_comment | read_board (comment counts) | ✅ | counts only — by design |
| create/update/update_content/delete_note | get_note / list_notes | ✅ | get_note returns every written field |
| create/update/delete_note_column | list_note_columns | ✅ | title/color/position |
| create/update/delete_event | list_events | ✅ | date/time/duration_mins/type/links |
| log_time/start/stop_timer/update/delete_time_entry | list_time_entries / get_time_summary | ✅ | |
| create/update/promote/delete/attach quick_proposal | get_quick_proposal / list_quick_proposals | ✅ | get_quick_proposal dumps all cols |
| create/update/delete_mentoring_session | get_mentoring_session / list_mentoring_sessions | ✅ | get_* `select("*")` |
| create/approve/reject scheduling | list_scheduling_links / list_scheduling_requests | ✅ | |
| update_profile / update_my_profile_extended | get_my_full_profile / get_profile | ✅ | bio_html/rate/links/skills/etc returned |
| work-history / portfolio writes | get_my_work_history / get_my_portfolio | ✅ | `select("*")` JSON |
| update_workspace | get_workspace | ✅ | `select("*")` |
| remember/update/delete_memory | recall | ✅ | (memory_tools.py) |
| chat/dm/inbox sends | read_channel_messages / read_dm_messages / read_inbox | ✅ | (team_chat_tools.py) |
| gig writes (gig + packages/faq/requirements) | get_gig / list_gigs | ✅ | (gig_tools.py) get_gig nests children |

## 2. Field-level GAP LIST (high-value entities) + fixes

| Entity | Write field(s) | Read tool | Before | Fix applied |
|---|---|---|---|---|
| **Proposal header** | `introduction_html`, `disclaimers_html` (create/update_proposal, update_proposal_field) | `get_proposal_detail` | **GAP** — select listed only `id,title,status,currency,sent_date,valid_until`; intro/disclaimers were **not returned at all**. The map names `get_proposal_detail` as the verify read for these, but they round-tripped only through `get_proposal` (truncated). | Added `introduction_html, disclaimers_html` to the select; serialized both (stripped, 300 chars) with a `[has diagram]` marker. |
| **Proposal / brief / phase / milestone diagrams** | `insert_diagram(...)` appends `<div data-type="mermaid">` into an `*_html` field | `get_proposal_detail`, `get_brief` | **GAP** — reads HTML-strip every field, so the diagram node was erased from the output. A successful `insert_diagram` was **unverifiable** (looked identical to no diagram). | Added a `has_diagram()` check (`data-type="mermaid"` substring on the raw HTML, before stripping) and append ` [has diagram]` to overview/goals/deliverables/requirements/notes (brief), introduction/disclaimers (proposal), objective/deliverables/acceptance (phase), objective/description/deliverables/acceptance (milestone). |
| **Flow cluster membership** | `task_ids` (create/update_flow_cluster) | `list_flow_clusters` | **GAP** — output printed only `tasks: <count>`. The select already fetched `task_ids`, but the *specific* ids were dropped, so you could not confirm **which** tasks landed in the cluster (only how many). | Output now lists the actual `task_ids` (`tasks (N): id1, id2, …`). |
| **Nested subtasks** | `create_subtask(parent_task_id=<subtask>)` builds task→subtask→**nested** | `list_subtasks` | **GAP** — listed a parent's direct children with status, but gave no signal that a child itself had children. Bottom-up completion (DISCIPLINE §4) needs to know which leaves hide more work without N blind re-calls. | Added a single batched `in_("parent_id", child_ids)` lookup; each subtask now shows ` | nested_subtasks: N` when it has children. Status + nesting are now both exposed. |

### Verified OK (no change needed)
- **Brief scalar fields** (title, project_type, source, budget, currency, deadline, priority, status, skills) + all `*_html` text — `get_brief` returns every field `update_brief` can set.
- **Phase fields** (name, subtitle, objective/deliverables/acceptance_html, deadline, order_index) — fully in `get_proposal_detail`.
- **Milestone fields** (name, subtitle, objective/description/deliverables/acceptance_html, cost, time_value, time_unit, status, deadline, order_index) — fully in `get_proposal_detail`; status + cost/time also in `list_milestones`.
- **Tasks** — `get_task` does `select("*")`; `list_tasks` exposes parent_id/position/status/priority.
- **Flow connections** — `list_flow_connections` returns source_id, target_id, title, details (every writable field).
- **Notes** — `get_note` returns title, content, scope, ref_id, date, color, column_id, position, is_pinned, assignees, pin_x, pin_y = exactly the write surface.

## 3. Gaps documented but NOT code-fixed (deliberate, with reason)

- **Board block `content` is returned as a truncated preview, not full JSON.**
  `read_board` / `list_board_blocks` summarize each block's content (first text/html/code,
  ~80–100 chars) rather than dumping the full `content` JSON. For large/structured blocks
  (tables, drawings, multi-line rich_text) a write is only *partially* verifiable. Left as-is
  because: (a) block `type`, `position`, `parent_id` (the structural writes) **are** fully
  returned, so create/reorder/reparent are verifiable; (b) dumping every block's full JSON
  would bloat the tool output for large boards and risk truncation of the whole response. An
  agent needing byte-exact verification of one block's body should re-read that single block.
  Recommend a future `get_board_block(block_id)` that returns full `content` — tracked as a
  follow-up, not a 1.3 blocker.

- **Board comments are surfaced as counts only** (`read_board`). By design — there is no
  read tool that returns comment bodies. `add_board_comment` is verifiable by the count delta,
  which matches what `WRITE-READ-MAP.md` already claims ("comment counts"). Not a regression.

- **HTML round-trip is lossy by intent.** All rich-text reads strip tags for a plain-text
  summary and truncate (120/300 chars). This is acceptable for verification (you confirm the
  *content* landed); the new `[has diagram]` marker closes the one case where stripping hid a
  structural write. Byte-exact HTML is not exposed by any read tool and was not in scope to add.

## 4. Files changed

- `backend/ai/tools/read_tools.py` — only file modified. Functions touched:
  - `get_proposal_detail` — added `introduction_html`/`disclaimers_html` to select + output; `has_diagram` markers on intro/disclaimers/phase/milestone fields.
  - `get_brief` — `has_diagram` markers on the five rich-text fields.
  - `list_subtasks` — batched nested-children lookup + `nested_subtasks: N` indicator.
  - `list_flow_clusters` — print actual `task_ids` instead of just the count.

No write tool was modified (write behavior unchanged).

## 5. Regression verification

- `python -m py_compile backend/ai/tools/read_tools.py` → **passes** (PY_COMPILE_OK).
- Re-read of each edited region confirms the new fields/markers are emitted and the
  `has_diagram` helper is defined before all uses.

## 6. Delete-tool confirmation coverage

Destructive `delete_*` tools return only a success string, so per Gate 1 they are verified by
**re-reading and confirming absence** — the record no longer appears in its list/get. Audited:

| Delete tool | Confirm absence with | OK |
|---|---|---|
| `delete_task` | `list_tasks` / `get_task` | ✅ |
| `delete_flow_cluster` | `list_flow_clusters` | ✅ |
| `delete_flow_connection` | `list_flow_connections` | ✅ |
| `delete_board_block` | `list_board_blocks` / `read_board` | ✅ |
| `delete_board` | `list_boards` | ✅ |
| `delete_note` | `list_notes` / `get_note` | ✅ |
| `delete_note_column` | `list_note_columns` | ✅ |
| `delete_event` | `list_events` | ✅ |
| `delete_time_entry` | `list_time_entries` | ✅ |
| `delete_comment` | `read_board` (comment-count delta) | ✅ |
| `delete_quick_proposal` | `list_quick_proposals` | ✅ |
| `delete_mentoring_session` | `list_mentoring_sessions` | ✅ |
| `delete_client` / `delete_project` | `list_clients` / `list_projects` | ✅ |
| `delete_gig` / `delete_gig_*` | `list_gigs` / `get_gig` | ✅ |
| `delete_portfolio_item` / `delete_work_history_entry` | `get_my_portfolio` / `get_my_work_history` | ✅ |
| `delete_memory` | `recall` | ✅ |

**Finding:** no delete tool lacks a confirming read — every deletion is verifiable by re-listing and
confirming the record is gone. Agents must confirm by the **absence in the read**, not by the success
message.
