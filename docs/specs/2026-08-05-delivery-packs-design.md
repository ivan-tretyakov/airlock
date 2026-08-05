# Airlock 1.2 delivery packs

- **Work ID:** `airlock-delivery-packs`
- **Scope version:** 1
- **Status:** approved
- **Approved by:** Ivan Tretyakov
- **Approved at:** 2026-08-05

## Goal

Make Airlock the durable authority for orchestrated implementation across Claude Code and OpenCode. An approved plan must split work into coherent delivery packs, record which host agent and model should execute each pack, and decide which technical, independent-review, browser, visual, live-integration, and cleanup gates apply. The host orchestrator executes that approved routing and records evidence instead of maintaining a competing workflow in its own prompt.

## Scope contract

- **Deliverable:** Airlock 1.2 in `C:/Users/IvanTretyakov/Documents/Experiments/airlock`, plus aligned personal Claude Code and OpenCode orchestration.
- **Integration stance:** integrated. Canonical pack and gate semantics live in Airlock's root `skills/`; host adapters map portable roles to host agents/models without duplicating workflow bodies.
- **Extend or write fresh:** extend the existing Airlock skills, ledger, adapter, and convention template. Add new host agent definitions beside them; do not introduce a second workflow engine.
- **May touch:** the exact paths listed in `docs/plans/2026-08-05-delivery-packs.md`.
- **Must not touch:** plugin caches, credential/auth files, application code in `pricing-ui-v3`, `.git/**`, or unrelated global agent definitions.
- **Release:** minor version `1.2.0` because Delivery Pack becomes a new durable artifact and lifecycle concept.

## Key decisions

### Delivery pack and crossing are distinct

A **crossing** is one scope-audited, buildable commit with focused evidence. A **delivery pack** is a coherent outcome made from one or more contiguous crossings. A multi-crossing pack states why it cannot be one crossing, its dependencies, and its rollback strategy. Crossings are not promised to remain independently revertible after dependent commits; the pack owns rollback semantics.

Pack lifecycle is `planned -> active -> candidate -> accepted`, with terminal alternatives `blocked`, `abandoned`, and `reverted`. Review lifecycle remains orthogonal. Post-acceptance fixes create linked repair packs rather than rewriting historical acceptance.

### Planner discretion with explicit gate decisions

Airlock does not impose every gate on every pack. The planner chooses required gates and records why potentially relevant high-risk gates are omitted. Code review, browser-functional, visual-fidelity, live-integration, and external-state cleanup must always receive an explicit decision when plausibly relevant. Detailed execution rows exist only for required gates.

Gate applicability (`required` or `not-required`) is separate from runtime state (`pending`, `running`, `passed`, `failed`, `blocked`, `stale`) and from an approved waiver (approver, reason, date).

### Evidence is tied to an exact candidate

Final pack evidence identifies the exact commit/tree or base SHA plus staged product-diff hash, timestamp, executor agent/model, command or MCP tool, environment, result, and artifact reference. Substantive code, test, configuration, or cited-spec changes stale affected final evidence. Implementers run focused RED/GREEN checks; an independent verifier runs planned pack gates once after code freeze; `ship` reruns only missing or stale gates.

### Browser and visual verification

The visual subagent performs browser capture and assessment end to end when Playwright or Chrome MCP and usable authentication are available. It captures fresh evidence at planned viewports against a cited specification, reports functional and visual findings separately, and does not edit source. If browser state cannot be shared, the primary captures evidence and the visual agent assesses it. Mutating flows require an approved throwaway target, allowed actions, rollback/cleanup, and cleanup evidence.

### Host routing

Portable plans record work class and host role. A host-routing section records the selected agent/model; the ledger records the effective runtime mapping. The portable work classes are Light, Standard, Complex, and Critical.

OpenCode uses the configured `code-*`, investigation, review, visual, and verification agents. Its default Qwen orchestrator runs at `medium`; explicit Plan mode runs at `xhigh`. Sol and Terra implementation are reviewed by GLM, while GLM and DeepSeek implementation are reviewed by Sol.

Claude Code ships plugin-scoped role agents. The main `airlock:orchestrator` uses `claude-opus-5` at high effort and can override a subagent's default model per invocation when the approved plan calls for it. Independent context is mandatory; a different model family is preferred where the host supports it. Claude-native review records the limitation when only Anthropic models are available.

### Latest-version loading

Claude Code continues to use the user-scoped marketplace plugin with `autoUpdatesChannel: latest`. OpenCode globally loads adapter skills directly from the stable source checkout, including reviewed or unreviewed working-tree edits, after restart. OpenCode does not perform an implicit `git pull`; updating from remote remains explicit.

## Compatibility

A 1.1 ledger is treated as one implicit legacy pack. Existing historical evidence remains unstructured and must not be retroactively upgraded or presented as having passed 1.2 gates.

## Risks

- Multi-crossing packs can accumulate stale evidence; candidate identity and code-freeze rules address this.
- Pack/gate tables can become ceremonial; only required gates get detailed rows and Light work remains compact.
- Browser MCP and authentication differ by host/project; capability preflight and blocked evidence are mandatory.
- Claude Code cannot guarantee cross-family review using native agents alone; the ledger records actual model independence and any downgrade.
- The OpenCode source path loads the local working tree, not only committed HEAD or remote HEAD; use reviewed source and update from remote explicitly.
