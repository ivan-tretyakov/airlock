import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { agentForRole, checkExecutorFlags, dispatchPathFor, isApprovedProcess, launchArgs, opencodeAgentFile, pathBCommand, preflightCandidate, requiredFlags, shellQuote } from "../src/executors.mjs";
import { assert, EXECUTOR_HELP, fakeProbes } from "./helpers.mjs";

test("claude argv: --agent airlock-<role> --model <model> [--effort <effort>]", () => {
  assert.deepEqual(launchArgs({ executor: "claude", model: "opus", effort: "high" }, "builder"), ["--agent", "airlock-builder", "--model", "opus", "--effort", "high"]);
  assert.deepEqual(launchArgs({ executor: "claude", model: "claude-fable-5", effort: null }, "checker"), ["--agent", "airlock-checker", "--model", "claude-fable-5"]);
});

test("codex argv: -m <model>, effort as -c plus the exact single unquoted token", () => {
  const args = launchArgs({ executor: "codex", model: "gpt-x", effort: "high" }, "builder");
  assert.deepEqual(args, ["-m", "gpt-x", "-c", "model_reasoning_effort=high"]);
  const token = args[3];
  assert.equal(token, "model_reasoning_effort=high", "two argv tokens: -c, then the single token");
  assert.ok(!token.includes('"') && !token.includes("'"), "no shell/TOML-style quoting is copied into the argv token");
  assert.deepEqual(launchArgs({ executor: "codex", model: "gpt-x", effort: null }, "builder"), ["-m", "gpt-x"], "codex has no agent-file concept and no effort flag without an effort");
});

test("opencode Path A argv when effort is null; effort set forces Path B", () => {
  assert.deepEqual(launchArgs({ executor: "opencode", model: "prov/model", effort: null }, "browser"), ["--agent", "airlock-browser", "-m", "prov/model"]);
  assert.equal(dispatchPathFor({ executor: "opencode", model: "prov/model", effort: null }), "A-interactive");
  assert.equal(dispatchPathFor({ executor: "opencode", model: "prov/model", effort: "max" }), "B-headless");
  assert.equal(dispatchPathFor({ executor: "claude", model: "opus", effort: "max" }), "A-interactive");
  assert.equal(dispatchPathFor({ executor: "codex", model: "gpt-x", effort: "high" }), "A-interactive");
  assert.throws(() => launchArgs({ executor: "opencode", model: "prov/model", effort: "max" }, "builder"), /Path B/);
});

test("shellQuote wraps in single quotes with the '\\'' escape", () => {
  assert.equal(shellQuote("plain"), "'plain'");
  assert.equal(shellQuote("with 'quote'"), "'with '\\''quote'\\'''");
  assert.equal(shellQuote("a;b$(x)`y`"), "'a;b$(x)`y`'");
});

test("pathBCommand places --agent/-m/--variant explicitly and shell-quotes all four values", () => {
  const command = pathBCommand({ role: "builder", model: "prov/model", effort: "max", promptFile: "/tmp/p a.txt" });
  assert.equal(command, `opencode run --agent 'airlock-builder' -m 'prov/model' --variant 'max' "$(cat '/tmp/p a.txt')"`);
  // Regression for the 0.1.0 pathBCommand defect: the prompt must be the positional
  // message, never the --agent value.
  assert.ok(!command.includes(`--agent "$(cat`));
  // Shell metacharacters coming straight from routing.json must not execute in the pane shell.
  const hostile = pathBCommand({ role: "builder", model: "prov/model; rm -rf /", effort: "$(reboot)", promptFile: "/tmp/o'brien.txt" });
  assert.ok(hostile.includes(`-m 'prov/model; rm -rf /'`));
  assert.ok(hostile.includes(`--variant '$(reboot)'`));
  assert.ok(hostile.includes(`"$(cat '/tmp/o'\\''brien.txt')"`));
});

test("flag checks pass against the recorded help fixtures for the canonical table", () => {
  assert.deepEqual(checkExecutorFlags({ executor: "claude", model: "opus", effort: "high" }, EXECUTOR_HELP.claude), []);
  assert.deepEqual(checkExecutorFlags({ executor: "codex", model: "gpt-x", effort: "high" }, EXECUTOR_HELP.codex), []);
  assert.deepEqual(checkExecutorFlags({ executor: "opencode", model: "p/m", effort: null }, EXECUTOR_HELP.opencode), []);
  assert.deepEqual(checkExecutorFlags({ executor: "opencode", model: "p/m", effort: "max" }, EXECUTOR_HELP.opencode), []);
});

test("a fixture with the flag removed fails that candidate closed", () => {
  const noEffort = { help: EXECUTOR_HELP.claude.help.replace(/^.*--effort.*$\n/m, ""), runHelp: "" };
  assert.deepEqual(checkExecutorFlags({ executor: "claude", model: "opus", effort: "high" }, noEffort), ["claude --help lacks --effort"]);
  const noVariant = { help: EXECUTOR_HELP.opencode.help, runHelp: EXECUTOR_HELP.opencode.runHelp.replace(/^.*--variant.*$\n/m, "") };
  assert.deepEqual(checkExecutorFlags({ executor: "opencode", model: "p/m", effort: "max" }, noVariant), ["opencode run --help lacks --variant"]);
  assert.deepEqual(checkExecutorFlags({ executor: "opencode", model: "p/m", effort: null }, noVariant), [], "Path A does not need --variant");
  const noConfig = { help: EXECUTOR_HELP.codex.help.replace("-c, --config <key=value>", "--profile <name>"), runHelp: "" };
  assert.deepEqual(checkExecutorFlags({ executor: "codex", model: "gpt-x", effort: "high" }, noConfig), ["codex --help lacks -c"]);
});

test("requiredFlags: effort-set opencode checks the run help; interactive otherwise", () => {
  assert.deepEqual(requiredFlags({ executor: "opencode", effort: "max" }), { help: [], runHelp: ["--agent", "--model", "--variant"] });
  assert.deepEqual(requiredFlags({ executor: "opencode", effort: null }), { help: ["--agent", "--model"], runHelp: [] });
  assert.deepEqual(requiredFlags({ executor: "claude" }), { help: ["--agent", "--model", "--effort"], runHelp: [] });
});

test("preflightCandidate: absent binary is a pre-start skip with class executor-missing", () => {
  const probes = fakeProbes({ missing: ["codex"] });
  const verdict = preflightCandidate({ executor: "codex", model: "gpt-x", effort: null }, { role: "builder", repoRoot: "/repo", probes });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.class, "executor-missing");
  assert.equal(verdict.code, "binary_absent");
  assert.match(verdict.remedy, /install codex/);
});

test("preflightCandidate: flag drift is a pre-start skip carrying the observed help text", () => {
  const probes = fakeProbes({ helps: { claude: { help: "Options:\n  --agent <agent>\n  --model <model>\n", runHelp: "" } } });
  const verdict = preflightCandidate({ executor: "claude", model: "opus", effort: "high" }, { role: "builder", repoRoot: "/repo", probes });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.class, "executor-preflight");
  assert.equal(verdict.code, "flag_missing");
  assert.match(verdict.detail, /claude --help lacks --effort/);
  assert.match(verdict.detail, /observed help/);
});

test("preflightCandidate: opencode requires the project-local agent file with the init remedy", async (t) => {
  const repo = await mkdtemp(path.join(tmpdir(), "airlock-exec-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const probes = fakeProbes();
  const candidate = { executor: "opencode", model: "p/m", effort: null };
  const missing = preflightCandidate(candidate, { role: "builder", repoRoot: repo, probes });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "agent_file_missing");
  assert.equal(missing.remedy, `run: airlock init --host opencode in ${repo}`);
  await mkdir(path.join(repo, ".opencode", "agent"), { recursive: true });
  await writeFile(opencodeAgentFile(repo, "builder"), "agent\n");
  const found = preflightCandidate(candidate, { role: "builder", repoRoot: repo, probes });
  assert.equal(found.ok, true);
  assert.deepEqual(found.approvedPaths, ["/usr/bin/opencode"]);
  const claude = preflightCandidate({ executor: "claude", model: "opus", effort: null }, { role: "builder", repoRoot: repo, probes });
  assert.equal(claude.ok, true, "claude performs no agent-file check (the plugin ships the agents)");
  const codex = preflightCandidate({ executor: "codex", model: "gpt-x", effort: null }, { role: "builder", repoRoot: repo, probes });
  assert.equal(codex.ok, true, "codex has no agent artifact by design");
});

test("isApprovedProcess validates the foreground binary against the approved set", () => {
  const info = { process_info: { foreground_processes: [{ name: "opencode", argv: ["/usr/bin/opencode"] }] } };
  assert.equal(isApprovedProcess(info, ["/usr/bin/opencode"]).approved, true);
  const impostor = { process_info: { foreground_processes: [{ name: "evil", argv: ["/opt/evil/opencode"] }] } };
  const verdict = isApprovedProcess(impostor, ["/usr/bin/opencode"]);
  assert.equal(verdict.approved, false);
  assert.equal(verdict.observed, "/opt/evil/opencode");
  assert.deepEqual(isApprovedProcess({ process_info: { foreground_processes: [] } }, ["/x"]), { approved: false, observed: null });
});

test("agentForRole is the static 4.0 agent name", () => {
  assert.equal(agentForRole("builder"), "airlock-builder");
});
