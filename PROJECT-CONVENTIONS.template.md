# Project conventions template

The `devflow` skills are deliberately engine- and language-agnostic. They refer to "the project's test command", "the project's architecture invariants", and so on — **this file is where you supply those specifics.**

Copy the block below into your project's `CLAUDE.md`, fill in the angle-bracket parts, and delete any line that doesn't apply. Every line you fill in is a line the skills stop having to guess about.

---

```markdown
## Process: the devflow flow (non-negotiable)

For any substantial change — a feature, a system, a redesign, a non-trivial bug fix — route it through the
`devflow` plugin skills. Do **not** author specs or jump to code directly.

1. **`/devflow:brainstorm` FIRST** — before any spec, plan, or code. The design + scope gate: approaches →
   design → approval *before* work is committed. Every design doc carries a **scope contract** (deliverable +
   exact path, integration stance stated out loud, may/must-not-touch, high-level plan). **No file-writing
   subagent runs without a signed-off scope** — the test is "will a subagent write files?", not "is this
   substantial?". Small/standalone work uses the **lite lane**: just the scope contract, approved inline.
2. **`/devflow:plan`** — approved design → a phased, TDD plan with a disjoint file contract and a per-task
   model/parallel-group execution table. It **stops and asks: inline or subagents?** before implementing.
   Subagent prompts restate the file contract **verbatim** with a STOP rule; the orchestrator **audits
   `git status` against the contract** after they return.
3. **`/devflow:ship`** — completion gate: green suite + evidence (not assertion) + commit discipline.
4. **`/devflow:debug`** for non-trivial bugs.

Trivial mechanical edits (a one-line swap, a config value) can be direct — but if there's a design choice
in it, brainstorm.

## Project specifics (devflow reads these)

- **Test command:** `<e.g. npm test / pytest -q / ./run.ps1 -Tests>`. Must be green at every commit.
- **Run the app:** `<e.g. npm run dev / ./run.ps1>`
- **Artifact homes:** designs in `<docs/specs/>`, plans in `<docs/plans/>`
- **Architecture invariants (few, explicit, load-bearing):**
  - `<e.g. modules communicate only via the event bus or injected callables>`
  - `<e.g. entry points / composition roots are src/main.ts — treat as load-bearing>`
  - `<e.g. content is data files, code is behavior>`
- **Protected local state — back up before any run that mutates it, restore after:**
  - `<e.g. %APPDATA%/MyApp/save.cfg — the user's real progress>`
- **Validation constraints:** `<e.g. subagent-launched background processes die when the turn ends — all
  validation must be bounded FOREGROUND runs inside the turn>`
- **Stochastic/tuning verification:** `<e.g. never judge balance from one run — use N-seed distributions via
  the harness at tools/harness>`
- **Generated-asset provenance:** `<e.g. all AI images go through tools/gen_art.py; each appends a row to
  docs/generation-log.jsonl (disclosure requirement); commit each asset with its import sidecar>`
- **Branch + push policy:** `<e.g. work lands directly on main; commit as part of the task; push only when
  asked>`
- **Commit message convention:** `<e.g. conventional commits; end with the Co-Authored-By trailer>`
- **Parallel sessions:** `<e.g. two sessions often share one checkout → every plan MUST declare a disjoint
  file contract; git pull --rebase --autostash before every commit; scoped git add only>`
- **Known confounds when debugging:** `<e.g. a stale save file silently changes balance readings>`
```

---

## Notes

- **Keep it lean.** `CLAUDE.md` loads on every session, so bloat makes the agent *ignore* rules rather than follow them. Per line, ask: "would removing this cause a mistake?" If no, cut it.
- **The invariants list is the highest-value part.** Naming the few load-bearing files an agent must not touch measurably improves everything else it does.
- **If a rule keeps getting ignored**, that's the signal to promote it from prose to a **hook** in `.claude/settings.json` — `CLAUDE.md` is advisory, hooks are deterministic. Good candidates: block turn-end until the suite is green; back up protected state before a run; block writes outside the active file contract.
