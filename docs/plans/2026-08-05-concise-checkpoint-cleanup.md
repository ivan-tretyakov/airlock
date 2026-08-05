# Airlock 1.2.1 repair plan

## Goal

Deliver concise five-part reports, a bounded ledger resume checkpoint, and exact-path temporary artifact cleanup across canonical Airlock and all configured Claude Code/OpenCode agents.

## File contract

### Owns

```text
docs/specs/2026-08-05-concise-checkpoint-cleanup-design.md
docs/plans/2026-08-05-concise-checkpoint-cleanup.md
docs/ledger/2026-08-05-delivery-packs.md
skills/plan/SKILL.md
skills/ship/SKILL.md
skills/ship/LEDGER.template.md
skills/review/SKILL.md
skills/debug/SKILL.md
README.md
PROJECT-CONVENTIONS.template.md
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
agents/*.md
C:/Users/IvanTretyakov/.config/opencode/agents/*.md
```

### Process artifacts

The orchestrator exclusively owns the design, plan, and existing ledger.

### Candidate-bearing paths

```text
skills/{plan,ship,review,debug}/**
agents/**
README.md
PROJECT-CONVENTIONS.template.md
.claude-plugin/{plugin,marketplace}.json
C:/Users/IvanTretyakov/.config/opencode/agents/*.md
```

### Must not touch

```text
.git/**
.opencode/command/**
adapters/**
C:/Users/IvanTretyakov/.claude/plugins/cache/**
C:/Users/IvanTretyakov/.claude/settings.json
C:/Users/IvanTretyakov/.config/opencode/opencode.jsonc
C:/Users/IvanTretyakov/Documents/Experiments/pricing-ui-v3/**
credential/auth files
promo-price-change project configuration
```

### STOP-and-handoff

If implementation needs an unowned path, stop and request a scope amendment. Cleanup may remove only exact temporary paths/processes created by the active task.

## Repair Delivery Pack `AIRLOCK-P02`

- **Outcome:** concise uniform reports, compaction-safe ledger checkpoint, and clean pack artifact state.
- **Acceptance:** canonical skills and all host agents enforce the same return/cleanup contract; resume checkpoint is bounded and usable; plugin validates as 1.2.1; independent review and host resolution pass.
- **Crossings:** 1–4 contiguous.
- **Dependencies:** accepted `AIRLOCK-P01`.
- **Rollback:** revert personal agent prompts, then plugin agents/canonical workflow/docs in reverse order.

## Tasks and Crossings

### Crossing 1 - canonical checkpoint and cleanup contract

- [x] Add the five-part return contract to dispatch and reporting rules.
- [x] Add bounded Resume checkpoint lifecycle to plan, ledger template, review, and debug.
- [x] Add exact-path retained-vs-temporary artifact rules and cleanup acceptance to plan/ship.

### Crossing 2 - Claude Code agents

- [x] Make all nine plugin agents concise and uniform.
- [x] Require artifact classification, exact-path cleanup, and blocker reporting.
- [x] Make the orchestrator refresh the ledger checkpoint at durable boundaries.

### Crossing 3 - OpenCode agents and release docs

- [x] Align all ten personal OpenCode agents with the same return/cleanup contract.
- [x] Update README, project conventions, and manifests to 1.2.1.

### Crossing 4 - publish, refresh, and close feedback

- [x] Run independent cross-family review and verification.
- [x] Commit/push source, update the marketplace installation, and smoke-test both hosts.
- [x] Mark feedback items done and accept the repair pack.

## Execution table

| Crossing | Runner | Work class | Agent/model | Parallel group | Owns |
|---|---|---|---|---|---|
| 1. Canonical workflow | subagent | Critical | code-critical / Sol max | A | canonical skills + ledger template |
| 2. Claude agents | subagent | Standard | code-standard / Terra high | A | `agents/*.md` |
| 3a. OpenCode agents | subagent | Standard | code-standard / Terra high | A | global OpenCode agents |
| 3b. Docs/manifests | inline | Standard | orchestrator / Qwen medium | B after A | README, conventions, manifests |
| Review | subagent | Critical | review-glm / GLM high | C | read-only full diff |
| Verify | subagent | Standard | verify / DeepSeek high | C | read-only full diff |

## Required gates

| Gate | Executor | Pass condition |
|---|---|---|
| Canonical consistency | verify | one return contract, one checkpoint schema, no conflicting cleanup rules |
| Agent consistency | verify | all 19 agents expose the five factual groups and cleanup ownership |
| Claude plugin validation | verify | strict validation passes; 1.2.1 exposes nine agents |
| OpenCode resolution | verify | all ten personal agents resolve with unchanged models/permissions |
| Independent review | review-glm | no blocking workflow or safety findings |
| Publication | orchestrator | installed 1.2.1 and both orchestrators smoke-test |

## Gate decisions

- Browser functional and visual fidelity are not required because no UI changes; browser cleanup behavior is inspected statically.
- Live integration is not required.
- Cleanup is required for any validation artifacts created during this repair.

## Commit policy

The user approved commit, publish, and refresh. Use scoped staging and push `main` without force.
