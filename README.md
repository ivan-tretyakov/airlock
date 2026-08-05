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
| **`plan`** | after scope approval / at the start of an implementation session | Approved design → independently useful **Delivery Packs**, contiguous commit Crossings, host-agent/model routing, disjoint file contracts, and planner-selected evidence gates. The user approves each pack's split, routing, and gates. |
| **`ship`** | a planned commit boundary / final pack candidate | Seals one buildable **Crossing** with exact-candidate evidence. The final Crossing accepts its Delivery Pack only after every required unwaived gate has fresh evidence. |
| **`review`** | feedback on shipped work, or returning after time away | The far door: **triage before repair** (MUST_FIX / SHOULD_FIX / PARK / OUT_OF_SCOPE) → approval → resolve against a known baseline → a checkable commit reference per item. |
| **`debug`** | unclear test failure, regression, a fix that didn't hold | Reproduce deterministically → isolate → one hypothesis at a time → verify → lock in as a regression test. |

## Why these five

Distilled from research into agentic/AI-assisted development practice. Two principles underpin everything: **the agent must be able to verify its own work**, and **context is the scarcest resource**. The practices that carry the weight:

- **A design gate before code** — prevents building the wrong thing well, cheaply, before code exists.
- **A self-contained plan naming files, Delivery Packs, host roles, and gates** — a fresh session can execute it; the file contract makes parallel sessions on one checkout safe.
- **Buildable Crossings plus exact-candidate pack evidence** — the anti-regression backbone. "Done" is a demonstration against an identified candidate, not a claim.
- **Failing test seen to fail first** — agents otherwise design tests around the code they're about to write.
- **A durable record of what crossed** — `ship` records the evidence, committed paths, and approved deviations in a ledger that a fresh session can inspect.
- **Feedback triaged before it is repaired** — prevents cheap comments from displacing important ones and records decisions not to make a change.
- **A scope contract before any file-writing subagent** — a subagent has a fresh context and will pick a defensible-but-wrong approach unless the blast radius was decided by a human first.

This is a deliberately lighter relative of [obra/superpowers](https://github.com/obra/superpowers): it keeps the gate-based discipline and drops the worktree/parallel-agent machinery while retaining three small artifacts: design, plan, and ledger.

## The ledger

The **design** records what was approved, the **plan** records Delivery Packs, Crossings, routing, files, and gates, and the **ledger** records what actually crossed, which exact candidate each gate exercised, pack lifecycle, and what feedback remains.

`ship` appends one Crossing per planned commit using the final staged diff, evidence, and deviations. A pack can span several contiguous Crossings; it is accepted only on its final candidate. `review` maintains numbered feedback items linked to packs, Crossings, and gates. The ledger entry cannot contain the SHA of the commit containing itself, so `this commit` is resolved through the ledger's git history.

The template ships with the completion gate at [`skills/ship/LEDGER.template.md`](skills/ship/LEDGER.template.md).

## Concise reports and safe resume

Orchestrators and subagents return five fact-only bullet groups: **Status**, **Changes/findings**, **Evidence**, **Artifacts/cleanup**, and **Action needed**. They do not restate prompts, plans, contracts, or long logs unless requested or needed to explain a failure.

Each active pack keeps one bounded, orchestrator-owned **Resume checkpoint** in its ledger. It is replaced in place after agent returns, gates, human checkpoints, and scope changes, and before compaction or an unfinished stop. It records current work, paths, fresh evidence, blockers, retained/temporary artifacts, and one exact next action. Fresh sessions read the design, plan, ledger, and checkpoint before acting; accepted packs close the checkpoint against their final Crossing.

## Artifact hygiene

Every created non-product artifact is either retained evidence or temporary. Retained evidence moves to the project-configured evidence home and is referenced from the ledger. Agents remove only exact task-owned temporary paths/processes; broad cleanup and deletion of unknown, pre-existing, user-owned, or another lane's artifacts are forbidden. If temporary artifacts or processes existed, cleanup is a required pack gate. Browser agents retain only required captures and remove superseded task-created screenshots, downloads, traces, and logs without touching credentials, profiles, cookies, local storage, or user state.

## The failure this exists to prevent

> Asked for "a standalone HTML tool outside the app", a subagent instead extended the existing program that generates the current HTML — adding runtime code and tests nobody wanted. Defensible in isolation; wrong against intent.

Nothing was disobeyed. The **approach choice was never signed off** and the **blast radius was never declared**. Hence the rule at the center of Airlock:

> The gate is not *"is this substantial?"* — it is *"will a subagent write files?"*
> If yes, an approved scope contract comes first: deliverable + exact path, integration stance said out loud, extend-or-write-fresh when similar machinery exists, may/must-not-touch, and a coarse plan.

…restated **verbatim in every subagent prompt** (a plan doc doesn't bind a fresh context), with a STOP-and-report rule. The orchestrator audits the attributable changed-path delta after subagents return; `ship` separately audits the final staged diff for each Crossing.

## Claude Code

```bash
# once per machine
/plugin marketplace add ivan-tretyakov/airlock
/plugin install airlock@airlock-marketplace
```

Then in any project, the skills are available as `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:review`, `/airlock:debug` — and Claude will auto-invoke them when a request matches.

Airlock also ships Claude Code role agents. `airlock:orchestrator` defaults to Claude Opus 5 at high effort, executes the approved pack routing, and can override a specialist's default model per invocation when the plan records that mapping. To make it the main Claude agent everywhere:

```json
{
  "agent": "airlock:orchestrator",
  "effortLevel": "high",
  "autoUpdatesChannel": "latest"
}
```

The specialist defaults are Haiku for Light work and investigation/verification, Sonnet for Standard and visual work, and Opus for Complex, Critical, and independent review. Independent context is mandatory; different model family is preferred when the host supports it. Claude-native review must disclose when only same-family models are available.

The `agent` setting resolves only after a release containing `airlock:orchestrator` is installed. During local development, launch with `claude --plugin-dir C:/path/to/airlock --agent airlock:orchestrator`; do not point normal sessions at an agent that exists only in unpublished source.

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

OpenCode can select the `airlock-*` skills automatically from their descriptions without colliding with generic names such as `plan` or `review`. Commands inherit the active primary agent, so use an orchestration-capable primary agent or pin host-local copies. Map Airlock work classes and roles to existing configured subagents rather than creating a duplicate `airlock-fast/balanced/deep` family. See [`adapters/opencode/README.md`](adapters/opencode/README.md) for details. Restart OpenCode after config, skill, or command changes.

A source-checkout path loads the checkout's current working-tree files, including uncommitted edits. It does not fetch remote changes. Keep that checkout reviewed and update it explicitly.

## Set up a project (do this once per repo)

The skills are intentionally engine-, language-, model-, and host-agnostic. Supply project specifics by copying the block from [`PROJECT-CONVENTIONS.template.md`](PROJECT-CONVENTIONS.template.md) into `CLAUDE.md` for Claude Code or `AGENTS.md` for OpenCode and filling it in:

- focused tests, full tests, lint, typecheck, build, and run commands that apply
- spec/plan/ledger artifact homes and the review surface (local diff or PR)
- browser/MCP availability, visual specs, screenshot homes, viewports, live targets, and cleanup policy
- scratch/evidence homes and exact-path retention/cleanup rules
- host role/model mapping and independent-review policy
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
