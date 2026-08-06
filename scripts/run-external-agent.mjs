import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access as nodeAccess,
  lstat as nodeLstat,
  open as nodeOpen,
  readFile as nodeReadFile,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

export const MANIFEST_SCHEMA_ID = "airlock.external-agent/v1";
export const RESULT_SCHEMA_ID = "airlock.external-agent-result/v1";

export const OPENCODE_INVOCATION_KINDS = Object.freeze([
  "direct-posix",
  "direct-exe-path",
  "direct-exe-npm",
]);

export const AIRLOCK_HEADINGS = Object.freeze([
  "Status",
  "Changes/findings",
  "Evidence",
  "Artifacts/cleanup",
  "Action needed",
]);

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

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURED_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PROMPT_CHARACTERS = 24_000;
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

export function validateManifest(value, { manifestPath } = {}) {
  exactKeys(value, MANIFEST_SCHEMA.keys.root);
  assertJsonValue(value);

  if (value.schema !== MANIFEST_SCHEMA_ID) fail("manifest_schema_unknown");
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

  exactKeys(value.route, MANIFEST_SCHEMA.keys.route);
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
  if (value.opencode.permission["*"] !== "deny") {
    fail("manifest_permission_not_total");
  }
  if (
    !isDenyOnly(value.opencode.permission.task) ||
    !isDenyOnly(value.opencode.permission.question)
  ) {
    fail("manifest_permission_not_total");
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

  exactKeys(value.expected, MANIFEST_SCHEMA.keys.expected);
  if (!MANIFEST_SCHEMA.enums.workerStatus.includes(value.expected.workerStatus)) {
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
    exactKeys(expectation, MANIFEST_SCHEMA.keys.toolEvent);
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
  }
  exactKeys(
    value.expected.effectiveIdentity,
    MANIFEST_SCHEMA.keys.effectiveIdentity,
  );
  if (
    value.expected.effectiveIdentity.provider !== selectedIdentity.provider ||
    value.expected.effectiveIdentity.model !== selectedIdentity.model
  ) {
    fail("manifest_expected_invalid");
  }

  exactKeys(value.cleanup, MANIFEST_SCHEMA.keys.cleanup);
  for (const field of ["session", "evidence", "manifest", "verifyAbsence"]) {
    if (typeof value.cleanup[field] !== "boolean") fail("manifest_cleanup_invalid");
  }
  if (!value.cleanup.verifyAbsence) fail("manifest_cleanup_invalid");

  exactKeys(value.retention, MANIFEST_SCHEMA.keys.retention);
  for (const field of ["session", "evidence", "manifest"]) {
    if (!MANIFEST_SCHEMA.enums.retention.includes(value.retention[field])) {
      fail("manifest_retention_invalid");
    }
    if (value.cleanup[field] !== (value.retention[field] === "temporary")) {
      fail("manifest_retention_invalid");
    }
  }
  if (value.retention.transcript !== "none") fail("manifest_retention_invalid");

  exactKeys(value.policy, MANIFEST_SCHEMA.keys.policy);
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
    workerStatus: null,
    terminalReason: null,
    headingsValid: false,
  };
}

function initialSummary(manifest = null, manifestPath = null) {
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
        ? { path: manifest.evidencePath, state: "not-created", verified: true }
        : { path: null, state: "unknown", verified: false },
      manifest: {
        path: manifestPath,
        state: manifestPath ? "retained" : "unknown",
        verified: Boolean(manifestPath),
      },
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

export function createLauncherDependencies(overrides = {}) {
  const dependencies = {
    platform: process.platform,
    environment: process.env,
    access: nodeAccess,
    lstat: nodeLstat,
    open: nodeOpen,
    readFile: nodeReadFile,
    unlink: nodeUnlink,
    spawn: nodeSpawn,
    terminateProcessTree: undefined,
    resolveOpenCode: undefined,
    runProcess: undefined,
    ...overrides,
  };
  dependencies.resolveOpenCode ??= () =>
    resolveOpenCodeInvocation({
      platform: dependencies.platform,
      environment: dependencies.environment,
      access: dependencies.access,
    });
  dependencies.runProcess ??= (specification) =>
    executeProcess(specification, dependencies);
  return dependencies;
}

export async function runExternalAgent(
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
