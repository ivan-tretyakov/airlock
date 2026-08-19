---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `airlock next --host opencode $ARGUMENTS`. If `airlock` is unavailable, report `npm install --global github:ivan-tretyakov/airlock#v3.0.1` and stop. The former `npm install --global github:ivan-tretyakov/airlock#v3.0.0` command is superseded. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `airlock status --host opencode`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `airlock answer` and resume if work becomes runnable.

Otherwise, extract the task id, run `airlock start <id>`, then dispatch the printed block verbatim with `task` to the exact `AGENT` named by the brief. If it stops, run `airlock block <id> --reason "<cause>"`. If it returns, run `airlock audit <id>`; on failure block the task and report its out-of-scope paths; on success run `airlock done <id> --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
