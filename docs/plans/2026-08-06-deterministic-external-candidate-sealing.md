# Deterministic External Candidate Sealing Implementation Plan

## Goal

Deliver Airlock 1.3.1 as `AIRLOCK-P04`: external OpenCode workers make exact approved product edits without owning Git choreography; the dependency-free launcher independently validates the checkout, runs mandatory deterministic checks, seals one exact candidate commit, proves its result, and cleans exact runtime state. Claude invokes the bounded launcher directly, independently audits the candidate, owns process artifacts, publishes and installs 1.3.1, and proves the complete installed writer flow in a fresh disposable repository.

Done means all required P04 gates have fresh evidence against one exact candidate, the installed Claude-to-OpenCode writer flow creates and audits one exact commit, all task-owned external state is removed, the ledger closes P03 as failed/superseded and accepts P04, and `main` is committed and pushed by explicit user instruction.

## Approved Design And Architecture

The approved design is `docs/specs/2026-08-06-deterministic-external-candidate-sealing-design.md`.

Load-bearing invariants:

- the user-selected Claude Opus/Fable orchestrator owns routing, audit, process artifacts, push, and publication;
- the OpenCode worker owns only exact scoped product investigation and edits;
- the launcher owns deterministic preflight, mandatory command validation, exact staging, candidate commit, post-commit proof, runtime identity, timeout, and cleanup;
- manifests are strict hash-pinned data; executable commands are direct argv arrays with `shell: false`, never shell strings;
- the worker receives a closed deny-by-default policy, may not perform Git writes, and may not delegate or inspect credentials;
- target-checkout writers are serialized and Claude is idle in that checkout while the launcher runs;
- exact task artifacts live outside the target checkout and cleanup never uses broad globs;
- custom Git filters on owned paths fail closed; hooks and signing are disabled for launcher sealing;
- baseline-dirty paths remain byte-identical, owned paths begin clean, and every unexpected delta stops without reset or history rewriting;
- deterministic command gates run in the launcher; judgment gates remain independent verifier work against a frozen candidate; and
- the launcher candidate and orchestrator Crossing remain separate commits.

The direct Claude-to-launcher path supersedes mandatory use of the Haiku relay because the launcher already redirects raw events and emits one bounded JSON summary. `agents/external-runner.md` remains present unless implementation proves that retaining it creates active routing ambiguity.

## File Contract

### Owns

- `scripts/run-external-agent.mjs`
- `scripts/run-external-agent.test.mjs`
- `agents/orchestrator.md`
- `agents/external-runner.md`
- `adapters/opencode/agents/airlock-worker.md`
- `adapters/opencode/README.md`
- `skills/plan/SKILL.md`
- `skills/ship/SKILL.md`
- `skills/ship/LEDGER.template.md`
- `README.md`
- `PROJECT-CONVENTIONS.template.md`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `docs/specs/2026-08-06-deterministic-external-candidate-sealing-design.md`
- `docs/plans/2026-08-06-deterministic-external-candidate-sealing.md`
- `docs/ledger/2026-08-05-delivery-packs.md`
- `C:/Users/IvanTretyakov/.config/opencode/agents/airlock-worker.md`

### Process Artifacts

Owned only by the orchestrator at every phase:

- `docs/specs/2026-08-06-deterministic-external-candidate-sealing-design.md`
- `docs/plans/2026-08-06-deterministic-external-candidate-sealing.md`
- `docs/ledger/2026-08-05-delivery-packs.md`

The orchestrator updates the plan tasks and ledger checkpoint after every return, gate, scope decision, and Crossing. No subagent may edit these paths.

### Candidate-Bearing Paths

Changes to any of these stale affected final evidence:

- `scripts/run-external-agent.mjs`
- `scripts/run-external-agent.test.mjs`
- `agents/orchestrator.md`
- `agents/external-runner.md`
- `adapters/opencode/agents/airlock-worker.md`
- `adapters/opencode/README.md`
- `skills/plan/SKILL.md`
- `skills/ship/SKILL.md`
- `skills/ship/LEDGER.template.md`
- `README.md`
- `PROJECT-CONVENTIONS.template.md`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `docs/specs/2026-08-06-deterministic-external-candidate-sealing-design.md`

Administrative task ticks and ledger checkpoint replacement alone do not stale source tests, but a design decision change does.

### Must NOT Touch

- application repositories except the exact disposable P04 probes;
- `C:/Users/IvanTretyakov/.config/opencode/opencode.jsonc`;
- credentials, authentication files, environment files, browser profiles, cookies, localStorage, SSH agents, or token-bearing logs;
- installed plugin-cache files through direct editing;
- existing specialist agents other than `agents/orchestrator.md` and `agents/external-runner.md`;
- historical 1.3.0 design and plan content, including `docs/specs/2026-08-06-external-agent-delegation-design.md` and `docs/plans/2026-08-06-external-agent-delegation.md`;
- canonical brainstorm, review, or debug semantics; and
- pre-existing unrelated worktree paths.

The existing unstaged modification in `docs/plans/2026-08-06-external-agent-delegation.md` is unowned historical state. Preserve it exactly and exclude it from every staged-diff audit.

### STOP And Handoff

If implementation, validation, publication, or cleanup needs any path outside `Owns`, stop and request a scope amendment. Never widen staging or cleanup to absorb unrelated state. A file-writing subagent that needs a process artifact or unowned path must stop and report rather than edit it.

## Delivery Pack

| Pack ID | Outcome / acceptance | Crossing range | Lifecycle | Dependencies | Multi-Crossing reason | Rollback strategy | Pack/routing/gates approval |
|---|---|---|---|---|---|---|---|
| `AIRLOCK-P04` | Airlock 1.3.1 deterministically validates and seals an externally edited candidate and passes a fresh installed writer gate | `AIRLOCK-P04-C01`…`AIRLOCK-P04-C04` | planned | P03 C01–C03 source; failed P03 installed writer evidence; approved P04 design | launcher safety core, workflow adoption, release source, and installed activation are independently auditable | disable/remove 1.3.1 activation and global worker, then revert C03, C02, and C01 in reverse order; never rewrite disposable or user history automatically | proposed |

P03 remains historical evidence: C01–C03 shipped 1.3.0 source; C04 failed at the installed writer gate and is superseded by P04. P04 does not amend those commits or rewrite their design.

## Crossing Map

| Crossing ID | Pack ID | Tasks | Buildable result | Depends on | Owns |
|---|---|---|---|---|---|
| `AIRLOCK-P04-C01` | P04 | 1–13 | launcher validates the new contract, executes deterministic final checks, seals and audits exact candidates, and handles failures under tests | approved design | `scripts/run-external-agent.mjs`, `scripts/run-external-agent.test.mjs` |
| `AIRLOCK-P04-C02` | P04 | 14–22 | canonical workflow, Claude route, worker boundary, ledger schema, and global worker consistently use launcher-sealed candidates | C01 | launcher static-assertion tests, canonical skills/template, Claude/OpenCode agents, global worker |
| `AIRLOCK-P04-C03` | P04 | 23–31 | complete documented 1.3.1 source validates, passes source writer smoke, and has independent frozen-candidate approval | C02 | docs, conventions, adapter README, manifests, all source candidate paths |
| `AIRLOCK-P04-C04` | P04 | 32–39 | 1.3.1 is pushed, published, installed, passes fresh installed writer/audit and cleanup gates, and P04 is accepted | C03 | external activation plus orchestrator process artifacts |

Every Crossing includes an orchestrator-only update to the P04 plan and ledger before `airlock:ship`. Candidate code/docs and process artifacts are staged by exact path in separate commits where the external candidate-sealing protocol requires that split.

## Tasks

### Crossing 1 - Launcher Contract And Candidate Sealing

- [x] 1. Add RED schema tests for structured baseline, exact relative owned paths, argv-only validations, checkout-contained working directories, commit contract, and external artifact paths; run the focused Node suite and observe the new manifests rejected or unsupported.
- [x] 2. Implement the minimum strict schema and policy-identity changes; rerun focused tests GREEN.
- [x] 3. Add RED preflight tests for wrong branch, moved HEAD, non-empty index, dirty owned path, malformed porcelain-v2 baseline, baseline-dirty hash drift, symlink/path escape, and pre-existing evidence/temp paths.
- [x] 4. Implement direct Git resolution, structured baseline parsing, path validation, and preflight classification; rerun focused tests GREEN.
- [x] 5. Add RED worker-boundary tests proving Git writes are absent from worker permissions, one successful declared mutation is required for writers, incidental reads are not required, and out-of-contract edits block.
- [x] 6. Implement worker-result and post-worker delta assessment; rerun focused tests GREEN.
- [x] 7. Add RED deterministic-validation tests for argv preservation, shell-string rejection, timeout, nonzero exit, bounded output, checkout escape, closed environment, process-tree termination, and any validation-created status/hash delta.
- [x] 8. Implement the minimum deterministic validation runner and post-validation equality checks; rerun focused tests GREEN.
- [x] 9. Add RED Git-sealing tests for direct executable resolution, shim rejection, custom filter rejection, verified empty hooks path, modified/added/deleted exact paths, spaces in paths, cached-name mismatch, cached `diff --check`, signing disabled, and exact message-byte round trip through a message file.
- [x] 10. Implement exact-path staging, cached audit, commit creation, and post-commit parent/count/message/tree/path/index/status proof; rerun focused tests GREEN.
- [x] 11. Add RED race/recovery tests for HEAD/index/status movement immediately before stage or commit, failure before staging, failure after staging, commit-success/audit-failure, cleanup failure after commit, and missing-summary recovery classification.
- [x] 12. Implement fail-closed race, recovery, result-summary, and exact cleanup states without reset or history rewriting; rerun focused tests GREEN.
- [x] 13. Refactor duplicated subprocess/audit code without broadening behavior; run syntax check, all launcher tests, and source diff checks, then checkpoint before C01 shipping.

Expected RED evidence is a precise assertion failure or unsupported-manifest classification for each new case, not a generic fixture crash. All child-process tests use disposables and bounded foreground timeouts.

### Crossing 2 - Workflow And Agent Adoption

- [x] 14. Add RED static/fixture assertions to the launcher suite for the new orchestrator route, worker no-commit boundary, launcher-sealed terminology, and absence of active mandatory relay routing.
- [x] 15. Update `agents/orchestrator.md` to create/hash the new manifest, invoke the launcher directly once, remain idle during execution, perform crash recovery inspection, and independently audit the launcher-sealed candidate.
- [x] 16. Update `agents/external-runner.md` as superseded/non-routing compatibility documentation, or stop for a scope decision if retaining it creates an active ambiguity.
- [x] 17. Update the source OpenCode worker to own reads/edits and exploratory evidence only, deny Git writes, describe fresh runtime session semantics correctly, and report no candidate-commit claim.
- [x] 18. Update canonical plan routing and manifest semantics from worker-created to launcher-sealed candidates while preserving plan-approved model, command, permission, and cleanup decisions.
- [x] 19. Update canonical ship audit and `LEDGER.template.md` for launcher candidate SHA/tree, deterministic validation evidence, crash recovery, cleanup-after-commit blocking, and separate orchestrator Crossing ownership.
- [x] 20. Rerun static assertions, launcher tests, and canonical consistency searches GREEN; audit all changed paths against C02 ownership.
- [x] 21. Copy the reviewed worker byte-for-byte to `C:/Users/IvanTretyakov/.config/opencode/agents/airlock-worker.md`; prove source/global hashes match without modifying global OpenCode configuration.
- [x] 22. Run OpenCode config resolution and one no-write worker smoke under the revised closed policy, remove its exact session/artifacts, then checkpoint before C02 shipping.

### Crossing 3 - Documentation, Release Source, And Source Proof

- [x] 23. Update root README, adapter README, and project conventions with argv-only validation, direct launcher invocation, Git sealing, hook/filter behavior, failure recovery, and exact operator prerequisites.
- [x] 24. Bump plugin and marketplace manifests from 1.3.0 to 1.3.1 without changing unrelated plugin inventory.
- [x] 25. Update the P04 ledger with P03 C04 failure evidence, `AIRLOCK-D02`, P04 lifecycle, gate register, current candidate, and one bounded Resume checkpoint; do not modify the historical P03 design/plan.
- [x] 26. Run all launcher tests and syntax checks against the complete candidate.
- [x] 27. Run strict Claude plugin validation and source plugin details; require version 1.3.1, five skills, ten agents, inherited orchestrator model, and revised routes.
- [x] 28. Run a source-plugin Fable-to-launcher-to-OpenCode writer smoke in exact disposable repo `C:/Users/IVANTR~1/AppData/Local/Temp/opencode/airlock-p04-source-writer`: one `owned.txt` edit, one launcher-sealed commit, exact Claude audit, and no raw event stream in orchestrator output.
- [x] 29. Run an independent cross-family security/process review of the frozen C01–C03 candidate, briefed to distrust command execution, Git hooks/filters, baseline preservation, race recovery, direct invocation, and cleanup.
- [x] 30. Run an independent verifier against the same frozen candidate: full launcher tests, strict plugin validation, documentation/agent consistency, source/global worker hash, source writer smoke evidence, and staged-name audit without editing source.
- [x] 31. Resolve blocking findings one at a time through Airlock debug/review as applicable, refresh stale evidence after any candidate-bearing change, remove exact source-smoke state, then checkpoint and ship C03.

### Crossing 4 - Publish, Install, Prove, And Accept

- [x] 32. Push the reviewed C01–C03 source Crossings to `origin/main` under the standing user instruction to push everything; verify local/remote SHA equality.
- [x] 33. Update the marketplace and installed plugin to 1.3.1 through supported plugin commands, never direct cache editing; verify version, five skills, and ten agents.
- [x] 34. Create exact disposable installed-gate repo `C:/Users/IVANTR~1/AppData/Local/Temp/opencode/airlock-p04-installed-writer` with branch `main`, one baseline `owned.txt` commit, and no unrelated state.
- [x] 35. Run installed Fable orchestrator direct-to-launcher-to-OpenCode writer flow with `openai/gpt-5.4-mini`, variant none: worker reads and edits only `owned.txt`; launcher runs one argv-declared content validation, seals one candidate, and returns `done` with effective identity and cleanup evidence.
- [x] 36. Independently audit branch, recorded parent, exactly one child commit, exact Crossing message, changed-name set, tree, file bytes/final newline, empty index, clean status except declared external artifacts, effective route, policy identity, and session/process state.
- [x] 37. Delete exact source/installed disposable repos, manifests, evidence, message files, hooks directories, OpenCode sessions, and attributable processes; verify absence and do not clean unknown state.
- [x] 38. Run final installed inventory and bounded no-write smoke; record G21–G27 evidence, close the Resume checkpoint, mark P03 failed/superseded and P04 accepted, and stage only exact C04 process artifacts.
- [x] 39. Invoke `airlock:ship` for the final Crossing, commit the ledger/plan closure, push `main`, and verify local/remote SHA equality and intact deliverable documents.

## Execution Routing

All file-writing groups are serialized. Read-only independent review and verification run only after the candidate is frozen and may run in parallel if neither invokes a mutable smoke target.

| Pack / Crossing / task | Work class | Host role | Mode | Selected agent/runtime | Selected model | Why | Parallel group | Checkpoint | Owns |
|---|---|---|---|---|---|---|---|---|---|
| P04-C01 1–13 | Critical | implementer | subagent | `code-critical` | Sol max | security-sensitive public manifest and Git transaction boundary | A | yes | launcher + tests |
| P04-C02 14–20 | Critical | implementer | subagent | `code-critical` | Sol max | cross-cutting ownership and recovery semantics | B after A | yes | launcher tests + canonical skills/template + agents |
| P04-C02 21–22 | Critical | orchestrator | inline | active orchestrator | Sol | global activation and real runtime state stay orchestrator-owned | C after B | yes | global worker + exact temp state |
| P04-C03 23–28 | Standard | implementer/orchestrator | mixed | `code-standard` then active orchestrator | Terra high then Sol | mechanical docs/release followed by controlled source integration | D after C | yes | docs/manifests, then temp source probe |
| P04-C03 29 | Critical | independent-reviewer | subagent | `review-glm` | GLM high | different-family hostile review | E after freeze | yes | read-only candidate |
| P04-C03 30 | Critical | verifier | subagent | `verify` | DeepSeek high | independent command evidence | E after freeze | yes | read-only candidate |
| P04-C03 31 | Critical | orchestrator | inline | active orchestrator | Sol | finding triage and exact cleanup | F after E | yes | owned source/process paths only |
| P04-C04 32–39 | Critical | orchestrator | inline | active orchestrator | Sol | push, installation, external state, audit, and ledger closure | G | yes | activation, disposables, process artifacts |

### Host Mapping

| Host role / work class | Selected host agent or runtime | Selected available model | Independence / rationale |
|---|---|---|---|
| implementer / Critical | `code-critical` | Sol max | maximum reasoning for launcher security and public contract |
| implementer / Standard | `code-standard` | Terra high | contained documentation and release integration |
| independent-reviewer / Critical | `review-glm` | GLM high | different model family, instructed to distrust the candidate |
| verifier / Critical | `verify` | DeepSeek high | read-only independent command execution |
| orchestrator / Critical | inline active orchestrator | Sol | owns process artifacts, global state, publication, and final audit |
| external worker / installed gate | OpenCode `airlock-worker` | `openai/gpt-5.4-mini`, variant none | proves the selected external runtime route; not independent of OpenAI-family implementation reasoning |

Every file-writing subagent prompt must restate this approved contract verbatim:

> **You may create or modify ONLY:** the exact task-specific subset listed in the routing row and Crossing map.
>
> **You must NOT touch:** application repositories except the named disposable probe; credentials/auth/environment files; global OpenCode config; installed plugin caches; historical 1.3.0 design/plan; specialist agents outside the two named host agents; canonical brainstorm/review/debug; process artifacts; unrelated worktree state.
>
> **Integration stance:** integrated with the existing hashed-manifest launcher, Claude orchestrator, OpenCode worker, canonical plan/ship semantics, release manifests, and installed activation.
>
> **STOP rule:** if the task appears to require any path outside the allowlist, STOP and report back. Do not edit it. A blocked task reported honestly is a success; widened scope is not.

Prompts also include exact Pack/Crossing IDs, RED/GREEN steps, bounded commands, expected evidence, no push permission, and the five-bullet return contract. After every return the orchestrator audits `git diff --name-status`, `git diff --numstat`, and staged names against the task contract before acceptance.

## Installed External Route

| Pack / Crossing / task | Runtime | Role | Selected agent | Model | Variant | Target directory | Approved branch | Exact file contract | Approved worker commands | Permission / containment identity and proof | Foreground timeout | Commit permission | Session / evidence / cleanup | Independence limits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P04-C04 task 35 | OpenCode | external implementer | `airlock-worker` | `openai/gpt-5.4-mini` | none | `C:/Users/IVANTR~1/AppData/Local/Temp/opencode/airlock-p04-installed-writer` | `main` | read/edit only `owned.txt`; all other checkout/process paths excluded; STOP on any other need | no worker shell command required; read `owned.txt`, edit via approved edit tool | complete deny-by-default invocation manifest; exact read/edit allow; Git writes, task/question, external dirs, config, credentials, network, push denied; immutable policy hash computed before run; precedence proof `AIRLOCK-E12` plus fresh 1.3.1 effective-policy evidence | 180000 ms worker plus bounded launcher validations | launcher may seal one candidate; worker commit permission none | fresh non-resumable session; evidence/manifest/message/hooks outside checkout; sanitized bounded result; exact session/files/process/repo cleanup after audit | same host account; honest-agent guardrails, not adversarial isolation; OpenAI-family worker is functional evidence, not independent review |

The mandatory deterministic validation for the installed probe is one direct Node argv command that reads only `owned.txt`, checks its exact UTF-8 bytes and final newline, and exits nonzero on mismatch. The exact executable path and argv are recorded and hash-pinned in the run manifest before dispatch. The launcher's internal Git operations are schema-defined behavior, not model-approved shell strings.

## Required Gates

| Gate ID | Pack ID | Gate | Applicability | Initial state | Executor | Command / target | Environment | Pass condition / artifact |
|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-G21` | P04 | launcher contract and regression suite | required | pending | verifier | `node --test scripts/run-external-agent.test.mjs` plus `node --check scripts/run-external-agent.mjs` | frozen source candidate | all old and new schema, validation, Git, race, recovery, and cleanup cases pass |
| `AIRLOCK-G22` | P04 | canonical/agent consistency | required | pending | verifier | static assertions and targeted searches | frozen source + global worker | no worker-commit or mandatory-relay contradiction; source/global worker byte-identical |
| `AIRLOCK-G23` | P04 | independent security/process review | required | pending | independent-reviewer | frozen C01–C03 diff | full source candidate | no blocking finding on executable contract, hooks/filters, TOCTOU, recovery, direct invocation, or cleanup |
| `AIRLOCK-G24` | P04 | plugin/release validation | required | pending | verifier | strict plugin validation and plugin details | source plugin | valid 1.3.1, five skills, ten agents, inherited orchestrator model, expected routes |
| `AIRLOCK-G25` | P04 | source end-to-end writer | required | pending | orchestrator + verifier | source Claude → launcher → OpenCode disposable | exact source probe | worker edit, deterministic validation, one launcher candidate, independent audit, effective identity, and cleanup succeed |
| `AIRLOCK-G26` | P04 | installed end-to-end writer | required | pending | orchestrator + verifier | installed Claude → launcher → OpenCode disposable | exact installed probe | scoped product edit, launcher `done`, exact candidate commit, Claude audit, and installed 1.3.1 route succeed |
| `AIRLOCK-G27` | P04 | publication and cleanup | required | pending | orchestrator + verifier | remote SHA, installed inventory, exact sessions/paths/processes | source, marketplace, global worker, approved temp home | local/remote equality; 1.3.1 enabled; all task-owned temporary state removed; retained evidence ledger-referenced |

### Gate Decisions

| Pack ID | Considered gate | Applicability | Reason |
|---|---|---|---|
| P04 | browser-functional | not-required | no browser or application behavior changes |
| P04 | visual-fidelity | not-required | no UI output |
| P04 | live customer integration | not-required | validation uses isolated local disposable repositories and no customer data |
| P04 | performance benchmark | not-required | bounded launcher overhead is not user-facing throughput; timeouts and output limits receive deterministic tests |

No gate may pass from a test count or agent assertion alone. Final gate evidence records exact candidate SHA/tree or base plus staged product-diff hash, timestamp, effective agent/model, command/target, result, and artifact/cleanup state. Candidate-bearing changes stale affected evidence.

## Evidence And Cleanup

The ledger is the durable evidence home. Full OpenCode transcripts are temporary by default. A debug reproduction may retain one sanitized NDJSON file only after its exact path is added through an approved scope amendment; acceptance never depends on an unrecorded transcript.

Task-owned external state is limited to:

- exact source and installed disposable repository paths named above;
- exact manifest, NDJSON, commit-message, empty-hooks, bounded-output, and temporary config paths under `C:/Users/IVANTR~1/AppData/Local/Temp/opencode`;
- exact OpenCode session IDs returned by the launcher; and
- exact foreground process IDs/trees started by the launcher.

Every artifact is classified retained or temporary before creation. Cleanup deletes only exact attributable paths/session IDs and proves absence. Unknown, pre-existing, user-owned, browser, credential, or another lane's state is never removed. Cleanup is a required gate and remains blocking after a successful candidate commit.

## Resume Checkpoint

On execution approval, replace the ledger's single `## Resume checkpoint` in place with:

- state `active`;
- active pack/Crossing `AIRLOCK-P04` / `AIRLOCK-P04-C01`;
- P03 C04 failed/superseded and P04 design/route/gates approved;
- exact current attributable paths, including the new design/plan and existing ledger diff;
- `AIRLOCK-D02` and independent design-review evidence;
- the historical P03 plan diff as preserved unowned state;
- no active external session/process;
- exact retained and temporary evidence state; and
- next action: dispatch or execute C01 under the approved route.

Refresh after every subagent return, gate, checkpoint, scope amendment, Crossing, and before an unfinished stop. At P04 acceptance set state `closed`, identify C04, and retain only stable ledger references.

## Commit And Review Boundaries

1. **`AIRLOCK-P04-C01` - deterministic candidate sealing core:** launcher and tests; checkpoint after complete focused evidence; ship before workflow adoption.
2. **`AIRLOCK-P04-C02` - adopt launcher-sealed ownership:** canonical skills/template, agents, and byte-identical global worker; checkpoint after runtime resolution; ship before release docs.
3. **`AIRLOCK-P04-C03` - release 1.3.1 source:** docs, conventions, manifests, source smoke, independent review, and verification; ship and push before installed activation.
4. **`AIRLOCK-P04-C04` - publish, install, prove, and accept:** installation, installed writer gate, cleanup, ledger closure, final commit, and push.

Invoke `airlock:ship` at every Crossing. Scope-audit staged names with `git diff --cached --name-status`; never use `git add -A`. Review feedback after a shipped Crossing goes through `airlock:review`.

## End-To-End Proof

The final proof is an installed 1.3.1 run from a user-selected Fable orchestrator through the direct hashed launcher to OpenCode `airlock-worker` on `openai/gpt-5.4-mini`. In a fresh exact disposable repository, the worker reads and changes only `owned.txt`; the launcher independently verifies baseline and mutation, runs an exact argv validation, stages only `owned.txt`, creates one exact Crossing candidate, verifies it, deletes the runtime session, and returns one bounded `done` summary. Claude then proves the candidate parent/count/message/path/tree/content/index/status and exact cleanup without modifying or rewriting it.
