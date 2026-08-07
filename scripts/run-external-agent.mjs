import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access as nodeAccess,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rm as nodeRm,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

export const LEGACY_MANIFEST_SCHEMA_ID = "airlock.external-agent/v1";
export const MANIFEST_SCHEMA_ID = "airlock.external-agent/v2";
export const RESULT_SCHEMA_ID = "airlock.external-agent-result/v1";

export const OPENCODE_INVOCATION_KINDS = Object.freeze([
  "direct-posix",
  "direct-exe-path",
  "direct-exe-npm",
]);

export const GIT_INVOCATION_KINDS = Object.freeze([
  "direct-posix-path",
  "direct-exe-path",
]);

export const AIRLOCK_HEADINGS = Object.freeze([
  "Status",
  "Changes/findings",
  "Evidence",
  "Artifacts/cleanup",
  "Action needed",
]);

export const LEGACY_MANIFEST_SCHEMA = deepFreeze({
  id: LEGACY_MANIFEST_SCHEMA_ID,
  keys: {
    root: [
      "schema",
      "runtime",
      "packId",
      "crossingId",
      "route",
      "prompt",
      "opencode",
      "timeoutMs",
      "evidencePath",
      "expected",
      "cleanup",
      "retention",
      "policy",
    ],
    route: ["agent", "model", "variant", "targetDirectory", "branch"],
    opencode: ["config", "permission"],
    expected: [
      "workerStatus",
      "headings",
      "toolEvents",
      "effectiveIdentity",
    ],
    toolEvent: ["tool", "input", "minimum"],
    effectiveIdentity: ["provider", "model"],
    cleanup: ["session", "evidence", "manifest", "verifyAbsence"],
    retention: ["session", "evidence", "manifest", "transcript"],
    policy: ["identity", "proof"],
  },
  enums: {
    runtime: ["opencode"],
    workerStatus: ["done", "partial", "blocked"],
    retention: ["temporary", "retained"],
    transcriptRetention: ["none"],
  },
});

export const MANIFEST_SCHEMA = deepFreeze({
  id: MANIFEST_SCHEMA_ID,
  keys: {
    root: [
      "schema",
      "runtime",
      "packId",
      "crossingId",
      "route",
      "prompt",
      "opencode",
      "timeoutMs",
      "baseline",
      "ownedPaths",
      "validations",
      "commit",
      "artifacts",
      "expected",
      "cleanup",
      "retention",
      "policy",
    ],
    route: ["agent", "model", "variant", "targetDirectory", "branch"],
    opencode: ["config", "permission"],
    baseline: [
      "branch",
      "head",
      "indexEmpty",
      "status",
      "ownedPathHashes",
      "dirtyPathHashes",
    ],
    pathHash: ["path", "state", "sha256"],
    statusOrdinary: [
      "kind",
      "xy",
      "submodule",
      "headMode",
      "indexMode",
      "worktreeMode",
      "headOid",
      "indexOid",
      "path",
    ],
    statusRenamed: [
      "kind",
      "xy",
      "submodule",
      "headMode",
      "indexMode",
      "worktreeMode",
      "headOid",
      "indexOid",
      "score",
      "path",
      "originalPath",
    ],
    statusUnmerged: [
      "kind",
      "xy",
      "submodule",
      "stage1Mode",
      "stage2Mode",
      "stage3Mode",
      "worktreeMode",
      "stage1Oid",
      "stage2Oid",
      "stage3Oid",
      "path",
    ],
    statusUntracked: ["kind", "path"],
    validation: [
      "purpose",
      "executable",
      "args",
      "workingDirectory",
      "timeoutMs",
      "maxStdoutBytes",
      "maxStderrBytes",
      "expectedExitCode",
    ],
    commit: [
      "allowed",
      "crossingId",
      "message",
      "messageSha256",
      "candidatePaths",
    ],
    artifacts: [
      "manifestPath",
      "temporaryDirectory",
      "evidencePath",
      "messagePath",
      "hooksDirectory",
    ],
    expected: ["workerStatus", "headings", "mutations", "effectiveIdentity"],
    mutation: ["tool", "input", "minimum"],
    effectiveIdentity: ["provider", "model"],
    cleanup: ["session", "manifest", "temporaryDirectory", "verifyAbsence"],
    retention: ["session", "manifest", "temporaryDirectory", "transcript"],
    policy: ["identity", "proof"],
  },
  enums: {
    runtime: ["opencode"],
    workerStatus: ["done", "partial", "blocked"],
    pathState: ["file", "absent", "symlink"],
    mutationTool: ["edit", "write"],
    retention: ["temporary", "retained"],
    transcriptRetention: ["none"],
  },
});

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURED_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PROMPT_CHARACTERS = 24_000;
const MAX_COMMIT_MESSAGE_BYTES = 64 * 1024;
const MAX_VALIDATION_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_VALIDATIONS = 100;
const PROCESS_EXIT_GRACE_MS = 5_000;
const TREE_TERMINATION_GRACE_MS = 750;
const INVALID_ORIGIN_PUSH_URL =
  "file:///__airlock_push_disabled_deterministic_launcher__/origin";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_POLICY_PROOF = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;
const PACK_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const SAFE_BRANCH = /^(?!.*\.\.)(?!.*[~^:?*\[\\])[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const SECRET_FIELD_NAMES = new Set([
  "apikey",
  "apitoken",
  "accesskey",
  "accesstoken",
  "auth",
  "authentication",
  "authorization",
  "clientsecret",
  "credential",
  "credentials",
  "env",
  "environment",
  "password",
  "passwd",
  "privatekey",
  "pwd",
  "refreshtoken",
  "secret",
  "secrets",
  "token",
  "tokens",
]);

class LauncherError extends Error {
  constructor(code) {
    super(code);
    this.name = "LauncherError";
    this.code = code;
  }
}

function fail(code) {
  throw new LauncherError(code);
}

function launcherClassification(error, fallback = "launcher_blocked") {
  // OS/runtime error codes are unstable implementation details, not result taxonomy.
  return error instanceof LauncherError ? error.code : fallback;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, code = "manifest_unknown_key") {
  if (!isRecord(value)) fail("manifest_malformed");
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
}

function assertJsonValue(value, depth = 0) {
  if (depth > 64) fail("manifest_malformed");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("manifest_malformed");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (!isRecord(value)) fail("manifest_malformed");
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      fail("manifest_malformed");
    }
    assertJsonValue(item, depth + 1);
  }
}

function rejectSecretFields(value, depth = 0, strictFieldNames = false) {
  if (depth > 64 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectSecretFields(item, depth + 1, strictFieldNames);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    // Permission path patterns such as "**/.env" are selectors, not fields.
    if (strictFieldNames || /^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (SECRET_FIELD_NAMES.has(normalized)) fail("manifest_secret_field");
    }
    rejectSecretFields(item, depth + 1, strictFieldNames);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePolicyIdentity(config, permission) {
  assertJsonValue(config);
  assertJsonValue(permission);
  const digest = createHash("sha256")
    .update(stableJson({ config, permission }), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function isAbsolutePath(value) {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    (path.isAbsolute(value) ||
      path.win32.isAbsolute(value) ||
      path.posix.isAbsolute(value))
  );
}

function splitSelectedModel(model) {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    fail("manifest_route_invalid");
  }
  return { provider: model.slice(0, separator), model: model.slice(separator + 1) };
}

function isDenyOnly(value) {
  if (value === undefined || value === "deny") return true;
  if (!isRecord(value)) return false;
  const leaves = [];
  const visit = (item) => {
    if (typeof item === "string") leaves.push(item);
    else if (isRecord(item)) Object.values(item).forEach(visit);
    else leaves.push("invalid");
  };
  visit(value);
  return leaves.length > 0 && leaves.every((leaf) => leaf === "deny");
}

function assertSafeString(value, code, maximum = 4_096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    fail(code);
  }
}

function hasAllowLeaf(value) {
  if (value === "allow") return true;
  if (!isRecord(value)) return false;
  return Object.values(value).some(hasAllowLeaf);
}

function pathImplementationFor(value) {
  return path.win32.isAbsolute(value) ? path.win32 : path.posix;
}

function canonicalAbsolutePath(value) {
  const implementation = pathImplementationFor(value);
  const resolved = implementation.resolve(value);
  return implementation === path.win32 ? resolved.toLowerCase() : resolved;
}

function pathsEqual(left, right) {
  return canonicalAbsolutePath(left) === canonicalAbsolutePath(right);
}

function pathIsInside(parent, candidate, { allowEqual = false } = {}) {
  if (!isAbsolutePath(parent) || !isAbsolutePath(candidate)) return false;
  const implementation = pathImplementationFor(parent);
  if (implementation !== pathImplementationFor(candidate)) return false;
  const relative = implementation.relative(
    implementation.resolve(parent),
    implementation.resolve(candidate),
  );
  if (relative === "") return allowEqual;
  return (
    relative !== ".." &&
    !relative.startsWith(`..${implementation.sep}`) &&
    !implementation.isAbsolute(relative)
  );
}

function isExactRelativePath(value, { allowDot = false } = {}) {
  if (value === ".") return allowDot;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !/[\x00-\x1f\x7f*?[\]{}]/.test(value) &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.endsWith("/") &&
    value.split("/").every((component) => component !== "." && component !== "..")
  );
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCanonicalRelativePathList(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (value.some((item) => !isExactRelativePath(item))) return false;
  const folded = new Set();
  for (const item of value) {
    const key = item.toLowerCase();
    if (folded.has(key)) return false;
    folded.add(key);
  }
  return value.every(
    (item, index) => index === 0 || compareStrings(value[index - 1], item) < 0,
  );
}

function assertCommonManifestFields(value) {
  if (value.runtime !== "opencode") fail("manifest_runtime_unknown");
  if (!PACK_ID.test(value.packId)) fail("manifest_ids_invalid");
  if (
    !PACK_ID.test(value.crossingId) ||
    !new RegExp(
      `^${value.packId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-C\\d+$`,
    ).test(value.crossingId)
  ) {
    fail("manifest_ids_invalid");
  }

  exactKeys(value.route, MANIFEST_SCHEMA.keys.route);
  for (const field of ["agent", "model", "variant"]) {
    assertSafeString(value.route[field], "manifest_route_invalid", 256);
    if (!SAFE_IDENTIFIER.test(value.route[field])) fail("manifest_route_invalid");
  }
  if (!isAbsolutePath(value.route.targetDirectory)) fail("manifest_route_invalid");
  if (!SAFE_BRANCH.test(value.route.branch)) fail("manifest_route_invalid");

  assertSafeString(value.prompt, "manifest_prompt_invalid", MAX_PROMPT_CHARACTERS);
  if (value.prompt.trimStart().startsWith("-")) fail("manifest_prompt_invalid");
  if (
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > 86_400_000
  ) {
    fail("manifest_timeout_invalid");
  }
}

function permissionEntries(value, code = "manifest_permission_not_total") {
  if (value === undefined || value === "deny") return [];
  if (!isRecord(value) || Object.keys(value)[0] !== "*" || value["*"] !== "deny") {
    fail(code);
  }
  const entries = Object.entries(value).slice(1);
  if (
    entries.some(
      ([selector, decision]) =>
        typeof selector !== "string" ||
        selector.length === 0 ||
        (decision !== "allow" && decision !== "deny"),
    )
  ) {
    fail(code);
  }
  return entries;
}

function validateWorkerPermissions(value) {
  const permission = value.opencode.permission;
  if (permission["*"] !== "deny") fail("manifest_permission_not_total");
  if (!isDenyOnly(permission.task) || !isDenyOnly(permission.question)) {
    fail("manifest_permission_not_total");
  }

  const allowedTools = new Set(["*", "read", "edit", "bash", "task", "question"]);
  for (const [tool, policy] of Object.entries(permission)) {
    if (!allowedTools.has(tool) && hasAllowLeaf(policy)) {
      fail("manifest_permission_not_total");
    }
  }

  const expectedOwned = value.ownedPaths.map((relativePath) =>
    canonicalAbsolutePath(
      pathImplementationFor(value.route.targetDirectory).join(
        value.route.targetDirectory,
        ...relativePath.split("/"),
      ),
    ),
  );
  const readAllows = permissionEntries(permission.read)
    .filter(([, decision]) => decision === "allow")
    .map(([selector]) => selector);
  const editAllows = permissionEntries(permission.edit)
    .filter(([, decision]) => decision === "allow")
    .map(([selector]) => selector);

  for (const selector of [...readAllows, ...editAllows]) {
    if (
      !isAbsolutePath(selector) ||
      !pathIsInside(value.route.targetDirectory, selector) ||
      /(?:^|[\\/])(?:\.env[^\\/]*|[^\\/]*(?:credential|secret|token|password)[^\\/]*)$/i.test(
        selector,
      )
    ) {
      fail("manifest_permission_not_total");
    }
  }
  const canonicalReads = new Set(readAllows.map(canonicalAbsolutePath));
  const canonicalEdits = editAllows.map(canonicalAbsolutePath).sort(compareStrings);
  if (expectedOwned.some((ownedPath) => !canonicalReads.has(ownedPath))) {
    fail("manifest_permission_not_total");
  }
  if (
    canonicalEdits.length !== expectedOwned.length ||
    canonicalEdits.some(
      (candidate, index) => candidate !== [...expectedOwned].sort(compareStrings)[index],
    )
  ) {
    fail("manifest_permission_not_total");
  }

  const readOnlyGitCommands = new Set([
    "branch",
    "cat-file",
    "check-attr",
    "diff",
    "diff-tree",
    "log",
    "ls-files",
    "rev-list",
    "rev-parse",
    "show",
    "status",
  ]);
  for (const [command, decision] of permissionEntries(permission.bash)) {
    if (decision !== "allow") continue;
    if (
      command.length > 4_096 ||
      /[\r\n;&|><`$()]/.test(command) ||
      /[*?\[\]{}]/.test(command)
    ) {
      fail("manifest_permission_not_total");
    }
    const gitCommands = command.matchAll(
      /(?:^|\s)(?:"[^"\r\n]*[/\\])?git(?:\.exe)?"?\s+([^\s"']+)/gi,
    );
    for (const match of gitCommands) {
      if (!readOnlyGitCommands.has(match[1].toLowerCase())) {
        fail("manifest_permission_git_write");
      }
    }
  }
}

function validatePathHash(value, expectedPath, code) {
  exactKeys(value, MANIFEST_SCHEMA.keys.pathHash);
  if (
    value.path !== expectedPath ||
    !MANIFEST_SCHEMA.enums.pathState.includes(value.state) ||
    (value.state === "absent"
      ? value.sha256 !== null
      : !LOWERCASE_SHA256.test(value.sha256))
  ) {
    fail(code);
  }
}

function validateStatusEntry(entry) {
  if (!isRecord(entry)) fail("manifest_baseline_invalid");
  const mode = /^[0-7]{6}$/;
  const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  if (entry.kind === "ordinary") {
    exactKeys(entry, MANIFEST_SCHEMA.keys.statusOrdinary);
    if (
      !/^[.MADRCU]{2}$/.test(entry.xy) ||
      !/^[NS][.SCU]{3}$/.test(entry.submodule) ||
      !mode.test(entry.headMode) ||
      !mode.test(entry.indexMode) ||
      !mode.test(entry.worktreeMode) ||
      !oid.test(entry.headOid) ||
      !oid.test(entry.indexOid) ||
      !isExactRelativePath(entry.path)
    ) {
      fail("manifest_baseline_invalid");
    }
    return [entry.path];
  }
  if (entry.kind === "renamed") {
    exactKeys(entry, MANIFEST_SCHEMA.keys.statusRenamed);
    if (
      !/^[.MADRCU]{2}$/.test(entry.xy) ||
      !/^[NS][.SCU]{3}$/.test(entry.submodule) ||
      !mode.test(entry.headMode) ||
      !mode.test(entry.indexMode) ||
      !mode.test(entry.worktreeMode) ||
      !oid.test(entry.headOid) ||
      !oid.test(entry.indexOid) ||
      !/^[RC][0-9]{1,3}$/.test(entry.score) ||
      !isExactRelativePath(entry.path) ||
      !isExactRelativePath(entry.originalPath) ||
      entry.path === entry.originalPath
    ) {
      fail("manifest_baseline_invalid");
    }
    return [entry.originalPath, entry.path];
  }
  if (entry.kind === "unmerged") {
    exactKeys(entry, MANIFEST_SCHEMA.keys.statusUnmerged);
    for (const field of [
      "stage1Mode",
      "stage2Mode",
      "stage3Mode",
      "worktreeMode",
    ]) {
      if (!mode.test(entry[field])) fail("manifest_baseline_invalid");
    }
    for (const field of ["stage1Oid", "stage2Oid", "stage3Oid"]) {
      if (!oid.test(entry[field])) fail("manifest_baseline_invalid");
    }
    if (
      !/^[.MADRCU]{2}$/.test(entry.xy) ||
      !/^[NS][.SCU]{3}$/.test(entry.submodule) ||
      !isExactRelativePath(entry.path)
    ) {
      fail("manifest_baseline_invalid");
    }
    return [entry.path];
  }
  if (entry.kind === "untracked") {
    exactKeys(entry, MANIFEST_SCHEMA.keys.statusUntracked);
    if (!isExactRelativePath(entry.path)) fail("manifest_baseline_invalid");
    return [entry.path];
  }
  fail("manifest_baseline_invalid");
}

function validateWriterManifest(value, { manifestPath } = {}) {
  exactKeys(value, MANIFEST_SCHEMA.keys.root);
  assertJsonValue(value);
  if (value.schema !== MANIFEST_SCHEMA_ID) fail("manifest_schema_unknown");
  assertCommonManifestFields(value);
  const selectedIdentity = splitSelectedModel(value.route.model);

  exactKeys(value.opencode, MANIFEST_SCHEMA.keys.opencode);
  if (!isRecord(value.opencode.config) || !isRecord(value.opencode.permission)) {
    fail("manifest_opencode_invalid");
  }
  rejectSecretFields(value.opencode.config, 0, true);
  rejectSecretFields(value.opencode.permission);
  if (
    value.opencode.config.model !== value.route.model ||
    value.opencode.config.default_agent !== value.route.agent
  ) {
    fail("manifest_opencode_invalid");
  }

  if (!isCanonicalRelativePathList(value.ownedPaths)) {
    fail("manifest_owned_paths_invalid");
  }

  exactKeys(value.baseline, MANIFEST_SCHEMA.keys.baseline);
  if (
    value.baseline.branch !== value.route.branch ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baseline.head) ||
    value.baseline.indexEmpty !== true ||
    !Array.isArray(value.baseline.status) ||
    !Array.isArray(value.baseline.ownedPathHashes) ||
    !Array.isArray(value.baseline.dirtyPathHashes)
  ) {
    fail("manifest_baseline_invalid");
  }
  const dirtyPaths = value.baseline.status
    .flatMap(validateStatusEntry)
    .sort(compareStrings);
  if (
    value.baseline.status.some(
      (entry) => entry.kind === "unmerged" || (entry.xy && entry.xy[0] !== "."),
    ) ||
    new Set(dirtyPaths).size !== dirtyPaths.length
  ) {
    fail("manifest_baseline_invalid");
  }
  if (value.baseline.ownedPathHashes.length !== value.ownedPaths.length) {
    fail("manifest_baseline_invalid");
  }
  value.baseline.ownedPathHashes.forEach((entry, index) => {
    validatePathHash(entry, value.ownedPaths[index], "manifest_baseline_invalid");
    if (entry.state === "symlink") fail("manifest_baseline_invalid");
  });
  if (value.baseline.dirtyPathHashes.length !== dirtyPaths.length) {
    fail("manifest_baseline_invalid");
  }
  value.baseline.dirtyPathHashes.forEach((entry, index) => {
    validatePathHash(entry, dirtyPaths[index], "manifest_baseline_invalid");
  });
  if (dirtyPaths.some((dirtyPath) => value.ownedPaths.includes(dirtyPath))) {
    fail("manifest_baseline_invalid");
  }

  validateWorkerPermissions(value);

  if (
    !Array.isArray(value.validations) ||
    value.validations.length === 0 ||
    value.validations.length > MAX_VALIDATIONS
  ) {
    fail("manifest_validation_invalid");
  }
  const validationPurposes = new Set();
  for (const validation of value.validations) {
    exactKeys(validation, MANIFEST_SCHEMA.keys.validation);
    assertSafeString(validation.purpose, "manifest_validation_invalid", 256);
    if (validationPurposes.has(validation.purpose)) {
      fail("manifest_validation_invalid");
    }
    validationPurposes.add(validation.purpose);
    if (
      !isAbsolutePath(validation.executable) ||
      pathIsInside(value.route.targetDirectory, validation.executable, {
        allowEqual: true,
      }) ||
      (path.win32.isAbsolute(validation.executable) &&
        path.win32.extname(validation.executable).toLowerCase() !== ".exe") ||
      !Array.isArray(validation.args) ||
      validation.args.length > 1_000 ||
      validation.args.some(
        (argument) =>
          typeof argument !== "string" ||
          argument.length > 32_768 ||
          argument.includes("\0"),
      ) ||
      !isExactRelativePath(validation.workingDirectory, { allowDot: true }) ||
      !Number.isSafeInteger(validation.timeoutMs) ||
      validation.timeoutMs < 1 ||
      validation.timeoutMs > 3_600_000 ||
      !Number.isSafeInteger(validation.maxStdoutBytes) ||
      validation.maxStdoutBytes < 1 ||
      validation.maxStdoutBytes > MAX_VALIDATION_OUTPUT_BYTES ||
      !Number.isSafeInteger(validation.maxStderrBytes) ||
      validation.maxStderrBytes < 1 ||
      validation.maxStderrBytes > MAX_VALIDATION_OUTPUT_BYTES ||
      !Number.isSafeInteger(validation.expectedExitCode) ||
      validation.expectedExitCode < 0 ||
      validation.expectedExitCode > 255
    ) {
      fail("manifest_validation_invalid");
    }
  }

  exactKeys(value.commit, MANIFEST_SCHEMA.keys.commit);
  const messageBytes =
    typeof value.commit.message === "string"
      ? Buffer.from(value.commit.message, "utf8")
      : Buffer.alloc(0);
  if (
    value.commit.allowed !== true ||
    value.commit.crossingId !== value.crossingId ||
    messageBytes.length === 0 ||
    messageBytes.length > MAX_COMMIT_MESSAGE_BYTES ||
    value.commit.message.includes("\0") ||
    !value.commit.message.endsWith("\n") ||
    !value.commit.message.includes(value.crossingId) ||
    !LOWERCASE_SHA256.test(value.commit.messageSha256) ||
    createHash("sha256").update(messageBytes).digest("hex") !==
      value.commit.messageSha256 ||
    !isCanonicalRelativePathList(value.commit.candidatePaths) ||
    value.commit.candidatePaths.some(
      (candidatePath) => !value.ownedPaths.includes(candidatePath),
    )
  ) {
    fail("manifest_commit_invalid");
  }

  exactKeys(value.artifacts, MANIFEST_SCHEMA.keys.artifacts);
  const artifactPaths = Object.values(value.artifacts);
  const artifactKeys = artifactPaths.map(canonicalAbsolutePath);
  const temporaryDirectory = value.artifacts.temporaryDirectory;
  if (
    artifactPaths.some((artifactPath) => !isAbsolutePath(artifactPath)) ||
    manifestPath === undefined ||
    !isAbsolutePath(manifestPath) ||
    !pathsEqual(value.artifacts.manifestPath, manifestPath) ||
    new Set(artifactKeys).size !== artifactKeys.length ||
    pathIsInside(value.route.targetDirectory, value.artifacts.manifestPath, {
      allowEqual: true,
    }) ||
    pathIsInside(value.route.targetDirectory, temporaryDirectory, {
      allowEqual: true,
    }) ||
    !["evidencePath", "messagePath", "hooksDirectory"].every(
      (field) =>
        pathIsInside(temporaryDirectory, value.artifacts[field]) &&
        pathsEqual(
          pathImplementationFor(temporaryDirectory).dirname(value.artifacts[field]),
          temporaryDirectory,
        ),
    )
  ) {
    fail("manifest_artifacts_invalid");
  }

  exactKeys(value.expected, MANIFEST_SCHEMA.keys.expected);
  if (
    value.expected.workerStatus !== "done" ||
    !Array.isArray(value.expected.headings) ||
    value.expected.headings.length !== AIRLOCK_HEADINGS.length ||
    value.expected.headings.some(
      (heading, index) => heading !== AIRLOCK_HEADINGS[index],
    ) ||
    !Array.isArray(value.expected.mutations) ||
    value.expected.mutations.length === 0 ||
    value.expected.mutations.length > 100
  ) {
    fail("manifest_expected_invalid");
  }
  const mutationKeys = new Set();
  const absoluteOwned = new Set(
    value.ownedPaths.map((relativePath) =>
      canonicalAbsolutePath(
        pathImplementationFor(value.route.targetDirectory).join(
          value.route.targetDirectory,
          ...relativePath.split("/"),
        ),
      ),
    ),
  );
  for (const mutation of value.expected.mutations) {
    exactKeys(mutation, MANIFEST_SCHEMA.keys.mutation);
    if (
      !MANIFEST_SCHEMA.enums.mutationTool.includes(mutation.tool) ||
      !isRecord(mutation.input) ||
      !isAbsolutePath(mutation.input.filePath) ||
      !absoluteOwned.has(canonicalAbsolutePath(mutation.input.filePath)) ||
      !Number.isSafeInteger(mutation.minimum) ||
      mutation.minimum < 1 ||
      mutation.minimum > 100
    ) {
      fail("manifest_expected_invalid");
    }
    assertJsonValue(mutation.input);
    const key = `${mutation.tool}:${stableJson(mutation.input)}`;
    if (mutationKeys.has(key)) fail("manifest_expected_invalid");
    mutationKeys.add(key);
  }
  exactKeys(value.expected.effectiveIdentity, MANIFEST_SCHEMA.keys.effectiveIdentity);
  if (
    value.expected.effectiveIdentity.provider !== selectedIdentity.provider ||
    value.expected.effectiveIdentity.model !== selectedIdentity.model
  ) {
    fail("manifest_expected_invalid");
  }

  exactKeys(value.cleanup, MANIFEST_SCHEMA.keys.cleanup);
  for (const field of [
    "session",
    "manifest",
    "temporaryDirectory",
    "verifyAbsence",
  ]) {
    if (typeof value.cleanup[field] !== "boolean") fail("manifest_cleanup_invalid");
  }
  if (!value.cleanup.verifyAbsence) fail("manifest_cleanup_invalid");
  exactKeys(value.retention, MANIFEST_SCHEMA.keys.retention);
  for (const field of ["session", "manifest", "temporaryDirectory"]) {
    if (
      !MANIFEST_SCHEMA.enums.retention.includes(value.retention[field]) ||
      value.cleanup[field] !== (value.retention[field] === "temporary")
    ) {
      fail("manifest_retention_invalid");
    }
  }
  if (
    value.retention.transcript !== "none" ||
    value.retention.temporaryDirectory !== "temporary"
  ) {
    fail("manifest_retention_invalid");
  }

  exactKeys(value.policy, MANIFEST_SCHEMA.keys.policy);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(value.policy.identity) ||
    !SAFE_POLICY_PROOF.test(value.policy.proof) ||
    value.policy.identity !==
      computePolicyIdentity(value.opencode.config, value.opencode.permission)
  ) {
    fail("manifest_policy_invalid");
  }

  const requiredPromptAnchors = [
    value.packId,
    value.crossingId,
    value.route.agent,
    value.route.model,
    value.route.variant,
    value.route.targetDirectory,
    value.route.branch,
    value.baseline.head,
    ...value.ownedPaths,
    ...value.commit.candidatePaths,
    value.artifacts.manifestPath,
    value.artifacts.evidencePath,
    value.policy.identity,
    value.policy.proof,
  ];
  if (requiredPromptAnchors.some((anchor) => !value.prompt.includes(anchor))) {
    fail("manifest_prompt_incomplete");
  }
  return value;
}

function validateLegacyManifest(value, { manifestPath } = {}) {
  exactKeys(value, LEGACY_MANIFEST_SCHEMA.keys.root);
  assertJsonValue(value);

  if (value.schema !== LEGACY_MANIFEST_SCHEMA_ID) fail("manifest_schema_unknown");
  if (value.runtime !== "opencode") fail("manifest_runtime_unknown");
  if (!PACK_ID.test(value.packId)) fail("manifest_ids_invalid");
  if (
    !PACK_ID.test(value.crossingId) ||
    !new RegExp(`^${value.packId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-C\\d+$`).test(
      value.crossingId,
    )
  ) {
    fail("manifest_ids_invalid");
  }

  exactKeys(value.route, LEGACY_MANIFEST_SCHEMA.keys.route);
  for (const field of ["agent", "model", "variant"]) {
    assertSafeString(value.route[field], "manifest_route_invalid", 256);
    if (!SAFE_IDENTIFIER.test(value.route[field])) fail("manifest_route_invalid");
  }
  if (!isAbsolutePath(value.route.targetDirectory)) {
    fail("manifest_route_invalid");
  }
  if (!SAFE_BRANCH.test(value.route.branch)) fail("manifest_route_invalid");
  const selectedIdentity = splitSelectedModel(value.route.model);

  assertSafeString(value.prompt, "manifest_prompt_invalid", MAX_PROMPT_CHARACTERS);
  if (value.prompt.trimStart().startsWith("-")) fail("manifest_prompt_invalid");

  exactKeys(value.opencode, LEGACY_MANIFEST_SCHEMA.keys.opencode);
  if (!isRecord(value.opencode.config) || !isRecord(value.opencode.permission)) {
    fail("manifest_opencode_invalid");
  }
  rejectSecretFields(value.opencode.config, 0, true);
  rejectSecretFields(value.opencode.permission);
  if (
    value.opencode.config.model !== value.route.model ||
    value.opencode.config.default_agent !== value.route.agent
  ) {
    fail("manifest_opencode_invalid");
  }
  if (value.opencode.permission["*"] !== "deny") {
    fail("manifest_permission_not_total");
  }
  if (
    !isDenyOnly(value.opencode.permission.task) ||
    !isDenyOnly(value.opencode.permission.question)
  ) {
    fail("manifest_permission_not_total");
  }
  for (const tool of ["edit", "write", "patch", "apply_patch", "bash"]) {
    if (!isDenyOnly(value.opencode.permission[tool])) {
      fail("legacy_writer_unsupported");
    }
  }

  if (
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > 86_400_000
  ) {
    fail("manifest_timeout_invalid");
  }
  if (!isAbsolutePath(value.evidencePath)) fail("manifest_evidence_invalid");
  if (
    manifestPath !== undefined &&
    (!isAbsolutePath(manifestPath) ||
      path.resolve(value.evidencePath) === path.resolve(manifestPath))
  ) {
    fail("manifest_evidence_invalid");
  }

  exactKeys(value.expected, LEGACY_MANIFEST_SCHEMA.keys.expected);
  if (
    !LEGACY_MANIFEST_SCHEMA.enums.workerStatus.includes(value.expected.workerStatus)
  ) {
    fail("manifest_expected_invalid");
  }
  if (
    !Array.isArray(value.expected.headings) ||
    value.expected.headings.length !== AIRLOCK_HEADINGS.length ||
    value.expected.headings.some(
      (heading, index) => heading !== AIRLOCK_HEADINGS[index],
    )
  ) {
    fail("manifest_expected_invalid");
  }
  if (
    !Array.isArray(value.expected.toolEvents) ||
    value.expected.toolEvents.length === 0 ||
    value.expected.toolEvents.length > 100
  ) {
    fail("manifest_expected_invalid");
  }
  const toolExpectationKeys = new Set();
  for (const expectation of value.expected.toolEvents) {
    exactKeys(expectation, LEGACY_MANIFEST_SCHEMA.keys.toolEvent);
    if (!SAFE_IDENTIFIER.test(expectation.tool)) fail("manifest_expected_invalid");
    if (!isRecord(expectation.input)) fail("manifest_expected_invalid");
    assertJsonValue(expectation.input);
    if (
      !Number.isSafeInteger(expectation.minimum) ||
      expectation.minimum < 1 ||
      expectation.minimum > 100
    ) {
      fail("manifest_expected_invalid");
    }
    const key = `${expectation.tool}:${stableJson(expectation.input)}`;
    if (toolExpectationKeys.has(key)) fail("manifest_expected_invalid");
    toolExpectationKeys.add(key);
    if (["edit", "write", "patch", "apply_patch", "bash"].includes(expectation.tool)) {
      fail("legacy_writer_unsupported");
    }
  }
  exactKeys(
    value.expected.effectiveIdentity,
    LEGACY_MANIFEST_SCHEMA.keys.effectiveIdentity,
  );
  if (
    value.expected.effectiveIdentity.provider !== selectedIdentity.provider ||
    value.expected.effectiveIdentity.model !== selectedIdentity.model
  ) {
    fail("manifest_expected_invalid");
  }

  exactKeys(value.cleanup, LEGACY_MANIFEST_SCHEMA.keys.cleanup);
  for (const field of ["session", "evidence", "manifest", "verifyAbsence"]) {
    if (typeof value.cleanup[field] !== "boolean") fail("manifest_cleanup_invalid");
  }
  if (!value.cleanup.verifyAbsence) fail("manifest_cleanup_invalid");

  exactKeys(value.retention, LEGACY_MANIFEST_SCHEMA.keys.retention);
  for (const field of ["session", "evidence", "manifest"]) {
    if (
      !LEGACY_MANIFEST_SCHEMA.enums.retention.includes(value.retention[field])
    ) {
      fail("manifest_retention_invalid");
    }
    if (value.cleanup[field] !== (value.retention[field] === "temporary")) {
      fail("manifest_retention_invalid");
    }
  }
  if (value.retention.transcript !== "none") fail("manifest_retention_invalid");

  exactKeys(value.policy, LEGACY_MANIFEST_SCHEMA.keys.policy);
  if (!/^sha256:[a-f0-9]{64}$/.test(value.policy.identity)) {
    fail("manifest_policy_invalid");
  }
  if (!SAFE_POLICY_PROOF.test(value.policy.proof)) fail("manifest_policy_invalid");
  if (
    value.policy.identity !==
    computePolicyIdentity(value.opencode.config, value.opencode.permission)
  ) {
    fail("manifest_policy_invalid");
  }

  const requiredPromptAnchors = [
    value.packId,
    value.crossingId,
    value.route.agent,
    value.route.model,
    value.route.variant,
    value.route.targetDirectory,
    value.route.branch,
    value.evidencePath,
    value.policy.identity,
    value.policy.proof,
  ];
  if (requiredPromptAnchors.some((anchor) => !value.prompt.includes(anchor))) {
    fail("manifest_prompt_incomplete");
  }

  return value;
}

export function validateManifest(value, options = {}) {
  if (!isRecord(value) || typeof value.schema !== "string") {
    fail("manifest_malformed");
  }
  if (value.schema === LEGACY_MANIFEST_SCHEMA_ID) {
    return validateLegacyManifest(value, options);
  }
  if (value.schema === MANIFEST_SCHEMA_ID) {
    return validateWriterManifest(value, options);
  }
  fail("manifest_schema_unknown");
}

export function parseCliArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) fail("cli_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag !== "--manifest" && flag !== "--sha256") ||
      values.has(flag) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      fail("cli_invalid");
    }
    values.set(flag, value);
  }
  const manifestPath = values.get("--manifest");
  const expectedSha256 = values.get("--sha256");
  if (
    !isAbsolutePath(manifestPath) ||
    path.extname(manifestPath).toLowerCase() !== ".json" ||
    !LOWERCASE_SHA256.test(expectedSha256)
  ) {
    fail("cli_invalid");
  }
  return { manifestPath, expectedSha256 };
}

function hashesEqual(actual, expected) {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function pathInformation(targetPath, lstatImpl) {
  try {
    return { exists: true, stat: await lstatImpl(targetPath) };
  } catch (error) {
    if (error && error.code === "ENOENT") return { exists: false, stat: null };
    throw error;
  }
}

export async function loadManifest(
  { manifestPath, expectedSha256 },
  dependencies = {},
) {
  const lstatImpl = dependencies.lstat ?? nodeLstat;
  const readFileImpl = dependencies.readFile ?? nodeReadFile;
  const information = await pathInformation(manifestPath, lstatImpl);
  if (
    !information.exists ||
    !information.stat.isFile() ||
    information.stat.isSymbolicLink() ||
    information.stat.size > MAX_MANIFEST_BYTES
  ) {
    fail("manifest_file_invalid");
  }
  const bytes = await readFileImpl(manifestPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!hashesEqual(actualSha256, expectedSha256)) {
    fail("manifest_hash_mismatch");
  }

  let text;
  let parsed;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    fail("manifest_json_malformed");
  }
  return {
    manifest: validateManifest(parsed, { manifestPath }),
    actualSha256,
  };
}

function removeEnvironmentKeys(environment, names, prefixes = []) {
  const exact = new Set(names.map((name) => name.toUpperCase()));
  for (const key of Object.keys(environment)) {
    const upper = key.toUpperCase();
    if (exact.has(upper) || prefixes.some((prefix) => upper.startsWith(prefix))) {
      delete environment[key];
    }
  }
}

export function buildChildEnvironment(manifest, inherited = process.env) {
  const environment = { ...inherited };
  const openCodeGitBashPath = Object.entries(inherited).find(
    ([key]) => key.toUpperCase() === "OPENCODE_GIT_BASH_PATH",
  )?.[1];
  removeEnvironmentKeys(
    environment,
    [
      "GIT_ASKPASS",
      "SSH_ASKPASS",
      "SSH_ASKPASS_REQUIRE",
      "SSH_AUTH_SOCK",
      "SSH_AGENT_PID",
      "GIT_SSH",
      "GIT_SSH_COMMAND",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_PARAMETERS",
    ],
    ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_", "OPENCODE_"],
  );

  if (typeof openCodeGitBashPath === "string" && openCodeGitBashPath.length > 0) {
    environment.OPENCODE_GIT_BASH_PATH = openCodeGitBashPath;
  }
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(manifest.opencode.config);
  environment.OPENCODE_PERMISSION = JSON.stringify(manifest.opencode.permission);
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "Never";
  environment.GCM_GUI_PROMPT = "0";
  environment.GIT_CONFIG_COUNT = "1";
  environment.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
  environment.GIT_CONFIG_VALUE_0 = INVALID_ORIGIN_PUSH_URL;
  return environment;
}

async function canAccess(candidate, accessImpl) {
  try {
    await accessImpl(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveOpenCodeInvocation({
  platform = process.platform,
  environment = process.env,
  access = nodeAccess,
} = {}) {
  if (platform !== "win32") {
    return { command: "opencode", prefixArgs: [], kind: "direct-posix" };
  }

  const pathEntries = (environment.PATH ?? environment.Path ?? "")
    .split(";")
    .map((entry) => entry.replace(/^"|"$/g, ""))
    .filter((entry) => entry && path.win32.isAbsolute(entry));
  const directCandidates = [];
  for (const directory of pathEntries) {
    directCandidates.push({
      path: path.win32.join(directory, "opencode.exe"),
      kind: "direct-exe-path",
    });
    directCandidates.push({
      path: path.win32.join(
        directory,
        "node_modules",
        "opencode-ai",
        "bin",
        "opencode.exe",
      ),
      kind: "direct-exe-npm",
    });
    if (
      path.win32.basename(directory).toLowerCase() === ".bin" &&
      path.win32.basename(path.win32.dirname(directory)).toLowerCase() ===
        "node_modules"
    ) {
      directCandidates.push({
        path: path.win32.join(
          path.win32.dirname(directory),
          "opencode-ai",
          "bin",
          "opencode.exe",
        ),
        kind: "direct-exe-npm",
      });
    }
  }
  const seen = new Set();
  for (const candidate of directCandidates) {
    const normalized = candidate.path.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (await canAccess(candidate.path, access)) {
      return { command: candidate.path, prefixArgs: [], kind: candidate.kind };
    }
  }

  fail("opencode_direct_executable_not_found");
}

async function isDirectExecutable(candidate, platform, dependencies) {
  try {
    const information = await dependencies.lstat(candidate);
    if (!information.isFile() || information.isSymbolicLink()) return false;
    if (platform === "win32") {
      return path.win32.extname(candidate).toLowerCase() === ".exe";
    }
    await dependencies.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGitInvocation({
  platform = process.platform,
  environment = process.env,
  access = nodeAccess,
  lstat = nodeLstat,
} = {}) {
  const pathValue = Object.entries(environment).find(
    ([key]) => key.toUpperCase() === "PATH",
  )?.[1];
  const separator = platform === "win32" ? ";" : ":";
  const implementation = platform === "win32" ? path.win32 : path.posix;
  const executableName = platform === "win32" ? "git.exe" : "git";
  const seen = new Set();
  for (const rawEntry of String(pathValue ?? "").split(separator)) {
    const directory = rawEntry.replace(/^"|"$/g, "");
    if (!directory || !implementation.isAbsolute(directory)) continue;
    const candidate = implementation.join(directory, executableName);
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isDirectExecutable(candidate, platform, { access, lstat })) {
      return {
        command: candidate,
        prefixArgs: [],
        kind: platform === "win32" ? "direct-exe-path" : "direct-posix-path",
      };
    }
  }
  fail("git_direct_executable_not_found");
}

const CLOSED_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

export function buildClosedEnvironment(inherited = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (
      CLOSED_ENVIRONMENT_KEYS.has(key.toUpperCase()) &&
      typeof value === "string" &&
      !value.includes("\0")
    ) {
      environment[key] = value;
    }
  }
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "Never";
  environment.GCM_GUI_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_CONFIG_COUNT = "1";
  environment.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
  environment.GIT_CONFIG_VALUE_0 = INVALID_ORIGIN_PUSH_URL;
  return environment;
}

export function buildWriterChildEnvironment(manifest, inherited = process.env) {
  const environment = buildClosedEnvironment(inherited);
  const openCodeGitBashPath = Object.entries(inherited).find(
    ([key]) => key.toUpperCase() === "OPENCODE_GIT_BASH_PATH",
  )?.[1];
  if (typeof openCodeGitBashPath === "string" && openCodeGitBashPath.length > 0) {
    environment.OPENCODE_GIT_BASH_PATH = openCodeGitBashPath;
  }
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(manifest.opencode.config);
  environment.OPENCODE_PERMISSION = JSON.stringify(manifest.opencode.permission);
  return environment;
}

function parseStatusRecord(record, originalPath = null) {
  let match = record.match(
    /^1 (\S{2}) (\S+) (\S{6}) (\S{6}) (\S{6}) (\S+) (\S+) (.+)$/s,
  );
  if (match) {
    return {
      kind: "ordinary",
      xy: match[1],
      submodule: match[2],
      headMode: match[3],
      indexMode: match[4],
      worktreeMode: match[5],
      headOid: match[6],
      indexOid: match[7],
      path: match[8],
    };
  }
  match = record.match(
    /^2 (\S{2}) (\S+) (\S{6}) (\S{6}) (\S{6}) (\S+) (\S+) (\S+) (.+)$/s,
  );
  if (match && originalPath !== null) {
    return {
      kind: "renamed",
      xy: match[1],
      submodule: match[2],
      headMode: match[3],
      indexMode: match[4],
      worktreeMode: match[5],
      headOid: match[6],
      indexOid: match[7],
      score: match[8],
      path: match[9],
      originalPath,
    };
  }
  match = record.match(
    /^u (\S{2}) (\S+) (\S{6}) (\S{6}) (\S{6}) (\S{6}) (\S+) (\S+) (\S+) (.+)$/s,
  );
  if (match) {
    return {
      kind: "unmerged",
      xy: match[1],
      submodule: match[2],
      stage1Mode: match[3],
      stage2Mode: match[4],
      stage3Mode: match[5],
      worktreeMode: match[6],
      stage1Oid: match[7],
      stage2Oid: match[8],
      stage3Oid: match[9],
      path: match[10],
    };
  }
  if (record.startsWith("? ") && record.length > 2) {
    return { kind: "untracked", path: record.slice(2) };
  }
  fail("preflight_status_malformed");
}

export function parsePorcelainV2Status(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("preflight_status_malformed");
  }
  if (text === "") return [];
  const records = text.split("\0");
  if (records.at(-1) !== "") fail("preflight_status_malformed");
  records.pop();
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith("2 ")) {
      if (index + 1 >= records.length || records[index + 1].length === 0) {
        fail("preflight_status_malformed");
      }
      entries.push(parseStatusRecord(record, records[index + 1]));
      index += 1;
    } else {
      entries.push(parseStatusRecord(record));
    }
  }
  for (const entry of entries) validateStatusEntry(entry);
  return entries;
}

export function buildRunArguments(manifest) {
  const args = [
    "--pure",
    "run",
    "--agent",
    manifest.route.agent,
    "--model",
    manifest.route.model,
    "--variant",
    manifest.route.variant,
    "--dir",
    manifest.route.targetDirectory,
    "--format",
    "json",
    manifest.prompt,
  ];
  if (args.includes("--auto")) fail("automatic_approval_forbidden");
  return args;
}

function boundedCapture(stream, maximum) {
  let total = 0;
  let retained = 0;
  const chunks = [];
  if (stream) {
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (retained < maximum) {
        const slice = bytes.subarray(0, maximum - retained);
        chunks.push(Buffer.from(slice));
        retained += slice.length;
      }
    });
  }
  return {
    finish: () => ({
      bytes: total,
      truncated: total > maximum,
      buffer: Buffer.concat(chunks, retained),
    }),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSmallProcess(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
      finish({ exitCode: null, timedOut: true });
    }, timeoutMs);
    child.once("error", () => finish({ exitCode: null, timedOut: false }));
    child.once("close", (exitCode) => finish({ exitCode, timedOut: false }));
  });
}

export async function terminateProcessTree(
  child,
  {
    platform = process.platform,
    spawn = nodeSpawn,
    delay = wait,
    kill = process.kill.bind(process),
  } = {},
) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    return { attempted: false, requestSucceeded: false };
  }

  if (platform === "win32") {
    try {
      const taskkill = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      const result = await waitForSmallProcess(taskkill, 5_000);
      return {
        attempted: true,
        requestSucceeded: result.exitCode === 0 && !result.timedOut,
      };
    } catch {
      return { attempted: true, requestSucceeded: false };
    }
  }

  let requested = false;
  try {
    kill(-child.pid, "SIGTERM");
    requested = true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { attempted: true, requestSucceeded: true };
    }
  }
  await delay(TREE_TERMINATION_GRACE_MS);
  try {
    kill(-child.pid, 0);
    kill(-child.pid, "SIGKILL");
    requested = true;
  } catch (error) {
    if (error?.code === "ESRCH") requested = true;
  }
  return { attempted: true, requestSucceeded: requested };
}

function validateProcessSpec(specification) {
  assertSafeString(specification.command, "process_spec_invalid", 32_768);
  if (
    !Array.isArray(specification.args) ||
    specification.args.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    ) ||
    specification.args.includes("--auto") ||
    !Number.isSafeInteger(specification.timeoutMs) ||
    specification.timeoutMs < 1 ||
    (specification.stdoutPath && specification.captureStdout)
  ) {
    fail("process_spec_invalid");
  }
}

export async function executeProcess(specification, dependencies = {}) {
  validateProcessSpec(specification);
  const spawnImpl = dependencies.spawn ?? nodeSpawn;
  const openImpl = dependencies.open ?? nodeOpen;
  const platform = dependencies.platform ?? process.platform;
  const terminate =
    dependencies.terminateProcessTree ??
    ((child) =>
      terminateProcessTree(child, {
        platform,
        spawn: spawnImpl,
      }));

  let outputHandle = null;
  if (specification.stdoutPath) {
    outputHandle = await openImpl(specification.stdoutPath, "wx", 0o600);
  }

  let child;
  try {
    child = spawnImpl(specification.command, specification.args, {
      cwd: specification.cwd,
      env: specification.env,
      detached: platform !== "win32",
      shell: false,
      windowsHide: true,
      stdio: [
        "ignore",
        outputHandle
          ? outputHandle.fd
          : specification.captureStdout
            ? "pipe"
            : "ignore",
        "pipe",
      ],
    });
  } catch {
    await outputHandle?.close();
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      terminationConfirmed: true,
      processState: "not-started",
      pid: null,
      stdout: Buffer.alloc(0),
      stdoutBytes: 0,
      stdoutTruncated: false,
      stderr: Buffer.alloc(0),
      stderrBytes: 0,
      stderrTruncated: false,
    };
  }

  const stdoutCapture = boundedCapture(
    specification.captureStdout ? child.stdout : null,
    specification.maxStdoutBytes ?? MAX_CAPTURED_STDOUT_BYTES,
  );
  const stderrCapture = boundedCapture(
    child.stderr,
    specification.maxStderrBytes ?? MAX_STDERR_BYTES,
  );

  let timedOut = false;
  let terminationRequested = false;
  let spawnErrored = false;
  const processResult = await new Promise((resolve) => {
    let settled = false;
    let exitTimer = null;
    const settle = (exitCode, signal, processState, terminationConfirmed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (exitTimer) clearTimeout(exitTimer);
      resolve({ exitCode, signal, processState, terminationConfirmed });
    };

    const timeoutTimer = setTimeout(async () => {
      timedOut = true;
      try {
        const result = await terminate(child);
        terminationRequested = Boolean(result?.attempted);
      } catch {
        terminationRequested = true;
      }
      if (settled) return;
      exitTimer = setTimeout(() => {
        try {
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
        } catch {
          // Unknown process state is reported to the caller.
        }
        settle(null, null, "unknown", false);
      }, PROCESS_EXIT_GRACE_MS);
    }, specification.timeoutMs);

    child.once("error", () => {
      spawnErrored = true;
      if (!child.pid) settle(null, null, "not-started", true);
    });
    child.once("close", (exitCode, signal) => {
      settle(exitCode, signal, "closed", true);
    });
  });

  await outputHandle?.close();
  const stdout = stdoutCapture.finish();
  const stderr = stderrCapture.finish();
  return {
    ...processResult,
    timedOut,
    terminationRequested,
    spawnErrored,
    pid: Number.isInteger(child.pid) ? child.pid : null,
    stdout: stdout.buffer,
    stdoutBytes: stdout.bytes,
    stdoutTruncated: stdout.truncated,
    stderr: stderr.buffer,
    stderrBytes: stderr.bytes,
    stderrTruncated: stderr.truncated,
  };
}

function normalizeProcessResult(result) {
  const stdout = Buffer.isBuffer(result?.stdout)
    ? result.stdout
    : Buffer.from(result?.stdout ?? "");
  const stderr = Buffer.isBuffer(result?.stderr)
    ? result.stderr
    : Buffer.from(result?.stderr ?? "");
  return {
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    signal: typeof result?.signal === "string" ? result.signal : null,
    timedOut: Boolean(result?.timedOut),
    terminationConfirmed:
      result?.terminationConfirmed === undefined
        ? !result?.timedOut
        : Boolean(result.terminationConfirmed),
    processState: result?.processState ?? "closed",
    pid: Number.isInteger(result?.pid) ? result.pid : null,
    stdout,
    stdoutBytes: result?.stdoutBytes ?? stdout.length,
    stdoutTruncated: Boolean(result?.stdoutTruncated),
    stderr,
    stderrBytes: result?.stderrBytes ?? stderr.length,
    stderrTruncated: Boolean(result?.stderrTruncated),
  };
}

function processEnded(result) {
  return result.processState !== "unknown" && result.terminationConfirmed;
}

const GIT_READ_CONFIG_ARGS = Object.freeze([
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "diff.external=",
  "-c",
  "interactive.diffFilter=",
]);

async function runGitCommand(
  dependencies,
  invocation,
  targetDirectory,
  args,
  {
    purpose,
    acceptedExitCodes = [0],
    timeoutMs = 30_000,
    maxStdoutBytes = MAX_VALIDATION_OUTPUT_BYTES,
    maxStderrBytes = MAX_STDERR_BYTES,
    writeOperation = false,
  } = {},
) {
  const environment = buildClosedEnvironment(dependencies.environment);
  if (writeOperation) environment.GIT_OPTIONAL_LOCKS = "1";
  const result = normalizeProcessResult(
    await dependencies.runGitProcess({
      purpose: `git-${purpose}`,
      command: invocation.command,
      args: [...invocation.prefixArgs, ...GIT_READ_CONFIG_ARGS, ...args],
      cwd: targetDirectory,
      env: environment,
      timeoutMs,
      captureStdout: true,
      maxStdoutBytes,
      maxStderrBytes,
    }),
  );
  if (!processEnded(result)) {
    dependencies.processStateUnknown = true;
    fail("git_process_state_unknown");
  }
  if (result.timedOut) fail("git_timeout");
  if (result.stdoutTruncated || result.stderrTruncated) fail("git_output_limit");
  if (!acceptedExitCodes.includes(result.exitCode)) fail("git_command_failed");
  return result;
}

function decodeGitText(buffer, code = "git_output_invalid") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(code);
  }
}

function exactGitLine(buffer, code = "git_output_invalid") {
  const text = decodeGitText(buffer, code);
  const value = text.replace(/\r?\n$/, "");
  if (value.length === 0 || /[\r\n\0]/.test(value)) fail(code);
  return value;
}

async function inspectRelativePath(targetDirectory, relativePath, dependencies) {
  const implementation = pathImplementationFor(targetDirectory);
  let current = targetDirectory;
  const components = relativePath.split("/");
  for (let index = 0; index < components.length; index += 1) {
    current = implementation.join(current, components[index]);
    const information = await pathInformation(current, dependencies.lstat);
    if (!information.exists) return { path: relativePath, state: "absent", sha256: null };
    if (information.stat.isSymbolicLink()) fail("preflight_path_symlink");
    const final = index === components.length - 1;
    if (!final) {
      if (!information.stat.isDirectory()) fail("preflight_path_invalid");
      continue;
    }
    if (!information.stat.isFile()) fail("preflight_path_invalid");
    const bytes = await dependencies.readFile(current);
    return {
      path: relativePath,
      state: "file",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  fail("preflight_path_invalid");
}

function statusPaths(status) {
  return status.flatMap((entry) =>
    entry.kind === "renamed" ? [entry.originalPath, entry.path] : [entry.path],
  );
}

async function inspectPathHashes(targetDirectory, paths, dependencies) {
  const values = [];
  for (const relativePath of paths) {
    values.push(
      await inspectRelativePath(targetDirectory, relativePath, dependencies),
    );
  }
  return values;
}

async function verifyNoSymlinkComponents(absolutePath, dependencies) {
  const implementation = pathImplementationFor(absolutePath);
  const parsed = implementation.parse(absolutePath);
  let current = parsed.root;
  const components = absolutePath
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  for (const component of components) {
    current = implementation.join(current, component);
    const information = await pathInformation(current, dependencies.lstat);
    if (!information.exists) return;
    if (information.stat.isSymbolicLink()) fail("preflight_path_symlink");
  }
}

async function verifyArtifactPreflight(manifest, dependencies) {
  const target = await pathInformation(
    manifest.route.targetDirectory,
    dependencies.lstat,
  );
  if (
    !target.exists ||
    !target.stat.isDirectory() ||
    target.stat.isSymbolicLink()
  ) {
    fail("target_directory_invalid");
  }
  await verifyNoSymlinkComponents(manifest.route.targetDirectory, dependencies);
  const targetRealPath = await dependencies.realpath(manifest.route.targetDirectory);

  const temporaryDirectory = manifest.artifacts.temporaryDirectory;
  const temporaryParent = pathImplementationFor(temporaryDirectory).dirname(
    temporaryDirectory,
  );
  const parent = await pathInformation(temporaryParent, dependencies.lstat);
  if (
    !parent.exists ||
    !parent.stat.isDirectory() ||
    parent.stat.isSymbolicLink()
  ) {
    fail("artifact_parent_invalid");
  }
  await verifyNoSymlinkComponents(temporaryParent, dependencies);
  const [temporaryParentRealPath, manifestRealPath] = await Promise.all([
    dependencies.realpath(temporaryParent),
    dependencies.realpath(manifest.artifacts.manifestPath),
  ]);
  if (
    pathsEqual(targetRealPath, temporaryParentRealPath) ||
    pathIsInside(targetRealPath, temporaryParentRealPath, { allowEqual: true }) ||
    pathsEqual(targetRealPath, manifestRealPath) ||
    pathIsInside(targetRealPath, manifestRealPath, { allowEqual: true })
  ) {
    fail("manifest_artifacts_invalid");
  }
  for (const field of [
    "temporaryDirectory",
    "evidencePath",
    "messagePath",
    "hooksDirectory",
  ]) {
    const information = await pathInformation(
      manifest.artifacts[field],
      dependencies.lstat,
    );
    if (information.exists) fail("artifact_path_exists");
  }
}

async function inspectIndexHash(
  manifest,
  dependencies,
  gitInvocation,
) {
  const indexResult = await runGitCommand(
    dependencies,
    gitInvocation,
    manifest.route.targetDirectory,
    ["rev-parse", "--git-path", "index"],
    { purpose: "index-path" },
  );
  const rawIndexPath = exactGitLine(indexResult.stdout);
  const implementation = pathImplementationFor(manifest.route.targetDirectory);
  const indexPath = implementation.isAbsolute(rawIndexPath)
    ? rawIndexPath
    : implementation.resolve(manifest.route.targetDirectory, rawIndexPath);
  const information = await pathInformation(indexPath, dependencies.lstat);
  if (
    !information.exists ||
    !information.stat.isFile() ||
    information.stat.isSymbolicLink()
  ) {
    fail("preflight_index_invalid");
  }
  const bytes = await dependencies.readFile(indexPath);
  return {
    path: indexPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function captureRepositoryState(
  manifest,
  dependencies,
  gitInvocation,
) {
  const targetDirectory = manifest.route.targetDirectory;
  const rootResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-parse", "--show-toplevel"],
    { purpose: "root" },
  );
  const reportedRoot = exactGitLine(rootResult.stdout);
  const [reportedRootRealPath, targetRealPath] = await Promise.all([
    dependencies.realpath(reportedRoot),
    dependencies.realpath(targetDirectory),
  ]);
  if (!pathsEqual(reportedRootRealPath, targetRealPath)) {
    fail("preflight_repository_root_mismatch");
  }
  const branchResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { purpose: "branch", acceptedExitCodes: [0, 1] },
  );
  const branch =
    branchResult.exitCode === 0 ? exactGitLine(branchResult.stdout) : null;
  const headResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-parse", "HEAD"],
    { purpose: "head" },
  );
  const head = exactGitLine(headResult.stdout);
  const indexResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["diff", "--cached", "--quiet", "--exit-code", "HEAD", "--"],
    { purpose: "index-empty", acceptedExitCodes: [0, 1] },
  );
  const statusResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ],
    { purpose: "status" },
  );
  const status = parsePorcelainV2Status(statusResult.stdout);
  const ownedPathHashes = await inspectPathHashes(
    targetDirectory,
    manifest.ownedPaths,
    dependencies,
  );
  const dirtyPaths = [...new Set(statusPaths(status))].sort(compareStrings);
  const dirtyPathHashes = await inspectPathHashes(
    targetDirectory,
    dirtyPaths,
    dependencies,
  );
  const index = await inspectIndexHash(manifest, dependencies, gitInvocation);
  return {
    branch,
    head,
    indexEmpty: indexResult.exitCode === 0,
    index,
    status,
    ownedPathHashes,
    dirtyPathHashes,
  };
}

function statesEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

async function preflightWriter(manifest, dependencies) {
  await verifyArtifactPreflight(manifest, dependencies);
  const gitInvocation = validateResolvedGitInvocation(
    await dependencies.resolveGit(),
  );
  const [targetRealPath, gitRealPath] = await Promise.all([
    dependencies.realpath(manifest.route.targetDirectory),
    dependencies.realpath(gitInvocation.command),
  ]);
  if (
    pathsEqual(targetRealPath, gitRealPath) ||
    pathIsInside(targetRealPath, gitRealPath, { allowEqual: true })
  ) {
    fail("git_executable_inside_checkout");
  }
  const state = await captureRepositoryState(
    manifest,
    dependencies,
    gitInvocation,
  );
  if (state.branch !== manifest.baseline.branch) {
    fail("preflight_branch_mismatch");
  }
  if (state.head !== manifest.baseline.head) fail("preflight_head_mismatch");
  if (!state.indexEmpty) fail("preflight_index_not_empty");

  const actualStatusPaths = new Set(statusPaths(state.status));
  if (
    state.ownedPathHashes.some(
      (entry, index) =>
        !statesEqual(entry, manifest.baseline.ownedPathHashes[index]),
    ) ||
    manifest.ownedPaths.some((ownedPath) => actualStatusPaths.has(ownedPath))
  ) {
    fail("preflight_owned_path_dirty");
  }
  if (!statesEqual(state.status, manifest.baseline.status)) {
    fail("preflight_status_mismatch");
  }
  if (!statesEqual(state.dirtyPathHashes, manifest.baseline.dirtyPathHashes)) {
    fail("preflight_baseline_dirty_changed");
  }
  return { gitInvocation, state };
}

function subtractStatusEntries(current, baseline) {
  const remaining = new Map();
  for (const entry of baseline) {
    const key = stableJson(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const delta = [];
  for (const entry of current) {
    const key = stableJson(entry);
    const count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1);
    else delta.push(entry);
  }
  if ([...remaining.values()].some((count) => count !== 0)) {
    fail("worker_baseline_status_changed");
  }
  return delta;
}

async function assessWorkerDelta(manifest, dependencies, preflight) {
  const state = await captureRepositoryState(
    manifest,
    dependencies,
    preflight.gitInvocation,
  );
  if (state.branch !== manifest.baseline.branch) fail("worker_branch_changed");
  if (state.head !== manifest.baseline.head) fail("worker_head_changed");
  if (!state.indexEmpty || state.index.sha256 !== preflight.state.index.sha256) {
    fail("worker_index_changed");
  }

  const baselineDirtyPaths = manifest.baseline.dirtyPathHashes.map(
    (entry) => entry.path,
  );
  const baselineDirtyPathHashes = await inspectPathHashes(
    manifest.route.targetDirectory,
    baselineDirtyPaths,
    dependencies,
  );
  if (!statesEqual(baselineDirtyPathHashes, manifest.baseline.dirtyPathHashes)) {
    fail("worker_baseline_dirty_changed");
  }

  const deltaEntries = subtractStatusEntries(
    state.status,
    manifest.baseline.status,
  );
  if (
    deltaEntries.some(
      (entry) => entry.kind === "unmerged" || (entry.xy && entry.xy[0] !== "."),
    )
  ) {
    fail("worker_index_changed");
  }
  const actualCandidatePaths = [...new Set(statusPaths(deltaEntries))].sort(
    compareStrings,
  );
  const unexpectedPaths = actualCandidatePaths.filter(
    (candidatePath) => !manifest.commit.candidatePaths.includes(candidatePath),
  );
  if (unexpectedPaths.length > 0) fail("worker_delta_out_of_contract");
  if (!statesEqual(actualCandidatePaths, manifest.commit.candidatePaths)) {
    fail("worker_delta_mismatch");
  }

  for (let index = 0; index < state.ownedPathHashes.length; index += 1) {
    const actual = state.ownedPathHashes[index];
    const baseline = manifest.baseline.ownedPathHashes[index];
    const candidate = manifest.commit.candidatePaths.includes(actual.path);
    if (candidate === statesEqual(actual, baseline)) {
      fail(candidate ? "worker_delta_mismatch" : "worker_delta_out_of_contract");
    }
  }
  return {
    ...state,
    deltaEntries,
    candidatePaths: actualCandidatePaths,
    baselineDirtyPathHashes,
  };
}

function candidateStateFingerprint(state) {
  return stableJson({
    branch: state.branch,
    head: state.head,
    indexEmpty: state.indexEmpty,
    indexSha256: state.index.sha256,
    status: state.status,
    ownedPathHashes: state.ownedPathHashes,
    baselineDirtyPathHashes: state.baselineDirtyPathHashes,
    candidatePaths: state.candidatePaths,
  });
}

async function validateExecutableAtRuntime(manifest, validation, dependencies) {
  const information = await pathInformation(
    validation.executable,
    dependencies.lstat,
  );
  if (
    !information.exists ||
    !information.stat.isFile() ||
    information.stat.isSymbolicLink()
  ) {
    fail("validation_executable_invalid");
  }
  await verifyNoSymlinkComponents(validation.executable, dependencies);
  const [targetRealPath, executableRealPath] = await Promise.all([
    dependencies.realpath(manifest.route.targetDirectory),
    dependencies.realpath(validation.executable),
  ]);
  if (
    pathsEqual(targetRealPath, executableRealPath) ||
    pathIsInside(targetRealPath, executableRealPath, { allowEqual: true })
  ) {
    fail("validation_executable_invalid");
  }
  try {
    await dependencies.access(validation.executable, fsConstants.X_OK);
  } catch {
    fail("validation_executable_invalid");
  }
}

async function validationWorkingDirectory(manifest, validation, dependencies) {
  const implementation = pathImplementationFor(manifest.route.targetDirectory);
  const workingDirectory =
    validation.workingDirectory === "."
      ? manifest.route.targetDirectory
      : implementation.join(
          manifest.route.targetDirectory,
          ...validation.workingDirectory.split("/"),
        );
  const information = await pathInformation(workingDirectory, dependencies.lstat);
  if (
    !information.exists ||
    !information.stat.isDirectory() ||
    information.stat.isSymbolicLink()
  ) {
    fail("validation_working_directory_invalid");
  }
  try {
    await verifyNoSymlinkComponents(workingDirectory, dependencies);
  } catch (error) {
    if (launcherClassification(error) === "preflight_path_symlink") {
      fail("validation_working_directory_invalid");
    }
    throw error;
  }
  const [targetRealPath, workingRealPath] = await Promise.all([
    dependencies.realpath(manifest.route.targetDirectory),
    dependencies.realpath(workingDirectory),
  ]);
  if (
    !pathsEqual(targetRealPath, workingRealPath) &&
    !pathIsInside(targetRealPath, workingRealPath)
  ) {
    fail("validation_working_directory_invalid");
  }
  return workingDirectory;
}

async function runDeterministicValidations(
  manifest,
  dependencies,
  preflight,
  expectedCandidateState,
) {
  const evidence = [];
  for (const validation of manifest.validations) {
    await validateExecutableAtRuntime(manifest, validation, dependencies);
    const cwd = await validationWorkingDirectory(
      manifest,
      validation,
      dependencies,
    );
    const result = normalizeProcessResult(
      await dependencies.runValidationProcess({
        purpose: `validation:${validation.purpose}`,
        command: validation.executable,
        args: [...validation.args],
        cwd,
        env: buildClosedEnvironment(dependencies.environment),
        timeoutMs: validation.timeoutMs,
        captureStdout: true,
        maxStdoutBytes: validation.maxStdoutBytes,
        maxStderrBytes: validation.maxStderrBytes,
      }),
    );
    evidence.push({
      purpose: validation.purpose,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdoutBytes: result.stdoutBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrBytes: result.stderrBytes,
      stderrTruncated: result.stderrTruncated,
    });
    const processQuiescent = processEnded(result);
    let stateUnchanged = false;
    if (processQuiescent) {
      try {
        const afterValidation = await assessWorkerDelta(
          manifest,
          dependencies,
          preflight,
        );
        stateUnchanged =
          candidateStateFingerprint(afterValidation) ===
          candidateStateFingerprint(expectedCandidateState);
      } catch {
        stateUnchanged = false;
      }
    }
    result.stdout.fill(0);
    result.stderr.fill(0);
    if (!processQuiescent) {
      dependencies.processStateUnknown = true;
      fail("validation_process_state_unknown");
    }
    if (!stateUnchanged) fail("validation_created_delta");
    if (result.timedOut) fail("validation_timeout");
    if (result.stdoutTruncated || result.stderrTruncated) {
      fail("validation_output_limit");
    }
    if (result.exitCode !== validation.expectedExitCode) {
      fail("validation_exit_nonzero");
    }
  }
  return evidence;
}

function parseNulPathList(buffer, code) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(code);
  }
  if (text === "") return [];
  const values = text.split("\0");
  if (values.at(-1) !== "") fail(code);
  values.pop();
  if (values.some((value) => !isExactRelativePath(value))) fail(code);
  return values;
}

async function verifyEmptyHooksDirectory(manifest, dependencies) {
  const information = await pathInformation(
    manifest.artifacts.hooksDirectory,
    dependencies.lstat,
  );
  if (
    !information.exists ||
    !information.stat.isDirectory() ||
    information.stat.isSymbolicLink() ||
    (await dependencies.readdir(manifest.artifacts.hooksDirectory)).length !== 0
  ) {
    fail("hooks_directory_not_empty");
  }
}

async function rejectCustomFilters(manifest, dependencies, gitInvocation) {
  const result = await runGitCommand(
    dependencies,
    gitInvocation,
    manifest.route.targetDirectory,
    ["check-attr", "-z", "filter", "--", ...manifest.ownedPaths],
    { purpose: "check-filter" },
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  } catch {
    fail("git_check_attr_malformed");
  }
  const values = text === "" ? [] : text.split("\0");
  if (values.at(-1) === "") values.pop();
  if (values.length !== manifest.ownedPaths.length * 3) {
    fail("git_check_attr_malformed");
  }
  for (let index = 0; index < values.length; index += 3) {
    const expectedPath = manifest.ownedPaths[index / 3];
    if (
      values[index] !== expectedPath ||
      values[index + 1] !== "filter" ||
      !["unspecified", "unset"].includes(values[index + 2])
    ) {
      if (
        values[index] === expectedPath &&
        values[index + 1] === "filter" &&
        values[index + 2]
      ) {
        fail("custom_filter_forbidden");
      }
      fail("git_check_attr_malformed");
    }
  }
}

async function writeAndVerifyCommitMessage(manifest, dependencies) {
  const bytes = Buffer.from(manifest.commit.message, "utf8");
  try {
    await dependencies.writeFile(manifest.artifacts.messagePath, bytes, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail("artifact_path_exists");
    throw error;
  }
  const information = await pathInformation(
    manifest.artifacts.messagePath,
    dependencies.lstat,
  );
  if (
    !information.exists ||
    !information.stat.isFile() ||
    information.stat.isSymbolicLink() ||
    information.stat.size !== bytes.length
  ) {
    fail("commit_message_file_invalid");
  }
  const roundTrip = await dependencies.readFile(manifest.artifacts.messagePath);
  if (
    createHash("sha256").update(roundTrip).digest("hex") !==
      manifest.commit.messageSha256 ||
    roundTrip.length !== bytes.length ||
    !timingSafeEqual(roundTrip, bytes)
  ) {
    fail("commit_message_file_invalid");
  }
}

async function cachedPaths(
  manifest,
  dependencies,
  gitInvocation,
) {
  const result = await runGitCommand(
    dependencies,
    gitInvocation,
    manifest.route.targetDirectory,
    [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--no-renames",
      "HEAD",
      "--",
    ],
    { purpose: "cached-paths" },
  );
  return parseNulPathList(result.stdout, "cached_paths_malformed").sort(
    compareStrings,
  );
}

async function stagedTree(manifest, dependencies, gitInvocation) {
  const result = await runGitCommand(
    dependencies,
    gitInvocation,
    manifest.route.targetDirectory,
    ["write-tree"],
    { purpose: "write-tree", writeOperation: true },
  );
  const tree = exactGitLine(result.stdout);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree)) {
    fail("staged_tree_invalid");
  }
  return tree;
}

async function verifyStagedCandidate(
  manifest,
  dependencies,
  preflight,
  candidateState,
  expectedTree,
) {
  const state = await captureRepositoryState(
    manifest,
    dependencies,
    preflight.gitInvocation,
  );
  if (state.branch !== manifest.baseline.branch) fail("race_branch_changed");
  if (state.head !== manifest.baseline.head) fail("race_head_changed");
  if (state.indexEmpty) fail("race_index_changed");
  if (!statesEqual(state.ownedPathHashes, candidateState.ownedPathHashes)) {
    fail("race_owned_path_changed");
  }
  const baselineDirtyPathHashes = await inspectPathHashes(
    manifest.route.targetDirectory,
    manifest.baseline.dirtyPathHashes.map((entry) => entry.path),
    dependencies,
  );
  if (!statesEqual(baselineDirtyPathHashes, manifest.baseline.dirtyPathHashes)) {
    fail("race_baseline_dirty_changed");
  }
  const deltaEntries = subtractStatusEntries(
    state.status,
    manifest.baseline.status,
  );
  const deltaPaths = [...new Set(statusPaths(deltaEntries))].sort(compareStrings);
  if (!statesEqual(deltaPaths, manifest.commit.candidatePaths)) {
    fail("race_status_changed");
  }
  if (
    deltaEntries.some(
      (entry) =>
        entry.kind === "unmerged" ||
        !entry.xy ||
        entry.xy[0] === "." ||
        entry.xy[1] !== ".",
    )
  ) {
    fail("race_index_changed");
  }
  const cached = await cachedPaths(manifest, dependencies, preflight.gitInvocation);
  if (!statesEqual(cached, manifest.commit.candidatePaths)) {
    fail("cached_paths_mismatch");
  }
  const tree = await stagedTree(manifest, dependencies, preflight.gitInvocation);
  if (tree !== expectedTree) fail("race_index_changed");
}

function rawCommitMessage(buffer) {
  const separator = buffer.indexOf(Buffer.from("\n\n"));
  if (separator < 0) fail("commit_object_malformed");
  return buffer.subarray(separator + 2);
}

async function verifyCommittedCandidate(
  manifest,
  dependencies,
  preflight,
  candidateState,
  expectedTree,
) {
  const targetDirectory = manifest.route.targetDirectory;
  const gitInvocation = preflight.gitInvocation;
  const headResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-parse", "HEAD"],
    { purpose: "verify-head" },
  );
  const candidateHead = exactGitLine(headResult.stdout);
  const parentResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-parse", "HEAD^"],
    { purpose: "verify-parent" },
  );
  const parent = exactGitLine(parentResult.stdout);
  if (parent !== manifest.baseline.head) fail("commit_parent_mismatch");
  const parentsResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-list", "--parents", "--max-count=1", "HEAD"],
    { purpose: "verify-parents" },
  );
  const parentTokens = exactGitLine(parentsResult.stdout).split(" ");
  if (
    parentTokens.length !== 2 ||
    parentTokens[0] !== candidateHead ||
    parentTokens[1] !== manifest.baseline.head
  ) {
    fail("commit_parent_mismatch");
  }
  const countResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-list", "--count", `${manifest.baseline.head}..HEAD`],
    { purpose: "verify-count" },
  );
  if (exactGitLine(countResult.stdout) !== "1") fail("commit_count_mismatch");

  const treeResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["rev-parse", "HEAD^{tree}"],
    { purpose: "verify-tree" },
  );
  const tree = exactGitLine(treeResult.stdout);
  if (tree !== expectedTree) fail("commit_tree_mismatch");

  const pathsResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-z",
      "--no-renames",
      "-r",
      "HEAD",
    ],
    { purpose: "verify-paths" },
  );
  const changedPaths = parseNulPathList(
    pathsResult.stdout,
    "commit_paths_malformed",
  ).sort(compareStrings);
  if (!statesEqual(changedPaths, manifest.commit.candidatePaths)) {
    fail("commit_paths_mismatch");
  }

  const commitResult = await runGitCommand(
    dependencies,
    gitInvocation,
    targetDirectory,
    ["cat-file", "commit", "HEAD"],
    {
      purpose: "verify-message",
      maxStdoutBytes: MAX_COMMIT_MESSAGE_BYTES + 64 * 1024,
    },
  );
  const actualMessage = rawCommitMessage(commitResult.stdout);
  const expectedMessage = Buffer.from(manifest.commit.message, "utf8");
  if (
    actualMessage.length !== expectedMessage.length ||
    !timingSafeEqual(actualMessage, expectedMessage)
  ) {
    fail("commit_message_mismatch");
  }

  const state = await captureRepositoryState(
    manifest,
    dependencies,
    gitInvocation,
  );
  if (
    state.branch !== manifest.baseline.branch ||
    state.head !== candidateHead ||
    !state.indexEmpty ||
    !statesEqual(state.status, manifest.baseline.status) ||
    !statesEqual(state.ownedPathHashes, candidateState.ownedPathHashes)
  ) {
    fail("commit_post_state_mismatch");
  }
  const baselineDirtyPathHashes = await inspectPathHashes(
    manifest.route.targetDirectory,
    manifest.baseline.dirtyPathHashes.map((entry) => entry.path),
    dependencies,
  );
  if (!statesEqual(baselineDirtyPathHashes, manifest.baseline.dirtyPathHashes)) {
    fail("commit_post_state_mismatch");
  }
  return { head: candidateHead, parent, tree, paths: changedPaths };
}

async function sealCandidate(
  manifest,
  dependencies,
  preflight,
  candidateState,
  summary,
) {
  await writeAndVerifyCommitMessage(manifest, dependencies);
  await rejectCustomFilters(manifest, dependencies, preflight.gitInvocation);
  await dependencies.onCheckpoint("before-stage-reverify", {
    manifest,
    summary,
  });
  let beforeStage;
  try {
    beforeStage = await assessWorkerDelta(manifest, dependencies, preflight);
  } catch (error) {
    const classification = launcherClassification(error);
    const raceClassification = {
      worker_branch_changed: "race_branch_changed",
      worker_head_changed: "race_head_changed",
      worker_index_changed: "race_index_changed",
      worker_baseline_dirty_changed: "race_baseline_dirty_changed",
      worker_baseline_status_changed: "race_status_changed",
      worker_delta_out_of_contract: "race_status_changed",
      worker_delta_mismatch: "race_status_changed",
    }[classification];
    fail(raceClassification ?? classification);
  }
  if (
    candidateStateFingerprint(beforeStage) !==
    candidateStateFingerprint(candidateState)
  ) {
    fail("race_candidate_changed_before_stage");
  }
  await verifyEmptyHooksDirectory(manifest, dependencies);

  summary.recovery.classification = "failed_after_stage";
  summary.recovery.stageAttempted = true;
  for (const candidatePath of manifest.commit.candidatePaths) {
    await runGitCommand(
      dependencies,
      preflight.gitInvocation,
      manifest.route.targetDirectory,
      ["add", "--all", "--", candidatePath],
      { purpose: `stage:${candidatePath}`, writeOperation: true },
    );
  }
  await dependencies.onCheckpoint("after-stage", { manifest, summary });
  const cached = await cachedPaths(manifest, dependencies, preflight.gitInvocation);
  if (!statesEqual(cached, manifest.commit.candidatePaths)) {
    fail("cached_paths_mismatch");
  }
  const diffCheck = await runGitCommand(
    dependencies,
    preflight.gitInvocation,
    manifest.route.targetDirectory,
    ["diff", "--cached", "--check", "--no-ext-diff", "HEAD", "--"],
    {
      purpose: "cached-diff-check",
      acceptedExitCodes: [0, 1, 2],
    },
  );
  if (diffCheck.exitCode !== 0) fail("cached_diff_check_failed");
  const expectedTree = await stagedTree(
    manifest,
    dependencies,
    preflight.gitInvocation,
  );

  await dependencies.onCheckpoint("before-commit-reverify", {
    manifest,
    summary,
  });
  await verifyEmptyHooksDirectory(manifest, dependencies);
  await verifyStagedCandidate(
    manifest,
    dependencies,
    preflight,
    candidateState,
    expectedTree,
  );

  const commitResult = await runGitCommand(
    dependencies,
    preflight.gitInvocation,
    manifest.route.targetDirectory,
    [
      "-c",
      `core.hooksPath=${manifest.artifacts.hooksDirectory}`,
      "-c",
      "commit.gpgSign=false",
      "-c",
      "tag.gpgSign=false",
      "commit",
      "--no-gpg-sign",
      "--cleanup=verbatim",
      "--file",
      manifest.artifacts.messagePath,
    ],
    {
      purpose: "commit",
      acceptedExitCodes: [0, 1, 128],
      writeOperation: true,
    },
  );
  if (commitResult.exitCode !== 0) {
    const headAfterFailure = await runGitCommand(
      dependencies,
      preflight.gitInvocation,
      manifest.route.targetDirectory,
      ["rev-parse", "HEAD"],
      { purpose: "commit-failure-head" },
    );
    if (exactGitLine(headAfterFailure.stdout) !== manifest.baseline.head) {
      summary.recovery.classification = "failed_after_commit";
      summary.recovery.commitCreated = true;
      fail("commit_failed_after_head_move");
    }
    fail("commit_failed");
  }
  summary.recovery.classification = "failed_after_commit";
  summary.recovery.commitCreated = true;
  await dependencies.onCheckpoint("after-commit", { manifest, summary });
  const candidate = await verifyCommittedCandidate(
    manifest,
    dependencies,
    preflight,
    candidateState,
    expectedTree,
  );
  summary.recovery.classification = "not_needed";
  return candidate;
}

async function removeAndVerifyExactDirectory(targetPath, dependencies) {
  try {
    await dependencies.rm(targetPath, { recursive: true, force: false });
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }
  try {
    const information = await pathInformation(targetPath, dependencies.lstat);
    return !information.exists;
  } catch {
    return false;
  }
}

async function cleanupWriterRuntime(
  manifest,
  dependencies,
  summary,
  {
    invocation,
    sessionId,
    workerLaunched,
    processQuiescent,
    runtimeDirectoryCreated,
  },
) {
  const failures = [];
  const environment = buildWriterChildEnvironment(
    manifest,
    dependencies.environment,
  );
  if (!processQuiescent) {
    summary.cleanup.session = "blocked-process-unknown";
    summary.cleanup.evidence = {
      path: manifest.artifacts.evidencePath,
      state: "blocked-process-unknown",
      verified: false,
    };
    summary.cleanup.temporaryDirectory = {
      path: manifest.artifacts.temporaryDirectory,
      state: runtimeDirectoryCreated ? "retained-process-unknown" : "not-created",
      verified: !runtimeDirectoryCreated,
    };
    summary.cleanup.message = {
      path: manifest.artifacts.messagePath,
      state: runtimeDirectoryCreated ? "retained-process-unknown" : "not-created",
      verified: !runtimeDirectoryCreated,
    };
    summary.cleanup.hooksDirectory = {
      path: manifest.artifacts.hooksDirectory,
      state: runtimeDirectoryCreated ? "retained-process-unknown" : "not-created",
      verified: !runtimeDirectoryCreated,
    };
    summary.cleanup.manifest = {
      path: manifest.artifacts.manifestPath,
      state: "retained-process-unknown",
      verified: false,
    };
    return failures;
  }

  if (!workerLaunched) {
    summary.cleanup.session = "not-created";
    summary.session = { id: null, state: "not-created", absenceVerified: true };
  } else if (!sessionId || !invocation) {
    summary.cleanup.session = "unknown";
    failures.push("session_cleanup_failed");
  } else {
    let deleteResult;
    let absenceResult;
    let cleanupProcessUnknown = false;
    try {
      deleteResult = normalizeProcessResult(
        await dependencies.runWorkerProcess({
          purpose: "session-delete",
          command: invocation.command,
          args: [...invocation.prefixArgs, "session", "delete", sessionId],
          cwd: manifest.route.targetDirectory,
          env: environment,
          timeoutMs: Math.min(manifest.timeoutMs, 30_000),
          captureStdout: false,
        }),
      );
      if (!processEnded(deleteResult)) {
        cleanupProcessUnknown = true;
      } else {
        absenceResult = normalizeProcessResult(
          await dependencies.runWorkerProcess({
            purpose: "session-absence-export",
            command: invocation.command,
            args: [
              ...invocation.prefixArgs,
              "export",
              sessionId,
              "--sanitize",
            ],
            cwd: manifest.route.targetDirectory,
            env: environment,
            timeoutMs: Math.min(manifest.timeoutMs, 30_000),
            captureStdout: true,
            maxStdoutBytes: MAX_CAPTURED_STDOUT_BYTES,
          }),
        );
        if (!processEnded(absenceResult)) cleanupProcessUnknown = true;
      }
    } catch {
      cleanupProcessUnknown = true;
    }
    if (cleanupProcessUnknown) {
      deleteResult?.stdout.fill(0);
      deleteResult?.stderr.fill(0);
      absenceResult?.stdout.fill(0);
      absenceResult?.stderr.fill(0);
      summary.cleanup.session = "blocked-process-unknown";
      summary.session = { id: sessionId, state: "unknown", absenceVerified: false };
      summary.cleanup.evidence = {
        path: manifest.artifacts.evidencePath,
        state: "retained-process-unknown",
        verified: false,
      };
      summary.cleanup.temporaryDirectory = {
        path: manifest.artifacts.temporaryDirectory,
        state: "retained-process-unknown",
        verified: false,
      };
      summary.cleanup.message = {
        path: manifest.artifacts.messagePath,
        state: "retained-process-unknown",
        verified: false,
      };
      summary.cleanup.hooksDirectory = {
        path: manifest.artifacts.hooksDirectory,
        state: "retained-process-unknown",
        verified: false,
      };
      summary.cleanup.manifest = {
        path: manifest.artifacts.manifestPath,
        state: "retained-process-unknown",
        verified: false,
      };
      return ["cleanup_process_state_unknown"];
    }
    const absenceVerified = Boolean(
      deleteResult &&
        absenceResult &&
        processEnded(deleteResult) &&
        processEnded(absenceResult) &&
        !deleteResult.timedOut &&
        deleteResult.exitCode === 0 &&
        !absenceResult.timedOut &&
        absenceResult.exitCode !== 0 &&
        (outputProvesMissingSession(absenceResult.stderr, sessionId) ||
          outputProvesMissingSession(absenceResult.stdout, sessionId)),
    );
    deleteResult?.stdout.fill(0);
    deleteResult?.stderr.fill(0);
    absenceResult?.stdout.fill(0);
    absenceResult?.stderr.fill(0);
    if (absenceVerified) {
      summary.cleanup.session = "deleted";
      summary.session = { id: sessionId, state: "deleted", absenceVerified: true };
    } else {
      summary.cleanup.session = "failed";
      summary.session = { id: sessionId, state: "unknown", absenceVerified: false };
      if (!failures.includes("session_cleanup_failed")) {
        failures.push("session_cleanup_failed");
      }
    }
  }

  let temporaryRemoved = true;
  if (!runtimeDirectoryCreated) {
    for (const [summaryField, artifactField] of [
      ["temporaryDirectory", "temporaryDirectory"],
      ["evidence", "evidencePath"],
      ["message", "messagePath"],
      ["hooksDirectory", "hooksDirectory"],
    ]) {
      const information = await pathInformation(
        manifest.artifacts[artifactField],
        dependencies.lstat,
      );
      summary.cleanup[summaryField] = {
        path: manifest.artifacts[artifactField],
        state: information.exists ? "pre-existing-unowned" : "not-created",
        verified: true,
      };
    }
  } else {
    if (manifest.cleanup.temporaryDirectory) {
      temporaryRemoved = await removeAndVerifyExactDirectory(
        manifest.artifacts.temporaryDirectory,
        dependencies,
      );
      if (!temporaryRemoved) failures.push("temporary_cleanup_failed");
    }
    summary.cleanup.temporaryDirectory = {
      path: manifest.artifacts.temporaryDirectory,
      state: temporaryRemoved ? "deleted" : "failed",
      verified: temporaryRemoved,
    };
    for (const [summaryField, artifactField] of [
      ["evidence", "evidencePath"],
      ["message", "messagePath"],
      ["hooksDirectory", "hooksDirectory"],
    ]) {
      summary.cleanup[summaryField] = {
        path: manifest.artifacts[artifactField],
        state: temporaryRemoved
          ? "deleted-with-temporary-directory"
          : "retained-cleanup-failed",
        verified: temporaryRemoved,
      };
    }
  }

  let manifestRemoved = false;
  if (failures.length === 0 && manifest.cleanup.manifest) {
    manifestRemoved = await removeAndVerifyExactFile(
      manifest.artifacts.manifestPath,
      dependencies,
    );
    if (!manifestRemoved) failures.push("manifest_cleanup_failed");
  }
  summary.cleanup.manifest = {
    path: manifest.artifacts.manifestPath,
    state: manifestRemoved
      ? "deleted"
      : failures.length > 0
        ? "retained-cleanup-failed"
        : "retained",
    verified: manifestRemoved || !manifest.cleanup.manifest,
  };
  return failures;
}

function collectSessionIds(event) {
  const candidates = [
    event.sessionID,
    event.sessionId,
    event.part?.sessionID,
    event.part?.sessionId,
  ];
  return candidates.filter(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );
}

function extractToolEvent(event) {
  const part = isRecord(event.part) ? event.part : {};
  const state = isRecord(part.state) ? part.state : {};
  const tool = part.tool ?? part.name ?? event.tool;
  const input = state.input ?? part.input ?? event.input;
  const status = state.status ?? part.status ?? event.status;
  return {
    tool: typeof tool === "string" ? tool : null,
    input: isRecord(input) ? input : null,
    status: typeof status === "string" ? status.toLowerCase() : null,
  };
}

export function parseNdjsonEvidence(text) {
  const events = [];
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    try {
      const event = JSON.parse(line);
      if (!isRecord(event) || typeof event.type !== "string") {
        errors.push({ line: index + 1, code: "invalid_event" });
      } else {
        events.push(event);
      }
    } catch {
      errors.push({ line: index + 1, code: "invalid_json" });
    }
  }

  const sessionIds = new Set();
  const typeCounts = {
    step_start: 0,
    tool_use: 0,
    step_finish: 0,
    text: 0,
    error: 0,
    other: 0,
  };
  const toolEvents = [];
  const textParts = [];
  const stepFinishes = [];

  for (const event of events) {
    collectSessionIds(event).forEach((id) => sessionIds.add(id));
    if (Object.hasOwn(typeCounts, event.type)) typeCounts[event.type] += 1;
    else typeCounts.other += 1;
    if (event.type === "tool_use") toolEvents.push(extractToolEvent(event));
    if (event.type === "text") {
      const textPart = event.part?.text ?? event.text;
      if (typeof textPart === "string") textParts.push(textPart);
      else errors.push({ code: "invalid_text_event" });
    }
    if (event.type === "step_finish") stepFinishes.push(event);
  }

  const lastFinish = stepFinishes.at(-1);
  const finalReason = lastFinish?.part?.reason ?? lastFinish?.reason ?? null;
  return {
    events,
    errors,
    sessionIds: [...sessionIds],
    typeCounts,
    toolEvents,
    workerText: textParts.join("\n"),
    finalReason: typeof finalReason === "string" ? finalReason : null,
  };
}

function parseWorkerReport(text) {
  const headings = [];
  const lines = text.split(/\r?\n/);
  let status = null;
  for (const line of lines) {
    const match = line.match(/^- \*\*([^*\r\n]+):\*\*\s*(.*)$/);
    if (!match) continue;
    headings.push(match[1]);
    if (match[1] === "Status") {
      const statusMatch = match[2].match(/^`?(done|partial|blocked)`?(?:\b|[,.;:])/i);
      if (statusMatch) status = statusMatch[1].toLowerCase();
    }
  }
  return { headings, status };
}

function isSubset(expected, actual) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => isSubset(item, actual[index]))
    );
  }
  if (isRecord(expected)) {
    return (
      isRecord(actual) &&
      Object.entries(expected).every(([key, value]) =>
        Object.hasOwn(actual, key) && isSubset(value, actual[key]),
      )
    );
  }
  return Object.is(expected, actual);
}

function toolEventCompleted(status) {
  return (
    status === null ||
    ["completed", "done", "success", "succeeded"].includes(status)
  );
}

function assessEvidence(parsed, manifest) {
  const failures = [];
  const add = (code) => {
    if (!failures.includes(code)) failures.push(code);
  };
  if (parsed.errors.length > 0) add("evidence_malformed");
  if (parsed.sessionIds.length !== 1) add("session_identity_invalid");
  if (parsed.typeCounts.error > 0) add("runtime_error_event");
  if (parsed.finalReason !== "stop") add("terminal_stop_missing");

  const report = parseWorkerReport(parsed.workerText);
  if (
    report.headings.length !== manifest.expected.headings.length ||
    report.headings.some(
      (heading, index) => heading !== manifest.expected.headings[index],
    )
  ) {
    add("worker_headings_invalid");
  }
  if (report.status !== manifest.expected.workerStatus) {
    add("worker_status_mismatch");
  }
  if (report.status !== "done") add("worker_not_done");
  if (parsed.toolEvents.length === 0) add("text_only_result");
  if (parsed.toolEvents.some((event) => !toolEventCompleted(event.status))) {
    add("tool_event_failed");
  }

  const expectations = manifest.expected.toolEvents.map((expectation) => {
    const matched = parsed.toolEvents.filter(
      (event) =>
        event.tool === expectation.tool &&
        event.input !== null &&
        isSubset(expectation.input, event.input) &&
        toolEventCompleted(event.status),
    ).length;
    if (matched < expectation.minimum) add("required_tool_event_missing");
    return {
      tool: expectation.tool,
      required: expectation.minimum,
      matched,
    };
  });

  return { failures, report, expectations };
}

function assessWriterEvidence(parsed, manifest) {
  const failures = [];
  const add = (code) => {
    if (!failures.includes(code)) failures.push(code);
  };
  if (parsed.errors.length > 0) add("evidence_malformed");
  if (parsed.sessionIds.length !== 1) add("session_identity_invalid");
  if (parsed.typeCounts.error > 0) add("runtime_error_event");
  if (parsed.finalReason !== "stop") add("terminal_stop_missing");

  const report = parseWorkerReport(parsed.workerText);
  if (
    report.headings.length !== manifest.expected.headings.length ||
    report.headings.some(
      (heading, index) => heading !== manifest.expected.headings[index],
    )
  ) {
    add("worker_headings_invalid");
  }
  if (report.status !== manifest.expected.workerStatus) {
    add("worker_status_mismatch");
  }
  if (report.status !== "done") add("worker_not_done");

  const mutations = manifest.expected.mutations.map((expectation) => {
    const relevant = parsed.toolEvents.filter(
      (event) =>
        event.tool === expectation.tool &&
        event.input !== null &&
        isSubset(expectation.input, event.input),
    );
    const mutationCompleted = (event) =>
      event.status !== null && toolEventCompleted(event.status);
    const matched = relevant.filter(mutationCompleted).length;
    if (relevant.some((event) => !mutationCompleted(event))) {
      add("mutation_event_failed");
    }
    if (matched < expectation.minimum) add("required_mutation_missing");
    return {
      tool: expectation.tool,
      required: expectation.minimum,
      matched,
    };
  });
  if (
    parsed.toolEvents.some(
      (event) =>
        !toolEventCompleted(event.status) &&
        !manifest.expected.mutations.some(
          (expectation) =>
            event.tool === expectation.tool &&
            event.input !== null &&
            isSubset(expectation.input, event.input),
        ),
    )
  ) {
    add("tool_event_failed");
  }
  return { failures, report, mutations };
}

function safeRouteIdentity(value) {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : null;
}

function identityCandidate(record) {
  if (!isRecord(record)) return null;
  let provider = record.providerID ?? record.providerId;
  let model = record.modelID ?? record.modelId;
  if (isRecord(record.model)) {
    provider ??= record.model.providerID ?? record.model.providerId;
    model ??= record.model.modelID ?? record.model.modelId ?? record.model.id;
  } else if (typeof record.model === "string") {
    const separator = record.model.indexOf("/");
    if (separator > 0) {
      provider ??= record.model.slice(0, separator);
      model ??= record.model.slice(separator + 1);
    } else {
      model ??= record.model;
    }
  }
  if (typeof record.provider === "string") provider ??= record.provider;
  if (typeof model === "string" && typeof provider === "string") {
    if (model.startsWith(`${provider}/`)) model = model.slice(provider.length + 1);
    return {
      provider: safeRouteIdentity(provider),
      model: safeRouteIdentity(model),
      agent: safeRouteIdentity(record.agent ?? record.agentName),
      variant: safeRouteIdentity(record.variant),
      assistant: record.role === "assistant",
    };
  }
  return null;
}

export function parseSanitizedExportIdentity(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return null;
  let parsed;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    try {
      parsed = JSON.parse(text);
    } catch {
      const lines = text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line));
      parsed = lines.length === 1 ? lines[0] : lines;
    }
  } catch {
    return null;
  }

  const candidates = [];
  let visited = 0;
  const visit = (value, depth = 0) => {
    if (depth > 64 || visited > 100_000 || value === null) return;
    visited += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    const candidate = identityCandidate(value);
    if (
      candidate?.provider &&
      candidate?.model &&
      candidate.provider.length <= 256 &&
      candidate.model.length <= 256
    ) {
      candidates.push(candidate);
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(parsed);

  const assistantCandidates = candidates.filter((candidate) => candidate.assistant);
  const pool = assistantCandidates.length > 0 ? assistantCandidates : candidates;
  if (pool.length === 0) return null;
  if (assistantCandidates.length > 0) return pool.at(-1);
  const unique = new Map(
    pool.map((candidate) => [
      `${candidate.provider}/${candidate.model}`,
      candidate,
    ]),
  );
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function outputProvesMissingSession(output, sessionId) {
  if (
    !Buffer.isBuffer(output) ||
    output.length === 0 ||
    !SAFE_SESSION_ID.test(sessionId)
  ) {
    return false;
  }
  const text = output.toString("utf8").toLowerCase();
  const missing =
    /not found|does not exist|unknown session|session[^\r\n]*missing|no session/.test(
      text,
    );
  if (!missing) return false;
  if (text.includes(sessionId.toLowerCase())) return true;
  return (
    /(?:^|[\r\n])(?:error:\s*)?session (?:not found|does not exist|is missing)[.!]?(?:$|[\r\n])/i.test(
      text,
    ) ||
    /"(?:error|message)"\s*:\s*"session (?:not found|does not exist|is missing)[.!]?"/i.test(
      text,
    )
  );
}

async function readEvidence(evidencePath, dependencies) {
  const information = await pathInformation(evidencePath, dependencies.lstat);
  if (
    !information.exists ||
    !information.stat.isFile() ||
    information.stat.isSymbolicLink() ||
    information.stat.size > MAX_EVIDENCE_BYTES
  ) {
    fail("evidence_file_invalid");
  }
  const bytes = await dependencies.readFile(evidencePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("evidence_file_invalid");
  }
}

async function removeAndVerifyExactFile(targetPath, dependencies) {
  try {
    await dependencies.unlink(targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }
  try {
    const information = await pathInformation(targetPath, dependencies.lstat);
    return !information.exists;
  } catch {
    return false;
  }
}

async function verifyRetainedFile(targetPath, dependencies) {
  try {
    const information = await pathInformation(targetPath, dependencies.lstat);
    return Boolean(
      information.exists &&
        information.stat.isFile() &&
        !information.stat.isSymbolicLink(),
    );
  } catch {
    return false;
  }
}

function emptyEventSummary() {
  return {
    counts: {
      step_start: 0,
      tool_use: 0,
      step_finish: 0,
      text: 0,
      error: 0,
      other: 0,
    },
    tools: [],
    mutations: [],
    workerStatus: null,
    terminalReason: null,
    headingsValid: false,
  };
}

function initialSummary(manifest = null, manifestPath = null) {
  const evidencePath = manifest?.artifacts?.evidencePath ?? manifest?.evidencePath ?? null;
  return {
    schema: RESULT_SCHEMA_ID,
    status: "blocked",
    classification: "launcher_blocked",
    selectedRoute: manifest
      ? {
          runtime: manifest.runtime,
          agent: manifest.route.agent,
          model: manifest.route.model,
          variant: manifest.route.variant,
          targetDirectory: manifest.route.targetDirectory,
          branch: manifest.route.branch,
        }
      : null,
    effectiveRoute: null,
    session: { id: null, state: "not-created", absenceVerified: true },
    events: emptyEventSummary(),
    process: {
      invocationKind: null,
      exitCode: null,
      timedOut: false,
      stderrBytes: 0,
      stderrOmitted: true,
    },
    cleanup: {
      session: "not-created",
      evidence: manifest
        ? { path: evidencePath, state: "not-created", verified: true }
        : { path: null, state: "unknown", verified: false },
      manifest: {
        path: manifestPath,
        state: manifestPath ? "retained" : "unknown",
        verified: Boolean(manifestPath),
      },
      temporaryDirectory: manifest?.artifacts
        ? {
            path: manifest.artifacts.temporaryDirectory,
            state: "not-created",
            verified: true,
          }
        : null,
      message: manifest?.artifacts
        ? {
            path: manifest.artifacts.messagePath,
            state: "not-created",
            verified: true,
          }
        : null,
      hooksDirectory: manifest?.artifacts
        ? {
            path: manifest.artifacts.hooksDirectory,
            state: "not-created",
            verified: true,
          }
        : null,
    },
    policy: manifest
      ? { identity: manifest.policy.identity, proof: manifest.policy.proof }
      : null,
    actionNeeded: "supply a valid absolute manifest and matching lowercase sha256",
  };
}

function addFailure(failures, code, action) {
  if (!failures.some((failure) => failure.code === code)) {
    failures.push({ code, action });
  }
}

function selectFailure(failures) {
  const priorities = [
    "process_state_unknown",
    "session_cleanup_failed",
    "evidence_cleanup_failed",
    "manifest_cleanup_failed",
    "runtime_timeout",
    "runtime_exit_nonzero",
    "runtime_launch_failed",
    "opencode_direct_executable_not_found",
    "effective_identity_unproven",
    "effective_identity_mismatch",
    "session_identity_invalid",
    "required_tool_event_missing",
    "tool_event_failed",
    "worker_not_done",
    "worker_status_mismatch",
    "worker_headings_invalid",
    "terminal_stop_missing",
    "evidence_malformed",
    "runtime_error_event",
    "text_only_result",
    "launcher_blocked",
  ];
  for (const code of priorities) {
    const match = failures.find((failure) => failure.code === code);
    if (match) return match;
  }
  return failures[0] ?? null;
}

function validateResolvedInvocation(invocation) {
  if (
    !isRecord(invocation) ||
    typeof invocation.command !== "string" ||
    invocation.command.length === 0 ||
    !Array.isArray(invocation.prefixArgs) ||
    invocation.prefixArgs.some((argument) => typeof argument !== "string") ||
    invocation.prefixArgs.includes("--auto") ||
    !OPENCODE_INVOCATION_KINDS.includes(invocation.kind)
  ) {
    fail("runtime_resolution_invalid");
  }
  return invocation;
}

function validateResolvedGitInvocation(invocation) {
  if (
    !isRecord(invocation) ||
    !isAbsolutePath(invocation.command) ||
    !Array.isArray(invocation.prefixArgs) ||
    invocation.prefixArgs.length !== 0 ||
    !GIT_INVOCATION_KINDS.includes(invocation.kind)
  ) {
    fail("git_resolution_invalid");
  }
  return invocation;
}

export function createLauncherDependencies(overrides = {}) {
  const dependencies = {
    platform: process.platform,
    environment: process.env,
    processStateUnknown: false,
    access: nodeAccess,
    lstat: nodeLstat,
    mkdir: nodeMkdir,
    open: nodeOpen,
    readdir: nodeReaddir,
    readFile: nodeReadFile,
    realpath: nodeRealpath,
    rm: nodeRm,
    unlink: nodeUnlink,
    writeFile: nodeWriteFile,
    spawn: nodeSpawn,
    terminateProcessTree: undefined,
    resolveGit: undefined,
    resolveOpenCode: undefined,
    onCheckpoint: async () => {},
    runGitProcess: undefined,
    runProcess: undefined,
    runValidationProcess: undefined,
    runWorkerProcess: undefined,
    ...overrides,
  };
  dependencies.resolveOpenCode ??= () =>
    resolveOpenCodeInvocation({
      platform: dependencies.platform,
      environment: dependencies.environment,
      access: dependencies.access,
    });
  dependencies.resolveGit ??= () =>
    resolveGitInvocation({
      platform: dependencies.platform,
      environment: dependencies.environment,
      access: dependencies.access,
      lstat: dependencies.lstat,
    });
  dependencies.runProcess ??= (specification) =>
    executeProcess(specification, dependencies);
  dependencies.runGitProcess ??= dependencies.runProcess;
  dependencies.runValidationProcess ??= dependencies.runProcess;
  dependencies.runWorkerProcess ??= dependencies.runProcess;
  return dependencies;
}

export async function classifyMissingSummaryRecovery(
  manifest,
  dependencyOverrides = {},
) {
  const result = {
    classification: "ambiguous_stop",
    baselineHead: manifest?.baseline?.head ?? null,
    head: null,
    candidate: null,
    actionNeeded: "stop without cleanup or history rewriting",
  };
  try {
    validateManifest(manifest, {
      manifestPath: manifest.artifacts.manifestPath,
    });
    const dependencies = createLauncherDependencies(dependencyOverrides);
    const gitInvocation = validateResolvedGitInvocation(
      await dependencies.resolveGit(),
    );
    const state = await captureRepositoryState(
      manifest,
      dependencies,
      gitInvocation,
    );
    result.head = state.head;
    if (state.branch !== manifest.baseline.branch || !state.indexEmpty) return result;
    const baselineDirtyPathHashes = await inspectPathHashes(
      manifest.route.targetDirectory,
      manifest.baseline.dirtyPathHashes.map((entry) => entry.path),
      dependencies,
    );
    if (!statesEqual(baselineDirtyPathHashes, manifest.baseline.dirtyPathHashes)) {
      return result;
    }

    if (state.head === manifest.baseline.head) {
      let deltaEntries;
      try {
        deltaEntries = subtractStatusEntries(
          state.status,
          manifest.baseline.status,
        );
      } catch {
        return result;
      }
      const deltaPaths = [...new Set(statusPaths(deltaEntries))].sort(compareStrings);
      if (
        deltaEntries.some(
          (entry) => entry.kind === "unmerged" || (entry.xy && entry.xy[0] !== "."),
        ) ||
        deltaPaths.some((relativePath) => !manifest.ownedPaths.includes(relativePath))
      ) {
        return result;
      }
      result.classification = "no_candidate_sealed";
      result.actionNeeded =
        "audit the confined owned edits before deciding on a fresh dispatch";
      return result;
    }

    if (!statesEqual(state.status, manifest.baseline.status)) return result;
    const targetDirectory = manifest.route.targetDirectory;
    const parentResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      ["rev-parse", "HEAD^"],
      { purpose: "recovery-parent" },
    );
    if (exactGitLine(parentResult.stdout) !== manifest.baseline.head) return result;
    const parentsResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      ["rev-list", "--parents", "--max-count=1", "HEAD"],
      { purpose: "recovery-parents" },
    );
    const parentTokens = exactGitLine(parentsResult.stdout).split(" ");
    if (
      parentTokens.length !== 2 ||
      parentTokens[0] !== state.head ||
      parentTokens[1] !== manifest.baseline.head
    ) {
      return result;
    }
    const countResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      ["rev-list", "--count", `${manifest.baseline.head}..HEAD`],
      { purpose: "recovery-count" },
    );
    if (exactGitLine(countResult.stdout) !== "1") return result;
    const pathsResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-z",
        "--no-renames",
        "-r",
        "HEAD",
      ],
      { purpose: "recovery-paths" },
    );
    const changedPaths = parseNulPathList(
      pathsResult.stdout,
      "recovery_paths_malformed",
    ).sort(compareStrings);
    if (!statesEqual(changedPaths, manifest.commit.candidatePaths)) return result;
    const commitResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      ["cat-file", "commit", "HEAD"],
      {
        purpose: "recovery-message",
        maxStdoutBytes: MAX_COMMIT_MESSAGE_BYTES + 64 * 1024,
      },
    );
    const message = rawCommitMessage(commitResult.stdout);
    const expectedMessage = Buffer.from(manifest.commit.message, "utf8");
    if (
      message.length !== expectedMessage.length ||
      !timingSafeEqual(message, expectedMessage)
    ) {
      return result;
    }
    const treeResult = await runGitCommand(
      dependencies,
      gitInvocation,
      targetDirectory,
      ["rev-parse", "HEAD^{tree}"],
      { purpose: "recovery-tree" },
    );
    result.classification = "candidate_sealed_requires_audit";
    result.candidate = {
      head: state.head,
      parent: manifest.baseline.head,
      tree: exactGitLine(treeResult.stdout),
      paths: changedPaths,
    };
    result.actionNeeded =
      "independently audit the exact candidate and runtime cleanup before acceptance";
    return result;
  } catch {
    return result;
  }
}

async function captureRecoveryCheckout(manifest, dependencies, preflight) {
  const state = await captureRepositoryState(
    manifest,
    dependencies,
    preflight.gitInvocation,
  );
  let cached = [];
  if (!state.indexEmpty) {
    cached = await cachedPaths(manifest, dependencies, preflight.gitInvocation);
  }
  return {
    branch: state.branch,
    head: state.head,
    indexEmpty: state.indexEmpty,
    indexSha256: state.index.sha256,
    status: state.status,
    cachedPaths: cached,
    ownedPathHashes: state.ownedPathHashes,
    dirtyPathHashes: state.dirtyPathHashes,
  };
}

async function runWriterExternalAgent(
  manifest,
  { manifestPath },
  dependencyOverrides = {},
) {
  const dependencies = createLauncherDependencies(dependencyOverrides);
  const summary = initialSummary(manifest, manifestPath);
  const failures = [];
  const add = (code) => {
    if (!failures.includes(code)) failures.push(code);
  };
  summary.recovery = {
    classification: "failed_before_stage",
    stageAttempted: false,
    commitCreated: false,
  };
  let preflight = null;
  let invocation = null;
  let sessionId = null;
  let processQuiescent = true;
  let candidateState = null;
  let runtimeDirectoryCreated = false;
  let workerLaunched = false;
  try {
    preflight = await preflightWriter(manifest, dependencies);
    summary.process.gitInvocationKind = preflight.gitInvocation.kind;

    try {
      await dependencies.mkdir(manifest.artifacts.temporaryDirectory, {
        recursive: false,
        mode: 0o700,
      });
      runtimeDirectoryCreated = true;
      await dependencies.mkdir(manifest.artifacts.hooksDirectory, {
        recursive: false,
        mode: 0o700,
      });
    } catch (error) {
      if (error?.code === "EEXIST") fail("artifact_path_exists");
      throw error;
    }
    const hooks = await pathInformation(
      manifest.artifacts.hooksDirectory,
      dependencies.lstat,
    );
    if (
      !hooks.exists ||
      !hooks.stat.isDirectory() ||
      hooks.stat.isSymbolicLink() ||
      (await dependencies.readdir(manifest.artifacts.hooksDirectory)).length !== 0
    ) {
      fail("hooks_directory_not_empty");
    }
    summary.cleanup.temporaryDirectory = {
      path: manifest.artifacts.temporaryDirectory,
      state: "created",
      verified: true,
    };

    invocation = validateResolvedInvocation(await dependencies.resolveOpenCode());
    const environment = buildWriterChildEnvironment(
      manifest,
      dependencies.environment,
    );
    workerLaunched = true;
    let workerProcessResult;
    try {
      workerProcessResult = await dependencies.runWorkerProcess({
        purpose: "worker-run",
        command: invocation.command,
        args: [...invocation.prefixArgs, ...buildRunArguments(manifest)],
        cwd: manifest.route.targetDirectory,
        env: environment,
        timeoutMs: manifest.timeoutMs,
        stdoutPath: manifest.artifacts.evidencePath,
        captureStdout: false,
      });
    } catch (error) {
      processQuiescent = false;
      dependencies.processStateUnknown = true;
      throw error;
    }
    const runResult = normalizeProcessResult(workerProcessResult);
    summary.process = {
      invocationKind: invocation.kind,
      gitInvocationKind: preflight.gitInvocation.kind,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
      stderrBytes: runResult.stderrBytes,
      stderrOmitted: true,
    };
    processQuiescent = processEnded(runResult);
    if (!processQuiescent) {
      dependencies.processStateUnknown = true;
      add("process_state_unknown");
    }
    if (runResult.processState === "not-started") add("runtime_launch_failed");
    if (runResult.timedOut) add("runtime_timeout");
    if (runResult.exitCode !== 0 && !runResult.timedOut) add("runtime_exit_nonzero");

    if (processQuiescent) {
      try {
        const evidenceText = await readEvidence(
          manifest.artifacts.evidencePath,
          dependencies,
        );
        const parsed = parseNdjsonEvidence(evidenceText);
        const assessment = assessWriterEvidence(parsed, manifest);
        assessment.failures.forEach(add);
        sessionId =
          parsed.sessionIds.length === 1 && SAFE_SESSION_ID.test(parsed.sessionIds[0])
            ? parsed.sessionIds[0]
            : null;
        if (!sessionId) add("session_identity_invalid");
        summary.session = {
          id: sessionId,
          state: sessionId ? "created" : "unknown",
          absenceVerified: false,
        };
        summary.events = {
          counts: parsed.typeCounts,
          tools: [],
          mutations: assessment.mutations,
          workerStatus: assessment.report.status,
          terminalReason: parsed.finalReason,
          headingsValid:
            assessment.report.headings.length === AIRLOCK_HEADINGS.length &&
            assessment.report.headings.every(
              (heading, index) => heading === AIRLOCK_HEADINGS[index],
            ),
        };
      } catch (error) {
        add(launcherClassification(error));
      }
    }

    if (processQuiescent && sessionId) {
      const exportResult = normalizeProcessResult(
        await dependencies.runWorkerProcess({
          purpose: "effective-identity-export",
          command: invocation.command,
          args: [
            ...invocation.prefixArgs,
            "export",
            sessionId,
            "--sanitize",
          ],
          cwd: manifest.route.targetDirectory,
          env: environment,
          timeoutMs: Math.min(manifest.timeoutMs, 30_000),
          captureStdout: true,
          maxStdoutBytes: MAX_CAPTURED_STDOUT_BYTES,
        }),
      );
      if (!processEnded(exportResult)) {
        processQuiescent = false;
        dependencies.processStateUnknown = true;
        add("process_state_unknown");
      }
      let identity = null;
      if (
        exportResult.exitCode === 0 &&
        !exportResult.timedOut &&
        exportResult.terminationConfirmed &&
        !exportResult.stdoutTruncated
      ) {
        identity = parseSanitizedExportIdentity(exportResult.stdout);
      }
      exportResult.stdout.fill(0);
      exportResult.stderr.fill(0);
      if (!identity) add("effective_identity_unproven");
      else if (
        identity.provider !== manifest.expected.effectiveIdentity.provider ||
        identity.model !== manifest.expected.effectiveIdentity.model ||
        (identity.agent && identity.agent !== manifest.route.agent) ||
        (identity.variant && identity.variant !== manifest.route.variant)
      ) {
        add("effective_identity_mismatch");
      } else {
        summary.effectiveRoute = {
          runtime: "opencode",
          agent: identity.agent ?? manifest.route.agent,
          provider: identity.provider,
          model: identity.model,
          variant: identity.variant ?? manifest.route.variant,
          proof: "sanitized-export+argument-array",
        };
      }
    }

    if (processQuiescent) {
      try {
        candidateState = await assessWorkerDelta(
          manifest,
          dependencies,
          preflight,
        );
        summary.candidate = {
          baselineHead: manifest.baseline.head,
          head: candidateState.head,
          paths: candidateState.candidatePaths,
          commit: null,
          tree: null,
        };
      } catch (error) {
        add(launcherClassification(error));
      }
    }

    const priorities = [
      "process_state_unknown",
      "runtime_timeout",
      "runtime_exit_nonzero",
      "runtime_launch_failed",
      "worker_not_done",
      "worker_status_mismatch",
      "worker_headings_invalid",
      "mutation_event_failed",
      "required_mutation_missing",
      "tool_event_failed",
      "effective_identity_mismatch",
      "effective_identity_unproven",
      "session_identity_invalid",
      "worker_branch_changed",
      "worker_head_changed",
      "worker_index_changed",
      "worker_baseline_dirty_changed",
      "worker_baseline_status_changed",
      "worker_delta_out_of_contract",
      "worker_delta_mismatch",
      "evidence_file_invalid",
      "evidence_malformed",
      "terminal_stop_missing",
      "runtime_error_event",
      "validation_process_state_unknown",
      "validation_created_delta",
      "validation_timeout",
      "validation_output_limit",
      "validation_exit_nonzero",
      "validation_executable_invalid",
      "validation_working_directory_invalid",
    ];
    const select = () =>
      priorities.find((classification) => failures.includes(classification)) ??
      failures[0];
    if (!select() && candidateState) {
      try {
        summary.validations = await runDeterministicValidations(
          manifest,
          dependencies,
          preflight,
          candidateState,
        );
      } catch (error) {
        add(launcherClassification(error));
      }
    }
    if (!select() && candidateState) {
      try {
        const sealed = await sealCandidate(
          manifest,
          dependencies,
          preflight,
          candidateState,
          summary,
        );
        summary.candidate = {
          baselineHead: manifest.baseline.head,
          head: sealed.head,
          parent: sealed.parent,
          paths: sealed.paths,
          commit: sealed.head,
          tree: sealed.tree,
        };
      } catch (error) {
        add(launcherClassification(error));
      }
    }
    const selected = select();
    if (selected) {
      summary.classification = selected;
      summary.actionNeeded = processQuiescent
        ? "inspect the confined checkout delta and correct the blocked worker result"
        : "confirm the exact child process tree is stopped before touching the checkout";
    } else {
      summary.status = "done";
      summary.classification = "complete";
      summary.actionNeeded = "none";
    }
  } catch (error) {
    summary.classification = launcherClassification(error);
    summary.actionNeeded =
      "restore the exact declared baseline and dispatch a fresh hashed manifest";
  }
  if (
    summary.status === "blocked" &&
    preflight &&
    processQuiescent &&
    !dependencies.processStateUnknown
  ) {
    try {
      summary.recovery.checkout = await captureRecoveryCheckout(
        manifest,
        dependencies,
        preflight,
      );
    } catch {
      summary.recovery.checkout = { state: "unknown" };
    }
  }
  let cleanupFailures = [];
  try {
    cleanupFailures = await cleanupWriterRuntime(
      manifest,
      dependencies,
      summary,
      {
        invocation,
        sessionId,
        workerLaunched,
        processQuiescent:
          processQuiescent && !dependencies.processStateUnknown,
        runtimeDirectoryCreated,
      },
    );
  } catch {
    cleanupFailures = ["writer_cleanup_failed"];
  }
  if (cleanupFailures.length > 0) {
    summary.status = "blocked";
    if (summary.recovery.commitCreated) {
      summary.classification = "cleanup_failed_after_commit";
      summary.recovery.classification = "cleanup_failed_after_commit";
      summary.actionNeeded =
        "preserve the candidate commit and remove only the exact declared runtime artifacts";
    } else if (summary.classification === "complete") {
      summary.classification = cleanupFailures[0];
      summary.actionNeeded =
        "remove only the exact declared runtime artifacts before acceptance";
    }
  }
  return summary;
}

async function runLegacyExternalAgent(
  manifest,
  { manifestPath },
  dependencyOverrides = {},
) {
  validateManifest(manifest, { manifestPath });
  const dependencies = createLauncherDependencies(dependencyOverrides);
  const summary = initialSummary(manifest, manifestPath);
  const failures = [];
  const environment = buildChildEnvironment(manifest, dependencies.environment);
  let invocation = null;
  let runResult = null;
  let parsed = null;
  let assessment = null;
  let sessionId = null;
  let launched = false;
  let processQuiescent = true;

  try {
    const target = await pathInformation(
      manifest.route.targetDirectory,
      dependencies.lstat,
    );
    const evidenceParent = await pathInformation(
      path.dirname(manifest.evidencePath),
      dependencies.lstat,
    );
    const evidence = await pathInformation(manifest.evidencePath, dependencies.lstat);
    if (!target.exists || !target.stat.isDirectory()) fail("target_directory_invalid");
    if (!evidenceParent.exists || !evidenceParent.stat.isDirectory()) {
      fail("evidence_parent_invalid");
    }
    if (evidence.exists) fail("evidence_path_exists");
    invocation = validateResolvedInvocation(await dependencies.resolveOpenCode());
    summary.process.invocationKind = invocation.kind;

    const args = [...invocation.prefixArgs, ...buildRunArguments(manifest)];
    launched = true;
    runResult = normalizeProcessResult(
      await dependencies.runProcess({
        purpose: "worker-run",
        command: invocation.command,
        args,
        cwd: manifest.route.targetDirectory,
        env: environment,
        timeoutMs: manifest.timeoutMs,
        stdoutPath: manifest.evidencePath,
        captureStdout: false,
      }),
    );
    summary.process = {
      invocationKind: invocation.kind,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
      stderrBytes: runResult.stderrBytes,
      stderrOmitted: true,
    };
    processQuiescent =
      runResult.processState !== "unknown" && runResult.terminationConfirmed;
    if (!processQuiescent) {
      addFailure(
        failures,
        "process_state_unknown",
        runResult.pid
          ? `confirm exact child process ${runResult.pid} and its tree are stopped before touching the checkout`
          : "confirm the exact child process tree is stopped before touching the checkout",
      );
    }
    if (runResult.processState === "not-started") {
      launched = false;
      addFailure(
        failures,
        "runtime_launch_failed",
        "restore the selected OpenCode executable and rerun with a fresh manifest",
      );
    }
    if (runResult.timedOut) {
      addFailure(
        failures,
        "runtime_timeout",
        "audit the checkout after the timed-out run, then decide whether to dispatch a fresh manifest",
      );
    }
    if (runResult.exitCode !== 0) {
      addFailure(
        failures,
        "runtime_exit_nonzero",
        "audit the checkout and rerun only after resolving the OpenCode process failure",
      );
    }

    if (processQuiescent) {
      try {
        const evidenceText = await readEvidence(manifest.evidencePath, dependencies);
        parsed = parseNdjsonEvidence(evidenceText);
        assessment = assessEvidence(parsed, manifest);
        for (const code of assessment.failures) {
          const action =
            code === "required_tool_event_missing" || code === "text_only_result"
              ? "rerun the approved dispatch and require every declared tool event"
              : code === "worker_not_done" || code === "worker_status_mismatch"
                ? "resolve the worker's blocked or partial result before redispatch"
                : "rerun only after correcting the declared result and evidence contract";
          addFailure(failures, code, action);
        }
        sessionId =
          parsed.sessionIds.length === 1 &&
          SAFE_SESSION_ID.test(parsed.sessionIds[0])
            ? parsed.sessionIds[0]
            : null;
        if (!sessionId) {
          addFailure(
            failures,
            "session_identity_invalid",
            "produce one safe exact OpenCode session ID before cleanup",
          );
        }
        summary.session = {
          id: sessionId,
          state: sessionId ? "created" : "unknown",
          absenceVerified: false,
        };
        summary.events = {
          counts: parsed.typeCounts,
          tools: assessment.expectations,
          workerStatus: assessment.report.status,
          terminalReason: parsed.finalReason,
          headingsValid:
            assessment.report.headings.length === AIRLOCK_HEADINGS.length &&
            assessment.report.headings.every(
              (heading, index) => heading === AIRLOCK_HEADINGS[index],
            ),
        };
      } catch (error) {
        addFailure(
          failures,
          launcherClassification(error),
          "inspect the exact evidence path and rerun with valid NDJSON evidence",
        );
      }
    }

    if (processQuiescent && sessionId) {
      const exportResult = normalizeProcessResult(
        await dependencies.runProcess({
          purpose: "effective-identity-export",
          command: invocation.command,
          args: [
            ...invocation.prefixArgs,
            "export",
            sessionId,
            "--sanitize",
          ],
          cwd: manifest.route.targetDirectory,
          env: environment,
          timeoutMs: Math.min(manifest.timeoutMs, 30_000),
          captureStdout: true,
          maxStdoutBytes: MAX_CAPTURED_STDOUT_BYTES,
        }),
      );
      if (!processEnded(exportResult)) {
        processQuiescent = false;
        addFailure(
          failures,
          "process_state_unknown",
          exportResult.pid
            ? `confirm exact child process ${exportResult.pid} and its tree are stopped before touching the checkout`
            : "confirm the exact child process tree is stopped before touching the checkout",
        );
      }
      let identity = null;
      if (
        exportResult.exitCode === 0 &&
        !exportResult.timedOut &&
        exportResult.terminationConfirmed &&
        !exportResult.stdoutTruncated
      ) {
        identity = parseSanitizedExportIdentity(exportResult.stdout);
      }
      exportResult.stdout.fill(0);
      exportResult.stderr.fill(0);
      if (!identity) {
        addFailure(
          failures,
          "effective_identity_unproven",
          "restore sanitized session export and prove the required effective provider and model",
        );
      } else if (
        identity.provider !== manifest.expected.effectiveIdentity.provider ||
        identity.model !== manifest.expected.effectiveIdentity.model ||
        (identity.agent && identity.agent !== manifest.route.agent) ||
        (identity.variant && identity.variant !== manifest.route.variant)
      ) {
        addFailure(
          failures,
          "effective_identity_mismatch",
          "stop and resolve the selected versus effective OpenCode route mismatch",
        );
      } else {
        summary.effectiveRoute = {
          runtime: "opencode",
          agent: identity.agent ?? manifest.route.agent,
          provider: identity.provider,
          model: identity.model,
          variant: identity.variant ?? manifest.route.variant,
          proof: "sanitized-export+argument-array",
        };
      }
    } else if (processQuiescent) {
      addFailure(
        failures,
        "effective_identity_unproven",
        "produce one exact session ID so effective provider and model can be proven",
      );
    }
  } catch (error) {
    if (launched) {
      processQuiescent = false;
      addFailure(
        failures,
        "process_state_unknown",
        "confirm the exact child process tree is stopped before touching the checkout",
      );
    }
    const classification = launcherClassification(error);
    addFailure(
      failures,
      classification,
      classification === "opencode_direct_executable_not_found"
        ? "install opencode-ai with node_modules/opencode-ai/bin/opencode.exe or expose a direct opencode.exe on PATH"
        : "correct the launcher precondition and dispatch a fresh hashed manifest",
    );
  }

  if (!processQuiescent) {
    summary.cleanup.session = "blocked-process-unknown";
    summary.cleanup.evidence = {
      path: manifest.evidencePath,
      state: "blocked-process-unknown",
      verified: false,
    };
    summary.cleanup.manifest = {
      path: manifestPath,
      state: "retained",
      verified: false,
    };
  } else {
    if (manifest.cleanup.session) {
      if (!launched) {
        summary.cleanup.session = "not-created";
        summary.session = { id: null, state: "not-created", absenceVerified: true };
      } else if (!sessionId || !invocation) {
        summary.cleanup.session = "unknown";
        addFailure(
          failures,
          "session_cleanup_failed",
          "recover one exact session ID before attempting any session cleanup",
        );
      } else {
        let deleteResult;
        try {
          deleteResult = normalizeProcessResult(
            await dependencies.runProcess({
              purpose: "session-delete",
              command: invocation.command,
              args: [...invocation.prefixArgs, "session", "delete", sessionId],
              cwd: manifest.route.targetDirectory,
              env: environment,
              timeoutMs: Math.min(manifest.timeoutMs, 30_000),
              captureStdout: false,
            }),
          );
        } catch {
          processQuiescent = false;
        }
        if (deleteResult && !processEnded(deleteResult)) processQuiescent = false;
        if (!processQuiescent) {
          deleteResult?.stderr.fill(0);
          summary.cleanup.session = "blocked-process-unknown";
          summary.session = {
            id: sessionId,
            state: "unknown",
            absenceVerified: false,
          };
          addFailure(
            failures,
            "process_state_unknown",
            deleteResult?.pid
              ? `confirm exact child process ${deleteResult.pid} and its tree are stopped before touching the checkout`
              : "confirm the exact child process tree is stopped before touching the checkout",
          );
        } else {
          let absenceResult;
          try {
            absenceResult = normalizeProcessResult(
              await dependencies.runProcess({
                purpose: "session-absence-export",
                command: invocation.command,
                args: [
                  ...invocation.prefixArgs,
                  "export",
                  sessionId,
                  "--sanitize",
                ],
                cwd: manifest.route.targetDirectory,
                env: environment,
                timeoutMs: Math.min(manifest.timeoutMs, 30_000),
                captureStdout: true,
                maxStdoutBytes: MAX_CAPTURED_STDOUT_BYTES,
              }),
            );
          } catch {
            processQuiescent = false;
          }
          if (absenceResult && !processEnded(absenceResult)) {
            processQuiescent = false;
          }
          if (!processQuiescent) {
            summary.cleanup.session = "blocked-process-unknown";
            summary.session = {
              id: sessionId,
              state: "unknown",
              absenceVerified: false,
            };
            addFailure(
              failures,
              "process_state_unknown",
              absenceResult?.pid
                ? `confirm exact child process ${absenceResult.pid} and its tree are stopped before touching the checkout`
                : "confirm the exact child process tree is stopped before touching the checkout",
            );
          } else {
            const absenceVerified =
              !absenceResult.timedOut &&
              absenceResult.exitCode !== 0 &&
              (outputProvesMissingSession(absenceResult.stderr, sessionId) ||
                outputProvesMissingSession(absenceResult.stdout, sessionId));
            if (absenceVerified) {
              summary.cleanup.session = "deleted";
              summary.session = {
                id: sessionId,
                state: "deleted",
                absenceVerified: true,
              };
            } else {
              summary.cleanup.session = "failed";
              summary.session = {
                id: sessionId,
                state: "unknown",
                absenceVerified: false,
              };
              addFailure(
                failures,
                "session_cleanup_failed",
                `delete and verify absence of exact OpenCode session ${sessionId}`,
              );
            }
          }
          absenceResult?.stdout.fill(0);
          absenceResult?.stderr.fill(0);
          deleteResult.stderr.fill(0);
        }
      }
    } else {
      summary.cleanup.session = sessionId ? "retained" : "unknown";
      summary.session = {
        id: sessionId,
        state: sessionId ? "retained" : "unknown",
        absenceVerified: false,
      };
    }

    if (!processQuiescent) {
      summary.cleanup.evidence = {
        path: manifest.evidencePath,
        state: "blocked-process-unknown",
        verified: false,
      };
      summary.cleanup.manifest = {
        path: manifestPath,
        state: "retained",
        verified: false,
      };
    } else if (manifest.cleanup.evidence) {
      const removed = await removeAndVerifyExactFile(
        manifest.evidencePath,
        dependencies,
      );
      summary.cleanup.evidence = {
        path: manifest.evidencePath,
        state: removed ? "deleted" : "failed",
        verified: removed,
      };
      if (!removed) {
        addFailure(
          failures,
          "evidence_cleanup_failed",
          `remove and verify absence of exact evidence path ${manifest.evidencePath}`,
        );
      }
    } else {
      const retained = await verifyRetainedFile(manifest.evidencePath, dependencies);
      summary.cleanup.evidence = {
        path: manifest.evidencePath,
        state: retained ? "retained" : "missing",
        verified: retained,
      };
      if (!retained) {
        addFailure(
          failures,
          "evidence_cleanup_failed",
          `restore the retained exact evidence path ${manifest.evidencePath}`,
        );
      }
    }

    if (!processQuiescent) {
      // Exact file cleanup is intentionally skipped while any child state is unknown.
    } else if (manifest.cleanup.manifest) {
      const removed = await removeAndVerifyExactFile(manifestPath, dependencies);
      summary.cleanup.manifest = {
        path: manifestPath,
        state: removed ? "deleted" : "failed",
        verified: removed,
      };
      if (!removed) {
        addFailure(
          failures,
          "manifest_cleanup_failed",
          `remove and verify absence of exact manifest path ${manifestPath}`,
        );
      }
    } else {
      const retained = await verifyRetainedFile(manifestPath, dependencies);
      summary.cleanup.manifest = {
        path: manifestPath,
        state: retained ? "retained" : "missing",
        verified: retained,
      };
      if (!retained) {
        addFailure(
          failures,
          "manifest_cleanup_failed",
          `restore the retained exact manifest path ${manifestPath}`,
        );
      }
    }
  }

  const selectedFailure = selectFailure(failures);
  if (selectedFailure) {
    summary.status = "blocked";
    summary.classification = selectedFailure.code;
    summary.actionNeeded = selectedFailure.action;
  } else {
    summary.status = "done";
    summary.classification = "complete";
    summary.actionNeeded = "none";
  }
  return summary;
}

export async function runExternalAgent(
  manifest,
  { manifestPath },
  dependencyOverrides = {},
) {
  validateManifest(manifest, { manifestPath });
  return manifest.schema === MANIFEST_SCHEMA_ID
    ? runWriterExternalAgent(manifest, { manifestPath }, dependencyOverrides)
    : runLegacyExternalAgent(manifest, { manifestPath }, dependencyOverrides);
}

function blockedCliSummary(code, manifestPath = null) {
  const summary = initialSummary(null, manifestPath);
  summary.classification = code;
  if (code === "manifest_hash_mismatch") {
    summary.actionNeeded = "supply the sha256 of the exact manifest bytes";
  } else if (code === "manifest_json_malformed") {
    summary.actionNeeded = "replace the malformed manifest and hash its exact bytes";
  }
  return summary;
}

export async function executeCli(argv, dependencyOverrides = {}) {
  const dependencies = createLauncherDependencies(dependencyOverrides);
  let cli;
  try {
    cli = parseCliArguments(argv);
  } catch (error) {
    return blockedCliSummary(launcherClassification(error));
  }
  try {
    const { manifest } = await loadManifest(cli, dependencies);
    return await runExternalAgent(
      manifest,
      { manifestPath: cli.manifestPath },
      dependencies,
    );
  } catch (error) {
    return blockedCliSummary(launcherClassification(error), cli.manifestPath);
  }
}

export async function main(
  argv = process.argv.slice(2),
  dependencyOverrides = {},
  output = process.stdout,
) {
  let summary;
  try {
    summary = await executeCli(argv, dependencyOverrides);
  } catch {
    summary = blockedCliSummary("launcher_blocked");
  }
  output.write(`${JSON.stringify(summary)}\n`);
  return summary.status === "done" ? 0 : 1;
}

export function isDirectExecutionPath(
  argumentPath,
  modulePath,
  platform = process.platform,
) {
  if (typeof argumentPath !== "string" || typeof modulePath !== "string") {
    return false;
  }
  const pathImplementation = platform === "win32" ? path.win32 : path.posix;
  const argument = pathImplementation.resolve(argumentPath);
  const module = pathImplementation.resolve(modulePath);
  return platform === "win32"
    ? argument.toLowerCase() === module.toLowerCase()
    : argument === module;
}

const isDirectExecution = isDirectExecutionPath(
  process.argv[1],
  fileURLToPath(import.meta.url),
);

if (isDirectExecution) {
  process.exitCode = await main();
}
