import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
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

import {
  AIRLOCK_HEADINGS,
  MANIFEST_SCHEMA_ID,
  buildChildEnvironment,
  computePolicyIdentity,
  executeCli,
  executeProcess,
  isDirectExecutionPath,
  main,
  outputProvesMissingSession,
  parseSanitizedExportIdentity,
  resolveOpenCodeInvocation,
} from "./run-external-agent.mjs";

const SESSION_ID = "ses_airlock_launcher_test";

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
    schema: MANIFEST_SCHEMA_ID,
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

async function writeHashedManifest(paths, manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
  await writeFile(paths.manifestPath, bytes, { flag: "wx" });
  return createHash("sha256").update(bytes).digest("hex");
}

function workerReport(status) {
  return [
    `- **Status:** ${status}, worker result.`,
    "- **Changes/findings:** none.",
    "- **Evidence:** focused check passed.",
    `- **Artifacts/cleanup:** session ${SESSION_ID}.`,
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
