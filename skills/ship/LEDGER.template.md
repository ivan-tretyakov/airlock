# Ledger template

The ledger records Delivery Pack lifecycle, what each Crossing committed, exact-candidate gate evidence, and post-ship feedback. One ledger normally matches one plan at `docs/ledger/YYYY-MM-DD-<topic>.md`.

```markdown
# Ledger — <topic>

- **Schema:** Airlock 1.2
- **Work ID:** `<stable topic or issue ID>`
- **Design:** `docs/specs/YYYY-MM-DD-<topic>-design.md`
- **Plan:** `docs/plans/YYYY-MM-DD-<topic>.md`
- **Base SHA:** `<full SHA before the work began>`
- **Branch:** `<branch>`
- **PR:** `<number or none>`

## Delivery Packs

### Delivery Pack `<pack-id>` — `<coherent outcome>`

- **Lifecycle:** planned | active | candidate | accepted | blocked | abandoned | reverted
- **Review lifecycle:** in-progress | awaiting-review | resolving | cleared
- **Acceptance:** `<observable outcome>`
- **Crossings:** `<one contiguous Crossing range>`
- **Dependencies:** `<pack IDs or external dependencies; none if none>`
- **Multi-Crossing reason:** `<why one commit is insufficient; “single Crossing” if one>`
- **Rollback strategy:** `<pack-level order/strategy; no promise that dependent Crossings are independently revertible>`
- **Repairs:** `<accepted pack ID this repairs, or repair pack IDs, or none>`
- **Current candidate:** `<exact candidate + pending/passed/failed/stale state, or none>`
- **Accepted candidate:** `<exact candidate or none>`

## Resume checkpoint

<!-- Orchestrator-owned bounded resume state. Replace these values in place; never append checkpoint snapshots. -->

- **State:** active | closed
- **Updated:** `<ISO-8601 timestamp>`
- **Active pack / Crossing:** `<pack-id> / <crossing-id>`
- **Completed:** `<concise completed tasks/Crossings; none if none>`
- **Changed paths:** `<current attributable paths; none if none>`
- **Fresh evidence:** `<evidence IDs or concise command/tool references and results; for external runs include session, completion/classification, selected/effective route, and permission-policy identity/proof; none if none>`
- **Blockers / decisions:** `<unresolved blockers and approved decisions; none if none>`
- **Retained evidence:** `<stable exact paths in configured evidence home plus ledger/gate references; none if none>`
- **Temporary artifacts / processes:** `<exact task-owned paths/processes, including external sessions/processes, and cleanup state; none if none>`
- **Next action:** `<one exact executable action; on closure, reference the final Crossing and post-ship handoff>`

## Gate register

<!-- Applicability: required | not-required -->
<!-- Gate state for required gates: pending | running | passed | failed | blocked | stale -->
<!-- A waiver is separate from applicability and gate state. -->

| Gate ID | Pack ID | Gate | Applicability | Gate state | Waiver approver | Waiver reason | Waiver date | Current evidence |
|---|---|---|---|---|---|---|---|---|
| `<gate-id>` | `<pack-id>` | `<technical/review/browser/visual/live/cleanup>` | required | pending | — | — | — | — |

## Gate evidence

| Evidence ID | Gate ID | Exact candidate | Timestamp | Executor role | Effective runtime / agent / model / variant | External route and full permission/containment policy identity + proof | Command / MCP tool | Environment / target | Result | Artifact reference |
|---|---|---|---|---|---|---|---|---|---|---|
| `<evidence-id>` | `<gate-id>` | `<commit + tree, or base SHA + staged product-diff hash>` | `<ISO-8601>` | verifier | `<actual>` | `<n/a or approved/effective route plus policy identity/proof>` | `<exact invocation>` | `<where/what>` | passed/failed/blocked/stale | `<path/URL/log reference>` |

## Crossings

### Crossing `<crossing-id>` — `<name>` — `<YYYY-MM-DD>`

- **Delivery Pack:** `<pack-id>`
- **Commit:** this commit (the orchestrator Crossing; locate with `git log -S '<crossing-id>' --oneline -- <this-ledger-path>`)
- **Candidate:** `<external worker precursor commit/tree, existing commit/tree, or base SHA + staged product-diff hash>`
- **Owned:** `<paths from this Crossing’s file contract>`
- **Touched:** `<final Crossing git diff --cached --name-status; process artifacts only for an external handoff>`
- **External handoff audit:** `n/a` or `<session/completion; approved branch; parent; commit count; candidate/tree; Crossing-ID-bearing candidate message; candidate changed names; index; status delta; selected/effective route; full permission/containment policy identity + proof; evidence; exact artifacts/cleanup>`
- **Evidence:** `<focused and required Crossing checks>` → `<result>`
- **Artifacts / cleanup:** `<retained evidence references; temporary paths/processes and cleanup evidence; or none>`
- **Scope audit:** passed against `<plan Crossing/file contract>`
- **Pack lifecycle after Crossing:** active | accepted
- **Deviations:** none

## Open items

<!-- Class: MUST_FIX | SHOULD_FIX | PARK | OUT_OF_SCOPE -->
<!-- State: open | done | parked | rejected -->

| # | Source ID / URL | Class | Pack ID | Crossing ID | Gate ID | Item | State | Repair pack / resolution |
|---|---|---|---|---|---|---|---|---|
| 1 | `<prompt, check, issue, or thread URL>` | MUST_FIX | `<pack-id>` | `<crossing-id or —>` | `<gate-id or —>` | `<one line>` | open | |

## Debug records

| Debug ID | Pack ID | Candidate / Crossing | Failed gate or check | Reproduction / root cause | Gates to rerun | State / repair pack |
|---|---|---|---|---|---|---|
| `<debug-id>` | `<pack-id>` | `<exact reference>` | `<gate-id or named observed check>` | `<deterministic evidence; root cause when known>` | `<affected gate IDs>` | investigating |
```

Rules:

- A Crossing is one scope-audited, buildable commit. A Delivery Pack is one coherent outcome spanning one or more contiguous Crossings.
- Pack lifecycle is `planned → active → candidate → accepted`; `blocked`, `abandoned`, and `reverted` are exceptional terminal outcomes. Review lifecycle is orthogonal.
- `Touched` comes from the staged Crossing diff, not the whole worktree. Under an external handoff, the worker commit is a product candidate precursor, not a Crossing; the orchestrator's process-artifact commit is the one Crossing and references it.
- Every Crossing ID is unique. `git log -S` resolves the orchestrator Crossing commit that adds the ledger entry. The worker candidate message must include that ID; locate the precursor with `git show <candidate-sha>` or its recorded exact message via `git log --all --fixed-strings --grep='<candidate-message>' --oneline`.
- Detailed evidence identifies the exact candidate, timestamp, effective runtime/agent/model/variant, tool, environment, result, and artifact. External evidence also records the approved/effective route and full permission/containment policy identity and proof. Substantive code, test, configuration, generated-artifact, or cited-spec changes set affected passed gates to `stale`; bookkeeping-only ledger edits do not.
- External handoff audits establish local-checkout correctness only. Permission and process restrictions are honest-agent guardrails, not hostile-process containment; external side effects remain self-reported.
- A failed or stale worker candidate is recorded in the pack, gate evidence, and checkpoint **Fresh evidence** / **Blockers / decisions**, never as a Crossing. An approved successor run may add one new candidate commit from current `HEAD`, or the user may approve an explicit revert commit; never silently reset, rebase, amend, or revert existing history.
- Carry required gates and only plausibly relevant `not-required` decisions from the plan into the register. A `not-required` gate has `—` for gate state and evidence; it is not a pass or waiver.
- Accept a pack only when every unwaived required gate has fresh `passed` evidence for its exact candidate. A waiver records approver/reason/date but neither changes applicability nor fabricates a pass.
- A completed feedback item needs a checkable commit reference. `this commit` in an updated row means the commit shown by `git blame` for that row. Post-acceptance product changes use a linked repair Delivery Pack; do not rewrite historical acceptance.
- The Resume checkpoint is the only durable resume state: keep one bounded section, replace it in place after each subagent return, gate, human checkpoint, or scope amendment and before compaction or an unfinished stop, and reference durable rows instead of copying history or logs. A fresh session reads the design, plan, ledger, and checkpoint first. At acceptance set it to `closed` and reference the final Crossing.
- Move retained file evidence to the project-configured evidence home and reference it. If temporary artifacts or processes were created, a required cleanup gate records their exact task-owned paths/processes and proves removal/stoppage before acceptance. Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts.
- For Playwright/browser work, retain only required evidence; remove superseded task-created screenshots, downloads, traces, and logs. Never clean credentials, browser profiles, cookies, localStorage, or other user state.
- `PARK` ends `parked` with a backlog reference. `OUT_OF_SCOPE` ends `rejected` with the scope reason.
- Reconstructed entries include the reconstruction date and mark unproven evidence, approvals, and deviations `unknown`; never present them as contemporaneous records.
- **Legacy 1.1:** a ledger with Crossings but no Delivery Pack section is one implicit pack, `legacy:<work-id>`. Preserve old Evidence text as unstructured and old `Status` as legacy review metadata, not pack lifecycle. Historical lifecycle, gate applicability/state, waiver, exact-candidate evidence, and approvals are `unknown`; never invent 1.2 gate evidence from a current run.
- Ledgers without a Resume checkpoint remain valid. Add one only when work is actively resumed or repaired; do not retrofit checkpoint history.
- Keep entries terse and commit ledger changes with the Crossing they describe.
