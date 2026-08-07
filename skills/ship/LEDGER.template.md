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
- **Current candidate:** `<launcher candidate SHA/tree, existing commit/tree, or base + staged product-diff hash, with pending/passed/failed/stale state; none if none>`
- **Accepted candidate:** `<exact accepted candidate SHA/tree or base/diff identity; none if none>`

## Resume checkpoint

<!-- Orchestrator-owned bounded resume state. Replace these values in place; never append checkpoint snapshots. -->

- **State:** active | closed
- **Updated:** `<ISO-8601 timestamp>`
- **Active pack / Crossing:** `<pack-id> / <crossing-id>`
- **Completed:** `<concise completed tasks/Crossings; none if none>`
- **Changed paths:** `<current attributable paths; none if none>`
- **Fresh evidence:** `<evidence IDs or concise command/tool references and results; for external runs include session, completion/classification, launcher candidate SHA/tree, selected/effective route, policy identity/proof, deterministic validation proof, Git sealing/audit proof, and recovery classification; none if none>`
- **Blockers / decisions:** `<unresolved blockers and approved decisions; none if none>`
- **Retained evidence:** `<stable exact paths in configured evidence home plus ledger/gate references; none if none>`
- **Temporary artifacts / processes:** `<exact task-owned paths/processes, including external session, manifest, evidence, message, hooks, temporary directory, and cleanup/absence proof; none if none>`
- **Next action:** `<one exact executable action; on closure, reference the final Crossing and post-ship handoff>`

## Gate register

<!-- Applicability: required | not-required -->
<!-- Gate state for required gates: pending | running | passed | failed | blocked | stale -->
<!-- A waiver is separate from applicability and gate state. -->

| Gate ID | Pack ID | Gate | Applicability | Gate state | Waiver approver | Waiver reason | Waiver date | Current evidence |
|---|---|---|---|---|---|---|---|---|
| `<gate-id>` | `<pack-id>` | `<technical/review/browser/visual/live/cleanup>` | required | pending | — | — | — | — |

## Gate evidence

| Evidence ID | Gate ID | Launcher candidate SHA / tree | Timestamp | Executor role | Effective runtime / agent / model / variant | Selected / effective route | Policy identity / proof | Deterministic validation proof | Git sealing / audit proof | Recovery classification | Command / MCP tool | Environment / target | Result | Artifact reference | Exact cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `<evidence-id>` | `<gate-id>` | `<launcher candidate SHA/tree, existing commit/tree, or base SHA + staged product-diff hash>` | `<ISO-8601>` | verifier | `<actual>` | `<n/a or approved/effective runtime, agent, model, variant, checkout, branch>` | `<n/a or complete policy identity/hash + precedence proof>` | `<n/a or ordered direct executable/argv/cwd/timeout/output/exit + no-delta result>` | `<n/a or direct Git/filter/hooks/staging/diff-check/commit/post-state + independent audit result>` | `<not-needed, no-commit, one-commit, cleanup-failed-after-commit, indeterminate, or exact launcher value>` | `<exact invocation>` | `<where/what>` | passed/failed/blocked/stale | `<stable path/URL/ledger reference>` | `<exact session/process/path states and verified absence, or none>` |

## Crossings

### Crossing `<crossing-id>` — `<name>` — `<YYYY-MM-DD>`

- **Delivery Pack:** `<pack-id>`
- **Commit:** this commit (the orchestrator Crossing; locate with `git log -S '<crossing-id>' --oneline -- <this-ledger-path>`)
- **Candidate:** `<launcher-sealed precursor SHA/tree, existing commit/tree, or base SHA + staged product-diff hash>`
- **Launcher candidate SHA / tree:** `<full SHA / full tree, or n/a>`
- **Owned:** `<paths from this Crossing’s file contract>`
- **Touched:** `<final Crossing git diff --cached --name-status; process artifacts only for an external handoff>`
- **Selected / effective route:** `<n/a or approved and observed runtime/agent/model/variant/checkout/branch>`
- **Policy identity / proof:** `<n/a or immutable policy hash + precedence/effective-policy proof>`
- **Deterministic validation proof:** `<n/a or ordered direct executable/argv/cwd/timeout/output/expected+actual exit/no-delta evidence>`
- **Git sealing / audit proof:** `<n/a or baseline parent/count/message bytes+hash/tree/paths/index/status/hashes/filter/hooks/staging/diff-check/post-state evidence>`
- **Recovery classification:** `<not-needed, no-summary/no-commit, no-summary/one-commit, cleanup-failed-after-commit, indeterminate, or exact launcher value>`
- **Exact cleanup:** `<retained evidence plus exact session/process/manifest/evidence/message/hooks/temporary-path cleanup and absence proof; none if none>`
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
- `Touched` comes from the staged Crossing diff, not the whole worktree. Under an external writer handoff, the launcher-sealed product candidate is a precursor, not a Crossing; the orchestrator's separate process-artifact commit is the Crossing and references its SHA/tree.
- Every Crossing ID is unique. `git log -S` resolves the orchestrator Crossing commit that adds the ledger entry. The manifest-pinned launcher candidate message must include that ID; inspect the precursor with `git show <candidate-sha>` or locate its exact message via `git log --all --fixed-strings --grep='<candidate-message>' --oneline`.
- Detailed evidence identifies the exact candidate, timestamp, effective runtime/agent/model/variant, tool, environment, result, and artifact. External evidence also records selected/effective route, full permission/containment policy identity and proof, ordered deterministic validations, Git sealing plus independent audit, recovery classification, and exact cleanup. Substantive code, test, configuration, generated-artifact, or cited-spec changes set affected passed gates to `stale`; bookkeeping-only ledger edits do not.
- External handoff audits establish local-checkout correctness only. Permission and process restrictions are honest-agent guardrails, not hostile-process containment; external side effects remain self-reported.
- A failed or stale launcher candidate is recorded in the pack, gate evidence, and checkpoint **Fresh evidence** / **Blockers / decisions**, never as a Crossing. An approved fresh manifest/launcher run may seal one successor candidate from current `HEAD`, or the user may approve an explicit revert commit; never silently reset, rebase, amend, revert, clean, or otherwise rewrite existing history.
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
