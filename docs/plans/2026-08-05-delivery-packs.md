# Airlock 1.2 delivery-pack execution plan

## Goal

Implement the approved delivery-pack design across canonical Airlock skills, Claude Code plugin agents, OpenCode personal routing, documentation, and manifests. Done means both hosts discover the intended workflow and agents, invalid model effort settings are removed, and validation proves the resolved configuration and plugin structure.

## Architecture

Canonical behavior stays in `skills/`. Claude-specific role agents live in `agents/`. OpenCode wrappers remain thin and personal OpenCode agents execute the canonical plan. No plugin cache is edited. The consuming promo project retains only project-specific MCP configuration; Airlock's OpenCode skill path moves to the global stable source checkout.

## File contract

### Owns

```text
docs/specs/2026-08-05-delivery-packs-design.md
docs/plans/2026-08-05-delivery-packs.md
docs/ledger/2026-08-05-delivery-packs.md
skills/brainstorm/SKILL.md
skills/plan/SKILL.md
skills/ship/SKILL.md
skills/ship/LEDGER.template.md
skills/review/SKILL.md
skills/debug/SKILL.md
PROJECT-CONVENTIONS.template.md
README.md
adapters/opencode/README.md
adapters/opencode/skills/airlock-plan/SKILL.md
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
agents/orchestrator.md
agents/code-light.md
agents/code-standard.md
agents/code-complex.md
agents/code-critical.md
agents/investigate.md
agents/verify.md
agents/visual-review.md
agents/review.md
C:/Users/IvanTretyakov/.config/opencode/opencode.jsonc
C:/Users/IvanTretyakov/.config/opencode/agents/orchestrator.md
C:/Users/IvanTretyakov/.config/opencode/agents/code-light.md
C:/Users/IvanTretyakov/.config/opencode/agents/verify.md
C:/Users/IvanTretyakov/.config/opencode/agents/review-sol.md
C:/Users/IvanTretyakov/.config/opencode/agents/review-glm.md
C:/Users/IvanTretyakov/.config/opencode/agents/visual-review.md
C:/Users/IvanTretyakov/.claude/settings.json
C:/Users/IvanTretyakov/OneDrive - buynomics GmbH/Claude/Projects/promo-price-change/opencode.json
```

### Process artifacts

The orchestrator exclusively owns this plan, its design, and `docs/ledger/2026-08-05-delivery-packs.md`.

### Candidate-bearing paths

```text
skills/**
agents/**
README.md
PROJECT-CONVENTIONS.template.md
adapters/opencode/**
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
C:/Users/IvanTretyakov/.config/opencode/opencode.jsonc
C:/Users/IvanTretyakov/.config/opencode/agents/{orchestrator,code-light,verify,review-sol,review-glm,visual-review}.md
C:/Users/IvanTretyakov/.claude/settings.json
C:/Users/IvanTretyakov/OneDrive - buynomics GmbH/Claude/Projects/promo-price-change/opencode.json
```

Design, plan, and ledger bookkeeping are process artifacts. Substantive specification changes still require review but are excluded from staged product-diff hashes.

### Must not touch

```text
.git/**
.opencode/command/**
C:/Users/IvanTretyakov/.claude/plugins/cache/**
C:/Users/IvanTretyakov/Documents/Experiments/pricing-ui-v3/**
credential/auth files
all unlisted global agent files
```

### Pre-existing host dependencies (read-only for this work)

The orchestrator already dispatches these global OpenCode agents; they are required integration dependencies but are not modified by this plan:

```text
C:/Users/IvanTretyakov/.config/opencode/agents/code-critical.md
C:/Users/IvanTretyakov/.config/opencode/agents/code-complex.md
C:/Users/IvanTretyakov/.config/opencode/agents/code-standard.md
C:/Users/IvanTretyakov/.config/opencode/agents/investigate.md
```

### STOP-and-handoff

If implementation requires a path outside `Owns`, stop and request a scope amendment. Never edit an installed plugin cache to make source changes appear active.

## Delivery pack

### Pack `AIRLOCK-P01` - Pack-aware cross-host orchestration

- **Outcome:** Airlock 1.2 plans and records multi-crossing delivery packs and both hosts execute approved role/model/gate routing.
- **Acceptance:** canonical skills define pack lifecycle and evidence; Claude plugin agents validate; OpenCode resolves the corrected model hierarchy and source skill path; manifests are valid at 1.2.0.
- **Why several crossings:** canonical workflow semantics, Claude host agents, and OpenCode personal configuration are independently reviewable integration layers but jointly form one cross-host outcome.
- **Dependencies:** none.
- **Rollback:** reverse personal config changes, then revert host-agent and canonical-workflow crossings in reverse order. Historical 1.1 ledgers remain readable as implicit legacy packs.

## Planned crossings and tasks

### Crossing 1 - canonical delivery-pack workflow

- [x] Add candidate packs and verification intent to brainstorm.
- [x] Replace task-only routing with pack/crossing and host-routing tables in plan.
- [x] Add candidate freshness, pack acceptance, and structured gate evidence to ship and ledger.
- [x] Make review and debug pack/gate aware while preserving post-ship review semantics.

Expected RED: searches for `Delivery Pack`, `Pack ID`, and `stale` do not cover all canonical artifacts. GREEN: all canonical artifacts define consistent terms and lifecycle.

### Crossing 2 - host adapters, agents, and documentation

- [x] Add Claude plugin orchestrator and role agents with safe tool restrictions and model defaults.
- [x] Document Claude per-invocation model override, active-agent behavior, and OpenCode host mapping.
- [x] Expand project conventions with gate/tool/environment fields.
- [x] Update README and manifests to 1.2.0.

Expected RED: plugin has no `agents/` hierarchy and manifests report 1.1.0. GREEN: `claude plugin validate --strict` passes and all expected agent files are discoverable.

### Crossing 3 - personal host alignment

- [x] Correct Qwen and DeepSeek effort settings.
- [x] Make the OpenCode orchestrator explicitly defer to Airlock artifacts and correct Terra review routing.
- [x] Make visual review capture fresh Playwright/Chrome evidence when capability preflight succeeds.
- [x] Globally register the stable Airlock OpenCode source path and remove the project cache path.
- [x] Preserve Claude Code high effort and latest marketplace updates, but do not select `airlock:orchestrator` globally until a published 1.2 installation exposes that agent. Validate unpublished source with `--plugin-dir`.

Expected RED: resolved configuration contains unsupported `high` for Qwen and `low` for DeepSeek 0731, and the project points at the 1.1.0 cache. GREEN: resolved host configuration contains only supported variants and the source skill path.

### Crossing 4 - publish and activate

- [ ] Push the first three Crossings to `origin/main`.
- [ ] Refresh the Airlock marketplace and update the installed plugin to 1.2.0.
- [ ] Confirm the installed plugin exposes nine agents, then set Claude's main agent to `airlock:orchestrator`.
- [ ] Start fresh host inspections and record the publication gate before accepting the pack.

Expected RED: installed marketplace details show 1.1.0 and zero agents. GREEN: installed details show 1.2.0 and nine agents, Claude settings select the orchestrator, and OpenCode still resolves its source skills and MCPs.

## Execution table

| Crossing / task | Runner | Work class | Assigned agent | Planned model | Why | Parallel group | Checkpoint | Owns |
|---|---|---|---|---|---|---|---|---|
| 1. Canonical skills + ledger | subagent | Critical | `code-critical` | `openai/gpt-5.6-sol` | public workflow contract and compatibility | A | yes | `skills/**` listed above |
| 2a. Claude plugin agents | subagent | Standard | `code-standard` | `openai/gpt-5.6-terra` | isolated new agent definitions | A | yes | `agents/*.md` |
| 2b. Docs/adapters/manifests | inline | Standard | orchestrator | `alibaba-token-plan/qwen3.8-max` | reconciles canonical and both hosts | B after A | yes | README, adapter, conventions, manifests |
| 3. Personal host alignment | subagent | Standard | `code-standard` | `openai/gpt-5.6-terra` | localized configuration changes | A | yes | listed global/project config paths |
| 4. Publish and activate | inline | Critical | orchestrator | host current | release sequencing and global activation | D after C | yes | ledger + external marketplace/settings state |
| Independent review | subagent | Critical | `review-glm` | `zai-coding-plan/glm-5.2` | different family from canonical Sol implementation | C after B | yes | read-only full diff |
| Verification | subagent | Standard | `verify` | `alibaba-token-plan/deepseek-v4-flash-0731` | independent config/plugin checks | C after B | yes | read-only full diff |

## Required gates

| Gate | Executor | Command/tool | Candidate | Evidence / pass condition |
|---|---|---|---|---|
| Canonical consistency | verify | search lifecycle/pack/gate terms | final working-tree diff | no contradictory definitions |
| JSON validity | verify | parse both manifests and both host configs | final files | all parse successfully |
| Claude plugin validation | verify | `claude plugin validate . --strict` | Airlock source HEAD + diff | exit 0 |
| Claude source discovery | verify | `claude --plugin-dir <source> plugin details airlock` | Airlock working tree | version 1.2.0 and nine agents discovered |
| Published Claude activation | verify | `claude plugin details airlock@airlock-marketplace` | installed latest release | version 1.2.0 and `airlock:orchestrator` available |
| OpenCode resolution | verify | `opencode debug config`, `opencode agent list` | final files | expected agents/models/variants/skills resolve |
| Independent review | review-glm | full local diff | final code freeze | no open blocking findings |

## Gate decisions

- **Browser functional:** not required; this change configures browser-gate orchestration but does not change a browser UI.
- **Visual fidelity:** not required; no visual artifact is produced.
- **Live integration:** not required; no external application state is mutated.
- **Cleanup:** required only for temporary validation artifacts; no credentials or plugin caches may be touched.

## End-to-end verification

Before publication, start a fresh OpenCode process normally and inspect Claude source with `claude --plugin-dir <source> plugin details airlock`; confirm skills, agents, models, and routes resolve without modifying application code. After 1.2.0 is published and installed, set `agent: airlock:orchestrator`, start Claude Code normally, and confirm the main orchestrator resolves to Opus 5 high effort. Publication activation is a separate required gate and remains blocked until release.

## Commit policy

The user explicitly requested all planned Crossings be committed and pushed, followed by marketplace refresh and orchestrator enablement. Use scoped staging and push `main` without force.
