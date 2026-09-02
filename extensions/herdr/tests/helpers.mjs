import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAirlockClient } from "../src/airlock-client.mjs";
import { PreflightError } from "../src/herdr-client.mjs";

export const airlockScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "airlock.mjs");

export function basePlan(tasks = []) {
  return {
    schema: "airlock.plan/v4",
    goal: "Herdr router dispatch and reconcile behavior is testable",
    done: ["node --test extensions/herdr/tests/ passes"],
    nonGoals: [],
    created: "2026-09-01T09:00:00.000Z",
    budget: { maxTasks: 8, maxExpensive: 2 },
    tasks,
    decisions: [],
  };
}

export function basePlanV3(tasks = []) {
  return {
    schema: "airlock.plan/v3",
    goal: "Herdr router tolerates the v3 upgrade notice",
    done: ["node --test extensions/herdr/tests/ passes"],
    nonGoals: [],
    created: "2026-09-01T09:00:00.000Z",
    budget: { maxTasks: 8, maxExpensive: 2 },
    tasks,
    decisions: [],
  };
}

export function builderTask(id, owns, dependsOn = [], { expensive, role = "builder" } = {}) {
  return {
    id,
    title: `Build ${owns[0]}`,
    role,
    ...(expensive === undefined ? {} : { expensive }),
    owns,
    dependsOn,
    acceptance: `test -f ${owns[0]} succeeds`,
    status: "todo",
    evidence: [],
    startedAt: null,
    finishedAt: null,
    note: null,
  };
}

export function v3Task(id, owns, dependsOn = [], risk = "standard") {
  const { expensive, ...task } = builderTask(id, owns, dependsOn);
  return { ...task, risk };
}

export function defaultTasks() {
  return [builderTask("T001", ["src/alpha.js"]), builderTask("T002", ["src/beta.js"], ["T001"])];
}

export const DEFAULT_ROUTING = Object.freeze({
  version: 1,
  bindings: {
    builder: {
      default: {
        primary: { executor: "opencode", model: "test/model-primary", effort: null },
        fallbacks: [
          { executor: "opencode", model: "test/model-fallback", effort: null },
          { executor: "claude", model: "opus", effort: "high" },
        ],
      },
      expensive: { primary: { executor: "claude", model: "opus", effort: "max" } },
    },
    checker: { default: { primary: { executor: "opencode", model: "test/checker", effort: null } } },
    browser: { default: { primary: { executor: "opencode", model: "test/browser", effort: null } } },
  },
});

export async function installRoutes(configDir, routing = DEFAULT_ROUTING) {
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "routing.json"), `${JSON.stringify(routing, null, 2)}\n`);
  return configDir;
}

export async function makeProject(t, tasks = defaultTasks(), { fileName = "airlock.plan.json", plan = null, routing = DEFAULT_ROUTING } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-herdr-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "--initial-branch=main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "airlock@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Airlock Test"]);
  const planPath = path.join(root, fileName);
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan ?? basePlan(tasks), null, 2)}\n`);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  for (const role of ["builder", "checker", "browser"]) {
    const agentPath = path.join(root, ".opencode", "agent", `airlock-${role}.md`);
    await mkdir(path.dirname(agentPath), { recursive: true });
    await writeFile(agentPath, `project-local ${role} agent\n`);
  }
  const configDir = path.join(root, ".git", "airlock-test", "herdr-config");
  if (routing) await installRoutes(configDir, routing);
  else await mkdir(configDir, { recursive: true });
  return { root, planPath, configDir };
}

export function airlockClientFor(root, planPath, extraEnv = {}) {
  return createAirlockClient({
    repoRoot: root,
    planPath,
    bin: process.execPath,
    binArgs: [airlockScript],
    env: { ...process.env, ...extraEnv },
  });
}

export const EXECUTOR_HELP = Object.freeze({
  claude: {
    help: "Options:\n  --agent <agent>    Agent for the current session\n  --model <model>    Model alias or full name (e.g. opus, claude-fable-5)\n  --effort <effort>  low, medium, high, xhigh, max\n",
    runHelp: "",
  },
  codex: {
    help: "Options:\n  -m, --model <MODEL>       Model to use\n  -c, --config <key=value>  Override a configuration value\n",
    runHelp: "",
  },
  opencode: {
    help: "Options:\n  -m, --model  model to use in the format of provider/model\n      --agent  agent to use\n",
    runHelp: "Options:\n      --agent    agent to use\n  -m, --model    model to use\n      --variant  model variant (provider-specific reasoning effort, e.g., high, max, minimal)\n",
  },
});

export function fakeProbes({ which = null, helps = null, missing = [] } = {}) {
  return {
    which: which ?? ((bin) => (missing.includes(bin) ? null : `/usr/bin/${bin}`)),
    help: (executor) => helps?.[executor] ?? EXECUTOR_HELP[executor],
    fileExists: (filePath) => existsSync(filePath),
    realpath: (filePath) => filePath,
  };
}

export function fakeHerdr(t, options = {}) {
  const state = {
    sessions: new Set(["test-session"]),
    workspaces: new Map(),
    panes: new Map(),
    agents: new Map(),
    calls: [],
    counter: 0,
  };
  const client = {
    state,
    calls: state.calls,
    _spawnOutput(paneId, text) {
      const pane = state.panes.get(paneId);
      if (pane) pane.output.push(text);
    },
    _setAgent(name, value) {
      state.agents.set(name, { name, state: value });
    },
    _failOn(method, error) {
      state.failOn = { method, error };
    },
  };
  function record(method, args) {
    state.calls.push({ method, args });
    if (state.failOn?.method === method) {
      const error = state.failOn.error;
      state.failOn = null;
      throw error;
    }
  }
  Object.assign(client, {
    async preflight() {
      record("preflight", {});
      if (options.preflightError) throw options.preflightError;
      return { version: "0.8.2", evidenceFile: null, warnings: [] };
    },
    async ensureSession(name) {
      record("ensureSession", { name });
      state.sessions.add(name);
      return { ok: true, created: false };
    },
    async pluginConfigDir() {
      record("pluginConfigDir", {});
      return options.configDir ? { ok: true, dir: options.configDir } : { ok: false, code: "not_linked", message: "plugin not linked", dir: null };
    },
    async createPane(session, workspaceName, cwd) {
      record("createPane", { session, workspaceName, cwd });
      state.counter += 1;
      const workspaceId = `w${state.counter}`;
      const paneId = `w${state.counter}:p1`;
      state.workspaces.set(workspaceId, { workspace_id: workspaceId, label: workspaceName, cwd });
      state.panes.set(paneId, { pane_id: paneId, workspace_id: workspaceId, agent_status: "unknown", cwd, output: [], foreground: [] });
      return { ok: true, workspaceId, paneId };
    },
    async agentStart({ name, kind, paneId, agentArgs, timeoutMs }) {
      record("agentStart", { name, kind, paneId, agentArgs, timeoutMs });
      assert.ok(["claude", "codex", "opencode"].includes(kind), `agent start requires a valid --kind, got: ${kind}`);
      state.agents.set(name, { name, state: "idle", paneId, kind });
      const pane = state.panes.get(paneId);
      if (pane) {
        pane.agent_status = "idle";
        if (!pane.foreground.length) pane.foreground = [{ name: kind, argv: [`/usr/bin/${kind}`] }];
      }
      return { ok: true };
    },
    async agentPrompt({ name, prompt, timeoutMs }) {
      record("agentPrompt", { name, prompt, promptLength: prompt.length, timeoutMs });
      return options.promptResult ?? { ok: true, delivered: true, state: "idle", timedOut: false };
    },
    async runInPane({ paneId, command, match, timeoutMs }) {
      record("runInPane", { paneId, command, match, timeoutMs });
      return options.runResult ?? { ok: true, delivered: true, matched: true, timedOut: false, output: "" };
    },
    async readPane(paneId, limits) {
      record("readPane", { paneId, limits });
      const pane = state.panes.get(paneId);
      return { ok: Boolean(pane), text: pane ? pane.output.join("") : "", code: pane ? undefined : "pane_not_found" };
    },
    async paneInfo(paneId) {
      record("paneInfo", { paneId });
      const pane = state.panes.get(paneId);
      if (!pane) return { ok: false, code: "pane_not_found", message: `pane ${paneId} not found`, pane: null };
      return { ok: true, pane: { ...pane, agent_status: pane.reportedStatus ?? pane.agent_status } };
    },
    async processInfo(paneId) {
      record("processInfo", { paneId });
      const pane = state.panes.get(paneId);
      if (!pane) return { ok: false, processInfo: null, code: "pane_not_found" };
      return { ok: true, processInfo: { foreground_processes: pane.foreground } };
    },
    async closePane(paneId) {
      record("closePane", { paneId });
      state.panes.delete(paneId);
      return { ok: true };
    },
    async agentInfo(name) {
      record("agentInfo", { name });
      const agent = state.agents.get(name);
      if (!agent) return { ok: false, code: "not_found", message: `agent ${name} not found`, agent: null };
      return { ok: true, agent };
    },
    async snapshot() {
      record("snapshot", {});
      if (options.snapshotResult) return options.snapshotResult;
      return {
        ok: true,
        snapshot: {
          workspaces: [...state.workspaces.values()],
          panes: [...state.panes.values()].map((pane) => ({ pane_id: pane.pane_id, workspace_id: pane.workspace_id })),
        },
      };
    },
  });
  t.after(() => {
    state.calls.length = 0;
  });
  return client;
}

export function outCapture() {
  const lines = [];
  return {
    lines,
    out: (line) => lines.push(String(line)),
    text: () => lines.join("\n"),
  };
}

export function scriptUi(responses = {}) {
  return {
    confirm: async (question) => (typeof responses.confirm === "function" ? responses.confirm(question) : responses.confirm ?? false),
    input: async (question) => (typeof responses.input === "function" ? responses.input(question) : responses.input ?? null),
  };
}

export { assert, PreflightError };
