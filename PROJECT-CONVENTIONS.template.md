# Airlock Project Conventions

Airlock is optional. When this repository uses it, keep delivery state in one `airlock.plan.json` and record exact validation commands in each task's `acceptance` field.

- Use repository-relative `owns` paths or globs only.
- Keep model routing in the local Airlock configuration, never in the repository.
- Each completed task must leave the product worktree clean through its Airlock task commit.
- Configure browser MCP access and its refresh command in the project host configuration when browser tasks are used.

## Authoring tasks

- Default `risk` is `standard`. Use `complex` only for cross-cutting or architectural work. Reserve `critical` for irreversible, security-sensitive, or migration work; `budget.maxExpensive` caps it deliberately.
- Do not add a checker task for `light` or `standard` builder work. The task's `acceptance` command is the verification; the builder runs it and `done --evidence` records the result.
- Prefer one consolidated checker near the end of the plan that `dependsOn` every builder task it verifies. Airlock supplies the checker with each dependency's scoped diff and evidence.
- Add a per-task checker only for `complex` or `critical` tasks, or when acceptance cannot be captured in one command.
- A request that is one task with one obvious verification command does not need a plan. Use Airlock when delivery spans multiple tasks with distinct ownership.
