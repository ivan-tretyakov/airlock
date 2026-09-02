import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { detectNonce, extractOutOfScope, reconcile } from "../src/reconcile.mjs";
import { collectRows, nonceSeenIn, renderStatus, watch } from "../src/render.mjs";
import { acquireWorkflowLock } from "../src/lock.mjs";
import { createRecord, readRecord, writeRecord, workflowDir, workflowKey } from "../src/state.mjs";
import { airlockScript, assert, builderTask, fakeProbes, outCapture, scriptUi } from "./helpers.mjs";
import { readJsonl, setup, taskStatus } from "./harness.mjs";

async function harness(t, options = {}) {
  const h = await setup(t, options);
  const exitCodes = [];
  const reconcileOnce = async (overrides = {}) => {
    const linesBefore = h.capture.lines.length;
    const result = await reconcile({
      session: "test-session",
      repoRoot: h.root,
      planPath: h.planPath,
      stateDir: h.stateDir,
      timeoutMs: 5000,
      airlock: h.airlock,
      herdr: h.herdr,
      probes: h.probes,
      ui: scriptUi(overrides.uiResponses ?? {}),
      out: h.capture.out,
      exit: (code) => exitCodes.push(code),
      ...overrides,
    });
    return { result, printed: h.capture.lines.slice(linesBefore) };
  };
  const dispatchOnce = async (overrides = {}) => {
    const code = await h.run(overrides);
    assert.equal(code.code, 0);
    return { record: readRecord(h.dir, "T001") };
  };
  return { ...h, exitCodes, reconcileOnce, dispatchOnce };
}

function airlockCli(h, args) {
  const result = spawnSync(process.execPath, [airlockScript, ...args, "--json", "--plan", h.planPath], { cwd: h.root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("detectNonce is re-exported and strict; extractOutOfScope parses audit errors", () => {
  assert.deepEqual(detectNonce("AIRLOCK-RESULT abc-123 ok changed src/alpha.js", "abc-123"), { verdict: "ok", summary: "changed src/alpha.js" });
  assert.equal(detectNonce("AIRLOCK-RESULT abc-123 ok|blocked <one-line summary>", "abc-123"), null);
  assert.deepEqual(extractOutOfScope("IN SCOPE\n  src/alpha.js\nOUT OF SCOPE\n  forbidden.txt\n  also-bad.txt"), ["forbidden.txt", "also-bad.txt"]);
  assert.equal(extractOutOfScope("some other failure"), null);
});

test("row: nonce ok + changes completes only after confirmation, then audits and commits", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "module.exports = 1;\n");
  h.herdr._spawnOutput(record.paneId, `worker prose\nAIRLOCK-RESULT ${record.nonce} ok changed src/alpha.js and tests pass\n`);
  const { printed } = await h.reconcileOnce({ uiResponses: { confirm: true, input: "test -f src/alpha.js: ok" } });
  assert.ok(printed.join("\n").includes("AIRLOCK-RESULT"), "bounded pane output is shown to the human");
  assert.equal(readRecord(h.dir, "T001").settledAs, "done");
  const task = h.airlock.status().value.plan.tasks.find((entry) => entry.id === "T001");
  assert.equal(task.status, "done");
  assert.deepEqual(task.evidence, ["test -f src/alpha.js: ok"]);
  assert.ok(!h.herdr.state.panes.has(record.paneId), "the idle plugin-owned pane is closed after the terminal state");
  assert.match(printed.join("\n"), /DONE T001 [0-9a-f]{40}/);
});

test("row variant: without confirmation done is never called", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "module.exports = 1;\n");
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} ok all good\n`);
  await h.reconcileOnce();
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
  assert.equal(readJsonl(h.dir).some((entry) => entry.op === "airlock-done"), false, "no path calls done without human confirmation input");
});

test("row: nonce ok without changes is surfaced as suspicious, never auto-done", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} ok read-only check passed\n`);
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /SUSPICIOUS T001/);
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
});

test("row: nonce blocked runs airlock block with the sanitized summary and preserves the pane", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} blocked missing API credentials\n`);
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /WORKER REPORTED BLOCKED T001/);
  assert.equal(taskStatus(h.airlock, "T001"), "blocked");
  assert.equal(readRecord(h.dir, "T001").settledAs, "blocked");
  assert.ok(h.herdr.state.panes.has(record.paneId), "the pane and worktree are preserved");
});

test("row: no nonce, settled pane, changes present completes through confirmation", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "module.exports = 2;\n");
  h.herdr.state.panes.get(record.paneId).foreground = [{ name: "bash", argv: ["/bin/bash"] }];
  h.herdr.state.panes.get(record.paneId).reportedStatus = "unknown";
  h.herdr.state.agents.delete(record.agentName);
  await h.reconcileOnce({ uiResponses: { confirm: true, input: "test -f src/alpha.js: ok" } });
  assert.equal(readRecord(h.dir, "T001").settledAs, "done");
});

test("row: no nonce, no changes offers one prompt retry or block — never a fallback suggestion", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  h.herdr.state.panes.get(record.paneId).foreground = [{ name: "bash", argv: ["/bin/bash"] }];
  const { printed } = await h.reconcileOnce();
  const text = printed.join("\n");
  assert.match(text, /NO RESULT T001/);
  assert.ok(!text.includes("airlock fallback"), "the fallback-suggestion command line is deleted — the verb no longer exists");
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
});

test("row variant: a retry re-delivers the same prompt once with the same nonce", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  h.herdr.state.panes.get(record.paneId).foreground = [{ name: "bash", argv: ["/bin/bash"] }];
  const promptsBefore = h.herdr.calls.filter((call) => call.method === "agentPrompt").length;
  const { printed } = await h.reconcileOnce({ uiResponses: { confirm: (question) => question.includes("Retry") } });
  assert.match(printed.join("\n"), /RETRIED T001/);
  const prompts = h.herdr.calls.filter((call) => call.method === "agentPrompt");
  assert.equal(prompts.length, promptsBefore + 1);
  assert.ok(prompts.at(-1).args.prompt.includes(`AIRLOCK-RESULT ${record.nonce}`));
  assert.equal(readRecord(h.dir, "T001").promptRetryCount, 1);
});

test("a live executor foreground process means the worker is still running; nothing settles", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "work in progress\n");
  h.herdr.state.panes.get(record.paneId).foreground = [{ name: "opencode", argv: ["/usr/bin/opencode"], cmdline: "/usr/bin/opencode --agent x" }];
  h.herdr._setAgent(record.agentName, "working");
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /still running/);
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
});

test("row: a herdr blocked prompt is printed and never answered", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  h.herdr._setAgent(record.agentName, "blocked");
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /BLOCKED PROMPT T001/);
  assert.match(printed.join("\n"), /never answers it/);
  const promptCalls = h.herdr.calls.filter((call) => call.method === "agentPrompt").length;
  assert.equal(promptCalls, 1, "only the original dispatch prompt; the router never sends input to a blocked worker");
});

test("needs-you parks the record in flight with parkedForHuman and leaves the pane open", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  const ask = airlockCli(h, ["ask", "T001", "Which key do we sign with?", "--options", "prod|staging", "--blocking", "--case", "access"]);
  assert.equal(ask.status, 0, ask.stdout + ask.stderr);
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /PARKED T001 on D1; answer it, then re-run reconcile/);
  const parked = readRecord(h.dir, "T001");
  assert.equal(parked.state, "needs-reconcile", "a pause, not a settlement: the record stays in flight");
  assert.equal(parked.parkedForHuman, "D1");
  assert.ok(h.herdr.state.panes.has(record.paneId), "the pane is left untouched — the worker may be mid-run");
  // After the answer the task is todo and the superseded row settles the record.
  const answer = airlockCli(h, ["answer", "D1", "prod"]);
  assert.equal(answer.status, 0, answer.stdout + answer.stderr);
  const { printed: second } = await h.reconcileOnce();
  assert.match(second.join("\n"), /SUPERSEDED T001/);
  assert.equal(readRecord(h.dir, "T001").settledAs, "superseded");
  assert.ok(!h.herdr.state.panes.has(record.paneId), "the idle pane is closed on settle");
});

test("superseded (rework shape): an answered assume-decision reopens the task and the record settles", async (t) => {
  const h = await harness(t);
  const ask = airlockCli(h, ["ask", "T001", "Which serializer?", "--options", "json|yaml", "--assume", "json"]);
  assert.equal(ask.status, 0, ask.stdout + ask.stderr);
  const { record } = await h.dispatchOnce();
  const answer = airlockCli(h, ["answer", "D1", "yaml"]);
  assert.equal(answer.status, 1, "rework answers exit 1 with REWORK REQUIRED");
  assert.match(JSON.parse(answer.stdout).error, /REWORK REQUIRED: T001/);
  const planTask = h.airlock.status().value.plan.tasks.find((entry) => entry.id === "T001");
  assert.equal(planTask.status, "todo");
  assert.equal(planTask.startedAt, null, "rework sets startedAt: null");
  assert.match(planTask.note, /reopened after D1/);
  const { printed, result } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /SUPERSEDED T001/);
  assert.equal(result.settled, 1);
  assert.equal(readRecord(h.dir, "T001").settledAs, "superseded");
  assert.ok(!h.herdr.state.panes.has(record.paneId));
});

test("superseded refusals: a dirty worktree or a working agent reports and waits (never a wedge, never a close)", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  const plan = JSON.parse(readFileSync(h.planPath, "utf8"));
  plan.tasks[0].status = "todo";
  plan.tasks[0].startedAt = null;
  writeFileSync(h.planPath, `${JSON.stringify(plan, null, 2)}\n`);
  h.herdr._setAgent(record.agentName, "working");
  const first = await h.reconcileOnce();
  assert.match(first.printed.join("\n"), /SUPERSEDED T001 is pending: the pane's agent is working/);
  assert.ok(h.herdr.state.panes.has(record.paneId), "nothing is closed while the agent works");
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
  h.herdr._setAgent(record.agentName, "idle");
  await writeFile(path.join(h.root, "src", "alpha.js"), "unsaved work\n");
  const second = await h.reconcileOnce();
  assert.match(second.printed.join("\n"), /SUPERSEDED T001 is pending: the worktree is dirty \(src\/alpha.js\)/);
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
  spawnSync("git", ["-C", h.root, "checkout", "--", "src/alpha.js"], { encoding: "utf8" });
  spawnSync("rm", ["-f", path.join(h.root, "src", "alpha.js")], { encoding: "utf8" });
  const third = await h.reconcileOnce();
  assert.match(third.printed.join("\n"), /SUPERSEDED T001 ·/);
  assert.equal(readRecord(h.dir, "T001").settledAs, "superseded");
});

test("launch-pending row: reconcile resumes the same recorded candidate, never a further advance", async (t) => {
  const h = await harness(t);
  await h.dispatchOnce();
  const record = readRecord(h.dir, "T001");
  record.state = "launch-pending";
  record.attempt = 2;
  record.agentName = "al-t001-a2";
  record.paneId = null;
  record.workspaceId = null;
  record.promptAttemptedAt = null;
  record.pin.candidateIndex = 1;
  record.pin.advanceCount = 1;
  writeRecord(h.dir, record, { op: "record-state", outcome: "launch-pending", detail: "test: crash after advance" });
  const { printed } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /RESUMING T001 · launch-pending attempt 2 · candidate 2\/3/);
  const resumed = readRecord(h.dir, "T001");
  assert.equal(resumed.attempt, 2);
  assert.equal(resumed.pin.candidateIndex, 1, "same candidate");
  assert.equal(resumed.pin.advanceCount, 1, "never a further advance from a crash loop");
  assert.equal(resumed.state, "needs-reconcile");
});

test("externally settled: done/blocked sync the record but close only exited/idle plugin panes", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "half done\n");
  assert.ok(h.airlock.block("T001", "human acted directly").ok);
  h.herdr._setAgent(record.agentName, "working");
  const first = await h.reconcileOnce();
  assert.match(first.printed.join("\n"), /PANE LEFT OPEN .* its agent is working/);
  assert.equal(readRecord(h.dir, "T001").settledAs, "blocked", "the settle proceeds; the pane is reported");
  assert.ok(h.herdr.state.panes.has(record.paneId), "a live working pane is never closed");
});

test("externally settled with an idle agent closes the plugin-owned pane", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "half done\n");
  assert.ok(h.airlock.block("T001", "human acted directly").ok);
  await h.reconcileOnce();
  assert.equal(readRecord(h.dir, "T001").settledAs, "blocked");
  assert.ok(!h.herdr.state.panes.has(record.paneId));
});

test("row: an audit failure blocks with the out-of-scope paths and never reverts", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  await writeFile(path.join(h.root, "src", "alpha.js"), "module.exports = 1;\n");
  await writeFile(path.join(h.root, "forbidden.txt"), "out of scope\n");
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} ok done\n`);
  const { printed } = await h.reconcileOnce({ uiResponses: { confirm: true, input: "test -f src/alpha.js: ok" } });
  const text = printed.join("\n");
  assert.match(text, /AUDIT FAILED T001/);
  assert.equal(readRecord(h.dir, "T001").settledAs, "blocked");
  const task = h.airlock.status().value.plan.tasks.find((entry) => entry.id === "T001");
  assert.equal(task.status, "blocked");
  assert.match(task.note, /refs\/airlock\/blocked\//);
  assert.ok(!text.includes("--revert-out-of-scope"));
  assert.ok(h.herdr.state.panes.has(record.paneId), "the pane is preserved");
});

test("orphan row without class-E proof: report, keep doing, human resume re-delivers the retained brief", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  const pane = h.herdr.state.panes.get(record.paneId);
  h.herdr.state.panes.delete(record.paneId);
  h.herdr.state.workspaces.delete(pane.workspace_id);
  h.herdr.state.agents.delete(record.agentName);
  const first = await h.reconcileOnce();
  assert.match(first.printed.join("\n"), /ORPHANED T001/);
  assert.equal(taskStatus(h.airlock, "T001"), "doing");
  assert.equal(readRecord(h.dir, "T001").state, "needs-reconcile");
  const second = await h.reconcileOnce({ uiResponses: { confirm: (question) => question.includes("Resume") } });
  assert.match(second.printed.join("\n"), /RESUMED T001/);
  const resumed = readRecord(h.dir, "T001");
  assert.equal(resumed.attempt, record.attempt, "resume reuses the same attempt and candidate");
  assert.equal(resumed.taskText, record.taskText, "the retained task brief is reused verbatim");
  assert.equal(resumed.nonce, record.nonce);
  assert.notEqual(resumed.paneId, record.paneId, "a fresh pane");
  const startOps = readJsonl(h.dir).filter((entry) => entry.op === "airlock-start");
  assert.ok(startOps.length >= 2, "re-start is legal for a doing task");
});

test("a stale offered record is removed when the task is still todo", async (t) => {
  const h = await harness(t);
  const key = h.dir.split(path.sep).at(-1);
  const offered = createRecord({ workflowKey: key, repoRoot: h.root, planPath: h.planPath, sessionName: "test-session", taskId: "T001", executor: "opencode", agent: "airlock-builder", pin: { candidates: [], candidateIndex: 0, advanceCount: 0, failures: [] }, taskText: "TASK T001", dispatchPath: "A-interactive" });
  writeRecord(h.dir, offered, { op: "record-create" });
  await h.reconcileOnce();
  assert.equal(existsSync(path.join(h.dir, "tasks", "T001.json")), false);
});

test("a record whose task vanished from the plan is marked failed", async (t) => {
  const h = await harness(t);
  await h.dispatchOnce();
  const original = JSON.parse(readFileSync(h.planPath, "utf8"));
  writeFileSync(h.planPath, `${JSON.stringify({ ...original, tasks: [] }, null, 2)}\n`);
  await h.reconcileOnce();
  assert.equal(readRecord(h.dir, "T001").state, "failed");
});

test("--task limits reconciliation to one record", async (t) => {
  const h = await harness(t);
  await h.dispatchOnce();
  const { printed } = await h.reconcileOnce({ task: "T999" });
  assert.match(printed.join("\n"), /NO RECORD T999/);
});

test("reconcile under a held workflow lock exits 69 without reading records", async (t) => {
  const h = await harness(t);
  await h.dispatchOnce();
  const os = await import("node:os");
  const lock = acquireWorkflowLock(h.dir, { pid: process.pid, hostname: os.hostname() });
  const { result, printed } = await h.reconcileOnce();
  assert.equal(result.code, 69);
  assert.match(printed.join("\n"), /LOCKED by pid/);
  lock.release();
});

test("a recordVersion 1 record is reported and left untouched", async (t) => {
  const h = await harness(t);
  const legacy = createRecord({ workflowKey: "k", repoRoot: h.root, planPath: h.planPath, sessionName: "s", taskId: "T001", executor: "opencode", agent: "airlock-builder", pin: null, taskText: "x", dispatchPath: "B-headless", state: "needs-reconcile" });
  legacy.recordVersion = 1;
  writeRecord(h.dir, legacy, { op: "record-create" });
  const { printed, result } = await h.reconcileOnce();
  assert.match(printed.join("\n"), /LEGACY RECORD T001 \(recordVersion 1\)/);
  assert.equal(result.unresolved, 1);
  assert.equal(readRecord(h.dir, "T001").recordVersion, 1, "never migrated");
});

test("status rows carry executor and chain position and use the strict nonce parse", async (t) => {
  const h = await harness(t);
  const { record } = await h.dispatchOnce();
  // Only the echoed REPORT instruction is visible: strict parse says not seen.
  h.herdr._spawnOutput(record.paneId, `REPORT End your reply with exactly one line: AIRLOCK-RESULT ${record.nonce} ok|blocked <one-line summary>\n`);
  const before = await collectRows({ session: "test-session", repoRoot: h.root, planPath: h.planPath, stateDir: h.stateDir, herdr: h.herdr });
  assert.deepEqual(before, [`T001 · attempt 1 · needs-reconcile · opencode · candidate 1/3 · pane idle · nonce not seen`]);
  h.herdr._spawnOutput(record.paneId, `AIRLOCK-RESULT ${record.nonce} ok done for real\n`);
  const after = await collectRows({ session: "test-session", repoRoot: h.root, planPath: h.planPath, stateDir: h.stateDir, herdr: h.herdr });
  assert.match(after[0], /nonce seen$/);
  assert.equal(nonceSeenIn(`AIRLOCK-RESULT ${record.nonce}`, record.nonce), false, "a bare substring is not a result");
  const rendered = renderStatus({ airlockText: "GOAL  test", rows: after });
  assert.match(rendered, /HERDR ROUTER/);
});

test("watch re-renders on a bounded interval and stops on abort", async (t) => {
  const h = await harness(t);
  await h.dispatchOnce();
  const controller = new AbortController();
  const renders = h.capture.lines.length;
  const timer = setTimeout(() => controller.abort(), 60);
  const result = await watch({ session: "test-session", repoRoot: h.root, planPath: h.planPath, stateDir: h.stateDir, airlock: h.airlock, herdr: h.herdr, out: h.capture.out, exit: () => {}, intervalMs: 20, signal: controller.signal });
  clearTimeout(timer);
  assert.equal(result.code, 0);
  assert.ok(h.capture.lines.length > renders, "watch rendered at least one frame");
});
