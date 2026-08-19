import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function project(t, plan = basePlan()) {
  const root = await bareProject(t);
  await writeFile(path.join(root, "airlock.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(root, "baseline.txt"), "baseline\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "baseline"]);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

async function readPlan(root) {
  return JSON.parse(await readFile(path.join(root, "airlock.plan.json"), "utf8"));
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
  assert.equal(run(root, ["start", "T1"]).status, 0);
});

test("OpenCode bootstrap installs missing command and bindings without replacing the plan", async (t) => {
  const task = { id: "T1", title: "Bootstrap", role: "builder", risk: "light", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const before = await readFile(path.join(root, "airlock.plan.json"), "utf8");
  const result = run(root, ["init", "--host", "opencode"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(root, "airlock.plan.json"), "utf8"), before);
  assert.match(await readFile(path.join(root, ".opencode", "command", "airlock.md"), "utf8"), /airlock next --host opencode/);
  assert.match(await readFile(path.join(root, ".opencode", "agent", "airlock-builder-glm.md"), "utf8"), /model: zai-coding-plan\/glm-5\.3/);
  assert.match(await readFile(path.join(root, ".opencode", "agent", "airlock-browser-sol.md"), "utf8"), /model: openai\/gpt-5\.6-sol/);
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
  assert.match(next.stdout, /TASK T1 · builder · sonnet/);
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

test("OpenCode briefs name the exact configured agent", async (t) => {
  const task = { id: "T1", title: "Route", role: "checker", risk: "critical", owns: ["src/a.js"], dependsOn: [], acceptance: "test passes", status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null };
  const root = await project(t, basePlan([task]));
  const next = run(root, ["next", "--host", "opencode"]);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /AGENT airlock-checker-sol/);
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

test("OpenCode bindings cover each configured role-model pair", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
  const models = JSON.parse(await readFile(path.join(root, ".airlock", "models.json"), "utf8"));
  for (const role of ["builder", "checker", "browser"]) {
    for (const model of new Set(Object.values(models.opencode))) {
      assert.ok(
        config.agent[models.opencodeAgents[model][role]]?.model === model && config.agent[models.opencodeAgents[model][role]]?.prompt === `{file:./roles/${role}.md}`,
        `missing ${role} binding for ${model}`,
      );
    }
  }
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
  assert.match(await readFile(path.join(root, ".opencode/command/airlock.md"), "utf8"), /npm install --global github:ivan-tretyakov\/airlock#v3\.0\.0/);
});
