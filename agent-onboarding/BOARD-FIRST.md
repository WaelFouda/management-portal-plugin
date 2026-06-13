# Board-First Alignment Procedure

> Companion to `DISCIPLINE.md` (core loop, step ALIGN). For any non-trivial new piece of work, the
> agent breaks the idea down on a **board** — with mermaid diagrams and charts — and **gets the human's
> alignment BEFORE** creating the brief, proposal, or task tree. Align first; build second.

## 1. When to run it

Run board-first whenever you are about to start a new project, a new phase of work, or any change big
enough to warrant a brief/proposal. Skip it only for trivial, single-step edits.

## 2. The procedure steps

1. **Create the alignment board.** `create_board(title:"… — Plan", icon, description)`.
2. **Explain the plan visually.** Add blocks that break the idea down:
   - a `callout` with the goal,
   - `heading` + `text`/`bullet_list` sections for the problem, approach, scope, deliverables,
   - **`mermaid` diagrams** for the architecture, the workflow/loop, and the phase roadmap
     (use `create_board_block(type:"mermaid", content:{code})` or `insert_diagram`),
   - **charts** where a comparison or breakdown is clearer as a chart than prose.
3. **READ THE BOARD BACK (verify).** `read_board(board_id)` — confirm every block landed, in order,
   and that diagrams rendered (Gate 1, read-after-write). Fix anything missing before showing the human.
4. **PRE-EXECUTION CONFIRMATION GATE.** Present the board and **stop**. Do **not** create the brief,
   proposal, or tasks until the human has reviewed the board and given alignment. Incorporate their
   feedback into the board (update the blocks, re-read to verify) and re-confirm if it changed
   materially. *Alignment on the board is the gate that unlocks the rest of the loop.*
5. **Only then proceed** to the brief → proposal (phases + milestones, every field filled) → task
   tree → flow board, per `DISCIPLINE.md`.

> The two hard sub-rules: **(a) the pre-execution confirmation gate** — never start the brief/proposal
> before the human aligns on the board; and **(b) read the board back** — verify the board with
> `read_board` before presenting it, so you align the human on what actually exists, not what you hope
> you wrote.

## 3. Cluster + relation conventions (flow board)

When you build the flow board (after alignment), follow these conventions so the board reads
consistently and the relations encode real intent:

- **One cluster per phase.** `create_flow_cluster(title:"Phase N — <name>", task_ids:[…all the phase's
  milestone task ids], color)`. Group the phase's top-level milestone tasks.
- **Distinct cluster colors**, low-alpha rgba so tasks stay readable, e.g. indigo
  `rgba(99,102,241,0.15)`, emerald `rgba(52,211,153,0.15)`, amber `rgba(251,191,36,0.15)`, sky
  `rgba(56,189,248,0.15)`, violet `rgba(167,139,250,0.15)`, rose `rgba(244,114,182,0.15)`, teal
  `rgba(20,184,166,0.15)`.
- **Relations are directed `source → target`** meaning *source must happen before / enables target*.
  - **Intra-phase order:** consecutive milestones, title `"then"`.
  - **Cross-phase chain:** last milestone of phase N → first milestone of phase N+1, title `"then"`.
  - **Cross-cutting dependencies:** real dependencies that jump the sequence, with a meaningful title
    and `details` — e.g. `"feeds"`, `"enables"`, `"blocks"`. Example: `1.2 universal-layer → feeds →
    2.1 shared core`; `4.3 block-numbering → enables → 5.1 block-mentions`.
- **You (the agent) do the semantic extraction** that decides the clusters and relations — reason over
  the milestones, do not auto-generate decorative links. Then verify with `list_flow_clusters` /
  `list_flow_connections` (the edge may land even if the call reports a timeout).

## 4. Worked example (end to end)

A user asks for a small "Onboarding microsite". The agent runs board-first:

1. `create_board(title:"Onboarding microsite — Plan", icon:"🧭")` → board id `B`.
2. Blocks on `B`:
   - `callout`: "Goal: a 3-page microsite that onboards new users in under 5 minutes."
   - `heading` "Approach" + `bullet_list` (pages, stack, analytics).
   - `mermaid` architecture:
     ```
     flowchart TD
       U["Visitor"] --> L["Landing"]
       L --> S["Sign-up"]
       S --> D["Dashboard tour"]
     ```
   - `mermaid` roadmap: `flowchart LR; P1["Design"] --> P2["Build"] --> P3["Launch"]`.
3. `read_board(B)` → confirm all blocks + diagrams present. **Stop. Present to the human.**
4. Human: "Add an FAQ page." → `create_board_block` an updated roadmap; `read_board(B)` to verify;
   re-confirm. **Human aligns.**
5. *Now* proceed: `create_project` → `update_brief` (+diagram) → `create_proposal` (+intro diagram,
   +disclaimers) → `add_proposal_phase`×3 → `add_proposal_milestone`×N (every field, +diagram) →
   `create_task` per milestone → `create_subtask` (+nested) → `create_flow_cluster` per phase →
   `create_flow_connection` (Design → Build → Launch, + any cross-cutting). Verify each with the
   matching read tool.

The point: the **board with diagrams + the human's alignment** comes first; everything else follows
only after the gate is passed.
