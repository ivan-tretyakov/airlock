import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { default3xConfigPath, importRoutes } from "../src/import-routes.mjs";
import { validateRouting } from "../src/routes.mjs";
import { assert, outCapture } from "./helpers.mjs";

const WORKED_EXAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "models-v3-worked-example.json");

async function tempDir(t, prefix = "airlock-import-") {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function runImport(t, { fromContent = null, from = null, ...options } = {}) {
  const configDir = options.configDir ?? (await tempDir(t));
  let fromPath = from;
  if (fromContent !== null) {
    const sourceDir = await tempDir(t, "airlock-import-src-");
    fromPath = path.join(sourceDir, "models.json");
    await writeFile(fromPath, `${JSON.stringify(fromContent, null, 2)}\n`);
  }
  const capture = outCapture();
  const exits = [];
  const result = importRoutes({ from: fromPath, configDir, env: {}, cwd: configDir, out: capture.out, exit: (code) => exits.push(code), ...options });
  return { result, capture, exits, configDir, fromPath, written: () => (existsSync(path.join(configDir, "routing.json")) ? JSON.parse(readFileSync(path.join(configDir, "routing.json"), "utf8")) : null) };
}

function baseModels(overrides = {}) {
  return { version: 3, opencode: { builder: { standard: { model: "p/m", effort: "medium" } } }, ...overrides };
}

test("the worked example converts to exactly the spec's output and notices", async (t) => {
  const { result, capture, fromPath, written } = await runImport(t, { from: WORKED_EXAMPLE, host: "opencode" });
  assert.equal(result.code, 0, capture.text());
  const expected = {
    version: 1,
    bindings: {
      builder: {
        default: {
          primary: { executor: "opencode", model: "zai-coding-plan/glm-5.3-flash", effort: "max" },
          fallbacks: [{ executor: "opencode", model: "openrouter/z-ai/glm-5.3-flash", effort: "max" }],
          windows: [
            {
              name: "weekday-peak",
              days: ["mon", "tue", "wed", "thu", "fri"],
              utc: "06:00-10:00",
              executor: "opencode",
              model: "command-code/z-ai/glm-5.3-flash",
              effort: "max",
              fallbacks: [{ executor: "opencode", model: "openrouter/z-ai/glm-5.3-flash", effort: "max" }],
            },
          ],
        },
        expensive: { primary: { executor: "opencode", model: "openai/gpt-5.6-sol", effort: "medium" } },
      },
      checker: {
        default: { primary: { executor: "opencode", model: "openai/gpt-5.6-terra", effort: "medium" } },
        expensive: { primary: { executor: "opencode", model: "openai/gpt-5.6-sol", effort: "high" } },
      },
      browser: {
        default: { primary: { executor: "opencode", model: "openai/gpt-5.6-luna", effort: "medium" } },
        expensive: { primary: { executor: "opencode", model: "openai/gpt-5.6-terra", effort: "medium" } },
      },
    },
  };
  assert.deepEqual(written(), expected);
  assert.doesNotThrow(() => validateRouting(written()), "the round-tripped file is a valid routing.json");
  assert.deepEqual(capture.lines, [
    `IMPORTED 6 bindings from ${fromPath} (--host opencode)`,
    "DROPPED light rows: opencode/builder/light (zai-coding-plan/glm-5.3-flash@high + weekday-peak + 1 fallback), opencode/checker/light, opencode/browser/light",
    "DROPPED complex rows: opencode/builder/complex (zai-coding-plan/glm-5.3@high + weekday-peak command-code/zai-org/glm-5.3@high + 1 fallback), opencode/checker/complex, opencode/browser/complex",
    "SKIPPED host section: claude (12 rows) — re-run with --host claude into a separate --config-dir if you want them",
    "DROPPED catalog: 9 opencode variant declarations (variant legality is now checked against the live CLI)",
  ]);
  // Every imported opencode candidate carries an effort → every dispatch uses Path B.
  const candidates = [];
  for (const tiers of Object.values(written().bindings)) {
    for (const binding of Object.values(tiers)) {
      candidates.push(binding.primary, ...(binding.fallbacks ?? []), ...(binding.windows ?? []).flatMap((window) => [{ executor: window.executor, model: window.model, effort: window.effort }, ...(window.fallbacks ?? [])]));
    }
  }
  assert.ok(candidates.every((candidate) => typeof candidate.effort === "string" && candidate.effort.length > 0));
});

test("mapping rows: standard->default, critical->expensive; verbatim model/effort/windows/fallbacks", async (t) => {
  const models = {
    version: 3,
    opencode: {
      checker: {
        standard: { model: "a/std", effort: "low", fallbacks: [{ model: "a/fb", effort: "low" }] },
        critical: { model: "a/crit", effort: "high" },
      },
    },
  };
  const { result, written } = await runImport(t, { fromContent: models });
  assert.equal(result.code, 0);
  assert.deepEqual(written().bindings.checker.default, {
    primary: { executor: "opencode", model: "a/std", effort: "low" },
    fallbacks: [{ executor: "opencode", model: "a/fb", effort: "low" }],
  });
  assert.deepEqual(written().bindings.checker.expensive, { primary: { executor: "opencode", model: "a/crit", effort: "high" } });
});

test("claude rows map to executor claude", async (t) => {
  const models = { version: 2, claude: { builder: { standard: { model: "sonnet", effort: "medium" } } } };
  const { result, written, capture } = await runImport(t, { fromContent: models });
  assert.equal(result.code, 0, capture.text());
  assert.deepEqual(written().bindings.builder.default.primary, { executor: "claude", model: "sonnet", effort: "medium" });
  assert.match(capture.text(), /--host claude/);
});

test(`effort "none" is omitted with the MAPPED notice, keeping the row Path-A eligible`, async (t) => {
  const models = { version: 3, opencode: { builder: { standard: { model: "p/m", effort: "none", fallbacks: [{ model: "p/fb", effort: "none" }] } } } };
  const { result, written, capture } = await runImport(t, { fromContent: models });
  assert.equal(result.code, 0);
  const binding = written().bindings.builder.default;
  assert.deepEqual(binding.primary, { executor: "opencode", model: "p/m" }, "effort omitted, not effort: none");
  assert.equal("effort" in binding.primary, false);
  assert.deepEqual(binding.fallbacks[0], { executor: "opencode", model: "p/fb" });
  const mapped = capture.lines.filter((line) => line.startsWith(`MAPPED effort "none" -> omitted`));
  assert.equal(mapped.length, 2, "a per-row notice for each mapped site");
  const normalized = validateRouting(written());
  assert.equal(normalized.bindings.builder.default.primary.effort, null, "null effort means Path A: no variant flag is passed");
});

test("light and complex rows are dropped with explicit notices", async (t) => {
  const models = { version: 3, opencode: { builder: { standard: { model: "p/m", effort: "low" }, light: { model: "p/l", effort: "low" }, complex: { model: "p/c", effort: "high" } } } };
  const { result, written, capture } = await runImport(t, { fromContent: models });
  assert.equal(result.code, 0);
  assert.equal(written().bindings.builder.expensive, undefined);
  assert.match(capture.text(), /DROPPED light rows: opencode\/builder\/light/);
  assert.match(capture.text(), /DROPPED complex rows: opencode\/builder\/complex/);
});

test("unknown risk or role keys: listed, exit non-zero, nothing written", async (t) => {
  const badRisk = await runImport(t, { fromContent: { version: 3, opencode: { builder: { standard: { model: "p/m", effort: "low" }, urgent: { model: "p/u", effort: "low" } } } } });
  assert.equal(badRisk.result.code, 6);
  assert.match(badRisk.capture.text(), /UNMAPPED 3.x content/);
  assert.match(badRisk.capture.text(), /opencode\/builder\/urgent: unknown risk key/);
  assert.match(badRisk.capture.text(), /Nothing was written/);
  assert.equal(badRisk.written(), null);
  const badRole = await runImport(t, { fromContent: { version: 3, opencode: { deployer: { standard: { model: "p/m", effort: "low" } } } } });
  assert.equal(badRole.result.code, 6);
  assert.match(badRole.capture.text(), /opencode.deployer: unknown role key/);
  assert.equal(badRole.written(), null);
});

test("malformed rows (missing model or effort) are unmapped: exit non-zero, nothing written", async (t) => {
  const { result, capture, written } = await runImport(t, { fromContent: { version: 3, opencode: { builder: { standard: { effort: "low" }, critical: { model: "p/m" } } } } });
  assert.equal(result.code, 6);
  assert.match(capture.text(), /opencode\/builder\/standard: missing model/);
  assert.match(capture.text(), /opencode\/builder\/critical: missing effort/);
  assert.equal(written(), null);
});

test("an unsupported version is refused", async (t) => {
  const { result, capture } = await runImport(t, { fromContent: { version: 4, opencode: {} } });
  assert.equal(result.code, 6);
  assert.match(capture.text(), /requires version 1, 2, or 3/);
});

test("both host sections populated without --host: exit non-zero naming both remedies", async (t) => {
  const models = { version: 3, claude: { builder: { standard: { model: "sonnet", effort: "medium" } } }, opencode: { builder: { standard: { model: "p/m", effort: "low" } } } };
  const { result, capture, written, configDir } = await runImport(t, { fromContent: models });
  assert.equal(result.code, 64);
  assert.match(capture.text(), /--host <claude\|opencode>/, "the CLI remedy");
  assert.match(capture.text(), new RegExp(`import-defaults.json`), "the defaults-file remedy for the flagless Herdr action");
  assert.match(capture.text(), /Nothing was written/);
  assert.equal(written(), null);
  assert.equal(existsSync(path.join(configDir, "routing.json")), false);
});

test("import-defaults.json supplies host and from for flagless action use; CLI flags win", async (t) => {
  const configDir = await tempDir(t);
  const sourceDir = await tempDir(t, "airlock-import-src-");
  const defaultsFrom = path.join(sourceDir, "defaults-models.json");
  await writeFile(defaultsFrom, JSON.stringify({ version: 3, claude: { builder: { standard: { model: "sonnet", effort: "medium" } } }, opencode: { builder: { standard: { model: "p/m", effort: "low" } } } }));
  await writeFile(path.join(configDir, "import-defaults.json"), JSON.stringify({ from: defaultsFrom, host: "opencode" }));
  const first = await runImport(t, { configDir });
  assert.equal(first.result.code, 0, first.capture.text());
  assert.equal(first.written().bindings.builder.default.primary.executor, "opencode");

  const flagFrom = path.join(sourceDir, "flag-models.json");
  await writeFile(flagFrom, JSON.stringify({ version: 3, claude: { builder: { standard: { model: "opus", effort: "high" } } } }));
  const configDir2 = await tempDir(t);
  await writeFile(path.join(configDir2, "import-defaults.json"), JSON.stringify({ from: defaultsFrom, host: "opencode" }));
  const second = await runImport(t, { configDir: configDir2, from: flagFrom, host: "claude" });
  assert.equal(second.result.code, 0, second.capture.text());
  assert.deepEqual(second.written().bindings.builder.default.primary, { executor: "claude", model: "opus", effort: "high" }, "CLI flags override the defaults file");
});

test("import-defaults.json with unknown keys is rejected fail-closed", async (t) => {
  const configDir = await tempDir(t);
  await writeFile(path.join(configDir, "import-defaults.json"), JSON.stringify({ host: "opencode", force: true }));
  const { result, capture, written } = await runImport(t, { configDir, fromContent: baseModels() });
  assert.equal(result.code, 64);
  assert.match(capture.text(), /unknown key: force \(only "from" and "host" are accepted\)/);
  assert.equal(written(), null);
});

test("--from defaults to the recovered 3.x resolution chain, honored in full", () => {
  assert.equal(default3xConfigPath({ AIRLOCK_CONFIG: "/x/custom.json" }), "/x/custom.json");
  assert.equal(default3xConfigPath({ AIRLOCK_CONFIG_DIR: "/cfg/airlock-dir", XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), path.join("/cfg/airlock-dir", "models.json"));
  assert.equal(default3xConfigPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), path.join("/xdg", "airlock", "models.json"));
  assert.equal(default3xConfigPath({ HOME: "/home/u" }), path.join("/home/u", ".config", "airlock", "models.json"));
});

test("the default chain is actually consulted when --from is absent (via injected env)", async (t) => {
  const home = await tempDir(t, "airlock-import-home-");
  await mkdir(path.join(home, ".config", "airlock"), { recursive: true });
  await writeFile(path.join(home, ".config", "airlock", "models.json"), JSON.stringify(baseModels()));
  const configDir = await tempDir(t);
  const capture = outCapture();
  const result = importRoutes({ configDir, env: { HOME: home }, cwd: configDir, out: capture.out, exit: () => {} });
  assert.equal(result.code, 0, capture.text());
  assert.match(capture.text(), new RegExp(`IMPORTED 1 bindings from ${path.join(home, ".config", "airlock", "models.json")}`));
});

test("an existing routing.json is refused: one-shot means one-shot", async (t) => {
  const configDir = await tempDir(t);
  await writeFile(path.join(configDir, "routing.json"), "{}");
  const { result, capture } = await runImport(t, { configDir, fromContent: baseModels() });
  assert.equal(result.code, 6);
  assert.match(capture.text(), /refusing to overwrite existing .*routing.json; delete it by hand first \(one-shot means one-shot\)/);
  assert.equal(readFileSync(path.join(configDir, "routing.json"), "utf8"), "{}", "the existing file is untouched");
});

test("--dry-run prints the would-be file and notices and writes nothing", async (t) => {
  const { result, capture, written } = await runImport(t, { fromContent: baseModels(), dryRun: true });
  assert.equal(result.code, 0);
  assert.equal(written(), null);
  assert.match(capture.text(), /"version": 1/);
  assert.match(capture.text(), /IMPORTED 1 bindings/);
  assert.match(capture.text(), /DRY RUN: nothing was written/);
});

test("--dry-run still surfaces unmapped content with exit non-zero", async (t) => {
  const { result, capture, written } = await runImport(t, { fromContent: { version: 3, opencode: { builder: { experimental: { model: "p/m", effort: "low" } } } }, dryRun: true });
  assert.equal(result.code, 6);
  assert.match(capture.text(), /unknown risk key/);
  assert.equal(written(), null);
});

test("a project-level 3.x config is never merged; the notice says how to import it explicitly", async (t) => {
  const repo = await tempDir(t, "airlock-import-repo-");
  await mkdir(path.join(repo, ".git", "airlock"), { recursive: true });
  await writeFile(path.join(repo, ".git", "airlock", "models.json"), JSON.stringify(baseModels()));
  const configDir = await tempDir(t);
  const { result, capture } = await runImport(t, { configDir, fromContent: baseModels(), cwd: repo });
  assert.equal(result.code, 0);
  assert.match(capture.text(), /NOTICE the 3.x project config at .*\.git\/airlock\/models\.json was not merged; import it explicitly with: airlock-herdr import-routes --from/);
});

test("a missing config dir or an invalid --host are usage errors (64)", async (t) => {
  const capture = outCapture();
  const noConfig = importRoutes({ from: WORKED_EXAMPLE, host: "opencode", configDir: null, env: {}, cwd: "/", out: capture.out, exit: () => {} });
  assert.equal(noConfig.code, 64);
  const badHost = await runImport(t, { fromContent: baseModels(), host: "gemini" });
  assert.equal(badHost.result.code, 64);
  assert.match(badHost.capture.text(), /--host must be one of claude\|opencode/);
});
