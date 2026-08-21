---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" next --host claude $ARGUMENTS`. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status --host claude`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer` and resume if work becomes runnable.

Otherwise, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" start <id> --host claude` and dispatch its TASK to its exact `AGENT` with no model parameter. Only if `Agent` errors before any child result, classify it as `auth|rate-limit|timeout|transport|model-unavailable`, run the same CLI with `fallback <id> --host claude --class <class> --reason "<safe cause>"`, and dispatch the returned TASK. Never fallback after any child result, for cancellation or permission/configuration errors, or when Airlock refuses due to changes. If dispatch cannot continue, run it with `block <id> --host claude --reason "<cause>"`. After a child result, run it with `audit <id> --host claude`; block on failure, otherwise run it with `done <id> --host claude --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
