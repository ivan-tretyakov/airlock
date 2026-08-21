---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" next --host claude $ARGUMENTS`. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status --host claude`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer` and resume if work becomes runnable.

Otherwise, extract the task id, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" start <id> --host claude`, then dispatch the printed block verbatim with `Agent` to the exact `AGENT` named by the brief. Do not pass a model parameter. If it stops, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" block <id> --host claude --reason "<cause>"`. If it returns, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" audit <id> --host claude`; on failure block the task with `--host claude` and report its out-of-scope paths; on success run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" done <id> --host claude --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
