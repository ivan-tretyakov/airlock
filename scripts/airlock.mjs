#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA = "airlock.plan/v3";
const ROLES = new Set(["builder", "checker", "browser"]);
const RISKS = new Set(["light", "standard", "complex", "critical"]);
const STATUSES = new Set(["todo", "doing", "blocked", "needs-you", "done"]);
const DECISION_MODES = new Set(["assume", "block"]);
const BLOCKING_CASES = new Set(["irreversible", "external", "access", "rework", "goal"]);
class AirlockError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function now() {
  return new Date().toISOString();
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

function findPlan(root, requested) {
  if (requested) {
    const candidate = path.resolve(requested);
    if (!existsSync(candidate)) throw new AirlockError(`plan not found: ${candidate}`);
    return candidate;
  }
  const candidates = [
    path.join(root, "airlock.plan.json"),
    path.join(root, "docs", "airlock", "airlock.plan.json"),
  ].filter(existsSync);
  if (candidates.length === 0) throw new AirlockError("no airlock.plan.json found at the repository root or docs/airlock/");
  if (candidates.length > 1) throw new AirlockError("multiple plans found; select one with --plan <path>");
  return candidates[0];
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
    if (!RISKS.has(task.risk)) throw new AirlockError(`task ${task.id} has invalid risk: ${task.risk}`);
    if (task.model !== undefined) throw new AirlockError(`task ${task.id} model is not supported; configure routing locally by role and risk`);
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
  return validatePlan(readJson(planPath, "plan"));
}

function writePlan(planPath, plan) {
  validatePlan(plan);
  const temporary = `${planPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  renameSync(temporary, planPath);
}

function userConfigDir() {
  if (isNonEmptyString(process.env.AIRLOCK_CONFIG_DIR)) return path.resolve(process.env.AIRLOCK_CONFIG_DIR);
  if (isNonEmptyString(process.env.XDG_CONFIG_HOME)) return path.join(process.env.XDG_CONFIG_HOME, "airlock");
  const homeConfig = path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), ".config", "airlock");
  if (existsSync(path.dirname(homeConfig))) return homeConfig;
  if (process.platform === "darwin") return path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), "Library", "Application Support", "airlock");
  if (process.platform === "win32" && isNonEmptyString(process.env.APPDATA)) return path.join(process.env.APPDATA, "airlock");
  return homeConfig;
}

function userConfigPath() {
  return isNonEmptyString(process.env.AIRLOCK_CONFIG) ? path.resolve(process.env.AIRLOCK_CONFIG) : path.join(userConfigDir(), "models.json");
}

function projectConfigPath(root) {
  const common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  return path.resolve(root, common, "airlock", "models.json");
}

function mergeRoutes(base, override) {
  const merged = structuredClone(base);
  for (const host of ["claude", "opencode"]) {
    for (const [role, risks] of Object.entries(override[host] ?? {})) {
      merged[host] ??= {};
      merged[host][role] ??= {};
      Object.assign(merged[host][role], risks);
    }
  }
  return merged;
}

function readRoutes(configPath) {
  if (!existsSync(configPath)) return { version: 1, claude: {}, opencode: {} };
  const routes = readJson(configPath, "local model configuration");
  if (routes.version !== 1) throw new AirlockError(`local model configuration at ${configPath} requires version 1`);
  for (const host of ["claude", "opencode"]) {
    if (routes[host] !== undefined && (!routes[host] || typeof routes[host] !== "object" || Array.isArray(routes[host]))) throw new AirlockError(`local model configuration at ${configPath} has invalid ${host}`);
  }
  return { version: 1, claude: routes.claude ?? {}, opencode: routes.opencode ?? {} };
}

function loadRoutes(root) {
  const user = readRoutes(userConfigPath());
  if (!existsSync(path.join(root, ".git"))) return user;
  const project = readRoutes(projectConfigPath(root));
  return mergeRoutes(user, project);
}

function routeFor(task, root, host) {
  if (!["claude", "opencode"].includes(host)) throw new AirlockError(`unsupported host: ${host}`);
  const route = loadRoutes(root)[host]?.[task.role]?.[task.risk];
  if (!route || !isNonEmptyString(route.model) || !isNonEmptyString(route.effort)) {
    throw new AirlockError(`missing local route for ${host}/${task.role}/${task.risk}; configure it with airlock configure`);
  }
  return route;
}

function agentName(role, route) {
  const slug = `${route.model}-${route.effort}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `airlock-${role}-${slug}`;
}

function resolveModel(task, root, host) {
  return routeFor(task, root, host).model;
}

function resolveOpenCodeAgent(task, root) {
  return agentName(task.role, routeFor(task, root, "opencode"));
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
  return `${Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000))}m`;
}

function decisionSummary(decision) {
  const mode = decision.mode ?? "assume";
  if (mode === "block") return `${decision.id}  ${decision.question}  (blocks ${decision.blocks.length ? decision.blocks.join(", ") : "goal"})  recommend: ${decision.recommendation}`;
  return `${decision.id}  ${decision.question}  assumed: ${decision.assumed}   used by ${decision.consumedBy.join(", ") || "none"}`;
}

function isExpensive(task, root, host) {
  return task.risk === "critical";
}

function budgetState(plan, root, host) {
  const completed = plan.tasks.filter((task) => task.status === "done").length;
  if (completed >= plan.budget.maxTasks) return "task";
  const expensive = plan.tasks.filter((task) => ["doing", "done"].includes(task.status) && isExpensive(task, root, host)).length;
  return expensive >= plan.budget.maxExpensive ? "expensive" : null;
}

function selectNext(plan, root, host) {
  if (goalBlockingDecision(plan)) return null;
  const doing = plan.tasks.filter((task) => task.status === "doing");
  if (doing.length === 1) return { task: doing[0], resumed: true };
  if (plan.tasks.filter((task) => task.status === "done").length >= plan.budget.maxTasks) return null;
  const tasks = eligibleTasks(plan);
  const expensive = plan.tasks.filter((task) => ["doing", "done"].includes(task.status) && isExpensive(task, root, host)).length;
  const canRun = (task) => !isExpensive(task, root, host) || expensive < plan.budget.maxExpensive;
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

function nextText(root, plan, host) {
  const goalDecision = goalBlockingDecision(plan);
  if (goalDecision) return { text: `NOTHING TO DO\nWaiting on ${goalDecision.id}.`, selected: null, parked: [goalDecision] };
  const selected = selectNext(plan, root, host);
  if (!selected) {
    const openBlocking = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block");
    if (plan.tasks.every((task) => task.status === "done")) return { text: "NOTHING TO DO\nAll tasks are done.", selected: null };
    const budget = budgetState(plan, root, host);
    if (budget) return { text: `NOTHING TO DO\nBUDGET REACHED: ${budget === "task" ? "maxTasks" : "maxExpensive"}.`, selected: null };
    if (openBlocking.length) return { text: `NOTHING TO DO\nWaiting on ${openBlocking.map((item) => item.id).join(", ")}.`, selected: null, parked: openBlocking };
    return { text: "NOTHING TO DO\nAll remaining tasks are blocked.", selected: null };
  }
  const { task, resumed } = selected;
  if (!task.owns?.length) throw new AirlockError(`task ${task.id} has no owns paths`);
  if (!isNonEmptyString(task.acceptance)) throw new AirlockError(`task ${task.id} has no acceptance`);
  const lines = [
    `TASK ${task.id} · ${task.role} · ${resolveModel(task, root, host)} · ${routeFor(task, root, host).effort}`,
    `GOAL  ${plan.goal}`,
    `DO    ${task.title}${resumed ? " (resume)" : ""}`,
    `OWNS  ${task.owns[0]}`,
    ...task.owns.slice(1).map((owned) => `      ${owned}`),
    `DONE  ${task.acceptance}`,
  ];
  if (host === "opencode") lines.push(`AGENT ${resolveOpenCodeAgent(task, root)}`);
  for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) {
    lines.push(`ASSUME ${decision.id}  ${decision.question} = ${decision.assumed}`);
  }
  lines.push(...dependencyContext(root, plan, task));
  lines.push("RULES Change only OWNS paths. If you need another path, stop and report it.", "      Return: changed paths + the command you ran + its result. Nothing else.");
  return { text: lines.join("\n"), selected };
}

function statusText(root, plan, host) {
  const done = plan.tasks.filter((task) => task.status === "done").length;
  const lines = [`GOAL  ${plan.goal}        ${done}/${plan.tasks.length} done`];
  const blocking = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block");
  const assumed = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "assume");
  const doing = plan.tasks.filter((task) => task.status === "doing");
  const blocked = plan.tasks.filter((task) => task.status === "blocked" || task.status === "needs-you");
  if (blocking.length) lines.push("NEEDS YOU", ...blocking.map((decision) => `  ${decisionSummary(decision)}`));
  if (assumed.length) lines.push("ASSUMED (confirm at the end)", ...assumed.map((decision) => `  ${decisionSummary(decision)}`));
  if (doing.length) lines.push("DOING", ...doing.map((task) => `  ${task.id}  ${task.title}                  ${task.role}/${resolveModel(task, root, host)}   ${formatDuration(task.startedAt)}`));
  if (blocked.length) lines.push("BLOCKED", ...blocked.map((task) => `  ${task.id}  ${task.title}             ${task.note ?? "waiting on a decision"}`));
  const next = selectNext(plan, root, host);
  if (next && !next.resumed) lines.push("NEXT", `  ${next.task.id}  ${next.task.title}                  ${next.task.role}/${resolveModel(next.task, root, host)}`);
  if (!next && !plan.tasks.every((task) => task.status === "done") && budgetState(plan, root, host)) lines.push("BUDGET", `  ${budgetState(plan, root, host) === "task" ? "maxTasks" : "maxExpensive"} reached`);
  return lines.join("\n");
}

function output(value, json) {
  process.stdout.write(json ? `${JSON.stringify(typeof value === "string" ? { text: value } : value, null, 2)}\n` : `${typeof value === "string" ? value : value.text}\n`);
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

function taskCommit(root, planPath, task, evidence, plan) {
  const audit = auditTask(root, planPath, task, undefined, plan);
  if (audit.outOfScope.length) throw new AirlockError(`audit failed; out-of-scope paths: ${audit.outOfScope.join(", ")}`);
  const planRelative = relativePlan(root, planPath);
  const paths = [...new Set([...audit.inScope, planRelative])];
  if (paths.length === 0) throw new AirlockError(`task ${task.id} has no changes to commit`);
  git(root, ["add", "--", ...paths]);
  git(root, ["commit", "-m", `${task.id}: ${task.title}`, "-m", `Airlock-Task: ${task.id}`, "-m", `Evidence: ${evidence}`]);
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
  const message = `airlock ${kind} ${taskId} ${now()}`;
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

function renderMarkdown(root, plan, host) {
  const rows = plan.tasks.map((task) => `| ${task.id} | ${task.title} | ${task.status} | ${task.role}/${resolveModel(task, root, host)} |`).join("\n");
  const decisions = plan.decisions.filter((decision) => decision.status === "open").map((decision) => `- ${decisionSummary(decision)}`).join("\n") || "- None";
  return `# Airlock\n\n${statusText(root, plan, host)}\n\n## Tasks\n\n| ID | Task | State | Route |\n|---|---|---|---|\n${rows}\n\n## Decisions\n\n${decisions}\n`;
}

function roleBody(role) {
  const rolePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "roles", `${role}.md`);
  return readFileSync(rolePath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function openCodeConfigDir() {
  if (isNonEmptyString(process.env.OPENCODE_CONFIG_DIR)) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  const homeConfig = path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), ".config", "opencode");
  if (existsSync(homeConfig)) return homeConfig;
  if (isNonEmptyString(process.env.XDG_CONFIG_HOME)) return path.join(process.env.XDG_CONFIG_HOME, "opencode");
  if (process.platform === "win32" && isNonEmptyString(process.env.APPDATA)) return path.join(process.env.APPDATA, "opencode");
  return homeConfig;
}

async function syncOpenCodeAgents(routes) {
  const created = [];
  for (const [role, risks] of Object.entries(routes.opencode)) {
    if (!ROLES.has(role)) throw new AirlockError(`local model configuration has invalid OpenCode role: ${role}`);
    for (const [risk, route] of Object.entries(risks)) {
      if (!RISKS.has(risk) || !isNonEmptyString(route?.model) || !isNonEmptyString(route?.effort)) {
        throw new AirlockError(`local model configuration has invalid OpenCode route: ${role}/${risk}`);
      }
      const name = agentName(role, route);
      const agentPath = path.join(openCodeConfigDir(), "agent", `${name}.md`);
      if (existsSync(agentPath)) continue;
      const permission = role === "builder" ? "" : "permission:\n  edit: deny\n";
      const markdown = `---\ndescription: Airlock ${role} on ${route.model} at ${route.effort} effort.\nmode: subagent\nmodel: ${route.model}\nvariant: ${route.effort}\n${permission}---\n\n${roleBody(role)}`;
      await mkdir(path.dirname(agentPath), { recursive: true });
      await writeFile(agentPath, markdown, "utf8");
      created.push(agentPath);
    }
  }
  return created;
}

async function bootstrapOpenCode(root) {
  const created = [];
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const commandPath = path.join(root, ".opencode", "command", "airlock.md");
  if (!existsSync(commandPath)) {
    await mkdir(path.dirname(commandPath), { recursive: true });
    await writeFile(commandPath, readFileSync(path.join(sourceRoot, ".opencode", "command", "airlock.md"), "utf8"), "utf8");
    created.push(commandPath);
  }
  return created;
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
    await mkdir(path.dirname(planPath), { recursive: true });
    plan = {
      schema: SCHEMA,
      goal: requireValue(goal, "goal"),
      done,
      nonGoals: [],
      created: now(),
      budget: { maxTasks: Number(flags["max-tasks"] ?? 8), maxExpensive: Number(flags["max-expensive"] ?? 2) },
      tasks: [],
      decisions: [],
    };
    validatePlan(plan);
    writePlan(planPath, plan);
  }
  const bootstrap = flags.host === "opencode" ? await bootstrapOpenCode(root) : [];
  if (existsSync(path.join(root, ".git"))) {
    const paths = [planPath, ...bootstrap].filter(existsSync).map((item) => normalizePath(path.relative(root, item)));
    git(root, ["add", "--", ...paths]);
  }
  return plan;
}

async function configureRoute(root, flags) {
  const host = requireValue(flags.host, "--host");
  const role = requireValue(flags.role, "--role");
  const risk = requireValue(flags.risk, "--risk");
  const model = requireValue(flags.model, "--model");
  const effort = requireValue(flags.effort, "--effort");
  if (!["claude", "opencode"].includes(host)) throw new AirlockError(`unsupported host: ${host}`);
  if (!ROLES.has(role)) throw new AirlockError(`invalid role: ${role}`);
  if (!RISKS.has(risk)) throw new AirlockError(`invalid risk: ${risk}`);
  if (flags.project && !existsSync(path.join(root, ".git"))) throw new AirlockError("--project requires a Git repository");
  const configPath = flags.project ? projectConfigPath(root) : userConfigPath();
  const routes = readRoutes(configPath);
  routes[host][role] ??= {};
  routes[host][role][risk] = { model, effort };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(routes, null, 2)}\n`, "utf8");
  const created = host === "opencode" ? await syncOpenCodeAgents(loadRoutes(root)) : [];
  return { configPath, created };
}

function importLedger(root, planPath, ledgerPath) {
  if (existsSync(planPath)) throw new AirlockError(`refusing to overwrite existing plan: ${planPath}`);
  const source = readFileSync(path.resolve(ledgerPath), "utf8");
  const crossings = [...source.matchAll(/^### Crossing `?([^`\n]+)`?\s*[—-]\s*([^\n]+)$/gm)];
  if (crossings.length === 0) throw new AirlockError("import could not find any 2.x Crossing headings", 2);
  const tasks = [];
  const ambiguous = [];
  for (let index = 0; index < crossings.length; index += 1) {
    const match = crossings[index];
    const block = source.slice(match.index, crossings[index + 1]?.index ?? source.length);
    const owns = (block.match(/^[-*]\s*\*\*Owned:\*\*\s*`?([^`\n]+)`?/mi)?.[1] ?? "").split(/,\s*/).filter(Boolean);
    const acceptance = block.match(/^[-*]\s*\*\*(?:Acceptance|Evidence):\*\*\s*([^\n]+)/mi)?.[1]?.trim();
    if (!owns.length || !acceptance) {
      ambiguous.push(match[1]);
      continue;
    }
    tasks.push({ id: `T${tasks.length + 1}`, title: match[2].trim(), role: "builder", risk: "standard", owns, dependsOn: tasks.length ? [tasks[tasks.length - 1].id] : [], acceptance, status: "todo", evidence: [], startedAt: null, finishedAt: null, note: null });
  }
  if (ambiguous.length) throw new AirlockError(`import is ambiguous for Crossings: ${ambiguous.join(", ")}`, 2);
  const plan = { schema: SCHEMA, goal: `Complete imported ledger ${path.basename(ledgerPath)}`, done: ["Imported work is verified"], nonGoals: [], created: now(), budget: { maxTasks: Math.max(8, tasks.length), maxExpensive: 2 }, tasks, decisions: [] };
  if (!existsSync(path.dirname(planPath))) throw new AirlockError(`plan parent directory does not exist: ${path.dirname(planPath)}`);
  writePlan(planPath, plan);
  return plan;
}

function help() {
  return "Usage: airlock <init|config|next|start|done|block|ask|answer|status|audit|render|import> [arguments] [--plan path] [--host claude|opencode] [--json]";
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseCli(argv);
  const command = positional.shift();
  if (!command || command === "help" || flags.help) return output(help(), flags.json);
  const root = findRoot();
  const host = flags.host ?? process.env.AIRLOCK_HOST ?? "claude";
  const defaultPlanPath = flags.plan ? path.resolve(flags.plan) : path.join(root, "airlock.plan.json");
  if (command === "config") {
    if (positional.length) throw new AirlockError(`config accepts no positional arguments: ${positional.join(" ")}`);
    const result = await configureRoute(root, flags);
    return output({ text: `CONFIGURED ${result.configPath}${result.created.length ? `\nGENERATED\n${result.created.map((item) => `  ${item}`).join("\n")}` : ""}`, ...result }, flags.json);
  }
  if (command === "init") {
    const planPath = flags.plan ? path.resolve(flags.plan) : defaultPlanPath;
    const plan = await initPlan(root, planPath, positional.join(" "), flags);
    return output({ text: `INITIALIZED ${planPath}`, plan }, flags.json);
  }
  if (command === "import") {
    const planPath = flags.plan ? path.resolve(flags.plan) : defaultPlanPath;
    const plan = importLedger(root, planPath, requireValue(positional[0], "ledger path"));
    return output({ text: `IMPORTED ${plan.tasks.length} tasks into ${planPath}`, plan }, flags.json);
  }
  const planPath = findPlan(root, flags.plan);
  const plan = readPlan(planPath);
  if (command === "next") {
    if (positional.length) throw new AirlockError(`next accepts no positional arguments: ${positional.join(" ")}`);
    const result = nextText(root, plan, host);
    if (flags.unattended && result.parked?.length) throw new AirlockError(`PARKED: ${result.parked.map((item) => item.id).join(", ")}`, 2);
    return output({ text: result.text, task: result.selected?.task?.id ?? null }, flags.json);
  }
  if (command === "status") return output({ text: statusText(root, plan, host), plan }, flags.json);
  if (command === "render") return output({ text: flags.md ? renderMarkdown(root, plan, host) : statusText(root, plan, host) }, flags.json);
  if (command === "start") {
    const task = taskById(plan, requireValue(positional[0], "task id"));
    if (task.status === "doing") return output({ text: `STARTED ${task.id} (resume)`, task }, flags.json);
    if (task.status !== "todo") throw new AirlockError(`task ${task.id} cannot start from ${task.status}`);
    if (!dependenciesDone(plan, task)) throw new AirlockError(`task ${task.id} has unfinished dependencies`);
    if (goalBlockingDecision(plan)) throw new AirlockError(`task ${task.id} is waiting on goal decision ${goalBlockingDecision(plan).id}`);
    if (openDecisionsFor(plan, task.id).some((decision) => (decision.mode ?? "assume") === "block")) throw new AirlockError(`task ${task.id} is waiting on a blocking decision`);
    const doing = plan.tasks.filter((item) => item.status === "doing");
    if (doing.length && (!flags.parallel || doing.some((item) => ownsOverlap(item.owns, task.owns)))) throw new AirlockError(`task ${task.id} cannot start while ${doing.map((item) => item.id).join(", ")} is doing`);
    assertCleanBoundary(root, planPath);
    task.status = "doing";
    task.startedAt = now();
    task.note = null;
    for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) if (!decision.consumedBy.includes(task.id)) decision.consumedBy.push(task.id);
    writePlan(planPath, plan);
    return output({ text: `STARTED ${task.id}`, task }, flags.json);
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
    const task = taskById(plan, requireValue(positional[0], "task id"));
    const evidence = requireValue(flags.evidence, "--evidence");
    if (task.status !== "doing") throw new AirlockError(`task ${task.id} cannot complete from ${task.status}`);
    const audit = auditTask(root, planPath, task, undefined, plan);
    if (audit.outOfScope.length) throw new AirlockError(`audit failed; out-of-scope paths: ${audit.outOfScope.join(", ")}`);
    const original = readFileSync(planPath, "utf8");
    task.status = "done";
    task.evidence.push(evidence);
    task.finishedAt = now();
    task.note = null;
    writePlan(planPath, plan);
    let commit;
    try {
      commit = taskCommit(root, planPath, task, evidence, plan);
    } catch (error) {
      writeFileSync(planPath, original, "utf8");
      git(root, ["reset", "--", relativePlan(root, planPath)]);
      throw error;
    }
    return output({ text: `DONE ${task.id} ${commit}`, task, commit }, flags.json);
  }
  if (command === "block") {
    const task = taskById(plan, requireValue(positional[0], "task id"));
    const reason = requireValue(flags.reason, "--reason");
    if (!["todo", "doing", "needs-you"].includes(task.status)) throw new AirlockError(`task ${task.id} cannot block from ${task.status}`);
    const recovery = task.status === "doing" ? preservePaths(root, recoveryPaths(plan, task, root, planPath), "blocked", task.id) : null;
    task.status = "blocked";
    task.note = `${reason}${recovery ? `; preserved at ${recovery}` : ""}`;
    task.finishedAt = now();
    writePlan(planPath, plan);
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
    const decision = { id, question, options, recommendation: flags.recommend && options.includes(flags.recommend) ? flags.recommend : blocking ? options[0] : assumed, mode: blocking ? "block" : "assume", assumed: blocking ? null : assumed, blocks: task ? [task.id] : [], consumedBy: [], status: "open", answer: null, askedAt: now(), ...(blocking ? { case: flags.case } : {}) };
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
}

export { AirlockError, auditTask, globPattern, nextText, ownsPath, validatePlan };
