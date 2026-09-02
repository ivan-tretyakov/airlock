# Herdr adapter preflight evidence

Captures in this directory are the ground truth for the Herdr/OpenCode CLI
surface the adapter was implemented against, per preflight V2–V4 of
`docs/airlock/specs/2026-08-31-airlock-herdr-adapter.md`.

| File | Content |
| --- | --- |
| `herdr-cli-0.8.2.txt` | `herdr --help` on the reference install (V2 baseline capture) |
| `herdr-subcommands-0.8.2.txt` | `--help` for every group and leaf verb the adapter requires (V2) |
| `opencode-v3-agent-flag-0.8.2-1.18.18.txt` | V3 verdict: interactive OpenCode accepts a launch-time `--agent` selector on 1.18.18 → dispatch Path A is legal; Path B remains the fallback when the flag is absent |
| `preflight-experiment-2026-08-31.md` | Live disposable-session experiment: response shapes, error envelope, known quirks, teardown log |

Regenerating: `node bin/airlock-herdr.mjs` does not rewrite these files; run the
preflight standalone (`node -e "import('./src/herdr-client.mjs').then(m => m.createHerdrClient({ sessionName: 's' }).preflight())"`)
with `HERDR_EVIDENCE_DIR` pointing here on a machine with Herdr installed, and
commit the refreshed captures with the change that depended on them.
