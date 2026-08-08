# Project conventions template

The `airlock` skills are deliberately engine- and language-agnostic. They refer to "the project's test command", "the project's architecture invariants", and so on — **this file is where you supply those specifics.**

Copy the block below into your project's instruction file (`CLAUDE.md` for Claude Code, `AGENTS.md` for OpenCode), fill in the angle-bracket parts, and delete any line that doesn't apply. Every line you fill in is a line the skills stop having to guess about.

---

```markdown
## Process: the airlock flow (non-negotiable)

One door at a time — for any substantial change (a feature, a system, a redesign, a non-trivial bug fix),
route it through the `airlock` plugin skills. Do **not** author specs or jump to code directly.

1. **Airlock `brainstorm` FIRST** (`/airlock:brainstorm` in Claude Code, `/airlock-brainstorm` in OpenCode) — before any spec, plan, or code. The design + scope gate: approaches →
   design → approval *before* work is committed. Every design doc carries a **scope contract** (deliverable +
   exact path, integration stance stated out loud, may/must-not-touch, high-level plan). **No file-writing
   subagent runs without a signed-off scope** — the test is "will a subagent write files?", not "is this
   substantial?". Small/standalone work uses the **lite lane**: just the scope contract, approved inline.
2. **Airlock `plan`** — approved design → independently useful **Delivery Packs**, contiguous buildable
   commit Crossings, disjoint file contracts, host-agent/model routing, and planner-selected evidence gates.
   The user approves each pack's split, routing, and gates. Subagent prompts restate the file contract
   **verbatim** with a STOP rule; the orchestrator audits the attributable changed-path delta after return.
3. **Airlock `ship`** — seals one buildable Crossing using the final staged diff and exact-candidate evidence.
   A pack spanning several Crossings remains active until its final candidate passes every required unwaived
   gate. Each Crossing and pack state is recorded in the work's ledger.
4. **Airlock `review`** — the far door. Feedback on shipped work is **triaged before it is fixed**, resolved
   one item at a time against a known baseline, and recorded on the ledger with a checkable commit reference.
   State lives in the ledger, not the conversation, so a fresh session resumes cold.
5. **Airlock `debug`** for non-trivial bugs.

Trivial mechanical edits (a one-line swap, a config value) can be direct — but if there's a design choice
in it, brainstorm.

## Project specifics (airlock reads these)

- **Focused test command:** `<e.g. npm test -- path / pytest tests/x.py>`
- **Full test command:** `<e.g. npm test / pytest -q / ./run.ps1 -Tests>`. State whether every Crossing requires it.
- **Typecheck / lint / build:** `<exact commands, or not applicable>`
- **Run the app:** `<e.g. npm run dev / ./run.ps1>`
- **Artifact homes:** designs in `<docs/specs/>`, plans in `<docs/plans/>`, ledgers in `<docs/ledger/>`
- **Review surface:** `<e.g. local diff only / a PR per piece of work>`
- **Architecture invariants (few, explicit, load-bearing):**
  - `<e.g. modules communicate only via the event bus or injected callables>`
  - `<e.g. entry points / composition roots are src/main.ts — treat as load-bearing>`
  - `<e.g. content is data files, code is behavior>`
- **Protected local state — back up before any run that mutates it, restore after:**
  - `<e.g. %APPDATA%/MyApp/save.cfg — the user's real progress>`
- **Validation constraints:** `<e.g. subagent-launched background processes die when the turn ends — all
   validation must be bounded FOREGROUND runs inside the turn>`
- **Browser and visual verification:** `<MCP/browser availability, startup URL, cited visual spec, screenshot
  home, required desktop/mobile viewports, and whether authenticated state can be shared with subagents>`
- **Temporary artifact home:** `<approved task-owned scratch directory; exact-path cleanup only>`
- **Retained evidence home:** `<stable screenshots/logs/traces directory and naming/reference convention>`
- **Cleanup policy:** `<process stop command, retained-vs-temporary rules, and paths/state that must never be cleaned>`
- **Live integration and cleanup:** `<approved throwaway target, allowed mutations, rollback/cleanup, and
  evidence that cleanup succeeded>`
- **Host routing:** `<map Light/Standard/Complex/Critical + investigator/verifier/reviewer/visual roles to
  configured agents and models; state the independent-review policy and accepted downgrade>`
- **Allowed external runtimes:** `<runtime names permitted here; state none when external dispatch is forbidden>`
- **External route mapping:** `<runtime → approved agent/model/variant mapping; every external plan route names runtime, agent, model, and variant>`
- **External worker commit permission:** `<none; worker owns scoped edits/exploration only, launcher may seal one exact candidate, and the orchestrator owns the ledger Crossing>`
- **External foreground timeout:** `<per-route maximum duration and exact timeout/stop handling>`
- **External temp/session/evidence homes:** `<exact approved temporary, session, and retained-evidence homes; exact-ID/path cleanup policy>`
- **External writers on the active branch:** `<allowed or forbidden; if allowed, serialize writers per checkout and prohibit orchestrator checkout activity during dispatch>`
- **External launcher + Node:** `<Node prerequisite; direct one-time ${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs --manifest <absolute-json-path> --sha256 <lowercase-hex> invocation; no relay, retry, resume, or checkout activity while it runs>`
- **External runtime and Git executables:** `<required direct OpenCode and Git executables; on Windows state direct .exe paths/providers and that PowerShell/npm command shims fail closed>`
- **External deterministic validations:** `<ordered direct executable + argv arrays, shell: false, checkout-contained working directories, timeouts/output bounds/expected exits, and no validation-created delta>`
- **External launcher sealing:** `<structured branch/HEAD/index/status/hash baseline; custom-filter rejection; verified empty hooks directory; signing disabled; exact staging/cached diff-check/one-commit audit; no reset, amend, rebase, clean, or history rewrite>`
- **External recovery:** `<missing-summary quiescence check; no-commit/no-candidate, one-commit/independent-audit, and indeterminate classifications; cleanup failure after commit preserves the commit and blocks acceptance>`
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

- **Keep it lean.** Project instructions load every session, so bloat makes the agent *ignore* rules rather than follow them. Per line, ask: "would removing this cause a mistake?" If no, cut it.
- **The invariants list is the highest-value part.** Naming the few load-bearing files an agent must not touch measurably improves everything else it does.
- **If a rule keeps getting ignored**, promote it from prose to host-native enforcement: a Claude Code hook or an OpenCode plugin/permission rule. Good candidates: block turn-end until the suite is green; back up protected state before a run; block writes outside the active file contract.
