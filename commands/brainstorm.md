---
description: Approve design and scope for Full Airlock work
---

# Brainstorm — the design and scope gate

Make the design decision *before* work is committed, so the agent does not build the wrong thing well.

## Hard-ish gate

Do **not** write a plan or production code until you have presented a design and the user has approved it. Exploratory reading, options, and throwaway spikes are fine; committing to an approach is not.

**No file-writing subagent runs without a signed-off scope.** The test is not “is this substantial?” but *“will a subagent write files?”* A fresh context can choose a defensible-but-wrong blast radius; the scope contract makes that choice explicit.

## Scope contract — required in every design or scope note

- **Deliverable + exact path** — the files that exist when done.
- **Integration stance — say it out loud.** *Standalone* (“does not wire into the application or modify existing generators/runtime code”) or *integrated* (name the seam).
- **Extend or write fresh.** If similar machinery exists, explicitly choose whether to extend it or create a separate artifact.
- **May touch / MUST NOT touch** — exact paths or globs, including load-bearing exclusions and other lanes’ files.
- **High-level shape** — 3–7 coarse steps and likely cost/complexity. Detailed routing belongs in `plan`.

## Candidate Delivery Packs and verification intent

Sketch the outcome boundaries before handing off:

- A **Crossing** is one scope-audited, buildable commit with focused evidence.
- A **Delivery Pack** is one coherent outcome spanning one or more **contiguous** Crossings.
- For a multi-Crossing Delivery Pack, state why one Crossing is insufficient, its dependencies, and its pack-level rollback strategy. Do not promise that dependent Crossings remain independently revertible.
- Note likely pack dependencies and acceptance outcomes. `plan` assigns stable IDs, exact Crossing/task mapping, work classes, host roles, and routing.

Also state verification intent: what would demonstrate the outcome and which risks may require technical checks, pre-ship independent code review, browser-functional, visual-fidelity, live-integration, or external-state cleanup gates. Mention only plausible gates; `plan` decides applicability and records required rows. A pre-ship independent-review gate is not the post-ship Airlock `review` workflow.

The eventual Delivery Pack lifecycle is `planned → active → candidate → accepted`, with `blocked`, `abandoned`, and `reverted` as exceptional terminal outcomes. Its review lifecycle is separate.

## Lite lane

For a one-file tool, script, or contained utility, present a short scope contract plus one likely Light, single-Crossing Delivery Pack and verification intent. Get approval, then go to **`plan`** (or implement directly only if genuinely trivial). Keep the gate cheap enough to use.

## Process

1. **Understand the request.** Read relevant code, project instructions (`CLAUDE.md`, `AGENTS.md`, or configured equivalent), and project notes. State what you found.
2. **Ask only design-changing questions, batched.** Use the host’s structured question tool when available, 2–4 questions max, with a recommended option and your position.
3. **Float 2–3 approaches.** Give each tradeoff and rough weight, then recommend one and explain why.
4. **Present the design:** goal, scope/non-goals, scope contract, key decisions, candidate Delivery Packs, verification intent, and risks. For a contentious or expensive decision, seek an independent reviewer in a separate context, preferably from a different model family when available.
5. **On approval**, write the self-contained design to the project’s specs directory (default `docs/specs/YYYY-MM-DD-<topic>-design.md`) and invoke **`plan`**. Do not implement directly from the design.

Capture the *why*, not only the decision. Specify outcomes and constraints; leave implementation detail and final pack routing/gates to `plan`.

Next skill: **`plan`**.
