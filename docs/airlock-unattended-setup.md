# Running Airlock coding agents unattended

**Date:** 2026-08-14 · Companion to `docs/airlock-review-2026-08-13.md`
**Question:** what setup lets coding agents keep working while I'm away, so I only come back to check status and approve?

---

## 1. The reframe that makes this work

"24/7 autonomous coding" is the wrong target for Airlock, and Airlock is right to make it hard. What actually works is:

> **Approve once → execute a long queue unattended → review asynchronously.**

Airlock already produces the exact artifact this needs: an **approved plan with a Crossing checklist**. That plan *is* the approval. Everything on it can run unattended; everything not on it must wait for you.

This also resolves the hard constraint below, rather than fighting it.

### The hard constraint

Every unattended runner Anthropic offers — Routines, the GitHub Action, headless `-p` — runs with **no interactive approval prompts**. In headless `dontAsk` mode, `AskUserQuestion` is *explicitly auto-denied even when an allow rule matches*; Routines documents "no permission-mode picker and no approval prompts during a run."

Airlock's PR #1 makes DECISION depend on `AskUserQuestion` and says: *"If that tool is unavailable, emit BLOCKED instead of substituting an unstructured approval."* So unattended, **every approval gate becomes BLOCKED and the lane stops.** That is correct and safe — but without the addition in §3 it means Full work stalls at the first gate and the night is wasted.

---

## 2. Recommended stack

Three layers, each independently useful. Start with layer A.

### A. Execution — Claude Code **Routines** (cloud)

`claude.ai/code/routines`, or `/schedule` in the CLI. Runs on Anthropic-managed VMs; **your laptop can be off**.

| Property | Value |
|---|---|
| Triggers | Scheduled (min 1 h), one-off, GitHub event (PR/release), API (HTTP POST bearer token) — combinable |
| Billing | Draws on your Pro/Max subscription, not API billing |
| Limits | Daily cap on routine runs (one-off runs exempt); research preview |
| Push scope | `claude/`-prefixed branches by default; blocked on protected branches / foreign commits |
| Approvals | **None mid-run** — fully autonomous |

Set two routines: one nightly "advance the approved plan," one morning "refresh STATUS and summarize." Both point at the same repo.

### B. Approval surface — **GitHub PR + the Claude Code GitHub Action**

This is where "come check and approve" actually lives. `anthropics/claude-code-action@v1`, official.

- Agent pushes `claude/<pack>` branch → opens/updates **one PR per work package**.
- Decisions are posted as a **PR comment** with numbered options + recommendation, plus a `needs-decision` label.
- You answer from your phone by replying in the PR. An `issue_comment` trigger picks that up and continues **immediately** instead of waiting for the next schedule.
- Auth with `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) so runs bill against your subscription, not API credits.
- No Anthropic-specific run cap; you control the GitHub job timeout.

Optional hard gate: a GitHub **Environment with required reviewers** in front of any deploy/publish step. Generic GitHub functionality, but it's the one true blocking human approval available.

### C. Fallback — self-hosted headless loop (only if you need private network or >1 h cadence)

`claude -p` in a container on a small VM:

```
claude -p "/airlock:start --workflow full <resume approved plan X>" \
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,Bash,Edit,Write,Agent" \
  --max-turns 60 --bare --output-format stream-json
```

- Use `dontAsk` with an explicit allowlist. Avoid `default` (no TTY → nothing to prompt).
- `--dangerously-skip-permissions` **refuses to start as root** outside a recognized sandbox — if your container runs as root, either run as non-root or don't use that mode.
- `--bare` skips auto-discovery for reproducibility (will become the `-p` default).
- **Do not rely on session resume across machines.** Session `.jsonl` files are machine-local; Anthropic's own guidance is to pass prior state as fresh prompt context. Airlock's ledger Resume checkpoint + STATUS.md is exactly that design — the repo is the state, not the transcript. This is Airlock's single biggest advantage for unattended work.

**Not recommended:** Claude *Managed Agents* (platform API). It's a different product surface with its own harness — Airlock is a Claude Code plugin and would need porting, not just configuring. Revisit only if you outgrow the above.

---

## 3. The missing piece: an Airlock `unattended` mode

Small addition, and the whole thing hinges on it. Add to `commands/start.md` (e.g. `/airlock:start --unattended`) and `orchestrator.md`:

1. **Detect it.** If `AskUserQuestion` is unavailable, or `--unattended` is passed, switch DECISION behavior instead of stalling.
2. **Park the decision, don't block the night.** Write a decision record to `docs/airlock/DECISIONS.md` — id, question, 2–4 concrete options, recommendation, what it blocks, timestamp — mirror it as a PR comment with a `needs-decision` label, mark that package `blocked-on-user` in STATUS.md, and **move to the next unblocked package.**
3. **Answer channel.** You reply in the PR comment (`D-07: option 2`) or edit a `decision:` line in the file. Next run reads answered decisions **first**, unblocks those lanes, and records the approval in the ledger exactly as if it had come from the tool.
4. **Hard stops that must never auto-proceed unattended:** design approval (`brainstorm`), security/credentials/destructive/migration/production work, merges to `main`, anything the plan didn't already authorize. These park as decisions, always.
5. **Budget guard.** Stop after N Crossings or a token ceiling, refresh STATUS, and exit cleanly — so a stuck loop costs one night, not a weekend. (`--max-turns` plus a Crossing cap.)

Nightly loop, in one line: *read STATUS → apply answered decisions → work the next unblocked Crossing → ship to branch/PR → refresh STATUS → park any new decision → repeat until budget or no unblocked work.*

---

## 4. What to keep out of the unattended loop

| Do unattended | Keep with you |
|---|---|
| Executing an approved plan's Crossings | `brainstorm` — design approval (15 min with you is the highest-leverage moment in the whole workflow) |
| Test/lint/build gates, regression tests | Browser gates against authenticated envs (auth expiry, and the OPS-1/OPS-6 credential incidents) |
| Investigation, review, verify leaves | Merging to `main`; any publish/deploy |
| Ledger/STATUS bookkeeping, PR hygiene | Anything Airlock classifies as security/destructive/migration/production |

---

## 5. Resolve before the first unattended night

1. **The `agent_id` question from PR #1.** If the guard misclassifies actors, an unattended run deadlocks at 02:00 and burns budget achieving nothing. Smoke-test it interactively first — this is now a prerequisite, not a nicety.
2. **F5 (MUST_FIX starvation) gets worse unattended** — nobody is there to notice work being quietly deferred. The STATUS age counter is the only thing standing between you and another four-round silent slip; verify it actually renders in the nightly summary.
3. **Serialization caps throughput.** PR #1 serializes all file-writing workers under the session-global contract. Overnight batch is fine, but you get one writer at a time — per-worker contracts are the unlock if throughput matters.
4. **Cost.** Baseline guidance is ~$13/developer/active-day; an unattended loop can exceed that quietly. Cap turns *and* Crossings, and check the first week's usage before trusting it.
5. **Routines is a research preview** with a daily run cap and a 1-hour minimum interval. Fine for nightly batch; don't design around minute-level cadence.

---

## 6. Suggested rollout

| Step | Action | Proves |
|---|---|---|
| 1 | Merge PR #1 after the `agent_id` smoke test | Enforcement works |
| 2 | Add `--unattended` mode (§3) | Decisions park instead of stalling |
| 3 | One **one-off** Routine on a small approved plan, ~3 Crossings, budget-capped | The loop runs and produces a reviewable PR |
| 4 | Review the morning output: STATUS readable? decisions answerable from the phone? | The check-and-approve UX |
| 5 | Promote to a nightly schedule; add the GitHub Action `issue_comment` trigger | Same-day turnaround on your answers |

Start at step 3 with work you'd be comfortable throwing away. The first unattended night is a test of the harness, not of the code it writes.

---

### Sources
- Headless mode & permission modes — https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/permission-modes
- Routines — https://code.claude.com/docs/en/routines
- Claude Code on the web — https://code.claude.com/docs/en/claude-code-on-the-web
- GitHub Action — https://code.claude.com/docs/en/github-actions , https://github.com/anthropics/claude-code-action
- Agent SDK sessions — https://code.claude.com/docs/en/agent-sdk/sessions
- Costs — https://code.claude.com/docs/en/costs
- Managed Agents — https://platform.claude.com/docs/en/managed-agents/overview
