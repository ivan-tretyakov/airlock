# Dedicated Linux box for Airlock agents — build guide

**Date:** 2026-08-14 · Companion to `airlock-review-2026-08-13.md` and `airlock-unattended-setup.md`
**Goal:** offload long-running Airlock/OpenCode work to a dedicated Linux laptop, reachable from anywhere, so the main Windows machine stays free.

---

## 1. This is an upgrade, not just spare capacity

Four things in your own repo and review get *better* on Linux — worth knowing before you treat this as a mere offload box:

1. **The OpenCode launcher's Windows failure class disappears.** `adapters/opencode/README.md`: *"On Windows it resolves only direct `opencode.exe` … PowerShell/npm command shims fail closed."* On Linux the launcher resolves `opencode` and `git` directly with no shim ambiguity.
2. **The worker install path is native.** The adapter wants a byte-identical copy at `~/.config/opencode/agents/airlock-worker.md` — an XDG path that is natural on Linux and awkward on Windows.
3. **Guard finding F3(a) largely evaporates.** The contract-root incompatibility that made you abandon `.airlock/contract.json` on promo-price-change came from a OneDrive session folder sitting beside the code checkout. With repos under `~/work/<project>` and contract v2's absolute `root`, that class of mismatch goes away.
4. **One shell instead of two.** No `PowerShell` tool on Linux, so every worker write goes through Bash — which the v2 guard screens. Fewer paths to cover.

Trade-off to manage: **mixed Windows + Linux checkouts of the same repos make line endings worse.** Land the `.gitattributes` fix (`* text=auto`, `*.md text eol=lf`, `*.mjs text eol=lf`, `*.json text eol=lf`) *before* you clone anything on the new box, or you will fight 547-line phantom diffs on both machines.

---

## 2. Remote access — Tailscale + tmux is the whole answer

| Layer | Tool | Why |
|---|---|---|
| Network | **Tailscale** | WireGuard mesh; no port forwarding, no dynamic DNS, works behind NAT/CGNAT and from mobile data. Free tier is ample. Enable **MagicDNS** so the box is just `devbox`. |
| Shell | **SSH** (keys only) or **Tailscale SSH** | Tailscale SSH removes key management entirely and logs sessions; plain SSH over the tailnet is equally fine. |
| Persistence | **tmux** | Non-negotiable. Every agent run lives in a tmux session so it survives disconnects, laptop sleep on *your* side, and network changes. |
| Flaky links | **mosh** | Survives roaming and suspend far better than SSH on a phone/train. |
| Editing | **VS Code / Cursor Remote-SSH** | Edit and read agent output on the remote FS as if local. |
| Phone | **Termius** or **Blink** + Tailscale | Enough to check `tmux attach`, read STATUS.md, answer a decision. |

Hardening: disable password auth (`PasswordAuthentication no`), keys only, and restrict access with a Tailscale ACL so only your devices can reach it. Don't expose SSH to the public internet — with Tailscale you never need to.

If you also want to hit a dev server running on the box from your Windows machine's browser, Tailscale gives you `http://devbox:5173` directly; `tailscale serve` adds TLS if you want it.

---

## 3. Laptop-specific config (this is where people get burned)

A laptop is not a server by default. Five things to fix:

**Lid close and sleep** — `/etc/systemd/logind.conf`:
```
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
```
then `sudo systemctl restart systemd-logind`. Belt and braces:
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# GNOME desktops also need:
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
```

**Services must survive logout** — so agent tmux sessions and timers keep running:
```bash
sudo loginctl enable-linger $USER
```

**Battery health** — a laptop pinned at 100% charge 24/7 swells its battery within a year. Most ThinkPad/Dell/ASUS kernels expose:
```bash
echo 80 | sudo tee /sys/class/power_supply/BAT0/charge_control_end_threshold
```
Make it persistent via a systemd unit or your vendor tool (`tlp`).

**Thermals** — closed-lid sustained 100% CPU throttles hard. Leave the lid open or prop the machine on a stand; check `sensors` under load once before trusting long runs.

**Don't let the OS reboot mid-run** — unattended-upgrades installing a kernel and rebooting at 03:00 will kill a 4-hour agent run. Either disable automatic reboots (`Unattended-Upgrade::Automatic-Reboot "false"`) or schedule them at a time no run is active, and make your runner resume from the ledger rather than assume continuity.

---

## 4. Auth on a headless box

- **Claude Code:** run `claude setup-token` once (needs a browser — do it while sitting at the machine, or SSH with `-L` port-forwarding and open the OAuth URL in your local browser). Store the resulting `CLAUDE_CODE_OAUTH_TOKEN` so runs bill against your subscription rather than API credits.
- **OpenCode:** provider API keys via environment/keyring. Note the launcher deliberately sets `OPENCODE_CONFIG_CONTENT` and `OPENCODE_PERMISSION` per run rather than trusting ambient config — keep the ambient config minimal so nothing surprising merges in.
- **Git:** a **fine-grained GitHub PAT scoped to the specific repos**, not your main account key. Push access to feature branches only; leave `main` protected. The launcher already disables interactive Git credential prompts and inherited SSH-agent access for worker processes — don't undo that by putting a broad key in the agent user's `~/.ssh`.

---

## 5. Security — read this before granting broad tool access

The adapter says it plainly: *"The worker is a user-account process with advisory model instructions plus deterministic permissions and post-return audits… **they are not adversarial isolation.**"* Airlock detects scope drift; it does not contain a hostile or badly-confused process. On a box you're leaving unattended, isolation has to come from the machine:

- **Dedicated Unix user** (`agent`) that owns the checkouts. Not your login user, never root. (`--dangerously-skip-permissions` refuses to start as root anyway, outside a recognised sandbox.)
- **No production credentials on the box.** No prod `.env`, no customer data, no Buynomics prod tokens. If a task needs them, that task isn't an unattended task.
- **Scoped tokens only** — repo-scoped PAT, separate from your daily credentials.
- **Full-disk encryption** on a laptop that lives somewhere and stays powered on.
- Optionally per-project containers (devcontainer/podman) if you want a real blast-radius boundary rather than a policy one.

---

## 6. How you actually delegate work to it

Keep it dumb. Git is the handoff; tmux is the runtime.

```bash
# on the box, one session per task
tmux new -s pack-p1
cd ~/work/pricing-ui-v3
claude   # then: /airlock:start --workflow full <resume approved plan>
# Ctrl-b d to detach; reattach later from anywhere
```

- **One tmux session per work package**, named after it. `tmux ls` from your phone is then a live status board.
- **Repo is the state.** STATUS.md + ledger Resume checkpoint mean you never depend on the transcript surviving — which matters, since Claude Code session `.jsonl` files are machine-local and don't move between hosts.
- **Push to `claude/<pack>` branches and open a PR.** That's your review surface from any device, and it's the same surface the unattended-mode design in the companion doc uses for parking decisions.
- **Notifications:** a one-line `curl` to [ntfy.sh](https://ntfy.sh) or a Slack webhook at end-of-run / on-parked-decision turns "check the box" into "get pinged." Wire it into the same step that refreshes STATUS.md.
- Add `systemd --user` timers later if you want scheduled runs; start with manual tmux and see whether you actually need automation.

---

## 7. Hardware sizing — one question decides it

**If "alternative models" means other providers' APIs** (Claude via OpenCode, GPT, Gemini, etc.): almost any modern laptop works. Target **16 GB RAM minimum, 32 GB comfortable**, a fast NVMe with ≥256 GB free (git worktrees + `node_modules` per checkout add up fast), and any 4+ core CPU. The workload is network I/O and test runs, not inference.

**If it means running local models** (Ollama/llama.cpp): a laptop is the wrong host. You'd need a discrete GPU with substantial VRAM, and a laptop GPU will thermally throttle under sustained load in exactly the scenario you're building for. Use a desktop with a proper GPU, or keep using APIs.

OS: **Ubuntu LTS** or **Fedora** — both give current Node without fuss and have the best Tailscale/driver support. Node 22+ (the launcher and its test suite target modern Node), Git, tmux, ripgrep.

---

## 8. Build checklist

1. Install Ubuntu LTS, enable full-disk encryption, create an `agent` user.
2. Install Tailscale, join your tailnet, enable MagicDNS; SSH keys only, passwords off.
3. Apply §3 (lid/sleep/linger/battery threshold/no auto-reboot).
4. Install Node 22+, Git, tmux, ripgrep, OpenCode CLI, Claude Code.
5. Land `.gitattributes` **before** cloning repos on this box.
6. `claude setup-token`; configure OpenCode provider keys; add the repo-scoped PAT.
7. Clone Airlock to a stable path; install `~/.config/opencode/agents/airlock-worker.md` byte-identical; `opencode debug config` to confirm `agent.airlock-worker` is primary with no model/variant and `task`/`question` denied.
8. Run the plugin's suites on this host — `node --test scripts/guard.test.mjs scripts/plugin-policy.test.mjs scripts/run-external-agent.test.mjs`. The external-agent suite failed 54 tests in a Linux container during review; confirm whether that's environmental before trusting OpenCode routes here.
9. Smoke-test the `agent_id` guard question from PR #1 **on this box** — actor classification is what the whole v2 contract rests on.
10. First real task: one small approved plan, in tmux, with you watching the first 20 minutes.

---

## 9. Where this sits relative to the cloud options

They're complementary, not competing:

- **This box** — long, chatty, interactive-ish work; OpenCode routes with alternative models; anything needing your private network or a real dev server. You keep full control and pay nothing per run.
- **Routines / cloud sessions** — scheduled unattended batches that must run when the laptop might be off or travelling.
- **GitHub Action** — the event-driven bridge: your PR comment resumes work immediately, wherever the work is running.

A sensible end state is the Linux box as the default workhorse, with the PR as the shared review surface for everything.
