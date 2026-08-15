# Airlock decisions

This file is the source of truth for questions waiting for you. Answer an open row by adding `decision: <option>` to its Status cell; Airlock records the approval in the ledger, marks it answered, and unblocks the affected work package at the next session start.

| ID | Asked | Question | Options (2-4) | Recommendation | Blocks | Status |
|---|---|---|---|---|---|---|

Status begins as `open`. When a Git remote review surface exists, Airlock may mirror an open row as a numbered PR comment, but this file remains authoritative.
