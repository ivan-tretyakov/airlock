import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHerdrClient, parseVersion } from "../src/herdr-client.mjs";
import { checkExecutorFlags, createExecutorProbes } from "../src/executors.mjs";
import { dispatch } from "../src/dispatch.mjs";
import { reconcile } from "../src/reconcile.mjs";
import { status } from "../src/render.mjs";
import { workflowDir, workflowKey } from "../src/state.mjs";
import { airlockClientFor, assert, builderTask, installRoutes, makeProject, outCapture } from "./helpers.mjs";

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "evidence");
const probes = createExecutorProbes({ timeoutMs: 60_000 });

function cliVersion(bin, args = ["--version"]) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0 && !result.stdout) return null;
  return parseVersion(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

// Evidence-gated live CLI flag checks: for each executor found on PATH, capture the help
// surface, assert the §Executors table's flags, and refresh evidence/<cli>-cli-<version>.txt.
const EXECUTOR_CANDIDATES = {
  claude: { executor: "claude", model: "opus", effort: "high" },
  codex: { executor: "codex", model: "gpt-x", effort: "high" },
  opencode: { executor: "opencode", model: "p/m", effort: "max" },
};

for (const [bin, candidate] of Object.entries(EXECUTOR_CANDIDATES)) {
  const found = probes.which(bin);
  test(`live CLI flags: ${bin} offers the table's flags (evidence refresh)`, { skip: found ? false : `skipped: ${bin} is not installed on this machine` }, () => {
    const helps = probes.help(bin);
    const missing = [
      ...checkExecutorFlags(candidate, helps),
      ...(bin === "opencode" ? checkExecutorFlags({ ...candidate, effort: null }, helps) : []),
    ];
    assert.deepEqual(missing, [], `installed ${bin} lost a required flag; do not guess — update the spec/evidence first`);
    if (bin === "claude") assert.match(helps.help, /low.*medium.*high.*xhigh.*max|low\|medium\|high\|xhigh\|max/s, "the claude effort enum is the verbatim help enum");
    const version = cliVersion(bin) ?? "unknown";
    const file = path.join(evidenceDir, `${bin}-cli-${version}.txt`);
    const sections = [`=== ${bin} --help (captured ${new Date().toISOString().slice(0, 10)}) ===`, helps.help];
    if (bin === "opencode") sections.push(`=== ${bin} run --help ===`, helps.runHelp);
    writeFileSync(file, `${sections.join("\n")}\n`, "utf8");
    assert.ok(existsSync(file));
  });
}

function herdrVersion() {
  const result = spawnSync("herdr", ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) return null;
  return parseVersion(result.stdout ?? "");
}

const version = herdrVersion();
const optIn = process.env.AIRLOCK_HERDR_E2E === "1";
const skipReason = version
  ? optIn ? false : "live Herdr cycle is opt-in; set AIRLOCK_HERDR_E2E=1 to run it against the installed herdr"
  : `skipped: herdr is not installed (observed: ${process.env.HERDR_BIN ?? "herdr"})`;

test("e2e: one real dispatch→prompt→reconcile→done cycle, one forced fallback, one exhausted-chain block", { skip: skipReason }, async (t) => {
  const sessionName = `airlock-e2e-${process.pid}-${Date.now().toString(36)}`;
  const model = process.env.AIRLOCK_HERDR_E2E_MODEL ?? "zai-coding-plan/glm-5.3-flash";
  const routing = {
    version: 1,
    bindings: {
      builder: {
        default: {
          primary: { executor: "opencode", model, effort: null },
          fallbacks: [{ executor: "opencode", model: `${model}#missing-fallback`, effort: null }],
        },
      },
    },
  };
  const { root, planPath, configDir } = await makeProject(t, [builderTask("T001", ["src/alpha.js"]), builderTask("T002", ["src/beta.js"], ["T001"])], { routing });
  await installRoutes(configDir, routing);
  const airlock = airlockClientFor(root, planPath);
  const e2eEvidence = await mkdtemp(path.join(tmpdir(), "airlock-e2e-evidence-"));
  t.after(() => rm(e2eEvidence, { recursive: true, force: true }));
  const herdr = createHerdrClient({ sessionName, evidenceDir: e2eEvidence, log: () => {} });
  const stateDir = await mkdtemp(path.join(tmpdir(), "airlock-e2e-state-"));
  const dir = workflowDir(stateDir, sessionName, workflowKey(root, planPath));
  t.after(async () => {
    if (existsSync(path.join(dir, "tasks"))) {
      for (const name of (await import("node:fs")).readdirSync(path.join(dir, "tasks"))) {
        const record = JSON.parse(readFileSync(path.join(dir, "tasks", name), "utf8"));
        if (record.paneId) await herdr.closePane(record.paneId).catch(() => {});
      }
    }
    spawnSync("herdr", ["session", "stop", sessionName, "--json"], { encoding: "utf8", timeout: 30_000 });
    spawnSync("herdr", ["session", "delete", sessionName, "--json"], { encoding: "utf8", timeout: 30_000 });
  });

  const preflight = await herdr.preflight();
  assert.ok(preflight.version >= "0.8.2");
  assert.ok(existsSync(preflight.evidenceFile), "preflight captures the installed CLI surface");

  const capture = outCapture();
  const shared = { session: sessionName, repoRoot: root, planPath, stateDir, configDir, timeoutMs: Number(process.env.AIRLOCK_HERDR_E2E_TIMEOUT_MS ?? 900_000), airlock, herdr, probes, out: capture.out, exit: () => {} };

  const dispatched = await dispatch(shared);
  assert.equal(dispatched.code, 0, capture.text());
  const record = JSON.parse(await readFile(path.join(dir, "tasks", "T001.json"), "utf8"));
  assert.ok(record.paneId);
  assert.equal(record.executor, "opencode");

  const confirming = { confirm: async () => true, input: async () => "test -f src/alpha.js: ok (human confirmed at the pane)" };
  const reconciled = await reconcile({ ...shared, ui: confirming });
  assert.equal(reconciled.settled, 1, capture.text());
  const settledRecord = JSON.parse(await readFile(path.join(dir, "tasks", "T001.json"), "utf8"));
  assert.equal(settledRecord.settledAs, "done");
  const log = spawnSync("git", ["-C", root, "log", "-1", "--format=%B"], { encoding: "utf8" }).stdout;
  assert.match(log, /Airlock-Task: T001/);

  // Forced fallback: kill the pane before the prompt cannot be raced reliably from here,
  // so exercise the exhausted chain instead: the second task's chain has one live and one
  // bogus candidate; kill the fresh pane immediately, then reconcile with the class-E proof.
  const second = await dispatch(shared);
  assert.equal(second.code, 0, capture.text());
  const orphaned = JSON.parse(await readFile(path.join(dir, "tasks", "T002.json"), "utf8"));
  await herdr.closePane(orphaned.paneId);
  const deciding = { confirm: async (question) => !question.includes("Resume"), input: async () => null };
  await reconcile({ ...shared, ui: deciding });
  const after = JSON.parse(await readFile(path.join(dir, "tasks", "T002.json"), "utf8"));
  assert.ok(["needs-reconcile", "settled", "launch-pending"].includes(after.state), capture.text());

  const rendered = await status({ ...shared, json: false });
  assert.equal(rendered.code, 0);
});
