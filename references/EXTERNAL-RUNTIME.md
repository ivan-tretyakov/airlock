# External runtime contract (canonical)

This is the single canonical source for Airlock's external-runtime (OpenCode) machinery. Commands and agents reference it instead of repeating it. Read this file only when a task's resolved runtime or approved route is external; native-only work never needs it.

Non-negotiable invariants (also stated where routes are approved):

- Worker commit permission is always `none`; only the deterministic launcher may seal one exact candidate.
- The launcher is invoked directly, exactly once, in the foreground; never through `Agent`, a relay agent, a background job, or a resumed transcript.
- The orchestrator independently audits every launcher-sealed candidate before acceptance.
- Never rewrite candidate history: no reset, checkout, switch, rebase, amend, revert, clean, unstage, or recommit of a candidate or recovery state.

## 1. When external execution is allowed

Use an external runtime only when the approved route names it; never substitute one based on cost or work class, and never select it merely because it is configured — only after Airlock is explicitly started for the task. External execution requires a capable local host with Node.js, Git, and OpenCode; unsupported hosts fail closed without installing dependencies or silently falling back.

For OpenCode Quick work, derive the exact launcher manifest scope from the user's request, use task-owned Quick identifiers where the strict schema requires pack or Crossing identifiers, and create no workflow artifacts. The OpenCode worker remains the task's only leaf, with `subagent_depth: 0` and `task` and interactive questions denied.

## 2. Route record

For each external run, the plan records this complete route: runtime; host role; selected agent, model, and variant; target directory; approved branch; structured baseline (full `HEAD`, empty index, porcelain-v2 status, owned + dirty hashes); exact file contract (Owns, exclusions, STOP rule); worker reads/edits plus optional exploratory command allowlist; mandatory validation argv (ordered direct executable + args arrays, cwd, timeout, output bounds, expected exit); permission/containment policy identity and precedence proof; foreground timeout; commit permissions (worker `none`; launcher one exact candidate with Crossing/message/hash/path set); manifest, artifact, session, retention, and cleanup homes; and independence limits (shared context/family or other).

Commit authority is always split for this route. The worker owns scoped investigation, edits, and optional exploratory evidence. The launcher alone owns mandatory deterministic validations, exact staging, the commit, candidate proof, runtime cleanup, and one bounded summary. The orchestrator owns the independent candidate audit, the ledger, the separate Crossing commit, push, and publication.

External file-writing runs are foreground and serialized per target checkout. Read-only external runs may overlap only when they cannot contend for mutable state.

## 3. Pre-dispatch baseline (writers)

Immediately before manifest creation for a writer:

1. record the approved branch and prove `git branch --show-current` matches it;
2. record the full `HEAD` SHA;
3. prove `git diff --cached --name-status` is empty;
4. capture and parse the complete `git status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none` baseline;
5. hash every exact owned path and every path represented by the structured dirty baseline, preserving absent/file state and rejecting symlinks;
6. prove every task-owned path is clean; and
7. prove the route's complete closed permission/containment policy is loaded and effective under its recorded identity, including precedence over ambient defaults.

Preserve pre-existing unrelated status entries and exclude those paths from the worker contract. Owned paths must start clean. Stop if any precondition fails.

## 4. Manifest schema

Create one secret-free task-owned JSON manifest using schema `airlock.external-agent/v2` and exactly these strict fields: `schema`, `runtime`, `packId`, `crossingId`, `route{agent,model,variant,targetDirectory,branch}`, `prompt`, `opencode{config,permission}`, `timeoutMs`, `baseline{branch,head,indexEmpty,status,ownedPathHashes,dirtyPathHashes}`, `ownedPaths`, `validations[{purpose,executable,args,workingDirectory,timeoutMs,maxStdoutBytes,maxStderrBytes,expectedExitCode}]`, `commit{allowed,crossingId,message,messageSha256,candidatePaths}`, `artifacts{manifestPath,temporaryDirectory,evidencePath,messagePath,hooksDirectory}`, `expected{workerStatus,headings,mutations[{tool,input,minimum}],effectiveIdentity{provider,model}}`, `cleanup{session,manifest,temporaryDirectory,verifyAbsence}`, `retention{session,manifest,temporaryDirectory,transcript}`, and `policy{identity,proof}`.

Unknown or omitted fields fail closed. `commit.allowed` grants only the deterministic launcher permission to seal the exact candidate. Validation commands are direct executable/argument arrays with checkout-contained working directories and no shell tokenization, operators, interpolation, redirects, or pipelines. Write the manifest once, compute and record the lowercase SHA-256 over its exact bytes, and classify every declared external artifact before launch.

## 5. Permission policy

For every external run, supply a complete closed permission set for that invocation, with a final deny-by-default rule proven to override ambient defaults; do not inherit or leave any decision to ambient permissions. Allow only the route's exact reads, owned edits for a writing role, optional exploratory commands, target directory, and required evidence/runtime paths; read-only roles receive no edit permission.

Explicitly deny automatic approval (`--auto` or equivalent), nested delegation, interactive questions, unowned edits, arbitrary shell commands, undeclared external paths, project or runtime configuration, credentials, every Git write, and push/publish operations. A worker may use a read-only Git command only when its exact command is plan-approved and allowed by the manifest; it remains exploratory evidence. Disable interactive credential prompts, inherited SSH-agent access, and remote push capability. Policy identity is the full invocation policy or its immutable source plus content hash, together with these process guardrails and effective-policy proof.

These restrictions are guardrails for an honest agent, not containment of a hostile process. Deterministic return audits are the local-checkout correctness boundary; external side effects remain guardrail and self-report territory.

## 6. Dispatch

Do not construct an OpenCode command, a launcher-internal Git command, or a deterministic validation command outside the manifest. Invoke it directly, exactly once, in the foreground with this sole dispatch command:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs" --manifest <absolute-json-path> --sha256 <lowercase-hex>
```

Never retry, resume, background, or wrap the launcher invocation. From invocation until that exact foreground process returns, the orchestrator remains idle in that checkout: no target file, Git, validation, browser, or agent operation, and no progress action that could race it. The launcher assigns a fresh non-resumable runtime session, redirects raw events to the declared evidence path, and returns only the bounded summary.

## 7. Consume the summary

Consume only the launcher's one bounded JSON summary. Do not read or relay its raw NDJSON evidence. Require the summary to report the fresh external session ID, completion/classification, selected and effective runtime/agent/model/variant, policy identity/proof, worker mutation evidence, deterministic validation results, Git-sealing proof, launcher candidate SHA/tree when created, recovery state, and every exact artifact/process cleanup result.

If the summary reports an unknown process or unknown/blocked cleanup state, leave the checkout and artifacts untouched and stop for the exact reported action. A blocked summary with `no-commit`, staged, post-commit, unknown-process, or cleanup-failure state remains blocked exactly as reported; do not repair it.

## 8. Recovery classification

For a `no-summary`, malformed-summary, timed-out, killed, or otherwise disrupted return, make no checkout edit. First prove the exact launcher process tree is quiescent; stop only the exact task-owned process when its identity is certain and doing so is safe. If process ownership or quiescence cannot be proven, classify `indeterminate`, leave the checkout and artifacts untouched, and stop without checkout inspection.

Once quiescent, inspect branch, `HEAD`, index, complete structured status, owned hashes, and baseline-dirty hashes only against the recorded pre-dispatch baseline, and classify exactly one recovery state:

- **`no-commit`** (no candidate sealed) — `HEAD` is unchanged, the index is unchanged/empty, every baseline-dirty hash is preserved, and all new delta is confined to exact owned paths. No candidate exists; the orchestrator must not stage or commit those edits.
- **`one-commit`** (candidate sealed; independent audit required) — current `HEAD` is exactly one child of the baseline, its exact message bytes/hash and changed paths match the manifest, the index is empty, and structured status plus baseline-dirty hashes match. Proceed only to the independent audit below.
- **`indeterminate`** — every other state. Stop without cleanup or mutation for a user decision.

Never clean, stage, commit, reset, amend, rebase, or otherwise rewrite during recovery. A cleanup failure after commit leaves the commit intact and blocks acceptance until exact cleanup is independently resolved under an approved action; it is not permission to replace the commit.

## 9. Independent candidate audit

For a valid completed summary or a recovered `one-commit` state, independently audit the launcher-sealed candidate before any orchestrator edit, stage, or commit. A valid `done` summary is still not acceptance. Audit and record:

1. the fresh session ID and completion/classification; approved role/branch and selected runtime/agent/model/variant; effective runtime/agent/model/variant; full permission/containment policy identity and effective-policy proof; and exact manifest path/hash;
2. the approved current branch, pre-dispatch full `HEAD` as sole parent, current candidate `HEAD`, exactly one child commit, and full launcher candidate SHA/tree;
3. the exact commit message bytes/hash and complete no-renames changed-name set, all and only within the product file contract and containing no process artifact;
4. an empty index, complete structured porcelain-v2 status exactly equal to the recorded baseline, owned-path hashes, and every unrelated baseline status entry and dirty-path hash preserved;
5. each ordered mandatory validation's direct executable, exact argv, working directory, timeout/output bounds, expected/actual exit, and proof that validation introduced no delta;
6. direct Git executable identity; custom-filter rejection; verified empty hooks path; signing disabled; exact staging/cached-name audit; cached `diff --check`; parent/count/message/tree/path/post-state proof; and the launcher's recovery classification; and
7. exact retained/temporary classification and verified cleanup state for the session, process tree, manifest, evidence, commit-message file, hooks directory, temporary directory, and any other declared artifact.

Any mismatch blocks acceptance without changing candidate history; stop for a user decision. A passing audit freezes the launcher-sealed candidate precursor; subsequent gates exercise that exact SHA/tree, while process-only ledger work does not stale it. The launcher-sealed product candidate remains separate from the orchestrator Crossing; the orchestrator alone owns ledger/process artifacts, the Crossing commit, push, and publication.

## 10. Evidence, checkpoint, and failure handling

Record the audited summary facts under the ledger checkpoint's **Fresh evidence**, and exact session/process/path cleanup under **Temporary artifacts / processes**. External gate evidence additionally records the selected/effective route, full permission/containment policy identity and proof, deterministic-validation/Git-sealing evidence, recovery classification, and exact cleanup.

If a required gate fails after launcher sealing, or a candidate-bearing change makes its evidence stale, mark the gate/evidence and the pack's current candidate `failed` or `stale` and record it in the checkpoint; do not add a Crossing entry or create the orchestrator Crossing commit. With explicit approval, a fresh manifest/launcher run starts from current `HEAD`, passes the full pre-dispatch checks, and may seal exactly one successor candidate; that SHA/tree becomes the current candidate. The other permitted recovery is an explicit user-approved revert commit. Preserve prior candidates and evidence.
