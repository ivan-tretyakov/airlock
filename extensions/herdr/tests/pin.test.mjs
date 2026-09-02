import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { reconcile } from "../src/reconcile.mjs";
import { readRecord, writeRecord } from "../src/state.mjs";
import { assert, builderTask, outCapture, scriptUi } from "./helpers.mjs";
import { setup } from "./harness.mjs";

// 2026-08-31 is a Monday: 07:00 UTC falls inside the weekday-peak window.
const IN_WINDOW = "2026-08-31T07:00:00Z";
const OUT_OF_WINDOW = "2026-08-31T14:00:00Z";

const WINDOWED = {
  version: 1,
  bindings: {
    builder: {
      default: {
        primary: { executor: "opencode", model: "base/primary", effort: null },
        fallbacks: [{ executor: "opencode", model: "base/fb", effort: null }],
        windows: [
          {
            name: "weekday-peak",
            days: ["mon", "tue", "wed", "thu", "fri"],
            utc: "06:00-10:00",
            executor: "opencode",
            model: "peak/primary",
            effort: null,
            fallbacks: [{ executor: "claude", model: "opus", effort: "high" }],
          },
        ],
      },
    },
  },
};

async function reconcileWith(h, { ui = {}, env } = {}) {
  const capture = outCapture();
  const result = await reconcile({ session: "test-session", repoRoot: h.root, planPath: h.planPath, stateDir: h.stateDir, timeoutMs: 5000, airlock: h.airlock, herdr: h.herdr, probes: h.probes, ui: scriptUi(ui), out: capture.out, exit: () => {} });
  return { result, capture };
}

test("the chain is resolved once, at dispatch time, and the clock is never re-consulted", async (t) => {
  const h = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"])], routing: WINDOWED });
  const result = await h.run({ env: { AIRLOCK_NOW: IN_WINDOW } });
  assert.equal(result.code, 0);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.window, "weekday-peak");
  assert.equal(record.pin.resolvedAt, "2026-08-31T07:00:00.000Z");
  assert.deepEqual(record.pin.candidates.map((candidate) => candidate.model), ["peak/primary", "opus"], "the whole chain comes from the window, fallbacks included");

  // The window closes; a reconcile-driven resume keeps the recorded chain.
  process.env.AIRLOCK_NOW = OUT_OF_WINDOW;
  t.after(() => delete process.env.AIRLOCK_NOW);
  record.state = "pane-created";
  record.promptAttemptedAt = null;
  writeRecord(h.dir, record, { op: "record-state", outcome: "pane-created", detail: "test: crash before submission" });
  const pane = h.herdr.state.panes.get(record.paneId);
  h.herdr.state.panes.delete(record.paneId);
  h.herdr.state.workspaces.delete(pane.workspace_id);
  h.herdr.state.agents.delete(record.agentName);
  const { capture } = await reconcileWith(h);
  assert.match(capture.text(), /FALLBACK T001 · opencode peak\/primary -> claude opus/);
  const advanced = readRecord(h.dir, "T001");
  assert.equal(advanced.pin.window, "weekday-peak", "the pin holds for the life of the task; the advance reused the recorded chain");
  assert.equal(advanced.pin.resolvedAt, "2026-08-31T07:00:00.000Z", "never re-resolved");
  assert.deepEqual(advanced.pin.candidates.map((candidate) => candidate.model), ["peak/primary", "opus"]);
});

test("the pin dies when the record settles as done, and the next dispatch resolves a fresh chain", async (t) => {
  const h = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"]), builderTask("T002", ["src/beta.js"], ["T001"])], routing: WINDOWED });
  assert.equal((await h.run({ env: { AIRLOCK_NOW: IN_WINDOW } })).code, 0);
  const first = readRecord(h.dir, "T001");
  assert.equal(first.pin.window, "weekday-peak");
  await writeFile(path.join(h.root, "src", "alpha.js"), "module.exports = 1;\n");
  h.herdr._spawnOutput(first.paneId, `AIRLOCK-RESULT ${first.nonce} ok changed src/alpha.js\n`);
  const { result } = await reconcileWith(h, { ui: { confirm: true, input: "test -f src/alpha.js: ok" } });
  assert.equal(result.settled, 1);
  assert.equal(readRecord(h.dir, "T001").settledAs, "done");
  // The next dispatch happens after the window closed: a fresh chain, fresh clock.
  const second = await h.run({ env: { AIRLOCK_NOW: OUT_OF_WINDOW } });
  assert.equal(second.code, 0);
  const record = readRecord(h.dir, "T002");
  assert.equal(record.pin.window, "default");
  assert.deepEqual(record.pin.candidates.map((candidate) => candidate.model), ["base/primary", "base/fb"]);
  assert.equal(record.pin.resolvedAt, "2026-08-31T14:00:00.000Z");
});

test("a superseded record kills the pin: the reopened task re-resolves at the new dispatch time", async (t) => {
  const h = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"])], routing: WINDOWED });
  assert.equal((await h.run({ env: { AIRLOCK_NOW: IN_WINDOW } })).code, 0);
  assert.equal(readRecord(h.dir, "T001").pin.window, "weekday-peak");
  // An answered decision reopened the task.
  const plan = JSON.parse(readFileSync(h.planPath, "utf8"));
  const planTask = plan.tasks.find((entry) => entry.id === "T001");
  planTask.status = "todo";
  planTask.startedAt = null;
  planTask.note = "reopened after D1 changed from a to b";
  await writeFile(h.planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = await h.run({ env: { AIRLOCK_NOW: OUT_OF_WINDOW } });
  assert.equal(result.code, 0, "the superseded row makes the re-dispatch reachable in one call");
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.window, "default", "a fresh chain at the new dispatch time");
  assert.equal(record.pin.resolvedAt, "2026-08-31T14:00:00.000Z");
});

test("the pin dies at blocked: after a human block, re-opened work re-resolves", async (t) => {
  const h = await setup(t, { tasks: [builderTask("T001", ["src/alpha.js"])], routing: WINDOWED });
  assert.equal((await h.run({ env: { AIRLOCK_NOW: IN_WINDOW } })).code, 0);
  const record = readRecord(h.dir, "T001");
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} blocked cannot reach the registry\n`);
  const { result } = await reconcileWith(h);
  assert.equal(result.settled, 1);
  const settled = readRecord(h.dir, "T001");
  assert.equal(settled.settledAs, "blocked");
  assert.equal(settled.state, "settled", "the pin dies with the settled record");
});
