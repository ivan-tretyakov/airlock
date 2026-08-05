---
name: debug
description: Pack-aware systematic debugging for unclear failures and regressions. Reproduces, isolates, tests one hypothesis, records the failed Delivery Pack/gate and affected gates to rerun, then locks in a regression test. Routes fixes to active Crossings or linked repair packs without widening scope. Skip obvious one-line typos.
---

# Debug — reproduce before you fix

Guessing wastes runs and can hide stale gate evidence. Move by evidence.

## Establish pack and gate context

When the failure belongs to planned or shipped work, load its plan and ledger before changing files. Record a Debug row when the ledger is an owned process artifact; otherwise carry the proposed row into `review`/the repair pack instead of widening scope. Include:

- Delivery Pack ID and exact candidate/Crossing;
- failed gate ID, or the named observed check if no planned gate covered it;
- deterministic reproduction and, when known, root cause;
- affected gate IDs that must rerun after a fix; and
- current state and linked repair pack.

Do not invent a gate association. If the pack/gate is ambiguous, stop and ask. An observed planned-gate failure sets that gate state to `failed`; a capability/environment failure may be `blocked`. Only substantive candidate changes make previously passed affected evidence `stale`.

For a legacy 1.1 ledger, treat all historical Crossings as one implicit `legacy:<work-id>` Delivery Pack. Preserve old evidence as unstructured and old `Status` as legacy review metadata. Historical lifecycle, gate state/applicability, waivers, and exact candidate remain `unknown`; never infer that a 1.2 gate passed.

## Evidence loop

1. **Reproduce deterministically.** Write a failing test or fixed-seed run. If it cannot be reproduced, gather the missing reproduction instead of claiming a fix.
2. **Isolate.** Minimize input/state and read actual runtime output. Check project-listed confounds such as stale state, caches, builds, environment, and unrelated flags.
3. **Hypothesize one cause.** State the cause, one change that should test it, and why. Do not stack speculative edits.
4. **Verify the hypothesis.** Rerun the failing case. If it remains red, revert the speculative change and form a new hypothesis.
5. **Lock it in.** Keep the smallest reproduction as a regression test, then run the required broader Crossing checks.

For stochastic, timing-sensitive, or tuning behavior, use the planned N-run/fixed-seed distribution, never one run.

## Route and reverify

- **Active/candidate pack:** fix in the planned Crossing only if its approved file contract and outcome cover the change. Otherwise stop for a scope/plan amendment.
- **Accepted or legacy pack:** hand the finding to **`review`** for triage and a linked repair Delivery Pack before production edits. A small fix can use a Light, single-Crossing repair pack.
- **Design flaw:** stop and invoke **`brainstorm`**.

After a substantive fix, update the Debug row’s **Gates to rerun** list and mark affected passed gates `stale`. The implementer reruns the focused reproduction; after code freeze, the planned verifier reruns only missing/stale required gates against the repair/current pack’s exact candidate. `debug` does not turn old evidence into a pass.

Do not widen scope. If any required path is outside the approved contract, stop and surface it. Invoke **`ship`** for the resulting Crossing; it owns final gate freshness and pack acceptance.
