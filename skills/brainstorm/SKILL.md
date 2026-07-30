---
name: brainstorm
description: Design-review and scope gate before any substantial work. Explores intent, approaches, and design, and locks a scope contract (deliverable path, integration stance, may/must-not-touch, high-level plan) with the user's approval BEFORE a spec, plan, or code is written. Use before starting a feature, system, redesign, tool or script, or any non-trivial change — and always before dispatching a subagent that will write files. Skip only for trivial mechanical edits (a one-line swap, a config value, a launcher tweak).
---

# Brainstorm — the design and scope gate

The one job of this skill: make the design decision *before* work is committed, so the agent doesn't build the wrong thing well. Writing a spec or jumping to code without this step is the specific mistake to avoid.

## Hard-ish gate

Do **not** write a plan or production code until you have presented a design and the user has approved it. Exploratory reading, sketching options, and throwaway spikes are fine; committing to an approach is not, until approved.

**No coding subagent runs without a signed-off scope.** The test is not "is this substantial?" — it is *"will a subagent write files?"* If yes, it needs an approved **scope contract** first, even if that's six lines (see the lite lane below). A subagent gets a fresh context and will happily pick a defensible-but-wrong approach; the scope contract is what makes the blast radius the user's decision instead of the agent's.

## Scope contract (required — in every design doc and scope note)

- **Deliverable + exact path** — the file(s) that exist when this is done, e.g. `tools/report.html`, one self-contained file.
- **Integration stance — say it out loud.** *Standalone* ("does NOT wire into the application, does NOT modify existing generators or runtime code") or *integrated* (name exactly what it hooks into). Never leave this implied.
- **If something similar already exists, state extend-or-write-fresh.** When a comparable artifact is already produced by other machinery, decide explicitly whether to extend that machinery or author a new file beside it. This is the classic miss: asked for a standalone HTML page, an agent will extend the existing program that emits the current HTML — reasonable in isolation, wrong against intent.
- **May touch / MUST NOT touch** — paths, as globs. Name the load-bearing exclusions (runtime code, composition roots / entry points, other lanes' files).
- **High-level plan** — 3–7 coarse steps, each with a model tier. Approving the spec then approves the *shape and cost* of the work, not just the idea.

## Lite lane — small or standalone work

For a one-file tool, a script, or a contained utility, skip the approaches-and-design ceremony: present just the **scope contract** above as a short scope note, get a yes, and go straight to **`plan`** (or implement directly if it is genuinely trivial). The gate has to stay cheap enough that it never gets bypassed — a bypassed gate is how the wrong thing gets built.

## Process

1. **Understand the request.** Read the relevant code and the project's `CLAUDE.md` (plus any project notes or memory) before proposing anything. State what you found.
2. **Ask clarifying questions — batched.** Use `AskUserQuestion`, 2–4 questions max, each with a `(Recommended)` first option and your own stated position. Only ask what genuinely changes the design; decide the rest yourself and say so.
3. **Float 2–3 approaches**, not one. For each: what it is, the tradeoff, and roughly how heavy. Give a clear recommendation and *why* — don't just survey.
4. **Present the design for review** in sections: goal, scope + explicit non-goals, the **scope contract** above, key decisions with rationale, and risks. For a big or contentious call, get an **independent reviewer subagent** — ideally a different model than the one that authored the design, briefed to distrust it.
5. **On approval**, write a short design doc to the project's specs directory (default `docs/specs/YYYY-MM-DD-<topic>-design.md`) — self-contained, since a fresh session will read only this — then hand off by invoking **`plan`**. Do not implement from the design directly.

## Keep it coherent

Capture the *why* behind each decision, not just the decision — this is what keeps the design coherent when an agent writes the code later. Specify *what* and the constraints; leave *how* to the implementation. Watch for convention drift ("similar products do X") pulling the design off its intent.

Next skill: **`plan`**.
