# /portal — disciplined management-portal MCP run

Operate the **management-portal MCP** under the full operating contract for the work described in
`$ARGUMENTS` (or the current request). The portal is a real freelancer/client workspace and **writes
change real data** — act accordingly.

## How to run

Follow `.cursor/rules/portal-mcp.mdc` and the root `AGENTS.md` exactly. Run the core loop end to end:

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

1. **READ** the relevant records first — proposal, brief, every phase + milestone (deliverables +
   acceptance criteria), and the **flow board** (clusters *and* custom relations). Never act on memory.
2. **GAP** — state explicitly what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — for non-trivial work, build an alignment board (mermaid + charts) with
   `create_board` → blocks → `read_board` to verify, then **present and STOP** for human alignment
   before creating the brief/proposal/task tree.
4. **BREAK DOWN** — decompose into tasks → subtasks → nested subtasks and build the flow board
   (one cluster per phase + custom relations) before any implementation.
5. **BUILD / TEST / VERIFY / DELIVER / UPDATE** — build on a branch (never the auto-deploying branch),
   test E2E incl. UI/UX, read-after-write every change, mark delivered only when every leaf is done
   (bottom-up), then update the memory graph + flow board.

## Hard stops (the three gates)

- **Read-after-write** — after any write, call the matching `get_*`/`list_*` and confirm the specific
  field persisted. Trust the data effect, not the success string or a stale schema.
- **Completeness** — fill **every** field on any brief/proposal/phase/milestone (objective,
  description, mermaid + chart diagrams, deliverables, acceptance criteria, disclaimers & disclosures,
  timeline/deadline, time estimate, cost = hours × profile hourly rate).
- **Task-breakdown** — never start before the task tree + flow board exist.

## Always

- **Never fabricate ids** — read every id from a `list_*`/`get_*` or a `create_*` response.
- **You do the semantic extraction yourself** — no DeepSeek.
- **Insert mermaid via `insert_diagram` / `create_board_block(type:"mermaid")`**, never raw mermaid in a
  field.

For the full playbook (principle → exact tool sequences) and the write → read verification map, load the
`management-portal` skill's `reference.md`.
