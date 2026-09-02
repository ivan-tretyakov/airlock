import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export function agentForRole(role) {
  return `airlock-${role}`;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function dispatchPathFor(candidate) {
  return candidate.executor === "opencode" && candidate.effort != null ? "B-headless" : "A-interactive";
}

export function launchArgs(candidate, role) {
  const agent = agentForRole(role);
  if (candidate.executor === "claude") {
    return ["--agent", agent, "--model", candidate.model, ...(candidate.effort != null ? ["--effort", candidate.effort] : [])];
  }
  if (candidate.executor === "codex") {
    return ["-m", candidate.model, ...(candidate.effort != null ? ["-c", `model_reasoning_effort=${candidate.effort}`] : [])];
  }
  if (candidate.executor === "opencode") {
    if (candidate.effort != null) throw new Error("opencode candidates with an effort dispatch Path B, not launch args");
    return ["--agent", agent, "-m", candidate.model];
  }
  throw new Error(`unknown executor: ${candidate.executor}`);
}

export function pathBCommand({ role, model, effort, promptFile }) {
  return `opencode run --agent ${shellQuote(agentForRole(role))} -m ${shellQuote(model)} --variant ${shellQuote(effort)} "$(cat ${shellQuote(promptFile)})"`;
}

function hasFlag(helpText, flag) {
  const escaped = String(flag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,])${escaped}([,=\\s]|$)`, "m").test(String(helpText ?? ""));
}

export function requiredFlags(candidate) {
  if (candidate.executor === "claude") return { help: ["--agent", "--model", "--effort"], runHelp: [] };
  if (candidate.executor === "codex") return { help: ["--model", "-c"], runHelp: [] };
  if (candidate.effort != null) return { help: [], runHelp: ["--agent", "--model", "--variant"] };
  return { help: ["--agent", "--model"], runHelp: [] };
}

export function checkExecutorFlags(candidate, { help, runHelp }) {
  const required = requiredFlags(candidate);
  const missing = [];
  for (const flag of required.help) if (!hasFlag(help, flag)) missing.push(`${candidate.executor} --help lacks ${flag}`);
  for (const flag of required.runHelp) if (!hasFlag(runHelp, flag)) missing.push(`${candidate.executor} run --help lacks ${flag}`);
  return missing;
}

export function opencodeAgentFile(repoRoot, role) {
  return path.join(path.resolve(repoRoot), ".opencode", "agent", `${agentForRole(role)}.md`);
}

export function preflightCandidate(candidate, { role, repoRoot, probes }) {
  const binPath = probes.which(candidate.executor);
  if (!binPath) {
    return {
      ok: false,
      class: "executor-missing",
      code: "binary_absent",
      detail: `${candidate.executor} is not on PATH`,
      remedy: `install ${candidate.executor}, or remove the candidate from routing.json`,
    };
  }
  const helps = probes.help(candidate.executor);
  const missing = checkExecutorFlags(candidate, helps);
  if (missing.length) {
    return {
      ok: false,
      class: "executor-preflight",
      code: "flag_missing",
      detail: `${missing.join("; ")}; observed help (truncated): ${String(candidate.effort != null && candidate.executor === "opencode" ? helps.runHelp : helps.help ?? "").slice(0, 400)}`,
      remedy: `verify the installed ${candidate.executor} still offers the required flags (${[...requiredFlags(candidate).help, ...requiredFlags(candidate).runHelp].join(", ")})`,
    };
  }
  if (candidate.executor === "opencode") {
    const agentFile = opencodeAgentFile(repoRoot, role);
    if (!probes.fileExists(agentFile)) {
      return {
        ok: false,
        class: "executor-preflight",
        code: "agent_file_missing",
        detail: `missing ${agentFile}`,
        remedy: `run: airlock init --host opencode in ${path.resolve(repoRoot)}`,
      };
    }
  }
  let realPath = binPath;
  try {
    realPath = probes.realpath(binPath);
  } catch {}
  return { ok: true, binPath, approvedPaths: [...new Set([binPath, realPath])] };
}

export function isApprovedProcess(processInfo, approvedPaths) {
  const foreground = processInfo?.process_info?.foreground_processes?.[0] ?? processInfo?.foreground_processes?.[0];
  const raw = foreground?.argv?.[0] ?? foreground?.cmdline;
  if (!raw) return { approved: false, observed: null };
  let resolved = raw;
  try {
    resolved = realpathSync(raw.split(" ").at(0));
  } catch {}
  return { approved: approvedPaths.includes(resolved), observed: resolved };
}

function whichSync(bin, env) {
  const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = path.join(directory, bin);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

export function createExecutorProbes({ env = process.env, timeoutMs = 30_000 } = {}) {
  const helpCache = new Map();
  function captureHelp(argv) {
    const result = spawnSync(argv[0], [...argv.slice(1), "--help"], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
  return {
    which: (bin) => whichSync(bin, env),
    help(executor) {
      if (!helpCache.has(executor)) {
        const help = captureHelp([executor]);
        const runHelp = executor === "opencode" ? captureHelp([executor, "run"]) : "";
        helpCache.set(executor, { help, runHelp });
      }
      return helpCache.get(executor);
    },
    fileExists: (filePath) => existsSync(filePath),
    realpath: (filePath) => realpathSync(filePath),
  };
}
