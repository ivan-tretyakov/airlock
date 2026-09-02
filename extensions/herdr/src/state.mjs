import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, writeSync, closeSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const RECORD_VERSION = 2;
export const RECORD_STATES = Object.freeze(["offered", "started", "pane-created", "agent-started", "prompted", "launch-pending", "needs-reconcile", "settled", "failed"]);
export const IN_FLIGHT_STATES = Object.freeze(["started", "pane-created", "agent-started", "prompted", "launch-pending", "needs-reconcile"]);
export const SETTLED_AS = Object.freeze(["done", "blocked", "superseded"]);

export function workflowKey(repoRoot, planPath) {
  return createHash("sha256").update(`${path.resolve(repoRoot)}\n${path.resolve(planPath)}`).digest("hex").slice(0, 16);
}

export function workflowDir(stateDir, sessionName, key) {
  return path.join(stateDir, safeName(sessionName), key);
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function nonce() {
  return randomUUID();
}

export function agentNameFor(taskId, attempt) {
  return `al-${String(taskId).toLowerCase()}-a${attempt}`;
}

export function createRecord({ workflowKey: key, repoRoot, planPath, sessionName, taskId, attempt = 1, executor, agent, pin, taskText, dispatchPath, state = "offered" }) {
  return {
    recordVersion: RECORD_VERSION,
    workflowKey: key,
    repoRoot: path.resolve(repoRoot),
    planPath: path.resolve(planPath),
    sessionName,
    taskId,
    attempt,
    executor,
    agent,
    agentName: agentNameFor(taskId, attempt),
    pin,
    taskText,
    nonce: nonce(),
    workspaceId: null,
    paneId: null,
    dispatchPath,
    state,
    startedAt: new Date().toISOString(),
    promptAttemptedAt: null,
    promptDeliveredAt: null,
    parkedForHuman: null,
    settledAt: null,
    settledAs: null,
    lastError: null,
  };
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

export function logOperation(dir, { op, taskId = null, attempt = null, outcome, detail = null }) {
  const entry = { ts: new Date().toISOString(), op, taskId, attempt, outcome, detail };
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "operations.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function readRecord(dir, taskId) {
  const filePath = path.join(dir, "tasks", `${sanitizeTaskId(taskId)}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function listRecords(dir) {
  const tasksDir = path.join(dir, "tasks");
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(path.join(tasksDir, name), "utf8")));
}

export function writeRecord(dir, record, { op = "record", outcome = record.state, detail = null } = {}) {
  if (!RECORD_STATES.includes(record.state)) throw new Error(`unknown record state: ${record.state}`);
  writeJsonAtomic(path.join(dir, "tasks", `${sanitizeTaskId(record.taskId)}.json`), record);
  logOperation(dir, { op, taskId: record.taskId, attempt: record.attempt, outcome, detail });
  return record;
}

export function deleteRecord(dir, record, { detail = null } = {}) {
  const filePath = path.join(dir, "tasks", `${sanitizeTaskId(record.taskId)}.json`);
  logOperation(dir, { op: "record-delete", taskId: record.taskId, attempt: record.attempt, outcome: "deleted", detail: JSON.stringify({ reason: detail, record }) });
  rmSync(filePath, { force: true });
}

// One atomic advance: appends the failures[] entry, moves candidateIndex, consumes the
// budget when the failure launched something, and persists the new attempt as
// launch-pending. Idempotent under the workflow lock: the record on disk is re-read and
// compared against the candidateIndex the caller's decision was based on, and a second
// budget-consuming advance from the same attempt is refused.
export function advanceCandidate(dir, prior, { failure, expectedCandidateIndex, consumeBudget }) {
  const onDisk = readRecord(dir, prior.taskId);
  if (!onDisk || onDisk.attempt !== prior.attempt || onDisk.pin?.candidateIndex !== expectedCandidateIndex) {
    throw new Error(`advance aborted for ${prior.taskId}: another runner already advanced (expected candidateIndex ${expectedCandidateIndex}, found ${onDisk?.pin?.candidateIndex ?? "<missing>"})`);
  }
  if (consumeBudget && (onDisk.pin.failures ?? []).some((entry) => entry.fromAttempt === prior.attempt)) {
    throw new Error(`advance aborted for ${prior.taskId}: attempt ${prior.attempt} already consumed an advance`);
  }
  const pin = {
    ...onDisk.pin,
    failures: [...(onDisk.pin.failures ?? []), failure],
    candidateIndex: onDisk.pin.candidateIndex + 1,
    advanceCount: onDisk.pin.advanceCount + (consumeBudget ? 1 : 0),
  };
  const next = createRecord({
    workflowKey: onDisk.workflowKey,
    repoRoot: onDisk.repoRoot,
    planPath: onDisk.planPath,
    sessionName: onDisk.sessionName,
    taskId: onDisk.taskId,
    attempt: onDisk.attempt + 1,
    executor: pin.candidates[pin.candidateIndex]?.executor ?? null,
    agent: onDisk.agent,
    pin,
    taskText: onDisk.taskText,
    dispatchPath: onDisk.dispatchPath,
    state: "launch-pending",
  });
  writeRecord(dir, next, { op: "record-advance", outcome: "launch-pending", detail: JSON.stringify(onDisk) });
  return next;
}

// A budget-free pre-start skip within the current attempt: the candidate never launched.
export function skipCandidate(dir, record, { failure }) {
  record.pin = {
    ...record.pin,
    failures: [...(record.pin.failures ?? []), failure],
    candidateIndex: record.pin.candidateIndex + 1,
  };
  record.executor = record.pin.candidates[record.pin.candidateIndex]?.executor ?? record.executor;
  writeRecord(dir, record, { op: "record-skip-candidate", outcome: record.state, detail: JSON.stringify(failure) });
  return record;
}

export function inFlightRecords(records) {
  return records.filter((record) => IN_FLIGHT_STATES.includes(record.state));
}

function sanitizeTaskId(taskId) {
  const safe = String(taskId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid task id: ${taskId}`);
  return safe;
}

const COORDINATOR_PREFIXES = [".airlock", ".airlock/"];

// Mirrors the 4.0 CLI's isCoordinatorPath: the project-local host shim and static agent
// files are coordinator artifacts, not product changes (airlock's own clean-boundary
// check ignores them, so the router must too).
function isCoordinatorFile(normalized) {
  return normalized === ".opencode/command/airlock.md" || normalized.startsWith(".opencode/agent/airlock-");
}

export function gitStatus(repoRoot) {
  const result = spawnSync("git", ["-C", path.resolve(repoRoot), "status", "--porcelain", "-z", "--untracked-files=all"], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`git status failed in ${repoRoot}: ${result.stderr?.trim() || result.error?.message || `exit ${result.status}`}`);
  return result.stdout;
}

export function productChanges(repoRoot, planPath, porcelainOutput) {
  const relativePlan = path.relative(path.resolve(repoRoot), path.resolve(planPath)).replaceAll("\\", "/");
  const changed = [];
  const tokens = String(porcelainOutput ?? "").split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    const paths = [token.slice(3)];
    if (/[RC]/.test(status)) {
      index += 1;
      if (tokens[index]) paths.push(tokens[index]);
    }
    for (const changedPath of paths) {
      const normalized = changedPath.replaceAll("\\", "/");
      if (normalized === relativePlan) continue;
      if (COORDINATOR_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) continue;
      if (isCoordinatorFile(normalized)) continue;
      changed.push({ status, path: normalized });
    }
  }
  return changed;
}

// The strict result parse (§Failure classes condition 2): a result exists only when a
// whole line matches `AIRLOCK-RESULT <nonce> (ok|blocked) <non-placeholder summary>`.
// A substring check is forbidden everywhere this rule applies — the typed Path A REPORT
// instruction always contains the raw `AIRLOCK-RESULT <nonce>` string.
export function detectNonce(text, nonce) {
  const escaped = String(nonce).replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  const match = new RegExp(`^AIRLOCK-RESULT ${escaped} (ok|blocked)\\s+(.+)$`, "m").exec(String(text ?? ""));
  if (!match) return null;
  const summary = match[2].trim();
  if (!summary || summary === "<one-line summary>") return null;
  return { verdict: match[1], summary };
}

export function promptFilePath(dir, taskId, attempt) {
  return path.join(dir, "prompts", `${sanitizeTaskId(taskId)}-a${attempt}.txt`);
}

export function writePromptFile(dir, taskId, attempt, prompt) {
  const filePath = promptFilePath(dir, taskId, attempt);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = openSync(filePath, "w");
  try {
    writeSync(handle, prompt, "utf8");
    closeSync(handle);
  } catch (error) {
    closeSync(handle);
    throw error;
  }
  return filePath;
}
