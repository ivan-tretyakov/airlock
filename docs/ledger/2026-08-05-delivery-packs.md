# Ledger — Airlock 1.2 delivery packs

- **Schema:** Airlock 1.2
- **Work ID:** `airlock-delivery-packs`
- **Design:** `docs/specs/2026-08-05-delivery-packs-design.md`
- **Plan:** `docs/plans/2026-08-05-delivery-packs.md`
- **Base SHA:** `974c6f3`
- **Branch:** `main`
- **PR:** none

## Delivery Packs

### Delivery Pack `AIRLOCK-P01` — Pack-aware cross-host orchestration

- **Lifecycle:** accepted
- **Review lifecycle:** resolving
- **Acceptance:** Canonical Airlock and both hosts resolve the approved pack/routing/gate workflow.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** none
- **Multi-Crossing reason:** canonical semantics, Claude agents, and OpenCode personal integration are separately reviewable layers of one outcome.
- **Rollback strategy:** reverse personal configuration, then host-agent and canonical-workflow changes in reverse order.
- **Repairs:** `AIRLOCK-P02`
- **Current candidate:** commit `71a8b4e6f60327b7beadc077e994ce9003dbbfaf`, tree `adc5e224960942b2c775293c05c684449049cb33`
- **Accepted candidate:** commit `71a8b4e6f60327b7beadc077e994ce9003dbbfaf`, tree `adc5e224960942b2c775293c05c684449049cb33`

### Delivery Pack `AIRLOCK-P02` — Concise reporting, durable checkpoints, and cleanup

- **Lifecycle:** accepted
- **Review lifecycle:** resolved
- **Acceptance:** all canonical and host agents report concisely, persist bounded resume state, and leave no unowned temporary artifacts.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** accepted `AIRLOCK-P01`
- **Multi-Crossing reason:** canonical workflow and two host-agent surfaces are disjoint implementation layers.
- **Rollback strategy:** revert personal agents, plugin agents, then canonical workflow/docs in reverse order.
- **Repairs:** feedback items 1–3
- **Current candidate:** source commit `b15e18d1b47fe281a30405a1a7f6cd49dbc3972e`
- **Accepted candidate:** source commit `b15e18d1b47fe281a30405a1a7f6cd49dbc3972e`

### Delivery Pack `AIRLOCK-P03` — External multimodel delegation

- **Lifecycle:** failed
- **Review lifecycle:** in-progress
- **Acceptance:** installed Airlock 1.3.0 delegates an approved task from a user-selected Claude Opus/Fable orchestrator to the selected OpenCode model, audits its scoped product commit, records the Crossing, and cleans external state.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** accepted `AIRLOCK-P01`, `AIRLOCK-P02`; installed Claude Code/OpenCode and configured model providers
- **Multi-Crossing reason:** canonical semantics, OpenCode worker, Claude bridge, and release activation are independently auditable layers of one outcome.
- **Rollback strategy:** disable/remove the global worker, revert activation, then host and canonical changes in reverse order.
- **Repairs:** `AIRLOCK-P04`; installed writer gate exposed nondeterministic model-owned Git choreography
- **Current candidate:** commit `0c441c248aa012f7669b11240784c1e910d60fda`, tree `6c5e2f63fc21c53899182e668dbba730aa942209`
- **Accepted candidate:** none

### Delivery Pack `AIRLOCK-P04` — Deterministic external candidate sealing

- **Lifecycle:** accepted
- **Review lifecycle:** awaiting-review
- **Acceptance:** installed Airlock 1.3.1 delegates one exact writer task to OpenCode, deterministically validates and seals its scoped candidate, passes independent Claude audit, and removes exact external state.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** P03 C01–C03 source; failed P03 C04 installed writer evidence; approved P04 design and plan
- **Multi-Crossing reason:** launcher safety core, workflow adoption, release source, and installed activation are independently auditable layers of one repair.
- **Rollback strategy:** disable/remove 1.3.1 activation and the global worker, then revert C03, C02, and C01 in reverse order without rewriting external or user history.
- **Repairs:** `AIRLOCK-D02`; user-approved architecture reversal 2026-08-06
- **Current candidate:** source commit `25fb972c4681265076e6da476d78f6f7002d6f45`, tree `283039626529c424762d650a18a055ba373d5b83`
- **Accepted candidate:** source commit `25fb972c4681265076e6da476d78f6f7002d6f45`, tree `283039626529c424762d650a18a055ba373d5b83`; installed writer candidate `c52a56ff8a93e15b19803aa9b5417f9a3d72358c`, tree `d4bbd11b24810a225621e1ebe4028a2a4e7293f8`

## Resume checkpoint

- **State:** active
- **Updated:** 2026-08-08
- **Active pack / Crossing:** `AIRLOCK-P04` / `AIRLOCK-P04-C04` committed locally; final process push blocked
- **Completed:** C01 `ed5309b`, C02 `ac4d396`, C03 `25fb972` pushed; C04 closure `728efd4` committed locally; G21–G27 passed; 1.3.1 installed, writer gates audited, cleanup complete, P04 accepted
- **Changed paths:** push-blocker checkpoint correction only; approved Claude settings/global worker retained outside Git; historical P03 plan remains preserved and unowned
- **Fresh evidence:** `AIRLOCK-E19`…`AIRLOCK-E25`; installed writer `502365b` → `c52a56ff8a93e15b19803aa9b5417f9a3d72358c`, tree `d4bbd11b24810a225621e1ebe4028a2a4e7293f8`; Fable direct installed launcher → effective `openai/gpt-5.4-mini`, policy `sha256:266dee1d…ddec4`, apply_patch 1/1, validation/seal/audit/cleanup passed
- **Blockers / decisions:** final `git push origin main` cannot read GitHub HTTPS username with interactivity disabled; two bounded interactive attempts timed out and one fail-fast attempt confirmed credentials unavailable; P04 product remains accepted and installed, but process closure is not yet remote
- **Retained evidence:** P03/P04 designs and plans, this ledger, failed installed-run candidate SHA `c5d94cddb9e6122423b91066dba8d18d42cfc7e6`, and concise failed-run evidence in `AIRLOCK-E18`
- **Temporary artifacts / processes:** all exact P03/P04 probe repos, manifests, runtime dirs, NDJSON, message/hooks files, sessions, verifier files, and `airlock-files-review` removed and verified absent; no known task-owned process remains
- **Next action:** restore GitHub HTTPS authentication, commit this checkpoint correction, push local `main`, and verify remote equals the resulting local HEAD

## Gate register

| Gate ID | Pack ID | Gate | Applicability | Gate state | Waiver approver | Waiver reason | Waiver date | Current evidence |
|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-G01` | `AIRLOCK-P01` | canonical consistency | required | passed | — | — | — | `AIRLOCK-E01` |
| `AIRLOCK-G02` | `AIRLOCK-P01` | JSON validity | required | passed | — | — | — | `AIRLOCK-E02` |
| `AIRLOCK-G03` | `AIRLOCK-P01` | Claude plugin validation | required | passed | — | — | — | `AIRLOCK-E03` |
| `AIRLOCK-G04` | `AIRLOCK-P01` | OpenCode resolution | required | passed | — | — | — | `AIRLOCK-E04` |
| `AIRLOCK-G05` | `AIRLOCK-P01` | independent review | required | passed | — | — | — | `AIRLOCK-E05` |
| `AIRLOCK-G06` | `AIRLOCK-P01` | published Claude activation | required | passed | — | — | — | `AIRLOCK-E06` |
| `AIRLOCK-G07` | `AIRLOCK-P02` | canonical and agent consistency | required | passed | — | — | — | `AIRLOCK-E07` |
| `AIRLOCK-G08` | `AIRLOCK-P02` | Claude plugin validation and manifest agreement | required | passed | — | — | — | `AIRLOCK-E08` |
| `AIRLOCK-G09` | `AIRLOCK-P02` | OpenCode resolution | required | passed | — | — | — | `AIRLOCK-E09` |
| `AIRLOCK-G10` | `AIRLOCK-P02` | independent review | required | passed | — | — | — | `AIRLOCK-E10` |
| `AIRLOCK-G11` | `AIRLOCK-P02` | publication and host activation | required | passed | — | — | — | `AIRLOCK-E11` |
| `AIRLOCK-G12` | `AIRLOCK-P02` | cleanup | not-required | — | — | no temporary artifacts or processes were created | `2026-08-05` | all implementation and gate runners reported none |
| `AIRLOCK-G13` | `AIRLOCK-P03` | inline config and permission precedence | required | passed | — | — | — | `AIRLOCK-E12` |
| `AIRLOCK-G14` | `AIRLOCK-P03` | canonical external-runtime consistency | required | passed | — | — | — | `AIRLOCK-E13` |
| `AIRLOCK-G15` | `AIRLOCK-P03` | OpenCode worker resolution and lifecycle | required | passed | — | — | — | `AIRLOCK-E14` |
| `AIRLOCK-G16` | `AIRLOCK-P03` | Claude plugin validation | required | passed | — | — | — | `AIRLOCK-E15` |
| `AIRLOCK-G17` | `AIRLOCK-P03` | installed end-to-end dispatch | required | failed | — | — | — | `AIRLOCK-E18` |
| `AIRLOCK-G18` | `AIRLOCK-P03` | independent security/process review | required | passed | — | — | — | `AIRLOCK-E16` |
| `AIRLOCK-G19` | `AIRLOCK-P03` | cleanup | required | passed | — | — | — | `AIRLOCK-E25` |
| `AIRLOCK-G20` | `AIRLOCK-P03` | publication and activation | required | passed | — | — | — | `AIRLOCK-E17` |
| `AIRLOCK-G21` | `AIRLOCK-P04` | launcher contract and regression suite | required | passed | — | — | — | `AIRLOCK-E19` |
| `AIRLOCK-G22` | `AIRLOCK-P04` | canonical and agent consistency | required | passed | — | — | — | `AIRLOCK-E20` |
| `AIRLOCK-G23` | `AIRLOCK-P04` | independent security/process review | required | passed | — | — | — | `AIRLOCK-E21` |
| `AIRLOCK-G24` | `AIRLOCK-P04` | plugin and release validation | required | passed | — | — | — | `AIRLOCK-E22` |
| `AIRLOCK-G25` | `AIRLOCK-P04` | source end-to-end writer | required | passed | — | — | — | `AIRLOCK-E23` |
| `AIRLOCK-G26` | `AIRLOCK-P04` | installed end-to-end writer | required | passed | — | — | — | `AIRLOCK-E24` |
| `AIRLOCK-G27` | `AIRLOCK-P04` | publication and cleanup | required | passed | — | — | — | `AIRLOCK-E25` |

## Gate evidence

| Evidence ID | Gate ID | Exact candidate | Timestamp | Executor role | Effective agent | Effective model | Command / MCP tool | Environment / target | Result | Artifact reference |
|---|---|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-E01` | `AIRLOCK-G01` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | canonical diff inspection | Airlock working tree | passed | no blocking consistency findings |
| `AIRLOCK-E02` | `AIRLOCK-G02` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `ConvertFrom-Json` on manifests and host configs | local files | passed | five files parsed |
| `AIRLOCK-E03` | `AIRLOCK-G03` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `claude plugin validate . --strict` and source plugin details | Airlock source | passed | version 1.2.0; five skills; nine agents |
| `AIRLOCK-E04` | `AIRLOCK-G04` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `opencode debug config`, agent/skill/MCP inspection | promo-price-change | passed | models, variants, source skills, and two MCPs resolved |
| `AIRLOCK-E05` | `AIRLOCK-G05` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | full local diff review | Airlock + host configs | passed | no remaining source blockers |
| `AIRLOCK-E06` | `AIRLOCK-G06` | commit `71a8b4e6f60327b7beadc077e994ce9003dbbfaf`, tree `adc5e224960942b2c775293c05c684449049cb33` | `2026-08-05T13:21:30+02:00` | orchestrator | `airlock:orchestrator` | `claude-opus-5` / high | marketplace update, installed details, and `claude -p --agent airlock:orchestrator` smoke | user-scoped Claude Code installation | passed | version 1.2.0; nine agents; `AIRLOCK_ORCHESTRATOR_OK` |
| `AIRLOCK-E07` | `AIRLOCK-G07` | base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba` | `2026-08-05T15:08:01+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | full scope/frontmatter/report-contract inspection and `git diff --check` | Airlock source + 19 host agents | passed | scoped paths; canonical schema; five report labels in 19/19 agents |
| `AIRLOCK-E08` | `AIRLOCK-G08` | base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba` | `2026-08-05T15:08:01+02:00` | orchestrator | OpenCode | `openai/gpt-5.6-sol` | `claude plugin validate . --strict`; `ConvertFrom-Json` manifest comparison | Airlock source | passed | validation passed; both manifests version 1.2.1 |
| `AIRLOCK-E09` | `AIRLOCK-G09` | global OpenCode agents aligned with source candidate | `2026-08-05T15:08:01+02:00` | orchestrator + verifier | OpenCode / `verify` | `openai/gpt-5.6-sol`; `alibaba-token-plan/deepseek-v4-flash-0731` | `opencode debug config`; ten-agent resolution/frontmatter inspection | user-scoped OpenCode config | passed | ten personal agents resolved; models, variants, and permissions preserved |
| `AIRLOCK-E10` | `AIRLOCK-G10` | base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba` | `2026-08-05T15:08:01+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | full local diff and host-agent review | Airlock source + global OpenCode agents | passed | no blocker; checkpoint schema and heading consistency finding repaired; affected gates rerun |
| `AIRLOCK-E11` | `AIRLOCK-G11` | source commit `b15e18d1b47fe281a30405a1a7f6cd49dbc3972e` | `2026-08-05T16:28:44+02:00` | orchestrator | installed Claude plugin + OpenCode global agent | `claude-opus-5` / high; `alibaba-token-plan/qwen3.8-max` / medium | `git push origin main`; marketplace/plugin update; `claude plugin list`; `claude plugin details`; installed Claude and OpenCode orchestrator smokes | GitHub, user-scoped Claude installation, and user-scoped OpenCode config | passed | commit pushed; Airlock 1.2.1 enabled with five skills and nine agents; both orchestrators returned the five-part contract |
| `AIRLOCK-E12` | `AIRLOCK-G13` | baseline Airlock `f923708`; standalone disposable repo candidates `9f10980` → `605efbc` | `2026-08-06T08:26:32+02:00` | critical probe | `code-critical` → temporary OpenCode primary worker | Sol max → `openai/gpt-5.4-mini` | `opencode --pure run --format json` with inline config/total permissions; git parent/count/path/index audit; session continue/fork/delete | exact disposable repo under approved OpenCode temp home | passed | later inline deny overrode ambient allow; unsafe operations denied; one `owned.txt` commit; JSON `step_start/tool_use/step_finish/text`; four sessions and all temp/output paths removed |
| `AIRLOCK-E13` | `AIRLOCK-G14` | base `f923708` + current C01 source/design diff | `2026-08-06T09:15:19+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | canonical diff inspection and cross-skill consistency review | Airlock C01 working tree | passed | external precursor/Crossing ownership, timeout, failed-candidate recovery, bounded checkpoint, permissions, traceability, and normal Crossings consistent; no blocker |
| `AIRLOCK-E14` | `AIRLOCK-G15` | C02 adapter source + byte-identical global worker; disposable `5d388e5` → `8c737ed` | `2026-08-06T09:54:38+02:00` | critical probe + independent reviewer | actual `airlock-worker`; `review-glm` | `openai/gpt-5.4-mini`, variant none; `zai-coding-plan/glm-5.2` | closed `opencode --pure run --agent airlock-worker --format json`; config resolution; parent/count/path/message/index/status audit; source/global hash; independent review | global OpenCode agent + exact disposable repo | passed | no fallback; one `owned.txt` commit with `AIRLOCK-P03-C02-PROBE`; five headings; session/repo removed; source/global SHA-256 `EC9C97C…`; no blocker |
| `AIRLOCK-E15` | `AIRLOCK-G16` | C03 working candidate after `819ce33` | `2026-08-06T12:13:24+02:00` | orchestrator + verifier | source `airlock:orchestrator` → `airlock:external-runner` → `airlock-worker` | Fable/high → Haiku/medium → `openai/gpt-5.4-mini`/none | 21 Node tests; strict plugin validation; hashed-manifest source-plugin read-only dispatch; exact export/delete/absence checks | Airlock source + approved OpenCode temp home | passed | five skills/ten agents; direct-exe-npm; effective identity proof; read 1/1; terminal stop; five headings; session `ses_029720983ffeCqsKK9x8mp4cgC`, manifest, and NDJSON deleted/verified absent |
| `AIRLOCK-E16` | `AIRLOCK-G18` | frozen C03 working candidate after `819ce33` | `2026-08-06T12:26:34+02:00` | independent reviewer + verifier | `review-glm`; `verify` | `zai-coding-plan/glm-5.2`; `alibaba-token-plan/deepseek-v4-flash-0731` | full source/global diff review; 21 Node tests; syntax; strict plugin validation; config/agent/version/path/secret/cleanup audits | Airlock source, global worker, approved temp home | passed | no blocking/high finding; contract clean; residual `.err` found by verifier and removed by exact path before staging |
| `AIRLOCK-E17` | `AIRLOCK-G20` | source/remote commit `0c441c248aa012f7669b11240784c1e910d60fda` | `2026-08-06T21:29:51+02:00` | orchestrator | installed Claude plugin | OpenCode orchestrator | local/remote SHA comparison; installed plugin details | GitHub tracking ref and user-scoped Claude installation | passed | local HEAD equals `origin/main`; installed Airlock 1.3.0 exposes five skills and ten agents |
| `AIRLOCK-E18` | `AIRLOCK-G17` | installed 1.3.0; disposable baseline candidates including exact commit `c5d94cddb9e6122423b91066dba8d18d42cfc7e6` | `2026-08-06T21:29:51+02:00` | orchestrator + debug | installed `airlock:orchestrator` → `airlock:external-runner` → `airlock-worker` | Fable/high → Haiku/medium → `openai/gpt-5.4-mini`/none | repeated bounded installed writer dispatches; retained sanitized debug NDJSON then exact deletion; Git parent/count/path/message/index/content audits | exact P03 disposable repositories | failed | one run created and passed audit for the exact candidate but launcher blocked on an over-specified read event; other runs combined denied Git calls, preflight-blocked, or guessed a patch pre-image; prompt retries stopped and architecture moved to P04 |
| `AIRLOCK-E19` | `AIRLOCK-G21` | base `ac4d396` + product-diff `8befff01c7d8de674ac33525b3f0474aa40df428` | `2026-08-07T11:05:51+02:00` | independent verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `node --check`; full Node test suite | frozen Airlock source | passed | 85/85 tests in 129.3s; syntax clean |
| `AIRLOCK-E20` | `AIRLOCK-G22` | same frozen candidate; global worker | `2026-08-07T11:05:51+02:00` | independent verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | canonical/agent searches; source/global SHA-256 | frozen source + user-scoped worker | passed | no active relay or worker-commit contradiction; byte-identical SHA-256 `1226C89D…202B4` |
| `AIRLOCK-E21` | `AIRLOCK-G23` | base `ac4d396` + product-diff `8befff01c7d8de674ac33525b3f0474aa40df428` | `2026-08-07T11:05:51+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | hostile full diff/security/process review | frozen C01–C03 candidate | passed | no blocker/high; argv, permissions, apply_patch+delta, validation mutation, hooks/filters, TOCTOU, recovery, retention, cleanup, and v1 read-only boundaries hold |
| `AIRLOCK-E22` | `AIRLOCK-G24` | same frozen candidate | `2026-08-07T11:05:51+02:00` | independent verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | strict plugin validation, source details, JSON agreement | source plugin | passed | Airlock 1.3.1; five skills; ten agents; inherited orchestrator model |
| `AIRLOCK-E23` | `AIRLOCK-G25` | source writer `a0cf7e1` → `1ea36067a28dc3aa67ad4099af3b5b5145bed6e3`, tree `4ec40fcbf56ec7c7ce296b01835865f12f3b16d4` | `2026-08-07T11:05:51+02:00` | orchestrator + independent verifier | source `airlock:orchestrator` → launcher → `airlock-worker`; `verify` | Fable/high → `openai/gpt-5.4-mini`/none; DeepSeek high | strict v2 source dispatch, deterministic validation/Git seal, independent Git/content audit | exact source disposable repo | passed | policy `sha256:4f447744…84ad4`; apply_patch 1/1; one exact candidate; session/artifacts and source probe removed/verified absent |
| `AIRLOCK-E24` | `AIRLOCK-G26` | installed writer `502365b16bea7b43e754e0867785ce2d7f4e5692` → `c52a56ff8a93e15b19803aa9b5417f9a3d72358c`, tree `d4bbd11b24810a225621e1ebe4028a2a4e7293f8` | `2026-08-08T08:32:56+02:00` | installed orchestrator | installed `airlock:orchestrator` → launcher → `airlock-worker` | Fable/high → `openai/gpt-5.4-mini`/none | strict v2 installed dispatch, deterministic argv validation/Git seal, independent branch/parent/message/path/content/index/status audit | exact installed disposable repo | passed | policy `sha256:266dee1d…ddec4`; apply_patch 1/1; session `ses_01fefc0acffeXdntHVRHNijgcZ`, manifest/runtime/evidence/message/hooks deleted and absence verified |
| `AIRLOCK-E25` | `AIRLOCK-G27`, `AIRLOCK-G19` | source commit `25fb972c4681265076e6da476d78f6f7002d6f45`, tree `283039626529c424762d650a18a055ba373d5b83` | `2026-08-08T08:32:56+02:00` | orchestrator | installed Claude plugin + GitHub | Fable/high; OpenCode orchestrator | push/local-remote SHA equality; marketplace/plugin update; installed details; no-write smoke; exact-path cleanup | GitHub, installed Airlock, global worker, approved temp home | passed | Airlock 1.3.1 enabled with five skills/ten agents; `AIRLOCK_1_3_1_OK`; all P03/P04 task-owned external state removed/verified absent |

## Crossings

### Crossing `AIRLOCK-P01-C01` — Canonical delivery-pack workflow — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P01`
- **Commit:** this commit
- **Candidate:** base `974c6f3` + staged product-diff hash `b798158614fa8fefd3b36bdb21103e740e48f01f` (`git hash-object --stdin`)
- **Owned:** canonical `skills/**` paths plus design, plan, and ledger process artifacts
- **Touched:** canonical skills plus design, plan, and ledger process artifacts
- **Evidence:** `git diff --check`; canonical consistency review → passed
- **Scope audit:** passed against Crossing 1 file contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** none

### Crossing `AIRLOCK-P01-C02` — Claude Code role agents — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P01`
- **Commit:** this commit
- **Candidate:** base `3ee12ca` + staged product-diff hash `5aa6f4cb1f23d029389e218db3418243958b5832` (`git hash-object --stdin`)
- **Owned:** `agents/orchestrator.md`, `agents/code-{light,standard,complex,critical}.md`, `agents/{investigate,verify,visual-review,review}.md`, ledger process artifact
- **Touched:** nine Claude Code plugin agents plus ledger
- **Evidence:** unique required frontmatter; `claude plugin validate . --strict` → passed
- **Scope audit:** passed against Crossing 2 agent file contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** none

### Crossing `AIRLOCK-P01-C03` — Host adapters, documentation, and release source — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P01`
- **Commit:** this commit
- **Candidate:** base `b84e6ef` + staged product-diff hash `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` (`git hash-object --stdin`)
- **Owned:** manifests, README, project conventions, OpenCode adapter docs/wrapper, ledger
- **Touched:** six candidate-bearing documentation/release files plus ledger
- **Evidence:** gates `AIRLOCK-G01` through `AIRLOCK-G05` passed; `AIRLOCK-G06` blocked until publication
- **Scope audit:** passed against Crossing 3 file contract
- **Pack lifecycle after Crossing:** candidate
- **Deviations:** none

### Crossing `AIRLOCK-P01-C04` — Publish and activate — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P01`
- **Commit:** this commit
- **Candidate:** accepted source commit `71a8b4e6f60327b7beadc077e994ce9003dbbfaf`, tree `adc5e224960942b2c775293c05c684449049cb33`
- **Owned:** plan and ledger process artifacts; external marketplace installation and user settings
- **Touched:** plan and ledger; user-scoped plugin updated and Claude main-agent setting enabled outside git
- **Evidence:** `AIRLOCK-G06` passed; installed Airlock 1.2.0 exposes nine agents; fresh orchestrator smoke returned `AIRLOCK_ORCHESTRATOR_OK`
- **Scope audit:** passed against Crossing 4 publish/activate contract
- **Pack lifecycle after Crossing:** accepted
- **Deviations:** none

### Crossing `AIRLOCK-P01-C05` — Triage reporting, checkpoint, and cleanup feedback — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P01`
- **Commit:** this commit
- **Candidate:** accepted source commit `71a8b4e6f60327b7beadc077e994ce9003dbbfaf`, tree `adc5e224960942b2c775293c05c684449049cb33`
- **Owned:** ledger review state and feedback rows
- **Touched:** ledger only
- **Evidence:** accepted baseline `claude plugin validate . --strict` → passed; feedback triage approved by user
- **Scope audit:** passed against ledger-only review contract
- **Pack lifecycle after Crossing:** accepted; review lifecycle resolving
- **Deviations:** none

### Crossing `AIRLOCK-P02-C01` — Canonical reporting, checkpoint, and cleanup workflow — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P02`
- **Commit:** this commit
- **Candidate:** base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba`
- **Owned:** canonical plan/ship/review/debug skills, ledger template, repair design/plan/ledger
- **Touched:** owned paths only
- **Evidence:** `AIRLOCK-G07`, `AIRLOCK-G08`, and `AIRLOCK-G10` passed
- **Scope audit:** passed against Crossing 1 file contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** none

### Crossing `AIRLOCK-P02-C02` — Concise Claude role agents — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P02`
- **Commit:** this commit
- **Candidate:** base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba`
- **Owned:** nine `agents/*.md` Claude plugin agents
- **Touched:** owned paths only
- **Evidence:** `AIRLOCK-G07`, `AIRLOCK-G08`, and `AIRLOCK-G10` passed
- **Scope audit:** passed against Crossing 2 file contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** none

### Crossing `AIRLOCK-P02-C03` — OpenCode alignment, documentation, and release source — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P02`
- **Commit:** this commit
- **Candidate:** base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba`
- **Owned:** ten global OpenCode agents, README, project conventions, manifests, repair plan/ledger
- **Touched:** owned paths only; global OpenCode agents remain outside repository history
- **Evidence:** `AIRLOCK-G07` through `AIRLOCK-G10` passed; `AIRLOCK-G11` pending publication
- **Scope audit:** passed against Crossing 3 file contract
- **Pack lifecycle after Crossing:** candidate
- **Deviations:** none

### Crossing `AIRLOCK-P02-C04` — Publish, activate, and close repair — 2026-08-05

- **Delivery Pack:** `AIRLOCK-P02`
- **Commit:** this commit
- **Candidate:** accepted source commit `b15e18d1b47fe281a30405a1a7f6cd49dbc3972e`
- **Owned:** repair plan and ledger; external marketplace installation
- **Touched:** plan and ledger; user-scoped Claude plugin updated outside git
- **Evidence:** `AIRLOCK-G11` passed; installed Airlock 1.2.1 exposes five skills and nine agents; installed Claude and active OpenCode orchestrators returned the five-part contract
- **Scope audit:** passed against Crossing 4 publish/activate contract
- **Pack lifecycle after Crossing:** accepted
- **Deviations:** initial push lacked interactive credentials and first Claude source smoke hit transient API overload; both succeeded on bounded retry

### Crossing `AIRLOCK-P03-C01` — Canonical external-runtime handoff — 2026-08-06

- **Delivery Pack:** `AIRLOCK-P03`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P03-C01' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `f923708` + product-diff hash `c22a08c804dbea3f1473b24b4c628cf614149642` (`git hash-object --stdin`, excluding administrative plan/ledger diff)
- **Owned:** canonical plan/ship skills and ledger template; P03 design/plan/ledger process artifacts
- **Touched:** `skills/plan/SKILL.md`, `skills/ship/SKILL.md`, `skills/ship/LEDGER.template.md`, P03 design/plan, and this ledger
- **External handoff audit:** n/a; this Crossing defines the handoff and used normal scoped staging
- **Evidence:** `AIRLOCK-G13`, `AIRLOCK-G14`, and `git diff --cached --check` passed
- **Artifacts / cleanup:** four probe sessions, disposable repo, and two host overflow files removed by exact ID/path; no process remains
- **Scope audit:** passed against C01 contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** user-approved scope amendment added `skills/ship/LEDGER.template.md`; proven status command is `git status --short`

### Crossing `AIRLOCK-P03-C02` — Targetable OpenCode worker — 2026-08-06

- **Delivery Pack:** `AIRLOCK-P03`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P03-C02' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `13e5e44` + product-diff hash `ec73f5bbf6c8094e394db61123a59e7e0f5135d1` (`git hash-object --stdin`, excluding administrative plan/ledger diff)
- **Owned:** OpenCode worker adapter source/README, byte-identical global worker, P03 plan/ledger
- **Touched:** `adapters/opencode/agents/airlock-worker.md`, `adapters/opencode/README.md`, P03 plan, and this ledger; global worker outside git
- **External handoff audit:** n/a for this source Crossing; `AIRLOCK-E14` exercised the installed worker in a disposable repo
- **Evidence:** `AIRLOCK-G15`, source/global SHA-256 equality, independent review, and `git diff --cached --check` passed
- **Artifacts / cleanup:** disposable worker session/repo removed by exact ID/path; global worker retained as the intended integration
- **Scope audit:** passed against C02 contract
- **Pack lifecycle after Crossing:** active
- **Deviations:** effective probe variant recorded as none; resume model changes require fork plus independent verification

### Crossing `AIRLOCK-P03-C03` — Deterministic Claude-to-OpenCode bridge — 2026-08-06

- **Delivery Pack:** `AIRLOCK-P03`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P03-C03' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `819ce33` + product-diff hash `439b8b0324747e831282e6554cb62238a2931797` (`git hash-object --stdin`, excluding administrative plan/ledger diff)
- **Owned:** Claude orchestrator/external runner, deterministic launcher/tests, root/adapter docs, conventions, manifests, P03 design/plan/ledger
- **Touched:** `.claude-plugin/*`, `agents/orchestrator.md`, `agents/external-runner.md`, `scripts/run-external-agent*.mjs`, root/adapter docs, conventions, P03 design/plan, and this ledger
- **External handoff audit:** source smoke used Fable/high → Haiku/medium → `airlock-worker` on `openai/gpt-5.4-mini`/none through direct-exe-npm; read 1/1; effective identity, terminal stop, headings, session and exact cleanup passed
- **Evidence:** `AIRLOCK-G16`, `AIRLOCK-G18`, 21 Node tests, strict plugin validation, source bridge smoke, and `git diff --cached --check` passed
- **Artifacts / cleanup:** all debug/smoke sessions, manifests, NDJSON, and residual `.err` removed by exact ID/path; no task-owned process remains
- **Scope audit:** passed against amended C03 contract
- **Pack lifecycle after Crossing:** candidate
- **Deviations:** prompt-only bridge replaced by user-approved dependency-free launcher after `AIRLOCK-D01`; C03 scope added launcher/tests and adapter documentation; interrupted-bridge orphan risk remains documented under the accepted user-account threat model

### Crossing `AIRLOCK-P04-C01` — Deterministic candidate sealing core — 2026-08-06

- **Delivery Pack:** `AIRLOCK-P04`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P04-C01' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `0c441c248aa012f7669b11240784c1e910d60fda` + staged product-diff hash `e5429cc67bb16b1c43eb7790f102b2161713a122` (`git hash-object --stdin` over staged launcher, tests, and approved design diff)
- **Owned:** launcher and test source; P04 design/plan/ledger process artifacts
- **Touched:** `scripts/run-external-agent.mjs`, `scripts/run-external-agent.test.mjs`, P04 design, P04 plan, and this ledger
- **External handoff audit:** n/a; C01 implements the sealing boundary and used normal exact-path staging
- **Evidence:** six observed RED groups; `node --check scripts/run-external-agent.mjs` passed; `node --test scripts/run-external-agent.test.mjs` passed 77/77 in 119.3s; `git diff --check` passed; early `review-glm` checkpoint found no blocker and approved C01 shipment
- **Artifacts / cleanup:** subagent reported no residual launcher-test temporary path or process; P03 disposable repositories remain recorded for P04 cleanup; no C01 artifact remains
- **Scope audit:** passed against C01 launcher/tests contract and orchestrator process-artifact ownership; historical P03 plan diff excluded
- **Pack lifecycle after Crossing:** active
- **Deviations:** built-in Git `text`/`eol` normalization is accepted standard repository behavior rather than overridden; custom executable filters remain blocked; real OpenCode and Windows proof is deferred to required G25/G26

### Crossing `AIRLOCK-P04-C02` — Adopt launcher-sealed ownership — 2026-08-06

- **Delivery Pack:** `AIRLOCK-P04`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P04-C02' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `ed5309b` + staged product-diff hash `5821f9062d823e4e4cfb667af626ea7cc06a6a39` (`git hash-object --stdin` over staged C02 source diff)
- **Owned:** launcher static-assertion tests, Claude orchestrator/compatibility relay, OpenCode worker, canonical plan/ship/ledger template, byte-identical global worker, and P04 process artifacts
- **Touched:** `scripts/run-external-agent.test.mjs`, `agents/orchestrator.md`, `agents/external-runner.md`, `adapters/opencode/agents/airlock-worker.md`, `skills/plan/SKILL.md`, `skills/ship/SKILL.md`, `skills/ship/LEDGER.template.md`, P04 plan, and this ledger; global worker outside Git
- **External handoff audit:** no candidate handoff; no-write smoke used source launcher v1 read-only compatibility, actual global `airlock-worker`, `openai/gpt-5.4-mini`/none, policy `sha256:eeba8b0d24c9f53980a429ed2a3c2030c03d0bc32f4be7bd4048a72d98de4740` / proof `AIRLOCK-E12`, read 1/1, terminal stop, and session `ses_02528746bffeWR287NZT1XWPIb` deleted
- **Evidence:** static RED 4/4 then GREEN 4/4; read-only preflight RED then focused GREEN; `node --check` passed; launcher suite passed 81/81 in 128.5s; source/global SHA-256 `1226C89DA78A3E26E7FB9604F4D00F2BCD26784321CB2FF00391463E4C4202B4`; real smoke result `done`; `git diff --check` passed
- **Artifacts / cleanup:** C02 smoke repository, manifest, NDJSON, session, and one OpenCode tool-output file removed by exact path/ID and verified absent; P03 disposable repositories remain tracked for P04 cleanup
- **Scope audit:** passed against amended C02 file contract; historical P03 plan diff excluded
- **Pack lifecycle after Crossing:** active
- **Deviations:** task 14 required the already-approved launcher test path omitted from the initial C02 row, so the plan mapping was corrected without widening overall scope; read-only launcher sealing permission was clarified to `none` after the real smoke caught an over-strict worker preflight

### Crossing `AIRLOCK-P04-C03` — Release 1.3.1 source — 2026-08-07

- **Delivery Pack:** `AIRLOCK-P04`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P04-C03' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** base `ac4d396` + staged product-diff hash `8befff01c7d8de674ac33525b3f0474aa40df428` (`git hash-object --stdin` over launcher/tests, release docs/conventions, and manifests)
- **Owned:** launcher/tests regression fixes, root/adapter operator docs, conventions, plugin/marketplace 1.3.1 manifests, P04 plan/ledger, approved user-scoped Claude launcher rules, and exact source probe state
- **Touched:** `scripts/run-external-agent.mjs`, `scripts/run-external-agent.test.mjs`, `README.md`, `adapters/opencode/README.md`, `PROJECT-CONVENTIONS.template.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, P04 plan, and this ledger; Claude settings outside Git
- **External handoff audit:** source Fable invoked the strict launcher directly; selected/effective OpenCode `airlock-worker` on `openai/gpt-5.4-mini`/none; parent `a0cf7e1`, candidate `1ea36067a28dc3aa67ad4099af3b5b5145bed6e3`, tree `4ec40fcbf56ec7c7ce296b01835865f12f3b16d4`; exact message/path/content/index/status; policy `sha256:4f447744…84ad4` / `AIRLOCK-E12`; validation and direct Git sealing passed; session/artifacts removed
- **Evidence:** `AIRLOCK-E19`…`AIRLOCK-E23`; 85/85 tests, strict 1.3.1 inventory, source/global worker equality, independent GLM review, DeepSeek verification, real Windows source writer seal, and `git diff --check` passed
- **Artifacts / cleanup:** source/debug manifests, runtime dirs, NDJSON, sessions, verifier files, and source probe removed by exact path/ID; P03 disposables and `airlock-files-review` remain for final cleanup
- **Scope audit:** passed against C03 release-source contract; historical P03 plan diff excluded
- **Pack lifecycle after Crossing:** candidate
- **Deviations:** approved scope amendment added narrow persistent Claude launcher rules; real runtime evidence added apply_patch mutation support, verified debug retention, and exact-owned derived Windows permission aliases before freeze; all affected gates rerun

### Crossing `AIRLOCK-P04-C04` — Publish, install, prove, and accept — 2026-08-08

- **Delivery Pack:** `AIRLOCK-P04`
- **Commit:** this commit (locate with `git log -S 'AIRLOCK-P04-C04' --oneline -- docs/ledger/2026-08-05-delivery-packs.md`)
- **Candidate:** accepted source commit `25fb972c4681265076e6da476d78f6f7002d6f45`, tree `283039626529c424762d650a18a055ba373d5b83`; installed writer candidate `c52a56ff8a93e15b19803aa9b5417f9a3d72358c`, tree `d4bbd11b24810a225621e1ebe4028a2a4e7293f8`
- **Owned:** P04 plan/ledger process artifacts; supported marketplace/plugin installation; exact installed probe and cleanup; approved Claude settings/global worker
- **Touched:** P04 plan and this ledger; external installation/settings/global worker and disposable state outside Git
- **External handoff audit:** `AIRLOCK-E24`; installed Fable direct launcher to effective `airlock-worker` / `openai/gpt-5.4-mini`/none; exact parent/count/SHA/tree/message/path/content/index/status, policy, validation, Git seal, session, and cleanup passed
- **Evidence:** `AIRLOCK-G21`…`AIRLOCK-G27` all passed; local/remote source equality; installed 1.3.1 inventory; `AIRLOCK_1_3_1_OK`; exact cleanup
- **Artifacts / cleanup:** all task-owned P03/P04 external repos/files/sessions/processes removed and verified absent; retained evidence is ledger-only
- **Scope audit:** passed against C04 publication/activation/process-artifact contract; historical P03 plan diff excluded
- **Pack lifecycle after Crossing:** accepted
- **Deviations:** persistent Claude permission required resolved source and installed-cache launcher patterns; first no-write smoke command supplied an invalid empty `--tools` argument and was rerun without it; no product or external state was created by that failed CLI parse

## Open items

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|
| 1 | user prompt 2026-08-05 | SHOULD_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C03` | `AIRLOCK-G07` | Standardize concise bullet-only orchestrator and subagent reports: outcome, changed paths, evidence, blockers, cleanup, actions. | done | `AIRLOCK-P02`; 19/19 host agents aligned and published |
| 2 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G07` | Persist a bounded local resume checkpoint during active packs so compaction and fresh sessions can resume safely. | done | `AIRLOCK-P02`; canonical schema and lifecycle verified and published |
| 3 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G12` | Classify and clean temporary probes, screenshots, and processes while retaining deliberate evidence in its configured home. | done | `AIRLOCK-P02`; exact-path policy published; temporary output removed by exact path |
| 4 | user prompt 2026-08-06 | FEATURE | `AIRLOCK-P03` | — | `AIRLOCK-G13`…`AIRLOCK-G20` | Let a Claude Opus/Fable orchestrator delegate approved tasks to multimodel external coding agents, implementing OpenCode first. | superseded | P03 C01–C03 shipped; installed writer gate failed; repaired by `AIRLOCK-P04` |
| 5 | `AIRLOCK-D02` / user approval 2026-08-06 | MUST_FIX | `AIRLOCK-P04` | `AIRLOCK-P04-C04` | `AIRLOCK-G21`…`AIRLOCK-G27` | Move mandatory deterministic checks and candidate sealing out of the probabilistic worker, remove the mandatory relay seam, and release 1.3.1. | done | P04 accepted; installed 1.3.1 writer and cleanup gates passed |

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
| `AIRLOCK-D01` | `AIRLOCK-P03` | C03 working candidate after `819ce33` | source-plugin no-write external-route smoke | Prompt-only bridge was nondeterministic. Approved fix moved command construction, timeout, parsing, identity proof, and cleanup into a dependency-free launcher; foreground source smoke then passed Fable→Haiku→OpenCode with exact cleanup. | `AIRLOCK-G16`, `AIRLOCK-G18`; source smoke task 30 | resolved in C03; `AIRLOCK-E15` |
| `AIRLOCK-D02` | `AIRLOCK-P03` → `AIRLOCK-P04` | installed 1.3.0 C04 writer gate | `AIRLOCK-G17` | The launcher was deterministic around OpenCode, but candidate creation still required a probabilistic worker to emit exact Git choreography. Repeated runs produced incompatible command, preflight, and patch behavior; one exact valid candidate was blocked only by an over-specified evidence event. Prompt tuning was stopped. Approved repair moves mandatory validation and candidate sealing into the launcher, makes Claude invoke its bounded summary directly, and releases 1.3.1. | `AIRLOCK-G21`…`AIRLOCK-G27` | resolved by accepted P04; `AIRLOCK-E19`…`AIRLOCK-E25` |
