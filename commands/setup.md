---
description: Bootstrap project runtime, browser authentication, and harness MCP registration without activating Airlock
argument-hint: "[native|opencode]"
---

# Configure Airlock

Run an interactive bootstrap for this project. Every step is idempotent: re-running reconciles the requested state and preserves unrelated configuration. Airlock remains off until `/airlock:start`.

## 1. Resolve project choices

Use the runtime from `$ARGUMENTS` when it is `native` or `opencode`; otherwise ask for one. Ask or detect which harnesses the project uses: `claude`, `opencode`, or both. Commands in `commands/*.md` imply Claude Code; `.opencode/command/airlock-*.md` implies OpenCode, but confirm an ambiguous detection.

Ask for exactly one browser backend: `playwright`, `chrome-devtools`, or `none`. One project uses one backend across all selected harnesses. For a configured backend, collect `appUrl`, an authenticated `authSignal` URL and selector, any project-agreed viewport, and for chrome-devtools whether to use a persistent profile or `--browserUrl http://127.0.0.1:9222`.

Detect the current OS and hostname. Never install prerequisites.

## 2. Resolve host-local authentication

Build a project slug from the repository name. Authentication lives outside the repository and every worktree:

- Windows: `%USERPROFILE%\.airlock\auth\<project-slug>\`
- Linux/macOS: `~/.airlock/auth/<project-slug>/`

Use `state.json` as Playwright `authState`; use the sibling `profile/` directory for chrome-devtools persistent-profile mode. Resolve and store absolute paths. The agent never reads or prints a state file, and the browser process loads it. The state file and profile are never added to `ownedPaths` or `processPaths`. Check `.gitignore` and warn if any resolved auth path is inside the repository; do not silently normalize an unsafe location.

Print the one-line human login command and wait for the user to run it. For Playwright, verify the state file exists before auth preflight. For chrome-devtools persistent-profile mode, verify the profile directory exists; for `browserUrl` mode, verify the configured endpoint is reachable. Emit a PowerShell-pasteable `refreshCommand` on Windows and a bash-pasteable command on Linux/macOS.

## 3. Register one browser server

Use the same server name `browser`, backend, flags, absolute auth path, and viewport for every selected harness.

Build one exact backend argument vector before writing either registration:

- Playwright uses `@playwright/mcp@latest`; its arguments begin `-y`, `@playwright/mcp@latest`, `--storage-state`, and the absolute `authState`, followed by `--viewport-size` and the approved `<width>x<height>` when configured.
- chrome-devtools uses `chrome-devtools-mcp@latest`; its arguments begin `-y`, `chrome-devtools-mcp@latest`, followed by exactly one of `--user-data-dir <absolute profile>` or `--browserUrl http://127.0.0.1:9222`, plus `--executablePath <absolute executable>` only when required.

Preserve this exact launch command/argv in config as well as in each harness registration; do not make later prompts reconstruct package names, paths, or flags.

For Playwright, pass `--storage-state <authState>` and the agreed viewport; never `--isolated`, and never rely on the default profile. Storage state creates a fresh parallel-safe context whose cookies are copied for every run.

For chrome-devtools, pass either `--user-data-dir <auth-state-dir>/profile` or `--browserUrl http://127.0.0.1:9222`, exactly as the user chose. A persistent profile is single-instance. Record `executablePath` when Chrome is detected outside the host default, including the macOS application path or a non-standard Windows install.

At project root, create or merge registrations:

- Claude Code: `.mcp.json` with `{"mcpServers":{"browser":{"command":"...","args":[],"env":{}}}}`.
- OpenCode: `opencode.json` or existing `opencode.jsonc` with `{"mcp": {"browser": {"type": "local", "command": ["exe", "arg"], "enabled": true, "environment": {}}}}`. The OpenCode `command` is an array and its environment key is `environment`.

Native Windows Claude Code uses `"command": "cmd"` and arguments beginning `["/c", "npx", "-y", ...]`. Native Windows OpenCode names the real executable `npx.cmd` in its command array; PowerShell/npm shims are not executable registrations. Linux and macOS use plain `npx -y ...`.

Parse existing JSON/JSONC before editing. Merge unrelated servers and settings; never silently overwrite. If `browser` already exists with conflicting backend, flags, or auth state, show the proposed diff and stop for a decision.

This registration provisions interactive/host sessions only. OpenCode tools flow through its own agent config; never inject browser MCP access into launcher-managed external workers, whose closed `OPENCODE_PERMISSION` contract remains unchanged.

## 4. Write config v2

Write or reconcile `.airlock/config.json`:

```json
{
  "schema": "airlock.config/v2",
  "runtime": "native",
  "harnesses": ["claude", "opencode"],
  "host": { "os": "win32", "machine": "<hostname>" },
  "browser": {
    "backend": "playwright",
    "appUrl": "https://example.invalid",
    "authState": "<absolute path>/state.json",
    "authSignal": { "url": "https://example.invalid/account", "selector": "[data-authenticated]" },
    "refreshCommand": "npx playwright open --save-storage=<absolute path>/state.json https://example.invalid",
    "launch": {
      "claude": { "command": "cmd", "args": ["/c", "npx", "-y", "@playwright/mcp@latest", "--storage-state", "<absolute path>/state.json"], "env": {} },
      "opencode": { "command": ["npx.cmd", "-y", "@playwright/mcp@latest", "--storage-state", "<absolute path>/state.json"], "environment": {} }
    }
  }
}
```

The example shows native Windows launch forms; Linux and macOS store plain `npx` commands with POSIX absolute paths.

Replace examples with detected/approved exact values. A v1 config with `"schema": "airlock.config/v1"` remains valid for runtime-only use; missing `browser` means no browser gates are configured.

A config is host-bound. If the project runs on multiple machines, keep runtime and harness choice in the base config and store the host-specific `browser` block plus `host` in `.airlock/config.<hostname>.json`. Merge the matching overlay at runtime. Never reuse another host's launch commands or auth path.

## 5. Preflight and report

Validate the stored commands on the current OS. If `host.os` or `host.machine` does not match and no matching overlay exists, fail loudly with `re-run /airlock:setup on this host`.

For a configured backend, run one bounded preflight: `backend reachable: PASS|FAIL; auth signal: PASS|FAIL`. On failure, emit BLOCKED with the exact stored `refreshCommand`. For `none`, report that no browser gates are configured. Do not authenticate, read auth files, or mutate the application.

For `opencode`, also check local Node.js, Git, and OpenCode executables without installing them. End with one line naming runtime, harnesses, backend/preflight, and `Airlock remains off until /airlock:start`.
