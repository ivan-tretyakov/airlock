# Airlock Project Conventions

Airlock is optional. When this repository uses it, keep delivery state in one `airlock.plan.json` and record exact validation commands in each task's `acceptance` field.

- Use repository-relative `owns` paths or globs only.
- Keep `.airlock/models.json` aligned with available Claude and OpenCode models.
- Each completed task must leave the product worktree clean through its Airlock task commit.
- Configure browser MCP access and its refresh command in the project host configuration when browser tasks are used.
