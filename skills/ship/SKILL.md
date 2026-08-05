---
name: ship
description: Ships one scope-audited, buildable Crossing and records exact-candidate evidence. On a Delivery Pack’s final Crossing, accepts the pack only after fresh required gates or explicit waivers. Use at every planned commit boundary or when asked to wrap up/commit; preserve protected state and project commit policy.
---

# Ship — seal one Crossing with evidence

Nothing crosses on assertion. A **Crossing** is one scope-audited, buildable commit; a **Delivery Pack** is a coherent outcome made from one or more contiguous Crossings.

## 1. Load the planned boundary

- Read the approved design, plan, ledger, and current Resume checkpoint before acting. The ledger remains the only durable resume store.
- Identify the approved Delivery Pack, next Crossing, exact owned paths, candidate-bearing paths, process artifacts, and required checks/gates. Do not combine packs or skip a Crossing ID.
- Confirm this Crossing leaves a buildable state. A multi-Crossing pack owns rollback at pack level; do not claim each dependent commit remains independently revertible.
- Pack lifecycle is `planned → active → candidate → accepted`, with `blocked`, `abandoned`, and `reverted` as exceptional terminal outcomes. Review lifecycle is a separate ledger field.

## 2. Protect state, then seal the candidate

Before a mutating validation run, back up irreplaceable local state named in project instructions and restore it afterward. Never expose credentials. For stochastic behavior, use the planned fixed-seed distribution rather than one run.

Follow any shared-worktree sync rule before sealing the candidate. When parallel sessions may share the checkout, run `git pull --rebase --autostash` if project policy requires it. Then:

1. Use **scoped `git add` only** for this Crossing. Never `git add -A` or `git add .`.
2. Read `git diff --cached --name-status` for **Touched** and compare every path with this Crossing’s file contract and process artifacts. Unstage and surface anything outside scope; do not silently keep or revert it.
3. Ensure candidate-bearing paths have no unstaged content that would make validation exercise a different tree.
4. Confirm required generated-asset provenance rows or sidecars are staged with their artifacts.
5. Identify the exact candidate as either:
   - full commit SHA plus tree SHA, for an existing commit; or
   - full base SHA plus a cryptographic hash of the staged **product diff** for a pre-commit candidate.

The product diff includes the plan’s substantive code, tests, configuration, artifacts, and cited specs. Record its included paths and hash method. Ledger bookkeeping and purely administrative plan progress may be excluded.

This is code freeze. Any later substantive candidate-bearing change creates a new candidate and makes affected final evidence `stale`.

## 3. Use fresh evidence, without duplicate runs

Implementers provide focused RED/GREEN and Crossing-check evidence during implementation. `ship` checks that evidence against the sealed candidate and reruns **only** required evidence that is missing or stale. A project-mandated per-commit suite is a required Crossing check; red means stop, not ship.

For the final Crossing:

1. Set the Delivery Pack to `candidate` after code freeze.
2. Have the planned independent verifier context or specialized gate role run each required final gate against that exact candidate without editing source during gate execution. Do not replace independent verification with the implementer’s focused checks.
3. Reuse fresh evidence for the same candidate. Rerun only missing/stale gates.
4. Keep functional, visual, live-integration, and cleanup results separate. Mutating validation needs an approved throwaway target and cleanup evidence.

Every gate has three independent dimensions:

- **Applicability:** `required` or `not-required`.
- **Gate state:** `pending`, `running`, `passed`, `failed`, `blocked`, or `stale`.
- **Waiver:** approver, reason, and date. A waiver does not change applicability or turn a gate state into `passed`.

Each evidence record identifies: gate ID, exact candidate, timestamp, executor host role and effective agent/model, command or MCP tool, environment/target, result, and artifact reference. A substantive code, test, configuration, generated-artifact, or cited-spec change stales every affected gate; a ledger-only bookkeeping edit does not. After commit, the commit and tree SHAs become the accepted candidate identity; retain the pre-commit base/diff hash in the evidence record that was actually exercised.

Classify every non-product artifact and every temporary process created during implementation, verification, or shipping:

- **Retained evidence:** move file-based evidence to the project-configured evidence home under a stable exact path and reference it from the applicable Crossing or gate evidence row.
- **Temporary:** record the exact task-owned path/process, then remove or stop it before return when ownership is certain and cleanup is safe.

Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts. If ownership or safe cleanup is uncertain, leave the item in place, block cleanup, and report the exact item and decision needed. For Playwright/browser work, retain only required evidence and remove superseded task-created screenshots, downloads, traces, and logs. Never clean credentials, browser profiles, cookies, localStorage, or other user state.

If any temporary artifact or process was created, cleanup is a required gate even when cleanup has already occurred. Add it through an approved plan/ledger amendment if absent. Its fresh evidence must identify the exact paths/processes and prove each was removed or stopped; do not treat an unverified absence as a pass. Pack acceptance is blocked until this evidence is fresh and passed.

The pre-ship independent-review gate, when required, is acceptance evidence. It is distinct from post-ship Airlock **`review`**.

## 4. Accept only a cleared final candidate

On a non-final Crossing, keep the pack `active`. On the final Crossing, set it to `accepted` only when:

- every unwaived required gate is `passed` with fresh evidence for the exact candidate;
- every waiver is explicit and approved, without being reported as passed evidence;
- all retained evidence is in the configured evidence home and referenced;
- every required cleanup gate, including temporary artifact/process and external-state cleanup, has fresh exact-path/process evidence; and
- the staged scope audit and required Crossing checks are clean.

Failed, blocked, or stale required evidence stops acceptance. Do not invent a pass or commit a red build. A single-Crossing pack may move through `active` and `candidate` to `accepted` in this one ship operation.

## 5. Record the Crossing and pack state

Use the exact ledger path from the plan; initialize it from `LEDGER.template.md` beside this skill when needed. Record:

```markdown
### Crossing `<crossing-id>` — `<name>` — `<YYYY-MM-DD>`

- **Delivery Pack:** `<pack-id>`
- **Commit:** this commit (locate with `git log -S '<crossing-id>' --oneline -- <ledger-path>`)
- **Candidate:** `<commit/tree or base SHA + staged product-diff hash>`
- **Owned:** `<this Crossing’s paths>`
- **Touched:** `<final git diff --cached --name-status, including process artifacts>`
- **Evidence:** `<focused/current Crossing checks and result>`
- **Artifacts / cleanup:** `<retained evidence references; temporary paths/processes and cleanup evidence; or none>`
- **Scope audit:** passed against `<plan Crossing/file contract>`
- **Pack lifecycle after Crossing:** active | accepted
- **Deviations:** none
```

Give every Crossing a unique ID. Record approved deviations; write `none` only after the audit. On final acceptance, store the exact accepted candidate and structured gate evidence in the Delivery Pack section.

Set that pack’s review lifecycle to `awaiting-review` when accepted and `in-progress` beforehand. For a `review` Crossing, preserve its `resolving` or `cleared` state; review state never rewrites pack acceptance.

After each gate or cleanup result and before any unfinished return, replace the ledger's bounded Resume checkpoint in place with current paths, fresh evidence, artifact/cleanup state, blockers, and exact next action. Do not append snapshots or paste logs. On final acceptance, set checkpoint **State** to `closed` and reference the final Crossing. A missing checkpoint in a legacy ledger does not invalidate its history; add one only when that work is resumed or repaired.

Stage the ledger explicitly, rerun `git diff --cached --name-status`, and recompute the candidate hash if any candidate-bearing path changed. Process-only ledger staging does not stale evidence.

## 6. Commit and report

- Follow project commit-message conventions, including required trailers, plus branch/pull/push policy. Commit the ledger entry with the Crossing; push only when policy allows it or the user asks.
- Verify with `git show --stat --oneline HEAD`.
- Do not call an active pack accepted.

Use this exact five-bullet shape for every ship report:

- **Status:** `done`, `partial`, or `blocked`, followed by one factual sentence.
- **Changes/findings:** exact changed paths or prioritized findings; `none` when applicable.
- **Evidence:** exact command/tool and result; name anything required but not run.
- **Artifacts/cleanup:** retained evidence paths/references and exact temporary paths/processes removed, still present, or blocked; `none` when applicable.
- **Action needed:** `none` or one exact decision, blocker, or next action.

Return only those bullets, using facts and actions. Put Crossing/pack IDs, SHA or candidate identity, gate states/waivers, deviations, and skipped checks under the applicable bullet. Do not restate the prompt, plan, or file contract, and do not include long logs unless requested or a concise failure excerpt is needed.

## Legacy 1.1 compatibility

A ledger with Crossings but no Delivery Pack sections is one implicit legacy Delivery Pack, `legacy:<work-id>`. Preserve its historical evidence as unstructured text and its existing `Status` as legacy review metadata, not pack lifecycle. Historical pack lifecycle, gate applicability/state, waivers, and exact-candidate evidence are `unknown`; never infer 1.2 gate passes from today’s green run. A ledger without a Resume checkpoint remains valid. Put new post-acceptance changes in a linked 1.2 repair pack rather than rewriting legacy history.

Feedback on shipped work goes through **`review`**.
