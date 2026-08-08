---
description: Debug explicit Full Airlock work
---

# Debug — reproduce before you fix

Guessing wastes runs and can hide stale gate evidence. Move by evidence.

## Establish pack and gate context

When the failure belongs to planned or shipped work, load its approved design, plan, ledger, and bounded Resume checkpoint before changing files. Record a Debug row when the ledger is an owned process artifact; otherwise carry the proposed row into `review`/the repair pack instead of widening scope. Include:

- Delivery Pack ID and exact candidate/Crossing;
- failed gate ID, or the named observed check if no planned gate covered it;
- deterministic reproduction and, when known, root cause;
- affected gate IDs that must rerun after a fix; and
- current state and linked repair pack.

Do not invent a gate association. If the pack/gate is ambiguous, stop and ask. An observed planned-gate failure sets that gate state to `failed`; a capability/environment failure may be `blocked`. Only substantive candidate changes make previously passed affected evidence `stale`.

For a legacy 1.1 ledger, treat all historical Crossings as one implicit `legacy:<work-id>` Delivery Pack. Preserve old evidence as unstructured and old `Status` as legacy review metadata. Historical lifecycle, gate state/applicability, waivers, and exact candidate remain `unknown`; never infer that a 1.2 gate passed.

The ledger is the only durable resume store. When it is owned, replace its single Resume checkpoint in place with current pack/Crossing, completed diagnostic work, changed paths, fresh evidence, blockers/decisions, retained evidence, temporary artifacts/processes and cleanup state, and one exact next action. Refresh it after each bounded evidence/gate result, human checkpoint, or scope amendment and before compaction or an unfinished return. Reference Debug, gate, and evidence rows instead of pasting reproductions or logs. If the ledger is outside scope, report the proposed update rather than editing it. A legacy ledger without a checkpoint remains valid; add one only when work is actively resumed or repaired.

## Evidence loop

1. **Reproduce deterministically.** Write a failing test or fixed-seed run. If it cannot be reproduced, gather the missing reproduction instead of claiming a fix.
2. **Isolate.** Minimize input/state and read actual runtime output. Check project-listed confounds such as stale state, caches, builds, environment, and unrelated flags.
3. **Hypothesize one cause.** State the cause, one change that should test it, and why. Do not stack speculative edits.
4. **Verify the hypothesis.** Rerun the failing case. If it remains red, revert the speculative change and form a new hypothesis.
5. **Lock it in.** Keep the smallest reproduction as a regression test, then run the required broader Crossing checks.

For stochastic, timing-sensitive, or tuning behavior, use the planned N-run/fixed-seed distribution, never one run.

Classify every non-product probe, capture, log, download, trace, and temporary/background process created during diagnosis. Move retained file evidence to the project-configured evidence home under a stable exact path and reference it; remove or stop only exact task-owned temporary paths/processes before return when safe. Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts. If ownership or cleanup is unsafe, leave it in place and block/report the exact item. For Playwright/browser work, retain only required evidence and remove superseded task-created screenshots, downloads, traces, and logs; never clean credentials, browser profiles, cookies, localStorage, or other user state.

## Route and reverify

- **Active/candidate pack:** fix in the planned Crossing only if its approved file contract and outcome cover the change. Otherwise stop for a scope/plan amendment.
- **Accepted or legacy pack:** hand the finding to **`review`** for triage and a linked repair Delivery Pack before production edits. A small fix can use a Light, single-Crossing repair pack.
- **Design flaw:** stop and invoke **`brainstorm`**.

After a substantive fix, update the Debug row’s **Gates to rerun** list and mark affected passed gates `stale`. The implementer reruns the focused reproduction; after code freeze, the planned verifier reruns only missing/stale required gates against the repair/current pack’s exact candidate. `debug` does not turn old evidence into a pass.

Do not widen scope. If any required path is outside the approved contract, stop and surface it. Invoke **`ship`** for the resulting Crossing; it owns final gate freshness and pack acceptance.

For an obvious standalone one-line typo with no active pack, keep handling lightweight; do not create a checkpoint store solely for it. Scope, evidence, artifact cleanup, and the concise return contract still apply.

Lead with the diagnosis or verified fix. Include changed paths and actual evidence only when present. If blocked, state the cause and one next action. Use at most five bullets; omit empty sections, preambles, recaps, tangents, and closers. Include long logs only when needed to explain failure.
