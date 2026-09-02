import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { reconcile } from "../src/reconcile.mjs";
import { readRecord, writeRecord } from "../src/state.mjs";
import { nonceSeenIn } from "../src/render.mjs";
import { assert, builderTask, fakeProbes, outCapture, scriptUi } from "./helpers.mjs";
import { readJsonl, setup, taskStatus } from "./harness.mjs";

const THREE_CANDIDATES = {
  version: 1,
  bindings: {
    builder: {
      default: {
        primary: { executor: "opencode", model: "test/one", effort: null },
        fallbacks: [
          { executor: "codex", model: "gpt-two", effort: "high" },
          { executor: "claude", model: "opus", effort: "high" },
        ],
      },
    },
  },
};

function rejectKinds(herdr, kinds) {
  const instance = { ...herdr };
  instance.agentStart = async (args) => {
    herdr.calls.push({ method: "agentStart", args });
    if (kinds.includes(args.kind)) return { ok: false, code: "launch_rejected", message: `kind ${args.kind} rejected` };
    return herdr.agentStart(args);
  };
  return instance;
}

test("class E at dispatch: a launch rejected for the kind advances to the next candidate (budget-consuming)", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: rejectKinds(h.herdr, ["opencode"]) });
  assert.equal(result.code, 0);
  assert.match(h.capture.text(), /FALLBACK T001 · candidate 2\/3 · codex gpt-two/);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.attempt, 2, "a new attempt with a new agentName and nonce");
  assert.equal(record.agentName, "al-t001-a2");
  assert.equal(record.executor, "codex");
  assert.equal(record.pin.candidateIndex, 1);
  assert.equal(record.pin.advanceCount, 1);
  const failure = record.pin.failures[0];
  assert.equal(failure.class, "executor-start");
  assert.equal(failure.code, "launch_rejected");
  assert.equal(failure.fromAttempt, 1, "budget-consuming entries record the attempt they advanced from");
  assert.deepEqual(failure.candidate, { executor: "opencode", model: "test/one", effort: null });
  assert.ok(readJsonl(h.dir).some((entry) => entry.op === "record-advance"), "the advance is one persisted atomic write");
  assert.equal(taskStatus(h.airlock, "T001"), "doing", "airlock start is not re-run and the task stays doing");
  assert.equal(readJsonl(h.dir).filter((entry) => entry.op === "airlock-start").length, 1);
});

test("class E at dispatch: a process-path mismatch at launch advances", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const instance = { ...h.herdr };
  let first = true;
  instance.processInfo = async (paneId) => {
    if (first) {
      first = false;
      h.herdr.state.panes.get(paneId).foreground = [{ name: "evil", argv: ["/opt/evil/opencode"] }];
    }
    return h.herdr.processInfo(paneId);
  };
  const result = await h.run({ herdr: instance });
  assert.equal(result.code, 0);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.advanceCount, 1);
  assert.equal(record.pin.failures[0].code, "process_path_mismatch");
  assert.match(record.pin.failures[0].detail, /\/opt\/evil\/opencode/);
});

test("budget: at most two budget-consuming advances, then the chain exhausts into airlock block", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: rejectKinds(h.herdr, ["opencode", "codex", "claude"]) });
  assert.equal(result.code, 0);
  const text = h.capture.text();
  assert.match(text, /FALLBACK T001 · candidate 2\/3 · codex gpt-two/);
  assert.match(text, /FALLBACK T001 · candidate 3\/3 · claude opus/);
  assert.match(text, /BLOCKED T001: route chain exhausted:/);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.state, "settled");
  assert.equal(record.settledAs, "blocked");
  assert.equal(record.pin.advanceCount, 2, "mirrors the 3.x MAX_FALLBACK_ADVANCES = 2");
  assert.equal(record.pin.failures.length, 3);
  assert.deepEqual(record.pin.failures.map((entry) => entry.fromAttempt), [1, 2, 3]);
  assert.equal(taskStatus(h.airlock, "T001"), "blocked");
  const task = h.airlock.status().value.plan.tasks.find((entry) => entry.id === "T001");
  assert.match(task.note, /route chain exhausted: opencode test\/one: launch_rejected; codex gpt-two: launch_rejected; claude opus: launch_rejected/);
});

test("pre-start skips move candidateIndex but leave advanceCount at 0", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ probes: fakeProbes({ missing: ["opencode", "codex"] }) });
  assert.equal(result.code, 0);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.candidateIndex, 2);
  assert.equal(record.pin.advanceCount, 0, "only actual class-E advances consume the budget");
  assert.equal(record.attempt, 1, "skips launch nothing and create no attempt");
  assert.ok(record.pin.failures.every((entry) => entry.fromAttempt === null));
});

test("class P: agent_prompt_stalled keeps the delivered: true envelope and routes to needs-reconcile", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: Object.assign(Object.create(h.herdr), {
    agentPrompt: async (args) => {
      h.herdr.calls.push({ method: "agentPrompt", args });
      return { ok: true, delivered: true, state: null, timedOut: false, code: "agent_prompt_stalled" };
    },
  }) });
  assert.equal(result.code, 0, "a stall is reported only after an accepted submission");
  const record = readRecord(h.dir, "T001");
  assert.equal(record.state, "needs-reconcile");
  assert.equal(record.pin.candidateIndex, 0, "no class-P signal ever advances the chain");
  assert.equal(record.pin.advanceCount, 0);
  assert.ok(h.capture.lines.includes("RECONCILE T001"));
});

test("class P: delivered-then-timeout never advances", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: Object.assign(Object.create(h.herdr), {
    agentPrompt: async () => ({ ok: true, delivered: true, state: null, timedOut: true, code: "timeout" }),
  }) });
  assert.equal(result.code, 0);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.state, "needs-reconcile");
  assert.equal(record.pin.advanceCount, 0);
});

test("class S: a substrate failure at agent start exits 69 with the pin untouched (same candidate retried)", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: Object.assign(Object.create(h.herdr), {
    agentStart: async () => ({ ok: false, code: "spawn_error", message: "daemon socket unreachable" }),
  }) });
  assert.equal(result.code, 69);
  assert.match(h.capture.text(), /HERDR UNAVAILABLE .*retryable; the chain was not advanced/);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.candidateIndex, 0);
  assert.equal(record.pin.advanceCount, 0);
  assert.deepEqual(record.pin.failures, []);
  assert.equal(taskStatus(h.airlock, "T001"), "doing");
});

test("class S: a herdr CLI call timeout exits 69, never advances, never blocks", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: Object.assign(Object.create(h.herdr), {
    agentStart: async () => ({ ok: false, code: "timeout", message: "herdr agent start timed out after 5000ms" }),
  }) });
  assert.equal(result.code, 69);
  assert.equal(readRecord(h.dir, "T001").pin.advanceCount, 0);
  assert.equal(taskStatus(h.airlock, "T001"), "doing");
});

test("agent_blocked never advances: the human answers the pane; exit 0 RECONCILE handoff", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ herdr: Object.assign(Object.create(h.herdr), {
    agentPrompt: async () => ({ ok: false, delivered: false, code: "agent_blocked", message: "agent is waiting at a prompt" }),
  }) });
  assert.equal(result.code, 0);
  assert.match(h.capture.text(), /BLOCKED PROMPT T001/);
  assert.ok(h.capture.lines.includes("RECONCILE T001"));
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.advanceCount, 0);
  assert.equal(record.state, "needs-reconcile");
});

test("condition 2: a product change forbids the advance even on a real class-E failure", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const instance = rejectKinds(h.herdr, ["opencode"]);
  const inner = instance.agentStart;
  instance.agentStart = async (args) => {
    await writeFile(path.join(h.root, "src", "alpha.js"), "the worker somehow wrote this\n");
    return inner(args);
  };
  const result = await h.run({ herdr: instance });
  assert.equal(result.code, 0);
  assert.match(h.capture.text(), /NOT ADVANCING T001: the worktree has product changes; reconcile decides/);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.pin.candidateIndex, 0);
  assert.equal(record.pin.advanceCount, 0);
  assert.equal(record.state, "needs-reconcile");
});

test("condition 2: a strict-parsed result line in the pane forbids the advance", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const instance = { ...h.herdr };
  instance.agentStart = async (args) => {
    h.herdr.calls.push({ method: "agentStart", args });
    const record = readRecord(h.dir, "T001");
    h.herdr._spawnOutput(args.paneId, `AIRLOCK-RESULT ${record.nonce} ok already finished somehow\n`);
    return { ok: false, code: "launch_rejected", message: "rejected late" };
  };
  const result = await h.run({ herdr: instance });
  assert.equal(result.code, 0);
  assert.match(h.capture.text(), /NOT ADVANCING T001: a result line exists/);
  assert.equal(readRecord(h.dir, "T001").pin.advanceCount, 0);
});

test("condition 2 is the strict parse: the typed Path A REPORT line alone never counts as a result", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const instance = rejectKinds(h.herdr, ["opencode"]);
  const inner = instance.agentStart;
  instance.agentStart = async (args) => {
    // The echoed prompt (with its REPORT instruction) is visible in the pane before the
    // launch verdict lands — a .includes(nonce) would wrongly veto the advance.
    const record = readRecord(h.dir, "T001");
    h.herdr._spawnOutput(args.paneId, `REPORT End your reply with exactly one line: AIRLOCK-RESULT ${record.nonce} ok|blocked <one-line summary>\n`);
    return inner(args);
  };
  const result = await h.run({ herdr: instance });
  assert.equal(result.code, 0);
  assert.match(h.capture.text(), /FALLBACK T001 · candidate 2\/3/, "the echoed REPORT line is not a result; the class-E advance proceeds");
  assert.equal(readRecord(h.dir, "T001").pin.advanceCount, 1);
});

test("render rows use the same strict parse: the echoed REPORT line shows nonce not seen", () => {
  const echoed = "REPORT End your reply with exactly one line: AIRLOCK-RESULT abc-123 ok|blocked <one-line summary>";
  assert.equal(nonceSeenIn(echoed, "abc-123"), false, "render.mjs must agree with reconcile (the 0.1.0 .includes is gone)");
  assert.equal(nonceSeenIn(`${echoed}\nAIRLOCK-RESULT abc-123 ok did the work`, "abc-123"), true);
});

async function orphanFixture(t, { pinOverrides = {}, recordOverrides = {} } = {}) {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  assert.equal((await h.run()).code, 0);
  const record = readRecord(h.dir, "T001");
  // Simulate a crash after pane creation but before any submission: promptAttemptedAt
  // null plus a successful snapshot with the workspace gone is the class-E proof.
  record.state = "pane-created";
  record.promptAttemptedAt = null;
  record.promptDeliveredAt = null;
  Object.assign(record.pin, pinOverrides);
  Object.assign(record, recordOverrides);
  writeRecord(h.dir, record, { op: "record-state", outcome: "pane-created", detail: "test: simulated crash" });
  const pane = h.herdr.state.panes.get(record.paneId);
  h.herdr.state.panes.delete(record.paneId);
  h.herdr.state.workspaces.delete(pane.workspace_id);
  h.herdr.state.agents.delete(record.agentName);
  return { ...h, record };
}

async function reconcileOnce(h, { ui = {}, herdr = null } = {}) {
  const capture = outCapture();
  const exits = [];
  const result = await reconcile({ session: "test-session", repoRoot: h.root, planPath: h.planPath, stateDir: h.stateDir, timeoutMs: 5000, airlock: h.airlock, herdr: herdr ?? h.herdr, probes: h.probes, ui: scriptUi(ui), out: capture.out, exit: (code) => exits.push(code) });
  return { result, capture, exits };
}

test("reconcile orphan row: the proven class-E case advances automatically with a fresh pane", async (t) => {
  const h = await orphanFixture(t);
  const { result, capture } = await reconcileOnce(h);
  assert.equal(result.code, 0);
  assert.match(capture.text(), /FALLBACK T001 · opencode test\/one -> codex gpt-two/);
  const advanced = readRecord(h.dir, "T001");
  assert.equal(advanced.attempt, 2);
  assert.equal(advanced.pin.candidateIndex, 1);
  assert.equal(advanced.pin.advanceCount, 1);
  assert.equal(advanced.pin.failures[0].code, "pane_gone_before_submission");
  assert.equal(advanced.state, "needs-reconcile", "the fresh pane was launched and prompted");
  const start = h.herdr.calls.filter((call) => call.method === "agentStart").at(-1);
  assert.equal(start.args.kind, "codex");
  assert.equal(taskStatus(h.airlock, "T001"), "doing");
});

test("reconcile orphan row: an exhausted chain becomes airlock block", async (t) => {
  const h = await orphanFixture(t, { pinOverrides: { advanceCount: 2 } });
  const { result, capture } = await reconcileOnce(h);
  assert.equal(result.code, 0);
  assert.match(capture.text(), /chain is exhausted/);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.settledAs, "blocked");
  assert.equal(taskStatus(h.airlock, "T001"), "blocked");
  assert.match(h.airlock.status().value.plan.tasks.find((entry) => entry.id === "T001").note, /route chain exhausted/);
});

test("reconcile orphan row: promptAttemptedAt set means no proof — human choices, never auto-advance", async (t) => {
  const h = await orphanFixture(t, { recordOverrides: { state: "prompted", promptAttemptedAt: "2026-09-01T07:00:00.000Z" } });
  const { result, capture } = await reconcileOnce(h);
  assert.equal(result.code, 0);
  const text = capture.text();
  assert.match(text, /ORPHANED T001/);
  assert.ok(!text.includes("FALLBACK"), "a prompt may have been sent: never fall back");
  const record = readRecord(h.dir, "T001");
  assert.equal(record.attempt, 1);
  assert.equal(record.pin.advanceCount, 0);
  assert.equal(record.state, "needs-reconcile");
});

test("class S at reconcile: a failed snapshot exits 69 and the orphan row does not fire", async (t) => {
  const h = await orphanFixture(t);
  const before = readRecord(h.dir, "T001");
  const { result, capture } = await reconcileOnce(h, { herdr: Object.assign(Object.create(h.herdr), {
    snapshot: async () => ({ ok: false, snapshot: null, code: "spawn_error", message: "daemon gone" }),
  }) });
  assert.equal(result.code, 69);
  assert.match(capture.text(), /HERDR UNAVAILABLE session snapshot failed/);
  assert.ok(!capture.text().includes("FALLBACK"), "a failed snapshot must never be read as pane gone");
  assert.deepEqual(readRecord(h.dir, "T001"), before, "nothing was mutated");
});

test("reconcile idle/exited-without-result row never auto-advances (class P by definition)", async (t) => {
  const h = await setup(t, { routing: THREE_CANDIDATES });
  assert.equal((await h.run()).code, 0);
  const record = readRecord(h.dir, "T001");
  h.herdr.state.panes.get(record.paneId).foreground = [{ name: "bash", argv: ["/bin/bash"] }];
  h.herdr._setAgent(record.agentName, "idle");
  const { result, capture } = await reconcileOnce(h);
  assert.equal(result.code, 0);
  const text = capture.text();
  assert.match(text, /NO RESULT T001/);
  assert.ok(!text.includes("FALLBACK"), "the pane exists and the submission was accepted — the worker got the task");
  assert.ok(!text.includes("airlock fallback"), "the 3.x fallback-suggestion command line is gone");
  assert.equal(readRecord(h.dir, "T001").pin.advanceCount, 0);
});

test("all failures land in pin.failures and operations.jsonl with fromAttempt", async (t) => {
  // opencode launches but is rejected (class E, budget); codex is then skipped mid-chain
  // because its binary is absent (budget-free); claude finally launches.
  const h = await setup(t, { routing: THREE_CANDIDATES });
  const result = await h.run({ probes: fakeProbes({ missing: ["codex"] }), herdr: rejectKinds(h.herdr, ["opencode"]) });
  assert.equal(result.code, 0);
  const record = readRecord(h.dir, "T001");
  assert.equal(record.executor, "claude");
  assert.equal(record.pin.candidateIndex, 2);
  assert.equal(record.pin.advanceCount, 1, "the mid-chain skip cost nothing");
  assert.deepEqual(record.pin.failures.map((entry) => [entry.class, entry.fromAttempt]), [["executor-start", 1], ["executor-missing", null]]);
  const ops = readJsonl(h.dir);
  assert.ok(ops.some((entry) => entry.op === "record-advance"));
  assert.ok(ops.some((entry) => entry.op === "record-skip-candidate"));
});
