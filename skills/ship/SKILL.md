---
name: ship
description: Ships one scope-audited, buildable Crossing and records exact-candidate evidence. On a Delivery Pack’s final Crossing, accepts the pack only after fresh required gates or explicit waivers. Use at every planned commit boundary or when asked to wrap up/commit; preserve protected state and project commit policy.
---

# Ship — seal one Crossing with evidence

Nothing crosses on assertion. A **Crossing** is one scope-audited, buildable commit; a **Delivery Pack** is a coherent outcome made from one or more contiguous Crossings. Under an approved external writer handoff, the launcher-sealed candidate precursor contains the exact product paths and is not a Crossing; the following separate orchestrator Crossing contains process artifacts and references that candidate SHA/tree.

## 1. Load the planned boundary

- Read the approved design, plan, ledger, and current Resume checkpoint before acting. The ledger remains the only durable resume store.
- Identify the approved Delivery Pack, next Crossing, exact owned paths, candidate-bearing paths, process artifacts, and required checks/gates. Do not combine packs or skip a Crossing ID.
- Confirm this Crossing leaves a buildable state. A multi-Crossing pack owns rollback at pack level; do not claim each dependent commit remains independently revertible.
- Pack lifecycle is `planned → active → candidate → accepted`, with `blocked`, `abandoned`, and `reverted` as exceptional terminal outcomes. Review lifecycle is a separate ledger field.

## 2. Protect state, then seal the candidate

Before a mutating validation run, back up irreplaceable local state named in project instructions and restore it afterward. Never expose credentials. For stochastic behavior, use the planned fixed-seed distribution rather than one run.

Follow any shared-worktree sync rule before sealing the candidate. When parallel sessions may share the checkout, run `git pull --rebase --autostash` if project policy requires it. For an external-worker candidate, all sync happens before the pre-dispatch `HEAD` capture; never pull or rewrite history between dispatch and the return audit. Use the following normal sealing path unless the approved route uses the external handoff below:

1. Use **scoped `git add` only** for this Crossing. Never `git add -A` or `git add .`.
2. Read `git diff --cached --name-status` for **Touched** and compare every path with this Crossing’s file contract and process artifacts. Unstage and surface anything outside scope; do not silently keep or revert it.
3. Ensure candidate-bearing paths have no unstaged content that would make validation exercise a different tree.
4. Confirm required generated-asset provenance rows or sidecars are staged with their artifacts.
5. Identify the exact candidate as either:
   - full commit SHA plus tree SHA, for an existing commit; or
   - full base SHA plus a cryptographic hash of the staged **product diff** for a pre-commit candidate.

The product diff includes the plan’s substantive code, tests, configuration, artifacts, and cited specs. Record its included paths and hash method. Ledger bookkeeping and purely administrative plan progress may be excluded.

This is code freeze. Any later substantive candidate-bearing change creates a new candidate and makes affected final evidence `stale`.

### 2A. Audit a launcher-sealed external candidate

Use this handoff only when the approved route records worker commit permission `none` and launcher sealing permission for one exact candidate with pinned Crossing ID, message bytes/hash, and candidate path set. The worker owns scoped investigation and edits only. The launcher owns mandatory deterministic validations, exact staging, commit creation, post-commit proof, and runtime cleanup. Neither may edit a design, plan, ledger, checkpoint, or other orchestrator process artifact, and neither may push or publish.

Consume one bounded launcher summary from the serialized foreground run. A valid `done` summary is still not acceptance: independently audit its launcher-sealed candidate precursor before any orchestrator edit, stage, or commit. A blocked summary with `no-commit`, staged, post-commit, unknown-process, or cleanup-failure state remains blocked exactly as reported; do not repair it during shipping.

For a `no-summary`, malformed-summary, timed-out, killed, or otherwise disrupted return, first prove the exact launcher process tree is quiescent. If process ownership or quiescence is uncertain, classify the state `indeterminate`, leave the checkout and artifacts untouched, and stop. Once quiescent, compare only with the recorded strict baseline:

- classify `no-commit` when `HEAD` is unchanged, the index is unchanged/empty, every baseline-dirty hash is preserved, and all new delta is confined to exact owned paths; no candidate exists and the orchestrator must not stage or commit those edits;
- classify `one-commit` only when current `HEAD` is exactly one child of the baseline, its exact message bytes/hash and changed paths match the manifest, the index is empty, and structured status plus baseline-dirty hashes match; continue only to the independent audit below; or
- classify every other state `indeterminate` and stop without cleanup or mutation.

Never rewrite candidate history. Do not reset, checkout, switch, rebase, amend, revert, clean, unstage, recommit, or otherwise alter a candidate or recovery state. A cleanup failure after commit leaves the commit intact and blocks acceptance until exact cleanup is independently resolved under an approved action; it is not permission to replace the commit.

For a valid completed summary or a recovered `one-commit` state, audit and record:

1. the fresh session ID and completion/classification; approved role/branch and selected runtime/agent/model/variant; effective runtime/agent/model/variant; full permission/containment policy identity and effective-policy proof; and exact manifest path/hash;
2. the approved current branch, pre-dispatch full `HEAD` as sole parent, current candidate `HEAD`, exactly one child commit, and full launcher candidate SHA/tree;
3. the exact commit message bytes/hash and complete no-renames changed-name set, all and only within the product file contract and containing no process artifact;
4. an empty index, complete structured porcelain-v2 status exactly equal to the recorded baseline, owned-path hashes, and every unrelated baseline status entry and dirty-path hash preserved;
5. each ordered mandatory validation's direct executable, exact argv, working directory, timeout/output bounds, expected/actual exit, and proof that validation introduced no delta;
6. direct Git executable identity; custom-filter rejection; verified empty hooks path; signing disabled; exact staging/cached-name audit; cached `diff --check`; parent/count/message/tree/path/post-state proof; and launcher's recovery classification; and
7. exact retained/temporary classification and verified cleanup state for the session, process tree, manifest, evidence, commit-message file, hooks directory, temporary directory, and any other declared artifact.

Any mismatch stops the candidate for a user decision. A passing audit freezes the launcher-sealed candidate precursor; subsequent gates exercise that exact SHA/tree, while process-only ledger work does not stale it. The orchestrator then owns the separate orchestrator Crossing. This audit proves local-checkout state only; external side effects remain guardrail and self-report territory.

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

Each evidence record identifies: gate ID, exact candidate, timestamp, executor host role and effective runtime/agent/model/variant, command or MCP tool, environment/target, result, and artifact reference. External evidence also records the selected/effective route, full permission/containment policy identity and proof, deterministic-validation/Git-sealing evidence, recovery classification, and exact cleanup. A substantive code, test, configuration, generated-artifact, or cited-spec change stales every affected gate; a ledger-only bookkeeping edit does not. For the normal staged path, the resulting commit/tree becomes the candidate identity; for an external handoff, the launcher-sealed precursor SHA/tree remains the candidate and the orchestrator Crossing commit is recorded separately. Retain any pre-commit base/diff hash that gates actually exercised.

If a required gate fails after launcher sealing, or a candidate-bearing change makes its evidence stale, mark the gate/evidence and pack's current candidate `failed` or `stale`, and record it under checkpoint **Fresh evidence** and **Blockers / decisions**; do not add a Crossing entry or create the orchestrator Crossing commit. With explicit approval, a fresh manifest/launcher run starts from current `HEAD`, passes the full pre-dispatch checks, and may seal exactly one successor candidate; that SHA/tree becomes the current candidate. The other permitted recovery is an explicit user-approved revert commit. Preserve prior candidates and evidence; never silently reset, rebase, amend, or revert them.

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
- **Commit:** this commit (the orchestrator Crossing; locate with `git log -S '<crossing-id>' --oneline -- <ledger-path>`)
- **Candidate:** `<launcher-sealed precursor SHA/tree, existing commit/tree, or base SHA + staged product-diff hash>`
- **Owned:** `<this Crossing’s paths>`
- **Touched:** `<final Crossing git diff --cached --name-status; process artifacts only for an external handoff>`
- **Launcher handoff audit:** `n/a` or `<session/completion; manifest hash; approved branch/baseline; parent/count; launcher candidate SHA/tree; message bytes/hash; changed names; index/structured status/hashes; selected/effective route; policy identity/proof; deterministic validation proof; Git sealing/audit proof; recovery classification; exact artifacts/cleanup>`
- **Evidence:** `<focused/current Crossing checks and result>`
- **Artifacts / cleanup:** `<retained evidence references; temporary paths/processes and cleanup evidence; or none>`
- **Scope audit:** passed against `<plan Crossing/file contract>`
- **Pack lifecycle after Crossing:** active | accepted
- **Deviations:** none
```

Give every Crossing a unique ID. Record approved deviations; write `none` only after the audit. On final acceptance, store the exact accepted candidate and structured gate evidence in the Delivery Pack section. For an external handoff, `git log -S` locates the orchestrator Crossing commit because it adds the ledger entry. Inspect the recorded launcher candidate with `git show <candidate-sha>` or locate its exact manifest-pinned message using `git log --all --fixed-strings --grep='<candidate-message>' --oneline`.

Set that pack’s review lifecycle to `awaiting-review` when accepted and `in-progress` beforehand. For a `review` Crossing, preserve its `resolving` or `cleared` state; review state never rewrites pack acceptance.

After each gate or cleanup result and before any unfinished return, replace the ledger's bounded Resume checkpoint in place with current paths, fresh evidence, artifact/cleanup state, blockers, and exact next action. Do not append snapshots or paste logs. On final acceptance, set checkpoint **State** to `closed` and reference the final Crossing. A missing checkpoint in a legacy ledger does not invalidate its history; add one only when that work is resumed or repaired.

Stage the ledger explicitly, rerun `git diff --cached --name-status`, and recompute the candidate hash if any candidate-bearing path changed. Process-only ledger staging does not stale evidence. For an external handoff, stage only orchestrator-owned process artifacts in the Crossing commit, keep launcher-sealed product paths clean, and reference the audited launcher candidate SHA/tree.

## 6. Commit and report

- Follow project commit-message conventions, including required trailers, plus branch/pull/push policy. The orchestrator commits the ledger entry with the Crossing and, for an external handoff, references the launcher candidate SHA/tree and fresh evidence. Only the orchestrator may push or publish, and only when policy allows it or the user asks.
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
