#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { createAirlockClient } from "../src/airlock-client.mjs";
import { createHerdrClient } from "../src/herdr-client.mjs";
import { createExecutorProbes } from "../src/executors.mjs";
import { dispatch, resolvePlanPath, DEFAULT_TIMEOUT_MS } from "../src/dispatch.mjs";
import { importRoutes } from "../src/import-routes.mjs";
import { reconcile } from "../src/reconcile.mjs";
import { status, watch } from "../src/render.mjs";

const EX_USAGE = 64;
const EX_SOFTWARE = 70;
const EX_CONFIG = 78;

const USAGE = `Usage: airlock-herdr <dispatch|reconcile|status|watch|import-routes>
  --session <name>        the explicitly named Herdr session (required except import-routes)
  --repo <absolute path>  product repository root (required except import-routes)
  [--plan <absolute path>]
  [--task <id>]           reconcile: limit to one task
  [--state-dir <path>]    default: $HERDR_PLUGIN_STATE_DIR, else fail
  [--config-dir <path>]   default: herdr plugin config-dir airlock.herdr, else fail
  [--timeout-ms <n>]      prompt wait, default 900000
  [--json]
import-routes only:
  [--from <path>]         3.x models.json (default: the 3.x resolution chain)
  [--host <claude|opencode>]
  [--dry-run]`;

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

function requireValue(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    console.error(`${label} is required\n\n${USAGE}`);
    process.exitCode = EX_USAGE;
    return null;
  }
  return value;
}

function resolveStateDir(flags) {
  if (typeof flags["state-dir"] === "string") return path.resolve(flags["state-dir"]);
  if (typeof process.env.HERDR_PLUGIN_STATE_DIR === "string" && process.env.HERDR_PLUGIN_STATE_DIR.trim()) return path.resolve(process.env.HERDR_PLUGIN_STATE_DIR);
  console.error(`no state directory: pass --state-dir or run as a Herdr plugin action ($HERDR_PLUGIN_STATE_DIR)\n\n${USAGE}`);
  process.exitCode = EX_USAGE;
  return null;
}

// Config-dir resolution order (§Routing configuration): the --config-dir flag, else
// `herdr plugin config-dir airlock.herdr`; otherwise fail closed — the router does not
// invent a default under $HOME.
async function resolveConfigDir(flags, herdr) {
  if (typeof flags["config-dir"] === "string") return path.resolve(flags["config-dir"]);
  const resolved = await herdr.pluginConfigDir();
  if (resolved.ok) return path.resolve(resolved.dir);
  console.error(`no config directory: pass --config-dir, or install the plugin so 'herdr plugin config-dir airlock.herdr' resolves one (${resolved.code}: ${resolved.message})`);
  process.exitCode = EX_CONFIG;
  return null;
}

function buildUi(out) {
  const interactive = Boolean(process.stdin.isTTY);
  return {
    async confirm(question) {
      if (!interactive) {
        out(`(non-interactive; decide yourself) ${question.replace(/ \[y\/N\]$/, "")}`);
        return false;
      }
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await rl.question(`${question} `)).trim().toLowerCase();
        return answer === "y" || answer === "yes";
      } finally {
        rl.close();
      }
    },
    async input(question) {
      if (!interactive) return null;
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
  };
}

async function main() {
  const { positional, flags } = parseCli(process.argv.slice(2));
  const command = positional.shift();
  if (!command || command === "help" || flags.help) {
    console.log(USAGE);
    process.exitCode = command ? 0 : EX_USAGE;
    return;
  }
  if (!["dispatch", "reconcile", "status", "watch", "import-routes"].includes(command)) {
    console.error(`unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = EX_USAGE;
    return;
  }

  const out = (line) => console.log(line);
  const exitWith = (code) => {
    process.exitCode = code;
  };

  if (command === "import-routes") {
    const herdr = createHerdrClient({ sessionName: "airlock-herdr-import", log: () => {} });
    const configDir = await resolveConfigDir(flags, herdr);
    if (configDir === null) return;
    importRoutes({
      from: typeof flags.from === "string" ? flags.from : null,
      host: typeof flags.host === "string" ? flags.host : null,
      configDir,
      dryRun: Boolean(flags["dry-run"]),
      out,
      exit: exitWith,
    });
    return;
  }

  const session = requireValue(flags.session, "--session <name>");
  const repoFlag = requireValue(flags.repo, "--repo <absolute path>");
  const stateDir = resolveStateDir(flags);
  if (session === null || repoFlag === null || stateDir === null) return;
  const repoRoot = path.resolve(repoFlag);
  if (!existsSync(repoRoot)) {
    console.error(`repo does not exist: ${repoRoot}`);
    process.exitCode = EX_USAGE;
    return;
  }
  const timeoutMs = Number(flags["timeout-ms"] ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    process.exitCode = EX_USAGE;
    return;
  }
  let planPath;
  try {
    planPath = resolvePlanPath(repoRoot, typeof flags.plan === "string" ? flags.plan : null);
  } catch (error) {
    console.error(error.message);
    process.exitCode = EX_USAGE;
    return;
  }

  const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "evidence");
  const airlock = createAirlockClient({ repoRoot, planPath });
  const herdr = createHerdrClient({ sessionName: session, evidenceDir, log: (message) => out(`[herdr] ${message}`) });
  const probes = createExecutorProbes();
  const shared = { session, repoRoot, planPath, stateDir, timeoutMs, airlock, herdr, probes, out, exit: exitWith };

  if (command === "dispatch") {
    const configDir = await resolveConfigDir(flags, herdr);
    if (configDir === null) return;
    if (configDir === stateDir) {
      console.error("config and state never share a directory; pass distinct --config-dir and --state-dir");
      process.exitCode = EX_USAGE;
      return;
    }
    await dispatch({ ...shared, configDir });
    return;
  }
  if (command === "reconcile") {
    await reconcile({ ...shared, task: typeof flags.task === "string" ? flags.task : null, ui: buildUi(out) });
    return;
  }
  if (command === "status") {
    await status({ ...shared, json: Boolean(flags.json) });
    return;
  }
  const signal = new AbortController();
  process.on("SIGINT", () => signal.abort());
  process.on("SIGTERM", () => signal.abort());
  await watch({ ...shared, signal: signal.signal });
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = EX_SOFTWARE;
});
