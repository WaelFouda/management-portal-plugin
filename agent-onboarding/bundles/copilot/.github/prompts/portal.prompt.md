---
name: portal
description: Operate the management-portal MCP via the portal-operator agent — read, align (board-first), break down, build, verify, and deliver portal work under the discipline.
agent: portal-operator
tools: ["management-portal"]
---

Engage the **portal-operator** agent to operate the **management-portal MCP** on the request below,
strictly under the discipline (`.github/copilot-instructions.md` + the `management-portal` skill).

## Operate the core loop

```
READ → GAP → ALIGN(board-first) → BREAK DOWN → BUILD → TEST → VERIFY → DELIVER → UPDATE
```

For this request:

1. **READ first** — load the relevant records (project, brief, proposal + `get_proposal_detail`, phases +
   milestones, tasks + `list_subtasks`, and the flow board via `list_flow_clusters` /
   `list_flow_connections`). Never act on memory; never fabricate an id.
2. **GAP** — state explicitly what's missing vs. the spec and the flow-board.
3. **ALIGN (board-first)** — if the work is non-trivial, build an alignment board (mermaid + charts),
   `read_board` to verify, then **present and stop** for human alignment before any brief/proposal.
4. **BREAK DOWN** — tasks → subtasks → nested subtasks + flow board (clusters per phase + relations)
   before building.
5. **VERIFY (read-after-write)** — after every write, call the matching `get_*` / `list_*` and confirm the
   field persisted; trust the data effect, not the success string.
6. **Completeness** — fill every field on any brief/proposal/phase/milestone (objective, description,
   diagrams, deliverables, acceptance, disclaimers, timeline, time, cost = hours × profile rate).
7. **DELIVER bottom-up** — a parent is done only when every child is verified done.

The user's request:

$ARGUMENTS
