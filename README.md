# airlock

A lightweight, structured development flow for [Claude Code](https://claude.com/claude-code) and [OpenCode](https://opencode.ai/), with one portable skill set and thin host adapters.

**One door at a time.** Nothing crosses until the chamber is sealed and cleared: a scope gate before code, subagent-ready plans, evidence before "done", and a record that outlives the session — without the ceremony of a heavyweight process framework.

```
brainstorm  →  plan  →  ship  →  review
                ↑                  │
              debug  ←─────────────┘
```

| Skill | Fires when | What it does |
|---|---|---|
| **`brainstorm`** | starting a feature, system, redesign, tool — anything with a design choice | Design + **scope gate**: batched questions → 2–3 approaches with a recommendation → approval → a design doc carrying a **scope contract**. Hands off to `plan`. |
| **`plan`** | after scope approval / at the start of an implementation session | Approved design → phased **TDD** plan with a disjoint **file contract** and a per-task **model/parallel-group execution table**. Then **asks: inline or subagents?** |
| **`ship`** | work is finished / "commit this" | Green suite + **evidence, not assertion** + protects irreplaceable local state + commit discipline + staged diff audited against the contract, then **recorded as a ledger crossing**. |
| **`review`** | feedback on shipped work, or returning after time away | The far door: **triage before repair** (MUST_FIX / SHOULD_FIX / PARK / OUT_OF_SCOPE) → approval → resolve against a known baseline → a checkable commit reference per item. |
| **`debug`** | unclear test failure, regression, a fix that didn't hold | Reproduce deterministically → isolate → one hypothesis at a time → verify → lock in as a regression test. |

## Why these five

Distilled from research into agentic/AI-assisted development practice. Two principles underpin everything: **the agent must be able to verify its own work**, and **context is the scarcest resource**. The practices that carry the weight:

- **A design gate before code** — prevents building the wrong thing well, cheaply, before code exists.
- **A self-contained plan naming files and ending in a verification step** — a fresh session can execute it; the file contract makes parallel sessions on one checkout safe.
- **Green suite + evidence at every commit** — the anti-regression backbone. "Done" is a demonstration, not a claim.
- **Failing test seen to fail first** — agents otherwise design tests around the code they're about to write.
- **A durable record of what crossed** — `ship` records the evidence, committed paths, and approved deviations in a ledger that a fresh session can inspect.
- **Feedback triaged before it is repaired** — prevents cheap comments from displacing important ones and records decisions not to make a change.
- **A scope contract before any file-writing subagent** — a subagent has a fresh context and will pick a defensible-but-wrong approach unless the blast radius was decided by a human first.

This is a deliberately lighter relative of [obra/superpowers](https://github.com/obra/superpowers): it keeps the gate-based discipline and drops the worktree/parallel-agent machinery while retaining three small artifacts: design, plan, and ledger.

## The ledger

The **design** records what was approved, the **plan** records how to implement it and which files may change, and the **ledger** records what actually crossed in each commit and what feedback remains.

`ship` appends one crossing per planned commit using the final staged diff, evidence, and deviations. `review` maintains numbered feedback items. The ledger entry cannot contain the SHA of the commit containing itself, so `this commit` is resolved through the ledger's git history.

The template ships with the completion gate at [`skills/ship/LEDGER.template.md`](skills/ship/LEDGER.template.md).

## The failure this exists to prevent

> Asked for "a standalone HTML tool outside the app", a subagent instead extended the existing program that generates the current HTML — adding runtime code and tests nobody wanted. Defensible in isolation; wrong against intent.

Nothing was disobeyed. The **approach choice was never signed off** and the **blast radius was never declared**. Hence the rule at the center of Airlock:

> The gate is not *"is this substantial?"* — it is *"will a subagent write files?"*
> If yes, an approved scope contract comes first: deliverable + exact path, integration stance said out loud, extend-or-write-fresh when similar machinery exists, may/must-not-touch, and a coarse plan.

…restated **verbatim in every subagent prompt** (a plan doc doesn't bind a fresh context), with a STOP-and-report rule, and a **`git status` audit against the contract** after subagents return.

## Claude Code

```bash
# once per machine
/plugin marketplace add ivan-tretyakov/airlock
/plugin install airlock@airlock-marketplace
```

Then in any project, the skills are available as `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:review`, `/airlock:debug` — and Claude will auto-invoke them when a request matches.

### Local development

```bash
claude --plugin-dir /path/to/airlock   # load without installing
/reload-plugins                        # pick up edits mid-session
```

## OpenCode

This checkout includes [`opencode.json`](opencode.json), which registers namespaced OpenCode wrappers around the canonical skills, and explicit commands under `.opencode/command/`:

```text
/airlock-brainstorm
/airlock-plan
/airlock-ship
/airlock-review
/airlock-debug
```

To use Airlock elsewhere, clone it to a stable location and add its OpenCode adapter skills to the consuming project's `opencode.json` or global `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": {
    "paths": ["C:/path/to/airlock/adapters/opencode/skills"]
  }
}
```

OpenCode can select the `airlock-*` skills automatically from their descriptions without colliding with generic names such as `plan` or `review`. Copy the `airlock-*.md` command adapters if you also want explicit slash commands. See [`adapters/opencode/README.md`](adapters/opencode/README.md) for details. Restart OpenCode after config, skill, or command changes.

## Set up a project (do this once per repo)

The skills are intentionally engine-, language-, model-, and host-agnostic. Supply project specifics by copying the block from [`PROJECT-CONVENTIONS.template.md`](PROJECT-CONVENTIONS.template.md) into `CLAUDE.md` for Claude Code or `AGENTS.md` for OpenCode and filling it in:

- test command, run command
- spec/plan/ledger artifact homes and the review surface (local diff or PR)
- architecture invariants (the few load-bearing files an agent must not touch)
- protected local state to back up before mutating runs
- branch/push policy and commit conventions
- stochastic/tuning verification approach, known debugging confounds

Keep it lean — project instructions load every session, and bloat makes rules get ignored rather than followed.

## Alternative: no plugin

If you only want this in one repo, copy `skills/*` into `.claude/skills/` for Claude Code. For OpenCode, preserve the repository's `skills/` plus `adapters/opencode/skills/` layout and register the adapter directory. Commit the copy so sessions discover it without a separate installation, accepting that copied skills can drift from this repository.

## Escalating to hard enforcement

These skills are **advisory** — they shape what the model does, they don't mechanically prevent anything. The worktree audit in `plan` and staged-diff audit in `ship` are the safety net that catches an ignored instruction after the fact.

If a rule keeps getting violated, promote it from prose to deterministic host enforcement: a Claude Code hook in `.claude/settings.json`, or an OpenCode plugin/permission rule. Worthwhile candidates:

- a `Stop` hook that blocks turn-end until the test suite is green
- a `PreToolUse` hook that blocks `Write`/`Edit` outside the active file contract
- a hook that backs up protected local state before a mutating run
- a `SessionEnd` hook that warns when an active plan has uncommitted progress or an unrecorded crossing

## License

Apache 2.0 — see [LICENSE](LICENSE).
