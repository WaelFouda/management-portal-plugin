---
description: Operate the management-portal MCP under the full agent discipline (dispatches the portal-operator subagent).
argument-hint: [what to do in the portal]
---

Use the **portal-operator** subagent to handle this management-portal request, following the full
operating discipline (the core loop; the three gates of read-after-write, completeness, and
task-breakdown; bottom-up completion; never-fabricate-ids; and board-first alignment).

Request: $ARGUMENTS

Before doing anything, the subagent must **READ** the relevant portal records (proposal, brief, phases +
milestones with deliverables and acceptance criteria, and the flow board's clusters + relations) — the
read tools are the only source of truth. For any non-trivial new work, run **board-first alignment**
(build the board with mermaid + charts, `read_board` to verify, then present and **stop** for human
alignment before creating the brief/proposal/task tree). After every write, **read the record back** with
the matching `get_*`/`list_*` tool and confirm the field persisted — trust the data effect, not the
success message. Never fabricate an id; if you don't have one, read for it.

Report back with: what was read, the gaps found, what was written, and the read-after-write evidence for
each change — or, if you hit a board-first alignment gate, the board to align on and an explicit stop.
