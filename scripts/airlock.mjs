#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA = "airlock.plan/v4";
const V3_SCHEMA = "airlock.plan/v3";
const V3_RISKS = new Set(["light", "standard", "complex", "critical"]);
const ROLES = new Set(["builder", "checker", "browser"]);
const STATUSES = new Set(["todo", "doing", "blocked", "needs-you", "done"]);
const DECISION_MODES = new Set(["assume", "block"]);
const BLOCKING_CASES = new Set(["irreversible", "external", "access", "rework", "goal"]);
const ROUTING_EXECUTORS = new Set(["claude", "codex", "opencode"]);
const ROUTING_TIERS = new Set(["default", "expensive"]);
const DEFAULT_ROUTING_TIMEOUT_MINUTES = 30;
const LEGACY_OPENCODE_COMMAND_HASHES = new Set([
  "93a2001777ddc9dfb0ca02954f7b577d669d352704fbb47b07b1296ad0a9307e",
  "e0073a668602070e7cb2e9a78c916a75628848bcf2a23f2c8e930b8b69f54997",
  "9201872f0c11c80d2a76b90bd14afc911943f7cf2923bd4212798a07eaba6e8e",
  "4b4d5b3a87bca1afd8b8bdcd2c1acc35960d62ac0d200c0373e881782fc792ca",
]);
let commandTimestamp = null;
let planUpgraded = false;
class AirlockError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function now() {
  return new Date().toISOString();
}

function commandNow() {
  if (commandTimestamp) return commandTimestamp;
  const supplied = process.env.AIRLOCK_NOW;
  if (isNonEmptyString(supplied) && !Number.isNaN(Date.parse(supplied))) return new Date(supplied).toISOString();
  return now();
}

function slashPath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function normalizePath(value) {
  const normalized = slashPath(value);
  return ["win32", "darwin"].includes(process.platform) ? normalized.toLowerCase() : normalized;
}

function parseCli(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[rawKey] = true;
      continue;
    }
    flags[rawKey] = next;
    index += 1;
  }
  return { positional, flags };
}

function findRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

function planCandidates(root) {
  return [
    path.join(root, ".airlock", "plan.json"),
    path.join(root, "airlock.plan.json"),
    path.join(root, "docs", "airlock", "airlock.plan.json"),
  ];
}

function findPlan(root, requested) {
  if (requested) {
    const candidate = path.resolve(requested);
    if (!existsSync(candidate)) throw new AirlockError(`plan not found: ${candidate}`);
    return candidate;
  }
  const candidates = planCandidates(root).filter(existsSync);
  if (candidates.length === 0) throw new AirlockError("no plan found at .airlock/plan.json, the repository root, or docs/airlock/");
  if (candidates.length > 1) throw new AirlockError("multiple plans found; select one with --plan <path>");
  return candidates[0];
}

function defaultInitPlanPath(root) {
  return planCandidates(root).find(existsSync) ?? planCandidates(root)[0];
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AirlockError(`invalid ${label}: ${error.message}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentHash(value) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

function assertArrayOfStrings(value, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => !isNonEmptyString(item))) {
    throw new AirlockError(`${label} must contain${minimum ? " at least one" : " only"} non-empty string${minimum === 1 ? "" : "s"}`);
  }
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new AirlockError("plan must be a JSON object");
  if (plan.schema !== SCHEMA) throw new AirlockError(`plan schema must be ${SCHEMA}`);
  if (!isNonEmptyString(plan.goal) || /[\r\n]/.test(plan.goal)) throw new AirlockError("goal must be one non-empty sentence");
  assertArrayOfStrings(plan.done, "done", 1);
  if (plan.nonGoals !== undefined) assertArrayOfStrings(plan.nonGoals, "nonGoals");
  if (!isNonEmptyString(plan.created) || Number.isNaN(Date.parse(plan.created))) throw new AirlockError("created must be an ISO-8601 timestamp");
  if (!plan.budget || !Number.isSafeInteger(plan.budget.maxTasks) || plan.budget.maxTasks < 1 || !Number.isSafeInteger(plan.budget.maxExpensive) || plan.budget.maxExpensive < 0) {
    throw new AirlockError("budget must contain positive maxTasks and non-negative maxExpensive integers");
  }
  if (plan.budget.reviewLines !== undefined && (!Number.isSafeInteger(plan.budget.reviewLines) || plan.budget.reviewLines < 1)) {
    throw new AirlockError("budget.reviewLines must be a positive integer");
  }
  if (!Array.isArray(plan.tasks)) throw new AirlockError("tasks must be an array");
  if (!Array.isArray(plan.decisions)) throw new AirlockError("decisions must be an array");
  if (plan.tasks.length > plan.budget.maxTasks) throw new AirlockError(`tasks exceed budget.maxTasks (${plan.budget.maxTasks})`);

  const ids = new Set();
  const taskIds = new Set();
  for (const task of plan.tasks) {
    if (!task || typeof task !== "object") throw new AirlockError("each task must be an object");
    if (!isNonEmptyString(task.id) || ids.has(task.id)) throw new AirlockError(`duplicate or invalid id: ${task.id ?? "<missing>"}`);
    ids.add(task.id);
    taskIds.add(task.id);
    if (!isNonEmptyString(task.title)) throw new AirlockError(`task ${task.id} requires title`);
    if (!ROLES.has(task.role)) throw new AirlockError(`task ${task.id} has invalid role: ${task.role}`);
    if ("risk" in task) throw new AirlockError(`task ${task.id} risk was removed in v4; use expensive: true for critical-cost tasks`);
    if (task.expensive !== undefined && typeof task.expensive !== "boolean") throw new AirlockError(`task ${task.id} expensive must be a boolean`);
    if (task.model !== undefined) throw new AirlockError(`task ${task.id} model is not supported; model choice belongs to the host agent files`);
    if (task.diffLines !== undefined && (!Number.isSafeInteger(task.diffLines) || task.diffLines < 0)) throw new AirlockError(`task ${task.id} diffLines must be a non-negative integer`);
    assertArrayOfStrings(task.owns, `task ${task.id} owns`, 1);
    if (task.owns.some((owned) => path.isAbsolute(owned) || normalizePath(owned).startsWith("../"))) {
      throw new AirlockError(`task ${task.id} owns must be repository-relative paths or globs`);
    }
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some((dependency) => !isNonEmptyString(dependency))) throw new AirlockError(`task ${task.id} dependsOn must be an array of ids`);
    if (!isNonEmptyString(task.acceptance)) throw new AirlockError(`task ${task.id} requires acceptance`);
    if (!STATUSES.has(task.status)) throw new AirlockError(`task ${task.id} has invalid status: ${task.status}`);
    if (!Array.isArray(task.evidence) || task.evidence.some((item) => !isNonEmptyString(item))) throw new AirlockError(`task ${task.id} evidence must be an array of strings`);
    if (task.status === "done" && task.evidence.length === 0) throw new AirlockError(`done task ${task.id} requires evidence`);
    if (task.status === "blocked" && !isNonEmptyString(task.note)) throw new AirlockError(`blocked task ${task.id} requires a note`);
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) throw new AirlockError(`task ${task.id} depends on missing task ${dependency}`);
      if (dependency === task.id) throw new AirlockError(`task ${task.id} cannot depend on itself`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  function visit(id) {
    if (visiting.has(id)) throw new AirlockError(`dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of plan.tasks) visit(task.id);

  for (const decision of plan.decisions) {
    if (!decision || typeof decision !== "object") throw new AirlockError("each decision must be an object");
    if (!isNonEmptyString(decision.id) || ids.has(decision.id)) throw new AirlockError(`duplicate or invalid id: ${decision.id ?? "<missing>"}`);
    ids.add(decision.id);
    if (!isNonEmptyString(decision.question)) throw new AirlockError(`decision ${decision.id} requires question`);
    assertArrayOfStrings(decision.options, `decision ${decision.id} options`, 2);
    if (!isNonEmptyString(decision.recommendation) || !decision.options.includes(decision.recommendation)) throw new AirlockError(`decision ${decision.id} recommendation must be an option`);
    const mode = decision.mode ?? "assume";
    if (!DECISION_MODES.has(mode)) throw new AirlockError(`decision ${decision.id} has invalid mode: ${mode}`);
    if (mode === "assume" && (!isNonEmptyString(decision.assumed) || !decision.options.includes(decision.assumed))) throw new AirlockError(`assumed decision ${decision.id} requires an assumed option`);
    if (!Array.isArray(decision.blocks) || decision.blocks.some((id) => !taskIds.has(id))) throw new AirlockError(`decision ${decision.id} blocks must reference tasks`);
    if (!Array.isArray(decision.consumedBy) || decision.consumedBy.some((id) => !taskIds.has(id))) throw new AirlockError(`decision ${decision.id} consumedBy must reference tasks`);
    if (!["open", "answered"].includes(decision.status)) throw new AirlockError(`decision ${decision.id} has invalid status: ${decision.status}`);
    if (decision.status === "answered" && (!isNonEmptyString(decision.answer) || !decision.options.includes(decision.answer))) throw new AirlockError(`answered decision ${decision.id} requires an answer`);
  }
  const doing = plan.tasks.filter((task) => task.status === "doing");
  if (doing.length > 1) {
    for (let left = 0; left < doing.length; left += 1) {
      for (let right = left + 1; right < doing.length; right += 1) {
        if (ownsOverlap(doing[left].owns, doing[right].owns)) throw new AirlockError(`doing tasks ${doing[left].id} and ${doing[right].id} have overlapping owns`);
      }
    }
  }
  for (const decision of plan.decisions.filter((item) => item.status === "open" && (item.mode ?? "assume") === "block")) {
    for (const taskId of decision.blocks) {
      if (byId.get(taskId).status === "doing") throw new AirlockError(`task ${taskId} cannot be doing while blocked by open decision ${decision.id}`);
    }
  }
  return plan;
}

function upgradePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || plan.schema !== V3_SCHEMA) return { plan, upgraded: false, mapped: [] };
  const mapped = [];
  const tasks = Array.isArray(plan.tasks)
    ? plan.tasks.map((task) => {
        if (!task || typeof task !== "object") return task;
        if (task.expensive !== undefined) throw new AirlockError(`task ${task.id} has both risk and expensive; a v3 plan must not carry expensive`);
        const { risk, ...rest } = task;
        if (risk !== undefined && !V3_RISKS.has(risk)) throw new AirlockError(`task ${task.id} has invalid risk: ${risk}`);
        if (risk !== "critical") return rest;
        mapped.push(task.id);
        return { ...rest, expensive: true };
      })
    : plan.tasks;
  return { plan: { ...plan, schema: SCHEMA, tasks }, upgraded: true, mapped };
}

function globPattern(pattern) {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        output += ".*";
        index += 1;
      } else output += "[^/]*";
    } else if (char === "?") output += "[^/]";
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${output}$`);
}

function ownsPath(owns, candidate) {
  const normalized = normalizePath(candidate);
  return owns.some((owned) => {
    const pattern = normalizePath(owned);
    if (pattern.endsWith("/")) return normalized.startsWith(pattern);
    if (!/[?*]/.test(pattern)) return normalized === pattern;
    return globPattern(pattern).test(normalized);
  });
}

function ownsOverlap(first, second) {
  for (const left of first) {
    for (const right of second) {
      const a = normalizePath(left);
      const b = normalizePath(right);
      if (a === b || a.startsWith(b.endsWith("/") ? b : `${b}/`) || b.startsWith(a.endsWith("/") ? a : `${a}/`)) return true;
      const wildcard = (value) => value.search(/[?*]/);
      const aPrefix = wildcard(a) < 0 ? a : a.slice(0, wildcard(a));
      const bPrefix = wildcard(b) < 0 ? b : b.slice(0, wildcard(b));
      if (!aPrefix || !bPrefix || aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix)) return true;
    }
  }
  return false;
}

function readPlan(planPath) {
  const { plan, upgraded, mapped } = upgradePlan(readJson(planPath, "plan"));
  if (upgraded && !planUpgraded) {
    planUpgraded = true;
    const suffix = mapped.length ? ` (risk: critical -> expensive on ${mapped.join(", ")})` : "";
    process.stderr.write(`UPGRADED plan schema ${V3_SCHEMA} -> ${SCHEMA}${suffix}\n`);
  }
  return validatePlan(plan);
}

function writePlan(planPath, plan) {
  validatePlan(plan);
  const temporary = `${planPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  renameSync(temporary, planPath);
}

function taskAgent(task) {
  return `airlock-${task.role}`;
}

function git(root, args, options = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw new AirlockError(stderr || error.message);
  }
}

function gitPaths(root, args) {
  return git(root, args).split("\0").filter(Boolean).map(slashPath);
}

function gitReference(root, ref) {
  try {
    return git(root, ["rev-parse", "--verify", ref]).trim();
  } catch {
    return null;
  }
}

function relativePlan(root, planPath) {
  return normalizePath(path.relative(root, planPath));
}

function isCoordinatorPath(item, planPath, root) {
  const normalized = normalizePath(item);
  return normalized === relativePlan(root, planPath)
    || normalized === ".airlock"
    || normalized.startsWith(".airlock/")
    || normalized === ".opencode/command/airlock.md"
    || normalized.startsWith(".opencode/agent/airlock-");
}

function dirtyProductPaths(root, planPath) {
  const tracked = gitReference(root, "HEAD")
    ? gitPaths(root, ["diff", "--name-only", "-z", "HEAD"])
    : [
        ...gitPaths(root, ["diff", "--name-only", "-z"]),
        ...gitPaths(root, ["diff", "--cached", "--name-only", "-z"]),
      ];
  const staged = gitPaths(root, ["diff", "--cached", "--name-only", "-z"]);
  const untracked = gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set([...tracked, ...staged, ...untracked].filter((item) => !isCoordinatorPath(item, planPath, root)))].sort();
}

function assertCleanBoundary(root, planPath) {
  const dirty = dirtyProductPaths(root, planPath);
  if (dirty.length > 0) throw new AirlockError(`task boundary requires a clean worktree; found: ${dirty.join(", ")}`);
}

function taskById(plan, id) {
  const task = plan.tasks.find((item) => item.id === id);
  if (!task) throw new AirlockError(`unknown task: ${id}`);
  return task;
}

function decisionById(plan, id) {
  const decision = plan.decisions.find((item) => item.id === id);
  if (!decision) throw new AirlockError(`unknown decision: ${id}`);
  return decision;
}

function openDecisionsFor(plan, taskId) {
  return plan.decisions.filter((decision) => decision.status === "open" && decision.blocks.includes(taskId));
}

function goalBlockingDecision(plan) {
  return plan.decisions.find((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block" && decision.case === "goal") ?? null;
}

function dependenciesDone(plan, task) {
  return task.dependsOn.every((id) => taskById(plan, id).status === "done");
}

function eligibleTasks(plan) {
  return plan.tasks.filter((task) => task.status === "todo" && dependenciesDone(plan, task) && !openDecisionsFor(plan, task.id).some((decision) => (decision.mode ?? "assume") === "block"));
}

function formatDuration(startedAt) {
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) return "?";
  return `${Math.max(0, Math.floor((Date.parse(commandNow()) - Date.parse(startedAt)) / 60_000))}m`;
}

function decisionSummary(decision) {
  const mode = decision.mode ?? "assume";
  if (mode === "block") return `${decision.id}  ${decision.question}  (blocks ${decision.blocks.length ? decision.blocks.join(", ") : "goal"})  recommend: ${decision.recommendation}`;
  return `${decision.id}  ${decision.question}  assumed: ${decision.assumed}   used by ${decision.consumedBy.join(", ") || "none"}`;
}

function isExpensive(task) {
  return task.expensive === true;
}

function reviewState(plan) {
  const budget = plan.budget?.reviewLines;
  if (budget === undefined) return null;
  const used = plan.tasks
    .filter((task) => task.status === "done")
    .reduce((sum, task) => sum + (task.diffLines ?? 0), 0);
  return { used, budget, exceeded: used > budget };
}

function stagedDiffLines(root, paths) {
  if (paths.length === 0) return 0;
  return git(root, ["diff", "--cached", "--numstat", "--", ...paths])
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .reduce((sum, line) => {
      const [added, deleted] = line.split("\t");
      if (added === "-" || deleted === "-") return sum;
      return sum + Number(added) + Number(deleted);
    }, 0);
}

function budgetState(plan) {
  const completed = plan.tasks.filter((task) => task.status === "done").length;
  if (completed >= plan.budget.maxTasks) return "task";
  const expensive = plan.tasks.filter((task) => ["doing", "done"].includes(task.status) && isExpensive(task)).length;
  return expensive >= plan.budget.maxExpensive ? "expensive" : null;
}

function selectNext(plan) {
  if (goalBlockingDecision(plan)) return null;
  const doing = plan.tasks.filter((task) => task.status === "doing");
  if (doing.length === 1) return { task: doing[0], resumed: true };
  if (plan.tasks.filter((task) => task.status === "done").length >= plan.budget.maxTasks) return null;
  const tasks = eligibleTasks(plan);
  const expensive = plan.tasks.filter((task) => ["doing", "done"].includes(task.status) && isExpensive(task)).length;
  const canRun = (task) => !isExpensive(task) || expensive < plan.budget.maxExpensive;
  const withoutDecisions = tasks.find((task) => openDecisionsFor(plan, task.id).length === 0 && canRun(task));
  if (withoutDecisions) return { task: withoutDecisions, resumed: false };
  const assumed = tasks.find((task) => openDecisionsFor(plan, task.id).every((decision) => (decision.mode ?? "assume") === "assume") && canRun(task));
  return assumed ? { task: assumed, resumed: false } : null;
}

function dependencyContext(root, plan, task) {
  if (task.role !== "checker" || task.dependsOn.length === 0) return [];
  const output = [];
  for (const dependencyId of task.dependsOn) {
    const dependency = taskById(plan, dependencyId);
    output.push(`EVIDENCE ${dependencyId}  ${dependency.evidence.join(" | ") || "none"}`);
    try {
      const commit = git(root, ["log", "-1", "--format=%H", "--extended-regexp", "--grep", `^Airlock-Task: ${escapeRegex(dependencyId)}$`]).trim();
      if (commit) {
        const changed = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]).split(/\r?\n/).filter(Boolean);
        const scoped = changed.filter((item) => ownsPath(dependency.owns, item));
        const diff = scoped.length ? git(root, ["show", "--format=", "--no-ext-diff", "--binary", commit, "--", ...scoped]).trim() : "";
        const rendered = diff.slice(0, 12_000) || "(no product diff)";
        output.push(`DIFF ${dependencyId}\n${rendered}${diff.length > 12_000 ? "\n[DIFF TRUNCATED at 12000 characters]" : ""}`);
      }
    } catch {
      output.push(`DIFF ${dependencyId}\n(unavailable)`);
    }
  }
  return output;
}

function taskText(root, plan, task, resumed) {
  if (!task.owns?.length) throw new AirlockError(`task ${task.id} has no owns paths`);
  if (!isNonEmptyString(task.acceptance)) throw new AirlockError(`task ${task.id} has no acceptance`);
  const lines = [
    `TASK ${task.id} · ${task.role}`,
    `GOAL  ${plan.goal}`,
    `DO    ${task.title}${resumed ? " (resume)" : ""}`,
    `OWNS  ${task.owns[0]}`,
    ...task.owns.slice(1).map((owned) => `      ${owned}`),
    `DONE  ${task.acceptance}`,
    `AGENT ${taskAgent(task)}`,
  ];
  for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) {
    lines.push(`ASSUME ${decision.id}  ${decision.question} = ${decision.assumed}`);
  }
  lines.push(...dependencyContext(root, plan, task));
  lines.push("RULES Change only OWNS paths. If you need another path, stop and report it.", "      Return: changed paths + the command you ran + its result. Nothing else.");
  return lines.join("\n");
}

function nextText(root, plan) {
  const goalDecision = goalBlockingDecision(plan);
  if (goalDecision) return { text: `NOTHING TO DO\nWaiting on ${goalDecision.id}.`, selected: null, parked: [goalDecision] };
  const selected = selectNext(plan);
  if (!selected) {
    const openBlocking = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block");
    if (plan.tasks.every((task) => task.status === "done")) return { text: "NOTHING TO DO\nAll tasks are done.", selected: null };
    const budget = budgetState(plan);
    if (budget) return { text: `NOTHING TO DO\nBUDGET REACHED: ${budget === "task" ? "maxTasks" : "maxExpensive"}.`, selected: null };
    if (openBlocking.length) return { text: `NOTHING TO DO\nWaiting on ${openBlocking.map((item) => item.id).join(", ")}.`, selected: null, parked: openBlocking };
    return { text: "NOTHING TO DO\nAll remaining tasks are blocked.", selected: null };
  }
  return { text: taskText(root, plan, selected.task, selected.resumed), selected };
}

function statusText(plan) {
  const done = plan.tasks.filter((task) => task.status === "done").length;
  const lines = [`GOAL  ${plan.goal}        ${done}/${plan.tasks.length} done`];
  const review = reviewState(plan);
  if (review) lines.push(`REVIEW  ${review.used}/${review.budget} lines${review.exceeded ? " (exceeded)" : ""}`);
  const blocking = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block");
  const assumed = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "assume");
  const doing = plan.tasks.filter((task) => task.status === "doing");
  const blocked = plan.tasks.filter((task) => task.status === "blocked" || task.status === "needs-you");
  if (blocking.length) lines.push("NEEDS YOU", ...blocking.map((decision) => `  ${decisionSummary(decision)}`));
  if (assumed.length) lines.push("ASSUMED (confirm at the end)", ...assumed.map((decision) => `  ${decisionSummary(decision)}`));
  if (doing.length) lines.push("DOING", ...doing.map((task) => `  ${task.id}  ${task.title}  ${task.role}  ${formatDuration(task.startedAt)}`));
  if (blocked.length) lines.push("BLOCKED", ...blocked.map((task) => `  ${task.id}  ${task.title}             ${task.note ?? "waiting on a decision"}`));
  const next = selectNext(plan);
  if (next && !next.resumed) lines.push("NEXT", `  ${next.task.id}  ${next.task.title}  ${next.task.role}`);
  if (!next && !plan.tasks.every((task) => task.status === "done") && budgetState(plan)) lines.push("BUDGET", `  ${budgetState(plan) === "task" ? "maxTasks" : "maxExpensive"} reached`);
  return lines.join("\n");
}

function output(value, json) {
  const payload = typeof value === "string" ? { text: value } : value;
  if (json) process.stdout.write(`${JSON.stringify(planUpgraded ? { ...payload, upgraded: true } : payload, null, 2)}\n`);
  else process.stdout.write(`${payload.text}\n`);
}

function requireValue(value, label) {
  if (!isNonEmptyString(value)) throw new AirlockError(`${label} is required`);
  return value;
}

function nextDecisionId(plan) {
  let number = 1;
  while (plan.decisions.some((decision) => decision.id === `D${number}`) || plan.tasks.some((task) => task.id === `D${number}`)) number += 1;
  return `D${number}`;
}

function planIsTracked(root, planPath) {
  try {
    return git(root, ["ls-files", "--error-unmatch", "--", relativePlan(root, planPath)]).trim().length > 0;
  } catch {
    return false;
  }
}

function commitTask(root, planPath, task, evidence, inScope) {
  const planRelative = relativePlan(root, planPath);
  const tracked = planIsTracked(root, planPath);
  const paths = [...new Set([...inScope, ...(tracked ? [planRelative] : [])])];
  if (tracked) git(root, ["add", "--", planRelative]);
  const emptyCommit = paths.length === 0 && task.role === "checker";
  if (paths.length === 0 && !emptyCommit) throw new AirlockError(`task ${task.id} has no changes to commit`);
  git(root, [
    "commit",
    ...(emptyCommit ? ["--allow-empty", "--only"] : []),
    "-m", `${task.id}: ${task.title}`,
    "-m", `Airlock-Task: ${task.id}`,
    "-m", `Evidence: ${evidence}`,
    "--", ...paths,
  ]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function auditTask(root, planPath, task, range, plan) {
  const changed = range
    ? gitPaths(root, ["diff", "--name-only", "-z", range])
    : dirtyProductPaths(root, planPath);
  const inScope = changed.filter((item) => ownsPath(task.owns, item));
  const foreign = plan
    ? changed.filter((item) => !ownsPath(task.owns, item) && plan.tasks.some((other) => other.id !== task.id && other.status === "doing" && ownsPath(other.owns, item)))
    : [];
  const outOfScope = changed.filter((item) => !ownsPath(task.owns, item) && !foreign.includes(item));
  return { changed, inScope, outOfScope, foreign };
}

function preservePaths(root, paths, kind, taskId = "worktree") {
  if (!paths.length) return null;
  const message = `airlock ${kind} ${taskId} ${commandNow()}`;
  const previous = gitReference(root, "refs/stash");
  git(root, ["stash", "push", "--include-untracked", "--message", message, "--", ...paths]);
  const commit = git(root, ["rev-parse", "refs/stash"]).trim();
  if (commit === previous) throw new AirlockError(`unable to preserve paths for ${taskId}`);
  const ref = `refs/airlock/${kind}/${taskId}/${Date.now()}`;
  git(root, ["update-ref", ref, commit]);
  git(root, ["stash", "drop", "--quiet", "stash@{0}"]);
  return ref;
}

function recoveryPaths(plan, task, root, planPath) {
  const paths = dirtyProductPaths(root, planPath);
  const otherDoing = plan.tasks.filter((other) => other.id !== task.id && other.status === "doing");
  const preserve = [];
  for (const item of paths) {
    const ownedByTask = ownsPath(task.owns, item);
    const ownedByOthers = otherDoing.filter((other) => ownsPath(other.owns, item));
    if (ownedByTask && ownedByOthers.length) {
      throw new AirlockError(`cannot recover ${task.id}: ${item} is also owned by ${ownedByOthers.map((other) => other.id).join(", ")}`);
    }
    if (ownedByTask || ownedByOthers.length === 0) preserve.push(item);
  }
  return preserve;
}

function startTask(root, planPath, plan, id, flags = {}) {
  const task = taskById(plan, requireValue(id, "task id"));
  if (task.status === "doing") {
    if (planUpgraded) writePlan(planPath, plan);
    return { task, resumed: true };
  }
  if (task.status !== "todo") throw new AirlockError(`task ${task.id} cannot start from ${task.status}`);
  if (!dependenciesDone(plan, task)) throw new AirlockError(`task ${task.id} has unfinished dependencies`);
  if (goalBlockingDecision(plan)) throw new AirlockError(`task ${task.id} is waiting on goal decision ${goalBlockingDecision(plan).id}`);
  if (openDecisionsFor(plan, task.id).some((decision) => (decision.mode ?? "assume") === "block")) throw new AirlockError(`task ${task.id} is waiting on a blocking decision`);
  const doing = plan.tasks.filter((item) => item.status === "doing");
  if (doing.length && (!flags.parallel || doing.some((item) => ownsOverlap(item.owns, task.owns)))) throw new AirlockError(`task ${task.id} cannot start while ${doing.map((item) => item.id).join(", ")} is doing`);
  assertCleanBoundary(root, planPath);
  task.status = "doing";
  task.startedAt = commandNow();
  task.note = null;
  for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) {
    if (!decision.consumedBy.includes(task.id)) decision.consumedBy.push(task.id);
  }
  writePlan(planPath, plan);
  return { task, resumed: false };
}

function completeTask(root, planPath, plan, id, evidence) {
  const task = taskById(plan, requireValue(id, "task id"));
  const checkedEvidence = requireValue(evidence, "--evidence");
  if (task.status !== "doing") throw new AirlockError(`task ${task.id} cannot complete from ${task.status}`);
  const audit = auditTask(root, planPath, task, undefined, plan);
  if (audit.outOfScope.length) throw new AirlockError(`audit failed; out-of-scope paths: ${audit.outOfScope.join(", ")}`);
  const original = readFileSync(planPath, "utf8");
  if (audit.inScope.length) git(root, ["add", "--", ...audit.inScope]);
  task.diffLines = stagedDiffLines(root, audit.inScope);
  task.status = "done";
  task.evidence.push(checkedEvidence);
  task.finishedAt = commandNow();
  task.note = null;
  writePlan(planPath, plan);
  let commit;
  try {
    commit = commitTask(root, planPath, task, checkedEvidence, audit.inScope);
  } catch (error) {
    writeFileSync(planPath, original, "utf8");
    git(root, ["reset", "--", relativePlan(root, planPath)]);
    throw error;
  }
  return { task, commit, review: reviewState(plan) };
}

function blockTask(root, planPath, plan, id, reason) {
  const task = taskById(plan, requireValue(id, "task id"));
  const checkedReason = requireValue(reason, "--reason");
  if (!["todo", "doing", "needs-you"].includes(task.status)) throw new AirlockError(`task ${task.id} cannot block from ${task.status}`);
  const recovery = task.status === "doing" ? preservePaths(root, recoveryPaths(plan, task, root, planPath), "blocked", task.id) : null;
  task.status = "blocked";
  task.note = `${checkedReason}${recovery ? `; preserved at ${recovery}` : ""}`;
  task.finishedAt = commandNow();
  writePlan(planPath, plan);
  return task;
}

function renderMarkdown(plan) {
  const rows = plan.tasks.map((task) => `| ${task.id} | ${task.title} | ${task.status} | ${task.role} |`).join("\n");
  const decisions = plan.decisions.filter((decision) => decision.status === "open").map((decision) => `- ${decisionSummary(decision)}`).join("\n") || "- None";
  return `# Airlock\n\n${statusText(plan)}\n\n## Tasks\n\n| ID | Task | State | Role |\n|---|---|---|---|\n${rows}\n\n## Decisions\n\n${decisions}\n`;
}

function defaultRoutingPath() {
  return path.join(homedir(), ".airlock", "routing.json");
}

function validateRoutingSlot(slot, label) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) throw new AirlockError(`${label} must be an object`);
  const unknown = Object.keys(slot).filter((key) => !["executor", "model", "effort"].includes(key));
  if (unknown.length) throw new AirlockError(`${label} has unknown key: ${unknown[0]}`);
  if (!ROUTING_EXECUTORS.has(slot.executor)) throw new AirlockError(`${label}.executor must be one of ${[...ROUTING_EXECUTORS].join(", ")}`);
  if (!isNonEmptyString(slot.model)) throw new AirlockError(`${label}.model must be a non-empty string`);
  if (slot.effort !== undefined && !isNonEmptyString(slot.effort)) throw new AirlockError(`${label}.effort must be a non-empty string when set`);
  return slot;
}

function readRouting(routingPath) {
  if (!existsSync(routingPath)) throw new AirlockError(`routing not found: ${routingPath}; write bindings.<role>.<tier> slots or pass --routing <path>`);
  const doc = readJson(routingPath, "routing");
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new AirlockError("routing must be a JSON object");
  const unknownTop = Object.keys(doc).filter((key) => !["bindings", "timeoutMinutes"].includes(key));
  if (unknownTop.length) throw new AirlockError(`routing has unknown key: ${unknownTop[0]}`);
  if (!doc.bindings || typeof doc.bindings !== "object" || Array.isArray(doc.bindings)) throw new AirlockError("routing.bindings must be an object");
  for (const role of Object.keys(doc.bindings)) {
    if (!ROLES.has(role)) throw new AirlockError(`routing.bindings has unknown key: ${role}`);
    const tiers = doc.bindings[role];
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) throw new AirlockError(`routing.bindings.${role} must be an object`);
    for (const tier of Object.keys(tiers)) {
      if (!ROUTING_TIERS.has(tier)) throw new AirlockError(`routing.bindings.${role} has unknown key: ${tier}`);
      validateRoutingSlot(tiers[tier], `routing.bindings.${role}.${tier}`);
    }
  }
  if (doc.timeoutMinutes !== undefined && (typeof doc.timeoutMinutes !== "number" || !Number.isFinite(doc.timeoutMinutes) || doc.timeoutMinutes <= 0)) {
    throw new AirlockError("routing.timeoutMinutes must be a positive number");
  }
  return { bindings: doc.bindings, timeoutMinutes: doc.timeoutMinutes ?? DEFAULT_ROUTING_TIMEOUT_MINUTES, path: routingPath };
}

function routingSlot(routing, role, tier) {
  const slot = routing.bindings?.[role]?.[tier];
  if (!slot) throw new AirlockError(`routing.bindings.${role}.${tier} is missing in ${routing.path}`);
  return slot;
}

function executorInvocation(executor, model, effort, lastMessagePath) {
  if (executor === "claude") {
    return { command: "claude", args: ["--print", "--model", model, ...(effort !== undefined ? ["--effort", effort] : []), "--permission-mode", "bypassPermissions"], lastMessagePath: null };
  }
  if (executor === "codex") {
    return { command: "codex", args: ["exec", "-m", model, ...(effort !== undefined ? ["-c", `model_reasoning_effort=${effort}`] : []), "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--output-last-message", lastMessagePath], lastMessagePath };
  }
  if (executor === "opencode") {
    return { command: "opencode", args: ["run", "-m", model, ...(effort !== undefined ? ["--variant", effort] : []), "--auto"], lastMessagePath: null };
  }
  throw new AirlockError(`unknown executor: ${executor}`);
}

function workerPrompt(task, brief) {
  return `${roleBody(task.role).trim()}\n\n${brief}`;
}

function spawnWorker(root, invocation, prompt, timeoutMinutes) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  return spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: "utf8",
    input: prompt,
    timeout: Math.max(1, Math.round(timeoutMinutes * 60_000)),
    maxBuffer: 32 * 1024 * 1024,
    env,
    shell: process.platform === "win32",
  });
}

function evidenceFromWorker(finalMessage) {
  const lines = String(finalMessage ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const match = lines.length ? lines.at(-1).match(/^EVIDENCE: (PASS|FAIL) (.+)$/) : null;
  if (!match) return { pass: false, evidence: "worker returned no EVIDENCE line" };
  return { pass: match[1] === "PASS", evidence: match[2].trim() };
}

function runPlan(root, planPath, flags) {
  const routing = readRouting(flags.routing ? path.resolve(String(flags.routing)) : defaultRoutingPath());
  const lines = [];
  const results = [];
  const emit = (line) => {
    lines.push(line);
    if (!flags.json) process.stdout.write(`${line}\n`);
  };
  while (true) {
    const plan = readPlan(planPath);
    const selection = nextText(root, plan);
    if (selection.parked?.length) throw new AirlockError(`PARKED: ${selection.parked.map((item) => item.id).join(", ")}`, 2);
    if (!selection.selected) {
      emit(selection.text);
      if (flags.json) output({ text: lines.join("\n"), results }, true);
      return;
    }
    const task = selection.selected.task;
    const slot = routingSlot(routing, task.role, isExpensive(task) ? "expensive" : "default");
    const prompt = workerPrompt(task, selection.text);
    const lastMessagePath = path.join(tmpdir(), `airlock-${task.id}-${process.pid}-${Date.now()}.txt`);
    const invocation = executorInvocation(slot.executor, slot.model, slot.effort, lastMessagePath);
    if (flags["dry-run"]) {
      const commandLine = [invocation.command, ...invocation.args].join(" ");
      const text = [`TASK ${task.id} · ${task.role} · ${slot.executor}`, `COMMAND ${commandLine}`, `PROMPT ${prompt.length} characters`].join("\n");
      return output(flags.json ? { text, task: task.id, executor: slot.executor, command: commandLine, promptLength: prompt.length } : text, flags.json);
    }
    startTask(root, planPath, plan, task.id);
    const worker = spawnWorker(root, invocation, prompt, routing.timeoutMinutes);
    let reason = null;
    if (worker.error?.code === "ETIMEDOUT" || (worker.status === null && worker.signal)) reason = `executor ${invocation.command} timed out after ${routing.timeoutMinutes} minutes`;
    else if (worker.error) reason = `executor ${invocation.command} failed to start: ${worker.error.message}`;
    else if (worker.status !== 0) {
      const detail = (worker.stderr ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
      reason = `executor ${invocation.command} exited ${worker.status}${detail ? `: ${detail}` : ""}`;
    }
    let verdict = null;
    if (!reason) {
      let finalMessage = worker.stdout ?? "";
      if (invocation.lastMessagePath && existsSync(invocation.lastMessagePath)) finalMessage = readFileSync(invocation.lastMessagePath, "utf8");
      verdict = evidenceFromWorker(finalMessage);
      if (!verdict.pass) reason = verdict.evidence;
    }
    if (invocation.lastMessagePath) rmSync(invocation.lastMessagePath, { force: true });
    if (!reason) {
      const audit = auditTask(root, planPath, task, undefined, plan);
      if (audit.outOfScope.length) {
        reason = [
          `IN SCOPE${audit.inScope.length ? `\n${audit.inScope.map((item) => `  ${item}`).join("\n")}` : "\n  (none)"}`,
          `OUT OF SCOPE\n${audit.outOfScope.map((item) => `  ${item}`).join("\n")}`,
        ].join("\n");
      }
    }
    if (reason) {
      blockTask(root, planPath, plan, task.id, reason);
      emit(`RAN ${task.id} BLOCKED ${reason}`);
      results.push({ task: task.id, outcome: "blocked", reason });
      process.exitCode = 1;
      if (flags.json) output({ text: lines.join("\n"), results }, true);
      return;
    }
    const completion = completeTask(root, planPath, plan, task.id, verdict.evidence);
    if (completion.review) {
      process.stderr.write(`REVIEW ${completion.review.used}/${completion.review.budget} lines\n`);
      if (completion.review.exceeded) process.stderr.write("REVIEW BUDGET EXCEEDED: open the pull request now and start the next plan.\n");
    }
    emit(`RAN ${task.id} DONE ${completion.commit}`);
    results.push({ task: task.id, outcome: "done", commit: completion.commit });
    if (!flags.all) {
      if (flags.json) output({ text: lines.join("\n"), results }, true);
      return;
    }
  }
}

function roleSource(role) {
  const rolePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "roles", `${role}.md`);
  return readFileSync(rolePath, "utf8");
}

function roleBody(role) {
  return roleSource(role).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function roleDescription(role) {
  const description = roleSource(role).match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!description) throw new AirlockError(`role ${role} has no description declaration`);
  return description;
}

function openCodeAgentMarkdown(role) {
  const permission = role === "builder" ? "" : "permission:\n  edit: deny\n";
  return `---\ndescription: ${roleDescription(role)}\nmode: subagent\n${permission}---\n\n${roleBody(role)}`;
}

async function bootstrapOpenCode(root) {
  const created = [];
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const commandPath = path.join(root, ".opencode", "command", "airlock.md");
  const source = readFileSync(path.join(sourceRoot, ".opencode", "command", "airlock.md"), "utf8");
  if (!existsSync(commandPath)) {
    await mkdir(path.dirname(commandPath), { recursive: true });
    await writeFile(commandPath, source, "utf8");
    created.push(commandPath);
  } else {
    const current = readFileSync(commandPath, "utf8");
    if (contentHash(current) !== contentHash(source)) {
      if (LEGACY_OPENCODE_COMMAND_HASHES.has(contentHash(current))) {
        await writeFile(commandPath, source, "utf8");
        created.push(commandPath);
      } else if (!current.includes("AGENT airlock-")) {
        throw new AirlockError(`custom OpenCode Airlock command lacks static agent dispatch: ${commandPath}; merge the current packaged command manually`);
      }
    }
  }
  for (const role of ROLES) {
    const agentPath = path.join(root, ".opencode", "agent", `airlock-${role}.md`);
    if (existsSync(agentPath)) continue;
    await mkdir(path.dirname(agentPath), { recursive: true });
    await writeFile(agentPath, openCodeAgentMarkdown(role), "utf8");
    created.push(agentPath);
  }
  return created;
}

function parseReviewLines(raw) {
  if (raw === undefined) return null;
  const value = typeof raw === "string" && /^[+-]?\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) throw new AirlockError("budget.reviewLines must be a positive integer");
  return value;
}

function excludeAirlockDirectory(root) {
  const excludePath = path.resolve(root, git(root, ["rev-parse", "--git-path", "info/exclude"]).trim());
  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  if (current.split(/\r?\n/).some((line) => line.trim() === ".airlock/")) return;
  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  try {
    mkdirSync(path.dirname(excludePath), { recursive: true });
    writeFileSync(excludePath, `${prefix}.airlock/\n`, "utf8");
  } catch (error) {
    throw new AirlockError(`cannot write ${excludePath}: ${error.message}`);
  }
}

async function initPlan(root, planPath, goal, flags) {
  const existing = existsSync(planPath);
  if (existing && flags.host !== "opencode") throw new AirlockError(`refusing to overwrite existing plan: ${planPath}`);
  let plan;
  if (existing) {
    plan = readPlan(planPath);
  } else {
    const done = String(flags.done ?? "").split("|").map((item) => item.trim()).filter(Boolean);
    if (done.length === 0) throw new AirlockError("init requires at least one testable done criterion via --done \"criterion|criterion\"");
    const reviewLines = parseReviewLines(flags["review-lines"]);
    await mkdir(path.dirname(planPath), { recursive: true });
    plan = {
      schema: SCHEMA,
      goal: requireValue(goal, "goal"),
      done,
      nonGoals: [],
      created: commandNow(),
      budget: { maxTasks: Number(flags["max-tasks"] ?? 8), maxExpensive: Number(flags["max-expensive"] ?? 2), ...(reviewLines === null ? {} : { reviewLines }) },
      tasks: [],
      decisions: [],
    };
    validatePlan(plan);
    writePlan(planPath, plan);
  }
  const bootstrap = flags.host === "opencode" ? await bootstrapOpenCode(root) : [];
  if (existsSync(path.join(root, ".git"))) {
    excludeAirlockDirectory(root);
    if (bootstrap.length) {
      const paths = bootstrap.filter(existsSync).map((item) => normalizePath(path.relative(root, item)));
      git(root, ["add", "--", ...paths]);
    }
  }
  return plan;
}

function help() {
  return [
    "Usage: airlock <init|next|start|run|done|block|ask|answer|status|audit|render> [arguments] [--plan path] [--json]",
    "init only: --host claude|opencode (opencode bootstraps .opencode/command and .opencode/agent files)",
    "run only: --all (loop until nothing is runnable), --dry-run (print the resolved command), --routing <path> (default ~/.airlock/routing.json)",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseCli(argv);
  const command = positional.shift();
  if (!command || command === "help" || flags.help) return output(help(), flags.json);
  const root = findRoot();
  commandTimestamp = commandNow();
  if (command === "init") {
    const planPath = flags.plan ? path.resolve(flags.plan) : defaultInitPlanPath(root);
    const plan = await initPlan(root, planPath, positional.join(" "), flags);
    return output({ text: `INITIALIZED ${planPath}`, plan }, flags.json);
  }
  const planPath = findPlan(root, flags.plan);
  const plan = readPlan(planPath);
  if (command === "next") {
    if (positional.length) throw new AirlockError(`next accepts no positional arguments: ${positional.join(" ")}`);
    const result = nextText(root, plan);
    if (flags.unattended && result.parked?.length) throw new AirlockError(`PARKED: ${result.parked.map((item) => item.id).join(", ")}`, 2);
    return output({ text: result.text, task: result.selected?.task?.id ?? null, agent: result.selected ? taskAgent(result.selected.task) : null }, flags.json);
  }
  if (command === "status") {
    const review = reviewState(plan);
    return output({ text: statusText(plan), plan, ...(review ? { review } : {}) }, flags.json);
  }
  if (command === "render") return output({ text: flags.md ? renderMarkdown(plan) : statusText(plan) }, flags.json);
  if (command === "run") {
    if (positional.length) throw new AirlockError(`run accepts no positional arguments: ${positional.join(" ")}`);
    return runPlan(root, planPath, flags);
  }
  if (command === "start") {
    const started = startTask(root, planPath, plan, positional[0], flags);
    return output({ text: [`STARTED ${started.task.id}${started.resumed ? " (resume)" : ""}`, `AGENT ${taskAgent(started.task)}`].join("\n"), task: started.task, agent: taskAgent(started.task) }, flags.json);
  }
  if (command === "audit") {
    const task = taskById(plan, requireValue(positional[0], "task id"));
    const audit = auditTask(root, planPath, task, flags.range, plan);
    const recovery = flags["revert-out-of-scope"] && audit.outOfScope.length ? preservePaths(root, audit.outOfScope, "reverted") : null;
    const remaining = recovery ? auditTask(root, planPath, task, flags.range, plan) : audit;
    const text = [
      `IN SCOPE${remaining.inScope.length ? `\n${remaining.inScope.map((item) => `  ${item}`).join("\n")}` : "\n  (none)"}`,
      `OUT OF SCOPE${remaining.outOfScope.length ? `\n${remaining.outOfScope.map((item) => `  ${item}`).join("\n")}` : "\n  (none)"}`,
      ...(remaining.foreign.length ? [`FOREIGN\n${remaining.foreign.map((item) => `  ${item}`).join("\n")}`] : []),
      ...(recovery ? [`RECOVERY ${recovery}`] : []),
    ].join("\n");
    if (remaining.outOfScope.length) throw Object.assign(new AirlockError(text), { audit: remaining });
    return output({ text, ...remaining, recovery }, flags.json);
  }
  if (command === "done") {
    const completion = completeTask(root, planPath, plan, positional[0], flags.evidence);
    if (completion.review) {
      process.stderr.write(`REVIEW ${completion.review.used}/${completion.review.budget} lines\n`);
      if (completion.review.exceeded) process.stderr.write("REVIEW BUDGET EXCEEDED: open the pull request now and start the next plan.\n");
    }
    return output({ text: `DONE ${completion.task.id} ${completion.commit}`, task: completion.task, commit: completion.commit, ...(completion.review ? { review: completion.review } : {}) }, flags.json);
  }
  if (command === "block") {
    const reason = requireValue(flags.reason, "--reason");
    const task = blockTask(root, planPath, plan, positional[0], reason);
    return output({ text: `BLOCKED ${task.id}: ${reason}`, task }, flags.json);
  }
  if (command === "ask") {
    const blocking = Boolean(flags.blocking);
    const goalLevel = blocking && flags.case === "goal" && !flags.task;
    const task = goalLevel ? null : taskById(plan, requireValue(flags.task ?? positional.shift(), "task id"));
    const question = requireValue(positional.join(" "), "question");
    const options = String(requireValue(flags.options, "--options")).split("|").map((item) => item.trim()).filter(Boolean);
    if (options.length < 2) throw new AirlockError("--options needs at least two pipe-separated values");
    const assumed = flags.assume;
    if (blocking && assumed) throw new AirlockError("ask cannot use both --blocking and --assume");
    if (blocking && !BLOCKING_CASES.has(flags.case)) throw new AirlockError(`--blocking requires --case ${[...BLOCKING_CASES].join("|")}`);
    if (!blocking && (!isNonEmptyString(assumed) || !options.includes(assumed))) throw new AirlockError("assume-mode ask requires --assume matching an option");
    const id = nextDecisionId(plan);
    const decision = { id, question, options, recommendation: flags.recommend && options.includes(flags.recommend) ? flags.recommend : blocking ? options[0] : assumed, mode: blocking ? "block" : "assume", assumed: blocking ? null : assumed, blocks: task ? [task.id] : [], consumedBy: [], status: "open", answer: null, askedAt: commandNow(), ...(blocking ? { case: flags.case } : {}) };
    plan.decisions.push(decision);
    if (blocking && task) {
      task.status = "needs-you";
      task.note = `waiting on ${id}`;
    }
    writePlan(planPath, plan);
    return output({ text: `ASKED ${id}`, decision }, flags.json);
  }
  if (command === "answer") {
    const decision = decisionById(plan, requireValue(positional[0], "decision id"));
    const answer = requireValue(positional.slice(1).join(" "), "answer");
    if (decision.status !== "open") throw new AirlockError(`decision ${decision.id} is already answered`);
    if (!decision.options.includes(answer)) throw new AirlockError(`answer for ${decision.id} must be one of: ${decision.options.join(" | ")}`);
    decision.status = "answered";
    decision.answer = answer;
    for (const taskId of decision.blocks) {
      const task = taskById(plan, taskId);
      if (task.status === "needs-you") {
        task.status = "todo";
        task.note = null;
      }
    }
    const rework = (decision.mode ?? "assume") === "assume" && answer !== decision.assumed ? [...decision.consumedBy] : [];
    for (const taskId of rework) {
      const task = taskById(plan, taskId);
      task.status = "todo";
      task.evidence = [];
      task.startedAt = null;
      task.finishedAt = null;
      task.note = `reopened after ${decision.id} changed from ${decision.assumed} to ${answer}`;
    }
    writePlan(planPath, plan);
    if (rework.length) throw new AirlockError(`REWORK REQUIRED: ${rework.join(", ")}`);
    return output({ text: `ANSWERED ${decision.id}`, decision }, flags.json);
  }
  throw new AirlockError(`unknown command: ${command}`);
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
}

export { AirlockError, auditTask, globPattern, nextText, ownsPath, upgradePlan, validatePlan };
