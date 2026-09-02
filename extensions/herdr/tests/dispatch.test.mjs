import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPrompt, dispatch, reportLine, resolvePlanPath, roleFromAgent, THREE_X_MESSAGE } from "../src/dispatch.mjs";
import { acquireWorkflowLock } from "../src/lock.mjs";
import { PreflightError } from "../src/herdr-client.mjs";
import { createRecord, readRecord, workflowDir, workflowKey } from "../src/state.mjs";
import { airlockClientFor, assert, basePlanV3, builderTask, DEFAULT_ROUTING, fakeHerdr, fakeProbes, installRoutes, makeProject, outCapture, v3Task } from "./helpers.mjs";

import { readJsonl, setup, taskStatus } from "./harness.mjs";

test("resolvePlanPath resolves the default plan or refuses ambiguity", async (t) => {
  const { root, planPath } = await makeProject(t);
  assert.equal(resolvePlanPath(root, null), planPath);
  assert.throws(() => resolvePlanPath("/nonexistent-root-xyz", null), /no airlock\.plan\.json/);
  assert.equal(roleFromAgent("airlock-builder"), "builder");
});

test("prompt assembly appends the exact REPORT line with the nonce", () => {
  assert.equal(reportLine("nonce-1"), "REPORT End your reply with exactly one line: AIRLOCK-RESULT nonce-1 ok|blocked <one-line summary>");
  assert.equal(buildPrompt("BRIEF", "nonce-1"), `BRIEF\n${reportLine("nonce-1")}`);
});

test("happy path (opencode, effort null → Path A): pin persisted, kind passed, prompt delivered, RECONCILE handoff", async (t) => {
  const { airlock, herdr, capture, dir, run } = await setup(t);
  const expectedBrief = airlock.next().value.text;
  const result = await run();
  assert.equal(result.code, 0);
  const record = readRecord(dir, "T001");
  assert.equal(record.recordVersion, 2);
  assert.equal(record.state, "needs-reconcile");
  assert.equal(record.executor, "opencode");
  assert.equal(record.agent, "airlock-builder");
  assert.equal(record.agentName, "al-t001-a1");
  assert.equal(record.dispatchPath, "A-interactive");
  assert.equal(record.taskText, expectedBrief, "the retained task brief is the verbatim next text");
  assert.deepEqual(record.pin.candidates[0], { executor: "opencode", model: "test/model-primary", effort: null });
  assert.equal(record.pin.candidateIndex, 0);
  assert.equal(record.pin.advanceCount, 0);
  assert.ok(record.promptAttemptedAt, "persisted before the submission");
  assert.ok(record.promptDeliveredAt);
  assert.equal(record.parkedForHuman, null);
  const start = herdr.calls.find((call) => call.method === "agentStart");
  assert.equal(start.args.kind, "opencode", "herdr agent start carries --kind <executor>");
  assert.deepEqual(start.args.agentArgs, ["--agent", "airlock-builder", "-m", "test/model-primary"]);
  const prompt = herdr.calls.find((call) => call.method === "agentPrompt");
  assert.equal(prompt.args.prompt, buildPrompt(record.taskText, record.nonce));
  assert.ok(prompt.args.timeoutMs > 0);
  assert.ok(capture.lines.includes("RECONCILE T001"));
  assert.equal(taskStatus(airlock, "T001"), "doing");
  const ops = readJsonl(dir).map((entry) => entry.op);
  for (const op of ["preflight", "ensure-session", "airlock-next", "airlock-start", "herdr-create-pane", "herdr-agent-start", "herdr-agent-prompt"]) assert.ok(ops.includes(op), op);
});

test("opencode with a non-null effort forces Path B with the canonical shell-quoted command", async (t) => {
  const routing = { version: 1, bindings: { builder: { default: { primary: { executor: "opencode", model: "test/model-b", effort: "max" } } } } };
  const { herdr, dir, run } = await setup(t, { routing });
  const result = await run();
  assert.equal(result.code, 0);
  const record = readRecord(dir, "T001");
  assert.equal(record.dispatchPath, "B-headless");
  const runCall = herdr.calls.find((call) => call.method === "runInPane");
  const promptFile = runCall.args.command.match(/cat '([^']+)'/)[1];
  assert.equal(runCall.args.command, `opencode run --agent 'airlock-builder' -m 'test/model-b' --variant 'max' "$(cat '${promptFile}')"`);
  assert.equal(runCall.args.match, `AIRLOCK-RESULT ${record.nonce}`);
  assert.equal(readFileSync(promptFile, "utf8"), buildPrompt(record.taskText, record.nonce));
  assert.equal(herdr.calls.some((call) => call.method === "agentStart"), false, "Path B never uses agent start");
});

test("claude candidates dispatch Path A with --agent/--model/--effort", async (t) => {
  const routing = { version: 1, bindings: { builder: { default: { primary: { executor: "claude", model: "opus", effort: "high" } } } } };
  const { herdr, dir, run } = await setup(t, { routing });
  const result = await run();
  assert.equal(result.code, 0);
  const start = herdr.calls.find((call) => call.method === "agentStart");
  assert.equal(start.args.kind, "claude");
  assert.deepEqual(start.args.agentArgs, ["--agent", "airlock-builder", "--model", "opus", "--effort", "high"]);
  assert.equal(readRecord(dir, "T001").executor, "claude");
});

test("codex candidates dispatch Path A with -m and the single -c token", async (t) => {
  const routing = { version: 1, bindings: { builder: { default: { primary: { executor: "codex", model: "gpt-x", effort: "high" } } } } };
  const { herdr, run } = await setup(t, { routing });
  const result = await run();
  assert.equal(result.code, 0);
  const start = herdr.calls.find((call) => call.method === "agentStart");
  assert.equal(start.args.kind, "codex");
  assert.deepEqual(start.args.agentArgs, ["-m", "gpt-x", "-c", "model_reasoning_effort=high"]);
});

test("the expensive tier picks bindings.<role>.expensive from the plan's boolean, never default", async (t) => {
  const { herdr, dir, run } = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"], [], { expensive: true })] });
  const result = await run();
  assert.equal(result.code, 0);
  const record = readRecord(dir, "T001");
  assert.equal(record.pin.tier, "expensive");
  assert.deepEqual(record.pin.candidates, [{ executor: "claude", model: "opus", effort: "max" }]);
  assert.equal(herdr.calls.find((call) => call.method === "agentStart").args.kind, "claude");
});

test("an expensive task with no expensive binding fails closed at exit 6 (no tier inheritance)", async (t) => {
  const routing = { version: 1, bindings: { builder: { default: { primary: { executor: "opencode", model: "p/m", effort: null } } } } };
  const { airlock, capture, run } = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"], [], { expensive: true })], routing });
  const result = await run();
  assert.equal(result.code, 6);
  assert.match(capture.text(), /no route for builder\/expensive; add bindings\.builder\.expensive to .*routing\.json/);
  assert.match(capture.text(), /import-routes --host <claude\|opencode>/);
  assert.equal(taskStatus(airlock, "T001"), "todo", "fired before airlock start");
});

test("missing routing.json fails closed at exit 6 with the import remedy; task untouched", async (t) => {
  const { airlock, capture, configDir, run } = await setup(t, { routing: null });
  const result = await run();
  assert.equal(result.code, 6);
  assert.match(capture.text(), new RegExp(`no routing.json at ${configDir}`));
  assert.equal(taskStatus(airlock, "T001"), "todo");
});

test("invalid routing.json fails closed at exit 6 with the JSON-path message", async (t) => {
  const { configDir, capture, run } = await setup(t);
  await installRoutes(configDir, { version: 1, bindings: { builder: { default: { primary: { executor: "opencode", model: "p/m" }, windows: [{ name: "w", days: ["mon"], utc: "6:00-10:00", executor: "opencode", model: "p/m" }] } } } });
  const result = await run();
  assert.equal(result.code, 6);
  assert.match(capture.text(), /bindings\.builder\.default windows\[0\] start must be HH:MM UTC/);
});

test("NOTHING TO DO records and exits 0 without creating a record", async (t) => {
  const { airlock, capture, dir, run, root } = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"])] });
  assert.ok(airlock.start("T001").ok);
  await writeFile(path.join(root, "src", "alpha.js"), "module.exports = 1;\n");
  assert.ok(airlock.done("T001", "test -f src/alpha.js: ok").ok);
  const result = await run();
  assert.equal(result.code, 0);
  assert.ok(capture.text().includes("NOTHING TO DO"));
  assert.equal(existsSync(path.join(dir, "tasks")), false);
});

test("PARKED under next --unattended passes through airlock's exit 2", async (t) => {
  const { root, planPath, capture, run } = await setup(t);
  const { spawnSync } = await import("node:child_process");
  const { airlockScript } = await import("./helpers.mjs");
  const ask = spawnSync(process.execPath, [airlockScript, "ask", "T001", "Which db?", "--options", "a|b", "--blocking", "--case", "irreversible", "--json", "--plan", planPath], { cwd: root, encoding: "utf8" });
  assert.equal(ask.status, 0, ask.stdout + ask.stderr);
  const result = await run();
  assert.equal(result.code, 2, "airlock PARKED exit 2 is reserved and passed through verbatim");
  assert.match(capture.text(), /PARKED: D1/);
});

test("dispatch refuses while a record is in flight and runs no airlock next", async (t) => {
  const { dir, run, capture } = await setup(t);
  assert.equal((await run()).code, 0);
  const nextCalls = readJsonl(dir).filter((entry) => entry.op === "airlock-next").length;
  const second = await run();
  assert.equal(second.code, 3);
  assert.ok(capture.text().includes("RECONCILE REQUIRED T001"));
  assert.equal(readJsonl(dir).filter((entry) => entry.op === "airlock-next").length, nextCalls);
});

test("dispatch cleans up the offered record when airlock start refuses (exit passthrough)", async (t) => {
  const { root, capture, dir, run, airlock } = await setup(t);
  await writeFile(path.join(root, "dirty.txt"), "unstaged product change\n");
  const result = await run();
  assert.equal(result.code, 1);
  assert.equal(existsSync(path.join(dir, "tasks", "T001.json")), false, "the offered record is deleted");
  assert.match(capture.text(), /AIRLOCK ERROR:.*clean worktree/s);
  assert.equal(taskStatus(airlock, "T001"), "todo");
});

test("agent mismatch between next and start blocks the task and exits 5", async (t) => {
  const { capture, dir, run, airlock } = await setup(t);
  const wrapper = Object.create(airlock);
  wrapper.start = (taskId) => {
    const result = airlock.start(taskId);
    if (result.ok) result.value.agent = "airlock-impostor";
    return result;
  };
  const result = await run({ airlock: wrapper });
  assert.equal(result.code, 5);
  assert.ok(capture.text().includes("AGENT MISMATCH"));
  assert.equal(taskStatus(airlock, "T001"), "blocked");
  assert.equal(readRecord(dir, "T001").state, "failed");
});

test("3.x detection at the status probe: a present routes key (even empty) refuses at exit 78", async (t) => {
  const { airlock, capture, run } = await setup(t);
  const wrapper = Object.create(airlock);
  wrapper.status = () => {
    const result = airlock.status();
    if (result.ok) result.value.routes = [];
    return result;
  };
  const result = await run({ airlock: wrapper });
  assert.equal(result.code, 78);
  assert.ok(capture.text().includes(THREE_X_MESSAGE));
  assert.equal(taskStatus(airlock, "T001"), "todo", "the probe is side-effect-free; nothing dispatched");
});

test("belt-and-braces: a route key in next (even route: null) refuses at exit 78", async (t) => {
  const { airlock, capture, run } = await setup(t);
  const wrapper = Object.create(airlock);
  wrapper.next = (options) => {
    const result = airlock.next(options);
    if (result.ok) result.value.route = null;
    return result;
  };
  const result = await run({ airlock: wrapper });
  assert.equal(result.code, 78);
  assert.ok(capture.text().includes(THREE_X_MESSAGE));
});

test("herdr absent is class S (exit 69); herdr too old / verb missing is a precondition (exit 78)", async (t) => {
  const absent = await setup(t);
  absent.herdr.state.failOn = { method: "preflight", error: new PreflightError("Herdr not installed: 'herdr' is not on PATH. Install Herdr >= 0.8.2, or run Airlock without the router.", { requirement: "V1", code: "substrate" }) };
  const absentResult = await absent.run();
  assert.equal(absentResult.code, 69);
  assert.match(absent.capture.text(), /Herdr not installed/);

  const old = await setup(t);
  old.herdr.state.failOn = { method: "preflight", error: new PreflightError("herdr 0.8.1 is too old; the router requires >= 0.8.2.", { requirement: "V1" }) };
  const oldResult = await old.run();
  assert.equal(oldResult.code, 78);
});

test("a herdr pane-creation failure is class S: needs-reconcile, HERDR UNAVAILABLE, exit 69, chain untouched", async (t) => {
  const { dir, run, airlock, herdr, capture } = await setup(t);
  const instance = { ...herdr };
  instance.createPane = async () => ({ ok: false, code: "spawn_error", message: "daemon socket unreachable" });
  const result = await run({ herdr: instance });
  assert.equal(result.code, 69);
  assert.match(capture.text(), /HERDR UNAVAILABLE .*\(retryable; the chain was not advanced\)/);
  const record = readRecord(dir, "T001");
  assert.equal(record.state, "needs-reconcile");
  assert.equal(record.pin.candidateIndex, 0, "the same candidate is retried by the next run");
  assert.equal(record.pin.advanceCount, 0);
  assert.equal(taskStatus(airlock, "T001"), "doing");
});

test("no candidate survives step-4 preflight: every remedy printed, exit 6, start never called", async (t) => {
  const { airlock, capture, dir, run } = await setup(t, { routing: {
    version: 1,
    bindings: { builder: { default: { primary: { executor: "opencode", model: "p/m", effort: null }, fallbacks: [{ executor: "codex", model: "gpt-x", effort: null }] } } },
  } });
  const result = await run({ probes: fakeProbes({ missing: ["opencode", "codex"] }) });
  assert.equal(result.code, 6);
  assert.match(capture.text(), /NO CANDIDATE SURVIVED/);
  assert.match(capture.text(), /opencode p\/m: opencode is not on PATH; remedy: install opencode/);
  assert.match(capture.text(), /codex gpt-x: codex is not on PATH; remedy: install codex/);
  assert.equal(taskStatus(airlock, "T001"), "todo");
  assert.equal(readJsonl(dir).some((entry) => entry.op === "airlock-start"), false);
  assert.equal(existsSync(path.join(dir, "tasks", "T001.json")), false, "no record was persisted");
});

test("a pre-start skip is budget-free: the chain continues into the next candidate", async (t) => {
  const { herdr, dir, run } = await setup(t);
  const result = await run({ probes: fakeProbes({ missing: ["opencode"] }) });
  assert.equal(result.code, 0);
  const record = readRecord(dir, "T001");
  assert.equal(record.executor, "claude", "the chain legitimately continues into a claude candidate that needs no opencode artifact");
  assert.equal(record.pin.candidateIndex, 2, "both opencode candidates were skipped");
  assert.equal(record.pin.advanceCount, 0, "skips launched nothing and cost nothing");
  assert.equal(record.pin.failures.length, 2);
  assert.ok(record.pin.failures.every((entry) => entry.fromAttempt === null && entry.class === "executor-missing"));
  assert.equal(herdr.calls.find((call) => call.method === "agentStart").args.kind, "claude");
});

test("workflow lock contention exits 69 having read and written nothing", async (t) => {
  const { dir, run, capture } = await setup(t);
  const lock = acquireWorkflowLock(dir, { pid: process.pid, hostname: (await import("node:os")).hostname() });
  const opsBefore = readJsonl(dir).length;
  const result = await run();
  assert.equal(result.code, 69);
  assert.match(capture.text(), /^LOCKED by pid \d+ since .*; re-run when it finishes$/m);
  assert.equal(readJsonl(dir).length, opsBefore, "nothing was read or written");
  lock.release();
});

test("a stale lock (dead pid) is taken over and dispatch proceeds", async (t) => {
  const { dir, run } = await setup(t);
  acquireWorkflowLock(dir, { pid: 999999, hostname: (await import("node:os")).hostname(), isAlive: () => true });
  const result = await run({ lockOptions: { isAlive: (pid) => pid !== 999999 } });
  assert.equal(result.code, 0);
  assert.ok(readJsonl(dir).some((entry) => entry.op === "lock-takeover"));
});

test("a launch-pending record is resumed with the same candidate — never a fresh advance", async (t) => {
  const { airlock, herdr, dir, run, root, planPath, configDir } = await setup(t);
  assert.equal((await run()).code, 0);
  // Simulate a crash after an advance write but before the pane existed.
  const record = readRecord(dir, "T001");
  record.state = "launch-pending";
  record.attempt = 2;
  record.agentName = "al-t001-a2";
  record.paneId = null;
  record.workspaceId = null;
  record.promptAttemptedAt = null;
  record.pin.candidateIndex = 1;
  record.pin.advanceCount = 1;
  const { writeRecord } = await import("../src/state.mjs");
  writeRecord(dir, record, { op: "record-state", outcome: "launch-pending", detail: "test: simulated crash after advance" });
  const capture = outCapture();
  const result = await dispatch({ session: "test-session", repoRoot: root, planPath, stateDir: path.join(root, ".git", "airlock-test", "herdr-state"), configDir, timeoutMs: 5000, airlock, herdr, probes: fakeProbes(), env: {}, out: capture.out, exit: () => {} });
  assert.equal(result.code, 0);
  assert.match(capture.text(), /RESUMING T001 · launch-pending attempt 2 · candidate 2\/3/);
  const resumed = readRecord(dir, "T001");
  assert.equal(resumed.attempt, 2, "the same recorded attempt was launched");
  assert.equal(resumed.pin.candidateIndex, 1, "the same recorded candidate, never a further advance");
  assert.equal(resumed.pin.advanceCount, 1, "a crash loop can never burn the advance budget");
  assert.equal(resumed.state, "needs-reconcile");
  const start = herdr.calls.filter((call) => call.method === "agentStart").at(-1);
  assert.deepEqual(start.args.agentArgs, ["--agent", "airlock-builder", "-m", "test/model-fallback"]);
  assert.equal(readJsonl(dir).filter((entry) => entry.op === "airlock-next").length, 1, "resume does not re-run next");
});

test("a recordVersion 1 record on disk refuses dispatch (fail closed rather than migrate)", async (t) => {
  const { dir, run, capture } = await setup(t);
  const legacy = createRecord({ workflowKey: "k", repoRoot: "/r", planPath: "/r/p.json", sessionName: "s", taskId: "T001", executor: "opencode", agent: "airlock-builder", pin: null, taskText: "x", dispatchPath: "A-interactive", state: "needs-reconcile" });
  legacy.recordVersion = 1;
  const { writeRecord } = await import("../src/state.mjs");
  writeRecord(dir, legacy, { op: "record-create" });
  const result = await run();
  assert.equal(result.code, 3);
  assert.match(capture.text(), /LEGACY RECORD T001 \(recordVersion 1\)/);
  assert.match(capture.text(), /settle it by hand; the router does not migrate live state/);
});

test("the UPGRADED stderr notice is surfaced verbatim once and the run proceeds", async (t) => {
  const { capture, run, dir } = await setup(t, { plan: basePlanV3([v3Task("T001", ["src/alpha.js"]), v3Task("T002", ["src/beta.js"], [], "critical")]) });
  const result = await run();
  assert.equal(result.code, 0);
  const upgraded = capture.lines.filter((line) => line.startsWith("UPGRADED plan schema airlock.plan/v3 -> airlock.plan/v4"));
  assert.equal(upgraded.length, 1, "surfaced once, then ignored");
  assert.equal(readRecord(dir, "T001").state, "needs-reconcile");
});

test("an unexpected exception mid-launch leaves a reconcilable record and exits 70", async (t) => {
  const { dir, run, capture, herdr } = await setup(t);
  herdr.state.failOn = { method: "agentPrompt", error: new Error("herdr client exploded unexpectedly") };
  const result = await run();
  assert.equal(result.code, 70);
  assert.match(capture.text(), /DISPATCH INTERRUPTED: herdr client exploded unexpectedly/);
  assert.ok(capture.lines.includes("RECONCILE T001"));
  assert.equal(readRecord(dir, "T001").state, "needs-reconcile");
});

test("config-and-state separation: dispatch step-1 self-service settles a reopened task and re-dispatches in one call", async (t) => {
  const { airlock, herdr, dir, run, planPath } = await setup(t);
  assert.equal((await run()).code, 0);
  // An answered decision reopened the task: the plan flips back to todo.
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const planTask = plan.tasks.find((entry) => entry.id === "T001");
  planTask.status = "todo";
  planTask.startedAt = null;
  planTask.note = "reopened after D1 changed from a to b";
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const before = readRecord(dir, "T001");
  const result = await run();
  assert.equal(result.code, 0, "answer-driven reopening never dead-ends behind exit 3");
  const record = readRecord(dir, "T001");
  assert.equal(record.attempt, 1);
  assert.notEqual(record.nonce, before.nonce, "a fresh dispatch record replaced the superseded one");
  const ops = readJsonl(dir);
  assert.ok(ops.some((entry) => entry.outcome === "settled:superseded"), "the superseded row settled first");
  assert.equal(readJsonl(dir).filter((entry) => entry.op === "airlock-start").length, 2);
  assert.equal(taskStatus(airlock, "T001"), "doing");
  assert.ok(!herdr.state.panes.has(before.paneId), "the idle pane of the superseded attempt was closed");
});
