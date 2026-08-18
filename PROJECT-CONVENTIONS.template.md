# Project conventions template

The `airlock` skills are deliberately engine- and language-agnostic. They refer to "the project's test command", "the project's architecture invariants", and so on — **this file is where you supply those specifics.**

Copy the block below into your project's instruction file (`CLAUDE.md` for Claude Code/Cowork projects, `AGENTS.md` for OpenCode), fill in the angle-bracket parts, and delete any line that doesn't apply. Every line you fill in is a line Airlock stops having to guess about.

---

```markdown
## Process: Airlock is opt-in

Airlock is inactive in normal chats. Use it only after the user invokes `/airlock:start` (Claude Code or
Cowork), `/airlock-start` (OpenCode), or explicitly launches `airlock:orchestrator` as the main agent.
Project `.airlock/config.json` selects `native` or `opencode`; it never activates Airlock.

Airlock classifies work as Quick, Compact, or Full. Quick uses at most one leaf end-to-end and creates no
workflow artifacts. Compact normally uses one multipurpose `worker`. Full-lite prefers one worker per
Crossing with required gates only. `/airlock:stop` ends command-activated mode.

Usage policy: prototype/throwaway/exploratory work uses **no Airlock**; contained real changes use Compact;
Full/irreversible/production work runs **on the Claude Code host only** (the guard hook is a Claude Code
mechanism — OpenCode may serve as dispatched external worker, never as Full orchestrator).

Session budgets are defaults for every Airlock session: at most 5 Crossings or the declared wall clock, then
summarize and start a fresh session. Review rounds cap at 3 before an explicit continue decision.

Only the main session delegates. Every worker is a leaf. Ask before each Fable leaf invocation, including
when the main session uses Fable or an earlier Fable leaf was approved.

## Project specifics (airlock reads these)

- **Focused test command:** `<e.g. npm test -- path / pytest tests/x.py>`
- **Full test command:** `<e.g. npm test / pytest -q / ./run.ps1 -Tests>`. State whether every Crossing requires it.
- **Typecheck / lint / build:** `<exact commands, or not applicable>`
- **Deterministic check commands:** `<exact unit, typecheck, lint, and build commands the orchestrator may run inline>`
- **Run the app:** `<e.g. npm run dev / ./run.ps1>`
- **Artifact homes:** current dashboard at `<docs/airlock/STATUS.md>`, designs in `<docs/airlock/specs/>`, plans in `<docs/airlock/plans/>`, ledgers in `<docs/airlock/ledger/>`, accepted plan/spec archives in `<docs/airlock/archive/YYYY-MM/>`; read legacy `<docs/specs/>`, `<docs/plans/>`, and `<docs/ledger/>` when present
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
- **Airlock setup v2:** `<selected claude/opencode harnesses; host overlays; absolute out-of-repo auth home; app URL; auth signal; exact refresh command>`
- **Browser MCP backend:** `<pin exactly one: playwright, chrome-devtools, or none; same browser registration/flags/auth state in every selected harness>`
- **Unattended budget:** `<default max Crossings (5 unless overridden) and/or max wall-clock; PR decision mirror if available>`
- **Decision file:** `<docs/airlock/DECISIONS.md; source of truth for questions waiting for the user>`
- **Temporary artifact home:** `<approved task-owned scratch directory; exact-path cleanup only>`
- **Retained evidence home:** `<stable screenshots/logs/traces directory and naming/reference convention>`
- **Cleanup policy:** `<process stop command, retained-vs-temporary rules, and paths/state that must never be cleaned>`
- **Live integration and cleanup:** `<approved throwaway target, allowed mutations, rollback/cleanup, and
  evidence that cleanup succeeded>`
- **Host routing:** `<map Light/Standard/Complex/Critical + investigator/verifier/reviewer/visual roles to
   configured agents and models; state the independent-review policy and accepted downgrade>`
- **Airlock runtime:** `<native or opencode; missing .airlock/config.json means native and does not activate Airlock>`
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
- **Release flow:** `<bump plugin.json + marketplace.json -> update changelog/README -> run the four test suites + claude plugin validate --strict for both manifests -> branch + PR (DECISION: link) -> after user merge, tag/publish only behind a second DECISION>`
- **Release escalation:** `<migrations, credential changes, irreversible external state, and direct publication remain Full or explicitly gated>`
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
