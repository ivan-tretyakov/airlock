---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `airlock next --host opencode $ARGUMENTS`. If `airlock` is unavailable, report `npm install --global github:ivan-tretyakov/airlock#v3.1.0` and stop. `npm install --global github:ivan-tretyakov/airlock#v3.0.0` remains a valid historical install tag. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `airlock status --host opencode`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `airlock answer` and resume if work becomes runnable.

Otherwise, run `airlock start <id> --host opencode`, then dispatch its TASK block verbatim with `task` to its exact `AGENT`. If `task` errors before returning any child result due to provider auth, rate limit, timeout, transport, or model availability, run `airlock fallback <id> --host opencode --reason "<short cause without credentials or quotes>"`; dispatch its TASK block to its `AGENT`. Never fallback after any child result, for cancellation, permission/configuration errors, or after Airlock refuses because changes exist. If dispatch cannot continue, run `airlock block <id> --host opencode --reason "<cause>"`. After a child result, run `airlock audit <id> --host opencode`; block on failure, otherwise run `airlock done <id> --host opencode --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
