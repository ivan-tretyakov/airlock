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

- **Lifecycle:** active
- **Review lifecycle:** not-started
- **Acceptance:** installed Airlock 1.3.0 delegates an approved task from a user-selected Claude Opus/Fable orchestrator to the selected OpenCode model, audits its scoped product commit, records the Crossing, and cleans external state.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** accepted `AIRLOCK-P01`, `AIRLOCK-P02`; installed Claude Code/OpenCode and configured model providers
- **Multi-Crossing reason:** canonical semantics, OpenCode worker, Claude bridge, and release activation are independently auditable layers of one outcome.
- **Rollback strategy:** disable/remove the global worker, revert activation, then host and canonical changes in reverse order.
- **Repairs:** none; user-requested capability 2026-08-06
- **Current candidate:** base `f923708` + product-diff hash `c22a08c804dbea3f1473b24b4c628cf614149642`
- **Accepted candidate:** none

## Resume checkpoint

- **State:** active
- **Updated:** 2026-08-06
- **Active pack / Crossing:** `AIRLOCK-P03` / `AIRLOCK-P03-C01` ready to commit
- **Completed:** C01 implementation, scope amendment, independent review, evidence, and staged-diff audit
- **Changed paths:** C01 design/plan/ledger plus canonical plan/ship skills and ledger template
- **Fresh evidence:** `AIRLOCK-E12`, `AIRLOCK-E13`; final G14 review found no blocker
- **Blockers / decisions:** none; template scope amendment approved; use proven `git status --short`, not `--porcelain=v1`
- **Retained evidence:** P03 design, plan, and this ledger
- **Temporary artifacts / processes:** probe repo, four sessions, and two host overflow files removed by exact path/ID; no process remains
- **Next action:** commit `AIRLOCK-P03-C01`, then start the OpenCode worker Crossing

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
| `AIRLOCK-G15` | `AIRLOCK-P03` | OpenCode worker resolution and lifecycle | required | pending | — | — | — | — |
| `AIRLOCK-G16` | `AIRLOCK-P03` | Claude plugin validation | required | pending | — | — | — | — |
| `AIRLOCK-G17` | `AIRLOCK-P03` | installed end-to-end dispatch | required | pending | — | — | — | — |
| `AIRLOCK-G18` | `AIRLOCK-P03` | independent security/process review | required | pending | — | — | — | — |
| `AIRLOCK-G19` | `AIRLOCK-P03` | cleanup | required | pending | — | — | — | — |
| `AIRLOCK-G20` | `AIRLOCK-P03` | publication and activation | required | pending | — | — | — | — |

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

## Open items

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|
| 1 | user prompt 2026-08-05 | SHOULD_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C03` | `AIRLOCK-G07` | Standardize concise bullet-only orchestrator and subagent reports: outcome, changed paths, evidence, blockers, cleanup, actions. | done | `AIRLOCK-P02`; 19/19 host agents aligned and published |
| 2 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G07` | Persist a bounded local resume checkpoint during active packs so compaction and fresh sessions can resume safely. | done | `AIRLOCK-P02`; canonical schema and lifecycle verified and published |
| 3 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G12` | Classify and clean temporary probes, screenshots, and processes while retaining deliberate evidence in its configured home. | done | `AIRLOCK-P02`; exact-path policy published; temporary output removed by exact path |
| 4 | user prompt 2026-08-06 | FEATURE | `AIRLOCK-P03` | — | `AIRLOCK-G13`…`AIRLOCK-G20` | Let a Claude Opus/Fable orchestrator delegate approved tasks to multimodel external coding agents, implementing OpenCode first. | active | approved P03 design and plan |

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
