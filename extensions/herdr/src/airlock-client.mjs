import { spawnSync } from "node:child_process";
import path from "node:path";

export const MAX_REASON_LENGTH = 300;

export function sanitizeReason(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(?:https?)[^\s]*([?&](?:token|key|secret|password)=[^\s&]+)\b/gi, (match) => match.replace(/[?&](?:token|key|secret|password)=[^\s&]+/i, "?[redacted]"))
    .slice(0, MAX_REASON_LENGTH)
    .trim();
}

// stderr is the log channel in 4.0: the UPGRADED plan-schema notice arrives there.
export function extractNotices(stderr) {
  return String(stderr ?? "")
    .split("\n")
    .filter((line) => line.startsWith("UPGRADED "));
}

export function parseAirlockResult({ verb, stdout, stderr, status, spawnError }) {
  const notices = extractNotices(stderr);
  if (spawnError) {
    const code = spawnError.code === "ENOENT" ? `airlock binary not found: spawn ${verb} ENOENT` : `airlock ${verb} failed to spawn: ${spawnError.message}`;
    return { ok: false, error: code, exitCode: 1, notices };
  }
  // The 4.0 contract puts the JSON payload on stdout only; stderr is log noise
  // (the UPGRADED notice is not JSON, so the fallback probe is still safe).
  let parsed = null;
  const source = [stdout, stderr].find((text) => {
    if (!text?.trim()) return false;
    try {
      parsed = JSON.parse(text);
      return true;
    } catch {
      parsed = null;
      return false;
    }
  });
  if (!source || parsed === null || typeof parsed !== "object") {
    const detail = (stdout || stderr || "").trim().slice(0, 400);
    return { ok: false, error: `airlock ${verb} produced unparseable output (exit ${status}): ${detail}`, exitCode: 1, notices };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "error")) {
    return { ok: false, error: String(parsed.error), exitCode: status === null || status === undefined || status === 0 ? 1 : status, notices };
  }
  if (status !== null && status !== undefined && status !== 0) {
    return { ok: false, error: String(parsed.text ?? `airlock ${verb} exited ${status}`), exitCode: status, notices };
  }
  return { ok: true, value: parsed, exitCode: 0, notices };
}

export function createAirlockClient({ repoRoot, planPath = null, bin = process.env.AIRLOCK_BIN || "airlock", binArgs = [], timeoutMs = 120_000, env = process.env }) {
  function buildEnv() {
    const clean = { ...env };
    delete clean.CLAUDE_CODE_SUBAGENT_MODEL;
    return clean;
  }

  function run(verb, args) {
    // 4.0: no --host anywhere (init-only there; the router drops it so the deprecation can complete).
    const argv = [bin, ...binArgs, verb, ...args, "--json"];
    if (planPath) argv.push("--plan", path.resolve(planPath));
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: path.resolve(repoRoot),
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
      env: buildEnv(),
    });
    return parseAirlockResult({ verb, stdout: result.stdout, stderr: result.stderr, status: result.status, spawnError: result.error });
  }

  return {
    planPath: planPath ? path.resolve(planPath) : null,
    buildEnv,
    next({ unattended = false } = {}) {
      return run("next", unattended ? ["--unattended"] : []);
    },
    start(taskId) {
      return run("start", [taskId]);
    },
    status() {
      return run("status", []);
    },
    audit(taskId) {
      return run("audit", [taskId]);
    },
    done(taskId, evidence) {
      return run("done", [taskId, "--evidence", sanitizeReason(evidence)]);
    },
    block(taskId, reason) {
      return run("block", [taskId, "--reason", sanitizeReason(reason)]);
    },
  };
}
