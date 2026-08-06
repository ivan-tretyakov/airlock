# External Agent Delegation Plan

## Goal and Architecture

Ship Airlock 1.3.0 so a user-selected Claude Opus/Fable orchestrator can dispatch plan-approved work to an OpenCode model through a cheap bridge context, verify one scoped worker product commit, record the Airlock Crossing itself, and clean session/temp state.

The approved design is `docs/specs/2026-08-06-external-agent-delegation-design.md`. External writing is serialized in the active checkout. The first gate is a disposable feasibility probe; failure stops all candidate source work.

## File Contract

### Owns

- `skills/plan/SKILL.md`
- `skills/ship/SKILL.md`
- `skills/ship/LEDGER.template.md`
- `agents/orchestrator.md`
- `agents/external-runner.md` (new)
- `scripts/run-external-agent.mjs` (new)
- `scripts/run-external-agent.test.mjs` (new)
- `adapters/opencode/agents/airlock-worker.md` (new)
- `adapters/opencode/README.md`
- `README.md`
- `PROJECT-CONVENTIONS.template.md`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `C:/Users/IvanTretyakov/.config/opencode/agents/airlock-worker.md` (new external integration copy)

### Process Artifacts (Orchestrator Only)

- `docs/specs/2026-08-06-external-agent-delegation-design.md`
- `docs/plans/2026-08-06-external-agent-delegation.md`
- `docs/ledger/2026-08-05-delivery-packs.md`

### Candidate-Bearing Paths

All `Owns` paths and the approved design are candidate-bearing. The plan and ledger are administrative except when their text defines a cited acceptance requirement.

### Must Not Touch

- existing files under `agents/` other than `agents/orchestrator.md`
- existing global OpenCode agents and `C:/Users/IvanTretyakov/.config/opencode/opencode.jsonc`
- `skills/brainstorm/**`, `skills/review/**`, and `skills/debug/**`
- auth, credential, environment, plugin-cache, and application-repository paths
- historical specs and plans

### STOP and Handoff

If implementation or a gate needs an unowned path, stop and request a scope amendment. Do not infer permission from adjacency. Never read or expose auth files or environment values.

## Delivery Pack

| Pack ID | Outcome / acceptance | Crossing range | Lifecycle | Dependencies | Multi-Crossing reason | Rollback strategy | Pack/routing/gates approval |
|---|---|---|---|---|---|---|---|
| `AIRLOCK-P03` | Installed Airlock 1.3.0 delegates an approved disposable task from Claude to the selected OpenCode model, audits its candidate commit, records evidence, and cleans external state | `AIRLOCK-P03-C01`…`AIRLOCK-P03-C04` | active | accepted `AIRLOCK-P01`, `AIRLOCK-P02`; installed CLIs/providers | canonical semantics, OpenCode worker, Claude bridge, and activation are independently auditable layers | disable/remove global worker, revert activation, then host/canonical changes | approved by user 2026-08-06 |

## Crossing Map

| Crossing ID | Tasks | Buildable result | Depends on | Owns |
|---|---|---|---|---|
| `AIRLOCK-P03-C01` | 1–17 | canonical plan/ship skills and ledger template define safe external dispatch and candidate handoff | feasibility probe | canonical skills/template + process artifacts |
| `AIRLOCK-P03-C02` | 11–17 | targetable OpenCode worker source and global copy resolve with closed headless behavior | C01 | OpenCode adapter agent/README + global worker |
| `AIRLOCK-P03-C03` | 25–32 | Claude bridge delegates approved routes through a deterministic launcher; 1.3.0 source validates with ten agents | C02 | Claude agents, launcher/tests, root/adapter README, conventions, manifests |
| `AIRLOCK-P03-C04` | 26–34 | source published, installed, smoke-tested end to end, and pack accepted | C03 | plan/ledger + external installation |

## Tasks

### Feasibility Gate (Before Candidate Source)

- [x] 1. Create one exact disposable git repo under `C:/Users/IVANTR~1/AppData/Local/Temp/opencode/` and record its path.
- [x] 2. Invoke a temporary primary OpenCode worker with inline config and a total permission set; do not modify global config.
- [x] 3. RED: prove denied Bash, nested task/question, unowned edit, external read, and push attempts fail despite global `"*": "allow"`.
- [x] 4. GREEN: prove exact owned edit, approved validation, scoped add/diff/commit, and read operations succeed.
- [x] 5. Capture actual JSON event types for session ID, completion, model, tokens/cost where available.
- [x] 6. Prove one-commit parent/count/path audit and verify no staged residue.
- [x] 7. Prove session resume/fork behavior and delete exact probe session IDs.
- [x] 8. Remove the exact disposable repo/config/output artifacts and stop any probe processes.
- [x] 9. Record `AIRLOCK-G13` evidence and refresh the ledger checkpoint.
- [x] 10. STOP without candidate source edits if any closed-policy premise fails.

### Crossing 1 - Canonical Semantics

- [x] 11. Add an explicit external-runtime route schema and active-checkout preconditions to `skills/plan/SKILL.md`.
- [x] 12. Add total permission, foreground serialization, session, resume, and cleanup requirements to dispatch.
- [x] 13. Add worker product-candidate and orchestrator Crossing-commit semantics to `skills/ship/SKILL.md` and align `skills/ship/LEDGER.template.md`.
- [x] 14. Add deterministic parent/count/path/index/status/effective-route audit and stop behavior.
- [x] 15. Run canonical consistency and whitespace checks; obtain independent GLM review.
- [x] 16. Update ledger evidence/checkpoint, stage only C01 paths, audit cached names, and ship C01.
- [x] 17. Confirm no temporary artifacts or processes remain.

### Crossing 2 - OpenCode Worker

- [x] 18. Add targetable `mode: primary` source agent at `adapters/opencode/agents/airlock-worker.md` with no nested delegation and the five-part return contract.
- [x] 19. Install the reviewed identical agent at `C:/Users/IvanTretyakov/.config/opencode/agents/airlock-worker.md` without changing global config or existing agents.
- [x] 20. Document invocation, total permissions, model/variant override, session handling, and security limits in `adapters/opencode/README.md`.
- [x] 21. Verify `opencode debug config`, primary-agent targeting, effective model/variant, denial behavior, and one product commit in the disposable repo.
- [x] 22. Obtain independent GLM review of permissions and active-branch behavior.
- [x] 23. Update ledger evidence/checkpoint, stage only C02 repository paths, audit cached names, and ship C02.
- [x] 24. Delete exact test sessions/temp paths and verify the global worker remains the only external state.

### Crossing 3 - Claude Bridge and Release Source

- [x] 25. Change `agents/orchestrator.md` to `model: inherit` and require only approved external routes.
- [x] 26. Add Haiku `agents/external-runner.md` with shell/read tools, no direct edit/write tools, foreground JSON invocation, bounded return, and no ledger ownership.
- [x] 26a. Add dependency-free `scripts/run-external-agent.mjs`; validate a hashed manifest, invoke OpenCode without model-owned command construction, enforce timeout/result checks, and clean exact session/temp state.
- [x] 26b. Add Node built-in tests for success, blocked worker, malformed manifest, timeout, and cleanup failure.
- [x] 27. Document external-runtime setup, routing, worker commit ownership, and security boundary in README and project conventions.
- [x] 27a. Update the OpenCode adapter documentation for the hashed-manifest launcher, direct executable requirement, and structured result contract.
- [x] 28. Bump plugin and marketplace manifests to 1.3.0.
- [x] 29. Run strict plugin validation and confirm five skills plus ten agents.
- [x] 30. Smoke the source plugin with user-selected Claude orchestrator and a no-write external route.
- [x] 31. Obtain independent GLM review and DeepSeek verification of the complete frozen source candidate.
- [x] 32. Update ledger evidence/checkpoint, stage exact C03 paths, audit cached names, and ship/push the source candidate.

### Crossing 4 - Publish, Activate, and Close

- [ ] 33. Update the marketplace and installed plugin to 1.3.0; verify five skills and ten agents.
- [ ] 34. Run installed Claude-to-OpenCode end-to-end smoke in a disposable repo, including one scoped product commit and Claude audit.
- [ ] 35. Delete exact external session IDs, temp repos/files, and processes; verify no task-owned artifact remains.
- [ ] 36. Mark gates passed, close the Resume checkpoint, accept `AIRLOCK-P03`, commit the ledger/plan Crossing, and push `main`.

## Routing

| Pack / Crossing / task | Work class | Host role | Mode | Selected agent/runtime | Model | Parallel group | Checkpoint | Owns |
|---|---|---|---|---|---|---|---|---|
| P03 feasibility 1–10 | Critical | investigator/verifier | subagent | `code-critical` | Sol max | A | yes | disposable temp paths only |
| P03-C01 11–17 | Critical | implementer | subagent | `code-critical` | Sol max | B | yes | canonical skills and ledger template |
| P03-C02 18–24 | Critical | implementer | subagent | `code-critical` | Sol max | C | yes | OpenCode adapter/global worker |
| P03-C03 25–30 | Standard | implementer | subagent | `code-standard` | Terra high | D1 | yes | Claude agents/docs/manifests |
| P03-C03 26a–26b | Critical | implementer | subagent | `code-critical` | Sol max | D2 after D1 | yes | deterministic launcher/tests |
| P03-C01…C03 review | Critical | independent reviewer | subagent | `review-glm` | GLM high | after each | yes | read-only candidate |
| P03-C03 verification | Standard | verifier | subagent | `verify` | DeepSeek high | E | yes | read-only frozen candidate |
| P03-C04 33–36 | Critical | orchestrator | inline | active orchestrator | Sol | F | yes | process artifacts + external activation |

All file-writing groups are serialized. The external runtime feature itself permits parallel read-only work but serializes writers.

## Required Gates

| Gate ID | Gate | Executor | Command / target | Pass condition |
|---|---|---|---|---|
| `AIRLOCK-G13` | inline config and permission precedence | code-critical + verifier | disposable OpenCode run | total policy overrides ambient allow; denied and allowed probes behave exactly |
| `AIRLOCK-G14` | canonical external-runtime consistency | review-glm | C01 diff | no contradictory routing, ownership, resume, commit, or cleanup semantics |
| `AIRLOCK-G15` | OpenCode worker resolution and lifecycle | verifier | config resolution + disposable run | primary worker, approved model/variant, one commit, exact audit |
| `AIRLOCK-G16` | Claude plugin and launcher validation | verifier | Node built-in tests + `claude plugin validate . --strict` + details | launcher lifecycle tests pass; valid 1.3.0 source with five skills and ten agents |
| `AIRLOCK-G17` | installed end-to-end dispatch | orchestrator + verifier | installed Claude → OpenCode disposable repo | scoped product commit and Claude audit succeed |
| `AIRLOCK-G18` | independent security/process review | review-glm | frozen full diff and external config | no blocking findings |
| `AIRLOCK-G19` | cleanup | verifier | exact paths/session IDs/processes | all task-owned temporary state removed; retained evidence referenced |
| `AIRLOCK-G20` | publication/activation | orchestrator | push, marketplace update, installed inventory | 1.3.0 enabled and smokes pass |

Browser, visual, and live-application gates are not required because this pack changes no UI or application integration.

## Evidence and Cleanup

The ledger is the durable evidence and resume store. Full OpenCode transcripts are not retained by default. If a failure requires a transcript, export it sanitized to an approved path added through a scope amendment. Record exact runtime, agent, model, variant, command, directory, session ID, parent/candidate SHA, result, and cleanup state.

Temporary state is limited to exact probe repos/config/output files under the approved OpenCode temp home, OpenCode session IDs, and foreground processes. Delete or stop each exact item before acceptance. The pre-existing planning fetch output `C:/Users/IvanTretyakov/.local/share/opencode/tool-output/tool_fd378f620001tApUMZSvxscZs8` is task-owned temporary state and must be removed during the feasibility cleanup.

## Checkpoints

Refresh the ledger Resume checkpoint after the feasibility probe, every subagent return, every gate, each staged-diff audit, publication, cleanup, and before any unfinished stop. User checkpoints occur after the feasibility probe and before publication only if evidence changes an approved premise.
