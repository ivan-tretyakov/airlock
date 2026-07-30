# airlock

A lightweight, structured development flow for [Claude Code](https://claude.com/claude-code), packaged as a plugin.

**One door at a time.** Nothing crosses until the chamber is sealed and cleared: a scope gate before code, subagent-ready plans, evidence before "done" — without the ceremony of a heavyweight process framework.

```
brainstorm  →  plan  →  ship
                ↑
              debug
```

| Skill | Fires when | What it does |
|---|---|---|
| **`/airlock:brainstorm`** | starting a feature, system, redesign, tool — anything with a design choice | Design + **scope gate**: batched questions → 2–3 approaches with a recommendation → approval → a design doc carrying a **scope contract**. Hands off to `plan`. |
| **`/airlock:plan`** | after scope approval / at the start of an implementation session | Approved design → phased **TDD** plan with a disjoint **file contract** and a per-task **model/parallel-group execution table**. Then **asks: inline or subagents?** |
| **`/airlock:ship`** | work is finished / "commit this" | Green suite + **evidence, not assertion** + protects irreplaceable local state + commit discipline + diff audited against the contract. |
| **`/airlock:debug`** | unclear test failure, regression, a fix that didn't hold | Reproduce deterministically → isolate → one hypothesis at a time → verify → lock in as a regression test. |

## Why these four

Distilled from research into agentic/AI-assisted development practice. Two principles underpin everything: **the agent must be able to verify its own work**, and **context is the scarcest resource**. The practices that carry the weight:

- **A design gate before code** — prevents building the wrong thing well, cheaply, before code exists.
- **A self-contained plan naming files and ending in a verification step** — a fresh session can execute it; the file contract makes parallel sessions on one checkout safe.
- **Green suite + evidence at every commit** — the anti-regression backbone. "Done" is a demonstration, not a claim.
- **Failing test seen to fail first** — agents otherwise design tests around the code they're about to write.
- **A scope contract before any file-writing subagent** — a subagent has a fresh context and will pick a defensible-but-wrong approach unless the blast radius was decided by a human first.

This is a deliberately lighter relative of [obra/superpowers](https://github.com/obra/superpowers): it keeps the gate-based discipline and drops the worktree/parallel-agent machinery and the separate spec-plus-plan artifacts.

## The failure this exists to prevent

> Asked for "a standalone HTML tool outside the app", a subagent instead extended the existing program that generates the current HTML — adding runtime code and tests nobody wanted. Defensible in isolation; wrong against intent.

Nothing was disobeyed. The **approach choice was never signed off** and the **blast radius was never declared**. Hence the rule at the center of this plugin:

> The gate is not *"is this substantial?"* — it is *"will a subagent write files?"*
> If yes, an approved scope contract comes first: deliverable + exact path, integration stance said out loud, extend-or-write-fresh when similar machinery exists, may/must-not-touch, and a coarse plan.

…restated **verbatim in every subagent prompt** (a plan doc doesn't bind a fresh context), with a STOP-and-report rule, and a **`git status` audit against the contract** after subagents return.

## Install

```bash
# once per machine
/plugin marketplace add ivan-tretyakov/airlock
/plugin install airlock@airlock-marketplace
```

Then in any project, the skills are available as `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:debug` — and Claude will auto-invoke them when a request matches.

### Local development

```bash
claude --plugin-dir /path/to/airlock   # load without installing
/reload-plugins                        # pick up edits mid-session
```

## Set up a project (do this once per repo)

The skills are intentionally engine- and language-agnostic — they refer to "the project's test command", "the project's architecture invariants". Supply those specifics by copying the block from [`PROJECT-CONVENTIONS.template.md`](PROJECT-CONVENTIONS.template.md) into the project's `CLAUDE.md` and filling it in:

- test command, run command
- spec/plan artifact homes
- architecture invariants (the few load-bearing files an agent must not touch)
- protected local state to back up before mutating runs
- branch/push policy and commit conventions
- stochastic/tuning verification approach, known debugging confounds

Keep it lean — `CLAUDE.md` loads every session, and bloat makes rules get ignored rather than followed.

## Alternative: no plugin

If you only want this in one repo, copy `skills/*` into that repo's `.claude/skills/` and commit them. Any session opened in the repo auto-discovers them, with no install step — but each copy then drifts independently. The plugin exists so one source of truth serves many projects and machines.

## Escalating to hard enforcement

These skills are **advisory** — they shape what the model does, they don't mechanically prevent anything. The `git status` audit in `plan` and `ship` is the safety net that catches an ignored instruction after the fact.

If a rule keeps getting violated, promote it from prose to a **hook** in `.claude/settings.json`, which is deterministic. Worthwhile candidates:

- a `Stop` hook that blocks turn-end until the test suite is green
- a `PreToolUse` hook that blocks `Write`/`Edit` outside the active file contract
- a hook that backs up protected local state before a mutating run

## License

Apache 2.0 — see [LICENSE](LICENSE).
