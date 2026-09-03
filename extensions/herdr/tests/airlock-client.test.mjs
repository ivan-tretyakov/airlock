import { spawnSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAirlockClient, extractNotices, parseAirlockResult, sanitizeReason } from "../src/airlock-client.mjs";
import { airlockClientFor, airlockScript, assert, basePlanV3, builderTask, makeProject, v3Task } from "./helpers.mjs";

test("next returns {text, task, agent}: task is an id string, agent the static airlock-<role>, no route key", async (t) => {
  const { root, planPath } = await makeProject(t);
  const client = airlockClientFor(root, planPath);
  const result = client.next();
  assert.ok(result.ok, result.error);
  assert.equal(result.exitCode, 0);
  assert.equal(result.value.task, "T001", "next.task is the id string");
  assert.equal(result.value.agent, "airlock-builder");
  assert.equal("route" in result.value, false, "no route object exists in 4.0");
  assert.match(result.value.text, /^TASK T001 · builder\n/);
  assert.match(result.value.text, /^GOAL  /m);
  assert.match(result.value.text, /^AGENT airlock-builder$/m);
  assert.match(result.value.text, /^RULES /m);
  assert.ok(!/^ROUTE /m.test(result.value.text) && !/^FALLBACK /m.test(result.value.text) && !/^CLOCK OVERRIDE/m.test(result.value.text));
});

test("start returns the full task object and the same static agent; the mismatch check uses agent fields", async (t) => {
  const { root, planPath } = await makeProject(t);
  const client = airlockClientFor(root, planPath);
  const offered = client.next();
  const started = client.start(offered.value.task);
  assert.ok(started.ok, started.error);
  assert.equal(typeof started.value.task, "object", "start.task is the full task object, unlike next.task");
  assert.equal(started.value.task.id, "T001");
  assert.equal(started.value.agent, offered.value.agent);
  assert.match(started.value.text, /^STARTED T001\nAGENT airlock-builder$/);
  assert.ok(!started.value.text.includes("GOAL"), "start never re-emits the brief");
});

test("status returns {text, plan} with no routes key; tasks carry expensive instead of risk", async (t) => {
  const { root, planPath } = await makeProject(t, [builderTask("T001", ["src/alpha.js"], [], { expensive: true })]);
  const client = airlockClientFor(root, planPath);
  const status = client.status();
  assert.ok(status.ok);
  assert.equal("routes" in status.value, false, "a present routes key would mean a 3.x CLI");
  const task = status.value.plan.tasks.find((entry) => entry.id === "T001");
  assert.equal(task.expensive, true);
  assert.equal("risk" in task, false);
});

test("no --host is passed anywhere and CLAUDE_CODE_SUBAGENT_MODEL is stripped", async (t) => {
  const { root, planPath } = await makeProject(t);
  const echo = path.join(root, ".git", "echo-argv.mjs");
  await writeFile(echo, "console.log(JSON.stringify({ argv: process.argv.slice(2), env: Boolean(process.env.CLAUDE_CODE_SUBAGENT_MODEL) }));\n");
  await chmod(echo, 0o755);
  const client = createAirlockClient({ repoRoot: root, planPath, bin: process.execPath, binArgs: [echo], env: { ...process.env, CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } });
  for (const result of [client.next(), client.start("T001"), client.status(), client.audit("T001"), client.done("T001", "e"), client.block("T001", "r")]) {
    assert.ok(result.ok);
    assert.equal(result.value.argv.includes("--host"), false);
    assert.ok(result.value.argv.includes("--json"));
    assert.equal(result.value.env, false, "CLAUDE_CODE_SUBAGENT_MODEL never reaches the child");
  }
  assert.equal("CLAUDE_CODE_SUBAGENT_MODEL" in client.buildEnv(), false);
  assert.equal(typeof client.fallback, "undefined", "there is no airlock fallback verb in 4.0");
});

test("a v3 plan: UPGRADED notice arrives on stderr as a tolerated notice; payload parses from stdout with upgraded: true", async (t) => {
  const { root, planPath } = await makeProject(t, [], { plan: basePlanV3([v3Task("T001", ["src/alpha.js"]), v3Task("T002", ["src/beta.js"], [], "critical")]) });
  const client = airlockClientFor(root, planPath);
  const next = client.next();
  assert.ok(next.ok, next.error);
  assert.equal(next.value.upgraded, true);
  assert.equal(next.value.task, "T001");
  assert.equal(next.notices.length, 1);
  assert.match(next.notices[0], /^UPGRADED plan schema airlock\.plan\/v3 -> airlock\.plan\/v4 \(risk: critical -> expensive on T002\)$/);
  const status = client.status();
  assert.equal(status.value.plan.tasks.find((entry) => entry.id === "T002").expensive, true);
});

test("error branch: failures carry the error string and airlock's own exit code", async (t) => {
  const { root, planPath } = await makeProject(t);
  const client = airlockClientFor(root, planPath);
  const unknown = client.start("T999");
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown task: T999/);
  assert.equal(unknown.exitCode, 1);
});

test("next --unattended with an open blocking decision: exit 2, PARKED", async (t) => {
  const { root, planPath } = await makeProject(t);
  const ask = spawnAirlock(root, planPath, ["ask", "T001", "Which database?", "--options", "postgres|sqlite", "--blocking", "--case", "irreversible"]);
  assert.equal(ask.status, 0, ask.stdout + ask.stderr);
  const client = airlockClientFor(root, planPath);
  const parked = client.next({ unattended: true });
  assert.equal(parked.ok, false);
  assert.match(parked.error, /^PARKED: D1$/);
  assert.equal(parked.exitCode, 2);
});

test("audit/done/block keep their shapes against the real 4.0 CLI", async (t) => {
  const { root, planPath } = await makeProject(t, [builderTask("T001", ["src/alpha.js"]), builderTask("T002", ["src/beta.js"])]);
  const client = airlockClientFor(root, planPath);
  assert.ok(client.start("T001").ok);
  await writeFile(path.join(root, "src", "alpha.js"), "module.exports = 1;\n");
  const clean = client.audit("T001");
  assert.ok(clean.ok, clean.error);
  assert.deepEqual(clean.value.outOfScope, []);
  await writeFile(path.join(root, "forbidden.txt"), "nope\n");
  const failed = client.audit("T001");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /OUT OF SCOPE/);
  const rmResult = spawnSync("rm", [path.join(root, "forbidden.txt")]);
  assert.equal(rmResult.status, 0);
  const completed = client.done("T001", "test -f src/alpha.js: ok");
  assert.ok(completed.ok, completed.error);
  assert.match(completed.value.text, /^DONE T001 [0-9a-f]{40}$/);
  const log = spawnSync("git", ["-C", root, "log", "-1", "--format=%B"], { encoding: "utf8" }).stdout;
  assert.match(log, /Airlock-Task: T001/);
  const next = client.next();
  assert.equal(next.value.task, "T002");
  assert.ok(client.start("T002").ok);
  const blocked = client.block("T002", "worker waiting on credentials");
  assert.ok(blocked.ok);
  assert.match(blocked.value.text, /^BLOCKED T002: worker waiting on credentials/);
});

test("nothing-to-do shape: task null and agent null with NOTHING TO DO text", async (t) => {
  const { root, planPath } = await makeProject(t, [builderTask("T001", ["src/alpha.js"])]);
  const client = airlockClientFor(root, planPath);
  assert.ok(client.start("T001").ok);
  await writeFile(path.join(root, "src", "alpha.js"), "module.exports = 1;\n");
  assert.ok(client.done("T001", "test -f src/alpha.js: ok").ok);
  const next = client.next();
  assert.equal(next.value.task, null);
  assert.equal(next.value.agent, null);
  assert.match(next.value.text, /^NOTHING TO DO\nAll tasks are done\.$/);
});

test("sanitizeReason strips newlines, caps length, and redacts tokenized URLs", () => {
  const long = "x".repeat(500);
  assert.equal(sanitizeReason("a\nb\r\n  c").includes("\n"), false);
  assert.ok(sanitizeReason(long).length <= 300);
  const redacted = sanitizeReason("failed https://api.example.com/v1?token=supersecret&id=1 call");
  assert.ok(!redacted.includes("supersecret"));
});

test("parseAirlockResult: stdout is the JSON channel; stderr is log noise carrying notices", () => {
  const withNotice = parseAirlockResult({ verb: "next", stdout: '{"text": "hi", "upgraded": true}', stderr: "UPGRADED plan schema airlock.plan/v3 -> airlock.plan/v4\n", status: 0 });
  assert.equal(withNotice.ok, true);
  assert.equal(withNotice.value.text, "hi");
  assert.deepEqual(withNotice.notices, ["UPGRADED plan schema airlock.plan/v3 -> airlock.plan/v4"]);
  const errorCase = parseAirlockResult({ verb: "next", stdout: '{"error": "boom"}', stderr: "", status: 1 });
  assert.equal(errorCase.ok, false);
  assert.equal(errorCase.error, "boom");
  const errorWithZeroStatus = parseAirlockResult({ verb: "next", stdout: '{"error": "boom"}', stderr: "", status: 0 });
  assert.equal(errorWithZeroStatus.exitCode, 1);
  const unparseable = parseAirlockResult({ verb: "status", stdout: "not json", stderr: "UPGRADED x\n", status: 1 });
  assert.equal(unparseable.ok, false);
  assert.match(unparseable.error, /unparseable/);
  const enoent = parseAirlockResult({ verb: "next", stdout: "", stderr: "", status: null, spawnError: { code: "ENOENT", message: "spawn airlock ENOENT" } });
  assert.match(enoent.error, /not found/);
  assert.deepEqual(extractNotices("noise\nUPGRADED a -> b\nmore"), ["UPGRADED a -> b"]);
});

function spawnAirlock(root, planPath, args) {
  return spawnSync(process.execPath, [airlockScript, ...args, "--json", "--plan", planPath], { cwd: root, encoding: "utf8", env: process.env });
}
