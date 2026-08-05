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

- **Lifecycle:** active
- **Review lifecycle:** in-progress
- **Acceptance:** all canonical and host agents report concisely, persist bounded resume state, and leave no unowned temporary artifacts.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** accepted `AIRLOCK-P01`
- **Multi-Crossing reason:** canonical workflow and two host-agent surfaces are disjoint implementation layers.
- **Rollback strategy:** revert personal agents, plugin agents, then canonical workflow/docs in reverse order.
- **Repairs:** feedback items 1–3
- **Current candidate:** base `1a44687` + source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba`
- **Accepted candidate:** none

## Resume checkpoint

- **State:** active
- **Updated:** 2026-08-05
- **Active pack / Crossing:** `AIRLOCK-P02` / Crossings 1–3 candidate ready; publication pending
- **Completed:** implementation, cross-family review, verification, review repair, and post-repair gates
- **Changed paths:** canonical workflow; Claude and OpenCode agents; README, conventions, manifests; repair design/plan/ledger
- **Fresh evidence:** `AIRLOCK-E07` through `AIRLOCK-E10`; source-diff hash `84a89f7d6ced9ebd7744e0215874ebcc5ed1caba`
- **Blockers / decisions:** none; ledger section selected over a separate checkpoint file
- **Retained evidence:** repair design, plan, and this ledger; no external evidence artifacts
- **Temporary artifacts / processes:** none
- **Next action:** complete the staged-diff scope audit and commit the 1.2.1 source candidate

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
| `AIRLOCK-G11` | `AIRLOCK-P02` | publication and host activation | required | pending | — | — | — | — |
| `AIRLOCK-G12` | `AIRLOCK-P02` | cleanup | not-required | — | — | no temporary artifacts or processes were created | `2026-08-05` | all implementation and gate runners reported none |

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

## Open items

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|
| 1 | user prompt 2026-08-05 | SHOULD_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C03` | `AIRLOCK-G07` | Standardize concise bullet-only orchestrator and subagent reports: outcome, changed paths, evidence, blockers, cleanup, actions. | resolved pending publication | `AIRLOCK-P02`; 19/19 host agents aligned |
| 2 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G07` | Persist a bounded local resume checkpoint during active packs so compaction and fresh sessions can resume safely. | resolved pending publication | `AIRLOCK-P02`; canonical schema and lifecycle verified |
| 3 | user prompt 2026-08-05 | MUST_FIX | `AIRLOCK-P01` | `AIRLOCK-P02-C01` | `AIRLOCK-G12` | Classify and clean temporary probes, screenshots, and processes while retaining deliberate evidence in its configured home. | resolved pending publication | `AIRLOCK-P02`; exact-path policy verified; repair created no temporary artifacts |

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
