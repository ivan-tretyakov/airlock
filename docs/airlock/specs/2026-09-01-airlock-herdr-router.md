# Airlock Herdr Router

- Date: 2026-09-01
- Status: draft
- Evolves: `2026-08-31-airlock-herdr-adapter.md` (the 3.x opencode-only adapter, plugin 0.1.0)
- Depends on: `2026-09-01-airlock-4.0-slim-core.md` (Airlock 4.0 slim core)
- Supersedes: the README statement that the Herdr extension is frozen at 3.x (§Repository integration)

Airlock 4.0 removed model routing from the core: routes, UTC windows, pins, fallback chains, catalogs, and generated per-route agents are gone, and `next`/`start` emit a static `AGENT airlock-<role>` line. That removal was deliberate — routing is not part of Airlock's defensible core — but the capability itself is still wanted by operators who steer several executor CLIs across paid peak windows. This specification moves exactly that capability into the Herdr extension, evolving the existing adapter (plugin `airlock.herdr` 0.1.0) into the **airlock-herdr router**, plugin version **0.2.0**: an optional Herdr plugin that selects an executor CLI, model, and effort per task, dispatches into persistent Herdr panes, and walks a pinned fallback chain when an executor fails to start — provably before the task prompt is delivered.

## Decision

Airlock keeps every authority it had: plan validation, dependency scheduling, ownership auditing, task completion, blocking, decisions, and commits, all via its 4.0 CLI (`next`/`start`/`done`/`block`/`ask`/`answer`/`status`/`audit`). The router owns everything 4.0 evicted: executor selection, model/effort choice, peak-time windows, route pinning, and fallback chains. The `AGENT airlock-<role>` line is informational to the router — it names the role, not a routing decision — and `--host` is init-only in 4.0, so the router passes no `--host` anywhere.

```text
Airlock 4.0 CLI and plan state: authority (what runs, when it is done)
          |
airlock-herdr router: executor/model/effort selection, windows, pinning, fallback
          |
Herdr session/panes/agents: execution substrate (claude | codex | opencode panes)
```

## Invariants

The 0.1.0 adapter invariants carry over with two amendments. A change to any of these is a design change requiring a recorded decision.

1. Airlock's plan file is the only authoritative task record. Router state (correlation records **and the pinned chain**) is router-owned; Airlock never reads it.
2. No Herdr lifecycle state (`working`, `blocked`, `idle`, `done`, `unknown`), pane focus, prompt-wait return, or timeout may complete, audit, or fail a task. Signals only schedule reconciliation — **with one carve-out defined precisely in §Failure classes and fallback: a class-E executor-start failure, provably before prompt delivery, may advance the pinned chain. Substrate (herdr) failures and anything after an accepted prompt submission never do.**
3. Every Herdr wait has an explicit timeout.
4. The router never sends input to a blocked worker. Permission and question prompts are surfaced to the human.
5. Every Herdr call targets the named session and explicit resource IDs returned by earlier calls.
6. The router never runs `git push`, `merge`, `rebase`, `reset`, `clean`, `stash`, branch deletion, or worktree removal. Airlock `done` performs the only commit.
7. Dispatch fails closed on a missing/ambiguous route with the exact remedy printed; a missing executor agent file (opencode), missing binary, or unverifiable executor flag fails that **candidate** closed (pre-start skip, remedy recorded), and the whole dispatch fails closed with every remedy printed when no candidate survives (§Failure modes).
8. **(Amended.)** The 0.1.0 rule "fallback is human-classified" is replaced: the router advances its own pinned chain, but **only** on a class-E executor-start failure — one that provably occurred before the prompt was delivered (§Failure classes and fallback) — and at most twice per task (`pin.advanceCount`, mirroring the 3.x `MAX_FALLBACK_ADVANCES = 2`). After an accepted prompt submission — including stalls, wait timeouts, idle/exit without a result, and of course any agent output — the router never falls back; reconciliation decides audit/`done` vs `block`. Substrate failures (herdr itself unreachable) never advance and never block: they end the run with a retryable diagnostic and leave the task as-is. There is no `airlock fallback` verb in 4.0 to call.
9. The worker result nonce is best-effort corroboration; git evidence plus human inspection is the authoritative completion path.
10. State writes are atomic (temp file + `rename`) and every record mutation runs under the per-workflow advisory lock (§Workflow lock); every step transition is persisted before the step runs — including a `promptAttemptedAt` marker written before any prompt submission — so `reconcile` can resume from any crash without guessing whether a prompt may have been delivered.

## Airlock 4.0 CLI contract (what the router consumes)

Verified against `scripts/airlock.mjs` on the 4.0 branch (`package.json` 4.0.0). All router calls use `--json` and, for multi-plan repositories, `--plan <absolute path>`; **no `--host` flag is passed** (accepted-but-ignored in 4.0; the router drops it so the deprecation can complete). `CLAUDE_CODE_SUBAGENT_MODEL` is still stripped from the child environment.

- Success: exit 0, one JSON document on stdout. Failure with `--json`: exit ≥ 1 and `{"error": "<message>"}` on **stdout**. `next --unattended` with an open blocking decision: exit 2, `PARKED: <ids>`.
- **UPGRADED notice**: when a v3 plan is read, `UPGRADED plan schema airlock.plan/v3 -> airlock.plan/v4[ (risk: critical -> expensive on <ids>)]` appears on **stderr** and the JSON document carries `upgraded: true`. The router's `parseAirlockResult` must parse stdout as the JSON channel and treat stderr as log noise (the 0.1.0 client's "try stdout, then stderr" JSON probing remains safe — the notice is not JSON — but the contract is now: payload on stdout only). The router surfaces the notice verbatim once and otherwise ignores it.
- `next --json [--unattended]` → `{ text, task, agent }` where `task` is the selected task **id string** (or `null`). No `route` object exists. `agent` is the static `airlock-<role>` (or `null` with a `NOTHING TO DO` text). `text` is the complete TASK brief (grammar: `TASK <id> · <role>` / `GOAL` / `DO` / `OWNS` / `DONE` / `AGENT airlock-<role>` / optional `ASSUME`/`EVIDENCE`/`DIFF` / `RULES`); there is no `ROUTE`, `FALLBACK`, or `CLOCK OVERRIDE` line. Retain `text` verbatim: `start` never re-emits it, and `next` re-emits it only conditionally — when exactly one task is `doing`, `selectNext` returns that task and the brief carries a `(resume)` marker on the `DO` line. Reconcile's resume path may refresh a lost brief via `next` when that condition happens to hold, but the retained copy is the reliable source.
- `start <id> --json` → `{ text, task, agent }` where `task` is the **full task object** — unlike `next`, whose `task` is an id string. The router's step-6 mismatch check therefore compares the `agent` fields, never `task`. `text` is `STARTED <id>[ (resume)]` + `AGENT airlock-<role>`. `start` still fails on unfinished dependencies, open blocking decisions, ownership overlap without `--parallel`, and a dirty product worktree.
- `status --json` → `{ text, plan }`. **There is no `routes` array.** `plan.tasks[]` carries `expensive` (optional boolean) instead of `risk`; the router reads `expensive === true` to pick the tier. The 0.1.0 `detectFallbackAdvance` (which watched `status.routes`) is deleted — the router is now the only fallback engine.
- `audit`, `done --evidence`, `block --reason` — unchanged shapes. The router still never passes `--revert-out-of-scope`.
- **4.0 detection, fail closed**: at preflight the router runs `status --json` and requires the response to carry **no `routes` key**. Key presence, not truthiness, is the test: a present `routes` key — even the empty array 3.x emits when nothing is `doing` — means a 3.x CLI; refuse with `this router requires Airlock 4.0; for Airlock 3.x use the frozen adapter (plugin 0.1.0, tag v3.1.x)`. `status` is the probe because it is a read verb in both versions (verified: 3.x `status` only reads pins via `routeFor`); a 3.x `next` writes an offered route pin as a side effect (`ensureRoutePin`), which preflight must not trigger. The first real `next` keeps a belt-and-braces check on the same principle: `"route" in response` (key presence — 3.x emits `route: null` with nothing selected) → refuse. If that late check ever fires, the stray offered pin the 3.x `next` just wrote is harmless — it expires on its own five-minute TTL and the router refuses before dispatching anything.
- `AIRLOCK_NOW=<ISO>` remains a deterministic timestamp source in the 4.0 CLI (tests only). The router honors the same variable for its own window resolution (§Resolution), so one variable freezes both clocks in tests.

### Role and tier derivation

- `role` = the `agent` field with the `airlock-` prefix stripped (`builder`, `checker`, `browser`). The `AGENT` line in `text` is not parsed; the JSON field is authoritative.
- `tier` = `"expensive"` if the selected task's `expensive === true` in `status --json`'s plan, else `"default"`. The router runs `status` once per dispatch, after `next` and before `start`.

## Routing configuration: `routing.json`

### Location

The routing file lives in the plugin's Herdr config directory: the directory printed by `herdr plugin config-dir airlock.herdr` (verb verified present in herdr 0.8.2, `evidence/herdr-subcommands-0.8.2.txt`). Resolution order:

1. `--config-dir <path>` CLI flag (tests and non-plugin use).
2. `herdr plugin config-dir airlock.herdr` (requires herdr on PATH — which the router requires anyway).
3. Otherwise fail closed. The router does not invent a default under `$HOME` — the same rule the 0.1.0 adapter applies to its state dir. (A `~/.config/airlock-herdr/` fallback was considered and rejected for consistency with that rule; the 0.1.0 adapter resolves no config dir at all today, so nothing breaks.)

State (correlation records, operations log) stays where 0.1.0 put it: `$HERDR_PLUGIN_STATE_DIR` or `--state-dir`. Config and state never share a directory.

### Schema (version 1)

```json
{
  "version": 1,
  "bindings": {
    "builder": {
      "default": {
        "primary": { "executor": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "effort": "max" },
        "fallbacks": [ { "executor": "opencode", "model": "openrouter/z-ai/glm-5.3-flash", "effort": "max" } ],
        "windows": [
          {
            "name": "weekday-peak",
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "utc": "06:00-10:00",
            "executor": "opencode", "model": "command-code/z-ai/glm-5.3-flash", "effort": "max",
            "fallbacks": [ { "executor": "opencode", "model": "openrouter/z-ai/glm-5.3-flash", "effort": "max" } ]
          }
        ]
      },
      "expensive": { "primary": { "executor": "claude", "model": "opus", "effort": "high" } }
    },
    "checker": { "default": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-terra", "effort": "medium" } } },
    "browser": { "default": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-luna", "effort": "medium" } } }
  }
}
```

Keys: `bindings.<role>.<tier>` with `role ∈ {builder, checker, browser}` and `tier ∈ {default, expensive}` — `expensive` matches v4's boolean exactly; there are no other tiers and no tier inheritance (a missing `expensive` binding fails closed for an expensive task; it never falls back to `default`).

A **candidate** is `{ executor, model, effort }`:

- `executor` — required, one of `claude`, `codex`, `opencode` (the three `--kind` values the router dispatches; all three verified present in `herdr agent start --kind`'s possible-values list, herdr 0.8.2).
- `model` — required non-empty string, in the executor's native form (claude: alias or full name, e.g. `opus`, `claude-fable-5`; codex: model name; opencode: `provider/model`).
- `effort` — optional; non-empty string or `null`/absent (absent means: do not pass any effort/variant flag). For `executor: "claude"` the value must be one of `low|medium|high|xhigh|max` (the enum printed by `claude --help`, verified below); for codex and opencode it is provider-defined and passed through verbatim.

A **binding** is `{ primary, fallbacks?, windows? }`. Unknown keys anywhere in `routing.json` are rejected (fail closed — this is a new format; the 3.x reader's tolerance is not carried over).

### Validation rules (preserved verbatim from the removed 3.x semantics)

Recovered from `git show bae9097~1:scripts/airlock.mjs` (`parseClock`, `validateCandidate`, `validateFallbacks`, `validateWindow`, `validateRoute`); each rule below keeps its 3.x behavior, re-keyed from `{model, effort}` to `{executor, model, effort}`:

- **Clock** (`parseClock`): times are `HH:MM` UTC matching `^([01]\d|2[0-4]):[0-5]\d$`; `24:00` is legal **only** as a window end. Errors: `<label> must be HH:MM UTC`, `<label> may use 24:00 only as a window end`.
- **Window** (`validateWindow`): requires `name`; `days` a non-empty array drawn from `mon…sun`; `utc` exactly `START-END` (one dash); `startMinutes < endMinutes` — **windows cannot cross midnight**; the error text keeps the 3.x remedy: `cannot cross midnight; use two windows such as 22:00-24:00 and 00:00-02:00`. Each window carries its own complete candidate (`executor`/`model`/`effort` inline) and its own complete `fallbacks` — **no inheritance from the base binding** (per-window complete fallbacks, exactly as 3.x).
- **Window set** (`validateRoute`): if present, `windows` is a non-empty array; duplicate window names are rejected; two windows sharing any day and overlapping in time (`left.start < right.end && right.start < left.end`) are rejected as `windows <a> and <b> overlap`.
- **Fallbacks** (`validateFallbacks`): if present, a non-empty array of at most **2** candidates (3.x `MAX_FALLBACK_ADVANCES = 2`; a chain is at most 3 candidates); a candidate duplicating the binding's primary or another fallback — same `executor`+`model`+`effort` triple — is rejected as a duplicate.
- **Whole file**: `version` must be `1`; `bindings` roles/tiers restricted to the enumerations above; every binding validated independently; any error names the exact JSON path (`bindings.builder.default.windows[0] start must be HH:MM UTC`).

There is **no catalog**. The 3.x OpenCode variant catalog is not carried over: effort/variant legality is checked against the executor CLI's own help surface (evidence-gated tests, §Test plan) and by the executor itself at launch, not against a local declaration.

## Resolution algorithm and pinning

`resolveChain(bindings, role, tier, now)` — a pure function, `now` defaulting to the current UTC time and overridable by `AIRLOCK_NOW`:

1. `binding = bindings[role][tier]`; missing → fail closed (§Failure modes; the task is not started).
2. `minute = now.getUTCHours() * 60 + now.getUTCMinutes()`, `day = ["sun","mon",…][now.getUTCDay()]`.
3. `selected` = the first window with `day ∈ days && startMinutes <= minute && minute < endMinutes`, else the base binding. (Non-overlap validation makes "first" unambiguous.)
4. Chain = `[selected primary, ...selected.fallbacks]` — one to three candidates, all from the same window (or all from the base binding); no cross-mixing.
5. Return `{ role, tier, window: <name or "default">, resolvedAt: now ISO, candidates, candidateIndex: 0, advanceCount: 0, failures: [] }`.

**Pinning lifecycle** (replaces Airlock's removed pins; deliberately simpler — no offered-pin TTL, no five-minute expiry, no preview state):

- The chain is resolved **once, at dispatch time**, and written into the task's correlation record (`pin` field) in the same atomic write that records the `offered` state.
- The pin holds for the life of the task: resume after a crash, reconcile, prompt retries, and fallback advances all reuse the recorded chain — the clock is never re-consulted, so a task dispatched inside a peak window keeps its peak-window chain even if it finishes after the window closes (same behavior the 3.x doing-task pin guaranteed).
- The pin dies with the record when the record settles: the task reached `done` or `blocked`, **or** the record was settled as `superseded` because an answered decision reopened the task (§Reconciliation). A later re-dispatch of the same task therefore always resolves a fresh chain at the new dispatch time — the superseded row is what makes that re-dispatch reachable.
- `candidateIndex` and `advanceCount` move only per §Failure classes and fallback; `failures[]` records `{at, candidate, class, code, detail, fromAttempt}` per skip or advance.

## Executors and verified launch invocations

The router dispatches all three executors through the same Herdr surface the 0.1.0 adapter proved out:

```bash
herdr agent start <agentName> --kind <claude|codex|opencode> --pane <paneId> --timeout <ms> -- <executor args>
herdr agent prompt <agentName> "<TASK text + REPORT line>" --wait --until idle --until done --until blocked --timeout <ms>
herdr agent wait / herdr agent get / herdr pane read / herdr pane process-info   # monitoring
```

(herdr 0.8.2; full CLI capture in `extensions/herdr/evidence/`. `--kind` possible values include `claude`, `codex`, `opencode` — verified.)

The executor args after `--` carry the model/effort selection. **Verified locally on 2026-09-01** (these captures move into `evidence/` as `claude-cli-2.1.251.txt`, `codex-cli-0.151.0.txt`, `opencode-cli-1.18.25.txt`; the router's preflight re-verifies the required flags against the installed versions on every run and fails closed on drift):

| Executor | Version verified | Model flag | Effort flag | Role-agent flag | Launch args (Path A, after `--`) |
|---|---|---|---|---|---|
| `claude` | claude 2.1.251 | `--model <alias\|full name>` (e.g. `opus`, `claude-fable-5`) | `--effort <low\|medium\|high\|xhigh\|max>` (verbatim enum from `claude --help`) | `--agent <agent>` ("Agent for the current session") | `--agent airlock-<role> --model <model> [--effort <effort>]` |
| `codex` | codex-cli 0.151.0 | `-m, --model <MODEL>` | **no flag** — config override `-c` + `model_reasoning_effort=<effort>` (`model_reasoning_effort` verified as a real `ConfigToml`/`ConfigProfile` key in the codex 0.151.0 binary; `codex --help` documents the `-c key=value` mechanism) | **none** — codex has no agent-file concept; the TASK brief itself (its `RULES` lines) plus Airlock's ownership audit are the guardrails | `-m <model> [-c model_reasoning_effort=<effort>]` — two argv tokens: `-c`, then the single unquoted token `model_reasoning_effort=<effort>`. Args after `--` are argv elements herdr passes with no shell, so shell/TOML-style quoting must not be copied in (embedded `"` would reach codex literally); `executors.test.mjs` pins this exact token form. |
| `opencode` | opencode 1.18.25 | `-m, --model <provider/model>` | interactive TUI: **none** (verified absent from `opencode --help`); headless: `opencode run --variant <v>` ("provider-specific reasoning effort, e.g., high, max, minimal") | `--agent <agent>` (present on both the interactive default command and `opencode run`) | effort `null` → Path A: `--agent airlock-<role> -m <provider/model>`; effort set → **Path B forced** (below) |

**OpenCode paths.** The 0.1.0 Path A/B split (interactive `--agent` vs headless `opencode run`) is kept and gains one rule: because the interactive TUI accepts `--model` and `--agent` but **not** `--variant` (verified on 1.18.25; the earlier `evidence/opencode-v3-agent-flag-0.8.2-1.18.18.txt` capture agrees in its verbatim help text — though its prose summary wrongly lists `--variant` among the interactive options; see §Evidence), an opencode candidate with a non-null `effort` always dispatches Path B:

```bash
# executed via: herdr pane run <paneId> '<command>' + herdr pane wait-output --match "AIRLOCK-RESULT <nonce>" --timeout <ms> <paneId>
opencode run --agent 'airlock-<role>' -m '<provider/model>' --variant '<effort>' "$(cat '<promptFile>')"
```

**Every value interpolated into this line is shell-quoted.** The agent name, `model`, `effort`, and the prompt-file path each pass through `shellQuote(value)` — single-quote wrapping with the `'\''` escape. Implementation note: no named helper exists in 0.1.0; `pathBCommand` in `src/dispatch.mjs` carries the escaping inline and applies it to the prompt path only. The router hoists that idiom into a named `shellQuote` and applies it to all four values, because `model` and `effort` come straight from `routing.json` (validated only as non-empty strings) and this line — unlike executor args after `--` — is executed by the pane's interactive shell via `herdr pane run`; an unquoted `;` or `$()` in a config value must not execute there.

This also corrects the 0.1.0 `pathBCommand`, which emitted `opencode run --agent "$(cat '<promptFile>')"` — passing the prompt as the `--agent` value and dropping the agent entirely. The router's Path B command places `--agent`, `-m`, and `--variant` explicitly and passes the prompt as the positional message. One benign artifact: `pane wait-output --match "AIRLOCK-RESULT <nonce>"` may match the echoed message text (the typed REPORT line) before any real result exists — harmless, because a match only schedules reconciliation (Invariant 2), and an actual result is detected solely by the strict parse of §Failure classes and fallback condition 2.

**claude and codex** dispatch Path A only (interactive agent in the pane, prompt via `herdr agent prompt`). There is no headless path for them in this version.

**Executor-specific preflight (generalizing 0.1.0's V3–V5), run per candidate in chain order at dispatch step 4.** A candidate failing any of these checks is a **pre-start skip**: a `pin.failures` entry (class `executor-missing` or `executor-preflight`), `candidateIndex` moved past it, `advanceCount` untouched (§Failure classes and fallback), and the chain continues into the next candidate — a chain may legitimately continue into a claude or codex candidate that needs no opencode artifact. Only when no candidate survives does dispatch exit 6, printing each skipped candidate's remedy; `airlock start` was never called, the task stays `todo`.

- Binary presence per candidate executor (PATH probe, as V4 did for opencode). The resolved real path is recorded; for opencode the approved-path process check (`pane process-info`) is kept; for claude and codex the same check applies with their resolved paths.
- Flag presence per executor: the router captures `<executor> --help` (and `opencode run --help`) and requires the flags in the table above; a missing/renamed flag skips the candidate with the observed help text in the `failures[]` entry — never guess (V2 discipline applied to executors). Because this runs pre-start for every candidate, flag drift never surfaces mid-chain.
- Agent file (V5, re-targeted for 4.0): for an `opencode` candidate, the **project-local** `.opencode/agent/airlock-<role>.md` must exist (4.0's `init --host opencode` writes it; the 3.x user-config `~/.config/opencode/agents/<generated>.md` location is gone). Absence skips the candidate; the remedy recorded and printed is `run: airlock init --host opencode in <repo>`. For `claude`, the `airlock-<role>` agents ship inside the Airlock Claude Code plugin (or a user/project override); there is no reliable file path to probe, so the router performs no file check and relies on launch failure (class E) plus the release acceptance check below. For `codex`, no agent artifact exists by design.
- Acceptance check before release (evidence-gated, mirrors the 4.0 spec's own): launch each executor once with the table's args and confirm the session actually runs the requested model/effort/agent (claude: `--agent airlock-builder` resolves against the installed Airlock plugin; codex: `model_reasoning_effort` visibly applied; opencode: `--variant` accepted by `run`). Record the transcripts in `evidence/`.

## State, dispatch, reconcile, fallback

### State records (recordVersion 2)

The 0.1.0 layout is kept — `<state-dir>/<session>/<workflowKey>/tasks/<taskId>.json` + `operations.jsonl`, atomic writes, `workflowKey = sha256(repoRoot + "\n" + planPath).slice(0, 16)` — with these field changes:

```json
{
  "recordVersion": 2,
  "executor": "opencode",
  "agent": "airlock-builder",
  "pin": {
    "role": "builder", "tier": "default", "window": "weekday-peak",
    "resolvedAt": "2026-09-01T07:12:00.000Z",
    "candidates": [ { "executor": "opencode", "model": "…", "effort": "max" }, { "executor": "opencode", "model": "…", "effort": "max" } ],
    "candidateIndex": 0,
    "advanceCount": 0,
    "failures": []
  },
  "promptAttemptedAt": null,
  "parkedForHuman": null,
  "dispatchPath": "A-interactive | B-headless"
}
```

- `executor` replaces `host` (`"opencode"` constant in 0.1.0). `route` is replaced by `pin`, which adds `advanceCount` (the budget counter, distinct from `candidateIndex`; §Failure classes and fallback) and `failures[]` entries of `{at, candidate, class, code, detail, fromAttempt}` (`fromAttempt: null` for pre-start skips). `agent` is the static `airlock-<role>` (informational). Two new record fields: `promptAttemptedAt` — persisted immediately **before** any prompt submission call, so a `null` value proves no prompt can have been sent (Invariant 10) — and `parkedForHuman` — the decision id when Airlock parked the task on `needs-you` (§Reconciliation).
- The state enum gains one value: `offered → started → pane-created → agent-started → prompted → needs-reconcile → settled | failed` plus **`launch-pending`** — an advanced attempt persisted before its pane exists. `launch-pending` is in-flight; its reconcile row resumes the launch of the same recorded candidate, never a further advance. `settledAs` gains the value `superseded` (reopened task; §Reconciliation). Everything else — `taskText` retained verbatim, `nonce`, `agentName` (`al-<taskid>-a<attempt>`), `workspaceId`/`paneId`, attempt/`advanceAttempt` history preservation — is unchanged.
- A recordVersion 1 record found on disk is treated as in-flight legacy: reconcile reports it and asks the human to settle it with the 0.1.0 adapter or by hand; the router never dispatches while one exists (fail closed rather than migrate live state).

### Workflow lock

Dispatch and reconcile are both plugin actions and CLI verbs, and 0.2.0's automatic advance makes concurrent runs destructive (double-advance, double-`block`). The `state.mjs` atomic write pattern (temp file + `rename`) is kept but is not enough on its own: it prevents torn files, not lost read-modify-write updates. Every mutating verb therefore acquires a per-workflow advisory lock before its first read of the record directory and holds it until exit:

- Lock file: `<state-dir>/<session>/<workflowKey>/lock`, created with `O_EXCL` (fs flag `wx`), containing `{ pid, hostname, acquiredAt }`.
- Contention: print `LOCKED by pid <pid> since <acquiredAt>; re-run when it finishes`, exit 69 — retryable; nothing was read or written.
- Stale takeover: if the lock's `pid` is not alive on the same `hostname`, **or** `acquiredAt` is older than 2× `DEFAULT_TIMEOUT_MS` (30 minutes), the runner logs `lock-takeover` to `operations.jsonl`, unlinks the file, and retries the `O_EXCL` create exactly once — two racing takeovers still yield one winner (the loser's create fails and it exits 69).

**Advance idempotency.** An advance is one atomic record write that appends the `failures[]` entry, increments `candidateIndex`, increments `advanceCount` when the budget is consumed, and creates the new attempt in state `launch-pending`. Before persisting, the runner re-reads the record under the lock and compares `candidateIndex` against the value its decision was based on; a difference means another runner already advanced — abort without advancing. Each budget-consuming `failures[]` entry records `fromAttempt`; a second advance from the same attempt is refused. A crash after the advance write but before the pane exists leaves the `launch-pending` record, which dispatch and reconcile treat as resume-the-same-candidate — never as a fresh qualifying failure — so a crash loop can never burn the advance budget.

### Dispatch algorithm (delta over 0.1.0's twelve steps)

`dispatch --session S --repo R [--plan P]`:

1. Acquire the workflow lock (§Workflow lock; contention → exit 69). Preflight: herdr V1/V2 (plus the `plugin config-dir` verb), Airlock-4.0 shape detection (`status --json` without a `routes` key), `ensureSession(S)`. A herdr-level failure anywhere here is class S: exit 69, nothing dispatched. If in-flight records exist, first evaluate the **superseded** row (§Reconciliation: record in flight but the plan task is back to `todo`) and settle what it allows; any record still in flight after that → `RECONCILE REQUIRED`, exit 3.
2. `airlock next` (no `--host`). `error` → print `AIRLOCK ERROR: …`, exit with airlock's own code (passthrough, §Plugin surface); `task: null` → record and print `NOTHING TO DO`, exit 0.
3. `airlock status` → tier from `expensive === true`; role from `next`'s `agent` field. Load and validate `routing.json`; **resolve the chain now** (§Resolution). Missing file/binding → fail closed (exit 6, task untouched, §Failure modes).
4. Per-candidate executor preflight in chain order (§Executors): binary presence, required flags, opencode agent file. Failing candidates are **pre-start skips** — `pin.failures` entry (class `executor-missing`/`executor-preflight`, `fromAttempt: null`), `candidateIndex` advanced past them, `advanceCount` untouched. If no candidate survives, print each candidate's remedy and exit 6 — `airlock start` was never called, the task stays `todo`.
5. Persist the record (`offered`) with `pin`, `taskText` verbatim, fresh `nonce`.
6. `airlock start <id>`. `error` → delete offered record, exit with airlock's code (passthrough). Verify `start`'s `agent` equals `next`'s `agent` — the `agent` JSON fields, never `task` (an id string in `next`, a full object in `start`); both static in 4.0, so a mismatch means the plan changed under us → `airlock block <id> --reason "agent changed between next and start"`, record `failed`, exit 5.
7. Create workspace/pane (`al-<taskid>-a<attempt>` label, cwd R). Start the executor: `herdr agent start <agentName> --kind <executor> --pane <paneId> -- <args from the table>` (opencode effort-set candidates: Path B via `pane run` instead). Process-path verification where `process-info` is available.
8. Persist `promptAttemptedAt` (with the `agent-started` record write), **then** deliver the prompt — `taskText` + `\n` + the unchanged `REPORT … AIRLOCK-RESULT <nonce> …` line — via `agent prompt … --wait --until idle --until done --until blocked --timeout <ms>` (Path A) or as the `run` message with `pane wait-output --match "AIRLOCK-RESULT <nonce>"` (Path B).
9. Classify every failure in steps 7–8 by §Failure classes and fallback, exactly one of:
   - **Class S (substrate)** — the herdr call itself failed (`herdr_not_installed`, `spawn_error`, a timeout of the herdr CLI call, `cli_usage`, daemon/socket unreachable): mark `needs-reconcile` with the diagnostic, print `HERDR UNAVAILABLE <detail> (retryable; the chain was not advanced)`, exit 69. The task stays `doing`; a later run retries the **same** candidate.
   - **Class E (executor start)** — the failure provably precedes prompt delivery (launch rejected for the named kind, process-path mismatch at launch, pane/agent dead before submission — i.e. before `promptAttemptedAt` was set): advance in-process. Close the plugin-owned dead pane if one exists, perform the one atomic advance write (§Workflow lock: `failures[]` + `candidateIndex + 1` + `advanceCount + 1`, new attempt persisted as `launch-pending` with a new `agentName`/`nonce`), then re-enter step 7 with the next candidate — the task stays `doing`, `airlock start` is not re-run (a `doing` task needs no re-start for a fresh pane; the retained `taskText` is reused). Budget and exhaustion per §Failure classes and fallback.
   - **`agent_blocked`** — herdr refused the submission because the agent is already waiting at a permission/question prompt: `needs-reconcile` (Invariant 4 — the human answers the pane), print `RECONCILE <id>`, exit 0.
10. **Everything at or after an accepted submission is class P** — wait state match, wait timeout, `agent_prompt_stalled`, idle/exit, anything: `needs-reconcile`, print `RECONCILE <id>`, exit 0 (Invariant 2). No class-P signal ever advances the chain. Note on stall: herdr reports `agent_prompt_stalled` only after an **accepted** submission (the text was sent; no state change was observed within 5000 ms — verified against `herdr agent prompt --help`, 0.8.2), and the 0.1.0 `agentPrompt` envelope classifying stall as `delivered: true` is **kept**.

### Failure classes and fallback (the only automatic chain advance)

Every failure the router observes gets exactly one class; the class fixes the handling in all three call sites — dispatch steps 9–10, the reconcile table, and the failure-modes table state one rule.

- **Class S — substrate.** Herdr itself failed: `herdr_not_installed`, `spawn_error`, a timeout of the herdr CLI call, `cli_usage`, an unreachable daemon/socket, or a failed session snapshot at reconcile. A substrate failure teaches nothing about the candidate — the next candidate's `herdr agent start` would fail identically. Class S **never advances the chain and never blocks the task**: the record goes to `needs-reconcile` with the diagnostic and the run exits 69 (retryable); the task and pin stay exactly as they were. This keeps "absence of Herdr is never an Airlock error" true under automation.
- **Class E — executor start.** The executor failed **provably before prompt delivery**: a step-4 pre-start skip (binary absent, flag drift, opencode agent file missing), `herdr agent start` rejecting the launch for the named kind, process-path verification mismatch at launch, or the pane/agent dying before any submission was attempted. Class E is the only class that can advance the chain.
- **Class P — post-delivery.** Anything at or after an accepted prompt submission: `agent_prompt_stalled`, wait timeouts, `blocked` prompts, pane idle/done/exit without a result, the pane/agent disappearing after delivery, and any agent output. Class P **never** advances — the worker got the task; reconcile's decision table settles audit/`done` vs `block` with the human (the 3.x rule "never fallback after any child result", tightened to "after any accepted submission").

The router advances `candidateIndex` **iff all of**:

1. A class-E failure occurred. At dispatch time the classification is direct — the failing call's error code. At reconcile time it must be **proven from the persisted record plus live corroboration**, all four required:
   - `record.promptAttemptedAt` is `null` — dispatch persists it before any submission call, so null proves no prompt can have been sent;
   - the record state is `pane-created` or `agent-started` (a `launch-pending` record is resumed, not re-advanced; §Workflow lock);
   - a **successful** session snapshot shows the workspace/agent gone or the agent exited — a failed snapshot (`snap.ok === false` in the 0.1.0 `adoptPaneByName`) is class S and must never be read as "pane gone";
   - condition 2 holds.
2. **No agent result exists**: the strict `detectNonce` parse — `^AIRLOCK-RESULT <nonce> (ok|blocked)\s+<non-placeholder summary>$`, exactly the regex already in `src/reconcile.mjs` — finds no result line in the bounded pane read, **and** `git status --porcelain` shows no product change outside the plan and `.airlock/` (the 0.1.0 `productChanges` filter). A substring check is forbidden everywhere this rule applies: in Path A the typed prompt itself always contains `AIRLOCK-RESULT <nonce>` (the REPORT instruction), which the strict parse rejects and a `.includes` would not. Implementation note: `src/render.mjs`'s `nonceSeenIn` is a plain `.includes(nonce)` and must be updated to the strict parse so `status`/`watch` rows agree with reconcile. Any product change or any parsed result line means the worker produced something → never fall back.
3. `candidateIndex < candidates.length - 1` **and** `pin.advanceCount < 2`. **Only actual class-E advances consume the budget**: a post-start advance increments both `candidateIndex` and `advanceCount`; a step-4 pre-start skip moves `candidateIndex` and appends to `failures[]` but leaves `advanceCount` at 0 — it launched nothing and cost nothing. (Recorded deviation from 3.x, whose bound was `candidateIndex`-based only: the split keeps a chain from being exhausted by skips of never-launched executors.)

Each advance is the atomic, idempotent write of §Workflow lock (new `agentName`, new `nonce`, new pane; prior record content preserved in `operations.jsonl`) and logs `FALLBACK <id> · candidate <i+1>/<n> · <executor> <model>`. An **exhausted chain** — a class-E failure with no candidate or no budget left — runs `airlock block <id> --reason "route chain exhausted: <per-candidate failure summary, sanitized>"` and settles the record (`settledAs: blocked`). Class S never reaches the exhaustion path: it is not a chain failure.

### Reconciliation (delta over 0.1.0's decision table)

Reconcile runs under the same workflow lock (contention → exit 69). If the initial `airlock status` fails with an airlock error, the run exits with airlock's code (passthrough); if the herdr session snapshot fails, the run is class S — print the diagnostic, mutate nothing, exit 69. A pane is treated as gone only on a **successful** snapshot that lacks it. The decision table is kept row-for-row with these changes:

- `detectFallbackAdvance` (3.x `status.routes` watching) is deleted; the router's own pin is the only chain.
- **Superseded (new row — the rework path).** The record is in any in-flight state but the plan task is back to `todo`: an answered decision reverted it (rework additionally sets `startedAt: null` and a `reopened after …` note; an answered `needs-you` flips silently — the trigger is the `todo` status itself, since any record beyond `offered` proves the router's own `start` once made the task `doing`). Settle the record as `settledAs: superseded`: if a plugin-owned pane exists and a successful snapshot shows its agent exited or idle, close it; verify the product worktree is clean (`productChanges` empty); archive the record — the pin dies with it, so the next dispatch resolves a fresh chain at the new dispatch time. If the worktree is dirty or the agent is still working, the row prints what it found and stays unresolved (nothing is closed; the human finishes or cleans first — an explicit path, not a wedge). Dispatch evaluates this same row at its step 1, so answer-driven reopening can never dead-end behind exit 3. This row replaces the 0.1.0 "TASK REOPENED … redispatch yourself" branch, which parked the record in `needs-reconcile` forever with no settling row.
- **`launch-pending` (new row).** An advance persisted its new attempt but crashed before the pane existed: resume the launch of the **same** recorded candidate (dispatch steps 7–8 with the recorded `agentName`/`nonce`) — never a further advance, never a fresh qualifying failure (§Workflow lock).
- **Orphan row** (workspace/agent missing on a **successful** snapshot) gains a first branch: if §Failure classes and fallback conditions 1–3 all hold — which requires `promptAttemptedAt: null` — advance automatically (fresh pane, next candidate) and print `FALLBACK <id> · <from> -> <to>`. Otherwise (a prompt may have been sent, or no candidate/budget remains) the 0.1.0 human choices remain: resume the same candidate / block; with an exhausted chain the row becomes `airlock block`.
- **The "no nonce; pane idle/exited; no changes" row never auto-advances.** The pane exists and the submission was accepted — class P by definition; the 0.1.0 human choices (one prompt retry / block / leave unresolved) remain. (An earlier draft added an advance branch here; it contradicted "the worker got the task → never fall back" and is gone.)
- **`needs-you` no longer settles or closes anything.** Airlock parking a task on a blocking decision is a pause, not a settlement: the worker may be mid-run with unsaved context, and killing its pane leaves a dirty worktree that `start` then trips over after the answer. The row now keeps the record in flight (`needs-reconcile`, `parkedForHuman: <decision id>`), leaves the pane untouched, and prints `PARKED <id> on <decision>; answer it, then re-run reconcile` — after the answer the task is `todo` and the superseded row settles the record. Only `done` and `blocked` remain externally-settled states, and even their settles close only plugin-owned panes whose agent state is exited or idle on a successful snapshot (a live working pane is never closed; the settle proceeds and the pane is reported for the human to close).
- The fallback-suggestion text (0.1.0 printed a ready-to-run `airlock fallback …` command line) is deleted from reconcile and from dispatch's delivery-failure path — the verb no longer exists.
- All completion paths are unchanged: strict-nonce-ok/changes → human-confirmed `audit` → `done --evidence`; worker-blocked or audit failure → `block`; Airlock-already-`done`/`blocked` → sync the record. No path completes a task without a human confirmation input.

## `import-routes`: one-shot 3.x conversion

`airlock-herdr import-routes [--from <path>] [--host <claude|opencode>] [--config-dir <path>] [--dry-run]`

Converts a 3.x `models.json` into `routing.json` version 1, conservatively:

- `--from` defaults to the 3.x resolution chain **verbatim**: `AIRLOCK_CONFIG` if set, else `<userConfigDir>/models.json`, where `userConfigDir` is `AIRLOCK_CONFIG_DIR` if set, else `$XDG_CONFIG_HOME/airlock`, else `~/.config/airlock` — the recovered 3.x `userConfigDir` order, honored in full so the importer reads exactly the file 3.x read on machines using `AIRLOCK_CONFIG_DIR` or `XDG_CONFIG_HOME`. The 3.x **project** config (`.git/airlock/models.json`) is **not** merged — if one exists the notice says so and how to import it explicitly. Refuses to overwrite an existing `routing.json` (no `--force` in this version; delete it by hand first — one-shot means one-shot).
- A 3.x file has independent `claude` and `opencode` host sections. Each maps to its executor (`claude` rows → `executor: "claude"`, `opencode` rows → `executor: "opencode"`; provider/model strings and variant/effort values are kept verbatim). Since a v1 binding holds **one** chain per role×tier, the importer never merges hosts: if exactly one host section is non-empty it is used; if both are, `--host` is **required** and the other section is reported as skipped, listing every skipped row. Guessing a cross-host ordering is exactly what "conservative" forbids.
- Anything it cannot map is listed and the run **exits non-zero having written nothing** (also honored by `--dry-run`, which prints the would-be file and notices).

Mapping table:

| 3.x input | routing.json v1 output |
|---|---|
| `<host>.<role>.standard` row | `bindings.<role>.default` |
| `<host>.<role>.critical` row | `bindings.<role>.expensive` |
| `<host>.<role>.light` row | **dropped**, explicit notice (no v4 tier exists for it) |
| `<host>.<role>.complex` row | **dropped**, explicit notice (v4 upgrade maps `complex` to not-expensive; its distinct route has no home) |
| row `model`/`effort` | candidate `model`/`effort`, `executor` = the host's executor |
| row `effort: "none"` | candidate `effort` **omitted** (`null`), per-row notice `MAPPED effort "none" -> omitted`. The 3.x catalog legally declared `none` as an opencode variant meaning "pass no variant flag"; imported verbatim it would force Path B and emit `opencode run --variant none`, which is provider-dependent and not what the row meant. Omission keeps the row Path-A eligible. |
| row `fallbacks` (≤ 2) | candidate `fallbacks`, same cap |
| row `windows` (name/days/utc + inline candidate + per-window fallbacks) | `windows`, unchanged semantics |
| `catalog` | **dropped**, notice (variant legality is now evidence-gated, §Executors) |
| `version` 1/2/3 | accepted input; output is always `version: 1` of this format |
| unknown host/role/risk keys, malformed rows | **unmapped → listed, exit non-zero, nothing written** |

### Worked example: the real config

Input: `/home/ivan-tretyakov/.config/airlock/models.json` (version 3; both host sections populated, so `--host` is required — the motivating run is `import-routes --host opencode`). Output, in full:

```json
{
  "version": 1,
  "bindings": {
    "builder": {
      "default": {
        "primary": { "executor": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "effort": "max" },
        "fallbacks": [ { "executor": "opencode", "model": "openrouter/z-ai/glm-5.3-flash", "effort": "max" } ],
        "windows": [
          {
            "name": "weekday-peak",
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "utc": "06:00-10:00",
            "executor": "opencode", "model": "command-code/z-ai/glm-5.3-flash", "effort": "max",
            "fallbacks": [ { "executor": "opencode", "model": "openrouter/z-ai/glm-5.3-flash", "effort": "max" } ]
          }
        ]
      },
      "expensive": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-sol", "effort": "medium" } }
    },
    "checker": {
      "default": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-terra", "effort": "medium" } },
      "expensive": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-sol", "effort": "high" } }
    },
    "browser": {
      "default": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-luna", "effort": "medium" } },
      "expensive": { "primary": { "executor": "opencode", "model": "openai/gpt-5.6-terra", "effort": "medium" } }
    }
  }
}
```

Notices printed (exit 0 — everything mapped or deliberately dropped):

```text
IMPORTED 6 bindings from /home/ivan-tretyakov/.config/airlock/models.json (--host opencode)
DROPPED light rows: opencode/builder/light (zai-coding-plan/glm-5.3-flash@high + weekday-peak + 1 fallback), opencode/checker/light, opencode/browser/light
DROPPED complex rows: opencode/builder/complex (zai-coding-plan/glm-5.3@high + weekday-peak command-code/zai-org/glm-5.3@high + 1 fallback), opencode/checker/complex, opencode/browser/complex
SKIPPED host section: claude (12 rows) — re-run with --host claude into a separate --config-dir if you want them
DROPPED catalog: 9 opencode variant declarations (variant legality is now checked against the live CLI)
```

The imported behavior this preserves is the config's point: builders steer `glm-5.3-flash` from `zai-coding-plan` to `command-code` during the weekday 06:00–10:00 UTC peak, with an `openrouter` fallback in both the base binding and the window. Note honestly: the full (non-flash) `glm-5.3` steering via `command-code/zai-org` lives in the 3.x `complex` row, which the conservative mapping drops — a user who wants it back promotes it by hand into `default` or `expensive`. Also note: every imported opencode candidate carries an effort, so every dispatch from this file uses opencode Path B (`opencode run --variant …`), per §Executors.

## Plugin surface

`herdr-plugin.toml` — id unchanged (`airlock.herdr`, preserving the config-dir and any linked-plugin registration), name and version updated, one action added:

```toml
id = "airlock.herdr"
name = "Airlock Herdr Router"
version = "0.2.0"
min_herdr_version = "0.8.2"
platforms = ["linux"]

[[actions]]
id = "dispatch"
title = "Dispatch next Airlock task"
command = ["node", "bin/airlock-herdr.mjs", "dispatch"]

[[actions]]
id = "reconcile"
title = "Reconcile Airlock task"
command = ["node", "bin/airlock-herdr.mjs", "reconcile"]

[[actions]]
id = "status"
title = "Show Airlock and Herdr status"
command = ["node", "bin/airlock-herdr.mjs", "status"]

[[actions]]
id = "import-routes"
title = "Convert a 3.x models.json to routing.json"
command = ["node", "bin/airlock-herdr.mjs", "import-routes"]

[[panes]]
id = "status"
title = "Airlock status"
placement = "tab"
command = ["node", "bin/airlock-herdr.mjs", "watch"]
```

CLI: `airlock-herdr <dispatch|reconcile|status|watch|import-routes>` with the 0.1.0 flags plus `--config-dir <path>`; `import-routes` additionally takes `--from`, `--host`, `--dry-run` and needs neither `--session` nor `--repo`. `status`/`watch` rows gain the executor and chain position: `T001 · attempt 2 · prompted · opencode · candidate 2/3 · pane working · nonce not seen` (the nonce column uses the strict `detectNonce` parse, §Failure classes and fallback condition 2).

**The `import-routes` toml action and its flags.** `herdr plugin action invoke` passes no arguments beyond the action id (verified: `Usage: herdr plugin action invoke [OPTIONS] <ACTION_ID>`, sole option `--plugin <ID>` — `evidence/herdr-subcommands-0.8.2.txt`), so the action cannot carry `--host`/`--from`. To stay genuinely invocable from the Herdr UI, `import-routes` reads flag defaults from `<config-dir>/import-defaults.json` — keys `from` and `host` only, unknown keys rejected fail-closed, CLI flags overriding file values. Invoked with no flags, no defaults file, and both 3.x host sections populated, it exits non-zero having written nothing, and the message names both remedies: the CLI invocation with `--host`, and the defaults file for action use.

**Exit codes.** Airlock's own codes (1 generic, 2 `PARKED`) pass through verbatim and are reserved; the router's codes avoid them, using sysexits where apt. The 0.1.0 codes 2-usage and 4-executor-preflight are retired: 2 now unambiguously means airlock `PARKED`, and a failed per-candidate preflight is a step-4 skip that either dispatches a later candidate or exits 6.

| Code | Meaning |
|---|---|
| 0 | success — including `NOTHING TO DO` and a class-P `RECONCILE <id>` handoff |
| 1 | airlock failure, passed through (output prefixed `AIRLOCK ERROR:`) |
| 2 | airlock `PARKED` under `next --unattended`, passed through |
| 3 | reconcile required — an in-flight record remains after the superseded-row evaluation |
| 5 | agent mismatch between `next` and `start` |
| 6 | route resolution: missing/invalid `routing.json`, missing binding, or no candidate surviving step 4 |
| 64 | usage error (`EX_USAGE`) — bad router flags/arguments; never emitted for airlock conditions |
| 69 | substrate unavailable (`EX_UNAVAILABLE`): class-S herdr failure or workflow-lock contention; retryable, chain untouched |
| 70 | internal router error (`EX_SOFTWARE`) |
| 78 | environment precondition (`EX_CONFIG`): herdr too old / verb missing, or an Airlock 3.x CLI detected — operator action needed, not retryable |

## Failure modes — all fail closed

| Failure | When detected | Behavior |
|---|---|---|
| Herdr absent | preflight V1, before anything | `Herdr not installed: … Install Herdr >= 0.8.2, or run Airlock without the router.` Exit 69 (class S, retryable after install). No Airlock command was run; absence of Herdr is never an Airlock error. |
| Herdr `< 0.8.2` or verb/flag missing (incl. `plugin config-dir`) | preflight V1/V2 | Refuse with the observed help text; never guess a renamed verb. Exit 78. |
| Herdr daemon/socket dies mid-run, or a herdr CLI call times out | any herdr call, dispatch or reconcile | Class S: record `needs-reconcile` with the diagnostic, `HERDR UNAVAILABLE … (retryable; the chain was not advanced)`, exit 69. Task and pin untouched; the next run retries the same candidate. |
| Workflow lock held by a live runner | first state access | `LOCKED by pid <pid> since <ts>; re-run when it finishes`. Exit 69; nothing read or written. Stale locks are taken over per §Workflow lock. |
| Airlock is 3.x (`routes` key in `status --json`, or `route` key in `next --json`) | preflight / first `next` | `this router requires Airlock 4.0; for Airlock 3.x use the frozen adapter (plugin 0.1.0, tag v3.1.x)`. Exit 78. Key-presence test; see §CLI contract for the harmless 3.x pin side effect on the late check. |
| `routing.json` missing | dispatch step 3 | `no routing.json at <config-dir>; create it, or convert a 3.x config once with: airlock-herdr import-routes --host <claude|opencode>`. Exit 6; task untouched. |
| `routing.json` invalid | load | The exact 3.x-style validation message with the JSON path. Exit 6; task untouched. |
| Route missing for `<role>/<tier>` | dispatch step 3 | `no route for <role>/<tier>; add bindings.<role>.<tier> to <config-dir>/routing.json, e.g. {"primary": {"executor": "opencode", "model": "<provider/model>", "effort": null}} — or import a 3.x config with: airlock-herdr import-routes --host <claude|opencode>`. Exit 6; task untouched (fired before `airlock start`). |
| Executor binary absent, flag drift, or opencode agent file missing | step 4, per candidate, pre-start | Pre-start skip: `pin.failures` entry with the remedy (agent file: `run: airlock init --host opencode in <repo>`), `candidateIndex` moved, budget untouched. No candidate survives → each remedy printed, exit 6, task untouched. |
| Executor launch rejected, process-path mismatch, pane/agent dead before submission | steps 7–8, or reconcile with the class-E proof (`promptAttemptedAt: null` + successful snapshot) | Class E: automatic advance to the next candidate (budget-consuming); exhausted → next row. |
| Chain exhausted | dispatch or reconcile, class-E failure only | `airlock block <id> --reason "route chain exhausted: …"`; record settled as blocked; pane(s) preserved. |
| Anything after an accepted submission: stall, wait timeout, idle/exit without result, output then death | dispatch step 10 / reconcile | Class P — never fallback (Invariant 8): decision-table path; human inspects, audit/`done` or `block`. |
| Task reopened (`todo`) while a record is in flight | dispatch step 1 / reconcile | Superseded row: settle `settledAs: superseded` when the pane's agent is exited/idle and the worktree is clean; otherwise report and wait for the human. Never a wedge. |
| Crash between an advance and its pane launch | reconcile | `launch-pending` row: resume the same candidate; never a further advance. |
| Airlock parks the task (`needs-you`) | reconcile | Record kept in flight, `parkedForHuman`; pane left open; `answer the decision, then re-run reconcile`. |
| recordVersion 1 state found | dispatch/reconcile | Report it; refuse to dispatch until it is settled. |

## Repository integration

- The extension now **requires Airlock 4.0**. This supersedes the 4.0 slim-core spec's "frozen at 3.x" disposition for the extension going forward; the freeze remains true for plugin 0.1.0 on the `v3.1.x` tag (the 4.0 release precondition — commit `extensions/herdr` on the 3.x line and tag `v3.1.x` — still stands and is unaffected).
- **Two README sentence edits (the only Airlock-repo file this spec touches besides the extension), in one commit.** The sentences differ; each is quoted exactly:
  - §Extensions (README line 140): "The Herdr adapter targets the 3.x CLI surface and requires Airlock 3.x (`v3.1.x` tag); it has not been ported to 4.0." becomes "The Herdr router (plugin 0.2.0) requires Airlock 4.0; the earlier adapter for Airlock 3.x remains on the `v3.1.x` tag. See `docs/airlock/specs/2026-09-01-airlock-herdr-router.md`." (The trailing spec pointer in that paragraph moves to the router spec.)
  - "Upgrading from 3.x" (README line 162): "The Herdr adapter requires Airlock 3.x (`v3.1.x` tag)." becomes "The Herdr router requires Airlock 4.0; the 3.x adapter remains on the `v3.1.x` tag."
- `extensions/` stays out of the npm `files` allowlist; users run the router from a checkout via `herdr plugin link`. Nothing touches the host shims, `roles/`, or the 5,000-byte prompt-surface ceiling.

## Test plan

Everything below the evidence-gated section runs with `node --test extensions/herdr/tests/` on a machine with **no network and no live herdr**, following the existing patterns: the real `scripts/airlock.mjs` driven in disposable `$TMPDIR` git repos (never mocked — its contract is the point), an injected `fakeHerdr` client, injected executor-binary and executor-help probes, `outCapture`, `scriptUi`.

Adapt the existing suites:

- `tests/helpers.mjs`: plans become `airlock.plan/v4` (`expensive` instead of `risk`; keep one v3-plan helper to exercise the UPGRADED stderr notice against the real CLI); `installRoutes` writes `routing.json` into a test `--config-dir` instead of 3.x `models.json` + generated agent files; opencode agent files move to the project `.opencode/agent/airlock-<role>.md`; `fakeHerdr.agentStart` records and asserts `--kind`.
- `airlock-client.test.mjs`: `{text, task, agent}` shapes, no `--host` in argv, `upgraded: true` pass-through, stderr notice tolerated, PARKED exit 2, error-key branch — all against the real 4.0 script.
- `dispatch.test.mjs` / `reconcile.test.mjs` / `state.test.mjs`: re-based on recordVersion 2 (`executor`, `pin` with `advanceCount`, `promptAttemptedAt`, `parkedForHuman`, `launch-pending`, `settledAs: superseded`), agent-mismatch, in-flight refusal, crash-at-every-step reconcilability, decision-table rows, recordVersion-1 refusal. New rows exercised: superseded (both reopen shapes — rework with `startedAt: null` + note, and answered `needs-you`; dirty-worktree and agent-working refusals; dispatch step-1 self-service so a reopened task re-dispatches in one `dispatch` call), `launch-pending` resume of the same candidate, `needs-you` parking (pane left open, `parkedForHuman` set, record still in flight), settle closing only exited/idle plugin-owned panes. Workflow-lock tests: contention exits 69 having written nothing, stale takeover by dead pid and by age with a single winner, advance idempotency under an interleaved second runner (one advance persisted, one aborted).

New suites:

- `routes.test.mjs` — the ported 3.x validation semantics, one assertion per recovered rule: HH:MM regex, `24:00` end-only, midnight-crossing rejection with the two-window remedy text, duplicate window names, day/time overlap, fallbacks non-empty/max-2/duplicate-triple, unknown keys rejected, version pinned to 1; resolution under `AIRLOCK_NOW` (in-window, boundary `start <= t < end`, `24:00` end, out-of-window, wrong day); chain assembly with no cross-window inheritance.
- `pin.test.mjs` — chain resolved once at dispatch and never re-resolved on resume/reconcile/advance (freeze `AIRLOCK_NOW`, then move it and assert the pin holds); pin dies at done/block/superseded; reopened task re-resolves.
- `fallback.test.mjs` — one test per class. Class E advances: launch rejected for the kind, process-path mismatch, pre-submission pane death with `promptAttemptedAt: null` and a corroborating successful snapshot. Class P refuses: `agent_prompt_stalled` (asserting the kept `delivered: true` envelope routes to `needs-reconcile`), delivered-then-timeout, idle/exit without result, product change present, strict-parsed result present. Class S exits 69 with pin untouched: daemon dead at `agent start`, herdr call timeout, failed snapshot at reconcile (asserting the orphan row does **not** fire). Strict-nonce condition 2: the typed Path A REPORT line alone never counts as a result (regression for the `.includes` ambiguity — also asserted against `render.mjs` rows). Budget: at most two budget-consuming advances; pre-start skips move `candidateIndex` but leave `advanceCount` at 0; exhausted chain → `airlock block` with the reason; `agent_blocked` → `needs-reconcile`, never an advance; all failures recorded in `pin.failures` and `operations.jsonl` with `fromAttempt`.
- `executors.test.mjs` — argv construction per executor against recorded help fixtures (`claude --agent/--model/--effort`; codex `-c` followed by the exact single token `model_reasoning_effort=<effort>` with no embedded quotes; opencode Path A vs forced Path B when effort is set); fail-closed on a fixture with the flag removed; Path B command passes the agent name, model, effort, and prompt-file path through `shellQuote` and places `--agent`/`-m`/`--variant` explicitly (regression tests for the 0.1.0 `pathBCommand` defect and for shell metacharacters in `routing.json` values).
- `import-routes.test.mjs` — the mapping table row by row, including `effort: "none"` → omitted with the `MAPPED` notice; a committed fixture copy of the worked-example input converting to exactly the worked-example output and notices; the `--from` default chain (`AIRLOCK_CONFIG`, `AIRLOCK_CONFIG_DIR`, `XDG_CONFIG_HOME`, `~/.config/airlock`); `import-defaults.json` supplying `host`/`from` with CLI flags winning; both-hosts-without-`--host`-or-defaults fails; unknown risk key → exit non-zero and nothing written; existing `routing.json` refusal; `--dry-run` writes nothing.
- Exit-code assertions across suites: airlock 1/2 passthrough, 3 in-flight, 5 mismatch, 6 route, 64 usage, 69 substrate/lock, 78 precondition — pinned to the §Plugin surface table.

Evidence-gated section (extends `e2e.test.mjs`'s skip pattern):

- Live CLI flag checks: for each of `claude`, `codex`, `opencode` found on PATH, capture `--help` (plus `opencode run --help`) and assert the table's flags are present, refreshing `evidence/<cli>-cli-<version>.txt`; skip per-binary with an explicit message when absent.
- Live herdr cycle (opt-in via `AIRLOCK_HERDR_E2E=1`, as today): one dispatch→prompt→reconcile→done cycle per installed executor kind, one forced fallback (kill the pane before the prompt), one exhausted-chain block; disposable session, safe teardown.

## Non-goals

- **No cost inference.** The router never estimates or compares prices; tiers come solely from the plan's `expensive` boolean and the operator's bindings.
- **No automatic fallback on task-content failures.** Wrong output, failing acceptance, audit failures, permission prompts, and post-output deaths are never a reason to switch models — reconcile and the human decide, exactly as in 0.1.0.
- **No Airlock core changes** beyond the two README sentences (§Repository integration): no new verbs, no `--host` revival, no router state readable by the CLI, no plan-schema fields.
- No offered-pin TTL or preview machinery (4.0 deleted it; the router's dispatch-time pin makes it unnecessary).
- No project-level `routing.json` or config merging; one file per config dir.
- No new executors beyond the three named kinds; no host abstraction inside Airlock.
- No worktree-per-task; one in-flight task per workflow, as in 0.1.0.

## Evidence

- Airlock 4.0 contract: `scripts/airlock.mjs` on this branch (`output()`, `taskText`, `taskAgent`, the `next`/`start`/`status` handlers, the stderr `UPGRADED` write, `--json` error-on-stdout, PARKED exit 2) and `2026-09-01-airlock-4.0-slim-core.md`.
- Removed 3.x routing semantics: `git show bae9097~1:scripts/airlock.mjs` — `parseClock`, `validateCandidate`, `validateFallbacks`, `validateWindow`, `validateRoute`, `resolveConfiguredRoute`, `MAX_FALLBACK_ADVANCES = 2`, pin lifecycle (`ensureRoutePin`/`activateRoutePin`/`completeRoutePin`).
- Herdr 0.8.2 surface: `extensions/herdr/evidence/herdr-cli-0.8.2.txt`, `herdr-subcommands-0.8.2.txt` (incl. `agent start --kind` possible values listing `claude`, `codex`, `opencode`, `plugin config-dir`, the `agent prompt` stall semantics — "an **accepted submission** … otherwise it returns agent_prompt_stalled" — and `plugin action invoke` taking no pass-through arguments), `preflight-experiment-2026-08-31.md`.
- Known stale evidence prose: `evidence/opencode-v3-agent-flag-0.8.2-1.18.18.txt` is correct in its verbatim capture (the interactive help lacks `--variant`) but its prose summary on line 13 wrongly lists `--variant` among the interactive options. The 1.18.25 captures supersede it; when the captures are refreshed, that prose line gets a correction note rather than silent deletion.
- Executor CLIs, captured locally 2026-09-01: claude 2.1.251 (`--model`, `--effort low|medium|high|xhigh|max`, `--agent`); codex-cli 0.151.0 (`-m/--model`, `-c key=value`, `model_reasoning_effort` present in the binary's config-key tables); opencode 1.18.25 (interactive: `-m/--model`, `--agent`, no `--variant`; `opencode run`: `--agent`, `-m`, `--variant`). To be committed as `evidence/claude-cli-2.1.251.txt`, `evidence/codex-cli-0.151.0.txt`, `evidence/opencode-cli-1.18.25.txt` with the implementation.
- Import example input: `~/.config/airlock/models.json` (version 3), reproduced as a test fixture.

## Correction (2026-09-02, at commit time)

This spec and the 4.0 slim-core spec both assumed that plugin 0.1.0, the Herdr adapter for Airlock 3.x, would be committed on the 3.x line and tagged `v3.1.x`. That never happened. `extensions/` was never committed on any branch, so no 0.1.0 adapter exists in git and no `v3.1.x` tag exists in the repository. The 0.1.0 described throughout this document is the uncommitted predecessor of this work, useful as a record of what changed but not as something a user can install.

Three consequences, applied in this commit:

- The README no longer claims the 3.x adapter "remains on the `v3.1.x` tag". It states that the 3.x adapter was never released and that the router requires Airlock 4.0 or newer.
- `THREE_X_MESSAGE` no longer directs a 3.x user to a frozen adapter at a nonexistent tag; it says to upgrade Airlock.
- The `LEGACY RECORD` remedy in `dispatch.mjs` and `reconcile.mjs` no longer offers to settle a `recordVersion 1` record "with the 0.1.0 adapter (tag v3.1.x)". Settling by hand is the only available path. Such records can only exist on a machine that ran the uncommitted 0.1.0 code.

The 4.0 release precondition "commit `extensions/herdr` on the 3.x line and tag `v3.1.x`" is withdrawn rather than deferred. Airlock 3.x is superseded by 4.0.1 and no 3.x-compatible router will be published.
