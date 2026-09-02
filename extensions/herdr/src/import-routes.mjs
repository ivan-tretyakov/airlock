import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROLES, validateRouting, routingPath, RoutingError } from "./routes.mjs";

const HOSTS = ["claude", "opencode"];
const RISK_TO_TIER = { standard: "default", critical: "expensive" };
const DROPPED_RISKS = ["light", "complex"];

// The recovered 3.x resolution chain, honored verbatim: AIRLOCK_CONFIG, else
// <userConfigDir>/models.json where userConfigDir is AIRLOCK_CONFIG_DIR, else
// $XDG_CONFIG_HOME/airlock, else ~/.config/airlock.
export function default3xConfigPath(env = process.env) {
  if (isNonEmptyString(env.AIRLOCK_CONFIG)) return path.resolve(env.AIRLOCK_CONFIG);
  let userConfigDir;
  if (isNonEmptyString(env.AIRLOCK_CONFIG_DIR)) userConfigDir = path.resolve(env.AIRLOCK_CONFIG_DIR);
  else if (isNonEmptyString(env.XDG_CONFIG_HOME)) userConfigDir = path.join(env.XDG_CONFIG_HOME, "airlock");
  else userConfigDir = path.join(env.HOME ?? env.USERPROFILE ?? process.cwd(), ".config", "airlock");
  return path.join(userConfigDir, "models.json");
}

export function findProjectConfig(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (existsSync(path.join(current, ".git"))) {
      const candidate = path.join(current, ".git", "airlock", "models.json");
      return existsSync(candidate) ? candidate : null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function readImportDefaults(configDir) {
  const filePath = path.join(configDir, "import-defaults.json");
  if (!existsSync(filePath)) return { from: null, host: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ImportUsageError(`invalid import-defaults.json at ${filePath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ImportUsageError(`import-defaults.json at ${filePath} must be a JSON object`);
  for (const key of Object.keys(parsed)) {
    if (!["from", "host"].includes(key)) throw new ImportUsageError(`import-defaults.json at ${filePath} has unknown key: ${key} (only "from" and "host" are accepted)`);
  }
  return { from: parsed.from ?? null, host: parsed.host ?? null };
}

export class ImportUsageError extends Error {}
export class ImportContentError extends Error {}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function countRows(section) {
  let count = 0;
  for (const risks of Object.values(section ?? {})) {
    if (risks && typeof risks === "object" && !Array.isArray(risks)) count += Object.keys(risks).length;
  }
  return count;
}

function candidateAt(effort) {
  return effort == null ? "" : `@${effort}`;
}

function droppedDetail(host, role, risk, row) {
  const name = `${host}/${role}/${risk}`;
  const windows = Array.isArray(row?.windows) ? row.windows : [];
  const fallbacks = Array.isArray(row?.fallbacks) ? row.fallbacks : [];
  if (!windows.length && !fallbacks.length) return name;
  const parts = [`${row.model}${candidateAt(row.effort)}`];
  for (const window of windows) {
    const differs = window?.model !== row.model || window?.effort !== row.effort;
    parts.push(differs ? `${window?.name} ${window?.model}${candidateAt(window?.effort)}` : `${window?.name}`);
  }
  if (fallbacks.length) parts.push(`${fallbacks.length} fallback${fallbacks.length === 1 ? "" : "s"}`);
  return `${name} (${parts.join(" + ")})`;
}

export function importRoutes({
  from = null,
  host = null,
  configDir = null,
  dryRun = false,
  env = process.env,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  exit = () => {},
} = {}) {
  const finish = (code) => {
    exit(code);
    return { code };
  };
  try {
    return finish(run());
  } catch (error) {
    if (error instanceof ImportUsageError) {
      out(error.message);
      return finish(64);
    }
    if (error instanceof ImportContentError || error instanceof RoutingError) {
      out(error.message);
      return finish(6);
    }
    throw error;
  }

  function run() {
    if (!isNonEmptyString(configDir)) throw new ImportUsageError("import-routes needs a config directory: pass --config-dir <path>, or run it where 'herdr plugin config-dir airlock.herdr' resolves one");
    const defaults = readImportDefaults(configDir);
    const fromPath = path.resolve(isNonEmptyString(from) ? from : isNonEmptyString(defaults.from) ? defaults.from : default3xConfigPath(env));
    const chosenHost = host ?? defaults.host;
    if (chosenHost !== null && !HOSTS.includes(chosenHost)) throw new ImportUsageError(`--host must be one of ${HOSTS.join("|")}; got: ${chosenHost}`);

    if (!existsSync(fromPath)) throw new ImportContentError(`no 3.x models.json at ${fromPath}; pass --from <path>. Nothing was written.`);
    let source;
    try {
      source = JSON.parse(readFileSync(fromPath, "utf8"));
    } catch (error) {
      throw new ImportContentError(`invalid 3.x models.json at ${fromPath}: ${error.message}. Nothing was written.`);
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new ImportContentError(`invalid 3.x models.json at ${fromPath}: not a JSON object. Nothing was written.`);
    if (![1, 2, 3].includes(source.version)) throw new ImportContentError(`3.x models.json at ${fromPath} requires version 1, 2, or 3; got: ${source.version}. Nothing was written.`);

    const populated = HOSTS.filter((name) => countRows(source[name]) > 0);
    let selectedHost = chosenHost;
    if (!selectedHost) {
      if (populated.length === 2) {
        throw new ImportUsageError([
          `both host sections (claude and opencode) are populated in ${fromPath} and a v1 binding holds one chain per role/tier, so the importer never merges hosts.`,
          `Choose one: re-run with --host <claude|opencode>, or (for the Herdr action, which passes no flags) write {"host": "<claude|opencode>"} to ${path.join(configDir, "import-defaults.json")}.`,
          "Nothing was written.",
        ].join("\n"));
      }
      if (populated.length === 0) throw new ImportContentError(`no routable rows in ${fromPath}: both host sections are empty. Nothing was written.`);
      selectedHost = populated[0];
    }
    if (countRows(source[selectedHost]) === 0) throw new ImportContentError(`host section ${selectedHost} in ${fromPath} is empty. Nothing was written.`);
    const otherHost = HOSTS.find((name) => name !== selectedHost);

    const unmapped = [];
    const mappedNotices = [];
    const droppedByRisk = { light: [], complex: [] };
    const bindings = {};
    let bindingCount = 0;

    const convertCandidate = (row, label) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        unmapped.push(`${label}: not an object`);
        return null;
      }
      if (!isNonEmptyString(row.model)) {
        unmapped.push(`${label}: missing model`);
        return null;
      }
      if (!isNonEmptyString(row.effort)) {
        unmapped.push(`${label}: missing effort`);
        return null;
      }
      if (row.effort === "none") {
        // The 3.x catalog legally declared `none` as "pass no variant flag"; imported
        // verbatim it would force Path B and emit `opencode run --variant none`.
        mappedNotices.push(`MAPPED effort "none" -> omitted (${label})`);
        return { executor: selectedHost, model: row.model };
      }
      return { executor: selectedHost, model: row.model, effort: row.effort };
    };

    const convertRow = (row, label) => {
      const primary = convertCandidate(row, label);
      if (!primary) return null;
      const binding = { primary };
      if (row.fallbacks !== undefined) {
        if (!Array.isArray(row.fallbacks) || row.fallbacks.length === 0 || row.fallbacks.length > 2) {
          unmapped.push(`${label}: fallbacks must be a non-empty array of at most 2`);
          return null;
        }
        const fallbacks = row.fallbacks.map((candidate, index) => convertCandidate(candidate, `${label} fallbacks[${index}]`));
        if (fallbacks.some((candidate) => candidate === null)) return null;
        binding.fallbacks = fallbacks;
      }
      if (row.windows !== undefined) {
        if (!Array.isArray(row.windows) || row.windows.length === 0) {
          unmapped.push(`${label}: windows must be a non-empty array`);
          return null;
        }
        const windows = [];
        for (let index = 0; index < row.windows.length; index += 1) {
          const window = row.windows[index];
          const windowLabel = `${label} windows[${index}]`;
          const inline = convertCandidate(window, windowLabel);
          if (!inline) return null;
          const converted = { name: window?.name, days: window?.days, utc: window?.utc, ...inline };
          if (window?.fallbacks !== undefined) {
            if (!Array.isArray(window.fallbacks) || window.fallbacks.length === 0 || window.fallbacks.length > 2) {
              unmapped.push(`${windowLabel}: fallbacks must be a non-empty array of at most 2`);
              return null;
            }
            const windowFallbacks = window.fallbacks.map((candidate, fallbackIndex) => convertCandidate(candidate, `${windowLabel} fallbacks[${fallbackIndex}]`));
            if (windowFallbacks.some((candidate) => candidate === null)) return null;
            converted.fallbacks = windowFallbacks;
          }
          windows.push(converted);
        }
        binding.windows = windows;
      }
      return binding;
    };

    for (const [role, risks] of Object.entries(source[selectedHost] ?? {})) {
      if (!ROLES.includes(role)) {
        unmapped.push(`${selectedHost}.${role}: unknown role key`);
        continue;
      }
      if (!risks || typeof risks !== "object" || Array.isArray(risks)) {
        unmapped.push(`${selectedHost}.${role}: not an object`);
        continue;
      }
      for (const [risk, row] of Object.entries(risks)) {
        const label = `${selectedHost}/${role}/${risk}`;
        if (DROPPED_RISKS.includes(risk)) {
          droppedByRisk[risk].push(droppedDetail(selectedHost, role, risk, row));
          continue;
        }
        const tier = RISK_TO_TIER[risk];
        if (!tier) {
          unmapped.push(`${label}: unknown risk key`);
          continue;
        }
        const binding = convertRow(row, label);
        if (!binding) continue;
        bindings[role] ??= {};
        bindings[role][tier] = binding;
        bindingCount += 1;
      }
    }

    if (unmapped.length) {
      throw new ImportContentError([`UNMAPPED 3.x content in ${fromPath}:`, ...unmapped.map((entry) => `  - ${entry}`), "Nothing was written."].join("\n"));
    }
    const routing = { version: 1, bindings };
    try {
      validateRouting(routing);
    } catch (error) {
      throw new ImportContentError(`imported configuration is not a valid routing.json: ${error.message}. Nothing was written.`);
    }

    const notices = [];
    notices.push(`IMPORTED ${bindingCount} bindings from ${fromPath} (--host ${selectedHost})`);
    notices.push(...mappedNotices);
    for (const risk of DROPPED_RISKS) {
      if (droppedByRisk[risk].length) notices.push(`DROPPED ${risk} rows: ${droppedByRisk[risk].join(", ")}`);
    }
    if (otherHost && countRows(source[otherHost]) > 0) {
      notices.push(`SKIPPED host section: ${otherHost} (${countRows(source[otherHost])} rows) — re-run with --host ${otherHost} into a separate --config-dir if you want them`);
    }
    const variantCount = Object.values(source.catalog?.opencode ?? {}).reduce((total, entry) => total + (Array.isArray(entry?.variants) ? entry.variants.length : 0), 0);
    if (source.catalog !== undefined) {
      notices.push(`DROPPED catalog: ${variantCount} opencode variant declarations (variant legality is now checked against the live CLI)`);
    }
    const projectConfig = findProjectConfig(cwd);
    if (projectConfig && path.resolve(projectConfig) !== fromPath) {
      notices.push(`NOTICE the 3.x project config at ${projectConfig} was not merged; import it explicitly with: airlock-herdr import-routes --from ${projectConfig} --host <claude|opencode> --config-dir <path>`);
    }

    const targetPath = routingPath(configDir);
    if (dryRun) {
      out(JSON.stringify(routing, null, 2));
      for (const notice of notices) out(notice);
      out(`DRY RUN: nothing was written (target: ${targetPath})`);
      return 0;
    }
    if (existsSync(targetPath)) {
      throw new ImportContentError(`refusing to overwrite existing ${targetPath}; delete it by hand first (one-shot means one-shot). Nothing was written.`);
    }
    mkdirSync(configDir, { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(routing, null, 2)}\n`, "utf8");
    for (const notice of notices) out(notice);
    return 0;
  }
}
