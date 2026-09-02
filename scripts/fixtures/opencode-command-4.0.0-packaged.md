---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `airlock next $ARGUMENTS`. If `airlock` is unavailable, report `npm install --global github:ivan-tretyakov/airlock#v4.0.0` and stop. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `airlock status`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `airlock answer` and resume if work becomes runnable.

Otherwise, run `airlock start <id>` and dispatch its TASK to its exact `AGENT airlock-<role>` line with no model parameter. If dispatch errors, run `airlock block <id> --reason "<cause>"`. After a child result, run `airlock audit <id>`; block on failure, otherwise run `airlock done <id> --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
