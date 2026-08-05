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

- **Lifecycle:** active
- **Review lifecycle:** in-progress
- **Acceptance:** Canonical Airlock and both hosts resolve the approved pack/routing/gate workflow.
- **Crossings:** planned 1–4, contiguous
- **Dependencies:** none
- **Multi-Crossing reason:** canonical semantics, Claude agents, and OpenCode personal integration are separately reviewable layers of one outcome.
- **Rollback strategy:** reverse personal configuration, then host-agent and canonical-workflow changes in reverse order.
- **Repairs:** none
- **Current candidate:** none
- **Accepted candidate:** none

## Gate register

| Gate ID | Pack ID | Gate | Applicability | Gate state | Waiver approver | Waiver reason | Waiver date | Current evidence |
|---|---|---|---|---|---|---|---|---|
| `AIRLOCK-G01` | `AIRLOCK-P01` | canonical consistency | required | pending | — | — | — | — |
| `AIRLOCK-G02` | `AIRLOCK-P01` | JSON validity | required | pending | — | — | — | — |
| `AIRLOCK-G03` | `AIRLOCK-P01` | Claude plugin validation | required | pending | — | — | — | — |
| `AIRLOCK-G04` | `AIRLOCK-P01` | OpenCode resolution | required | pending | — | — | — | — |
| `AIRLOCK-G05` | `AIRLOCK-P01` | independent review | required | pending | — | — | — | — |
| `AIRLOCK-G06` | `AIRLOCK-P01` | published Claude activation | required | blocked | — | — | — | marketplace installation remains 1.1.0 until release |

## Gate evidence

| Evidence ID | Gate ID | Exact candidate | Timestamp | Executor role | Effective agent | Effective model | Command / MCP tool | Environment / target | Result | Artifact reference |
|---|---|---|---|---|---|---|---|---|---|---|

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

## Open items

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
