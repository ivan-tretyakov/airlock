# Deterministic External Candidate Sealing Design

## Goal

Release Airlock 1.3.1 with reliable external writer delegation. The external model owns scoped product edits; deterministic launcher code owns mandatory final validation and candidate sealing. Claude independently audits the sealed candidate and remains the sole owner of process artifacts, push, and publication.

This design is the `AIRLOCK-P04` correction to the installed writer failure in `AIRLOCK-P03-C04`. It preserves the 1.3.0 record rather than rewriting it.

## Evidence Requiring The Change

Airlock 1.3.0 made OpenCode process invocation, identity proof, timeout handling, evidence parsing, and cleanup deterministic. Its installed writer gate still depended on the OpenCode worker generating exact Git tool choreography. Repeated disposable runs exposed several incompatible outcomes from the same approved intent:

- one worker produced the exact one-file candidate commit, but the launcher blocked because the manifest over-specified an unrelated read event;
- one worker combined individually approved Git commands into one shell call, which the closed permission policy correctly denied;
- later workers stopped during preflight or guessed the patch pre-image instead of reading it; and
- Claude's host permission classifier intermittently denied the extra `external-runner` agent hop before the launcher started.

The first candidate proved that the edit and commit were feasible. The distribution proved that exact command sequencing is not a reliable model responsibility. Further prompt tuning was stopped as `AIRLOCK-D02`; this design moves that responsibility to deterministic code.

## Scope Contract

- **Deliverable:** Airlock 1.3.1 deterministic external candidate sealing.
- **Design path:** `docs/specs/2026-08-06-deterministic-external-candidate-sealing-design.md`.
- **Plan path:** `docs/plans/2026-08-06-deterministic-external-candidate-sealing.md`.
- **Integration stance:** integrated into the existing hashed-manifest launcher, Claude orchestrator, OpenCode worker, canonical plan/ship semantics, release manifests, and installed activation.
- **Extend or fresh:** extend the launcher and canonical workflow; add fresh `AIRLOCK-P04` design and plan records. Do not rewrite the 1.3.0 design.
- **May touch:** `scripts/run-external-agent.mjs`, `scripts/run-external-agent.test.mjs`, `agents/orchestrator.md`, `agents/external-runner.md`, `adapters/opencode/agents/airlock-worker.md`, `adapters/opencode/README.md`, `skills/plan/SKILL.md`, `skills/ship/SKILL.md`, `skills/ship/LEDGER.template.md`, `README.md`, `PROJECT-CONVENTIONS.template.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, this design, its plan, `docs/ledger/2026-08-05-delivery-packs.md`, and `~/.config/opencode/agents/airlock-worker.md`.
- **Must not touch:** application repositories except fresh disposable probes; credentials, authentication files, or environment values; `~/.config/opencode/opencode.jsonc`; existing specialist agents; historical 1.3.0 design/plan content; canonical brainstorm/review/debug semantics; or installed plugin caches through direct file editing.
- **STOP rule:** any additional source, process-artifact, configuration, or persistent external path requires an approved scope amendment before editing.

## Selected Architecture

1. Claude records the target branch, HEAD, empty index, structured status baseline, clean exact owned paths, deterministic validation commands, and commit contract in one exact manifest, then hashes it.
2. Claude invokes the deterministic launcher directly. The launcher writes OpenCode's event stream to the declared evidence path and returns one bounded JSON summary, so the extra Haiku relay context is no longer needed for containment or context size.
3. The launcher validates the schema, manifest hash, route, branch, HEAD, index, structured status baseline, owned-path state, external artifact paths, and closed permissions before starting OpenCode.
4. OpenCode runs with Git write commands denied. The worker reads and edits exact owned paths and may run only plan-approved exploratory checks.
5. After OpenCode terminates, the launcher proves process quiescence, effective identity, terminal completion, worker `done` status, and required mutation evidence.
6. The launcher verifies that the checkout delta is confined to exact owned paths and that every baseline-dirty path remains byte-identical.
7. The launcher runs mandatory deterministic validation commands as exact argument arrays with `shell: false`, bounded output, explicit working directories, explicit timeouts, and expected exit status.
8. The launcher proves that validation introduced no additional tracked or untracked checkout delta.
9. The launcher re-verifies HEAD, branch, index, status, baseline-dirty hashes, and owned-path hashes immediately before staging and immediately before committing.
10. The launcher stages only exact owned paths, audits the cached path set and `diff --check`, creates one candidate commit, and verifies its parent, count, message, tree, paths, index, and remaining status.
11. Claude independently repeats the candidate audit. Claude then owns the separate ledger Crossing commit, push, marketplace update, installation, and publication evidence.

## Manifest Contract

The manifest remains strict data rather than shell source. New fields use exact keys and bounded values. Unknown keys fail closed.

The candidate-sealing portion records:

- structured baseline branch, full HEAD, empty-index assertion, porcelain-v2 status entries, exact owned-path hashes, and exact baseline-dirty path hashes;
- exact relative owned paths, with no globs and no paths outside the checkout;
- worker read/edit permissions and optional exploratory command permissions;
- ordered mandatory deterministic validations, each carrying a purpose, direct executable, argument array, checkout-contained working directory, timeout, bounded-output policy, and expected exit status;
- commit permission, exact Crossing ID, exact message bytes/hash, and exact candidate path set; and
- task-owned manifest, evidence, message, hooks, and temporary paths outside the target checkout.

Command strings that require tokenization, shell operators, environment expansion, pipes, redirects, or conditionals are invalid. The hash pins the complete executable contract, but plan approval remains the authority for which commands are allowed.

## Worker Boundary

The OpenCode worker owns source investigation and exact scoped edits. It may run approved exploratory checks when useful, but their results do not satisfy mandatory final gates.

The worker may not stage, commit, amend, reset, checkout, switch, merge, rebase, clean, push, publish, write process artifacts, or delegate. For a writer dispatch, the launcher requires at least one successful declared mutation event, but it does not require incidental reads or a particular sequence of model tool calls.

The worker report describes edits and exploratory evidence only. It does not claim that a candidate commit exists. This removes the brittle 1.3.0 requirement that a model perform and narrate exact Git choreography.

## Deterministic Validation Boundary

Only deterministic command gates run inside the launcher. Judgment gates such as independent review, security assessment, browser verification, and visual review remain Claude/verifier responsibilities against the sealed candidate.

Every final command runs directly with an argv array and `shell: false`. The launcher applies a closed child environment, strips credential and SSH-agent variables, disables interactive prompts, blocks remote operations, captures bounded output, and terminates the exact process tree on timeout.

The launcher snapshots structured status and relevant path hashes immediately before validation and requires the same candidate delta immediately afterward. Any tracked or untracked mutation outside the pre-validation delta blocks before staging. Declared ignored build artifacts, if a project genuinely requires them, need a future scope amendment with exact ownership and cleanup semantics; 1.3.1 does not infer or broadly clean ignored files.

## Git Sealing Boundary

The launcher resolves a direct Git executable rather than a shell shim. All Git invocations use argument arrays and the same credential, SSH, signing, network, timeout, and process-tree restrictions as the OpenCode child.

The candidate commit uses the real repository index only after an empty-index precondition and repeated baseline verification. The launcher:

1. rejects custom `filter` attributes on every owned path, preventing checkout-defined clean or smudge programs from executing during staging;
2. points `core.hooksPath` at a verified empty task-owned directory outside the checkout, making explicit deterministic validations the completion gate rather than arbitrary local hooks;
3. stages each exact owned path with an explicit pathspec, including exact deletions, and never uses a broad repository pathspec;
4. audits the cached name set against the derived exact changed-owned set and runs cached `diff --check`;
5. writes the exact approved commit message to a task-owned file and commits with `--file`, `--no-gpg-sign`, and the verified empty hooks path;
6. verifies full parent, one-commit count, exact message bytes, changed names, tree, empty index, and remaining structured status; and
7. removes only exact task-owned temporary files and directories after evidence extraction.

The launcher never automatically resets or rewrites history. If staging or commit fails, it reports the exact index and checkout state for a human decision.

## Race And Crash Handling

The target checkout remains a serialized writer lane. Claude does not inspect or mutate it while the launcher is active. Re-verification immediately before staging and commit narrows, but cannot eliminate, races from editors, file watchers, or unrelated user processes.

Any HEAD movement, index change, baseline-path hash change, owned-path change after validation, or unexpected status entry blocks. A non-empty post-commit owned delta is an audit failure even if the commit itself succeeded.

If the launcher exits without a valid summary, Claude uses the recorded pre-dispatch baseline only for recovery inspection:

- unchanged HEAD and confined owned edits mean no candidate was sealed;
- exactly one child commit with the exact Crossing ID and exact owned path set may resume independent audit; and
- every other state stops without cleanup, reset, checkout, amend, or history rewriting.

A cleanup failure after a successful commit leaves the commit intact and blocks acceptance on cleanup. It is never treated as a failed commit that may be rewritten.

## Direct Claude Invocation

The 1.3.0 `external-runner` relay was intended to keep raw event streams out of the expensive orchestrator context. The launcher already redirects those events to a file and emits one bounded JSON line. The relay therefore adds a model-controlled invocation and an intermittently denied host-agent permission boundary without reducing the returned context.

Airlock 1.3.1 makes the orchestrator invoke the exact hashed-manifest launcher command directly and exactly once. The launcher, not Claude, still owns command construction, runtime arguments, timeout, parsing, identity proof, and cleanup. A host denial before launcher start remains a distinct no-state-created blocker.

The existing `external-runner` source may be documented as superseded for external dispatch, but is not deleted in this patch unless implementation proves that keeping it creates an active routing ambiguity.

## Ownership And Ledger Semantics

The two-commit structure remains:

- the launcher seals one product candidate containing exact owned product paths; and
- Claude creates a separate orchestrator-owned Crossing commit containing design, plan, ledger, and gate evidence.

Canonical documentation and ledger fields use `launcher-sealed candidate`, not `worker-created commit`. The worker still owns the product edits semantically; the launcher owns their deterministic sealing. Claude never mixes process artifacts into the candidate.

`AIRLOCK-P03-C04` records the failed 1.3.0 installed writer gate. `AIRLOCK-D02` records the root cause and this approved design reversal. A new `AIRLOCK-P04` Delivery Pack owns implementation, release, installation, and acceptance of 1.3.1.

## Alternatives Rejected

1. **Continue prompt tuning:** empirically produced incompatible outcomes and violates the requirement to reproduce and isolate rather than stack stochastic retries.
2. **Move only Git to the launcher:** leaves mandatory validation dependent on model command behavior and reporting.
3. **Make Claude create the candidate:** simpler, but collapses product and process ownership into the orchestrator and weakens the external handoff audit.
4. **Give the worker one commit wrapper tool:** still depends on the model invoking the wrapper correctly and adds another protocol without removing the nondeterministic seam.
5. **Move all shell access out of the worker:** prevents normal iterative coding and debugging; only mandatory final checks need deterministic ownership.
6. **Keep the Haiku relay as mandatory:** preserves the intermittent host-agent classifier seam while returning no less context than direct launcher invocation.
7. **Use shell command strings:** recreates quoting, chaining, and tokenization ambiguity eliminated by `AIRLOCK-D01`.
8. **Run repository hooks and custom filters:** executes checkout-local code in the trusted sealing component and makes candidate creation environment-dependent.

## Verification Intent

The 1.3.1 plan must add regression coverage beyond the existing 21 launcher tests. Required cases include:

- wrong branch, moved HEAD, dirty owned path, non-empty index, malformed structured baseline, and baseline-dirty hash change;
- out-of-contract worker edit, failed or absent mutation event, blocked worker, timeout, and unknown process state;
- validation argv/schema rejection, nonzero validation, timeout, output bounds, checkout escape, and validation-created delta;
- direct Git executable resolution and shim rejection;
- custom filter rejection and verified empty hooks path;
- exact staging for modified, added, and deleted paths, including paths with spaces;
- cached-name mismatch, cached `diff --check`, commit-message byte round-trip, parent/count/tree/path verification, and clean-index audit;
- HEAD or checkout movement immediately before stage or commit;
- failure before staging, failure after staging, failure after commit, cleanup failure after commit, and missing-summary recovery;
- source and installed Claude-to-OpenCode writer smokes using a fresh disposable repository; and
- exact session, manifest, evidence, message, hooks-directory, process, and repository cleanup.

An independent cross-model reviewer challenged the design before approval. Its four blocking concerns were the executable manifest surface, Git hooks/filters, TOCTOU, and validation mutation. This design addresses them through strict argv-only schema, closed direct subprocesses, empty hooks and filter rejection, repeated baseline verification, and pre/post-validation delta equality. Residual risk remains that a process running as the user is not an adversarial sandbox and that external user processes can race the checkout; Airlock detects and stops on observable drift rather than claiming full containment.

## High-Level Plan

1. **Critical:** materialize the `AIRLOCK-P04` plan, exact file contracts, gate matrix, and recovery cases.
2. **Critical:** extend manifest validation, deterministic command execution, Git sealing, classifications, and regression tests.
3. **Standard:** simplify worker/orchestrator contracts and update canonical ownership and operator documentation.
4. **Critical:** obtain independent cross-model security review and run the complete source verification matrix.
5. **Critical:** publish and install 1.3.1, run one fresh installed writer gate, remove exact temporary state, record evidence, commit the Crossing, and push.
