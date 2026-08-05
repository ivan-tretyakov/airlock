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

- **Lifecycle:** candidate
- **Review lifecycle:** in-progress
- **Acceptance:** Canonical Airlock and both hosts resolve the approved pack/routing/gate workflow.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** none
- **Multi-Crossing reason:** canonical semantics, Claude agents, and OpenCode personal integration are separately reviewable layers of one outcome.
- **Rollback strategy:** reverse personal configuration, then host-agent and canonical-workflow changes in reverse order.
- **Repairs:** none
- **Current candidate:** base `b84e6ef` + staged product-diff hash `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1`
- **Accepted candidate:** none

## Gate register

| Gate ID | Pack ID | Gate | Applicability | Gate state | Waiver approver | Waiver reason | Waiver date | Current evidence |
|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-G01` | `AIRLOCK-P01` | canonical consistency | required | passed | — | — | — | `AIRLOCK-E01` |
| `AIRLOCK-G02` | `AIRLOCK-P01` | JSON validity | required | passed | — | — | — | `AIRLOCK-E02` |
| `AIRLOCK-G03` | `AIRLOCK-P01` | Claude plugin validation | required | passed | — | — | — | `AIRLOCK-E03` |
| `AIRLOCK-G04` | `AIRLOCK-P01` | OpenCode resolution | required | passed | — | — | — | `AIRLOCK-E04` |
| `AIRLOCK-G05` | `AIRLOCK-P01` | independent review | required | passed | — | — | — | `AIRLOCK-E05` |
| `AIRLOCK-G06` | `AIRLOCK-P01` | published Claude activation | required | blocked | — | — | — | marketplace installation remains 1.1.0 until release |

## Gate evidence

| Evidence ID | Gate ID | Exact candidate | Timestamp | Executor role | Effective agent | Effective model | Command / MCP tool | Environment / target | Result | Artifact reference |
|---|---|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-E01` | `AIRLOCK-G01` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | canonical diff inspection | Airlock working tree | passed | no blocking consistency findings |
| `AIRLOCK-E02` | `AIRLOCK-G02` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `ConvertFrom-Json` on manifests and host configs | local files | passed | five files parsed |
| `AIRLOCK-E03` | `AIRLOCK-G03` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `claude plugin validate . --strict` and source plugin details | Airlock source | passed | version 1.2.0; five skills; nine agents |
| `AIRLOCK-E04` | `AIRLOCK-G04` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | verifier | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | `opencode debug config`, agent/skill/MCP inspection | promo-price-change | passed | models, variants, source skills, and two MCPs resolved |
| `AIRLOCK-E05` | `AIRLOCK-G05` | base `b84e6ef` + diff `68cd9bab63fae1d58b9a2691ab28a09b2ac759b1` | `2026-08-05T13:16:33+02:00` | independent reviewer | `review-glm` | `zai-coding-plan/glm-5.2` | full local diff review | Airlock + host configs | passed | no remaining source blockers |

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

## Open items

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
