# Airlock Herdr Router Spec Review

**Date:** 2026-09-01 · **Reviewed:** `docs/airlock/specs/2026-09-01-airlock-herdr-router.md` (draft), branch `feat/herdr-router-4.0`
**Baseline:** `main` at `3135f65`, 4.0 core at `bae9097` · **Method:** every contract claim checked against `scripts/airlock.mjs` (4.0.0), the recovered 3.x routing code (`git show bae9097~1:scripts/airlock.mjs`), all of `extensions/herdr/` (src, bin, tests, evidence, `herdr-plugin.toml`), the 0.1.0 adapter spec, the 4.0 slim-core spec, `~/.config/airlock/models.json`, and live CLI help on this machine (claude 2.1.251, codex-cli 0.151.0, opencode 1.18.25, herdr 0.8.2). The fixed architecture (router outside the core; Airlock keeps plan/audit/commit authority) is not reviewed.

---

## Verdict

**Request changes.** The routing-semantics port is faithful — the HH:MM regex, `24:00`-end-only rule, midnight-crossing remedy text, day/time overlap predicate, model+effort dedupe triple, and `MAX_FALLBACK_ADVANCES = 2` all match the recovered 3.x code exactly, and the worked import example reproduces the real `models.json` row for row (verified: 6 bindings, 12 claude rows, 9 catalog entries, builder-complex `command-code/zai-org/glm-5.3@high` drop). The executor flag claims held up under live spot-checks: claude `--agent`/`--model`/`--effort (low, medium, high, xhigh, max)`; codex `-m` and `-c key=value` with `model_reasoning_effort` present in the 0.151.0 binary's `ConfigToml`/`ConfigProfile` string tables; `opencode run` takes a positional message plus `--agent`/`-m`/`--variant` while the interactive command lacks `--variant`; herdr 0.8.2 offers `--kind claude|codex|opencode`, `pane run`/`pane wait-output`, and `plugin config-dir <PLUGIN_ID>`. The 0.1.0 `pathBCommand` defect is real and the corrected form is functional and substitution-safe. The 0.1→0.2 state migration is specified (fail closed on recordVersion 1). The `UPGRADED`-on-stderr and error-JSON-on-stdout claims match `readPlan`/`output()`/the `main` catch.

What blocks acceptance is the new automatic-fallback engine: its trigger set is defined three different, mutually contradictory ways, and its central "prompt never accepted" trigger (`agent_prompt_stalled`) contradicts both herdr's documented semantics and the 0.1.0 client code the spec claims to reuse. Around it sit unhandled substrate-vs-executor failure confusion, no concurrency story for a feature that now mutates state from two entry points, and a rework-path deadlock the spec's own pinning narrative promises away.

| # | Severity | Finding |
|---|---|---|
| F1 | blocker | Fallback trigger set is self-contradictory: dispatch step 9 vs step 10 vs §Fallback's exhaustive list vs the reconcile-delta rows |
| F2 | major | `agent_prompt_stalled` misclassified as "prompt never accepted"; herdr docs and the 0.1.0 client both treat a stalled submission as delivered |
| F3 | major | Herdr-transport failures qualify as fallback triggers; a dead daemon mid-run burns the chain and blocks the task |
| F4 | major | No concurrency control: concurrent dispatch/reconcile double-advance the chain; the advanced attempt's `offered` state invites repeat auto-advances after crashes |
| F5 | major | Reopened (rework) tasks deadlock: the in-flight record blocks re-dispatch, contradicting §Pinning's "a later re-dispatch resolves a fresh chain" |
| F6 | minor | Fallback condition 2's nonce check is ambiguous; Path A pane text always contains `AIRLOCK-RESULT <nonce>` (the typed REPORT line) |
| F7 | minor | Missing opencode agent file exits 4 without consulting remaining chain candidates (e.g. a claude fallback) |
| F8 | minor | Exit-code collision: "exit with airlock's code" makes router exit 2 ambiguous (usage vs `PARKED`) |
| F9 | minor | Import has no disposition for 3.x effort value `"none"`; verbatim import emits `opencode run --variant none` |
| F10 | minor | Path B interpolates `model`/`effort`/agent unquoted into a shell command line |
| F11 | minor | `needs-you` external settle closes a possibly-live worker pane (kept 0.1.0 row) |
| F12 | minor | "Advance" accounting undefined: do step-4 executor-missing skips consume the 2-advance budget? |
| F13 | nit | `next.task` is an id string but `start.task` is the full task object; the spec presents both as `{ text, task, agent }` |
| F14 | nit | "4.0 has no verb that ever re-emits [the brief]" is false: `next` re-emits it with `(resume)` for a single doing task |
| F15 | nit | 3.x detection keyed on "a `route` object"; 3.x emits `route: null` (key present) when no task is selected, and a 3.x preflight `next` writes a pin as a side effect |
| F16 | nit | Codex effort argv should be pinned without embedded quotes; args after `--` bypass any shell |
| F17 | nit | Small evidence/doc inaccuracies: README "identical sentence", `--from` default path, the 1.18.18 evidence prose, `import-routes` as a toml action |

## Findings

### F1 — blocker — the fallback trigger set is defined three contradictory ways

**Spec:** §Dispatch algorithm steps 9–10, §Fallback, §Reconciliation.

Three passages cannot all be implemented:

1. **Step 9 vs step 10.** Step 9: "Any wait completion (state match, timeout, **stall**) → `needs-reconcile` … (Invariant 2)." Step 10 plus §Fallback: `agent_prompt_stalled` is a qualifying trigger that advances the chain in-process. A stalled prompt cannot both schedule reconciliation and advance the chain; the spec mandates both.
2. **§Fallback's exhaustive list vs the reconcile delta.** §Fallback condition 1 enumerates the qualifying triggers "exhaustively": start failure, prompt-never-accepted, and pane/agent **gone**. The reconcile delta then adds an auto-advance branch to the "no nonce; pane **idle/done/exited**; no changes" row — a state in which the pane exists and the prompt was (per the recorded `promptDeliveredAt`) delivered, so none of the three triggers holds and §Fallback's own closing sentence ("Timeouts of a delivered, working prompt are **not** qualifying: the worker got the task") forbids the advance. As written the branch is either dead code or a rule violation. If the intent is that the branch fires only when the record shows delivery never succeeded (dispatch crashed mid-step-8), the spec must say that reconcile evaluates condition 1 from the persisted record (`promptDeliveredAt`, `lastError`), which it currently never mentions.
3. **Invariant 2's carve-out vs both.** The carve-out permits advancing on "a pre-result infrastructure failure", but the two passages above disagree on what that is.

**Resolution.** Pick one precedence and restate all three passages from it. Suggested: qualifying = the herdr call returned `delivered: false` (start failure, delivery error) at dispatch time, or the orphan row (pane/agent gone, condition 2 holds) at reconcile time; stall and every wait completion after a successful delivery → `needs-reconcile`, never an advance; delete the auto-advance branch from the idle/exited row (keep it only on the orphan row) or explicitly define its guard as "record shows delivery never succeeded". State that reconcile evaluates condition 1 from persisted record fields and name them.

### F2 — major — `agent_prompt_stalled` is not "prompt never accepted"

**Spec:** §Fallback condition 1 bullet 2 ("prompt never accepted: … herdr's `agent_prompt_stalled` (the agent never left its pre-prompt state …)").

`herdr agent prompt --help` (captured in `extensions/herdr/evidence/herdr-subcommands-0.8.2.txt`) says: "If the agent is already blocked, submission is rejected with agent_blocked **before any input is sent**. When an **accepted submission** starts from another non-working state, --wait first requires an observed state change within 5000ms; otherwise it returns agent_prompt_stalled." A stall therefore means the text **was sent** to the agent's terminal; herdr merely observed no state change. The 0.1.0 client the spec claims to reuse encodes exactly this: `src/herdr-client.mjs` `agentPrompt` returns `{ ok: true, delivered: true, … code: "agent_prompt_stalled" }` — a stalled prompt is classified as delivered, so `dispatch.mjs`'s `if (!delivered.delivered)` failure path never fires on it. Advancing the chain on stall (a) contradicts the spec's own "worker got the task → never fall back" rule, (b) requires silently inverting the reused client's classification, and (c) races: condition 2's clean-worktree check at stall time proves nothing about what a slow-starting executor does five seconds later — "close the dead pane if any" would kill a live worker that has the task, or, if the pane is left open, produce two workers on one task.

**Resolution.** Remove `agent_prompt_stalled` from the qualifying list (route it to `needs-reconcile`, where the human or a later orphan check decides), or redefine it as qualifying only when corroborated (e.g. a bounded pane read shows the prompt text never appeared) and specify that the pane is closed before the advance. Either way, state explicitly that the 0.1.0 `agentPrompt` envelope (`delivered: true` for stall) is being kept or changed.

### F3 — major — substrate (herdr) failures burn the executor chain

**Spec:** §Fallback condition 1 ("executor start failure: … `herdr agent start` error"), §Failure modes.

`herdr agent start` can fail because the **daemon** is dead, the socket dropped, or the call timed out (`src/herdr-client.mjs` returns `herdr_not_installed`, `spawn_error`, `timeout`, or an error envelope for all of these). None of those are candidate failures — the next candidate's `herdr agent start` will fail identically — yet the spec counts them as qualifying triggers. Consequence: a herdr restart mid-dispatch advances twice, exhausts the chain, and runs `airlock block <id> --reason "route chain exhausted …"` — a task permanently blocked (human intervention required) because the pane substrate hiccuped, violating the spirit of "absence of Herdr is never an Airlock error" (§Failure modes row 1) and mirroring nothing in the 3.x fallback classes (which were provider failures: `auth|rate-limit|timeout|transport|model-unavailable` **of the model**, human-classified). The same hole applies at reconcile: a dead daemon makes every pane "gone" (snapshot fails), which the orphan row now auto-advances on.

**Resolution.** Partition failure classes: herdr-level errors (spawn failure, daemon unreachable, herdr call timeout, `cli_usage`) are never qualifying — they mark `needs-reconcile` with the herdr error and leave the chain untouched; only executor-level failures (agent start rejected for the named kind, process-path mismatch, executor binary absent) advance. At reconcile, require a **successful** session snapshot before treating a pane as gone (the 0.1.0 `adoptPaneByName` already distinguishes `snap.ok === false` from "workspace not found" — specify that only the latter is an orphan).

### F4 — major — no concurrency control for two mutating entry points

**Spec:** §Dispatch algorithm, §Reconciliation, §Plugin surface.

Dispatch and reconcile are both herdr plugin actions and both CLI verbs; nothing prevents them running concurrently against one workflow (a `watch` pane plus a manual `reconcile`, or the human clicking `reconcile` twice). 0.1.0 tolerated this because reconcile's mutations were human-gated; 0.2.0's auto-advance makes races destructive: two concurrent reconciles can each observe the same qualifying failure and each advance — consuming both advances, creating two panes for one attempt semantics, or double-running `airlock block` on exhaustion. Atomic `rename` prevents torn files but not lost updates (read-modify-write of `tasks/<id>.json` is last-writer-wins). Separately, the in-process advance path writes the new attempt via `advanceAttempt`, which persists it in state `offered` (`src/state.mjs`) — a state 0.1.0 defined as "start not yet run". A crash between the advance and pane creation leaves an `offered` record for a `doing` task with no pane; under the new reconcile rules that presents as another qualifying failure, so each crash-reconcile cycle can burn a further advance without ever launching an executor.

**Resolution.** Specify a per-workflow lock (e.g. `O_EXCL` lockfile under `<state-dir>/<session>/<workflowKey>/`, stale-detected by pid+timestamp) held across any record mutation, and make the advance idempotent (record the triggering failure's identity in `pin.failures`; refuse to advance twice for the same `{attempt, trigger}`). Give the advanced-but-not-yet-launched attempt its own record state (or persist it as `started` with a `pendingLaunch` marker) and define its reconcile row explicitly: resume the launch of the **same** candidate, not a further advance.

### F5 — major — reopened (rework) tasks can never be re-dispatched

**Spec:** §Resolution algorithm and pinning ("A later re-dispatch of the same task (e.g. an answered decision reopened it) resolves a fresh chain at the new dispatch time"), §Reconciliation ("The decision table is kept row-for-row"), §Dispatch step 1.

The kept 0.1.0 behavior for a reopened task (`airlock answer` flips a consumed task back to `todo`) is `src/reconcile.mjs` lines 97–108: any non-`offered` record is set to `needs-reconcile` with "TASK REOPENED … resolve the pane and redispatch yourself". But `needs-reconcile` is in `IN_FLIGHT_STATES`, and dispatch step 1 refuses while **any** in-flight record exists (exit 3). No decision-table row ever settles or deletes a reopened task's record, so the promised re-dispatch is unreachable without hand-editing the state directory. The pin-death rule ("the pin dies with the record when the task reaches `done` or `blocked`") likewise never fires for rework — the task went `doing → todo`, not to a settled state.

**Resolution.** Add a row: airlock status `todo` with a non-`offered` record → after the human confirms (pane resolved/closed), settle the record as `settledAs: reopened` (pin dies), freeing dispatch to run and resolve a fresh chain. Alternatively let dispatch treat a `needs-reconcile` record whose airlock status is `todo` as settleable in place. Update §Resolution's pin-death sentence to include this path.

### F6 — minor — condition 2's "no `AIRLOCK-RESULT <nonce>` line" is ambiguous, and Path A panes always contain the string

**Spec:** §Fallback condition 2.

In Path A, `herdr agent prompt` types the whole prompt — including `REPORT End your reply with exactly one line: AIRLOCK-RESULT <nonce> ok|blocked <one-line summary>` — into the TUI, so the bounded pane read **always** contains the substring `AIRLOCK-RESULT <nonce>`. The codebase already interprets "nonce present" both ways: `src/render.mjs` `nonceSeenIn` is a plain `.includes(nonce)` (would say "seen" the moment the prompt is typed), while `src/reconcile.mjs` `detectNonce` uses the strict `^AIRLOCK-RESULT <nonce> (ok|blocked)\s+(.+)$` regex that rejects the instruction template. If condition 2 is implemented as a substring check, fallback can never fire after prompt delivery in Path A (fails safe but dead); the same ambiguity affects `pane wait-output --match "AIRLOCK-RESULT <nonce>"` in Path B if `opencode run` echoes the message.

**Resolution.** Specify that condition 2 uses `detectNonce`'s strict parse (result line with a verdict and a real summary), not a substring, and note the Path B `wait-output` premature-match possibility as benign (it only schedules reconciliation, per Invariant 2).

### F7 — minor — missing opencode agent file bypasses the chain

**Spec:** §Dispatch step 5, §Failure modes ("opencode agent file missing | V5 | … Exit 4").

Step 4 skips candidates whose **binary** is missing, and flag drift is "a qualifying fallback trigger if mid-dispatch"; but a missing `.opencode/agent/airlock-<role>.md` for the active candidate deletes the offered record and exits 4 — even when the next candidate is a claude or codex executor that needs no such file (cross-executor chains are the point of the new `{executor, model, effort}` candidates, e.g. the spec's own builder example: opencode primary, claude expensive). This is a pre-start infrastructure failure of exactly the kind the chain exists to survive, treated inconsistently with its two siblings.

**Resolution.** Treat a failed per-candidate executor preflight (agent file, flag drift) at step 5 like step 4's binary probe: record `pin.failures` (class `executor-preflight`), skip to the next candidate, exit 4/6 with the remedy only when no candidate survives. If the exit-4 fail-closed behavior is deliberate (force the operator to fix init before any dispatch), say so and why the asymmetry with step 4 is intended.

### F8 — minor — exit-code passthrough collides with the router's own codes

**Spec:** §Dispatch step 2/6 ("exit with airlock's code"), §Plugin surface ("Exit codes: 0 ok; 1 generic/airlock failure; 2 usage; 3 reconcile required; …").

Airlock exits 2 for `PARKED` under `next --unattended`; the router reserves 2 for usage errors. A caller (or the herdr action log) cannot distinguish "you typed the flags wrong" from "the plan is parked on a decision". 0.1.0 had the same latent collision, but 0.2.0 now formally enumerates its exit codes without resolving it, and 6 new codes make future collisions likelier.

**Resolution.** Either map airlock failures onto one router code (1) and print airlock's code in the message, or document the passthrough exception explicitly ("exit 2 means usage **or** airlock PARKED; distinguish by output").

### F9 — minor — no disposition for 3.x effort `"none"`

**Spec:** §import-routes mapping table ("row `model`/`effort` → candidate `model`/`effort` … kept verbatim").

In 3.x, `validateCandidate` **requires** effort, and the catalog legally declares `"none"` as an opencode variant (the real `models.json` declares it for all three `openai/gpt-5.6-*` models), so 3.x configs can carry rows with `effort: "none"` meaning "no variant". Imported verbatim, such a row produces a non-null effort → forced Path B → `opencode run --variant none`, whose acceptance is provider-dependent and certainly not what the 3.x row meant. The mapping table covers the catalog drop but not this value.

**Resolution.** Map `effort: "none"` → `effort: null` (flag omitted, Path A eligible) with an explicit notice line, or list it as unmapped (exit non-zero). Add it to the `import-routes.test.mjs` row list.

### F10 — minor — Path B shell line interpolates unvalidated config values

**Spec:** §Executors, Path B command (`opencode run --agent airlock-<role> -m <provider/model> --variant <effort> "$(cat '<promptFile>')"`).

The prompt-file substitution is safe (single-quote-escaped path; command-substitution output inside double quotes is not re-evaluated, so TASK text with `$`/backticks/quotes cannot execute). But `<provider/model>` and `<effort>` come straight from `routing.json`, validated only as non-empty strings, and are pasted unquoted into a line executed by the pane's interactive shell via `herdr pane run`. A model string with a space breaks the argv silently; one with `;`/`$()` executes in the operator's pane shell. Low severity (operator-owned file, operator's own shell) but inconsistent with the spec's fail-closed posture, and the agent name is interpolated too.

**Resolution.** Specify single-quoting (with the existing `'\\''` escape) for every interpolated value in the Path B line, or restrict `model`/`effort` at validation to a safe charset (`[A-Za-z0-9._/:-]+`) with the JSON-path error convention.

### F11 — minor — `needs-you` sync closes a pane whose worker may be live

**Spec:** §Reconciliation ("Airlock-already-settled → sync the record"; "All completion paths are unchanged").

The kept row (`src/reconcile.mjs`: `SETTLED_AIRLOCK_STATES` includes `needs-you`; `settleExternally` → `settle(…, { closePane: true })`) closes the worker pane when a human ran `airlock ask --blocking` against the doing task. Unlike `done`/`blocked`, `needs-you` is a *pause*: the worker may be mid-run, its uncommitted context is destroyed, and when the decision is answered the task returns to `todo` — where `start` then fails on the dirty worktree the killed worker left. With three executor kinds and paid peak windows this discards more work than 0.1.0's opencode-only case.

**Resolution.** For `needs-you`, sync the record but preserve the pane (`closePane: false`), matching the pane-preserving treatment of `blocked`; note that the human closes it after resolving the decision.

### F12 — minor — "advance" accounting is undefined for pre-start skips

**Spec:** §Dispatch step 4, §Fallback condition 3.

Step 4 skips absent-binary candidates "by advancing `candidateIndex`" and records them in `pin.failures`; condition 3 gates on `candidateIndex < candidates.length - 1` **and** "fewer than 2 advances have occurred". The two counters can diverge exactly by pre-start skips: if the primary's binary is absent (skip to index 1), is that one of the two allowed advances, or free? 3.x had no equivalent (its bound was purely `candidateIndex`-based: `nextIndex > MAX_FALLBACK_ADVANCES`), so "both bounds are the 3.x semantics" doesn't settle it.

**Resolution.** Define "advance" once — simplest is the 3.x rule: the bound is `candidateIndex ≤ 2`, i.e. skips and failures both consume positions and no separate advance counter exists — and restate condition 3 in those terms.

### F13 — nit — `next.task` and `start.task` have different types

**Spec:** §Airlock 4.0 CLI contract.

`next --json` returns `task` as the selected task **id string** (or null); `start --json` returns `task` as the **full task object** (`scripts/airlock.mjs` lines 660 vs 668/682). The spec writes `{ text, task, agent }` for both without noting it; a router comparing `start.task !== next.task` for the mismatch check would always mismatch. (The specified check compares `agent`, which is fine — just document the `task` type difference.)

### F14 — nit — `next` does re-emit the brief

**Spec:** §Airlock 4.0 CLI contract ("Retain `text` verbatim: `start` does not re-emit it and 4.0 has no verb that ever re-emits it").

`nextText`/`selectNext` re-emit the complete TASK brief with `(resume)` whenever exactly one task is `doing`. Retaining `taskText` remains the right design (the re-emission is conditional), but the absolute claim is false, and the orphan/resume paths could legitimately refresh a lost brief via `next`.

### F15 — nit — 3.x detection should key on route-key presence, not "a route object"

**Spec:** §Airlock 4.0 CLI contract, 4.0 detection.

3.x `next --json` with nothing to do returns `route: null` — the key is present but not an object — so "A `route` object means a 3.x CLI" lets a 3.x CLI pass preflight whenever the plan has nothing to dispatch. Harmless in that instant but the check should be `"route" in response`. Also worth noting: running `next` against a 3.x CLI is not side-effect-free (it writes an offered route pin via `ensureRoutePin`), so the refusal message may leave a 5-minute pin behind — cosmetic, but the spec presents preflight `next` as pure.

### F16 — nit — pin the codex effort argv token exactly

**Spec:** §Executors table (`-c model_reasoning_effort="<effort>"`).

Executor args after `--` are argv elements passed by herdr without a shell; embedded double quotes reach codex literally. Codex tolerates it (the value parses as a TOML string), but the spec should pin the exact token — `model_reasoning_effort=<effort>` — so an implementer doesn't copy shell-style quoting into argv, and so `executors.test.mjs` has one canonical expected form.

### F17 — nit — small documentation/evidence inaccuracies

**Spec:** §Repository integration, §import-routes, §Executors (OpenCode paths), §Plugin surface.

- README line 162 ("The Herdr adapter requires Airlock 3.x (`v3.1.x` tag).") is not "the identical sentence" as line 140; the edit instruction should quote both actual sentences.
- `--from` default "~/.config/airlock/models.json (… `AIRLOCK_CONFIG` honored)": the 3.x resolution also honors `AIRLOCK_CONFIG_DIR` and `XDG_CONFIG_HOME` (`userConfigDir`); on a machine using either, the importer would read the wrong path. Honor the same chain or say only `AIRLOCK_CONFIG`/`--from` are supported.
- The cited `evidence/opencode-v3-agent-flag-0.8.2-1.18.18.txt` "agrees" only in its verbatim capture; its prose (line 13) wrongly lists `--variant` among interactive options. Note the discrepancy when re-citing, or fix the evidence prose when refreshing captures.
- `import-routes` as a `herdr-plugin.toml` action invokes `node bin/airlock-herdr.mjs import-routes` with no way to supply `--host`/`--from`; against the motivating config (both host sections populated) the action can only ever fail. Either drop the toml action or document that it is CLI-only in practice.

## Not findings (verified sound)

- 3.x validation semantics ported verbatim: regexes, error texts, overlap predicate, dedupe key, window-candidate/fallback non-inheritance, `startMinutes <= minute < endMinutes` selection, `dayName` table — all match `bae9097~1`.
- Worked import example matches the real `models.json` exactly (all 6 bindings, both DROPPED lists, 12-row claude skip, 9-entry catalog drop); claude-host rows' `medium`/`high` efforts sit inside the verified `claude --effort` enum, so a `--host claude` import is well-formed.
- 4.0 consumption claims: error JSON on stdout, `PARKED` exit 2, `UPGRADED` on stderr with `upgraded: true` in the payload, `status --json` `{text, plan}` with optional boolean `expensive`, `--host` accepted-and-ignored, `--plan` and `docs/airlock/` plan discovery, `AIRLOCK_NOW` retained — all confirmed against `scripts/airlock.mjs`.
- Herdr 0.8.2 surface: `agent start --kind` lists all three executors; `plugin config-dir <PLUGIN_ID>` verified live; `pane run`/`pane wait-output --match` present with the specified syntax.
- The corrected Path B command fixes the real 0.1.0 defect (prompt passed as the `--agent` value, model dropped) and the `"$(cat '…')"` idiom does not re-evaluate prompt content; prompt size is far below ARG_MAX.
- recordVersion 1 → 2 migration is specified (fail closed, human settles with the 0.1.0 adapter) rather than silently migrated.
- Test plan is realistic against the existing suites (all seven test files exist; `fakeHerdr`/real-CLI split, `AIRLOCK_HERDR_E2E=1` opt-in and skip pattern match `tests/e2e.test.mjs`), provided the DI points for executor-binary/help probes are added as stated.
