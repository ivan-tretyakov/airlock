import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ownsPath, upgradePlan, validatePlan } from "./airlock.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "airlock.mjs");
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGED_31_SHIM_HASH = "9201872f0c11c80d2a76b90bd14afc911943f7cf2923bd4212798a07eaba6e8e";

function task(id, overrides = {}) {
  return { id, title: id, role: "builder", owns: [`src/${id}.js`], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null, ...overrides };
}

function basePlan(tasks = [], schema = "airlock.plan/v4") {
  return {
    schema,
    goal: "Airlock plan behavior is testable",
    done: ["node --test scripts/airlock.test.mjs passes"],
    nonGoals: [],
    created: "2026-08-20T09:00:00.000Z",
    budget: { maxTasks: 8, maxExpensive: 2 },
    tasks,
    decisions: [],
  };
}

function v3Plan(tasks = []) {
  return basePlan(tasks, "airlock.plan/v3");
}

async function bareProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "--initial-branch=main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "airlock@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Airlock Test"]);
  return root;
}

async function project(t, plan = basePlan()) {
  const root = await bareProject(t);
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(root, "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
}

async function readPlanFile(root) {
  return JSON.parse(await readFile(path.join(root, "airlock.plan.json"), "utf8"));
}

async function writePlanFile(root, plan) {
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
}

function contentHash(value) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

test("owns supports exact paths, directories, and globs", () => {
  assert.equal(ownsPath(["src/a.js"], "src/a.js"), true);
  assert.equal(ownsPath(["src/"], "src/nested/a.js"), true);
  assert.equal(ownsPath(["src/**/*.test.js"], "src/nested/a.test.js"), true);
  assert.equal(ownsPath(["src/*.js"], "src/nested/a.js"), false);
});

test("owns folds case on case-insensitive hosts", { skip: !["win32", "darwin"].includes(process.platform) }, () => {
  assert.equal(ownsPath(["src/a.js"], "src/A.js"), true);
  assert.equal(ownsPath(["Src/A.js"], "src/a.js"), true);
});

test("schema rejects cycles, missing evidence, and blocking doing tasks", () => {
  assert.throws(() => validatePlan(basePlan([task("T1", { dependsOn: ["T2"] }), task("T2", { dependsOn: ["T1"] })])), /cycle/);
  assert.throws(() => validatePlan(basePlan([task("T1", { status: "done" })])), /requires evidence/);
});

test("v4 schema governs expensive, residual risk, and task model", () => {
  assert.doesNotThrow(() => validatePlan(basePlan([task("T1", { expensive: true })])));
  assert.doesNotThrow(() => validatePlan(basePlan([task("T1", { expensive: false })])));
  assert.throws(() => validatePlan(basePlan([task("T1", { expensive: "yes" })])), /task T1 expensive must be a boolean/);
  assert.throws(() => validatePlan(basePlan([task("T1", { risk: "critical" })])), /task T1 risk was removed in v4; use expensive: true for critical-cost tasks/);
  assert.throws(() => validatePlan(basePlan([task("T1", { model: "sonnet" })])), /task T1 model is not supported; model choice belongs to the host agent files/);
});

test("upgradePlan maps every v3 risk level and rejects a premature expensive field", () => {
  const plan = v3Plan([
    task("T1", { risk: "light" }),
    task("T2", { risk: "standard" }),
    task("T3", { risk: "complex" }),
    task("T4", { risk: "critical" }),
  ]);
  const { plan: upgraded, upgraded: didUpgrade, mapped } = upgradePlan(plan);
  assert.equal(didUpgrade, true);
  assert.equal(upgraded.schema, "airlock.plan/v4");
  assert.deepEqual(mapped, ["T4"]);
  for (const item of upgraded.tasks) assert.equal("risk" in item, false);
  for (const id of ["T1", "T2", "T3"]) assert.equal("expensive" in upgraded.tasks.find((item) => item.id === id), false);
  assert.equal(upgraded.tasks.find((item) => item.id === "T4").expensive, true);
  assert.doesNotThrow(() => validatePlan(upgraded));

  assert.throws(() => upgradePlan(v3Plan([task("T1", { risk: "standard", expensive: true })])), /task T1 has both risk and expensive; a v3 plan must not carry expensive/);

  const v4 = basePlan([task("T1")]);
  const passthrough = upgradePlan(v4);
  assert.equal(passthrough.upgraded, false);
  assert.equal(passthrough.plan, v4);
});

test("v2 and unknown plan schemas fail closed", async (t) => {
  const root = await project(t, basePlan([task("T1")], "airlock.plan/v2"));
  const v2 = run(root, ["next"]);
  assert.equal(v2.status, 1);
  assert.match(v2.stderr, /plan schema must be airlock\.plan\/v4/);
  await writePlanFile(root, basePlan([task("T1")], "airlock.plan/v9"));
  const unknown = run(root, ["next"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /plan schema must be airlock\.plan\/v4/);
});

test("UPGRADED notice goes to stderr, keeps stdout intact, and read-only commands never persist", async (t) => {
  const root = await project(t, v3Plan([task("T1", { risk: "standard" })]));
  for (const attempt of [1, 2]) {
    const next = run(root, ["next"]);
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stderr, /^UPGRADED plan schema airlock\.plan\/v3 -> airlock\.plan\/v4\n/, `attempt ${attempt}`);
    assert.doesNotMatch(next.stderr, /risk: critical/);
    assert.match(next.stdout, /^TASK T1 · builder\n/);
    assert.match(next.stdout, /AGENT airlock-builder/);
    assert.equal((await readPlanFile(root)).schema, "airlock.plan/v3");
  }
  const status = run(root, ["status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stderr, /^UPGRADED plan schema/);
  assert.equal((await readPlanFile(root)).schema, "airlock.plan/v3");
});

test("UPGRADED notice names critical tasks only when one mapped", async (t) => {
  const root = await project(t, v3Plan([task("T1", { risk: "critical" }), task("T2", { risk: "light" })]));
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stderr, /^UPGRADED plan schema airlock\.plan\/v3 -> airlock\.plan\/v4 \(risk: critical -> expensive on T1\)\n/);
});

test("json mode reports upgraded: true in one valid stdout document", async (t) => {
  const root = await project(t, v3Plan([task("T1", { risk: "standard" })]));
  const next = run(root, ["next", "--json"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stderr, /^UPGRADED plan schema/);
  const json = JSON.parse(next.stdout);
  assert.equal(json.upgraded, true);
  assert.equal(json.task, "T1");
  assert.equal(json.agent, "airlock-builder");
  assert.equal("route" in json, false);
  const status = run(root, ["status", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.upgraded, true);
  assert.equal("routes" in statusJson, false);
});

test("the UPGRADED notice precedes the PARKED error under --unattended", async (t) => {
  const plan = v3Plan([task("T1", { risk: "standard" })]);
  plan.decisions.push({ id: "D1", question: "Deploy now", options: ["yes", "no"], recommendation: "yes", mode: "block", assumed: null, blocks: ["T1"], consumedBy: [], status: "open", answer: null, case: "external" });
  const root = await project(t, plan);
  const next = run(root, ["next", "--unattended"]);
  assert.equal(next.status, 2);
  assert.match(next.stderr, /UPGRADED plan schema airlock\.plan\/v3 -> airlock\.plan\/v4[\s\S]*PARKED: D1/);
});

test("a state-mutating command persists the upgraded v4 plan", async (t) => {
  const root = await project(t, v3Plan([task("T1", { risk: "critical" })]));
  const start = run(root, ["start", "T1"]);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /^STARTED T1\nAGENT airlock-builder\n/);
  const plan = await readPlanFile(root);
  assert.equal(plan.schema, "airlock.plan/v4");
  assert.equal("risk" in plan.tasks[0], false);
  assert.equal(plan.tasks[0].expensive, true);
});

test("a mid-doing v3 task resumes and persists as v4 with no router artifacts", async (t) => {
  const root = await project(t, v3Plan([task("T1", { risk: "standard", status: "doing", startedAt: "2026-08-24T07:00:00.000Z" })]));
  const start = run(root, ["start", "T1"]);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /^STARTED T1 \(resume\)\nAGENT airlock-builder\n/);
  assert.match(start.stderr, /^UPGRADED plan schema/);
  const plan = await readPlanFile(root);
  assert.equal(plan.schema, "airlock.plan/v4");
  assert.equal("risk" in plan.tasks[0], false);
});

test("init refuses an empty done criterion", async (t) => {
  const root = await project(t);
  const result = run(root, ["init", "A delivery", "--plan", "new-airlock.plan.json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /done criterion/);
});

test("CLI entry point runs through a linked package directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linked = path.join(root, "airlock");
  await symlink(packageRoot, linked, process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(process.execPath, [path.join(linked, "scripts", "airlock.mjs"), "help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: airlock/);
});

test("init state does not poison the first task boundary", async (t) => {
  const root = await bareProject(t);
  await writeFile(path.join(root, "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "baseline.txt"]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  assert.equal(run(root, ["init", "A delivery", "--done", "test passes"]).status, 0);
  const plan = await readPlanFile(root);
  assert.equal(plan.schema, "airlock.plan/v4");
  plan.tasks.push(task("T1", { title: "First task" }));
  await writePlanFile(root, plan);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("OpenCode bootstrap installs the command and static role agents without replacing the plan", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Bootstrap" })]));
  const before = await readFile(path.join(root, "airlock.plan.json"), "utf8");
  const result = run(root, ["init", "--host", "opencode"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(root, "airlock.plan.json"), "utf8"), before);
  const shim = await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8");
  assert.match(shim, /airlock next/);
  assert.match(shim, /AGENT airlock-/);
  for (const role of ["builder", "checker", "browser"]) {
    const agent = await readFile(path.join(root, ".opencode", "agent", `airlock-${role}.md`), "utf8");
    assert.match(agent, /mode: subagent/);
    assert.doesNotMatch(agent, /^model:/m);
    assert.doesNotMatch(agent, /^variant:/m);
    assert.doesNotMatch(agent, /^tools:/m);
    if (role === "builder") assert.doesNotMatch(agent, /permission:/);
    else assert.match(agent, /permission:\n  edit: deny/);
  }
  assert.match(await readFile(path.join(root, ".opencode", "agent", "airlock-builder.md"), "utf8"), /Implement only the printed task/);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("re-running init preserves a customized OpenCode agent file", async (t) => {
  const root = await project(t, basePlan([task("T1")]));
  assert.equal(run(root, ["init", "--host", "opencode"]).status, 0);
  const agentPath = path.join(root, ".opencode", "agent", "airlock-builder.md");
  await writeFile(agentPath, "---\nmodel: my/custom-model\nmode: subagent\n---\n\ncustom body\n");
  const again = run(root, ["init", "--host", "opencode"]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(await readFile(agentPath, "utf8"), /my\/custom-model/);
});

test("OpenCode bootstrap auto-upgrades only unmodified packaged command shims", async (t) => {
  const root = await project(t, basePlan([task("T1")]));
  const commandDir = path.join(root, ".opencode", "command");
  const commandPath = path.join(commandDir, "airlock.md");
  await mkdir(commandDir, { recursive: true });
  const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
  const packaged31 = await readFile(path.join(fixtures, "opencode-command-3.1.0-packaged.md"), "utf8");
  assert.equal(contentHash(packaged31), PACKAGED_31_SHIM_HASH, "fixture must hold the real packaged 3.1 shim bytes");
  for (const legacy of ["opencode-command-3.1.0.md", "opencode-command-3.1.0-fallback.md", "opencode-command-3.1.0-packaged.md"]) {
    await writeFile(commandPath, await readFile(path.join(fixtures, legacy), "utf8"));
    const upgraded = run(root, ["init", "--host", "opencode"]);
    assert.equal(upgraded.status, 0, upgraded.stderr);
    const content = await readFile(commandPath, "utf8");
    assert.match(content, /AGENT airlock-/, legacy);
    assert.match(content, /airlock#v4\.0\.0/, legacy);
    assert.doesNotMatch(content, /--host/, legacy);
  }

  const customizedCurrent = `${await readFile(commandPath, "utf8")}\nProject-specific note.\n`;
  await writeFile(commandPath, customizedCurrent);
  const preserved = run(root, ["init", "--host", "opencode"]);
  assert.equal(preserved.status, 0, preserved.stderr);
  assert.equal(await readFile(commandPath, "utf8"), customizedCurrent);

  await writeFile(commandPath, "custom stale command\n");
  const custom = run(root, ["init", "--host", "opencode"]);
  assert.equal(custom.status, 1);
  assert.match(custom.stderr, /merge the current packaged command manually/);
  assert.equal(await readFile(commandPath, "utf8"), "custom stale command\n");
});

test("next, start, audit, and done create an audited task commit", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Write owned feature", owns: ["src/feature.js"], acceptance: "node --test passes" })]));
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T1 · builder/);
  assert.match(next.stdout, /AGENT airlock-builder/);
  assert.doesNotMatch(next.stdout, /ROUTE |FALLBACK/);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.js"), "export const feature = true;\n");
  const audit = run(root, ["audit", "T1"]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /src\/feature.js/);
  const done = run(root, ["done", "T1", "--evidence", "node --test: pass"]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(execFileSync("git", ["-C", root, "log", "-1", "--format=%B"], { encoding: "utf8" }), /Airlock-Task: T1/);
  assert.equal((await readPlanFile(root)).tasks[0].status, "done");
});

test("--host is accepted and ignored on non-init commands", async (t) => {
  const root = await project(t, basePlan([task("T1")]));
  const next = run(root, ["next", "--host", "opencode"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T1 · builder/);
  assert.equal(run(root, ["start", "T1", "--host", "opencode"], { AIRLOCK_HOST: "bogus" }).status, 0);
  assert.equal(run(root, ["status", "--host", "claude"]).status, 0);
});

test("render --md replaces the route column with the role", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Write owned feature" })]));
  const render = run(root, ["render", "--md"]);
  assert.equal(render.status, 0, render.stderr);
  assert.match(render.stdout, /\| ID \| Task \| State \| Role \|/);
  assert.match(render.stdout, /\| T1 \| Write owned feature \| todo \| builder \|/);
  assert.doesNotMatch(render.stdout, /Route/);
});

test("audit catches a shell-created out-of-scope path", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Scoped edit", owns: ["src/owned.txt"], acceptance: "file exists" })]));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  execFileSync(process.platform === "win32" ? "powershell" : "sh", process.platform === "win32"
    ? ["-NoProfile", "-Command", "New-Item -ItemType Directory -Force src | Out-Null; Set-Content src/owned.txt ok; Set-Content package.json outside"]
    : ["-c", "mkdir -p src; echo ok > src/owned.txt; echo outside > package.json"], { cwd: root });
  const audit = run(root, ["audit", "T1"]);
  assert.equal(audit.status, 1);
  assert.match(audit.stderr, /OUT OF SCOPE/);
  assert.match(audit.stderr, /package.json/);
});

test("blocking a failed task preserves its delta and releases the next task", async (t) => {
  const root = await project(t, basePlan(["T1", "T2"].map((id) => task(id))));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "STRAY.md"), "preserve me\n");
  assert.equal(run(root, ["block", "T1", "--reason", "scope error"]).status, 0);
  const plan = await readPlanFile(root);
  assert.match(plan.tasks[0].note, /refs\/airlock\/blocked\/T1/);
  assert.equal(run(root, ["start", "T2"]).status, 0);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).includes("STRAY.md"), false);
});

test("Airlock recovery preserves the user's stash stack", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Preserve stash", owns: ["src/a.js"] })]));
  for (const name of ["USER-WIP-1", "USER-WIP-2"]) {
    await writeFile(path.join(root, `${name}.txt`), `${name}\n`);
    execFileSync("git", ["-C", root, "stash", "push", "--include-untracked", "--message", name]);
  }
  const before = execFileSync("git", ["-C", root, "stash", "list"], { encoding: "utf8" });
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "AUDIT-STRAY.md"), "preserve\n");
  assert.equal(run(root, ["audit", "T1", "--revert-out-of-scope"]).status, 0);
  assert.equal(execFileSync("git", ["-C", root, "stash", "list"], { encoding: "utf8" }), before);
  await writeFile(path.join(root, "STRAY.md"), "preserve\n");
  assert.equal(run(root, ["block", "T1", "--reason", "scope error"]).status, 0);
  assert.equal(execFileSync("git", ["-C", root, "stash", "list"], { encoding: "utf8" }), before);
});

test("blocking a parallel task leaves other lanes untouched", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "A", owns: ["a/"] }), task("T2", { title: "B", owns: ["b/"] })]));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
  await mkdir(path.join(root, "a"));
  await mkdir(path.join(root, "b"));
  await writeFile(path.join(root, "a", "f.js"), "a\n");
  await writeFile(path.join(root, "b", "f.js"), "b\n");
  await writeFile(path.join(root, "STRAY.md"), "stray\n");
  assert.equal(run(root, ["block", "T1", "--reason", "scope error"]).status, 0);
  assert.equal((await readFile(path.join(root, "b", "f.js"), "utf8")), "b\n");
  const ref = (await readPlanFile(root)).tasks[0].note.match(/(refs\/airlock\/blocked\/T1\/\d+)/)?.[1];
  assert.ok(ref);
  const recovered = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", `${ref}^3`], { encoding: "utf8" });
  assert.match(recovered, /a\/f\.js/);
  assert.match(recovered, /STRAY.md/);
  assert.doesNotMatch(recovered, /b\/f\.js/);
});

test("auditing one parallel task leaves foreign lane paths untouched", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "A", owns: ["a/"] }), task("T2", { title: "B", owns: ["b/"] })]));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
  await mkdir(path.join(root, "b"));
  await writeFile(path.join(root, "b", "f.js"), "b\n");
  const audit = run(root, ["audit", "T1", "--revert-out-of-scope"]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /FOREIGN[\s\S]*b\/f\.js/);
  assert.equal((await readFile(path.join(root, "b", "f.js"), "utf8")), "b\n");
});

test("failed task commit restores the doing state", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Commit failure", owns: ["src/a.js"] })]));
  await writeFile(path.join(root, ".git", "hooks", "pre-commit"), process.platform === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n");
  if (process.platform !== "win32") execFileSync("chmod", ["+x", path.join(root, ".git", "hooks", "pre-commit")]);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.js"), "x\n");
  assert.equal(run(root, ["done", "T1", "--evidence", "pass"]).status, 1);
  assert.equal((await readPlanFile(root)).tasks[0].status, "doing");
});

test("checker uses the exact dependency trailer and excludes plan churn", async (t) => {
  const root = await project(t, basePlan([task("T1"), task("T10"), task("T2", { role: "checker", dependsOn: ["T1"] })]));
  for (const id of ["T1", "T10"]) {
    assert.equal(run(root, ["start", id]).status, 0);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", `${id}.js`), `${id}\n`);
    assert.equal(run(root, ["done", id, "--evidence", `ev-${id}`]).status, 0);
  }
  const next = run(root, ["next"]);
  assert.match(next.stdout, /AGENT airlock-checker/);
  assert.match(next.stdout, /DIFF T1[\s\S]*T1/);
  assert.doesNotMatch(next.stdout, /DIFF T1[\s\S]*T10/);
  assert.doesNotMatch(next.stdout, /airlock\.plan\.json/);
});

test("audit recovery stashes untracked paths instead of deleting them", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Recover", owns: ["src/a.js"] })]));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "scratch.md"), "keep\n");
  const audit = run(root, ["audit", "T1", "--revert-out-of-scope"]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /RECOVERY refs\/airlock\/reverted/);
  const recovery = audit.stdout.match(/RECOVERY (refs\/airlock\/reverted\/worktree\/\d+)/)?.[1];
  assert.ok(recovery);
  assert.equal(execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", `${recovery}^3`], { encoding: "utf8" }).includes("scratch.md"), true);
});

test("assumptions are consumed and an overturned answer reopens work", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Choose behavior", owns: ["src/a.js"] })]));
  const ask = run(root, ["ask", "T1", "Choose mode", "--options", "read-only|editable", "--assume", "read-only"]);
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  let plan = await readPlanFile(root);
  plan.tasks[0].status = "done";
  plan.tasks[0].evidence = ["test passes"];
  await writePlanFile(root, plan);
  const answer = run(root, ["answer", "D1", "editable"]);
  assert.equal(answer.status, 1);
  assert.match(answer.stderr, /REWORK REQUIRED: T1/);
  plan = await readPlanFile(root);
  assert.equal(plan.tasks[0].status, "todo");
  assert.deepEqual(plan.tasks[0].evidence, []);
});

test("blocking decisions park only their dependent task", async (t) => {
  const root = await project(t, basePlan(["T1", "T2"].map((id) => task(id))));
  assert.equal(run(root, ["ask", "T1", "Deploy now", "--options", "yes|no", "--blocking", "--case", "external"]).status, 0);
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T2/);
  assert.match(run(root, ["status"]).stdout, /NEEDS YOU/);
});

test("unattended next parks blocking decisions without dispatching", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "Wait" })]));
  assert.equal(run(root, ["ask", "T1", "Deploy", "--options", "yes|no", "--blocking", "--case", "external"]).status, 0);
  const next = run(root, ["next", "--unattended"]);
  assert.equal(next.status, 2);
  assert.match(next.stderr, /PARKED: D1/);
});

test("goal-level blocking decisions do not require a task", async (t) => {
  const root = await project(t);
  const result = run(root, ["ask", "Is the goal testable", "--options", "yes|no", "--blocking", "--case", "goal"]);
  assert.equal(result.status, 0, result.stderr);
  const decision = (await readPlanFile(root)).decisions[0];
  assert.deepEqual(decision.blocks, []);
  assert.equal(decision.case, "goal");
  assert.match(run(root, ["next"]).stdout, /Waiting on D1/);
  assert.match(run(root, ["status"]).stdout, /\(blocks goal\)/);
});

test("unborn repositories use normal Airlock boundary behavior", async (t) => {
  const root = await bareProject(t);
  assert.equal(run(root, ["init", "A delivery", "--done", "test passes"]).status, 0);
  const plan = await readPlanFile(root);
  plan.tasks.push(task("T1", { title: "First" }));
  await writePlanFile(root, plan);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("next rejects unrecognised positional input", async (t) => {
  const root = await project(t);
  const result = run(root, ["next", "fix", "the", "login"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no positional arguments/);
});

test("expensive budget parks expensive work while allowing cheap tasks", async (t) => {
  const plan = basePlan([
    task("T1", { title: "Expensive", owns: ["src/critical.js"], expensive: true }),
    task("T2", { title: "Cheap", owns: ["src/light.js"] }),
  ]);
  plan.budget.maxExpensive = 0;
  const root = await project(t, plan);
  assert.match(run(root, ["next"]).stdout, /TASK T2/);
  plan.tasks[1].status = "done";
  plan.tasks[1].evidence = ["pass"];
  await writePlanFile(root, plan);
  assert.match(run(root, ["next"]).stdout, /BUDGET REACHED: maxExpensive/);
});

test("an explicit expensive: false is not counted against the budget", async (t) => {
  const plan = basePlan([task("T1", { expensive: false })]);
  plan.budget.maxExpensive = 0;
  const root = await project(t, plan);
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T1 · builder/);
});

test("parallel tasks with disjoint glob prefixes may start together", async (t) => {
  const root = await project(t, basePlan([task("T1", { title: "A", owns: ["src/a*.js"] }), task("T2", { title: "B", owns: ["src/b*.js"] })]));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
});

test("prompt surface contains only the slim roles and two shims", async () => {
  const root = packageRoot;
  const files = [
    ...(await readdir(path.join(root, "commands"))).map((name) => path.join(root, "commands", name)),
    ...(await readdir(path.join(root, "roles"))).map((name) => path.join(root, "roles", name)),
    ...(await readdir(path.join(root, ".opencode", "command"))).map((name) => path.join(root, ".opencode", "command", name)),
  ];
  const bytes = (await Promise.all(files.map((file) => readFile(file, "utf8")))).reduce(
    (sum, text) => sum + Buffer.byteLength(text.replaceAll("\r\n", "\n"), "utf8"),
    0,
  );
  assert.ok(bytes <= 5_000, `prompt surface is ${bytes} bytes; ceiling is 5000`);
  for (const role of ["builder", "checker", "browser"]) {
    const text = await readFile(path.join(root, "roles", `${role}.md`), "utf8");
    const size = Buffer.byteLength(text, "utf8");
    assert.ok(size <= 800, `${role}.md is ${size} bytes; ceiling is 800`);
    assert.match(text, new RegExp(`^name: airlock-${role}$`, "m"));
  }
  for (const command of ["commands/airlock.md", ".opencode/command/airlock.md"]) {
    const text = await readFile(path.join(root, command), "utf8");
    assert.match(text, /unattended/);
    assert.match(text, /AGENT airlock-/);
    assert.doesNotMatch(text, /fallback <id>/);
    assert.doesNotMatch(text, /--class <class>/);
    assert.doesNotMatch(text, /Never fallback after any child result/);
    assert.doesNotMatch(text, /--host/);
  }
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.version, "4.0.0");
  assert.equal(packageJson.repository.url, "git+https://github.com/ivan-tretyakov/airlock.git");
  assert.ok(packageJson.files.includes("scripts/airlock.mjs"));
  assert.ok(packageJson.files.includes("roles"));
  assert.ok(packageJson.files.includes(".opencode/command/airlock.md"));
  const openCodeShim = await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8");
  assert.match(openCodeShim, /npm install --global github:ivan-tretyakov\/airlock#v4\.0\.0/);
  assert.doesNotMatch(openCodeShim, /#v3\.0\.0|#v3\.1\.0/);
  const plugin = JSON.parse(await readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(plugin.version, "4.0.0");
  assert.deepEqual(plugin.agents, ["./roles/builder.md", "./roles/checker.md", "./roles/browser.md"]);
  const marketplace = JSON.parse(await readFile(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.plugins[0].version, "4.0.0");
});
