---
description: Ship an explicit Full Airlock Crossing
---

# Ship — seal one Crossing with evidence

Nothing crosses on assertion. A **Crossing** is one scope-audited, buildable commit; a **Delivery Pack** is a coherent outcome made from one or more contiguous Crossings. Under an approved external writer handoff, the launcher-sealed candidate precursor contains the exact product paths and is not a Crossing; the following separate orchestrator Crossing contains process artifacts and references that candidate SHA/tree. The Airlock base rules (Output, Delegation, Artifacts and cleanup) from `/airlock:start` or the orchestrator agent apply throughout.

## 1. Load the planned boundary

- Read the approved design, plan, ledger, current Resume checkpoint, and `docs/airlock/STATUS.md` before acting. The ledger remains the only durable machine resume store; STATUS is the human view. Existing legacy artifact paths remain readable.
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

Use this handoff only when the approved route records worker commit permission `none` and launcher sealing permission for one exact candidate with pinned Crossing ID, message bytes/hash, and candidate path set. The worker owns scoped investigation and edits only; the launcher owns deterministic validations, exact staging, commit creation, post-commit proof, and runtime cleanup. Neither may edit an orchestrator process artifact, push, or publish.

The full contract — summary consumption, recovery classification, and the independent candidate audit checklist — is `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md`; read it before auditing and apply it exactly. The load-bearing rules:

- A valid `done` summary is still not acceptance: independently audit the launcher-sealed candidate precursor against the recorded baseline before any orchestrator edit, stage, or commit. Any mismatch stops the candidate for a user decision.
- A blocked summary remains blocked exactly as reported; do not repair it during shipping.
- For a `no-summary`, malformed, timed-out, killed, or disrupted return, first prove the launcher process tree quiescent, then classify exactly one recovery state against the baseline: `no-commit` (no candidate; do not stage or commit the worker's edits), `one-commit` (proceed only to the independent audit), or `indeterminate` (stop without cleanup or mutation).
- Never rewrite candidate history. A cleanup failure after commit leaves the commit intact and blocks acceptance until exact cleanup is independently resolved; it is not permission to replace the commit.

A passing audit freezes the launcher-sealed candidate precursor; subsequent gates exercise that exact SHA/tree, while process-only ledger work does not stale it. The orchestrator then owns the separate orchestrator Crossing. The audit proves local-checkout state only; external side effects remain guardrail and self-report territory.

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

Each evidence record identifies: gate ID, exact candidate, timestamp, executor host role and effective runtime/agent/model/variant, command or MCP tool, environment/target, result, and artifact reference. External evidence also records the additional fields required by `references/EXTERNAL-RUNTIME.md`. A substantive code, test, configuration, generated-artifact, or cited-spec change stales every affected gate; a ledger-only bookkeeping edit does not. For the normal staged path, the resulting commit/tree becomes the candidate identity; for an external handoff, the launcher-sealed precursor SHA/tree remains the candidate and the orchestrator Crossing commit is recorded separately. Retain any pre-commit base/diff hash that gates actually exercised.

If a required gate fails after launcher sealing, or a candidate-bearing change makes its evidence stale, mark the gate/evidence and pack's current candidate `failed` or `stale`, and record it under checkpoint **Fresh evidence** and **Blockers / decisions**; do not add a Crossing entry or create the orchestrator Crossing commit. With explicit approval, a fresh manifest/launcher run starts from current `HEAD` and may seal exactly one successor candidate, or the user may approve an explicit revert commit. Preserve prior candidates and evidence; never silently reset, rebase, amend, or revert them.

Classify every non-product artifact and temporary process created during implementation, verification, or shipping per the base Artifacts-and-cleanup rules. If any temporary artifact or process was created, cleanup is a required gate even when cleanup has already occurred. Add it through an approved plan/ledger amendment if absent. Its fresh evidence must identify the exact paths/processes and prove each was removed or stopped; do not treat an unverified absence as a pass. Pack acceptance is blocked until this evidence is fresh and passed.

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

Use the exact ledger path from the plan; initialize it from `${CLAUDE_PLUGIN_ROOT}/references/LEDGER.template.md` when needed. Record:

```markdown
### Crossing `<crossing-id>` — `<name>` — `<YYYY-MM-DD>`

- **Delivery Pack:** `<pack-id>`
- **Commit:** this commit (the orchestrator Crossing; locate with `git log -S '<crossing-id>' --oneline -- <ledger-path>`)
- **Candidate:** `<launcher-sealed precursor SHA/tree, existing commit/tree, or base SHA + staged product-diff hash>`
- **Owned:** `<this Crossing’s paths>`
- **Touched:** `<final Crossing git diff --cached --name-status; process artifacts only for an external handoff>`
- **Launcher handoff audit:** `n/a` or `<the audited summary facts required by references/EXTERNAL-RUNTIME.md>`
- **Evidence:** `<focused/current Crossing checks and result>`
- **Artifacts / cleanup:** `<retained evidence references; temporary paths/processes and cleanup evidence; or none>`
- **Scope audit:** passed against `<plan Crossing/file contract>`
- **Pack lifecycle after Crossing:** active | accepted
- **Deviations:** none
```

Give every Crossing a unique ID. Record approved deviations; write `none` only after the audit. On final acceptance, store the exact accepted candidate and structured gate evidence in the Delivery Pack section. For an external handoff, `git log -S` locates the orchestrator Crossing commit because it adds the ledger entry. Inspect the recorded launcher candidate with `git show <candidate-sha>` or locate its exact manifest-pinned message using `git log --all --fixed-strings --grep='<candidate-message>' --oneline`.

Set that pack’s review lifecycle to `awaiting-review` when accepted and `in-progress` beforehand. For a `review` Crossing, preserve its `resolving` or `cleared` state; review state never rewrites pack acceptance.

After each gate or cleanup result and before any unfinished return, replace the ledger's bounded Resume checkpoint in place with current paths, fresh evidence, artifact/cleanup state, blockers, and exact next action. Do not append snapshots or paste logs. On final acceptance, set checkpoint **State** to `closed` and reference the final Crossing. A missing checkpoint in a legacy ledger does not invalidate its history; add one only when that work is resumed or repaired.

At every package acceptance and before any unfinished session end, replace `docs/airlock/STATUS.md` in place from current ledger state; never append snapshots and keep only the five newest Recently closed rows. Before compaction, refresh both STATUS and the ledger Resume checkpoint.

Archive the defining plan and specification under `docs/airlock/archive/YYYY-MM/` only when all work packages they define are accepted. If any defined package is planned, active, candidate, blocked, abandoned, or reverted, keep that plan/spec active in `docs/airlock/plans/` and `docs/airlock/specs/`.

Stage the ledger explicitly, rerun `git diff --cached --name-status`, and recompute the candidate hash if any candidate-bearing path changed. Process-only ledger staging does not stale evidence. For an external handoff, stage only orchestrator-owned process artifacts in the Crossing commit, keep launcher-sealed product paths clean, and reference the audited launcher candidate SHA/tree.

## 6. Commit and report

- Follow project commit-message conventions, including required trailers, plus branch/pull/push policy. The orchestrator commits the ledger entry with the Crossing and, for an external handoff, references the launcher candidate SHA/tree and fresh evidence. Only the orchestrator may push or publish, and only when policy allows it or the user asks.
- Verify with `git show --stat --oneline HEAD`.
- Do not call an active pack accepted.

Lead with the shipped outcome. Include Crossing/pack IDs, SHA or candidate identity, gate states/waivers, deviations, skipped checks, and cleanup only when present; the base-rules return contract applies.

## Legacy 1.1 compatibility

A ledger with Crossings but no Delivery Pack sections is one implicit legacy Delivery Pack, `legacy:<work-id>`. Preserve its historical evidence as unstructured text and its existing `Status` as legacy review metadata, not pack lifecycle. Historical pack lifecycle, gate applicability/state, waivers, and exact-candidate evidence are `unknown`; never infer 1.2 gate passes from today’s green run. A ledger without a Resume checkpoint remains valid. Put new post-acceptance changes in a linked 1.2 repair pack rather than rewriting legacy history.

Feedback on shipped work goes through **`review`**.
