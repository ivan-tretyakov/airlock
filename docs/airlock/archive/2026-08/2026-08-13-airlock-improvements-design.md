# Airlock Improvement Design

**Date:** 2026-08-13
**Source:** `docs/airlock-review-2026-08-13.md`
**Target:** the next Airlock release after 2.1.0

## Goal

Apply findings F1-F11 from the session-evidence review so Airlock fails closed when delegation is unavailable, enforces worker boundaries across repository layouts, supports safe browser verification, exposes decisions clearly, keeps one current work dashboard, resumes reliably after compaction, and does not retain obsolete process documentation.

## Scope

This change updates Airlock's canonical Claude commands, agent definitions, enforcement hooks, reusable process templates, policy tests, release metadata, and operator documentation. The OpenCode adapter remains behaviorally unchanged except where its thin command wrappers inherit canonical command behavior.

The implementation may modify:

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- `agents/**`
- `commands/**`
- `hooks/**`
- `references/**`
- `scripts/*.test.mjs`
- `README.md`
- the current design and implementation-plan files under `docs/airlock/**`

The implementation must not modify the external launcher protocol or implementation in `scripts/run-external-agent.mjs`, `references/EXTERNAL-RUNTIME.md`, or `adapters/opencode/agents/airlock-worker.md`. Existing unrelated working-tree changes must be preserved. The historical dated plans, specifications, ledger, and source review are deleted only after the completed implementation has passed its verification suite.

## Design decisions

### 1. Compatible delegation and fail-closed orchestration

The orchestrator uses an unscoped `Agent` tool grant instead of a host-fragile list of bare agent names. Airlock still constrains actual routing in its instructions and guard contract. If a required agent or delegation capability is missing, the orchestrator reports a blocker; it never absorbs Full-work implementation into the main session.

Inline execution is allowed only in the Quick workflow. During Compact and Full workflows, browser driving, source edits, git history surgery, and environment repair count as implementation work and must be delegated or reported as blocked. The canonical start command and orchestrator state this rule explicitly.

### 2. Browser verification as a permanent leaf role

A new `browser-verify` agent is source-read-only, cannot delegate, preflights browser tools and authentication, and uses the project's selected browser MCP backend. Its tool grant includes `ToolSearch` and the concrete browser MCP namespace supported by the plugin definition. If the host does not expose those tools, the existing all-tools fallback remains a forced, recorded substitution with the same read-only and leaf rules.

Both browser-related agents prohibit wholesale console or network-log reads. They request only filtered evidence and never reproduce token-bearing URLs, credentials, cookies, local storage, or browser-profile data in reports.

Projects select one browser backend in their Airlock configuration or project conventions. A missing backend is resolved once during planning rather than independently by each gate.

### 3. Guard contract v2

`airlock.contract/v2` supports:

- an optional absolute `root` overriding walk-up root discovery;
- relative ownership entries resolved against `root`;
- absolute ownership paths and globs, including paths under multiple roots;
- `processPaths`, which remain writable for orchestrator bookkeeping while the worker contract exists;
- an optional ISO-8601 `expiresAt`, after which the contract is ignored;
- `allowDispatch`, defaulting to `false`, which denies `Agent` and `Task` while a worker contract is active;
- existing broad-`git add` denial; and
- conservative detection of simple shell redirection and `tee` writes outside the combined owned and process paths.

Contract v1 remains accepted with its current behavior so installed projects do not break immediately. Canonical commands emit v2 contracts. Invalid or malformed contracts remain fail-open, matching the existing plugin policy; a valid active contract fails closed for the operations above.

Default process paths cover both the new layout and legacy active-work locations: `docs/airlock/**`, `docs/ledger/**`, `docs/plans/**`, and `docs/specs/**`, plus `.airlock/**`. Shell-write screening intentionally covers only unambiguous common forms; the README documents that it is a guardrail, not hostile-process containment.

### 4. Interaction contract

Every user-facing Airlock work message uses one of three forms:

- **Progress:** one line for a completed checkpoint or check, with the result and commit when present.
- **Decision:** the host's structured question tool, concrete options, and a recommendation. Decisions are never buried in prose.
- **Blocked:** the cause and one next action in at most three lines.

Routine internal return-audit reasoning is not streamed. Status appears at work-package or review-round boundaries as a compact `Item | State | Next | Owner` table. Design and plan approvals contain the package table, no more than three rationale sentences, and a link to the detailed file. User-facing text uses plain language; canonical Airlock terms appear parenthetically only when needed to connect a message to an artifact. User-visible messages are capped at roughly fifteen lines unless safety or correctness requires more detail.

### 5. Work dashboard and artifact lifecycle

New Full work uses:

```text
docs/airlock/
  STATUS.md
  ledger/
  plans/
  specs/
  archive/YYYY-MM/
```

`STATUS.md` is replaced in place and contains exactly three tables:

1. open work packages with outcome, state, next action, and blocker;
2. open MUST_FIX and SHOULD_FIX items with age in review rounds; and
3. the five most recently closed packages with commit identifiers.

It links to the active ledger, plan, and specification. The ledger remains the durable machine-oriented resume record; `STATUS.md` is the human view. New work does not create a parallel `TODO.md` or `bugs.md`.

When all work packages referenced by a plan/specification are accepted, `ship` archives those documents under the current year-month and refreshes `STATUS.md`. A multi-package document stays active until its final package is accepted. Review-round completion performs the same refresh. Before compaction or an unfinished session end, the orchestrator refreshes the dashboard and ledger checkpoint.

Historical layouts remain readable but are not used for new work. This repository's superseded dated process documents and the completed review are deleted after release verification; Git history remains the audit trail.

### 6. Review fairness and compaction recovery

Every open MUST_FIX item carries an age in rounds. At the start of each review round, open MUST_FIX items appear first. Starting a new implementation checkpoint while any remain requires an explicit user deferral through the structured question tool. A blocked item must name both its dependency and the exact dispatch or action intended to remove the block.

A `PreCompact` command hook emits a short reminder to refresh and then reread the design, plan, ledger checkpoint, and `STATUS.md`. It does not block compaction. The canonical start and orchestrator rules require the same re-entry sequence after compaction.

### 7. Bounded simplification

Each `code-*` leaf keeps RED-GREEN-refactor inside its assigned paths. After tests first pass, it simplifies only the code it just changed according to project conventions, then reruns the focused tests before returning. Airlock does not install or invoke an autonomous Code Simplifier plugin and does not add a separate simplifier agent.

### 8. Plain-language operator documentation

The README gains a compact glossary mapping internal terms to user-facing language, including Delivery Pack, Crossing, gate, candidate, waiver, lane, and RED-GREEN-refactor. It documents contract v2, browser backend selection, the dashboard lifecycle, and the residual limits of shell screening.

## Testing strategy

Behavioral changes follow test-first development:

- policy tests first fail for the new delegation, browser, interaction, status, review-aging, compaction, simplification, and glossary rules;
- guard tests first fail for v2 roots, absolute/multi-root ownership, process paths, expiry, dispatch denial, and simple shell-write screening;
- hook configuration tests first fail until the `PreCompact` hook is wired;
- existing external-runner tests remain unchanged and prove no regression to that subsystem.

Final verification runs:

```text
node --test scripts/plugin-policy.test.mjs
node --test scripts/guard.test.mjs
node --test scripts/run-external-agent.test.mjs
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The repository diff is then audited against this scope, active documentation links are checked, obsolete documents are removed, and the full verification set is rerun after cleanup.

## Error handling and compatibility

- Missing delegation or browser capability produces a blocker, never simulation or inline Full implementation.
- Missing `.airlock/config.json` resolves silently to native runtime.
- Missing `STATUS.md` causes creation from the reusable template when Full work begins.
- Expired v2 contracts are ignored; malformed contracts retain the existing fail-open behavior.
- Contract v1 remains supported for compatibility, while all updated examples and generated contracts use v2.
- Legacy documentation paths remain recognized as process paths during migration.

## Completion criteria

The work is complete when F1-F11 are represented in canonical behavior or documented as an intentional bounded limitation, all tests and strict manifest validations pass, the current working tree contains no unintended changes, and the superseded dated documents plus the review have been deleted without leaving dangling active-document links.
