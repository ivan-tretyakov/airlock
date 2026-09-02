import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PreflightError, SUBSTRATE_CODES, checkRequirements, createHerdrClient, parseVersion, versionAtLeast } from "../src/herdr-client.mjs";
import { assert } from "./helpers.mjs";

const MAIN_HELP = `herdr — terminal workspace manager for AI coding agents

Usage: herdr [options]
       herdr agent <subcommand> ...
       herdr pane <subcommand> ...
       herdr workspace <subcommand> ...
       herdr session <subcommand> ...
       herdr plugin <subcommand> ...
       herdr api <subcommand> ...

Options:
  --session <name>    Use or create a named persistent session
  --version, -V       Print version and exit
  --help, -h          Show this help
`;

function groupHelp(verbs, description = "Commands:") {
  return `${description}\n${verbs.map((verb) => `  ${verb.padEnd(16)} ${verb} helper`).join("\n")}\n`;
}

const GROUP_HELP = {
  agent: groupHelp(["list", "get", "read", "send-keys", "prompt", "rename", "focus", "wait", "attach", "start", "explain"]),
  pane: groupHelp(["list", "current", "get", "layout", "process-info", "read", "split", "close", "send-text", "send-keys", "wait-output", "run"]),
  workspace: groupHelp(["list", "create", "get", "focus", "rename", "close"]),
  session: groupHelp(["list", "attach", "stop", "delete"]),
  plugin: groupHelp(["install", "uninstall", "link", "unlink", "enable", "disable", "list", "action", "config-dir"]),
  api: groupHelp(["snapshot", "schema"]),
};

const LEAF_HELP = {
  "agent start": "Usage: herdr agent start <NAME> --kind <KIND> --pane <ID> [OPTIONS]\n      --kind <KIND>  [possible values: claude, codex, opencode, gemini]\n      --pane <ID>\n      --timeout <MS>\n  [AGENT_ARG]...",
  "agent prompt": "Usage: herdr agent prompt <TARGET> <TEXT> [OPTIONS]\n      --wait\n      --until <STATUS>\n      --timeout <MS>",
  "agent get": "Usage: herdr agent get <target>",
  "agent wait": "Usage: herdr agent wait <TARGET> [OPTIONS]\n      --until <STATUS>\n      --timeout <MS>",
  "pane get": "Usage: herdr pane get <pane_id>",
  "pane read": "Usage: herdr pane read [OPTIONS] <PANE_ID>\n      --source <SOURCE>\n      --lines <N>\n      --format <FORMAT>",
  "pane run": "Usage: herdr pane run <PANE_ID> <COMMAND>...",
  "pane wait-output": "Usage: herdr pane wait-output [OPTIONS] <PANE_ID>\n      --match <TEXT>\n      --regex <PATTERN>\n      --lines <N>\n      --timeout <MS>",
  "pane process-info": "Usage: herdr pane process-info [OPTIONS]\n      --pane <ID>\n      --current",
  "pane close": "Usage: herdr pane close <pane_id>",
  "workspace create": "Usage: herdr workspace create [OPTIONS]\n      --cwd <PATH>\n      --label <TEXT>\n      --env <KEY=VALUE>\n      --focus\n      --no-focus",
  "workspace close": "Usage: herdr workspace close <workspace_id>",
  "session list": "Usage: herdr session list [OPTIONS]\n      --json",
  "session stop": "Usage: herdr session stop [OPTIONS] <NAME>\n      --json",
  "plugin link": "Usage: herdr plugin link <PATH>",
  "plugin enable": "Usage: herdr plugin enable <ID>",
  "plugin disable": "Usage: herdr plugin disable <ID>",
  "plugin config-dir": "Usage: herdr plugin config-dir <ID>\nPrint a plugin config directory",
};

function baseFixtures(overrides = {}) {
  return {
    version: "herdr 0.8.2",
    mainHelp: MAIN_HELP,
    groupHelp: { ...GROUP_HELP },
    leafHelp: { ...LEAF_HELP },
    ...overrides,
  };
}

function client(t, options = {}) {
  const evidenceDir = options.evidenceDir === undefined ? null : options.evidenceDir;
  return createHerdrClient({ sessionName: options.session ?? "test-session", herdrBin: options.herdrBin ?? "herdr", evidenceDir, fixtures: options.fixtures ?? baseFixtures(), callTimeoutMs: options.callTimeoutMs ?? 2000, log: options.log ?? (() => {}) });
}

test("parseVersion and versionAtLeast gate the minimum", () => {
  assert.equal(parseVersion("herdr 0.8.2"), "0.8.2");
  assert.equal(parseVersion("nothing"), null);
  assert.equal(versionAtLeast("0.8.2", "0.8.2"), true);
  assert.equal(versionAtLeast("0.8.1", "0.8.2"), false);
  assert.equal(versionAtLeast("1.0.0", "0.8.2"), true);
});

test("the substrate code set is exactly the class-S enumeration", () => {
  assert.deepEqual([...SUBSTRATE_CODES], ["herdr_not_installed", "spawn_error", "timeout", "cli_usage"]);
});

test("preflight passes against recorded help fixtures and writes the evidence capture", async (t) => {
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "airlock-evidence-"));
  t.after(() => rm(evidenceDir, { recursive: true, force: true }));
  const result = await client(t, { evidenceDir }).preflight();
  assert.equal(result.version, "0.8.2");
  assert.ok(result.evidenceFile && existsSync(result.evidenceFile));
  assert.ok(readFileSync(result.evidenceFile, "utf8").includes("herdr plugin config-dir"));
});

test("preflight V1 refuses a missing binary as a substrate failure (retryable, class S)", async () => {
  const bare = createHerdrClient({ sessionName: "s", herdrBin: "/nonexistent/herdr-missing" });
  await assert.rejects(bare.preflight(), (error) => error instanceof PreflightError && /Herdr not installed/.test(error.message) && error.code === "substrate");
});

test("preflight V1 refuses versions below 0.8.2 as a precondition (exit 78 territory)", async (t) => {
  const old = client(t, { fixtures: baseFixtures({ version: "herdr 0.8.1" }) });
  await assert.rejects(old.preflight(), (error) => error instanceof PreflightError && /too old/.test(error.message) && error.requirement === "V1" && error.code === "precondition");
});

test("preflight V2 fails closed when a required verb is missing, with observed help text", async (t) => {
  const groups = { ...GROUP_HELP, agent: groupHelp(["list", "get", "start"]) };
  const broken = client(t, { fixtures: baseFixtures({ groupHelp: groups }) });
  await assert.rejects(broken.preflight(), (error) => {
    assert.ok(error instanceof PreflightError);
    assert.match(error.message, /verb 'agent prompt' not offered/);
    assert.match(error.message, /Observed help output/);
    assert.equal(error.code, "precondition");
    return true;
  });
});

test("preflight V2 requires the plugin config-dir verb (routing lives in the plugin config dir)", async (t) => {
  const groups = { ...GROUP_HELP, plugin: groupHelp(["install", "uninstall", "link", "unlink", "enable", "disable", "list", "action"]) };
  const leaves = { ...LEAF_HELP, "plugin config-dir": null };
  const broken = client(t, { fixtures: baseFixtures({ groupHelp: groups, leafHelp: leaves }) });
  await assert.rejects(broken.preflight(), (error) => {
    assert.match(error.message, /verb 'plugin config-dir' not offered/);
    return true;
  });
});

test("preflight V2 fails closed when a required flag is renamed", async (t) => {
  const leaves = { ...LEAF_HELP, "agent prompt": "Usage: herdr agent prompt <TARGET> <TEXT>\n      --wait\n      --duration <MS>" };
  const broken = client(t, { fixtures: baseFixtures({ leafHelp: leaves }) });
  await assert.rejects(broken.preflight(), (error) => {
    assert.match(error.message, /flag '--until' missing on 'agent prompt'/);
    return true;
  });
});

test("checkRequirements treats pane process-info and agent reads as optional", () => {
  const leaves = { ...LEAF_HELP, "pane process-info": null, "agent get": null };
  assert.deepEqual(checkRequirements({ groups: GROUP_HELP, leaves }), []);
});

test("agent start passes --kind through to the herdr argv", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const logFile = path.join(binDir, "argv.log");
  const script = path.join(binDir, "herdr-kind");
  await writeFile(script, `#!/bin/bash\necho "$@" >> ${JSON.stringify(logFile)}\nexit 0\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script });
  await instance.agentStart({ name: "al-t001-a1", kind: "codex", paneId: "w1:p1", agentArgs: ["-m", "gpt-x", "-c", "model_reasoning_effort=high"], timeoutMs: 1000 });
  const line = readFileSync(logFile, "utf8").trim();
  assert.equal(line, "--session s agent start al-t001-a1 --kind codex --pane w1:p1 --timeout 1000 -- -m gpt-x -c model_reasoning_effort=high");
});

test("pluginConfigDir resolves the plugin's config directory (JSON or plain-text reply)", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const script = path.join(binDir, "herdr-config-dir");
  await writeFile(script, `#!/bin/bash\nif [ "$1" = "plugin" ] && [ "$2" = "config-dir" ]; then echo "/home/u/.local/share/herdr/plugins/$3/config"; fi\nexit 0\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script });
  const resolved = await instance.pluginConfigDir();
  assert.deepEqual(resolved, { ok: true, dir: "/home/u/.local/share/herdr/plugins/airlock.herdr/config" });
  const jsonScript = path.join(binDir, "herdr-config-dir-json");
  await writeFile(jsonScript, `#!/bin/bash\necho '{"result":{"config_dir":"/cfg/from-json"}}'\n`);
  await chmod(jsonScript, 0o755);
  const jsonInstance = createHerdrClient({ sessionName: "s", herdrBin: jsonScript });
  assert.deepEqual(await jsonInstance.pluginConfigDir(), { ok: true, dir: "/cfg/from-json" });
});

test("agentPrompt keeps the stall-and-timeout envelope: delivered stays true", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const script = path.join(binDir, "herdr-stall");
  await writeFile(script, `#!/bin/bash\nif [ "$4" = "prompt" ]; then echo '{"error":{"code":"agent_prompt_stalled","message":"no state change within 5000 ms"}}' >&2; exit 1; fi\nexit 0\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script });
  const stalled = await instance.agentPrompt({ name: "a", prompt: "p", timeoutMs: 500 });
  assert.equal(stalled.delivered, true, "a stall is reported only after an accepted submission");
  assert.equal(stalled.code, "agent_prompt_stalled");
});

test("every herdr call passes an explicit timeout and surfaces the error envelope", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const logFile = path.join(binDir, "argv.log");
  const script = path.join(binDir, "herdr-fake");
  await writeFile(script, `#!/bin/bash\necho "$@" >> ${JSON.stringify(logFile)}\ncase " $* " in\n  *" --version "* ) echo "herdr 0.8.2"; exit 0 ;;\n  *" session list "* ) echo '{"sessions":[{"name":"s","running":true}]}' ;;\n  *" agent prompt "* ) sleep 1; echo '{"error":{"code":"timeout","message":"timeout"}}' >&2; exit 1 ;;\nesac\nexit 0\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script, fixtures: baseFixtures(), evidenceDir: null });
  const result = await instance.preflight();
  assert.equal(result.version, "0.8.2");
  const started = Date.now();
  const prompt = await instance.agentPrompt({ name: "al-t001-a1", prompt: "work", timeoutMs: 300 });
  assert.equal(prompt.delivered, true);
  assert.equal(prompt.timedOut, true);
  assert.ok(Date.now() - started < 4000);
  const argv = readFileSync(logFile, "utf8").trim().split("\n");
  const promptLine = argv.find((line) => line.includes("agent prompt"));
  assert.ok(promptLine.includes("--wait"));
  assert.ok(promptLine.includes("--timeout"));
  assert.ok(promptLine.includes("--until idle"));
  const close = await instance.closePane("w1:p1");
  assert.ok(close.ok);
  assert.equal(readFileSync(logFile, "utf8").trim().split("\n").at(-1), "--session s pane close w1:p1");
});

test("spawn-level timeouts bound every call even when the CLI ignores --timeout", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const script = path.join(binDir, "herdr-slow");
  await writeFile(script, "#!/bin/bash\nsleep 5\n");
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script, callTimeoutMs: 200 });
  const started = Date.now();
  const result = await instance.paneInfo("w1:p1");
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
});

test("readPane bounds output to the requested byte budget and keeps the tail", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const script = path.join(binDir, "herdr-read");
  const big = `${"x".repeat(40_000)}TAIL-MARKER`;
  await writeFile(script, `#!/bin/bash\nprintf '%s' ${JSON.stringify(big)}\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script });
  const result = await instance.readPane("w1:p1", { lines: 200, maxBytes: 16 * 1024 });
  assert.ok(result.ok);
  assert.ok(Buffer.byteLength(result.text, "utf8") <= 16 * 1024);
  assert.ok(result.text.endsWith("TAIL-MARKER"));
});

test("ensureSession verifies the named session or fails closed with the attach remedy as class S", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const script = path.join(binDir, "herdr-session");
  await writeFile(script, `#!/bin/bash\ncase " $* " in\n  *" session list "* ) if [ -f "${binDir}/running" ]; then echo '{"sessions":[{"name":"s","running":true}]}'; else echo '{"sessions":[]}'; fi ;;\n  *" session attach "* ) touch "${binDir}/running"; exit 0 ;;\n  * ) exit 0 ;;\nesac\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "s", herdrBin: script });
  assert.deepEqual(await instance.ensureSession("s"), { ok: true, created: true });
  assert.deepEqual(await instance.ensureSession("s"), { ok: true, created: false });
  const stopped = path.join(binDir, "herdr-stopped");
  await writeFile(stopped, `#!/bin/bash\nif [ "$1" = "session" ] && [ "$2" = "list" ]; then echo '{"sessions":[]}'; fi\nexit 0\n`);
  await chmod(stopped, 0o755);
  const failing = createHerdrClient({ sessionName: "s", herdrBin: stopped });
  await assert.rejects(failing.ensureSession("s"), (error) => {
    assert.match(error.message, /herdr session attach s/);
    assert.equal(error.code, "substrate");
    return true;
  });
});

test("session-scoped calls target the named session explicitly", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "airlock-fakebin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const logFile = path.join(binDir, "argv.log");
  const script = path.join(binDir, "herdr-scope");
  await writeFile(script, `#!/bin/bash\necho "$@" >> ${JSON.stringify(logFile)}\nexit 0\n`);
  await chmod(script, 0o755);
  const instance = createHerdrClient({ sessionName: "exact-session", herdrBin: script });
  await instance.paneInfo("w9:p1");
  assert.equal(readFileSync(logFile, "utf8").trim().split("\n").at(-1), "--session exact-session pane get w9:p1");
});
