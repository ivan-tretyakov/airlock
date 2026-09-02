import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EXECUTORS = Object.freeze(["claude", "codex", "opencode"]);
export const ROLES = Object.freeze(["builder", "checker", "browser"]);
export const TIERS = Object.freeze(["default", "expensive"]);
export const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
export const MAX_FALLBACK_ADVANCES = 2;
export const DAY_NAMES = Object.freeze(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
const WEEKDAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export class RoutingError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function rejectUnknownKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new RoutingError(`${label} has unknown key: ${key}`);
  }
}

export function parseClock(value, label, end = false) {
  if (!isNonEmptyString(value) || !/^([01]\d|2[0-4]):[0-5]\d$/.test(value)) throw new RoutingError(`${label} must be HH:MM UTC`);
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === 24 && (minutes !== 0 || !end)) throw new RoutingError(`${label} may use 24:00 only as a window end`);
  return hours * 60 + minutes;
}

export function validateCandidate(candidate, label) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new RoutingError(`${label} must be an object`);
  if (!EXECUTORS.includes(candidate.executor)) throw new RoutingError(`${label} executor must be one of ${EXECUTORS.join(", ")}`);
  if (!isNonEmptyString(candidate.model)) throw new RoutingError(`${label} requires a non-empty model`);
  const effort = candidate.effort === undefined || candidate.effort === null ? null : candidate.effort;
  if (effort !== null && !isNonEmptyString(effort)) throw new RoutingError(`${label} effort must be null or a non-empty string`);
  if (candidate.executor === "claude" && effort !== null && !CLAUDE_EFFORTS.includes(effort)) {
    throw new RoutingError(`${label} effort must be one of ${CLAUDE_EFFORTS.join("|")} for executor claude`);
  }
  return { executor: candidate.executor, model: candidate.model, effort };
}

export function candidateKey(candidate) {
  return `${candidate.executor}\0${candidate.model}\0${candidate.effort ?? ""}`;
}

export function candidateLabel(candidate) {
  return `${candidate.executor} ${candidate.model}${candidate.effort ? ` at ${candidate.effort}` : ""}`;
}

export function validateFallbacks(fallbacks, primary, label) {
  if (fallbacks === undefined) return [];
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) throw new RoutingError(`${label} fallbacks must be a non-empty array`);
  if (fallbacks.length > MAX_FALLBACK_ADVANCES) throw new RoutingError(`${label} fallbacks cannot exceed ${MAX_FALLBACK_ADVANCES} candidates`);
  const normalized = fallbacks.map((candidate, index) => {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) rejectUnknownKeys(candidate, ["executor", "model", "effort"], `${label} fallbacks[${index}]`);
    return validateCandidate(candidate, `${label} fallbacks[${index}]`);
  });
  const seen = new Set([candidateKey(primary)]);
  for (const candidate of normalized) {
    const key = candidateKey(candidate);
    if (seen.has(key)) throw new RoutingError(`${label} has duplicate fallback candidate: ${candidateLabel(candidate)}`);
    seen.add(key);
  }
  return normalized;
}

export function validateWindow(window, label) {
  if (!window || typeof window !== "object" || Array.isArray(window)) throw new RoutingError(`${label} must be an object`);
  rejectUnknownKeys(window, ["name", "days", "utc", "executor", "model", "effort", "fallbacks"], label);
  if (!isNonEmptyString(window.name)) throw new RoutingError(`${label} requires name`);
  if (!Array.isArray(window.days) || window.days.length === 0 || window.days.some((day) => !WEEKDAYS.includes(day))) throw new RoutingError(`${label} days must contain valid weekdays`);
  if (!isNonEmptyString(window.utc) || !/^.+-.+$/.test(window.utc)) throw new RoutingError(`${label} utc must be START-END`);
  const [start, end, extra] = window.utc.split("-");
  if (extra !== undefined) throw new RoutingError(`${label} utc must be START-END`);
  const startMinutes = parseClock(start, `${label} start`);
  const endMinutes = parseClock(end, `${label} end`, true);
  if (startMinutes >= endMinutes) throw new RoutingError(`${label} cannot cross midnight; use two windows such as 22:00-24:00 and 00:00-02:00`);
  const primary = validateCandidate(window, label);
  const fallbacks = validateFallbacks(window.fallbacks, primary, label);
  return { name: window.name, days: [...window.days], startMinutes, endMinutes, primary, fallbacks };
}

export function validateBinding(binding, label) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new RoutingError(`${label} must be an object`);
  rejectUnknownKeys(binding, ["primary", "fallbacks", "windows"], label);
  if (binding.primary && typeof binding.primary === "object" && !Array.isArray(binding.primary)) rejectUnknownKeys(binding.primary, ["executor", "model", "effort"], `${label} primary`);
  const primary = validateCandidate(binding.primary, `${label} primary`);
  const fallbacks = validateFallbacks(binding.fallbacks, primary, label);
  if (binding.windows === undefined) return { primary, fallbacks, windows: [] };
  if (!Array.isArray(binding.windows) || binding.windows.length === 0) throw new RoutingError(`${label} windows must be a non-empty array`);
  const windows = binding.windows.map((window, index) => validateWindow(window, `${label} windows[${index}]`));
  const names = new Set();
  for (const window of windows) {
    if (names.has(window.name)) throw new RoutingError(`${label} has duplicate window name: ${window.name}`);
    names.add(window.name);
  }
  for (let left = 0; left < windows.length; left += 1) {
    for (let right = left + 1; right < windows.length; right += 1) {
      if (windows[left].days.some((day) => windows[right].days.includes(day)) && windows[left].startMinutes < windows[right].endMinutes && windows[right].startMinutes < windows[left].endMinutes) {
        throw new RoutingError(`${label} windows ${windows[left].name} and ${windows[right].name} overlap`);
      }
    }
  }
  return { primary, fallbacks, windows };
}

export function validateRouting(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new RoutingError("routing.json must be a JSON object");
  rejectUnknownKeys(config, ["version", "bindings"], "routing.json");
  if (config.version !== 1) throw new RoutingError("routing.json version must be 1");
  if (!config.bindings || typeof config.bindings !== "object" || Array.isArray(config.bindings)) throw new RoutingError("routing.json requires a bindings object");
  const bindings = {};
  for (const [role, tiers] of Object.entries(config.bindings)) {
    if (!ROLES.includes(role)) throw new RoutingError(`bindings has invalid role: ${role}`);
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) throw new RoutingError(`bindings.${role} must be an object`);
    bindings[role] = {};
    for (const [tier, binding] of Object.entries(tiers)) {
      if (!TIERS.includes(tier)) throw new RoutingError(`bindings.${role} has invalid tier: ${tier}`);
      bindings[role][tier] = validateBinding(binding, `bindings.${role}.${tier}`);
    }
  }
  return { version: 1, bindings };
}

export function routingPath(configDir) {
  return path.join(configDir, "routing.json");
}

export function loadRouting(configDir) {
  const filePath = routingPath(configDir);
  if (!existsSync(filePath)) {
    throw new RoutingError(`no routing.json at ${configDir}; create it, or convert a 3.x config once with: airlock-herdr import-routes --host <claude|opencode>`, "missing-file");
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new RoutingError(`routing.json at ${filePath} is not valid JSON: ${error.message}`);
  }
  return validateRouting(raw);
}

export function routerNow(env = process.env) {
  const supplied = env.AIRLOCK_NOW;
  if (isNonEmptyString(supplied) && !Number.isNaN(Date.parse(supplied))) return new Date(supplied);
  return new Date();
}

export function resolveChain(bindings, role, tier, now) {
  const binding = bindings?.[role]?.[tier];
  if (!binding) throw new RoutingError(`no route for ${role}/${tier}`, "missing-binding");
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const day = DAY_NAMES[now.getUTCDay()];
  const window = binding.windows.find((item) => item.days.includes(day) && item.startMinutes <= minute && minute < item.endMinutes) ?? null;
  const selected = window ?? binding;
  const candidates = [selected.primary, ...selected.fallbacks].map((candidate) => ({ executor: candidate.executor, model: candidate.model, effort: candidate.effort }));
  return {
    role,
    tier,
    window: window?.name ?? "default",
    resolvedAt: now.toISOString(),
    candidates,
    candidateIndex: 0,
    advanceCount: 0,
    failures: [],
  };
}
