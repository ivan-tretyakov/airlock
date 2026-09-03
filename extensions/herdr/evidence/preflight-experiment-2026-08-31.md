# Preflight/dispatch surface experiment — 2026-08-31

Environment: herdr 0.8.2 (server running), opencode 1.18.18, Linux.
Method: disposable named session `airlock-adapter-exp` over a throwaway git repo
at /tmp/opencode/exp-repo; every mutating call was undone; final teardown
verified `herdr session list --json` shows only the pre-existing default
session. No real worker (agent start / opencode run) was launched.

## Verified behavior

- `herdr --version` → stdout `herdr 0.8.2`, exit 0.
- Success envelope: one JSON object on stdout,
  `{"id":"cli:<verb>","result":{"type":"<verb_result>", ...}}`.
- Error envelope: one JSON object on **stderr**, exit 1,
  `{"id":"cli:<verb>","error":{"code":"<snake_case>","message":"..."}}`.
  CLI syntax errors exit 2. (`server_not_running` observed for a stopped
  named session, with remedy text naming `herdr session attach <name>`.)
- `herdr session list --json` → `{"sessions":[{"name","running","default",...}]}`.
- `herdr --session <name> <verb>` targets (and, once its server is up, uses)
  the named session; without a running server it fails `server_not_running`.
  `herdr session attach <name>` starts the session server (observed: the TUI
  panicked on a TTY-less terminal, exit 101, yet the session server came up
  and stayed `running: true`).
- `herdr --session S workspace create --cwd R --label N --no-focus` →
  `.result.workspace.workspace_id` (`w2`), `.result.tab.tab_id`,
  `.result.root_pane.pane_id` (`w2:p1`). Pane cwd equals `--cwd`.
- `herdr pane get <id>` → `.result.pane{pane_id, workspace_id, tab_id,
  agent_status, cwd, foreground_cwd, focused, revision,...}`.
- `herdr pane process-info --pane <id>` → `.result.process_info{
  shell_pid, foreground_process_group_id, foreground_processes:[{pid, name,
  argv, cmdline, cwd}]}`.
- `herdr pane run <id> <command>` → fire-and-forget: empty stdout, exit 0.
  Observation channels: `pane wait-output --match <text> --timeout <ms> <id>`
  (returns `.result.matched_line` and a `.result.read.text` snapshot,
  `type:"output_matched"`; errors `timeout`) and `pane read`.
- `herdr pane read <id>` → plain text (no JSON envelope). With
  `--source recent-unwrapped --lines 200` returns the recent transcript.
- `herdr pane close <id>` → `{"result":{"type":"ok"}}`; closing a workspace's
  root pane removes the workspace (a later `workspace close` then reports
  `workspace_not_found`).
- `herdr workspace close <id>`, `herdr session stop <name> --json`
  (`.stopped:true`), `herdr session delete <name> --json` (`.deleted:true`).
- `herdr agent start --kind opencode` requires an existing shell pane at its
  interactive prompt; passes native args after `--`. `herdr agent prompt
  <target> <text> --wait --until idle|done|blocked --timeout <ms>`; rejects an
  already-blocked agent with `agent_blocked` before sending input; a timeout
  is reported as `timeout`; an accepted submission with no observed state
  change within 5 s reports `agent_prompt_stalled`. `herdr agent get <target>`
  / `herdr agent read <target>` / `herdr agent wait <target>` available.
- `herdr plugin link|unlink|enable|disable|list|action list|action invoke
  --plugin <id> <action>` and `herdr plugin pane open|focus|close` exist.

## Known quirks (recorded, not guessed around)

- `pane read --lines <small N>` (observed at 3 and 5, any source) returns
  empty output on 0.8.2; `--lines 200` returns content. The adapter therefore
  bounds reads with `--lines 200` plus a client-side 16 KB tail truncation and
  treats a short read as possibly-truncated.
- Named-session servers are per-session daemons under
  `~/.config/herdr/sessions/<name>/`; dispatch on a stopped session fails
  closed until a human (or ensureSession's bounded attach attempt) starts it.
