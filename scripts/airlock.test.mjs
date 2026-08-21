import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ownsPath, validatePlan } from "./airlock.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "airlock.mjs");

function basePlan(tasks = []) {
  return {
    schema: "airlock.plan/v3",
    goal: "Airlock plan behavior is testable",
    done: ["node --test scripts/airlock.test.mjs passes"],
    nonGoals: [],
    created: "2026-08-20T09:00:00.000Z",
    budget: { maxTasks: 8, maxExpensive: 2 },
    tasks,
    decisions: [],
  };
}

async function bareProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "--initial-branch=main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "airlock@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Airlock Test"]);
  return root;
}

function testEnv(root) {
  return {
    AIRLOCK_CONFIG_DIR: path.join(root, ".git", "airlock-test", "config"),
    AIRLOCK_CLAUDE_AGENT_DIR: path.join(root, ".git", "airlock-test", "claude-agents"),
    OPENCODE_CONFIG_DIR: path.join(root, ".git", "airlock-test", "opencode"),
  };
}

function testAgentName(role, route) {
  const slug = `${route.model}-${route.effort}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `airlock-${role}-${slug}.md`;
}

async function installTestRoutes(root, tasks = []) {
  const routes = { version: 1, catalog: { opencode: {} }, claude: {}, opencode: {} };
  for (const host of ["claude", "opencode"]) {
    for (const task of tasks) {
      routes[host][task.role] ??= {};
      const route = routes[host][task.role][task.risk] ?? { model: `test/${host}-${task.role}-${task.risk}`, effort: "medium" };
      routes[host][task.role][task.risk] = route;
      if (host === "opencode") routes.catalog.opencode[route.model] = { variants: ["medium"] };
    }
  }
  await mkdir(path.join(root, ".git", "airlock"), { recursive: true });
  await writeFile(path.join(root, ".git", "airlock", "models.json"), `${JSON.stringify(routes, null, 2)}\n`);
  const env = testEnv(root);
  await mkdir(env.AIRLOCK_CLAUDE_AGENT_DIR, { recursive: true });
  await mkdir(path.join(env.OPENCODE_CONFIG_DIR, "agents"), { recursive: true });
  for (const host of ["claude", "opencode"]) {
    for (const [role, risks] of Object.entries(routes[host])) {
      for (const route of Object.values(risks)) {
        const directory = host === "claude" ? env.AIRLOCK_CLAUDE_AGENT_DIR : path.join(env.OPENCODE_CONFIG_DIR, "agents");
        await writeFile(path.join(directory, testAgentName(role, route)), "generated test agent\n");
      }
    }
  }
}

async function project(t, plan = basePlan()) {
  const root = await bareProject(t);
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(root, "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  await installTestRoutes(root, plan.tasks);
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...testEnv(root), ...env } });
}

async function readPlan(root) {
  return JSON.parse(await readFile(path.join(root, "airlock.plan.json"), "utf8"));
}

async function writeProjectRoutes(root, routes) {
  await writeFile(path.join(root, ".git", "airlock", "models.json"), `${JSON.stringify(routes, null, 2)}\n`);
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
  const task = (id, dependsOn = []) => ({
    id,
    title: id,
    role: "builder",
    risk: "standard",
    owns: [`src/${id}.js`],
    dependsOn,
    acceptance: "test passes",
    status: "todo",
    evidence: [],
    startedAt: null,
    finishedAt: null,
    note: null,
  });
  assert.throws(() => validatePlan(basePlan([task("T1", ["T2"]), task("T2", ["T1"])])), /cycle/);
  const done = task("T1");
  done.status = "done";
  assert.throws(() => validatePlan(basePlan([done])), /requires evidence/);
});

test("init refuses an empty done criterion", async (t) => {
  const root = await project(t);
  const result = run(root, ["init", "A delivery", "--plan", "new-airlock.plan.json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /done criterion/);
});

test("init state does not poison the first task boundary", async (t) => {
  const root = await bareProject(t);
  await writeFile(path.join(root, "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "baseline.txt"]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  assert.equal(run(root, ["init", "A delivery", "--done", "test passes"]).status, 0);
  const plan = await readPlan(root);
  plan.tasks.push({ id: "T1", title: "First task", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null });
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await installTestRoutes(root, plan.tasks);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("OpenCode bootstrap installs a model-neutral command without replacing the plan", async (t) => {
  const task = { id: "T1", title: "Bootstrap", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const before = await readFile(path.join(root, "airlock.plan.json"), "utf8");
  const result = run(root, ["init", "--host", "opencode"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(root, "airlock.plan.json"), "utf8"), before);
  assert.match(await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8"), /airlock next --host opencode/);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("next, start, audit, and done create an audited task commit", async (t) => {
  const task = {
    id: "T1",
    title: "Write owned feature",
    role: "builder",
    risk: "standard",
    owns: ["src/feature.js"],
    dependsOn: [],
    acceptance: "node --test passes",
    status: "todo",
    evidence: [],
    startedAt: null,
    finishedAt: null,
    note: null,
  };
  const root = await project(t, basePlan([task]));
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T1 · builder · test\/claude-builder-standard · medium/);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "src", "feature.js"), "export const feature = true;\n", { encoding: "utf8" }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "feature.js"), "export const feature = true;\n");
  });
  const audit = run(root, ["audit", "T1"]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /src\/feature.js/);
  const done = run(root, ["done", "T1", "--evidence", "node --test: pass"]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(execFileSync("git", ["-C", root, "log", "-1", "--format=%B"], { encoding: "utf8" }), /Airlock-Task: T1/);
  assert.equal((await readPlan(root)).tasks[0].status, "done");
});

test("audit catches a shell-created out-of-scope path", async (t) => {
  const task = {
    id: "T1", title: "Scoped edit", role: "builder", risk: "light", owns: ["src/owned.txt"], dependsOn: [], acceptance: "file exists", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null,
  };
  const root = await project(t, basePlan([task]));
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
  const tasks = ["T1", "T2"].map((id) => ({ id, title: id, role: "builder", risk: "light", owns: [`src/${id}.js`], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null }));
  const root = await project(t, basePlan(tasks));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "STRAY.md"), "preserve me\n");
  assert.equal(run(root, ["block", "T1", "--reason", "scope error"]).status, 0);
  const plan = await readPlan(root);
  assert.match(plan.tasks[0].note, /refs\/airlock\/blocked\/T1/);
  assert.equal(run(root, ["start", "T2"]).status, 0);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).includes("STRAY.md"), false);
});

test("Airlock recovery preserves the user's stash stack", async (t) => {
  const task = { id: "T1", title: "Preserve stash", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
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
  const tasks = [
    { id: "T1", title: "A", role: "builder", risk: "light", owns: ["a/"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
    { id: "T2", title: "B", role: "builder", risk: "light", owns: ["b/"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
  ];
  const root = await project(t, basePlan(tasks));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "a"));
  await mkdir(path.join(root, "b"));
  await writeFile(path.join(root, "a", "f.js"), "a\n");
  await writeFile(path.join(root, "b", "f.js"), "b\n");
  await writeFile(path.join(root, "STRAY.md"), "stray\n");
  assert.equal(run(root, ["block", "T1", "--reason", "scope error"]).status, 0);
  assert.equal((await readFile(path.join(root, "b", "f.js"), "utf8")), "b\n");
  const ref = (await readPlan(root)).tasks[0].note.match(/(refs\/airlock\/blocked\/T1\/\d+)/)?.[1];
  assert.ok(ref);
  const recovered = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", `${ref}^3`], { encoding: "utf8" });
  assert.match(recovered, /a\/f\.js/);
  assert.match(recovered, /STRAY.md/);
  assert.doesNotMatch(recovered, /b\/f\.js/);
});

test("auditing one parallel task leaves foreign lane paths untouched", async (t) => {
  const tasks = [
    { id: "T1", title: "A", role: "builder", risk: "light", owns: ["a/"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
    { id: "T2", title: "B", role: "builder", risk: "light", owns: ["b/"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
  ];
  const root = await project(t, basePlan(tasks));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "b"));
  await writeFile(path.join(root, "b", "f.js"), "b\n");
  const audit = run(root, ["audit", "T1", "--revert-out-of-scope"]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /FOREIGN[\s\S]*b\/f\.js/);
  assert.equal((await readFile(path.join(root, "b", "f.js"), "utf8")), "b\n");
});

test("failed task commit restores the doing state", async (t) => {
  const task = { id: "T1", title: "Commit failure", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  await writeFile(path.join(root, ".git", "hooks", "pre-commit"), process.platform === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n");
  if (process.platform !== "win32") execFileSync("chmod", ["+x", path.join(root, ".git", "hooks", "pre-commit")]);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  await writeFile(path.join(root, "src", "a.js"), "x\n").catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "a.js"), "x\n");
  });
  assert.equal(run(root, ["done", "T1", "--evidence", "pass"]).status, 1);
  assert.equal((await readPlan(root)).tasks[0].status, "doing");
});

test("checker uses the exact dependency trailer and excludes plan churn", async (t) => {
  const task = (id, role = "builder", dependsOn = []) => ({ id, title: id, role, risk: "light", owns: [`src/${id}.js`], dependsOn, acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null });
  const root = await project(t, basePlan([task("T1"), task("T10"), task("T2", "checker", ["T1"])]));
  for (const id of ["T1", "T10"]) {
    assert.equal(run(root, ["start", id]).status, 0);
    const directory = path.join(root, "src");
    await writeFile(path.join(directory, `${id}.js`), `${id}\n`).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(directory);
      await writeFile(path.join(directory, `${id}.js`), `${id}\n`);
    });
    assert.equal(run(root, ["done", id, "--evidence", `ev-${id}`]).status, 0);
  }
  const next = run(root, ["next"]);
  assert.match(next.stdout, /DIFF T1[\s\S]*T1/);
  assert.doesNotMatch(next.stdout, /DIFF T1[\s\S]*T10/);
  assert.doesNotMatch(next.stdout, /airlock\.plan\.json/);
});

test("audit recovery stashes untracked paths instead of deleting them", async (t) => {
  const task = { id: "T1", title: "Recover", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
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
  const task = {
    id: "T1", title: "Choose behavior", role: "builder", risk: "standard", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null,
  };
  const root = await project(t, basePlan([task]));
  const ask = run(root, ["ask", "T1", "Choose mode", "--options", "read-only|editable", "--assume", "read-only"]);
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(run(root, ["start", "T1"]).status, 0);
  let plan = await readPlan(root);
  plan.tasks[0].status = "done";
  plan.tasks[0].evidence = ["test passes"];
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const answer = run(root, ["answer", "D1", "editable"]);
  assert.equal(answer.status, 1);
  assert.match(answer.stderr, /REWORK REQUIRED: T1/);
  plan = await readPlan(root);
  assert.equal(plan.tasks[0].status, "todo");
  assert.deepEqual(plan.tasks[0].evidence, []);
});

test("blocking decisions park only their dependent task", async (t) => {
  const tasks = ["T1", "T2"].map((id) => ({
    id, title: id, role: "builder", risk: "light", owns: [`src/${id}.js`], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null,
  }));
  const root = await project(t, basePlan(tasks));
  assert.equal(run(root, ["ask", "T1", "Deploy now", "--options", "yes|no", "--blocking", "--case", "external"]).status, 0);
  const next = run(root, ["next"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /TASK T2/);
  assert.match(run(root, ["status"]).stdout, /NEEDS YOU/);
});

test("unattended next parks blocking decisions without dispatching", async (t) => {
  const task = { id: "T1", title: "Wait", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  assert.equal(run(root, ["ask", "T1", "Deploy", "--options", "yes|no", "--blocking", "--case", "external"]).status, 0);
  const next = run(root, ["next", "--unattended"]);
  assert.equal(next.status, 2);
  assert.match(next.stderr, /PARKED: D1/);
});

test("goal-level blocking decisions do not require a task", async (t) => {
  const root = await project(t);
  const result = run(root, ["ask", "Is the goal testable", "--options", "yes|no", "--blocking", "--case", "goal"]);
  assert.equal(result.status, 0, result.stderr);
  const decision = (await readPlan(root)).decisions[0];
  assert.deepEqual(decision.blocks, []);
  assert.equal(decision.case, "goal");
  assert.match(run(root, ["next"]).stdout, /Waiting on D1/);
  assert.match(run(root, ["status"]).stdout, /\(blocks goal\)/);
});

test("unborn repositories use normal Airlock boundary behavior", async (t) => {
  const root = await bareProject(t);
  assert.equal(run(root, ["init", "A delivery", "--done", "test passes"]).status, 0);
  const plan = await readPlan(root);
  plan.tasks.push({ id: "T1", title: "First", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null });
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await installTestRoutes(root, plan.tasks);
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("next rejects unrecognised positional input", async (t) => {
  const root = await project(t);
  const result = run(root, ["next", "fix", "the", "login"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no positional arguments/);
});

test("critical-model budget parks expensive work while allowing cheap work", async (t) => {
  const tasks = [
    { id: "T1", title: "Critical", role: "builder", risk: "critical", owns: ["src/critical.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
    { id: "T2", title: "Cheap", role: "builder", risk: "light", owns: ["src/light.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
  ];
  const plan = basePlan(tasks);
  plan.budget.maxExpensive = 0;
  const root = await project(t, plan);
  assert.match(run(root, ["next"]).stdout, /TASK T2/);
  tasks[1].status = "done";
  tasks[1].evidence = ["pass"];
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  assert.match(run(root, ["next"]).stdout, /BUDGET REACHED: maxExpensive/);
});

test("OpenCode configuration creates local model-bound agents with effort", async (t) => {
  const task = { id: "T1", title: "Route", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const opencodeConfig = path.join(root, "opencode-config");
  const env = { OPENCODE_CONFIG_DIR: opencodeConfig };
  const routes = JSON.parse(await readFile(path.join(root, ".git", "airlock", "models.json"), "utf8"));
  routes.catalog.opencode["openai/gpt-5.6-luna"] = { variants: ["low", "high"] };
  await writeProjectRoutes(root, routes);
  const configured = run(root, ["config", "--project", "--host", "opencode", "--role", "browser", "--risk", "light", "--model", "openai/gpt-5.6-luna", "--effort", "low"], env);
  assert.equal(configured.status, 0, configured.stderr);
  const agent = path.join(opencodeConfig, "agents", "airlock-browser-openai-gpt-5-6-luna-low.md");
  assert.match(await readFile(agent, "utf8"), /model: openai\/gpt-5\.6-luna/);
  assert.match(await readFile(agent, "utf8"), /variant: low/);
  const next = run(root, ["next", "--host", "opencode"], env);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /AGENT airlock-browser-openai-gpt-5-6-luna-low/);
});

test("OpenCode lifecycle commands keep the host explicit and release their pin", async (t) => {
  const task = { id: "T1", title: "Loop", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  await writeProjectRoutes(root, { version: 1, catalog: { opencode: { "test/open": { variants: ["low"] } } }, claude: {}, opencode: { builder: { light: { model: "test/open", effort: "low" } } } });
  assert.equal(run(root, ["config", "--sync", "--host", "opencode"]).status, 0);
  assert.equal(run(root, ["next", "--host", "opencode"]).status, 0);
  assert.equal(run(root, ["start", "T1", "--host", "opencode"]).status, 0);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.js"), "ok\n");
  assert.equal(run(root, ["audit", "T1", "--host", "opencode"]).status, 0);
  assert.equal(run(root, ["done", "T1", "--host", "opencode", "--evidence", "test: pass"]).status, 0);
  const state = JSON.parse(await readFile(path.join(root, ".git", "airlock", "router-state.json"), "utf8"));
  assert.deepEqual(state.pins, {});
});

test("version 1 OpenCode routes reject variants outside the declared model catalog", async (t) => {
  const task = { id: "T1", title: "Route", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  await writeProjectRoutes(root, { version: 1, catalog: { opencode: { "test/model": { variants: ["low"] } } }, claude: {}, opencode: { browser: { light: { model: "test/model", effort: "TOTALLY-BOGUS" } } } });
  const next = run(root, ["next", "--host", "opencode"]);
  assert.equal(next.status, 1);
  assert.match(next.stderr, /does not declare variant TOTALLY-BOGUS/);
  assert.ok(next.stderr.includes(path.join(testEnv(root).AIRLOCK_CONFIG_DIR, "models.json")));
  assert.match(next.stderr, /opencode models test --verbose/);
  const sync = run(root, ["config", "--sync", "--host", "opencode"]);
  assert.equal(sync.status, 1);
  assert.match(sync.stderr, /does not declare variant TOTALLY-BOGUS/);
  const invalidAgent = path.join(testEnv(root).OPENCODE_CONFIG_DIR, "agents", "airlock-browser-test-model-totally-bogus.md");
  assert.equal(await readFile(invalidAgent, "utf8").then(() => true, () => false), false);
});

test("init reports route bootstrap commands for task roles that are not configured", async (t) => {
  const root = await bareProject(t);
  const task = { id: "T1", title: "Bootstrap", role: "checker", risk: "complex", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(basePlan([task]), null, 2)}\n`);
  const init = run(root, ["init", "--host", "opencode"]);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /airlock config --host opencode --role checker --risk complex --model <model> --effort <effort>/);
});

test("version 2 OpenCode routes select UTC windows and pin the dispatched agent", async (t) => {
  const task = { id: "T1", title: "Route", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const opencodeConfig = path.join(root, "opencode-config");
  const env = { OPENCODE_CONFIG_DIR: opencodeConfig, AIRLOCK_CONFIG_DIR: path.join(root, "empty-airlock-config"), AIRLOCK_NOW: "2026-08-24T07:00:00.000Z" };
  await writeProjectRoutes(root, {
    version: 2,
    catalog: { opencode: { "test/default": { variants: ["low"] }, "test/peak": { variants: ["high"] } } },
    claude: {},
    opencode: { browser: { light: { model: "test/default", effort: "low", windows: [{ name: "peak", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], utc: "06:00-10:00", model: "test/peak", effort: "high" }] } } },
  });
  const sync = run(root, ["config", "--sync", "--host", "opencode"], env);
  assert.equal(sync.status, 0, sync.stderr);
  const next = run(root, ["next", "--host", "opencode", "--json"], env);
  assert.equal(next.status, 0, next.stderr);
  const json = JSON.parse(next.stdout);
  assert.match(json.text, /ROUTE PINNED · peak/);
  assert.match(json.text, /CLOCK OVERRIDE · AIRLOCK_NOW=2026-08-24T07:00:00\.000Z/);
  assert.match(json.text, /AGENT airlock-browser-test-peak-high/);
  assert.deepEqual({ route: json.route.route, state: json.route.state, pinned: json.route.pinned, agent: json.route.agent }, { route: "peak", state: "PINNED", pinned: true, agent: "airlock-browser-test-peak-high" });

  const routes = JSON.parse(await readFile(path.join(root, ".git", "airlock", "models.json"), "utf8"));
  delete routes.opencode.browser.light.windows;
  await writeProjectRoutes(root, routes);
  await mkdir(path.join(opencodeConfig, "agent"), { recursive: true });
  await writeFile(path.join(opencodeConfig, "agent", "airlock-legacy.md"), "legacy\n");
  const protectedPrune = run(root, ["config", "--sync", "--prune", "--host", "opencode"], env);
  assert.equal(protectedPrune.status, 0, protectedPrune.stderr);
  assert.match(protectedPrune.stdout, /STALE[\s\S]*airlock-browser-test-peak-high\.md/);
  assert.match(protectedPrune.stdout, /LEGACY[\s\S]*airlock-legacy\.md/);
  assert.equal(await readFile(path.join(opencodeConfig, "agents", "airlock-browser-test-peak-high.md"), "utf8").then(() => true, () => false), true);
  assert.equal(run(root, ["block", "T1", "--host", "opencode", "--reason", "stop"], env).status, 0);
  const releasedPrune = run(root, ["config", "--sync", "--prune", "--host", "opencode"], env);
  assert.match(releasedPrune.stdout, /PRUNED[\s\S]*airlock-browser-test-peak-high\.md/);
});

test("an offered route expires before a later start and status agrees while it is live", async (t) => {
  const task = { id: "T1", title: "Expire", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  await writeProjectRoutes(root, {
    version: 2,
    catalog: { opencode: { "test/default": { variants: ["low"] }, "test/peak": { variants: ["high"] } } },
    claude: {},
    opencode: { browser: { light: { model: "test/default", effort: "low", windows: [{ name: "peak", days: ["mon"], utc: "06:00-10:00", model: "test/peak", effort: "high" }] } } },
  });
  const atOffer = { AIRLOCK_NOW: "2026-08-24T07:30:00.000Z" };
  assert.equal(run(root, ["config", "--sync", "--host", "opencode"], atOffer).status, 0);
  assert.match(run(root, ["next", "--host", "opencode"], atOffer).stdout, /ROUTE PINNED · peak/);
  assert.match(run(root, ["status", "--host", "opencode"], atOffer).stdout, /NEXT[\s\S]*test\/peak · PINNED/);
  const start = run(root, ["start", "T1", "--host", "opencode"], { AIRLOCK_NOW: "2026-08-24T11:00:00.000Z" });
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /ROUTE PINNED · default/);
  assert.match(start.stdout, /CLOCK OVERRIDE|AGENT airlock-browser-test-default-low/);
  assert.equal((await readPlan(root)).tasks[0].startedAt, "2026-08-24T11:00:00.000Z");
});

test("a pre-3.1 doing task recovers its route from startedAt", async (t) => {
  const task = { id: "T1", title: "Recover", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "doing", evidence: [], startedAt: "2026-08-24T07:00:00.000Z", finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const env = { AIRLOCK_NOW: "2026-08-24T11:00:00.000Z" };
  await writeProjectRoutes(root, {
    version: 2,
    catalog: { opencode: { "test/default": { variants: ["low"] }, "test/peak": { variants: ["high"] } } },
    claude: {},
    opencode: { browser: { light: { model: "test/default", effort: "low", windows: [{ name: "peak", days: ["mon"], utc: "06:00-10:00", model: "test/peak", effort: "high" }] } } },
  });
  assert.equal(run(root, ["config", "--sync", "--host", "opencode"], env).status, 0);
  const next = run(root, ["next", "--host", "opencode"], env);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /ROUTE RECOVERED · peak · evaluated 2026-08-24T07:00:00\.000Z/);
  assert.match(next.stdout, /AGENT airlock-browser-test-peak-high/);
});

test("version 2 config updates defaults without dropping windows or writing an invalid route", async (t) => {
  const root = await project(t);
  const routes = { version: 2, catalog: {}, claude: { builder: { light: { model: "sonnet", effort: "low", windows: [{ name: "peak", days: ["mon"], utc: "06:00-10:00", model: "opus", effort: "high" }] } } }, opencode: {} };
  await writeProjectRoutes(root, routes);
  const changed = run(root, ["config", "--project", "--host", "claude", "--role", "builder", "--risk", "light", "--model", "haiku", "--effort", "medium"]);
  assert.equal(changed.status, 0, changed.stderr);
  const stored = JSON.parse(await readFile(path.join(root, ".git", "airlock", "models.json"), "utf8"));
  assert.equal(stored.claude.builder.light.model, "haiku");
  assert.deepEqual(stored.claude.builder.light.windows, routes.claude.builder.light.windows);

  stored.opencode = { browser: { light: { model: "test/model", effort: "high" } } };
  await writeProjectRoutes(root, stored);
  const before = await readFile(path.join(root, ".git", "airlock", "models.json"), "utf8");
  const invalid = run(root, ["config", "--project", "--host", "opencode", "--role", "browser", "--risk", "light", "--model", "test/missing", "--effort", "high"]);
  assert.equal(invalid.status, 1);
  assert.equal(await readFile(path.join(root, ".git", "airlock", "models.json"), "utf8"), before);
});

test("merged version 1 OpenCode routes remain compatible beside version 2 Claude routes", async (t) => {
  const root = await project(t);
  const env = testEnv(root);
  await mkdir(env.AIRLOCK_CONFIG_DIR, { recursive: true });
  await writeFile(path.join(env.AIRLOCK_CONFIG_DIR, "models.json"), `${JSON.stringify({ version: 1, catalog: { opencode: { "test/legacy": { variants: ["medium"] } } }, claude: {}, opencode: { browser: { light: { model: "test/legacy", effort: "medium" } } } }, null, 2)}\n`);
  await writeProjectRoutes(root, { version: 2, catalog: {}, claude: { builder: { light: { model: "sonnet", effort: "low", windows: [{ name: "peak", days: ["mon"], utc: "06:00-10:00", model: "opus", effort: "high" }] } } }, opencode: {} });
  const sync = run(root, ["config", "--sync", "--host", "opencode"]);
  assert.equal(sync.status, 0, sync.stderr);
  assert.equal(await readFile(path.join(env.OPENCODE_CONFIG_DIR, "agents", "airlock-browser-test-legacy-medium.md"), "utf8").then(() => true, () => false), true);
});

test("version 2 rejects overlapping and overnight UTC windows", async (t) => {
  const root = await project(t);
  const base = { version: 2, catalog: {}, claude: { builder: { light: { model: "sonnet", effort: "low", windows: [{ name: "one", days: ["mon"], utc: "06:00-10:00", model: "sonnet", effort: "low" }, { name: "two", days: ["mon"], utc: "09:00-11:00", model: "sonnet", effort: "low" }] } } }, opencode: {} };
  await writeProjectRoutes(root, base);
  const overlap = run(root, ["config", "--sync", "--host", "claude"], { AIRLOCK_CLAUDE_AGENT_DIR: path.join(root, "claude-agents"), AIRLOCK_CONFIG_DIR: path.join(root, "empty-airlock-config") });
  assert.equal(overlap.status, 1);
  assert.match(overlap.stderr, /overlap/);
  base.claude.builder.light.windows = [{ name: "night", days: ["mon"], utc: "22:00-02:00", model: "sonnet", effort: "low" }];
  await writeProjectRoutes(root, base);
  const overnight = run(root, ["config", "--sync", "--host", "claude"], { AIRLOCK_CLAUDE_AGENT_DIR: path.join(root, "claude-agents"), AIRLOCK_CONFIG_DIR: path.join(root, "empty-airlock-config") });
  assert.equal(overnight.status, 1);
  assert.match(overnight.stderr, /22:00-24:00 and 00:00-02:00/);
  base.claude.builder.light.windows = [
    { name: "late", days: ["mon"], utc: "22:00-24:00", model: "sonnet", effort: "low" },
    { name: "early", days: ["tue"], utc: "00:00-02:00", model: "sonnet", effort: "low" },
  ];
  await writeProjectRoutes(root, base);
  assert.equal(run(root, ["config", "--sync", "--host", "claude"], { AIRLOCK_CLAUDE_AGENT_DIR: path.join(root, "claude-agents"), AIRLOCK_CONFIG_DIR: path.join(root, "empty-airlock-config") }).status, 0);
});

test("Claude sync generates effort-bound agents and rejects a shadowing project agent", async (t) => {
  const task = { id: "T1", title: "Route", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const agents = path.join(root, "claude-agents");
  const env = { AIRLOCK_CONFIG_DIR: path.join(root, "empty-airlock-config"), AIRLOCK_CLAUDE_AGENT_DIR: agents };
  await writeProjectRoutes(root, { version: 2, catalog: {}, claude: { builder: { light: { model: "sonnet", effort: "high" } } }, opencode: {} });
  const sync = run(root, ["config", "--sync", "--host", "claude"], env);
  assert.equal(sync.status, 0, sync.stderr);
  const agent = path.join(agents, "airlock-builder-sonnet-high.md");
  const generated = await readFile(agent, "utf8");
  assert.match(generated, /model: sonnet/);
  assert.match(generated, /effort: high/);
  assert.match(generated, /tools: Read, Glob, Grep, Bash, PowerShell, Edit, Write, NotebookEdit/);
  assert.doesNotMatch(generated, /mode: subagent|permission:/);
  await mkdir(path.join(root, ".claude", "agents"), { recursive: true });
  await writeFile(path.join(root, ".claude", "agents", "airlock-builder-sonnet-high.md"), "shadow\n");
  const next = run(root, ["next", "--host", "claude"], env);
  assert.equal(next.status, 1);
  assert.match(next.stderr, /shadows local Airlock route/);
  const shadowedSync = run(root, ["config", "--sync", "--host", "claude"], env);
  assert.equal(shadowedSync.status, 1);
  assert.match(shadowedSync.stderr, /shadows local Airlock route/);
  await rm(path.join(root, ".claude"), { recursive: true, force: true });
  const overridden = run(root, ["next", "--host", "claude"], { ...env, CLAUDE_CODE_SUBAGENT_MODEL: "opus" });
  assert.equal(overridden.status, 1);
  assert.match(overridden.stderr, /CLAUDE_CODE_SUBAGENT_MODEL overrides Airlock routing/);
  await rm(agent);
  const missing = run(root, ["next", "--host", "claude"], env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing generated claude agent/);
  const statePath = path.join(root, ".git", "airlock", "router-state.json");
  assert.equal(await readFile(statePath, "utf8").then(() => true, () => false), false);
});

test("parallel tasks with disjoint glob prefixes may start together", async (t) => {
  const tasks = [
    { id: "T1", title: "A", role: "builder", risk: "light", owns: ["src/a*.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
    { id: "T2", title: "B", role: "builder", risk: "light", owns: ["src/b*.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null },
  ];
  const root = await project(t, basePlan(tasks));
  assert.equal(run(root, ["start", "T1"]).status, 0);
  assert.equal(run(root, ["start", "T2", "--parallel"]).status, 0);
});

test("missing local routes fail closed and plans cannot pin a model", async (t) => {
  const root = await bareProject(t);
  const configDir = path.join(root, "empty-airlock-config");
  const env = { AIRLOCK_CONFIG_DIR: configDir };
  const task = { id: "T1", title: "Route", role: "browser", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(basePlan([task]), null, 2)}\n`);
  const missing = run(root, ["next", "--host", "opencode"], env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing local route for opencode\/browser\/light/);
  task.model = "openai/gpt-5.6-luna";
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(basePlan([task]), null, 2)}\n`);
  const pinned = run(root, ["next"], env);
  assert.equal(pinned.status, 1);
  assert.match(pinned.stderr, /model is not supported/);
});

test("prompt surface contains only the slim roles and two shims", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  for (const role of ["builder.md", "checker.md", "browser.md"]) {
    const size = Buffer.byteLength(await readFile(path.join(root, "roles", role), "utf8"), "utf8");
    assert.ok(size <= 800, `${role} is ${size} bytes; ceiling is 800`);
  }
  for (const command of ["commands/airlock.md", ".opencode/command/airlock.md"]) {
    const text = await readFile(path.join(root, command), "utf8");
    assert.match(text, /unattended/);
  }
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.repository.url, "git+https://github.com/ivan-tretyakov/airlock.git");
  assert.ok(packageJson.files.includes("scripts/airlock.mjs"));
  assert.ok(packageJson.files.includes(".opencode/command/airlock.md"));
  assert.match(await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8"), /airlock#v3\.1\.0/);
  assert.doesNotMatch(await readFile(path.join(root, "commands", "airlock.md"), "utf8"), /using the model it names/);
  const openCodeShim = await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8");
  for (const command of ["start <id>", "audit <id>", "done <id>", "block <id>"]) assert.match(openCodeShim, new RegExp(`${command.replace(/[<>]/g, "\\$&")}[^.]*--host opencode`));
  const claudeShim = await readFile(path.join(root, "commands", "airlock.md"), "utf8");
  for (const command of ["start <id>", "audit <id>", "done <id>", "block <id>"]) assert.match(claudeShim, new RegExp(`${command.replace(/[<>]/g, "\\$&")}[^.]*--host claude`));
  assert.match(await readFile(path.join(root, ".opencode/command/airlock.md"), "utf8"), /npm install --global github:ivan-tretyakov\/airlock#v3\.0\.0/);
});
