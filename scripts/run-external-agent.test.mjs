import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";

import {
  AIRLOCK_HEADINGS,
  LEGACY_MANIFEST_SCHEMA_ID,
  MANIFEST_SCHEMA_ID,
  buildChildEnvironment,
  computePolicyIdentity,
  executeCli,
  executeProcess,
  isDirectExecutionPath,
  main,
  outputProvesMissingSession,
  parsePorcelainV2Status,
  parseSanitizedExportIdentity,
  resolveGitInvocation,
  resolveOpenCodeInvocation,
  validateManifest,
} from "./run-external-agent.mjs";

const SESSION_ID = "ses_airlock_launcher_test";
const WRITER_SCHEMA_ID = MANIFEST_SCHEMA_ID;
const ZERO_SHA256 = "0".repeat(64);
const execFile = promisify(nodeExecFile);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function makeTemporaryTree(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "airlock-launcher-test-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const targetDirectory = path.join(root, "target");
  await mkdir(targetDirectory);
  return {
    root,
    targetDirectory,
    manifestPath: path.join(root, "dispatch.json"),
    evidencePath: path.join(root, "worker.ndjson"),
  };
}

async function git(targetDirectory, args, options = {}) {
  return execFile("git", args, {
    cwd: targetDirectory,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 10_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
  });
}

async function makeWriterRepository(t, overrides = {}) {
  const paths = await makeTemporaryTree(t);
  await git(paths.targetDirectory, ["init", "--initial-branch=main"]);
  await git(paths.targetDirectory, ["config", "user.name", "Airlock Test"]);
  await git(paths.targetDirectory, [
    "config",
    "user.email",
    "airlock-test@example.invalid",
  ]);
  const ownedBytes = Buffer.from(overrides.ownedBytes ?? "before\n", "utf8");
  await writeFile(path.join(paths.targetDirectory, "owned.txt"), ownedBytes);
  await git(paths.targetDirectory, ["add", "--", "owned.txt"]);
  await git(paths.targetDirectory, ["commit", "-m", "baseline"]);
  const { stdout } = await git(paths.targetDirectory, ["rev-parse", "HEAD"]);
  const head = stdout.trim();
  const manifest = makeWriterManifest(paths, {
    head,
    baseline: {
      ownedPathHashes: [
        { path: "owned.txt", state: "file", sha256: sha256(ownedBytes) },
      ],
    },
    ...overrides.manifest,
  });
  return { paths, head, manifest, ownedBytes };
}

async function makeSealingRepository(
  t,
  {
    baselineFiles = { "owned.txt": "before\n" },
    ownedPaths = Object.keys(baselineFiles),
    candidatePaths = [...ownedPaths],
    extraBaselineFiles = {},
  } = {},
) {
  const paths = await makeTemporaryTree(t);
  await git(paths.targetDirectory, ["init", "--initial-branch=main"]);
  await git(paths.targetDirectory, ["config", "user.name", "Airlock Test"]);
  await git(paths.targetDirectory, [
    "config",
    "user.email",
    "airlock-test@example.invalid",
  ]);
  const filesToCommit = { "baseline.txt": "baseline\n", ...extraBaselineFiles };
  for (const [relativePath, contents] of Object.entries(baselineFiles)) {
    if (contents !== null) filesToCommit[relativePath] = contents;
  }
  for (const [relativePath, contents] of Object.entries(filesToCommit)) {
    const absolutePath = path.join(
      paths.targetDirectory,
      ...relativePath.split("/"),
    );
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  await git(paths.targetDirectory, [
    "add",
    "--",
    ...Object.keys(filesToCommit),
  ]);
  await git(paths.targetDirectory, ["commit", "-m", "baseline"]);
  const { stdout } = await git(paths.targetDirectory, ["rev-parse", "HEAD"]);
  const head = stdout.trim();
  const ownedPathHashes = ownedPaths.map((relativePath) => {
    const contents = baselineFiles[relativePath];
    return contents === null || contents === undefined
      ? { path: relativePath, state: "absent", sha256: null }
      : {
          path: relativePath,
          state: "file",
          sha256: sha256(Buffer.from(contents, "utf8")),
        };
  });
  const manifest = makeWriterManifest(paths, {
    head,
    ownedPaths,
    candidatePaths,
    baseline: { ownedPathHashes },
  });
  return { paths, head, manifest };
}

async function executeWriterManifest(paths, manifest, dependencies = {}) {
  const manifestSha256 = await writeHashedManifest(paths, manifest);
  return executeCli(
    ["--manifest", paths.manifestPath, "--sha256", manifestSha256],
    dependencies,
  );
}

function makeManifest(paths, overrides = {}) {
  const route = {
    agent: "airlock-worker",
    model: "openai/gpt-5.4-mini",
    variant: "none",
    targetDirectory: paths.targetDirectory,
    branch: "main",
    ...overrides.route,
  };
  const config = {
    autoupdate: false,
    default_agent: route.agent,
    model: route.model,
    subagent_depth: 0,
    instructions: ["CONFIG_VALUE_MUST_NOT_BE_PRINTED"],
    ...overrides.config,
  };
  const permission = {
    "*": "deny",
    read: {
      "*": "allow",
      "**/.env*": "deny",
      "**/*credential*": "deny",
    },
    task: "deny",
    question: "deny",
    ...overrides.permission,
  };
  const policy = {
    identity: computePolicyIdentity(config, permission),
    proof: "AIRLOCK-E12",
  };
  const cleanup = {
    session: true,
    evidence: true,
    manifest: true,
    verifyAbsence: true,
    ...overrides.cleanup,
  };
  const retention = {
    session: cleanup.session ? "temporary" : "retained",
    evidence: cleanup.evidence ? "temporary" : "retained",
    manifest: cleanup.manifest ? "temporary" : "retained",
    transcript: "none",
    ...overrides.retention,
  };
  const prompt = [
    "Execute one complete approved dispatch.",
    "Pack AIRLOCK-P03; Crossing AIRLOCK-P03-C03.",
    `Runtime opencode; agent ${route.agent}; model ${route.model}; variant ${route.variant}.`,
    `Target ${route.targetDirectory}; branch ${route.branch}.`,
    `Evidence ${paths.evidencePath}.`,
    `Policy ${policy.identity}; proof ${policy.proof}.`,
    "PROMPT_VALUE_MUST_NOT_BE_PRINTED",
  ].join("\n");
  return {
    schema: LEGACY_MANIFEST_SCHEMA_ID,
    runtime: "opencode",
    packId: "AIRLOCK-P03",
    crossingId: "AIRLOCK-P03-C03",
    route,
    prompt,
    opencode: { config, permission },
    timeoutMs: overrides.timeoutMs ?? 5_000,
    evidencePath: paths.evidencePath,
    expected: {
      workerStatus: overrides.expectedWorkerStatus ?? "done",
      headings: [...AIRLOCK_HEADINGS],
      toolEvents: [
        {
          tool: "read",
          input: { filePath: path.join(paths.targetDirectory, "owned.txt") },
          minimum: 1,
        },
      ],
      effectiveIdentity: { provider: "openai", model: "gpt-5.4-mini" },
    },
    cleanup,
    retention,
    policy,
  };
}

function makeWriterManifest(paths, overrides = {}) {
  const ownedPaths = overrides.ownedPaths ?? ["owned.txt"];
  const candidatePaths = overrides.candidatePaths ?? [...ownedPaths];
  const route = {
    agent: "airlock-worker",
    model: "openai/gpt-5.4-mini",
    variant: "none",
    targetDirectory: paths.targetDirectory,
    branch: "main",
    ...overrides.route,
  };
  const absoluteOwnedPaths = ownedPaths.map((relativePath) =>
    path.join(route.targetDirectory, ...relativePath.split("/")),
  );
  const readPermission = { "*": "deny" };
  const editPermission = { "*": "deny" };
  for (const absolutePath of absoluteOwnedPaths) {
    readPermission[absolutePath] = "allow";
    editPermission[absolutePath] = "allow";
  }
  const config = {
    autoupdate: false,
    default_agent: route.agent,
    model: route.model,
    subagent_depth: 0,
    instructions: ["CONFIG_VALUE_MUST_NOT_BE_PRINTED"],
    ...overrides.config,
  };
  const permission = {
    "*": "deny",
    read: readPermission,
    edit: editPermission,
    bash: "deny",
    task: "deny",
    question: "deny",
    ...overrides.permission,
  };
  const policy = {
    identity: computePolicyIdentity(config, permission),
    proof: "AIRLOCK-E12",
  };
  const temporaryDirectory =
    overrides.temporaryDirectory ?? path.join(paths.root, "runtime");
  const artifacts = {
    manifestPath: paths.manifestPath,
    temporaryDirectory,
    evidencePath: path.join(temporaryDirectory, "worker.ndjson"),
    messagePath: path.join(temporaryDirectory, "commit-message.txt"),
    hooksDirectory: path.join(temporaryDirectory, "empty-hooks"),
    ...overrides.artifacts,
  };
  const message =
    overrides.message ?? "AIRLOCK-P04-C01: seal deterministic candidate\n";
  const baseline = {
    branch: route.branch,
    head: overrides.head ?? "1".repeat(40),
    indexEmpty: true,
    status: [],
    ownedPathHashes: ownedPaths.map((relativePath) => ({
      path: relativePath,
      state: "file",
      sha256: ZERO_SHA256,
    })),
    dirtyPathHashes: [],
    ...overrides.baseline,
  };
  const expected = {
    workerStatus: "done",
    headings: [...AIRLOCK_HEADINGS],
    mutations: [
      {
        tool: "edit",
        input: { filePath: absoluteOwnedPaths[0] },
        minimum: 1,
      },
    ],
    effectiveIdentity: { provider: "openai", model: "gpt-5.4-mini" },
    ...overrides.expected,
  };
  const prompt = [
    "Execute one approved writer dispatch without Git writes.",
    "Pack AIRLOCK-P04; Crossing AIRLOCK-P04-C01.",
    `Runtime opencode; agent ${route.agent}; model ${route.model}; variant ${route.variant}.`,
    `Target ${route.targetDirectory}; branch ${route.branch}; baseline ${baseline.head}.`,
    `Owned ${ownedPaths.join(", ")}; candidate ${candidatePaths.join(", ")}.`,
    `Evidence ${artifacts.evidencePath}; manifest ${artifacts.manifestPath}.`,
    `Policy ${policy.identity}; proof ${policy.proof}.`,
    "Commit permission belongs only to the deterministic launcher.",
    "PROMPT_VALUE_MUST_NOT_BE_PRINTED",
  ].join("\n");
  return {
    schema: WRITER_SCHEMA_ID,
    runtime: "opencode",
    packId: "AIRLOCK-P04",
    crossingId: "AIRLOCK-P04-C01",
    route,
    prompt,
    opencode: { config, permission },
    timeoutMs: overrides.timeoutMs ?? 5_000,
    baseline,
    ownedPaths,
    validations: overrides.validations ?? [
      {
        purpose: "owned-content",
        executable: process.execPath,
        args: ["--version"],
        workingDirectory: ".",
        timeoutMs: 5_000,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 4_096,
        expectedExitCode: 0,
      },
    ],
    commit: {
      allowed: true,
      crossingId: "AIRLOCK-P04-C01",
      message,
      messageSha256: createHash("sha256")
        .update(Buffer.from(message, "utf8"))
        .digest("hex"),
      candidatePaths,
      ...overrides.commit,
    },
    artifacts,
    expected,
    cleanup: {
      session: true,
      manifest: true,
      temporaryDirectory: true,
      verifyAbsence: true,
      ...overrides.cleanup,
    },
    retention: {
      session: "temporary",
      manifest: "temporary",
      temporaryDirectory: "temporary",
      transcript: "none",
      ...overrides.retention,
    },
    policy,
  };
}

async function writeHashedManifest(paths, manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
  await writeFile(paths.manifestPath, bytes, { flag: "wx" });
  return createHash("sha256").update(bytes).digest("hex");
}

function workerReport(status) {
  return [
    `- **Status:** ${status}, worker result.`,
    `- **Evidence:** focused check passed; session ${SESSION_ID}.`,
    "- **Action needed:** none.",
  ].join("\n");
}

function workerEvents(manifest, { status = "done", includeTool = true } = {}) {
  const events = [
    { type: "step_start", sessionID: SESSION_ID, part: {} },
  ];
  if (includeTool) {
    events.push({
      type: "tool_use",
      sessionID: SESSION_ID,
      part: {
        tool: "read",
        state: {
          status: "completed",
          input: {
            filePath: manifest.expected.toolEvents[0].input.filePath,
            additiveRuntimeField: true,
          },
        },
      },
    });
  }
  events.push(
    {
      type: "text",
      sessionID: SESSION_ID,
      part: { text: workerReport(status) },
    },
    {
      type: "step_finish",
      sessionID: SESSION_ID,
      part: { reason: "stop" },
    },
  );
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function sanitizedExport({
  provider = "openai",
  model = "gpt-5.4-mini",
  agent = "airlock-worker",
  variant = "none",
} = {}) {
  return Buffer.from(
    JSON.stringify({
      info: { id: SESSION_ID },
      messages: [
        {
          info: {
            role: "assistant",
            providerID: provider,
            modelID: model,
            agent,
            variant,
          },
          parts: [{ type: "text", text: "SANITIZED_TRANSCRIPT_NOT_FOR_OUTPUT" }],
        },
      ],
    }),
    "utf8",
  );
}

function processResult(overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    terminationConfirmed: true,
    processState: "closed",
    pid: 321,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    ...overrides,
  };
}

function fakeRuntime(
  manifest,
  {
    workerStatus = "done",
    includeTool = true,
    timeout = false,
    deletionFails = false,
    effectiveIdentityOutput = sanitizedExport(),
    invocation = {
      command: "opencode-test-double",
      prefixArgs: [],
      kind: "direct-posix",
    },
  } = {},
) {
  const calls = [];
  const runProcess = async (specification) => {
    calls.push(specification);
    if (specification.purpose === "worker-run") {
      const output = timeout
        ? `${JSON.stringify({ type: "step_start", sessionID: SESSION_ID, part: {} })}\n`
        : workerEvents(manifest, { status: workerStatus, includeTool });
      await writeFile(specification.stdoutPath, output, { flag: "wx" });
      if (timeout) {
        return processResult({
          exitCode: null,
          timedOut: true,
          terminationConfirmed: true,
        });
      }
      return processResult({ stderr: Buffer.from("OMITTED_CHILD_STDERR_SECRET") });
    }
    if (specification.purpose === "effective-identity-export") {
      return processResult({ stdout: effectiveIdentityOutput });
    }
    if (specification.purpose === "session-delete") {
      return deletionFails
        ? processResult({ exitCode: 1, stderr: Buffer.from("delete failed") })
        : processResult();
    }
    if (specification.purpose === "session-absence-export") {
      return deletionFails
        ? processResult({ stdout: sanitizedExport() })
        : processResult({
            exitCode: 1,
            stderr: Buffer.from(`Session ${SESSION_ID} not found`),
          });
    }
    throw new Error(`Unexpected purpose: ${specification.purpose}`);
  };
  return {
    calls,
    dependencies: {
      environment: {
        PATH: process.env.PATH,
        PROVIDER_AVAILABLE: "PROVIDER_ENV_VALUE_MUST_NOT_BE_PRINTED",
        GIT_ASKPASS: "ASKPASS_VALUE_MUST_NOT_BE_PRINTED",
        SSH_ASKPASS: "SSH_ASKPASS_VALUE_MUST_NOT_BE_PRINTED",
        SSH_AUTH_SOCK: "SSH_SOCKET_MUST_NOT_BE_PRINTED",
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "unsafe",
      },
      resolveOpenCode: async () => ({
        ...invocation,
      }),
      runProcess,
    },
  };
}

function writerEvents(
  manifest,
  {
    status = "done",
    includeMutation = true,
    mutationStatus = "completed",
    includeRead = false,
  } = {},
) {
  const events = [{ type: "step_start", sessionID: SESSION_ID, part: {} }];
  if (includeRead) {
    events.push({
      type: "tool_use",
      sessionID: SESSION_ID,
      part: {
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: manifest.expected.mutations[0].input.filePath },
        },
      },
    });
  }
  if (includeMutation) {
    events.push({
      type: "tool_use",
      sessionID: SESSION_ID,
      part: {
        tool: manifest.expected.mutations[0].tool,
        state: {
          status: mutationStatus,
          input: {
            ...manifest.expected.mutations[0].input,
            additiveRuntimeField: true,
          },
        },
      },
    });
  }
  events.push(
    {
      type: "text",
      sessionID: SESSION_ID,
      part: { text: workerReport(status) },
    },
    {
      type: "step_finish",
      sessionID: SESSION_ID,
      part: { reason: "stop" },
    },
  );
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function fakeWriterRuntime(
  manifest,
  {
    workerStatus = "done",
    includeMutation = true,
    mutationStatus = "completed",
    includeRead = false,
    mutate = async () => {
      await writeFile(
        path.join(manifest.route.targetDirectory, "owned.txt"),
        "after\n",
      );
    },
    timeout = false,
    unknownProcess = false,
    cleanupUnknown = false,
    effectiveIdentityOutput = sanitizedExport(),
  } = {},
) {
  const calls = [];
  const runWorkerProcess = async (specification) => {
    calls.push(specification);
    if (specification.purpose === "worker-run") {
      await mutate();
      await writeFile(
        specification.stdoutPath,
        writerEvents(manifest, {
          status: workerStatus,
          includeMutation,
          mutationStatus,
          includeRead,
        }),
        { flag: "wx" },
      );
      if (unknownProcess) {
        return processResult({
          exitCode: null,
          terminationConfirmed: false,
          processState: "unknown",
        });
      }
      if (timeout) {
        return processResult({ exitCode: null, timedOut: true });
      }
      return processResult();
    }
    if (specification.purpose === "effective-identity-export") {
      return processResult({ stdout: effectiveIdentityOutput });
    }
    if (specification.purpose === "session-delete") {
      return cleanupUnknown
        ? processResult({
            exitCode: null,
            processState: "unknown",
            terminationConfirmed: false,
          })
        : processResult();
    }
    if (specification.purpose === "session-absence-export") {
      return processResult({
        exitCode: 1,
        stderr: Buffer.from(`Session ${SESSION_ID} not found`),
      });
    }
    throw new Error(`Unexpected worker purpose: ${specification.purpose}`);
  };
  return {
    calls,
    dependencies: {
      environment: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      resolveOpenCode: async () => ({
        command: "opencode-test-double",
        prefixArgs: [],
        kind: "direct-posix",
      }),
      runWorkerProcess,
    },
  };
}

const CANONICAL_SOURCE = Object.freeze({
  orchestrator: new URL("../agents/orchestrator.md", import.meta.url),
  externalRunner: new URL("../agents/external-runner.md", import.meta.url),
  worker: new URL(
    "../adapters/opencode/agents/airlock-worker.md",
    import.meta.url,
  ),
  plan: new URL("../commands/plan.md", import.meta.url),
  ship: new URL("../commands/ship.md", import.meta.url),
  ledger: new URL("../references/LEDGER.template.md", import.meta.url),
});

async function readCanonicalSource(source) {
  return readFile(source, "utf8");
}

function occurrences(text, value) {
  return text.split(value).length - 1;
}

test(
  "orchestrator directly invokes one strict launcher manifest and audits its sealed candidate",
  async () => {
    const source = await readCanonicalSource(CANONICAL_SOURCE.orchestrator);
    const launcherPath =
      "${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs";

    for (const required of [
      "airlock.external-agent/v2",
      "baseline{branch,head,indexEmpty,status,ownedPathHashes,dirtyPathHashes}",
      "validations[{purpose,executable,args,workingDirectory,timeoutMs,maxStdoutBytes,maxStderrBytes,expectedExitCode}]",
      "commit{allowed,crossingId,message,messageSha256,candidatePaths}",
      "artifacts{manifestPath,temporaryDirectory,evidencePath,messagePath,hooksDirectory}",
      "one bounded JSON summary",
      "no candidate sealed",
      "candidate sealed; independent audit required",
      "indeterminate",
    ]) {
      assert.ok(
        source.includes(required),
        `missing orchestrator contract: ${required}`,
      );
    }
    assert.equal(occurrences(source, launcherPath), 1);
    assert.match(source, /invoke it directly, exactly once, in the foreground/i);
    assert.match(source, /remain idle in the target checkout/i);
    assert.match(source, /independently audit the launcher-sealed candidate/i);
    assert.match(
      source,
      /Never use `Agent` or `external-runner` for active dispatch/,
    );
    assert.match(
      source,
      /Do not construct an OpenCode command, a launcher-internal Git command, or a deterministic validation command outside the manifest/,
    );
    assert.doesNotMatch(
      source,
      /delegate[^\n]+to `external-runner` as a foreground subagent/i,
    );
  },
);

test("external-runner is an unambiguous superseded compatibility record", async () => {
  const source = await readCanonicalSource(CANONICAL_SOURCE.externalRunner);

  assert.match(source, /superseded compatibility/i);
  assert.match(source, /not an active or mandatory dispatch route/i);
  assert.match(source, /must not invoke the launcher/i);
  assert.doesNotMatch(source, /run-external-agent\.mjs/);
  assert.doesNotMatch(source, /first and only tool call/i);
});

test(
  "OpenCode worker owns edits and exploratory evidence without Git sealing claims",
  async () => {
    const source = await readCanonicalSource(CANONICAL_SOURCE.worker);

    for (const required of [
      "scoped reads and edits",
      "exploratory evidence only",
      "Worker commit permission is always `none`",
      "launcher sealing permission is `none` for read-only roles or one exact candidate for writers",
      "fresh, non-resumable runtime session ID is assigned at launch",
      "Never claim that a candidate commit exists",
    ]) {
      assert.ok(
        source.includes(required),
        `missing worker boundary: ${required}`,
      );
    }
    assert.match(source, /Never perform a Git write/i);
    assert.doesNotMatch(source, /one scoped product candidate commit/);
    for (const heading of AIRLOCK_HEADINGS) {
      assert.equal(
        occurrences(source, `- **${heading}:**`),
        1,
        `worker must retain exactly one ${heading} bullet`,
      );
    }
  },
);

test("canonical plan, ship, and ledger use launcher-sealed candidate semantics", async () => {
  const [planSource, shipSource, ledgerSource] = await Promise.all([
    readCanonicalSource(CANONICAL_SOURCE.plan),
    readCanonicalSource(CANONICAL_SOURCE.ship),
    readCanonicalSource(CANONICAL_SOURCE.ledger),
  ]);

  for (const required of [
    "launcher-sealed candidate precursor",
    "baseline{branch,head,indexEmpty,status,ownedPathHashes,dirtyPathHashes}",
    "validations[{purpose,executable,args,workingDirectory,timeoutMs,maxStdoutBytes,maxStderrBytes,expectedExitCode}]",
    "commit{allowed,crossingId,message,messageSha256,candidatePaths}",
    "artifacts{manifestPath,temporaryDirectory,evidencePath,messagePath,hooksDirectory}",
    "worker commit permission `none`",
    "launcher sealing permission",
    "${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs",
  ]) {
    assert.ok(
      planSource.includes(required),
      `missing canonical plan contract: ${required}`,
    );
  }
  assert.match(planSource, /foreground and serialized per target checkout/i);
  assert.match(planSource, /orchestrator remains idle in that checkout/i);

  for (const required of [
    "launcher-sealed candidate precursor",
    "no-summary",
    "no-commit",
    "one-commit",
    "indeterminate",
    "cleanup failure after commit",
    "separate orchestrator Crossing",
  ]) {
    assert.ok(
      sourceIncludesCaseInsensitive(shipSource, required),
      `missing ship recovery contract: ${required}`,
    );
  }
  assert.match(shipSource, /never rewrite candidate history/i);

  for (const required of [
    "Launcher candidate SHA / tree",
    "Selected / effective route",
    "Policy identity / proof",
    "Deterministic validation proof",
    "Git sealing / audit proof",
    "Recovery classification",
    "Exact cleanup",
  ]) {
    assert.ok(ledgerSource.includes(required), `missing ledger field: ${required}`);
  }

  const canonical = [planSource, shipSource, ledgerSource].join("\n");
  for (const stale of [
    "worker commit is a product candidate precursor",
    "one scoped product candidate commit",
    "worker precursor",
  ]) {
    assert.equal(
      sourceIncludesCaseInsensitive(canonical, stale),
      false,
      `stale external-candidate terminology remains: ${stale}`,
    );
  }
});

function sourceIncludesCaseInsensitive(source, value) {
  return source.toLowerCase().includes(value.toLowerCase());
}

test("writer manifest accepts the strict structured sealing contract", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths);

  assert.equal(
    validateManifest(manifest, { manifestPath: paths.manifestPath }),
    manifest,
  );
});

test("writer manifest requires zero nested subagent depth", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths, { config: { subagent_depth: 1 } });

  assert.throws(
    () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_opencode_invalid",
  );
});

test("writer manifest accepts observed OpenCode apply_patch mutation evidence", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths, {
    expected: {
      mutations: [{ tool: "apply_patch", input: {}, minimum: 1 }],
    },
  });

  assert.equal(
    validateManifest(manifest, { manifestPath: paths.manifestPath }),
    manifest,
  );
});

test("writer manifest permits an explicitly retained debug runtime directory", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths, {
    cleanup: { temporaryDirectory: false },
    retention: { temporaryDirectory: "retained" },
  });

  assert.equal(
    validateManifest(manifest, { manifestPath: paths.manifestPath }),
    manifest,
  );
});

test("writer manifest rejects unknown keys at every exact schema boundary", async (t) => {
  const paths = await makeTemporaryTree(t);
  const rootUnknown = { ...makeWriterManifest(paths), unexpected: true };
  assert.throws(
    () => validateManifest(rootUnknown, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_unknown_key",
  );

  const nestedUnknown = makeWriterManifest(paths);
  nestedUnknown.commit.unexpected = true;
  assert.throws(
    () => validateManifest(nestedUnknown, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_unknown_key",
  );
});

test("writer manifest requires structured porcelain-v2 baseline entries", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths, {
    baseline: { status: ["1 .M N... 100644 100644 100644 abc def owned.txt"] },
  });

  assert.throws(
    () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_baseline_invalid",
  );
});

test("porcelain-v2 parser preserves structured paths and rejects malformed records", () => {
  const oid = "a".repeat(40);
  const bytes = Buffer.from(
    `1 .M N... 100644 100644 100644 ${oid} ${oid} file with spaces.txt\0? untracked.txt\0`,
    "utf8",
  );
  assert.deepEqual(parsePorcelainV2Status(bytes), [
    {
      kind: "ordinary",
      xy: ".M",
      submodule: "N...",
      headMode: "100644",
      indexMode: "100644",
      worktreeMode: "100644",
      headOid: oid,
      indexOid: oid,
      path: "file with spaces.txt",
    },
    { kind: "untracked", path: "untracked.txt" },
  ]);
  assert.throws(
    () => parsePorcelainV2Status(Buffer.from("? missing-nul", "utf8")),
    (error) => error.code === "preflight_status_malformed",
  );
  assert.throws(
    () => parsePorcelainV2Status(Buffer.from("garbage\0", "utf8")),
    (error) => error.code === "preflight_status_malformed",
  );
});

test("writer manifest owned and candidate paths are exact normalized relatives", async (t) => {
  const paths = await makeTemporaryTree(t);
  for (const invalidPath of [
    "../owned.txt",
    "/absolute.txt",
    "nested\\owned.txt",
    "nested/../owned.txt",
    "*.txt",
  ]) {
    const manifest = makeWriterManifest(paths, { ownedPaths: [invalidPath] });
    assert.throws(
      () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
      (error) => error.code === "manifest_owned_paths_invalid",
      invalidPath,
    );
  }

  const mismatch = makeWriterManifest(paths, { candidatePaths: ["other.txt"] });
  assert.throws(
    () => validateManifest(mismatch, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_commit_invalid",
  );
});

test("writer validations require direct executable argv and checkout-contained cwd", async (t) => {
  const paths = await makeTemporaryTree(t);
  const stringArgs = makeWriterManifest(paths);
  stringArgs.validations[0].args = "--version";
  assert.throws(
    () => validateManifest(stringArgs, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_validation_invalid",
  );

  const shellCommand = makeWriterManifest(paths);
  shellCommand.validations[0] = {
    purpose: "shell-string",
    command: `${process.execPath} --version`,
    workingDirectory: ".",
    timeoutMs: 5_000,
    maxStdoutBytes: 4_096,
    maxStderrBytes: 4_096,
    expectedExitCode: 0,
  };
  assert.throws(
    () => validateManifest(shellCommand, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_unknown_key",
  );

  const escapedCwd = makeWriterManifest(paths);
  escapedCwd.validations[0].workingDirectory = "../outside";
  assert.throws(
    () => validateManifest(escapedCwd, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_validation_invalid",
  );
});

test("writer commit contract pins permission, Crossing, message bytes, and candidate paths", async (t) => {
  const paths = await makeTemporaryTree(t);
  for (const mutate of [
    (manifest) => (manifest.commit.allowed = false),
    (manifest) => (manifest.commit.crossingId = "AIRLOCK-P04-C99"),
    (manifest) => (manifest.commit.messageSha256 = "f".repeat(64)),
    (manifest) => (manifest.commit.message = "message without Crossing ID\n"),
    (manifest) => (manifest.commit.candidatePaths = []),
  ]) {
    const manifest = makeWriterManifest(paths);
    mutate(manifest);
    assert.throws(
      () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
      (error) => error.code === "manifest_commit_invalid",
    );
  }
});

test("writer artifacts are distinct exact paths outside the checkout", async (t) => {
  const paths = await makeTemporaryTree(t);
  const insideCheckout = makeWriterManifest(paths, {
    temporaryDirectory: path.join(paths.targetDirectory, "runtime"),
  });
  assert.throws(
    () => validateManifest(insideCheckout, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_artifacts_invalid",
  );

  const wrongManifestPath = makeWriterManifest(paths, {
    artifacts: { manifestPath: path.join(paths.root, "other.json") },
  });
  assert.throws(
    () => validateManifest(wrongManifestPath, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_artifacts_invalid",
  );

  const collision = makeWriterManifest(paths);
  collision.artifacts.messagePath = collision.artifacts.evidencePath;
  assert.throws(
    () => validateManifest(collision, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_artifacts_invalid",
  );
});

test("legacy v1 compatibility is read-only and rejects writer permissions", async (t) => {
  const paths = await makeTemporaryTree(t);
  const legacyReadOnly = makeManifest(paths);
  assert.equal(
    validateManifest(legacyReadOnly, { manifestPath: paths.manifestPath }),
    legacyReadOnly,
  );

  const legacyWriter = makeManifest(paths, {
    permission: {
      edit: { "*": "allow" },
    },
  });
  assert.throws(
    () => validateManifest(legacyWriter, { manifestPath: paths.manifestPath }),
    (error) => error.code === "legacy_writer_unsupported",
  );
});

test("writer preflight blocks a wrong branch before OpenCode resolution", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  await git(paths.targetDirectory, ["switch", "-c", "other"]);
  let openCodeResolutions = 0;

  const summary = await executeWriterManifest(paths, manifest, {
    resolveOpenCode: async () => {
      openCodeResolutions += 1;
      throw new Error("must not resolve OpenCode");
    },
  });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "preflight_branch_mismatch");
  assert.equal(openCodeResolutions, 0);
});

test("writer preflight blocks a moved HEAD without rewriting history", async (t) => {
  const { paths, head, manifest } = await makeWriterRepository(t);
  await writeFile(path.join(paths.targetDirectory, "unrelated.txt"), "new\n");
  await git(paths.targetDirectory, ["add", "--", "unrelated.txt"]);
  await git(paths.targetDirectory, ["commit", "-m", "move head"]);

  const summary = await executeWriterManifest(paths, manifest);
  const { stdout } = await git(paths.targetDirectory, ["rev-parse", "HEAD^"]);

  assert.equal(summary.classification, "preflight_head_mismatch");
  assert.equal(stdout.trim(), head);
});

test("writer preflight requires an empty real index", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  await writeFile(path.join(paths.targetDirectory, "staged.txt"), "staged\n");
  await git(paths.targetDirectory, ["add", "--", "staged.txt"]);

  const summary = await executeWriterManifest(paths, manifest);
  const { stdout } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "preflight_index_not_empty");
  assert.equal(stdout.trim(), "staged.txt");
});

test("writer preflight rejects an owned path already dirty", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  await writeFile(path.join(paths.targetDirectory, "owned.txt"), "preexisting\n");

  const summary = await executeWriterManifest(paths, manifest);

  assert.equal(summary.classification, "preflight_owned_path_dirty");
  assert.equal(
    await readFile(path.join(paths.targetDirectory, "owned.txt"), "utf8"),
    "preexisting\n",
  );
});

test("writer preflight rejects baseline status disagreement", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  manifest.baseline.status = [{ kind: "untracked", path: "claimed.txt" }];
  manifest.baseline.dirtyPathHashes = [
    { path: "claimed.txt", state: "absent", sha256: null },
  ];

  const summary = await executeWriterManifest(paths, manifest);

  assert.equal(summary.classification, "preflight_status_mismatch");
});

test("writer preflight rejects baseline-dirty byte drift", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const dirtyPath = path.join(paths.targetDirectory, "dirty.txt");
  const baselineDirtyBytes = Buffer.from("preserve\n", "utf8");
  await writeFile(dirtyPath, baselineDirtyBytes);
  manifest.baseline.status = [{ kind: "untracked", path: "dirty.txt" }];
  manifest.baseline.dirtyPathHashes = [
    {
      path: "dirty.txt",
      state: "file",
      sha256: sha256(baselineDirtyBytes),
    },
  ];
  await writeFile(dirtyPath, "drifted\n");

  const summary = await executeWriterManifest(paths, manifest);

  assert.equal(summary.classification, "preflight_baseline_dirty_changed");
  assert.equal(await readFile(dirtyPath, "utf8"), "drifted\n");
});

test("writer preflight rejects a symlinked owned-path component", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t, {
    manifest: {
      ownedPaths: ["nested/owned.txt"],
      candidatePaths: ["nested/owned.txt"],
      baseline: {
        ownedPathHashes: [
          { path: "nested/owned.txt", state: "absent", sha256: null },
        ],
      },
    },
  });
  const nestedPath = path.join(paths.targetDirectory, "nested");
  await mkdir(nestedPath);

  const summary = await executeWriterManifest(paths, manifest, {
    lstat: async (targetPath) => {
      const information = await lstat(targetPath);
      if (path.resolve(targetPath) !== path.resolve(nestedPath)) return information;
      return {
        ...information,
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => true,
      };
    },
  });

  assert.equal(summary.classification, "preflight_path_symlink");
});

test("writer preflight rejects pre-existing task runtime paths", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  await mkdir(manifest.artifacts.temporaryDirectory);
  await writeFile(manifest.artifacts.evidencePath, "pre-existing\n");

  const summary = await executeWriterManifest(paths, manifest);

  assert.equal(summary.classification, "artifact_path_exists");
  assert.equal(
    summary.cleanup.temporaryDirectory.state,
    "pre-existing-unowned",
  );
  assert.equal(summary.cleanup.evidence.state, "pre-existing-unowned");
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), true);
  assert.equal(await readFile(manifest.artifacts.evidencePath, "utf8"), "pre-existing\n");
});

test("writer permissions never grant a Git write command", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths, {
    permission: {
      bash: {
        "*": "deny",
        "git status --porcelain=v2": "allow",
        "git add -- owned.txt": "allow",
      },
    },
  });

  assert.throws(
    () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_permission_git_write",
  );

  const wrappedGit = makeWriterManifest(paths, {
    permission: {
      bash: {
        "*": "deny",
        "cmd /c git commit --file message.txt": "allow",
      },
    },
  });
  assert.throws(
    () => validateManifest(wrappedGit, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_permission_git_write",
  );
});

test("writer permissions allow only derived Windows matcher aliases for owned paths", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeWriterManifest(paths);
  const originalIdentity = manifest.policy.identity;
  for (const tool of ["read", "edit"]) {
    manifest.opencode.permission[tool]["owned.txt"] = "allow";
    manifest.opencode.permission[tool]["*owned.txt"] = "allow";
  }
  manifest.policy.identity = computePolicyIdentity(
    manifest.opencode.config,
    manifest.opencode.permission,
  );
  manifest.prompt = manifest.prompt.replace(
    originalIdentity,
    manifest.policy.identity,
  );

  assert.equal(
    validateManifest(manifest, { manifestPath: paths.manifestPath }),
    manifest,
  );

  manifest.opencode.permission.edit["*other.txt"] = "allow";
  manifest.policy.identity = computePolicyIdentity(
    manifest.opencode.config,
    manifest.opencode.permission,
  );
  assert.throws(
    () => validateManifest(manifest, { manifestPath: paths.manifestPath }),
    (error) => error.code === "manifest_permission_not_total",
  );
});

test("writer completion requires one successful declared mutation event", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, { includeMutation: false });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "required_mutation_missing");
  assert.equal(summary.status, "blocked");
});

test("failed declared mutation event blocks writer completion", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, { mutationStatus: "failed" });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "mutation_event_failed");
});

test("mutation evidence without an explicit successful status is not accepted", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, { mutationStatus: null });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "mutation_event_failed");
  assert.equal(summary.events.mutations[0].matched, 0);
});

test("writer does not require incidental read choreography", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, { includeRead: false });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "complete");
  assert.equal(summary.events.mutations[0].matched, 1);
  assert.equal(summary.events.counts.tool_use, 1);
});

test("writer delta outside exact owned paths blocks before validation", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, {
    mutate: async () => {
      await writeFile(path.join(paths.targetDirectory, "owned.txt"), "after\n");
      await writeFile(path.join(paths.targetDirectory, "outside.txt"), "drift\n");
    },
  });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "worker_delta_out_of_contract");
  assert.equal(await readFile(path.join(paths.targetDirectory, "outside.txt"), "utf8"), "drift\n");
});

test("writer cannot alter a declared baseline-dirty path", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const dirtyPath = path.join(paths.targetDirectory, "dirty.txt");
  const dirtyBytes = Buffer.from("preserve\n", "utf8");
  await writeFile(dirtyPath, dirtyBytes);
  manifest.baseline.status = [{ kind: "untracked", path: "dirty.txt" }];
  manifest.baseline.dirtyPathHashes = [
    { path: "dirty.txt", state: "file", sha256: sha256(dirtyBytes) },
  ];
  const runtime = fakeWriterRuntime(manifest, {
    mutate: async () => {
      await writeFile(path.join(paths.targetDirectory, "owned.txt"), "after\n");
      await writeFile(dirtyPath, "changed\n");
    },
  });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "worker_baseline_dirty_changed");
  assert.equal(await readFile(dirtyPath, "utf8"), "changed\n");
});

test("writer blocked status is not promoted by a successful process", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest, {
    workerStatus: "blocked",
    includeMutation: false,
    mutate: async () => {},
  });

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "worker_not_done");
});

test("writer timeout and unknown process state remain distinct blockers", async (t) => {
  const timeoutFixture = await makeWriterRepository(t);
  const timeoutRuntime = fakeWriterRuntime(timeoutFixture.manifest, {
    timeout: true,
  });
  const timeoutSummary = await executeWriterManifest(
    timeoutFixture.paths,
    timeoutFixture.manifest,
    timeoutRuntime.dependencies,
  );
  assert.equal(timeoutSummary.classification, "runtime_timeout");

  const unknownFixture = await makeWriterRepository(t);
  const unknownRuntime = fakeWriterRuntime(unknownFixture.manifest, {
    unknownProcess: true,
  });
  const unknownSummary = await executeWriterManifest(
    unknownFixture.paths,
    unknownFixture.manifest,
    unknownRuntime.dependencies,
  );
  assert.equal(unknownSummary.classification, "process_state_unknown");
  assert.equal(
    await exists(unknownFixture.manifest.artifacts.manifestPath),
    true,
  );
  assert.equal(
    await exists(unknownFixture.manifest.artifacts.temporaryDirectory),
    true,
  );
});

test("deterministic validation preserves executable argv order and uses a closed environment", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const exactArgs = [
    "--eval",
    "process.exit(0)",
    "path with spaces",
    "&&",
    '"literal quotes"',
  ];
  manifest.validations[0] = {
    ...manifest.validations[0],
    executable: process.execPath,
    args: exactArgs,
  };
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.environment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: os.homedir(),
    AMBIENT_SECRET: "MUST_NOT_REACH_CHILD",
    GIT_ASKPASS: "MUST_NOT_REACH_CHILD",
    SSH_AUTH_SOCK: "MUST_NOT_REACH_CHILD",
    NODE_OPTIONS: "--require=must-not-run",
  };
  const validationCalls = [];
  runtime.dependencies.runValidationProcess = async (specification) => {
    validationCalls.push(specification);
    return processResult();
  };

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "complete");
  assert.equal(validationCalls.length, 1);
  assert.equal(validationCalls[0].command, process.execPath);
  assert.deepEqual(validationCalls[0].args, exactArgs);
  assert.equal(Object.hasOwn(validationCalls[0], "shell"), false);
  assert.equal(validationCalls[0].env.AMBIENT_SECRET, undefined);
  assert.equal(validationCalls[0].env.GIT_ASKPASS, undefined);
  assert.equal(validationCalls[0].env.SSH_AUTH_SOCK, undefined);
  assert.equal(validationCalls[0].env.NODE_OPTIONS, undefined);
  assert.equal(validationCalls[0].env.GIT_TERMINAL_PROMPT, "0");
});

test("deterministic validation classifies timeout, nonzero, and bounded-output failure", async (t) => {
  const cases = [
    {
      expected: "validation_timeout",
      result: processResult({ exitCode: null, timedOut: true }),
    },
    {
      expected: "validation_exit_nonzero",
      result: processResult({ exitCode: 9 }),
    },
    {
      expected: "validation_output_limit",
      result: processResult({
        stdout: Buffer.from("bounded"),
        stdoutTruncated: true,
      }),
    },
  ];
  for (const fixture of cases) {
    const { paths, manifest } = await makeWriterRepository(t);
    const runtime = fakeWriterRuntime(manifest);
    runtime.dependencies.runValidationProcess = async () => fixture.result;

    const summary = await executeWriterManifest(
      paths,
      manifest,
      runtime.dependencies,
    );

    assert.equal(summary.classification, fixture.expected);
  }
});

test("deterministic validation requires a direct non-symlink executable", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  let validationCalls = 0;
  runtime.dependencies.runValidationProcess = async () => {
    validationCalls += 1;
    return processResult();
  };
  runtime.dependencies.lstat = async (targetPath) => {
    const information = await lstat(targetPath);
    if (path.resolve(targetPath) !== path.resolve(process.execPath)) return information;
    return {
      ...information,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => true,
    };
  };

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "validation_executable_invalid");
  assert.equal(validationCalls, 0);
});

test("deterministic validation rejects a symlinked working-directory escape", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const validationDirectory = path.join(paths.targetDirectory, "validation");
  await mkdir(validationDirectory);
  manifest.validations[0].workingDirectory = "validation";
  const runtime = fakeWriterRuntime(manifest);
  let validationCalls = 0;
  runtime.dependencies.runValidationProcess = async () => {
    validationCalls += 1;
    return processResult();
  };
  runtime.dependencies.lstat = async (targetPath) => {
    const information = await lstat(targetPath);
    if (path.resolve(targetPath) !== path.resolve(validationDirectory)) {
      return information;
    }
    return {
      ...information,
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => true,
    };
  };

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "validation_working_directory_invalid");
  assert.equal(validationCalls, 0);
});

test("any validation-created tracked or untracked delta blocks before staging", async (t) => {
  const { paths, manifest } = await makeWriterRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => {
    await writeFile(
      path.join(paths.targetDirectory, "validation-output.txt"),
      "unexpected\n",
    );
    return processResult();
  };

  const summary = await executeWriterManifest(
    paths,
    manifest,
    runtime.dependencies,
  );

  assert.equal(summary.classification, "validation_created_delta");
  assert.equal(summary.recovery.stageAttempted, false);
  assert.equal(
    await readFile(path.join(paths.targetDirectory, "validation-output.txt"), "utf8"),
    "unexpected\n",
  );
});

test("Git resolver accepts only a direct executable and rejects shim-only candidates", async () => {
  const directory = "C:\\tools";
  const directExecutable = path.win32.join(directory, "git.exe");
  const direct = await resolveGitInvocation({
    platform: "win32",
    environment: { PATH: directory },
    access: async () => {},
    lstat: async (candidate) => ({
      isFile: () => candidate === directExecutable,
      isSymbolicLink: () => false,
    }),
  });
  assert.deepEqual(direct, {
    command: directExecutable,
    prefixArgs: [],
    kind: "direct-exe-path",
  });

  await assert.rejects(
    resolveGitInvocation({
      platform: "win32",
      environment: { PATH: directory },
      access: async () => {},
      lstat: async () => {
        const error = new Error("only git.cmd and git.ps1 exist");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error.code === "git_direct_executable_not_found",
  );

  await assert.rejects(
    resolveGitInvocation({
      platform: "linux",
      environment: { PATH: "/tools" },
      access: async () => {},
      lstat: async () => ({
        isFile: () => true,
        isSymbolicLink: () => true,
      }),
    }),
    (error) => error.code === "git_direct_executable_not_found",
  );
});

test("Git sealing stages and commits exact modified, added, deleted, and spaced paths", async (t) => {
  const fixtures = [
    {
      name: "modified",
      baselineFiles: { "owned.txt": "before\n" },
      mutate: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "owned.txt"), "after\n");
      },
      expectedStatus: "M\towned.txt",
    },
    {
      name: "added with spaces",
      baselineFiles: { "added file.txt": null },
      mutate: async ({ paths }) => {
        await writeFile(
          path.join(paths.targetDirectory, "added file.txt"),
          "added\n",
        );
      },
      expectedStatus: "A\tadded file.txt",
    },
    {
      name: "deleted with spaces",
      baselineFiles: { "delete me.txt": "remove\n" },
      mutate: async ({ paths }) => {
        await rm(path.join(paths.targetDirectory, "delete me.txt"));
      },
      expectedStatus: "D\tdelete me.txt",
    },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async (subtest) => {
      const repository = await makeSealingRepository(subtest, {
        baselineFiles: fixture.baselineFiles,
      });
      const runtime = fakeWriterRuntime(repository.manifest, {
        mutate: () => fixture.mutate(repository),
      });
      runtime.dependencies.runValidationProcess = async () => processResult();

      const summary = await executeWriterManifest(
        repository.paths,
        repository.manifest,
        runtime.dependencies,
      );
      assert.equal(summary.status, "done");
      assert.equal(summary.classification, "complete");
      const { stdout: parent } = await git(repository.paths.targetDirectory, [
        "rev-parse",
        "HEAD^",
      ]);
      const { stdout: changed } = await git(repository.paths.targetDirectory, [
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "--no-renames",
        "-r",
        "HEAD",
      ]);
      const { stdout: status } = await git(repository.paths.targetDirectory, [
        "status",
        "--porcelain=v2",
      ]);

      assert.equal(parent.trim(), repository.head);
      assert.equal(changed.trim(), fixture.expectedStatus);
      assert.equal(status, "");
      assert.deepEqual(summary.candidate.paths, repository.manifest.commit.candidatePaths);
    });
  }
});

test("Git sealing rejects a custom clean filter before exact staging", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t, {
    baselineFiles: { "owned.txt": "before\n" },
    extraBaselineFiles: { ".gitattributes": "owned.txt filter=untrusted\n" },
  });
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);
  const { stdout: cached } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "custom_filter_forbidden");
  assert.equal(summary.recovery.classification, "failed_before_stage");
  assert.equal(summary.recovery.stageAttempted, false);
  assert.equal(currentHead.trim(), head);
  assert.equal(cached, "");
  assert.equal(await exists(manifest.artifacts.manifestPath), false);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), false);
});

test("Git sealing rejects filters on every owned path, not only changed candidates", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t, {
    baselineFiles: { "a.txt": "before\n", "b.txt": "preserve\n" },
    ownedPaths: ["a.txt", "b.txt"],
    candidatePaths: ["a.txt"],
    extraBaselineFiles: { ".gitattributes": "b.txt filter=untrusted\n" },
  });
  const runtime = fakeWriterRuntime(manifest, {
    mutate: async () => {
      await writeFile(path.join(paths.targetDirectory, "a.txt"), "after\n");
    },
  });
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);

  assert.equal(summary.classification, "custom_filter_forbidden");
  assert.equal(currentHead.trim(), head);
  assert.equal(summary.recovery.stageAttempted, false);
});

test("Git sealing blocks cached diff-check whitespace errors after exact staging", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest, {
    mutate: async () => {
      await writeFile(path.join(paths.targetDirectory, "owned.txt"), "trailing   \n");
    },
  });
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);
  const { stdout: cached } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "cached_diff_check_failed");
  assert.equal(summary.recovery.classification, "failed_after_stage");
  assert.equal(currentHead.trim(), head);
  assert.equal(cached.trim(), "owned.txt");
});

test("Git sealing audits cached names and leaves a mismatch staged for recovery", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  runtime.dependencies.onCheckpoint = async (checkpoint) => {
    if (checkpoint !== "after-stage") return;
    await writeFile(path.join(paths.targetDirectory, "intruder.txt"), "intruder\n");
    await git(paths.targetDirectory, ["add", "--", "intruder.txt"]);
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);
  const { stdout: cached } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "cached_paths_mismatch");
  assert.equal(summary.recovery.classification, "failed_after_stage");
  assert.equal(currentHead.trim(), head);
  assert.deepEqual(cached.trim().split(/\r?\n/).sort(), ["intruder.txt", "owned.txt"]);
});

test("Git sealing disables signing and local hooks and round-trips exact message bytes", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const hookPath = path.join(paths.targetDirectory, ".git", "hooks", "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 91\n");
  await chmod(hookPath, 0o755);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  const gitCalls = [];
  runtime.dependencies.runGitProcess = async (specification) => {
    gitCalls.push(specification);
    return executeProcess(specification);
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const commitCall = gitCalls.find((call) => call.purpose === "git-commit");
  const { stdout: rawCommit } = await git(
    paths.targetDirectory,
    ["cat-file", "commit", "HEAD"],
    { encoding: null },
  );
  const messageOffset = rawCommit.indexOf(Buffer.from("\n\n")) + 2;
  const { stdout: count } = await git(paths.targetDirectory, [
    "rev-list",
    "--count",
    `${head}..HEAD`,
  ]);

  assert.equal(summary.status, "done");
  assert.ok(commitCall);
  assert.equal(commitCall.args.includes("--no-gpg-sign"), true);
  assert.equal(commitCall.args.includes("--cleanup=verbatim"), true);
  assert.equal(commitCall.args.includes("--file"), true);
  assert.equal(
    commitCall.args.includes(`core.hooksPath=${manifest.artifacts.hooksDirectory}`),
    true,
  );
  assert.equal(commitCall.args.includes("commit.gpgSign=false"), true);
  assert.deepEqual(
    rawCommit.subarray(messageOffset),
    Buffer.from(manifest.commit.message, "utf8"),
  );
  assert.equal(count.trim(), "1");
  assert.equal(summary.candidate.parent, head);
  assert.match(summary.candidate.tree, /^[a-f0-9]{40,64}$/);
});

test("sealing detects HEAD, index, and status races immediately before staging", async (t) => {
  const cases = [
    {
      name: "HEAD",
      expected: "race_head_changed",
      race: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "race.txt"), "race\n");
        await git(paths.targetDirectory, ["add", "--", "race.txt"]);
        await git(paths.targetDirectory, [
          "commit",
          "-m",
          "external race",
          "--",
          "race.txt",
        ]);
      },
    },
    {
      name: "index",
      expected: "race_index_changed",
      race: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "race.txt"), "race\n");
        await git(paths.targetDirectory, ["add", "--", "race.txt"]);
      },
    },
    {
      name: "status",
      expected: "race_status_changed",
      race: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "race.txt"), "race\n");
      },
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const repository = await makeSealingRepository(subtest);
      const runtime = fakeWriterRuntime(repository.manifest);
      runtime.dependencies.runValidationProcess = async () => processResult();
      runtime.dependencies.onCheckpoint = async (checkpoint) => {
        if (checkpoint === "before-stage-reverify") {
          await fixture.race(repository);
        }
      };

      const summary = await executeWriterManifest(
        repository.paths,
        repository.manifest,
        runtime.dependencies,
      );

      assert.equal(summary.classification, fixture.expected);
      assert.equal(summary.recovery.classification, "failed_before_stage");
      assert.equal(summary.recovery.stageAttempted, false);
    });
  }
});

test("sealing detects HEAD, index, and owned-byte races immediately before commit", async (t) => {
  const cases = [
    {
      name: "HEAD",
      expected: "race_head_changed",
      race: async ({ paths }) => {
        await git(paths.targetDirectory, ["commit", "-m", "external race"]);
      },
    },
    {
      name: "index",
      expected: "race_status_changed",
      race: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "race.txt"), "race\n");
        await git(paths.targetDirectory, ["add", "--", "race.txt"]);
      },
    },
    {
      name: "owned bytes",
      expected: "race_owned_path_changed",
      race: async ({ paths }) => {
        await writeFile(path.join(paths.targetDirectory, "owned.txt"), "raced\n");
      },
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const repository = await makeSealingRepository(subtest);
      const runtime = fakeWriterRuntime(repository.manifest);
      runtime.dependencies.runValidationProcess = async () => processResult();
      runtime.dependencies.onCheckpoint = async (checkpoint) => {
        if (checkpoint === "before-commit-reverify") {
          await fixture.race(repository);
        }
      };

      const summary = await executeWriterManifest(
        repository.paths,
        repository.manifest,
        runtime.dependencies,
      );

      assert.equal(summary.classification, fixture.expected);
      assert.equal(summary.recovery.classification, "failed_after_stage");
      assert.equal(summary.recovery.commitCreated, false);
    });
  }
});

test("commit failure leaves exact candidate paths staged and never resets", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  runtime.dependencies.runGitProcess = async (specification) => {
    if (specification.purpose === "git-commit") {
      return processResult({ exitCode: 1, stderr: Buffer.from("commit blocked") });
    }
    return executeProcess(specification);
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);
  const { stdout: cached } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "commit_failed");
  assert.equal(summary.recovery.classification, "failed_after_stage");
  assert.equal(summary.recovery.commitCreated, false);
  assert.deepEqual(summary.recovery.checkout.cachedPaths, ["owned.txt"]);
  assert.equal(currentHead.trim(), head);
  assert.equal(cached.trim(), "owned.txt");
  assert.equal(await exists(manifest.artifacts.manifestPath), false);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), false);
});

test("commit-success audit failure preserves the commit and reports post-commit recovery", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  runtime.dependencies.onCheckpoint = async (checkpoint) => {
    if (checkpoint === "after-commit") {
      await writeFile(path.join(paths.targetDirectory, "owned.txt"), "tampered\n");
    }
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: parent } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD^",
  ]);

  assert.equal(summary.classification, "commit_post_state_mismatch");
  assert.equal(summary.recovery.classification, "failed_after_commit");
  assert.equal(summary.recovery.commitCreated, true);
  assert.equal(parent.trim(), head);
  assert.equal(
    await readFile(path.join(paths.targetDirectory, "owned.txt"), "utf8"),
    "tampered\n",
  );
});

test("cleanup failure after commit blocks acceptance without rewriting the commit", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  runtime.dependencies.rm = async (targetPath, options) => {
    if (path.resolve(targetPath) === path.resolve(manifest.artifacts.temporaryDirectory)) {
      const error = new Error("cleanup denied");
      error.code = "EACCES";
      throw error;
    }
    return rm(targetPath, options);
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: parent } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD^",
  ]);

  assert.equal(summary.classification, "cleanup_failed_after_commit");
  assert.equal(summary.recovery.classification, "cleanup_failed_after_commit");
  assert.equal(summary.recovery.commitCreated, true);
  assert.equal(parent.trim(), head);
});

test("successful sealing removes exact session, manifest, evidence, message, and hooks state", async (t) => {
  const { paths, manifest } = await makeSealingRepository(t);
  const unrelatedPath = path.join(paths.root, "unrelated.txt");
  await writeFile(unrelatedPath, "preserve\n");
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);

  assert.equal(summary.status, "done");
  assert.deepEqual(summary.session, {
    id: SESSION_ID,
    state: "deleted",
    absenceVerified: true,
  });
  assert.equal(summary.cleanup.temporaryDirectory.state, "deleted");
  assert.equal(summary.cleanup.message.state, "deleted-with-temporary-directory");
  assert.equal(
    summary.cleanup.hooksDirectory.state,
    "deleted-with-temporary-directory",
  );
  assert.equal(summary.cleanup.manifest.state, "deleted");
  assert.equal(await exists(manifest.artifacts.manifestPath), false);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), false);
  assert.equal(await exists(manifest.artifacts.evidencePath), false);
  assert.equal(await exists(manifest.artifacts.messagePath), false);
  assert.equal(await exists(manifest.artifacts.hooksDirectory), false);
  assert.equal(await readFile(unrelatedPath, "utf8"), "preserve\n");
});

test("approved debug retention preserves and verifies the exact runtime directory", async (t) => {
  const { paths, manifest } = await makeSealingRepository(t);
  manifest.cleanup.temporaryDirectory = false;
  manifest.retention.temporaryDirectory = "retained";
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);

  assert.equal(summary.status, "done");
  assert.equal(summary.cleanup.temporaryDirectory.state, "retained");
  assert.equal(summary.cleanup.temporaryDirectory.verified, true);
  assert.equal(summary.cleanup.evidence.state, "retained");
  assert.equal(summary.cleanup.evidence.verified, true);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), true);
  assert.equal(await exists(manifest.artifacts.evidencePath), true);
});

test("unknown cleanup process state retains exact artifacts after a successful commit", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest, { cleanupUnknown: true });
  runtime.dependencies.runValidationProcess = async () => processResult();

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: parent } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD^",
  ]);

  assert.equal(summary.classification, "cleanup_failed_after_commit");
  assert.equal(summary.cleanup.temporaryDirectory.state, "retained-process-unknown");
  assert.equal(summary.cleanup.manifest.state, "retained-process-unknown");
  assert.equal(await exists(manifest.artifacts.manifestPath), true);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), true);
  assert.equal(parent.trim(), head);
});

test("unknown Git process state blocks cleanup and preserves staged recovery state", async (t) => {
  const { paths, manifest, head } = await makeSealingRepository(t);
  const runtime = fakeWriterRuntime(manifest);
  runtime.dependencies.runValidationProcess = async () => processResult();
  runtime.dependencies.runGitProcess = async (specification) => {
    if (specification.purpose === "git-cached-paths") {
      return processResult({
        exitCode: null,
        processState: "unknown",
        terminationConfirmed: false,
      });
    }
    return executeProcess(specification);
  };

  const summary = await executeWriterManifest(paths, manifest, runtime.dependencies);
  const { stdout: currentHead } = await git(paths.targetDirectory, [
    "rev-parse",
    "HEAD",
  ]);
  const { stdout: cached } = await git(paths.targetDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  assert.equal(summary.classification, "git_process_state_unknown");
  assert.equal(summary.recovery.classification, "failed_after_stage");
  assert.equal(summary.cleanup.temporaryDirectory.state, "retained-process-unknown");
  assert.equal(await exists(manifest.artifacts.manifestPath), true);
  assert.equal(await exists(manifest.artifacts.temporaryDirectory), true);
  assert.equal(currentHead.trim(), head);
  assert.equal(cached.trim(), "owned.txt");
});

test("missing-summary recovery distinguishes no candidate, exact candidate, and ambiguity", async (t) => {
  const launcher = await import("./run-external-agent.mjs");
  assert.equal(typeof launcher.classifyMissingSummaryRecovery, "function");

  const noCandidate = await makeSealingRepository(t);
  await writeFile(
    path.join(noCandidate.paths.targetDirectory, "owned.txt"),
    "after\n",
  );
  const noCandidateResult = await launcher.classifyMissingSummaryRecovery(
    noCandidate.manifest,
  );
  assert.equal(noCandidateResult.classification, "no_candidate_sealed");

  const exactCandidate = await makeSealingRepository(t);
  await writeFile(
    path.join(exactCandidate.paths.targetDirectory, "owned.txt"),
    "after\n",
  );
  const messagePath = path.join(exactCandidate.paths.root, "manual-message.txt");
  await writeFile(messagePath, exactCandidate.manifest.commit.message);
  await git(exactCandidate.paths.targetDirectory, ["add", "--", "owned.txt"]);
  await git(exactCandidate.paths.targetDirectory, [
    "commit",
    "--cleanup=verbatim",
    "--file",
    messagePath,
  ]);
  const exactCandidateResult = await launcher.classifyMissingSummaryRecovery(
    exactCandidate.manifest,
  );
  assert.equal(
    exactCandidateResult.classification,
    "candidate_sealed_requires_audit",
  );

  const ambiguous = await makeSealingRepository(t);
  await writeFile(path.join(ambiguous.paths.targetDirectory, "outside.txt"), "drift\n");
  const ambiguousResult = await launcher.classifyMissingSummaryRecovery(
    ambiguous.manifest,
  );
  assert.equal(ambiguousResult.classification, "ambiguous_stop");
});

test("successful run validates route, evidence, identity, and exact cleanup", async (t) => {
  const paths = await makeTemporaryTree(t);
  const unrelatedPath = path.join(paths.root, "unrelated.txt");
  await writeFile(unrelatedPath, "preserve", "utf8");
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest);

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "done");
  assert.equal(summary.classification, "complete");
  assert.equal(summary.process.invocationKind, "direct-posix");
  assert.deepEqual(summary.effectiveRoute, {
    runtime: "opencode",
    agent: "airlock-worker",
    provider: "openai",
    model: "gpt-5.4-mini",
    variant: "none",
    proof: "sanitized-export+argument-array",
  });
  assert.deepEqual(summary.session, {
    id: SESSION_ID,
    state: "deleted",
    absenceVerified: true,
  });
  assert.equal(summary.events.tools[0].matched, 1);
  assert.equal(summary.cleanup.evidence.state, "deleted");
  assert.equal(summary.cleanup.manifest.state, "deleted");
  assert.equal(await exists(paths.evidencePath), false);
  assert.equal(await exists(paths.manifestPath), false);
  assert.equal(await readFile(unrelatedPath, "utf8"), "preserve");
});

test("worker blocked is never promoted by exit zero and terminal stop", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, { workerStatus: "blocked" });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.process.exitCode, 0);
  assert.equal(summary.events.terminalReason, "stop");
  assert.equal(summary.events.workerStatus, "blocked");
  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "worker_not_done");
});

test("missing declared tool event blocks a text-only result", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, { includeTool: false });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "required_tool_event_missing");
  assert.equal(summary.events.counts.tool_use, 0);
  assert.equal(summary.events.tools[0].matched, 0);
});

test("hash mismatch fails before parse or runtime launch", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  await writeHashedManifest(paths, manifest);
  let calls = 0;

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", "0".repeat(64)],
    {
      runProcess: async () => {
        calls += 1;
        return processResult();
      },
    },
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "manifest_hash_mismatch");
  assert.equal(calls, 0);
  assert.equal(await exists(paths.manifestPath), true);
});

test("malformed JSON with a matching hash fails closed", async (t) => {
  const paths = await makeTemporaryTree(t);
  const bytes = Buffer.from("{not-json", "utf8");
  await writeFile(paths.manifestPath, bytes, { flag: "wx" });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let calls = 0;

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    {
      runProcess: async () => {
        calls += 1;
        return processResult();
      },
    },
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "manifest_json_malformed");
  assert.equal(calls, 0);
});

test("unknown manifest keys fail before runtime launch", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = { ...makeManifest(paths), unexpected: true };
  const sha256 = await writeHashedManifest(paths, manifest);
  let calls = 0;

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    {
      runProcess: async () => {
        calls += 1;
        return processResult();
      },
    },
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "manifest_unknown_key");
  assert.equal(calls, 0);
});

test("explicit secret fields are rejected without printing their values", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths, {
    config: { apiKey: "EXPLICIT_SECRET_MUST_NOT_BE_PRINTED" },
  });
  const sha256 = await writeHashedManifest(paths, manifest);

  const summary = await executeCli([
    "--manifest",
    paths.manifestPath,
    "--sha256",
    sha256,
  ]);

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "manifest_secret_field");
  assert.equal(
    JSON.stringify(summary).includes("EXPLICIT_SECRET_MUST_NOT_BE_PRINTED"),
    false,
  );
});

test("unexpected filesystem errors collapse to the stable launcher taxonomy", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const error = new Error("system detail must not classify the result");
  error.code = "EACCES";

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    {
      lstat: async () => {
        throw error;
      },
    },
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "launcher_blocked");
  assert.equal(JSON.stringify(summary).includes("EACCES"), false);
});

test("sanitized export parser accepts observed and nested identity variants", () => {
  assert.deepEqual(parseSanitizedExportIdentity(sanitizedExport()), {
    provider: "openai",
    model: "gpt-5.4-mini",
    agent: "airlock-worker",
    variant: "none",
    assistant: true,
  });

  const nested = Buffer.from(
    JSON.stringify({
      messages: [
        {
          info: {
            role: "assistant",
            model: {
              providerId: "zai-coding-plan",
              modelId: "glm-5.2",
            },
            agentName: "airlock-worker",
          },
        },
      ],
    }),
  );
  assert.deepEqual(parseSanitizedExportIdentity(nested), {
    provider: "zai-coding-plan",
    model: "glm-5.2",
    agent: "airlock-worker",
    variant: null,
    assistant: true,
  });

  const ndjson = Buffer.from(
    [
      JSON.stringify({ type: "metadata", value: 1 }),
      JSON.stringify({
        role: "assistant",
        model: "openai/gpt-5.4-mini",
      }),
    ].join("\n"),
  );
  assert.deepEqual(parseSanitizedExportIdentity(ndjson), {
    provider: "openai",
    model: "gpt-5.4-mini",
    agent: null,
    variant: null,
    assistant: true,
  });
});

test("effective identity mismatch blocks completion", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, {
    effectiveIdentityOutput: sanitizedExport({ model: "gpt-unapproved" }),
  });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "effective_identity_mismatch");
  assert.equal(summary.effectiveRoute, null);
});

test("unproven effective identity blocks completion", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, {
    effectiveIdentityOutput: Buffer.from(
      JSON.stringify({ messages: [{ info: { role: "user" } }] }),
    ),
  });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "effective_identity_unproven");
  assert.equal(summary.effectiveRoute, null);
});

test("missing-session output requires the exact ID or a strict generic error", () => {
  assert.equal(
    outputProvesMissingSession(
      Buffer.from(`Session ${SESSION_ID} does not exist`),
      SESSION_ID,
    ),
    true,
  );
  assert.equal(
    outputProvesMissingSession(
      Buffer.from('{"error":"Session not found"}'),
      SESSION_ID,
    ),
    true,
  );
  assert.equal(
    outputProvesMissingSession(
      Buffer.from("Session ses_someone_else not found"),
      SESSION_ID,
    ),
    false,
  );
  assert.equal(
    outputProvesMissingSession(Buffer.from("Network endpoint not found"), SESSION_ID),
    false,
  );
});

test("timeout remains blocked after exact child termination and cleanup", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths, { timeoutMs: 25 });
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, { timeout: true });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "runtime_timeout");
  assert.equal(summary.process.timedOut, true);
  assert.equal(summary.session.state, "deleted");
  assert.equal(await exists(paths.evidencePath), false);
  assert.equal(await exists(paths.manifestPath), false);
});

test("failed session deletion or unknown absence blocks completion", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, { deletionFails: true });

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );

  assert.equal(summary.status, "blocked");
  assert.equal(summary.classification, "session_cleanup_failed");
  assert.equal(summary.cleanup.session, "failed");
  assert.deepEqual(summary.session, {
    id: SESSION_ID,
    state: "unknown",
    absenceVerified: false,
  });
});

test("argument array and child environment preserve route but expose no secret values", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest);

  let output = "";
  const exitCode = await main(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
    { write: (chunk) => (output += chunk) },
  );
  const summary = JSON.parse(output);
  const run = runtime.calls.find((call) => call.purpose === "worker-run");

  assert.equal(exitCode, 0);
  assert.equal(output.endsWith("\n"), true);
  assert.equal(output.trim().split("\n").length, 1);
  assert.ok(run);
  assert.equal(run.args.includes("--auto"), false);
  assert.equal(run.args[run.args.indexOf("--variant") + 1], "none");
  assert.equal(run.args[run.args.indexOf("--agent") + 1], "airlock-worker");
  assert.equal(run.args[run.args.indexOf("--model") + 1], "openai/gpt-5.4-mini");
  assert.equal(run.args[run.args.indexOf("--dir") + 1], paths.targetDirectory);
  assert.equal(run.args[run.args.indexOf("--format") + 1], "json");
  assert.equal(run.args.at(-1), manifest.prompt);
  assert.equal(run.env.PROVIDER_AVAILABLE, "PROVIDER_ENV_VALUE_MUST_NOT_BE_PRINTED");
  assert.equal(run.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(run.env.GCM_INTERACTIVE, "Never");
  assert.equal(run.env.GIT_CONFIG_KEY_0, "remote.origin.pushurl");
  assert.match(run.env.GIT_CONFIG_VALUE_0, /^file:\/\//);
  assert.equal(run.env.OPENCODE_CONFIG_CONTENT, JSON.stringify(manifest.opencode.config));
  assert.equal(run.env.OPENCODE_PERMISSION, JSON.stringify(manifest.opencode.permission));
  for (const key of Object.keys(run.env)) {
    assert.equal(
      [
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "SSH_ASKPASS_REQUIRE",
        "SSH_AUTH_SOCK",
        "SSH_AGENT_PID",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
      ].includes(key.toUpperCase()),
      false,
    );
  }

  for (const forbidden of [
    "PROMPT_VALUE_MUST_NOT_BE_PRINTED",
    "CONFIG_VALUE_MUST_NOT_BE_PRINTED",
    "PROVIDER_ENV_VALUE_MUST_NOT_BE_PRINTED",
    "ASKPASS_VALUE_MUST_NOT_BE_PRINTED",
    "SSH_ASKPASS_VALUE_MUST_NOT_BE_PRINTED",
    "SSH_SOCKET_MUST_NOT_BE_PRINTED",
    "OMITTED_CHILD_STDERR_SECRET",
    "SANITIZED_TRANSCRIPT_NOT_FOR_OUTPUT",
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
});

test("environment builder removes ambient OpenCode controls and askpass state", () => {
  const manifest = {
    opencode: {
      config: { default_agent: "airlock-worker", model: "openai/model" },
      permission: { "*": "deny" },
    },
  };
  const environment = buildChildEnvironment(manifest, {
    Path: "safe-path",
    HOME: "safe-home",
    git_askpass: "remove",
    Ssh_Auth_Sock: "remove",
    git_config_key_8: "remove",
    git_config_value_8: "remove",
    OPENCODE_CONFIG: "remove",
    OPENCODE_CONFIG_DIR: "remove",
    OPENCODE_CONFIG_CONTENT: "remove",
    OPENCODE_PERMISSION: "remove",
    OPENCODE_AUTO_SHARE: "remove",
    OPENCODE_DISABLE_PLUGINS: "remove",
    OPENCODE_PERMISSION_PROMPT: "remove",
    opencode_disable_prompt: "remove",
    OPENCODE_AGENT: "remove",
    OPENCODE_INSTRUCTIONS: "remove",
    OPENCODE_GIT_BASH_PATH: "C:\\Git\\bin\\bash.exe",
    PROVIDER_FLAG: "keep",
  });

  assert.equal(environment.Path, "safe-path");
  assert.equal(environment.HOME, "safe-home");
  assert.equal(environment.PROVIDER_FLAG, "keep");
  assert.equal(environment.git_askpass, undefined);
  assert.equal(environment.Ssh_Auth_Sock, undefined);
  assert.equal(environment.git_config_key_8, undefined);
  assert.equal(environment.git_config_value_8, undefined);
  assert.equal(environment.GIT_CONFIG_COUNT, "1");
  assert.equal(environment.OPENCODE_CONFIG, undefined);
  assert.equal(environment.OPENCODE_CONFIG_DIR, undefined);
  assert.equal(environment.OPENCODE_AUTO_SHARE, undefined);
  assert.equal(environment.OPENCODE_DISABLE_PLUGINS, undefined);
  assert.equal(environment.OPENCODE_PERMISSION_PROMPT, undefined);
  assert.equal(environment.opencode_disable_prompt, undefined);
  assert.equal(environment.OPENCODE_AGENT, undefined);
  assert.equal(environment.OPENCODE_INSTRUCTIONS, undefined);
  assert.equal(
    environment.OPENCODE_CONFIG_CONTENT,
    JSON.stringify(manifest.opencode.config),
  );
  assert.equal(
    environment.OPENCODE_PERMISSION,
    JSON.stringify(manifest.opencode.permission),
  );
  assert.equal(environment.OPENCODE_GIT_BASH_PATH, "C:\\Git\\bin\\bash.exe");
  assert.deepEqual(
    Object.keys(environment)
      .filter((key) => key.startsWith("OPENCODE_"))
      .sort(),
    [
      "OPENCODE_CONFIG_CONTENT",
      "OPENCODE_GIT_BASH_PATH",
      "OPENCODE_PERMISSION",
    ],
  );
});

test("process timeout invokes the exact injected tree terminator and waits for close", async () => {
  const child = new EventEmitter();
  child.pid = 456;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  child.unref = () => {};
  let terminated = null;
  let spawnOptions = null;

  const result = await executeProcess(
    {
      purpose: "timeout-unit-test",
      command: "test-command",
      args: [],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 5,
      captureStdout: false,
    },
    {
      platform: "linux",
      spawn: (_command, args, options) => {
        assert.deepEqual(args, []);
        spawnOptions = options;
        return child;
      },
      terminateProcessTree: async (exactChild) => {
        terminated = exactChild;
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return { attempted: true, requestSucceeded: true };
      },
    },
  );

  assert.equal(terminated, child);
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationRequested, true);
  assert.equal(result.terminationConfirmed, true);
  assert.equal(result.processState, "closed");
  assert.equal(spawnOptions.shell, false);
});

test("Windows resolver rejects a PowerShell-shim-only PATH", async () => {
  const npmDirectory = "C:\\npm";
  const shim = path.win32.join(npmDirectory, "opencode.ps1");
  const examined = [];

  await assert.rejects(
    resolveOpenCodeInvocation({
      platform: "win32",
      environment: { PATH: npmDirectory },
      access: async (candidate) => {
        examined.push(candidate);
        if (candidate === shim) return;
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error.code === "opencode_direct_executable_not_found",
  );
  assert.equal(examined.includes(shim), false);
});

test("PowerShell-shim-only resolution blocks before runtime launch", async (t) => {
  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  const sha256 = await writeHashedManifest(paths, manifest);
  const npmDirectory = "C:\\npm";
  const shim = path.win32.join(npmDirectory, "opencode.ps1");
  let runtimeCalls = 0;

  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    {
      platform: "win32",
      environment: { PATH: npmDirectory },
      access: async (candidate) => {
        if (candidate === shim) return;
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      },
      runProcess: async () => {
        runtimeCalls += 1;
        return processResult();
      },
    },
  );

  assert.equal(summary.status, "blocked");
  assert.equal(
    summary.classification,
    "opencode_direct_executable_not_found",
  );
  assert.match(summary.actionNeeded, /direct opencode\.exe/);
  assert.equal(summary.process.invocationKind, null);
  assert.equal(runtimeCalls, 0);
});

test("Windows resolver prefers direct executables and preserves a quote-bearing prompt byte-for-byte", async (t) => {
  const npmDirectory = "C:\\Users\\Test User\\App Data\\npm";
  const nestedExecutable = path.win32.join(
    npmDirectory,
    "node_modules",
    "opencode-ai",
    "bin",
    "opencode.exe",
  );
  const shim = path.win32.join(npmDirectory, "opencode.ps1");
  const invocation = await resolveOpenCodeInvocation({
    platform: "win32",
    environment: { PATH: npmDirectory },
    access: async (candidate) => {
      if (candidate !== nestedExecutable && candidate !== shim) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
    },
  });
  assert.deepEqual(invocation, {
    command: nestedExecutable,
    prefixArgs: [],
    kind: "direct-exe-npm",
  });

  const directDirectory = "C:\\direct opencode";
  const directExecutable = path.win32.join(directDirectory, "opencode.exe");
  const directInvocation = await resolveOpenCodeInvocation({
    platform: "win32",
    environment: { PATH: `${npmDirectory};${directDirectory}` },
    access: async (candidate) => {
      if (candidate !== shim && candidate !== directExecutable) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
    },
  });
  assert.equal(directInvocation.command, directExecutable);
  assert.equal(directInvocation.kind, "direct-exe-path");

  const paths = await makeTemporaryTree(t);
  const manifest = makeManifest(paths);
  manifest.prompt += '\nA path with spaces\\owned file.txt\n"double quoted value"';
  const sha256 = await writeHashedManifest(paths, manifest);
  const runtime = fakeRuntime(manifest, { invocation });
  const summary = await executeCli(
    ["--manifest", paths.manifestPath, "--sha256", sha256],
    runtime.dependencies,
  );
  const run = runtime.calls.find((call) => call.purpose === "worker-run");

  assert.equal(summary.status, "done");
  assert.equal(summary.process.invocationKind, "direct-exe-npm");
  assert.equal(run.command, nestedExecutable);
  assert.equal(run.args.at(-1), manifest.prompt);
  assert.deepEqual(
    Buffer.from(run.args.at(-1), "utf8"),
    Buffer.from(manifest.prompt, "utf8"),
  );
});

test("direct-execution path matching is case-insensitive only on Windows", () => {
  const lower = "C:\\plugins\\airlock\\scripts\\run-external-agent.mjs";
  const upper = "c:\\PLUGINS\\AIRLOCK\\SCRIPTS\\RUN-EXTERNAL-AGENT.MJS";

  assert.equal(isDirectExecutionPath(lower, upper, "win32"), true);
  assert.equal(
    isDirectExecutionPath(
      "/plugins/airlock/scripts/run-external-agent.mjs",
      "/PLUGINS/AIRLOCK/SCRIPTS/RUN-EXTERNAL-AGENT.MJS",
      "linux",
    ),
    false,
  );
});
