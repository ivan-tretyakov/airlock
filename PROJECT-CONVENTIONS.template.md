# Airlock Project Conventions

Airlock is optional. When this repository uses it, keep delivery state in one `airlock.plan.json` and record exact validation commands in each task's `acceptance` field.

- Use repository-relative `owns` paths or globs only.
- Each completed task must leave the product worktree clean through its Airlock task commit.
- Configure browser MCP access and its refresh command in the project host configuration when browser tasks are used.

## Authoring tasks

- Mark a task `expensive: true` only for irreversible, security-sensitive, or migration work; `budget.maxExpensive` caps it deliberately. Any other task omits the field.
- Builder-run acceptance is sufficient for tasks whose acceptance one command captures; the builder runs it and `done --evidence` records the result.
- When acceptance cannot be captured in one command, prefer one consolidated checker near the end of the plan that `dependsOn` every builder task it verifies. Airlock supplies the checker with each dependency's scoped diff and evidence.
- Reserve per-task checkers for `expensive` tasks.
- A request that is one task with one obvious verification command does not need a plan. Use Airlock when delivery spans multiple tasks with distinct ownership.
