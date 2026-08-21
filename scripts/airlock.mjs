#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA = "airlock.plan/v3";
const ROLES = new Set(["builder", "checker", "browser"]);
const RISKS = new Set(["light", "standard", "complex", "critical"]);
const STATUSES = new Set(["todo", "doing", "blocked", "needs-you", "done"]);
const DECISION_MODES = new Set(["assume", "block"]);
const BLOCKING_CASES = new Set(["irreversible", "external", "access", "rework", "goal"]);
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const OFFER_PIN_TTL_MS = 5 * 60 * 1000;
const LEGACY_OPENCODE_COMMAND_HASHES = new Set(["93a2001777ddc9dfb0ca02954f7b577d669d352704fbb47b07b1296ad0a9307e"]);
let commandTimestamp = null;
let clockOverride = false;
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

function routerStatePath(root) {
  if (!existsSync(path.join(root, ".git"))) return path.join(userConfigDir(), "router-state.json");
  const common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  return path.resolve(root, common, "airlock", "router-state.json");
}

function parseClock(value, label, end = false) {
  if (!isNonEmptyString(value) || !/^([01]\d|2[0-4]):[0-5]\d$/.test(value)) throw new AirlockError(`${label} must be HH:MM UTC`);
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === 24 && (minutes !== 0 || !end)) throw new AirlockError(`${label} may use 24:00 only as a window end`);
  return hours * 60 + minutes;
}

function validateCandidate(candidate, label) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new AirlockError(`${label} must be an object`);
  if (!isNonEmptyString(candidate.model) || !isNonEmptyString(candidate.effort)) throw new AirlockError(`${label} requires model and effort`);
  return { model: candidate.model, effort: candidate.effort };
}

function validateFallbacks(fallbacks, primary, label, version) {
  if (fallbacks === undefined) return [];
  if (version < 3) throw new AirlockError(`${label} fallbacks require version 3`);
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) throw new AirlockError(`${label} fallbacks must be a non-empty array`);
  const normalized = fallbacks.map((candidate, index) => validateCandidate(candidate, `${label} fallbacks[${index}]`));
  const seen = new Set([`${primary.model}\0${primary.effort}`]);
  for (const candidate of normalized) {
    const key = `${candidate.model}\0${candidate.effort}`;
    if (seen.has(key)) throw new AirlockError(`${label} has duplicate fallback candidate: ${candidate.model} at ${candidate.effort}`);
    seen.add(key);
  }
  return normalized;
}

function validateWindow(window, label, version) {
  if (!window || typeof window !== "object" || Array.isArray(window)) throw new AirlockError(`${label} must be an object`);
  if (!isNonEmptyString(window.name)) throw new AirlockError(`${label} requires name`);
  if (!Array.isArray(window.days) || window.days.length === 0 || window.days.some((day) => !["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(day))) throw new AirlockError(`${label} days must contain valid weekdays`);
  if (!isNonEmptyString(window.utc) || !/^.+-.+$/.test(window.utc)) throw new AirlockError(`${label} utc must be START-END`);
  const [start, end, extra] = window.utc.split("-");
  if (extra !== undefined) throw new AirlockError(`${label} utc must be START-END`);
  const startMinutes = parseClock(start, `${label} start`);
  const endMinutes = parseClock(end, `${label} end`, true);
  if (startMinutes >= endMinutes) throw new AirlockError(`${label} cannot cross midnight; use two windows such as 22:00-24:00 and 00:00-02:00`);
  const primary = validateCandidate(window, label);
  const fallbacks = validateFallbacks(window.fallbacks, primary, label, version);
  return { ...window, ...primary, fallbacks, startMinutes, endMinutes };
}

function validateRoute(route, label, version) {
  const primary = validateCandidate(route, label);
  const fallbacks = validateFallbacks(route.fallbacks, primary, label, version);
  if (route.windows === undefined) return { ...primary, fallbacks, windows: [] };
  if (version === 1) throw new AirlockError(`${label} windows require version 2`);
  if (!Array.isArray(route.windows) || route.windows.length === 0) throw new AirlockError(`${label} windows must be a non-empty array`);
  const windows = route.windows.map((window, index) => validateWindow(window, `${label} windows[${index}]`, version));
  const names = new Set();
  for (const window of windows) {
    if (names.has(window.name)) throw new AirlockError(`${label} has duplicate window name: ${window.name}`);
    names.add(window.name);
  }
  for (let left = 0; left < windows.length; left += 1) {
    for (let right = left + 1; right < windows.length; right += 1) {
      if (windows[left].days.some((day) => windows[right].days.includes(day)) && windows[left].startMinutes < windows[right].endMinutes && windows[right].startMinutes < windows[left].endMinutes) {
        throw new AirlockError(`${label} windows ${windows[left].name} and ${windows[right].name} overlap`);
      }
    }
  }
  return { ...primary, fallbacks, windows };
}

function routeEntries(routes, host) {
  const entries = [];
  for (const [role, risks] of Object.entries(routes[host] ?? {})) {
    if (!ROLES.has(role)) throw new AirlockError(`local model configuration has invalid ${host} role: ${role}`);
    if (!risks || typeof risks !== "object" || Array.isArray(risks)) throw new AirlockError(`local model configuration has invalid ${host} routes for role: ${role}`);
    for (const [risk, route] of Object.entries(risks)) {
      if (!RISKS.has(risk)) throw new AirlockError(`local model configuration has invalid ${host} risk: ${role}/${risk}`);
      const sourceVersion = routes.routeVersions?.[host]?.[role]?.[risk] ?? routes.version;
      entries.push({ role, risk, route: validateRoute(route, `${host}/${role}/${risk}`, sourceVersion), sourceVersion });
    }
  }
  return entries;
}

function mergeRoutes(base, override) {
  const merged = {
    version: Math.max(base.version, override.version),
    claude: structuredClone(base.claude),
    opencode: structuredClone(base.opencode),
    catalog: structuredClone(base.catalog ?? {}),
    routeVersions: structuredClone(base.routeVersions ?? { claude: {}, opencode: {} }),
  };
  for (const host of ["claude", "opencode"]) {
    for (const [role, risks] of Object.entries(override[host] ?? {})) {
      merged[host] ??= {};
      merged[host][role] ??= {};
      Object.assign(merged[host][role], risks);
      merged.routeVersions[host] ??= {};
      merged.routeVersions[host][role] ??= {};
      Object.assign(merged.routeVersions[host][role], override.routeVersions?.[host]?.[role] ?? Object.fromEntries(Object.keys(risks).map((risk) => [risk, override.version])));
    }
  }
  for (const [host, catalog] of Object.entries(override.catalog ?? {})) merged.catalog[host] = { ...(merged.catalog[host] ?? {}), ...catalog };
  return merged;
}

function readRoutes(configPath) {
  if (!existsSync(configPath)) return { version: 1, claude: {}, opencode: {}, catalog: {}, routeVersions: { claude: {}, opencode: {} } };
  const routes = readJson(configPath, "local model configuration");
  if (![1, 2, 3].includes(routes.version)) throw new AirlockError(`local model configuration at ${configPath} requires version 1, 2, or 3`);
  for (const host of ["claude", "opencode"]) {
    if (routes[host] !== undefined && (!routes[host] || typeof routes[host] !== "object" || Array.isArray(routes[host]))) throw new AirlockError(`local model configuration at ${configPath} has invalid ${host}`);
  }
  if (routes.catalog !== undefined && (!routes.catalog || typeof routes.catalog !== "object" || Array.isArray(routes.catalog))) throw new AirlockError(`local model configuration at ${configPath} has invalid catalog`);
  const normalized = { version: routes.version, claude: routes.claude ?? {}, opencode: routes.opencode ?? {}, catalog: routes.catalog ?? {}, routeVersions: { claude: {}, opencode: {} } };
  for (const host of ["claude", "opencode"]) {
    for (const { role, risk } of routeEntries(normalized, host)) {
      normalized.routeVersions[host][role] ??= {};
      normalized.routeVersions[host][role][risk] = routes.version;
    }
  }
  return normalized;
}

function loadRoutes(root) {
  const user = readRoutes(userConfigPath());
  if (!existsSync(path.join(root, ".git"))) return user;
  const project = readRoutes(projectConfigPath(root));
  return mergeRoutes(user, project);
}

function dayName(timestamp) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(timestamp).getUTCDay()];
}

function openCodeVariantError(model, effort) {
  const provider = model.split("/", 1)[0];
  return [
    `OpenCode model ${model} does not declare variant ${effort} in local catalog.`,
    `Add it under catalog.opencode[${JSON.stringify(model)}].variants in ${userConfigPath()}.`,
    `Discover the legal names with: opencode models ${provider} --verbose`,
  ].join("\n");
}

function resolveConfiguredRoute(routes, task, host, timestamp = commandNow()) {
  if (!["claude", "opencode"].includes(host)) throw new AirlockError(`unsupported host: ${host}`);
  const raw = routes[host]?.[task.role]?.[task.risk];
  if (!raw) {
    throw new AirlockError(`missing local route for ${host}/${task.role}/${task.risk}; configure it with airlock config --host ${host} --role ${task.role} --risk ${task.risk} --model <model> --effort <effort>`);
  }
  const label = `${host}/${task.role}/${task.risk}`;
  const sourceVersion = routes.routeVersions?.[host]?.[task.role]?.[task.risk] ?? routes.version;
  const route = validateRoute(raw, label, sourceVersion);
  const bindings = [route, ...route.windows];
  for (const binding of bindings) {
    for (const candidate of [binding, ...binding.fallbacks]) {
      if (host === "claude" && !CLAUDE_EFFORTS.has(candidate.effort)) throw new AirlockError(`invalid Claude effort for ${task.role}/${task.risk}: ${candidate.effort}`);
      const declared = routes.catalog?.opencode?.[candidate.model]?.variants;
      if (host === "opencode") {
        if (!Array.isArray(declared) || declared.some((variant) => !isNonEmptyString(variant)) || !declared.includes(candidate.effort)) throw new AirlockError(openCodeVariantError(candidate.model, candidate.effort));
      }
    }
  }
  const date = new Date(timestamp);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const window = route.windows.find((item) => item.days.includes(dayName(timestamp)) && item.startMinutes <= minute && minute < item.endMinutes);
  const selected = window ?? route;
  const candidates = [selected, ...selected.fallbacks].map(({ model, effort }) => ({ model, effort }));
  const resolved = { ...candidates[0], candidates, candidateIndex: 0, name: window?.name ?? "default", evaluatedAt: timestamp };
  return resolved;
}

function pinKey(root, planPath, task, host) {
  return `${host}:${normalizePath(path.resolve(root))}:${normalizePath(path.resolve(planPath))}:${task.id}`;
}

function readRouterState(root) {
  const statePath = routerStatePath(root);
  if (!existsSync(statePath)) return { version: 2, pins: {} };
  const state = readJson(statePath, "local router state");
  if (![1, 2].includes(state.version) || !state.pins || typeof state.pins !== "object" || Array.isArray(state.pins)) throw new AirlockError(`invalid local router state: ${statePath}`);
  return { version: 2, pins: Object.fromEntries(Object.entries(state.pins).map(([key, pin]) => [key, normalizePin(pin)])) };
}

function writeRouterState(root, state) {
  const statePath = routerStatePath(root);
  mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...state, version: 2 }, null, 2)}\n`, "utf8");
  renameSync(temporary, statePath);
}

function normalizePin(pin) {
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return pin;
  const legacy = { model: pin.model, effort: pin.effort, agent: pin.agent };
  const candidates = Array.isArray(pin.candidates) && pin.candidates.length ? pin.candidates : [legacy];
  const candidateIndex = Number.isSafeInteger(pin.candidateIndex) && pin.candidateIndex >= 0 && pin.candidateIndex < candidates.length ? pin.candidateIndex : 0;
  const active = candidates[candidateIndex];
  return { ...pin, ...active, candidates, candidateIndex, agent: active.agent ?? pin.agent, failures: Array.isArray(pin.failures) ? pin.failures : [] };
}

function routeFor(task, root, host, planPath = null) {
  if (planPath) {
    const pin = readRouterState(root).pins[pinKey(root, planPath, task, host)];
    const expired = task.status !== "doing" && (!isNonEmptyString(pin?.expiresAt) || Date.parse(pin.expiresAt) <= Date.parse(commandNow()));
    if (pin && !expired) return { ...normalizePin(pin), pinned: true };
  }
  const recovered = task.status === "doing" && isNonEmptyString(task.startedAt);
  return { ...resolveConfiguredRoute(loadRoutes(root), task, host, recovered ? task.startedAt : commandNow()), pinned: false, recovered };
}

function ensureRoutePin(root, planPath, task, host) {
  const state = readRouterState(root);
  const key = pinKey(root, planPath, task, host);
  const existing = state.pins[key];
  const expired = task.status !== "doing" && (!isNonEmptyString(existing?.expiresAt) || Date.parse(existing.expiresAt) <= Date.parse(commandNow()));
  if (existing && !expired) return existing;
  const { pinned, ...route } = routeFor(task, root, host, planPath);
  const candidates = route.candidates.map((candidate) => ({ ...candidate, agent: agentName(task.role, candidate) }));
  const pin = { ...route, ...candidates[0], candidates, candidateIndex: 0, agent: candidates[0].agent, failures: [], expiresAt: task.status === "doing" ? null : new Date(Date.parse(route.evaluatedAt) + OFFER_PIN_TTL_MS).toISOString() };
  state.pins[key] = pin;
  writeRouterState(root, state);
  return pin;
}

function clearRoutePins(root, planPath, task, host = null) {
  const state = readRouterState(root);
  let changed = false;
  for (const selectedHost of host ? [host] : ["claude", "opencode"]) {
    const key = pinKey(root, planPath, task, selectedHost);
    if (!state.pins[key]) continue;
    delete state.pins[key];
    changed = true;
  }
  if (changed) writeRouterState(root, state);
}

function activateRoutePin(root, planPath, task, host) {
  const state = readRouterState(root);
  const key = pinKey(root, planPath, task, host);
  if (!state.pins[key] || state.pins[key].expiresAt === null) return;
  state.pins[key].expiresAt = null;
  writeRouterState(root, state);
}

function clearInactiveRoutePins(root, planPath, plan, host, selectedTask) {
  const state = readRouterState(root);
  const active = new Set(plan.tasks.filter((task) => task.status === "doing").map((task) => task.id));
  if (selectedTask) active.add(selectedTask.id);
  let changed = false;
  for (const task of plan.tasks) {
    const key = pinKey(root, planPath, task, host);
    if (state.pins[key] && !active.has(task.id)) {
      delete state.pins[key];
      changed = true;
    }
  }
  if (changed) writeRouterState(root, state);
}

function agentName(role, route) {
  const slug = `${route.model}-${route.effort}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `airlock-${role}-${slug}`;
}

function routeAgentPath(root, role, host, route) {
  const directory = host === "opencode" ? path.join(openCodeConfigDir(), "agents") : claudeAgentsDir();
  return path.join(directory, `${agentName(role, route)}.md`);
}

function assertRouteAgent(root, task, host, route) {
  const agentPath = routeAgentPath(root, task.role, host, route);
  if (host === "claude") {
    const shadow = path.join(root, ".claude", "agents", path.basename(agentPath));
    if (existsSync(shadow)) throw new AirlockError(`project agent shadows local Airlock route: ${shadow}`);
  }
  if (!existsSync(agentPath)) throw new AirlockError(`missing generated ${host} agent: ${agentPath}; run airlock config --sync --host ${host}`);
  return agentPath;
}

function assertSelectedAgent(root, task, host, planPath) {
  if (host === "claude" && isNonEmptyString(process.env.CLAUDE_CODE_SUBAGENT_MODEL)) throw new AirlockError("CLAUDE_CODE_SUBAGENT_MODEL overrides Airlock routing; unset it before dispatch");
  const route = routeFor(task, root, host, planPath);
  const candidates = route.candidates ?? [route];
  for (const candidate of candidates) assertRouteAgent(root, task, host, candidate);
  return routeAgentPath(root, task.role, host, route);
}

function routeState(route) {
  if (route.recovered) return "RECOVERED";
  return route.pinned ? "PINNED" : "PREVIEW";
}

function routeOutput(task, route) {
  const candidates = (route.candidates ?? [{ model: route.model, effort: route.effort }]).map((candidate) => ({ ...candidate, agent: candidate.agent ?? agentName(task.role, candidate) }));
  return { model: route.model, effort: route.effort, route: route.name, evaluatedAt: route.evaluatedAt, expiresAt: route.expiresAt ?? null, agent: route.agent ?? agentName(task.role, route), candidateIndex: route.candidateIndex ?? 0, candidates, failures: route.failures ?? [], state: routeState(route), pinned: Boolean(route.pinned), previewed: !route.pinned && !route.recovered, recovered: Boolean(route.recovered), clockOverride };
}

function dispatchLines(task, route) {
  const candidates = routeOutput(task, route).candidates;
  const active = route.candidateIndex ?? 0;
  return [
    `AGENT ${candidates[active].agent}`,
    ...candidates.slice(active + 1).map((candidate, index) => `FALLBACK ${index + 1} ${candidate.agent} · ${candidate.model} · ${candidate.effort}`),
  ];
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

function taskText(root, plan, host, planPath, task, resumed) {
  if (!task.owns?.length) throw new AirlockError(`task ${task.id} has no owns paths`);
  if (!isNonEmptyString(task.acceptance)) throw new AirlockError(`task ${task.id} has no acceptance`);
  const route = routeFor(task, root, host, planPath);
  const lines = [
    `TASK ${task.id} · ${task.role} · ${route.model} · ${route.effort}`,
    `ROUTE ${routeState(route)} · ${route.name} · evaluated ${route.evaluatedAt}`,
    `GOAL  ${plan.goal}`,
    `DO    ${task.title}${resumed ? " (resume)" : ""}`,
    `OWNS  ${task.owns[0]}`,
    ...task.owns.slice(1).map((owned) => `      ${owned}`),
    `DONE  ${task.acceptance}`,
  ];
  if (clockOverride) lines.splice(2, 0, `CLOCK OVERRIDE · AIRLOCK_NOW=${commandTimestamp}`);
  lines.push(...dispatchLines(task, route));
  for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) {
    lines.push(`ASSUME ${decision.id}  ${decision.question} = ${decision.assumed}`);
  }
  lines.push(...dependencyContext(root, plan, task));
  lines.push("RULES Change only OWNS paths. If you need another path, stop and report it.", "      Return: changed paths + the command you ran + its result. Nothing else.");
  return lines.join("\n");
}

function nextText(root, plan, host, planPath = null) {
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
  return { text: taskText(root, plan, host, planPath, selected.task, selected.resumed), selected };
}

function statusText(root, plan, host, planPath = null) {
  const done = plan.tasks.filter((task) => task.status === "done").length;
  const lines = [`GOAL  ${plan.goal}        ${done}/${plan.tasks.length} done`, ...(clockOverride ? [`CLOCK OVERRIDE · AIRLOCK_NOW=${commandTimestamp}`] : [])];
  const blocking = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "block");
  const assumed = plan.decisions.filter((decision) => decision.status === "open" && (decision.mode ?? "assume") === "assume");
  const doing = plan.tasks.filter((task) => task.status === "doing");
  const blocked = plan.tasks.filter((task) => task.status === "blocked" || task.status === "needs-you");
  if (blocking.length) lines.push("NEEDS YOU", ...blocking.map((decision) => `  ${decisionSummary(decision)}`));
  if (assumed.length) lines.push("ASSUMED (confirm at the end)", ...assumed.map((decision) => `  ${decisionSummary(decision)}`));
  if (doing.length) lines.push("DOING", ...doing.map((task) => {
    const route = routeFor(task, root, host, planPath);
    const attempts = route.candidates?.length > 1 ? ` · candidate ${(route.candidateIndex ?? 0) + 1}/${route.candidates.length}` : "";
    return `  ${task.id}  ${task.title}                  ${task.role}/${route.model} · ${routeState(route)}${attempts}   ${formatDuration(task.startedAt)}`;
  }));
  if (blocked.length) lines.push("BLOCKED", ...blocked.map((task) => `  ${task.id}  ${task.title}             ${task.note ?? "waiting on a decision"}`));
  const next = selectNext(plan, root, host);
  if (next && !next.resumed) {
    const route = routeFor(next.task, root, host, planPath);
    lines.push("NEXT", `  ${next.task.id}  ${next.task.title}                  ${next.task.role}/${route.model} · ${routeState(route)}`);
  }
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

function advanceRouteFallback(root, planPath, plan, task, host, rawReason) {
  if (task.status !== "doing") throw new AirlockError(`task ${task.id} cannot fallback from ${task.status}`);
  const reason = requireValue(rawReason, "--reason").replace(/\s+/g, " ").trim().slice(0, 240);
  const audit = auditTask(root, planPath, task, undefined, plan);
  if (audit.inScope.length || audit.outOfScope.length) {
    const changed = [...audit.inScope, ...audit.outOfScope];
    throw new AirlockError(`refusing fallback for ${task.id}: failed attempt left changes in ${changed.join(", ")}; block or recover the task before redispatch`);
  }
  const state = readRouterState(root);
  const key = pinKey(root, planPath, task, host);
  const pin = normalizePin(state.pins[key]);
  if (!pin) throw new AirlockError(`task ${task.id} has no pinned ${host} route`);
  const nextIndex = pin.candidateIndex + 1;
  if (nextIndex >= pin.candidates.length) throw new AirlockError(`NO FALLBACK for ${task.id}: route ${pin.name} exhausted ${pin.candidates.length} candidate${pin.candidates.length === 1 ? "" : "s"}`);
  const next = pin.candidates[nextIndex];
  assertRouteAgent(root, task, host, next);
  const failure = { candidateIndex: pin.candidateIndex, model: pin.model, effort: pin.effort, agent: pin.agent, reason, failedAt: commandNow() };
  const updated = { ...pin, ...next, candidateIndex: nextIndex, agent: next.agent ?? agentName(task.role, next), failures: [...pin.failures, failure], expiresAt: null };
  state.pins[key] = updated;
  writeRouterState(root, state);
  return updated;
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

function renderMarkdown(root, plan, host, planPath = null) {
  const rows = plan.tasks.map((task) => `| ${task.id} | ${task.title} | ${task.status} | ${task.role}/${routeFor(task, root, host, planPath).model} |`).join("\n");
  const decisions = plan.decisions.filter((decision) => decision.status === "open").map((decision) => `- ${decisionSummary(decision)}`).join("\n") || "- None";
  return `# Airlock\n\n${statusText(root, plan, host, planPath)}\n\n## Tasks\n\n| ID | Task | State | Route |\n|---|---|---|---|\n${rows}\n\n## Decisions\n\n${decisions}\n`;
}

function roleSource(role) {
  const rolePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "roles", `${role}.md`);
  return readFileSync(rolePath, "utf8");
}

function roleBody(role) {
  return roleSource(role).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function roleTools(role) {
  const tools = roleSource(role).match(/^tools:\s*(.+)$/m)?.[1]?.trim();
  if (!tools) throw new AirlockError(`role ${role} has no tools declaration`);
  return tools;
}

function openCodeConfigDir() {
  if (isNonEmptyString(process.env.OPENCODE_CONFIG_DIR)) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  const homeConfig = path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), ".config", "opencode");
  if (existsSync(homeConfig)) return homeConfig;
  if (isNonEmptyString(process.env.XDG_CONFIG_HOME)) return path.join(process.env.XDG_CONFIG_HOME, "opencode");
  if (process.platform === "win32" && isNonEmptyString(process.env.APPDATA)) return path.join(process.env.APPDATA, "opencode");
  return homeConfig;
}

function claudeAgentsDir() {
  if (isNonEmptyString(process.env.AIRLOCK_CLAUDE_AGENT_DIR)) return path.resolve(process.env.AIRLOCK_CLAUDE_AGENT_DIR);
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), ".claude", "agents");
}

function routeCandidates(routes, host) {
  const candidates = [];
  for (const { role, risk, route } of routeEntries(routes, host)) {
    resolveConfiguredRoute(routes, { role, risk }, host);
    const bindings = [{ model: route.model, effort: route.effort, fallbacks: route.fallbacks, name: "default" }, ...route.windows];
    for (const binding of bindings) {
      for (const candidate of [binding, ...binding.fallbacks]) {
        candidates.push({ role, route: { model: candidate.model, effort: candidate.effort, name: binding.name, evaluatedAt: commandNow() } });
      }
    }
  }
  return candidates;
}

function agentMarkdown(host, role, route) {
  const name = agentName(role, route);
  const description = `description: Airlock ${role} on ${route.model} at ${route.effort} effort.\n`;
  if (host === "claude") return `---\nname: ${name}\n${description}tools: ${roleTools(role)}\nmodel: ${route.model}\neffort: ${route.effort}\n---\n\n${roleBody(role)}`;
  const permission = role === "builder" ? "" : "permission:\n  edit: deny\n";
  return `---\n${description}mode: subagent\nmodel: ${route.model}\nvariant: ${route.effort}\n${permission}---\n\n${roleBody(role)}`;
}

function desiredHostAgents(root, routes, host) {
  if (!["claude", "opencode"].includes(host)) throw new AirlockError(`unsupported host: ${host}`);
  const directory = host === "opencode" ? path.join(openCodeConfigDir(), "agents") : claudeAgentsDir();
  const candidates = routeCandidates(routes, host);
  const wanted = new Map();
  for (const candidate of candidates) {
    const name = agentName(candidate.role, candidate.route);
    const prior = wanted.get(name);
    if (prior && (prior.route.model !== candidate.route.model || prior.route.effort !== candidate.route.effort)) throw new AirlockError(`generated agent name collision for ${name}: ${prior.route.model} and ${candidate.route.model}`);
    wanted.set(name, candidate);
  }
  if (host === "claude") {
    for (const name of wanted.keys()) {
      const shadow = path.join(root, ".claude", "agents", `${name}.md`);
      if (existsSync(shadow)) throw new AirlockError(`project agent shadows local Airlock route: ${shadow}`);
    }
  }
  return { directory, wanted };
}

async function syncHostAgents(root, routes, host, prune = false) {
  const { directory, wanted } = desiredHostAgents(root, routes, host);
  const created = [];
  const existing = [];
  const updated = [];
  for (const [name, candidate] of wanted) {
    const agentPath = path.join(directory, `${name}.md`);
    const markdown = agentMarkdown(host, candidate.role, candidate.route);
    if (existsSync(agentPath)) {
      if (readFileSync(agentPath, "utf8") === markdown) existing.push(agentPath);
      else {
        await writeFile(agentPath, markdown, "utf8");
        updated.push(agentPath);
      }
      continue;
    }
    await mkdir(directory, { recursive: true });
    await writeFile(agentPath, markdown, "utf8");
    created.push(agentPath);
  }
  const stale = existsSync(directory)
    ? (await readdir(directory)).filter((name) => name.startsWith("airlock-") && name.endsWith(".md") && !wanted.has(name.slice(0, -3))).map((name) => path.join(directory, name))
    : [];
  const protectedAgents = new Set(Object.entries(readRouterState(root).pins)
    .filter(([key]) => key.startsWith(`${host}:`))
    .flatMap(([, pin]) => (pin.candidates ?? [pin]).map((candidate) => candidate.agent))
    .filter(isNonEmptyString));
  const pruned = [];
  if (prune) {
    for (const agentPath of stale.filter((item) => !protectedAgents.has(path.basename(item, ".md")))) {
      unlinkSync(agentPath);
      pruned.push(agentPath);
    }
  }
  const legacy = host === "opencode" ? path.join(openCodeConfigDir(), "agent") : null;
  const legacyAgents = legacy && existsSync(legacy) ? (await readdir(legacy)).filter((name) => name.startsWith("airlock-") && name.endsWith(".md")).map((name) => path.join(legacy, name)) : [];
  const variants = host === "opencode" ? Object.fromEntries(Object.entries(routes.catalog?.opencode ?? {}).map(([model, entry]) => [model, entry?.variants])) : {};
  return { directory, created, updated, existing, stale, pruned, legacyAgents, variants };
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
    if (LEGACY_OPENCODE_COMMAND_HASHES.has(contentHash(current))) {
      await writeFile(commandPath, source, "utf8");
      created.push(commandPath);
    } else if (!current.includes("airlock fallback <id>")) {
      throw new AirlockError(`custom OpenCode Airlock command lacks fallback support: ${commandPath}; merge the current packaged command manually`);
    }
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
      created: commandNow(),
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

function routesForWrite(routes) {
  return { version: routes.version, catalog: routes.catalog ?? {}, claude: routes.claude ?? {}, opencode: routes.opencode ?? {} };
}

function effectiveRoutesAfterUpdate(root, configPath, routes) {
  if (!existsSync(path.join(root, ".git"))) return routes;
  if (path.resolve(configPath) === path.resolve(projectConfigPath(root))) return mergeRoutes(readRoutes(userConfigPath()), routes);
  return mergeRoutes(routes, readRoutes(projectConfigPath(root)));
}

async function configureRoute(root, flags) {
  const host = requireValue(flags.host, "--host");
  if (!["claude", "opencode"].includes(host)) throw new AirlockError(`unsupported host: ${host}`);
  if (flags.sync) {
    if (flags.role || flags.risk || flags.model || flags.effort || flags.project) throw new AirlockError("config --sync accepts only --host and optional --prune");
    const configPaths = [userConfigPath(), ...(existsSync(path.join(root, ".git")) ? [projectConfigPath(root)] : [])];
    return { configPath: userConfigPath(), configPaths, ...(await syncHostAgents(root, loadRoutes(root), host, Boolean(flags.prune))) };
  }
  const role = requireValue(flags.role, "--role");
  const risk = requireValue(flags.risk, "--risk");
  const model = requireValue(flags.model, "--model");
  const effort = requireValue(flags.effort, "--effort");
  if (!ROLES.has(role)) throw new AirlockError(`invalid role: ${role}`);
  if (!RISKS.has(risk)) throw new AirlockError(`invalid risk: ${risk}`);
  if (host === "claude" && !CLAUDE_EFFORTS.has(effort)) throw new AirlockError(`invalid Claude effort: ${effort}`);
  if (flags.project && !existsSync(path.join(root, ".git"))) throw new AirlockError("--project requires a Git repository");
  const configPath = flags.project ? projectConfigPath(root) : userConfigPath();
  const routes = readRoutes(configPath);
  routes[host][role] ??= {};
  const existing = routes[host][role][risk];
  const windows = routes.version >= 2 ? existing?.windows : undefined;
  const fallbacks = routes.version >= 3 ? existing?.fallbacks : undefined;
  routes[host][role][risk] = { model, effort, ...(fallbacks ? { fallbacks } : {}), ...(windows ? { windows } : {}) };
  routes.routeVersions[host][role] ??= {};
  routes.routeVersions[host][role][risk] = routes.version;
  const effective = effectiveRoutesAfterUpdate(root, configPath, routes);
  desiredHostAgents(root, effective, host);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(routesForWrite(routes), null, 2)}\n`, "utf8");
  const sync = await syncHostAgents(root, effective, host);
  return { configPath, configPaths: [userConfigPath(), ...(existsSync(path.join(root, ".git")) ? [projectConfigPath(root)] : [])], ...sync };
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
  const plan = { schema: SCHEMA, goal: `Complete imported ledger ${path.basename(ledgerPath)}`, done: ["Imported work is verified"], nonGoals: [], created: commandNow(), budget: { maxTasks: Math.max(8, tasks.length), maxExpensive: 2 }, tasks, decisions: [] };
  if (!existsSync(path.dirname(planPath))) throw new AirlockError(`plan parent directory does not exist: ${path.dirname(planPath)}`);
  writePlan(planPath, plan);
  return plan;
}

function help() {
  return "Usage: airlock <init|config|next|start|fallback|done|block|ask|answer|status|audit|render|import> [arguments] [--plan path] [--host claude|opencode] [--json]";
}

function configText(result) {
  const lines = [`CONFIGURED ${result.configPath}`, "CONFIG PATHS", ...result.configPaths.map((item) => `  ${item}${existsSync(item) ? "" : " (absent)"}`)];
  for (const [label, paths] of [["GENERATED", result.created], ["UPDATED", result.updated], ["EXISTING", result.existing], ["STALE", result.stale], ["PRUNED", result.pruned], ["LEGACY", result.legacyAgents]]) {
    if (paths?.length) lines.push(label, ...paths.map((item) => `  ${item}`));
  }
  if (Object.keys(result.variants ?? {}).length) lines.push("VARIANTS", ...Object.entries(result.variants).map(([model, variants]) => `  ${model}: ${Array.isArray(variants) ? variants.join(", ") : "invalid declaration"}`));
  return lines.join("\n");
}

function routeGuidance(root, plan, host) {
  const routes = loadRoutes(root);
  const missing = new Map();
  for (const task of plan.tasks) {
    if (!routes[host]?.[task.role]?.[task.risk]) missing.set(`${task.role}/${task.risk}`, task);
  }
  if (!missing.size) return "";
  return `\nROUTES REQUIRED\n${[...missing.values()].map((task) => `  airlock config --host ${host} --role ${task.role} --risk ${task.risk} --model <model> --effort <effort>`).join("\n")}`;
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseCli(argv);
  const command = positional.shift();
  if (!command || command === "help" || flags.help) return output(help(), flags.json);
  const root = findRoot();
  clockOverride = isNonEmptyString(process.env.AIRLOCK_NOW) && !Number.isNaN(Date.parse(process.env.AIRLOCK_NOW));
  commandTimestamp = clockOverride ? new Date(process.env.AIRLOCK_NOW).toISOString() : now();
  const host = flags.host ?? process.env.AIRLOCK_HOST ?? "claude";
  const defaultPlanPath = flags.plan ? path.resolve(flags.plan) : path.join(root, "airlock.plan.json");
  if (command === "config") {
    if (positional.length) throw new AirlockError(`config accepts no positional arguments: ${positional.join(" ")}`);
    const result = await configureRoute(root, flags);
    return output({ text: configText(result), ...result }, flags.json);
  }
  if (command === "init") {
    const planPath = flags.plan ? path.resolve(flags.plan) : defaultPlanPath;
    const plan = await initPlan(root, planPath, positional.join(" "), flags);
    return output({ text: `INITIALIZED ${planPath}${routeGuidance(root, plan, host)}`, plan }, flags.json);
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
    const selected = selectNext(plan, root, host);
    clearInactiveRoutePins(root, planPath, plan, host, selected?.task ?? null);
    if (selected) {
      assertSelectedAgent(root, selected.task, host, planPath);
      ensureRoutePin(root, planPath, selected.task, host);
    }
    const result = nextText(root, plan, host, planPath);
    if (flags.unattended && result.parked?.length) throw new AirlockError(`PARKED: ${result.parked.map((item) => item.id).join(", ")}`, 2);
    const route = result.selected ? routeFor(result.selected.task, root, host, planPath) : null;
    return output({ text: result.text, task: result.selected?.task?.id ?? null, route: result.selected ? routeOutput(result.selected.task, route) : null, agent: result.selected ? agentName(result.selected.task.role, route) : null }, flags.json);
  }
  if (command === "status") return output({ text: statusText(root, plan, host, planPath), plan, routes: plan.tasks.filter((task) => task.status === "doing").map((task) => routeOutput(task, routeFor(task, root, host, planPath))) }, flags.json);
  if (command === "render") return output({ text: flags.md ? renderMarkdown(root, plan, host, planPath) : statusText(root, plan, host, planPath) }, flags.json);
  if (command === "start") {
    const task = taskById(plan, requireValue(positional[0], "task id"));
    if (task.status === "doing") {
      assertSelectedAgent(root, task, host, planPath);
      ensureRoutePin(root, planPath, task, host);
      activateRoutePin(root, planPath, task, host);
      const route = routeFor(task, root, host, planPath);
      return output({ text: [`STARTED ${task.id} (resume)`, `ROUTE ${routeState(route)} · ${route.name} · evaluated ${route.evaluatedAt}`, ...dispatchLines(task, route)].join("\n"), task, route: routeOutput(task, route) }, flags.json);
    }
    if (task.status !== "todo") throw new AirlockError(`task ${task.id} cannot start from ${task.status}`);
    if (!dependenciesDone(plan, task)) throw new AirlockError(`task ${task.id} has unfinished dependencies`);
    if (goalBlockingDecision(plan)) throw new AirlockError(`task ${task.id} is waiting on goal decision ${goalBlockingDecision(plan).id}`);
    if (openDecisionsFor(plan, task.id).some((decision) => (decision.mode ?? "assume") === "block")) throw new AirlockError(`task ${task.id} is waiting on a blocking decision`);
    const doing = plan.tasks.filter((item) => item.status === "doing");
    if (doing.length && (!flags.parallel || doing.some((item) => ownsOverlap(item.owns, task.owns)))) throw new AirlockError(`task ${task.id} cannot start while ${doing.map((item) => item.id).join(", ")} is doing`);
    assertCleanBoundary(root, planPath);
    assertSelectedAgent(root, task, host, planPath);
    ensureRoutePin(root, planPath, task, host);
    task.status = "doing";
    task.startedAt = commandNow();
    task.note = null;
    for (const decision of openDecisionsFor(plan, task.id).filter((item) => (item.mode ?? "assume") === "assume")) if (!decision.consumedBy.includes(task.id)) decision.consumedBy.push(task.id);
    writePlan(planPath, plan);
    activateRoutePin(root, planPath, task, host);
    const route = routeFor(task, root, host, planPath);
    return output({ text: [`STARTED ${task.id}`, `ROUTE ${routeState(route)} · ${route.name} · evaluated ${route.evaluatedAt}`, ...dispatchLines(task, route)].join("\n"), task, route: routeOutput(task, route) }, flags.json);
  }
  if (command === "fallback") {
    if (positional.length !== 1) throw new AirlockError("fallback requires exactly one task id");
    const task = taskById(plan, requireValue(positional[0], "task id"));
    if (task.status !== "doing") throw new AirlockError(`task ${task.id} cannot fallback from ${task.status}`);
    ensureRoutePin(root, planPath, task, host);
    const route = advanceRouteFallback(root, planPath, plan, task, host, flags.reason);
    const text = [`FALLBACK ${task.id} · candidate ${route.candidateIndex + 1}/${route.candidates.length}`, taskText(root, plan, host, planPath, task, true)].join("\n");
    return output({ text, task, route: routeOutput(task, { ...route, pinned: true }) }, flags.json);
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
    task.finishedAt = commandNow();
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
    clearRoutePins(root, planPath, task);
    return output({ text: `DONE ${task.id} ${commit}`, task, commit }, flags.json);
  }
  if (command === "block") {
    const task = taskById(plan, requireValue(positional[0], "task id"));
    const reason = requireValue(flags.reason, "--reason");
    if (!["todo", "doing", "needs-you"].includes(task.status)) throw new AirlockError(`task ${task.id} cannot block from ${task.status}`);
    const recovery = task.status === "doing" ? preservePaths(root, recoveryPaths(plan, task, root, planPath), "blocked", task.id) : null;
    task.status = "blocked";
    task.note = `${reason}${recovery ? `; preserved at ${recovery}` : ""}`;
    task.finishedAt = commandNow();
    writePlan(planPath, plan);
    clearRoutePins(root, planPath, task);
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
      clearRoutePins(root, planPath, task);
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
      clearRoutePins(root, planPath, task);
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

export { AirlockError, auditTask, globPattern, nextText, ownsPath, validatePlan };
