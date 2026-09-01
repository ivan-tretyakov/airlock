---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" next $ARGUMENTS`. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer` and resume if work becomes runnable.

Otherwise, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" start <id>` and dispatch its TASK to its exact `AGENT airlock-<role>` line with no model parameter. If dispatch errors, run it with `block <id> --reason "<cause>"`. After a child result, run it with `audit <id>`; block on failure, otherwise run it with `done <id> --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
