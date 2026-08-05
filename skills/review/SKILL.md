---
name: review
description: Post-ship Airlock review for Delivery Packs. Loads ledger state, links feedback to a pack/Crossing/gate, triages before repair, and routes accepted fixes through linked repair packs with checkable evidence. Use for user, PR, CI, or reviewer feedback after a commit, or to resume shipped work. Legacy 1.1 ledgers remain readable without invented gate evidence.
---

# Review — the far door

Make post-ship feedback an artifact, not a conversation. This workflow is **not** the pre-ship independent-review gate: that gate helps accept a candidate; Airlock `review` handles feedback after a Crossing has shipped.

## 1. Load pack-aware state

Identify the ledger from the topic, plan, Work ID, Delivery Pack ID, Crossing ID, gate ID, or review surface. If more than one could apply, ask rather than guess. Read the approved design, plan, ledger, and bounded Resume checkpoint before acting, then reconcile with:

- `git log --oneline <base-sha>..HEAD` and the relevant Crossing commits;
- `git status --short`;
- the configured local-diff or PR review surface;
- for a PR, its diff, checks, comments, and addressable threads through authenticated project tooling.

Report unavailable remote sources as **uncollected**, never clean. The current user prompt is a valid source and must be persisted after triage approval.

For a 1.2 ledger, identify the target Delivery Pack lifecycle, exact accepted/current candidate, Crossings, gate register/evidence, and orthogonal review lifecycle. Do not turn `accepted` into `cleared` or reopen acceptance because feedback arrived.

### Legacy 1.1 compatibility

Treat a ledger with Crossings but no Delivery Pack section as one implicit `legacy:<work-id>` pack. Keep old evidence unstructured and interpret its existing `Status` only as legacy review metadata, never pack lifecycle. Historical lifecycle, gate applicability/state, waiver, candidate identity, approval, and deviations remain `unknown` unless contemporaneous records prove them. Never manufacture a gate pass from a green run today.

If a ledger is missing or stale, reconstruct only what git and the plan prove, label the reconstruction date, and keep every unavailable historical field `unknown`.

The ledger is the only durable resume store. When the ledger is owned, replace its single Resume checkpoint in place with current pack/Crossing, completed work, changed paths, fresh evidence, blockers/decisions, retained evidence, temporary artifacts/processes and cleanup state, and one exact next action. Reference feedback, Crossing, gate, evidence, and Debug rows rather than copying history or logs. If the ledger is outside scope, report the proposed checkpoint update instead of editing it. A legacy ledger without a checkpoint remains valid; add one only when work is actively resumed or repaired.

## 2. Triage before repair

Collect all available feedback and classify each item:

- **MUST_FIX** — wrong, broken, or violates an invariant.
- **SHOULD_FIX** — real, in-scope improvement worth doing now.
- **PARK** — legitimate but deferred; needs a reason and backlog home.
- **OUT_OF_SCOPE** — outside the approved contract.

For every item, propose links to the affected **Delivery Pack**, optional **Crossing**, and optional **gate**. Use `—` only when the source genuinely applies to the pack as a whole. Preserve stable source IDs/URLs for deduplication.

Present numbered triage and stop for user approval before editing implementation or persisting feedback rows. Before that human checkpoint, replace only the orchestrator-owned Resume checkpoint when the ledger is owned; record the exact approval needed and next action without treating proposed triage as approved history. After approval, persist rows with those links and refresh the checkpoint in place.

## 3. Establish the baseline

Run the project’s baseline check and record its exact candidate/result. If red:

- an attributable failure is evidence for its MUST_FIX item;
- an unrelated or unexplained failure blocks repair.

Set the affected pack’s **review lifecycle** to `resolving` while accepted items are open, or `cleared` when all are terminal. Do not change its Delivery Pack lifecycle merely to reflect review progress.

After each review gate or evidence result, refresh the bounded checkpoint's fresh-evidence and cleanup fields; do not paste command logs into it.

## 4. Route changes through repair packs

Never append product changes to an accepted Delivery Pack or rewrite its accepted candidate/evidence. For accepted or legacy shipped work, create a linked **repair Delivery Pack** in the plan and ledger before implementation. Its `Repairs` field names the source pack and feedback rows name the repair pack.

A repair pack follows the normal rules: coherent outcome, one or more contiguous Crossings, file contract, portable work class/host role, per-pack routing approval, and risk-selected gates. A one-change repair can be a compact Light, single-Crossing pack. If review only records dispositions, use a compact ledger-only review pack rather than adding product Crossings to accepted history.

Classify non-product artifacts created during review as retained evidence or temporary. Move retained file evidence to the configured evidence home and reference it; remove or stop only exact task-owned temporary paths/processes when safe. Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts. Block and report unsafe cleanup. For Playwright/browser work, remove superseded task-created screenshots, downloads, traces, and logs while retaining only required evidence; never clean credentials, browser profiles, cookies, localStorage, or other user state.

For a shipped Crossing in an `active` pack, use a remaining planned Crossing only when the approved scope and outcome already cover the fix; otherwise add an approved repair/amendment. Invoke **`brainstorm`** when feedback changes design. For an omitted path without a design change, propose the exact scope amendment and get approval before editing.

Resolve MUST_FIX before SHOULD_FIX. Make the smallest change, keep a regression test where applicable, and update the item in the same Crossing as its fix. Pushback is valid when feedback conflicts with an invariant; record why. A `done` item needs evidence and a checkable commit reference (`this commit`, resolved by `git blame`, when row and fix ship together).

## 5. Close the loop

- Invoke **`ship`** for every review/repair Crossing. It audits scope, preserves review lifecycle, and accepts a repair pack only with fresh required gate evidence for its exact candidate.
- Mark the source pack’s **review lifecycle** `cleared` only when all linked rows are `done`, `parked`, or `rejected`; its accepted lifecycle and historical gate states remain unchanged.
- Reply to and resolve remote threads when authenticated tooling supports it; otherwise report the unresolved remote action.
- Ensure `ship` closes the Resume checkpoint at repair-pack acceptance and references its final Crossing; otherwise leave one exact next action for unfinished review.

Use this exact five-bullet shape for every review report:

- **Status:** `done`, `partial`, or `blocked`, followed by one factual sentence.
- **Changes/findings:** exact changed paths or prioritized findings; `none` when applicable.
- **Evidence:** exact command/tool and result; name anything required but not run.
- **Artifacts/cleanup:** retained evidence paths/references and exact temporary paths/processes removed, still present, or blocked; `none` when applicable.
- **Action needed:** `none` or one exact decision, blocker, or next action.

Return only those bullets, using facts and actions. Put resolved, rejected, parked, repair-pack links, failed/stale gates, waivers, and uncollected sources under the applicable bullet. Do not restate the prompt, plan, or file contract, and do not include long logs unless requested or a concise failure excerpt is needed.

## Stop conditions

- Repair starts before complete triage approval.
- The pack, Crossing, gate, candidate, ledger, or scope is ambiguous.
- An unrelated baseline failure exists.
- A change exceeds the contract without an approved amendment/repair pack.
- An accepted pack’s historical candidate or gate evidence is about to be rewritten.
- An item is about to be marked done without evidence and a checkable commit reference.

Next skill: **`ship`**.
