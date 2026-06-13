# Semantic-Extraction Model — Who Extracts, Per Entry Point

> **Milestone 3.2** of the MCP Agent Onboarding project. This document makes **explicit**
> *who* turns free-form input (a brief, a chat, a pile of notes, a spec) into **structured
> portal data** — clusters, relations, tasks, subtasks — at each entry point, and proves that
> the **MCP agent self-extracts** using only **read tools + primitive write tools**, with
> **no DeepSeek** call inside the MCP.
>
> Canon: `DISCIPLINE.md` (esp. §5 "Who performs semantic extraction"), `WRITE-READ-MAP.md`,
> `COVERAGE-AUDIT.md`. **On any conflict, `DISCIPLINE.md` wins.** This file does not introduce
> new behavior — it documents and audits what §5 already ratified.

**Status:** documentation + audit · **Last updated:** 2026-06-11 · Consistent with `DISCIPLINE.md` v1.0.0.

---

## 1. The per-entry-point extraction matrix

"Semantic extraction" = reading unstructured input and producing the structured portal shapes
(**flow clusters**, **custom relations**, **task → subtask → nested-subtask trees**). There is
**no separate extractor service for the MCP**. The rule from `DISCIPLINE.md` §5 is simply:
**whatever intelligence is in the loop does the extraction.**

| Entry point | Who extracts | Model | DeepSeek in the path? | How |
|---|---|---|---|---|
| **MCP agent** — Claude Code, VS Code GitHub Copilot, Roo Code, Cursor (any MCP client) | **The agent itself** | The agent's **own** foundation model | **No** | Reasons over what the **read tools** return, then writes clusters/relations/tasks via the **primitive write tools**, then read-after-write verifies. |
| **Web / mobile app button features** — e.g. **Generate Tasks** (and Generate Notes / Gen-Refine) | **Server-side LLM**, *no conversational agent present* | **`deepseek-v4-flash`** (constant `FLASH_MODEL` in `backend/ai/deepseek_client.py`, routed by `backend/routers/ai_generate_tasks.py`) | **Yes** — by design, server-side only | A stateless button fires a one-shot prompt; the model returns structured JSON the app persists. No tool loop, no agent. |
| **In-app AI Chat Assistant / Thoth** | **Itself**, inline | Its own conversational model | **No** (extraction is inline in its reasoning) | Extracts as part of its own reasoning turn over the same tool registry the MCP exposes. |

**Reading of the matrix.** DeepSeek lives **only** behind the web/mobile *button* features
(`ai_generate_tasks` / `ai_generate_notes` / `ai_refine`), where there is **no agent in the
loop** to do the reasoning — the server has to supply the intelligence. Everywhere an actual
*agent* is present (MCP client, or the in-app Assistant/Thoth), **that agent is the extractor**.
The MCP agent therefore needs **no** DeepSeek tool — it already *is* a reasoning model; it only
needs good **read** tools to load context and **primitive write** tools to emit the structure.

---

## 2. Self-extraction playbook (MCP agent)

This is the loop the MCP agent runs to turn free-form input into structured portal data **with
no DeepSeek**. It is the §4 (BREAK DOWN) / §7 ("Task breakdown + flow board") sequence of
`DISCIPLINE.md`, stated as an extraction procedure.

### Step 1 — READ the relevant entities (load context)

Pull the unstructured source and everything it references through the **read tools** (your only
source of truth — never guess a field or an id). Depending on the input, that is some of:

```
get_brief(project_id)              · get_proposal_detail(project_id) · list_milestones(...)
get_project / get_client           · list_notes / get_note          · list_tasks / get_task
read_channel_messages / read_dm_messages   (a referenced @Channel / @DM)
get_my_full_profile  (→ hourly_rate, for cost/time on milestones)
list_flow_clusters / list_flow_connections   (existing structure — do not duplicate it)
```

`@Type:Name:uuid` mentions in the input map 1:1 onto these read tools (see the audit in §3) —
resolve each mention to its record **before** reasoning.

### Step 2 — REASON out the structure (the extraction itself — this is the model's job)

With the context loaded, the agent **reasons** (no external call) to derive:

- **Grouping → flow clusters.** What belongs together? Typically **one cluster per phase**,
  grouping that phase's tasks. (`DISCIPLINE.md` §4 "Flow board".)
- **Dependencies → custom relations.** What must precede what? Intra-phase ordering **and**
  cross-phase / cross-cutting dependencies. These encode **real intent**, never decoration.
- **The task tree.** A **top-level task per milestone** (a flow node) → **implementation
  subtasks** → **nested subtasks** where the work has finer steps. Assign due dates + priorities.

### Step 3 — WRITE via primitive tools (emit the structure)

Persist the extracted structure with the primitive write tools — ids come **only** from the
read tools or the `create_*` responses, never invented:

```
create_task(project_id, title, due_date, priority)          → capture task_id
create_subtask(parent_task_id, title)                       → capture subtask_id
create_subtask(parent_task_id=<subtask_id>, title)          (nested)
create_flow_cluster(title, task_ids=[…captured task_ids…])  → capture cluster_id
create_flow_connection(source_id, target_id, title)         (a real dependency)
```

### Step 4 — READ-AFTER-WRITE verify (Gate 1)

After every write, call the mirroring read tool and confirm the **data effect** — not the
success string, not a cached schema (`COVERAGE-AUDIT.md`, `WRITE-READ-MAP.md`):

```
list_tasks(project_id)            → the task rows exist
list_subtasks(parent)             → children exist under the right parent (+ nested indicator)
list_flow_clusters                → cluster exists and lists the actual task_ids
list_flow_connections             → the edge exists (it may land even if the call timed out)
```

Only structure that **reads back** counts as extracted. This whole loop runs with **read tools
+ primitives + the §5 guidance** — no DeepSeek, no new tool.

---

## 3. Coverage audit — can the MCP agent self-extract context for every mentionable type?

The 17 mentionable entity types are the canonical surface the agent may be handed as input
(via `[@Type:Name:uuid]` tokens). Exact list confirmed from
`frontend/src/lib/ai-mentions.ts` (`MentionEntity['type']` union + `TOKEN_RE`):

> `Client, Project, Task, Event, Note, TimeEntry, Brief, Proposal, QuickProposal,
> MentoringSession, Profile, Gig, GigPackage, TeamMember, Board, Channel, DM` — **17 types**.

For self-extraction to work, the agent must be able to **load each referenced entity** through
an MCP **read** tool. The table below maps each type to its MCP read path. (Cross-references
`COVERAGE-AUDIT.md`, which audits the complementary direction — every *writable* field is
*readable back*.)

| # | Mention type | MCP read tool(s) to load it for extraction context | Status |
|---|---|---|---|
| 1 | **Client** | `get_client` / `list_clients` | **OK** |
| 2 | **Project** | `get_project` / `list_projects` | **OK** |
| 3 | **Task** | `get_task` / `list_tasks` (+ `list_subtasks`) | **OK** |
| 4 | **Event** | `list_events` | **OK** |
| 5 | **Note** | `get_note` / `list_notes` | **OK** |
| 6 | **TimeEntry** | `list_time_entries` (+ `get_time_summary`) | **OK** |
| 7 | **Brief** | `get_brief` | **OK** |
| 8 | **Proposal** | `get_proposal_detail` / `get_proposal` (+ `list_milestones`) | **OK** |
| 9 | **QuickProposal** | `get_quick_proposal` / `list_quick_proposals` | **OK** |
| 10 | **MentoringSession** | `get_mentoring_session` / `list_mentoring_sessions` | **OK** |
| 11 | **Profile** | `get_profile` / `get_my_full_profile` | **OK** |
| 12 | **Gig** | `get_gig` / `list_gigs` | **OK** |
| 13 | **GigPackage** | `get_gig` (packages nested in the gig payload — same as the web `[@GigPackage]` resolver) | **OK** |
| 14 | **TeamMember** | `list_workspace_members` | **OK** |
| 15 | **Board** | `read_board` / `list_boards` (+ `list_board_blocks`) | **OK** |
| 16 | **Channel** | `read_chat_channels` / `read_channel_messages` | **OK** |
| 17 | **DM** | `read_dm_conversations` / `read_dm_messages` | **OK** |

**Result: 17 / 17 OK — no gaps.** Every mentionable entity type the agent can be handed has at
least one MCP **read** tool to load it as self-extraction context. No type lacks a read path, so
there is **no GAP** to record here.

Notes on the two non-trivial cases (documented, not gaps):

- **GigPackage** has no standalone read tool; it is loaded **through** its parent `get_gig`
  (the package is nested in the gig payload). This mirrors exactly how the web mention resolver
  fetches a `[@GigPackage]` (composite `gigId/tier` → `GET /gigs/{gigId}` → pick the tier). The
  package data is fully reachable — **OK**, not a gap.
- **Channel / DM** load as their **recent message stream** (`read_channel_messages` /
  `read_dm_messages`), which is exactly the unstructured input the agent extracts *from* — the
  same shape the web resolver hands the in-app assistant. **OK.**

This audit is consistent with `COVERAGE-AUDIT.md`: that file proves every *writable field is
readable back* (read = write, for verification); this table proves every *mentionable entity is
readable in* (read coverage of the extraction-input surface). Both hold with no open gaps.

---

## 4. No new DeepSeek tool is required in the MCP

This is the load-bearing conclusion, restating `DISCIPLINE.md` §5:

> *"So the MCP needs no DeepSeek tool — it needs solid **read tools + primitive write tools +
> this guidance**, so the agent can self-extract and then read-after-write verify."*

The MCP agent **is** the reasoning model. It performs semantic extraction itself (§2 playbook),
reasoning over read-tool output and emitting clusters/relations/tasks via the primitive write
tools. DeepSeek (`deepseek-v4-flash`) belongs **only** to the server-side **button** features
(Generate Tasks / Notes / Refine), where no agent is in the loop to reason. Adding a DeepSeek
tool to the MCP would be redundant — it would put a second extractor inside a path that already
has one.

Everything this requires is **already delivered in Phase 1**: the **read tools** and **primitive
write tools** (registry audited in `COVERAGE-AUDIT.md`), the **write→read verification map**
(`WRITE-READ-MAP.md`), and the **operating guidance** (`DISCIPLINE.md`). Milestone 3.2 adds
**no code** — it is this documentation + audit deliverable.

---

## Cross-references

- `DISCIPLINE.md` §5 (semantic-extraction matrix — canon for this file), §4 / §7 (the break-down
  + flow-board sequence this playbook formalizes), §6 (never fabricate ids; trust the data effect).
- `WRITE-READ-MAP.md` — the write→read tool pairs used in the §2 read-after-write step.
- `COVERAGE-AUDIT.md` — the complementary audit (every writable field readable back); §3 here is
  the input-side counterpart (every mentionable entity readable in).
- `frontend/src/lib/ai-mentions.ts` — canonical list of the 17 mentionable entity types.
