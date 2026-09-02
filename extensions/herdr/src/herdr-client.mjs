import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MIN_HERDR_VERSION = "0.8.2";
export const READ_LINES = 200;
export const READ_MAX_BYTES = 16 * 1024;
export const PLUGIN_ID = "airlock.herdr";

// Substrate (class S) failure codes: herdr itself failed; they teach nothing about a
// candidate and never advance the chain (§Failure classes and fallback).
export const SUBSTRATE_CODES = Object.freeze(["herdr_not_installed", "spawn_error", "timeout", "cli_usage"]);

export class PreflightError extends Error {
  constructor(message, { requirement, observed, code } = {}) {
    super(message);
    this.name = "PreflightError";
    this.requirement = requirement ?? null;
    this.observed = observed ?? null;
    // "substrate": herdr absent/unreachable — retryable, exit 69.
    // "precondition": herdr too old or a verb/flag missing — operator action, exit 78.
    this.code = code ?? "precondition";
  }
}

export function parseVersion(text) {
  const match = String(text ?? "").match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)/);
  return match ? match[1] : null;
}

export function versionAtLeast(version, minimum) {
  const left = String(version ?? "").split(/[-+]/)[0].split(".").map(Number);
  const right = String(minimum).split(/[-+]/)[0].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

const GROUPS = ["agent", "pane", "workspace", "session", "plugin", "api"];
const LEAVES = ["agent start", "agent prompt", "agent get", "agent wait", "pane get", "pane read", "pane run", "pane wait-output", "pane process-info", "pane close", "workspace create", "workspace close", "session list", "session stop", "plugin link", "plugin enable", "plugin disable", "plugin config-dir"];

const GROUP_VERBS = {
  agent: ["start", "prompt", "get", "wait"],
  pane: ["get", "read", "run", "wait-output", "process-info", "close"],
  workspace: ["create", "close"],
  session: ["list", "stop"],
  plugin: ["link", "enable", "disable", "config-dir"],
  api: ["snapshot"],
};

const LEAF_FLAGS = {
  "agent start": ["--kind", "--pane", "--timeout"],
  "agent prompt": ["--wait", "--until", "--timeout"],
  "pane read": ["--source", "--lines"],
  "pane wait-output": ["--match", "--timeout"],
  "pane process-info": ["--pane"],
  "workspace create": ["--cwd", "--label", "--no-focus"],
  "session list": ["--json"],
};

const OPTIONAL_LEAVES = ["pane process-info", "agent get", "agent wait"];

export function checkRequirements(captures) {
  const missing = [];
  for (const group of GROUPS) {
    if (!captures.groups[group]) missing.push(`group help for '${group}' unavailable`);
    else for (const verb of GROUP_VERBS[group] ?? []) {
      if (!new RegExp(`^\\s{2,}${verb}\\b`, "m").test(captures.groups[group])) missing.push(`verb '${group} ${verb}' not offered by installed herdr`);
    }
  }
  for (const leaf of LEAVES) {
    const help = captures.leaves[leaf];
    if (help === undefined) {
      if (!OPTIONAL_LEAVES.includes(leaf)) missing.push(`help for '${leaf}' unavailable`);
      continue;
    }
    if (help === null) {
      if (!OPTIONAL_LEAVES.includes(leaf)) missing.push(`verb '${leaf}' not offered by installed herdr`);
      continue;
    }
    for (const flag of LEAF_FLAGS[leaf] ?? []) {
      if (!help.includes(flag)) missing.push(`flag '${flag}' missing on '${leaf}'`);
    }
  }
  return missing;
}

export function createHerdrClient({
  sessionName,
  herdrBin = process.env.HERDR_BIN || "herdr",
  evidenceDir = process.env.HERDR_EVIDENCE_DIR || null,
  callTimeoutMs = 30_000,
  fixtures = null,
  log = () => {},
} = {}) {
  let preflightPromise = null;

  function spawnHerdr(args, { timeoutMs = callTimeoutMs } = {}) {
    const result = spawnSync(herdrBin, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status, spawnError: result.error ?? null, timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT") };
  }

  function parseEnvelope(verb, { stdout, stderr, status, spawnError, timedOut }, { timeoutMs }) {
    if (spawnError) {
      if (spawnError.code === "ENOENT") return { ok: false, code: "herdr_not_installed", message: `Herdr not installed: ${herdrBin} is not on PATH`, timedOut: false };
      if (timedOut || spawnError.code === "ETIMEDOUT") return { ok: false, code: "timeout", message: `herdr ${verb} timed out after ${timeoutMs}ms`, timedOut: true };
      return { ok: false, code: "spawn_error", message: `herdr ${verb} failed to spawn: ${spawnError.message}`, timedOut: false };
    }
    const sources = [stdout, stderr];
    for (const source of sources) {
      if (!source?.trim()) continue;
      try {
        const parsed = JSON.parse(source);
        if (parsed && typeof parsed === "object") {
          if (parsed.error) return { ok: false, code: parsed.error.code ?? "herdr_error", message: parsed.error.message ?? JSON.stringify(parsed.error), timedOut: false };
          return { ok: true, result: parsed.result ?? parsed, timedOut: false };
        }
      } catch {}
    }
    if (status === 2) return { ok: false, code: "cli_usage", message: `herdr ${verb} rejected arguments (exit 2): ${(stderr || stdout).trim().slice(0, 400)}`, timedOut: false };
    return { ok: true, result: { text: stdout }, timedOut: false };
  }

  function herdr(verb, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? callTimeoutMs;
    const argv = options.sessionScoped === false ? [verb, ...args] : ["--session", sessionName, verb, ...args];
    return parseEnvelope(verb, spawnHerdr(argv, { timeoutMs }), { timeoutMs });
  }

  function captureHelp(leaf) {
    const args = [...leaf.split(" "), "--help"];
    const result = spawnHerdr(args);
    if (result.spawnError) return { text: null, spawnError: result.spawnError };
    if (result.status === 2) return { text: null };
    return { text: `${result.stdout}${result.stderr}` };
  }

  async function preflight() {
    if (!preflightPromise) preflightPromise = runPreflight().catch((error) => {
      preflightPromise = null;
      throw error;
    });
    return preflightPromise;
  }

  async function runPreflight() {
    const warnings = [];
    let versionText;
    let mainHelp;
    let groups = {};
    let leaves = {};
    if (fixtures) {
      versionText = fixtures.version ?? "";
      mainHelp = fixtures.mainHelp ?? "";
      groups = { ...fixtures.groupHelp };
      leaves = { ...fixtures.leafHelp };
    } else {
      const probe = spawnHerdr(["--version"]);
      if (probe.spawnError?.code === "ENOENT") throw new PreflightError(`Herdr not installed: '${herdrBin}' is not on PATH. Install Herdr >= ${MIN_HERDR_VERSION}, or run Airlock without the router.`, { requirement: "V1", code: "substrate" });
      if (probe.spawnError) throw new PreflightError(`herdr --version failed to spawn: ${probe.spawnError.message}`, { requirement: "V1", code: "substrate" });
      versionText = probe.stdout;
      mainHelp = `${(() => {
        const help = spawnHerdr(["--help"]);
        return `${help.stdout}${help.stderr}`;
      })()}`;
      for (const group of GROUPS) groups[group] = captureHelp(group).text ?? "";
      for (const leaf of LEAVES) {
        const captured = captureHelp(leaf);
        leaves[leaf] = captured.text === undefined ? undefined : captured.text;
        if (captured.spawnError) warnings.push(`help capture for '${leaf}' failed: ${captured.spawnError.message}`);
      }
    }

    const version = parseVersion(versionText);
    if (!version) throw new PreflightError(`could not parse a herdr version from: ${String(versionText).trim().slice(0, 100)}`, { requirement: "V1" });
    if (!versionAtLeast(version, MIN_HERDR_VERSION)) throw new PreflightError(`herdr ${version} is too old; the router requires >= ${MIN_HERDR_VERSION}. Upgrade Herdr, or run Airlock without the router.`, { requirement: "V1" });

    const missing = checkRequirements({ groups, leaves });
    if (missing.length) {
      const observed = [mainHelp, ...GROUPS.map((group) => groups[group] ?? "")].join("\n").slice(0, 4000);
      throw new PreflightError(`installed herdr ${version} does not provide the verbs/flags the router requires:\n  - ${missing.join("\n  - ")}\nObserved help output (truncated):\n${observed}`, { requirement: "V2", observed });
    }

    let evidenceFile = null;
    if (evidenceDir) {
      try {
        mkdirSync(evidenceDir, { recursive: true });
        evidenceFile = path.join(evidenceDir, `herdr-cli-${version}.txt`);
        writeFileSync(evidenceFile, [mainHelp, ...GROUPS.map((group) => `=== herdr ${group} --help ===\n${groups[group] ?? ""}`), ...LEAVES.filter((leaf) => leaves[leaf]).map((leaf) => `=== herdr ${leaf} --help ===\n${leaves[leaf]}`)].join("\n"), "utf8");
      } catch (error) {
        warnings.push(`could not write preflight evidence: ${error.message}`);
        evidenceFile = null;
      }
    }

    log(`preflight ok: herdr ${version}`);
    return { version, evidenceFile, warnings };
  }

  async function ensureSession(name = sessionName) {
    const list = herdr("session", ["list", "--json"], { sessionScoped: false });
    const sessions = list.ok && Array.isArray(list.result?.sessions) ? list.result.sessions : [];
    const found = sessions.find((session) => session.name === name);
    if (found?.running) return { ok: true, created: false };
    spawnHerdr(["session", "attach", name], { timeoutMs: 15_000 });
    const recheck = herdr("session", ["list", "--json"], { sessionScoped: false });
    const sessionsAfter = recheck.ok && Array.isArray(recheck.result?.sessions) ? recheck.result.sessions : [];
    const foundAfter = sessionsAfter.find((session) => session.name === name);
    if (foundAfter?.running) return { ok: true, created: !found };
    throw new PreflightError(`herdr session '${name}' is not running; start it once with: herdr session attach ${name}`, { requirement: "session", code: "substrate" });
  }

  async function pluginConfigDir(pluginId = PLUGIN_ID) {
    const result = herdr("plugin", ["config-dir", pluginId], { sessionScoped: false });
    if (!result.ok) return { ok: false, code: result.code, message: result.message, dir: null };
    const dir = result.result?.config_dir ?? result.result?.dir ?? String(result.result?.text ?? "").trim();
    if (!dir) return { ok: false, code: "unexpected_response", message: "herdr plugin config-dir returned no directory", dir: null };
    return { ok: true, dir };
  }

  async function createPane(session, workspaceName, cwd) {
    const result = await herdr("workspace", ["create", "--cwd", path.resolve(cwd), "--label", workspaceName, "--no-focus"]);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    const created = result.result ?? {};
    const workspaceId = created.workspace?.workspace_id ?? null;
    const paneId = created.root_pane?.pane_id ?? null;
    if (!workspaceId || !paneId) return { ok: false, code: "unexpected_response", message: `workspace create returned no ids: ${JSON.stringify(created).slice(0, 200)}` };
    return { ok: true, workspaceId, paneId };
  }

  async function agentStart({ name, kind, paneId, agentArgs = [], timeoutMs = 30_000 }) {
    const result = await herdr("agent", ["start", name, "--kind", kind, "--pane", paneId, "--timeout", String(timeoutMs), "--", ...agentArgs], { timeoutMs: timeoutMs + 15_000 });
    return result.ok ? { ok: true } : { ok: false, code: result.code, message: result.message };
  }

  async function agentPrompt({ name, prompt, timeoutMs }) {
    const result = await herdr("agent", ["prompt", name, prompt, "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", String(timeoutMs)], { timeoutMs: timeoutMs + 15_000 });
    if (result.ok) return { ok: true, delivered: true, state: result.result?.state ?? "done", timedOut: false };
    if (result.code === "timeout") return { ok: true, delivered: true, state: null, timedOut: true, code: result.code };
    // A stall is reported only after an accepted submission (herdr 0.8.2 help): delivered stays true.
    if (result.code === "agent_prompt_stalled") return { ok: true, delivered: true, state: null, timedOut: false, code: result.code };
    return { ok: false, delivered: false, code: result.code, message: result.message, timedOut: result.timedOut };
  }

  async function runInPane({ paneId, command, match, timeoutMs }) {
    const started = await herdr("pane", ["run", paneId, command]);
    if (!started.ok) return { ok: false, delivered: false, matched: false, timedOut: false, code: started.code, message: started.message };
    const waited = await herdr("pane", ["wait-output", "--match", match, "--timeout", String(timeoutMs), paneId], { timeoutMs: timeoutMs + 15_000 });
    if (waited.ok) return { ok: true, delivered: true, matched: true, timedOut: false, output: waited.result?.read?.text ?? "" };
    if (waited.code === "timeout") return { ok: true, delivered: true, matched: false, timedOut: true, output: "" };
    return { ok: false, delivered: true, matched: false, timedOut: waited.timedOut, code: waited.code, message: waited.message };
  }

  async function readPane(paneId, { lines = READ_LINES, maxBytes = READ_MAX_BYTES } = {}) {
    const result = await herdr("pane", ["read", "--source", "recent-unwrapped", "--lines", String(lines), paneId]);
    if (!result.ok) return { ok: false, text: "", code: result.code, message: result.message };
    let text = typeof result.result?.text === "string" ? result.result.text : String(result.result?.text ?? "");
    if (Buffer.byteLength(text, "utf8") > maxBytes) text = text.slice(-Math.floor(maxBytes / 2));
    return { ok: true, text, truncated: true };
  }

  async function paneInfo(paneId) {
    const result = await herdr("pane", ["get", paneId]);
    if (!result.ok) return { ok: false, code: result.code, message: result.message, pane: null };
    return { ok: true, pane: result.result?.pane ?? null };
  }

  async function processInfo(paneId) {
    const result = await herdr("pane", ["process-info", "--pane", paneId]);
    if (!result.ok) return { ok: false, processInfo: null, code: result.code, message: result.message };
    return { ok: true, processInfo: result.result?.process_info ?? null };
  }

  async function closePane(paneId) {
    const result = await herdr("pane", ["close", paneId]);
    return result.ok ? { ok: true } : { ok: false, code: result.code, message: result.message };
  }

  async function agentInfo(target) {
    const result = await herdr("agent", ["get", target]);
    if (!result.ok) return { ok: false, code: result.code, message: result.message, agent: null };
    return { ok: true, agent: result.result?.agent ?? result.result ?? null };
  }

  async function snapshot() {
    const result = await herdr("api", ["snapshot"]);
    if (!result.ok) return { ok: false, snapshot: null, code: result.code, message: result.message };
    return { ok: true, snapshot: result.result?.snapshot ?? result.result ?? null };
  }

  return { sessionName, preflight, ensureSession, pluginConfigDir, createPane, agentStart, agentPrompt, runInPane, readPane, paneInfo, processInfo, closePane, agentInfo, snapshot };
}
