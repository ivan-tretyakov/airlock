# Ledger template

The ledger records what was agreed, what each commit actually changed, and what feedback remains. One ledger belongs to one piece of work and is named to match its plan, normally `docs/ledger/YYYY-MM-DD-<topic>.md`.

```markdown
# Ledger — <topic>

- **Work ID:** `<stable topic or issue ID>`
- **Design:** `docs/specs/YYYY-MM-DD-<topic>-design.md`
- **Plan:** `docs/plans/YYYY-MM-DD-<topic>.md`
- **Base SHA:** `<full sha before the work began>`
- **Branch:** `<branch>`
- **PR:** `<number or none>`
- **Status:** in-progress | awaiting-review | resolving | cleared

## Crossings

### Crossing `<work-id>-<sequence>` — Phase <n>: <name> — <YYYY-MM-DD>

- **Commit:** this commit (locate with `git log -S '<work-id>-<sequence>' --oneline -- <this-ledger-path>`)
- **Owned:** `<paths from the plan's file contract>`
- **Touched:** `<paths from the final staged diff>`
- **Evidence:** `<test command>` → `<pass/fail summary>`
- **Deviations:** none

## Open items

<!-- Class: MUST_FIX | SHOULD_FIX | PARK | OUT_OF_SCOPE -->
<!-- State: open | done | parked | rejected -->

| # | Source ID / URL | Class | Item | State | Resolution |
|---|---|---|---|---|---|
| 1 | <prompt, check, issue, or thread URL> | MUST_FIX | <one line> | open | |
```

Rules:

- `Touched` comes from the staged diff, not the whole worktree.
- Every crossing ID is unique within the ledger, making its containing commit resolvable with `git log -S`.
- A completed item needs a checkable commit reference. When its row is updated with the fix, `this commit` means the commit shown by `git blame` for that row.
- `PARK` ends as `parked` with a backlog or issue reference. `OUT_OF_SCOPE` ends as `rejected` with the scope reason.
- Reconstructed history must label unavailable evidence, approvals, and deviations as `unknown`; never infer them from a green suite today.
- Keep entries terse and commit ledger changes with the work they describe.
