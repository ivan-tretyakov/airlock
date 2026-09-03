import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireWorkflowLock, LockError, LOCK_STALE_MS } from "../src/lock.mjs";
import { advanceCandidate, agentNameFor, createRecord, deleteRecord, detectNonce, inFlightRecords, listRecords, logOperation, productChanges, readRecord, skipCandidate, workflowDir, workflowKey, writeRecord, RECORD_VERSION } from "../src/state.mjs";
import { assert } from "./helpers.mjs";

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function samplePin(overrides = {}) {
  return {
    role: "builder",
    tier: "default",
    window: "default",
    resolvedAt: "2026-09-01T07:00:00.000Z",
    candidates: [
      { executor: "opencode", model: "a/one", effort: null },
      { executor: "opencode", model: "a/two", effort: "max" },
      { executor: "claude", model: "opus", effort: "high" },
    ],
    candidateIndex: 0,
    advanceCount: 0,
    failures: [],
    ...overrides,
  };
}

function sampleRecord(overrides = {}) {
  return createRecord({
    workflowKey: "key123",
    repoRoot: "/repo",
    planPath: "/repo/airlock.plan.json",
    sessionName: "session",
    taskId: "T001",
    executor: "opencode",
    agent: "airlock-builder",
    pin: samplePin(),
    taskText: "TASK T001",
    dispatchPath: "A-interactive",
    ...overrides,
  });
}

function sampleFailure(fromAttempt) {
  return { at: "2026-09-01T07:01:00.000Z", candidate: { executor: "opencode", model: "a/one", effort: null }, class: "executor-start", code: "launch_rejected", detail: "kind rejected", fromAttempt };
}

test("workflowKey derives from repoRoot + newline + planPath, first 16 hex of sha256", () => {
  const expected = createHash("sha256").update("/repo\n/repo/airlock.plan.json").digest("hex").slice(0, 16);
  assert.equal(workflowKey("/repo", "/repo/airlock.plan.json"), expected);
  assert.equal(workflowDir("/state", "my session", "abc"), path.join("/state", "my-session", "abc"));
});

test("recordVersion 2 records carry executor, pin, promptAttemptedAt, parkedForHuman", () => {
  const record = sampleRecord();
  assert.equal(record.recordVersion, 2);
  assert.equal(RECORD_VERSION, 2);
  assert.equal(record.executor, "opencode");
  assert.equal(record.agent, "airlock-builder");
  assert.equal(record.agentName, "al-t001-a1");
  assert.equal(record.pin.advanceCount, 0);
  assert.equal(record.promptAttemptedAt, null, "null proves no prompt can have been sent");
  assert.equal(record.parkedForHuman, null);
  assert.equal(record.state, "offered");
  assert.equal("host" in record, false, "executor replaces host");
  assert.equal("route" in record, false, "pin replaces route");
});

test("record writes are atomic and unknown states (incl. missing launch-pending typo) are rejected", async (t) => {
  const dir = await tempDir(t);
  const record = writeRecord(dir, sampleRecord(), { op: "record-create" });
  const file = path.join(dir, "tasks", "T001.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), record);
  assert.deepEqual(readdirSync(path.join(dir, "tasks")).filter((name) => name.endsWith(".tmp")), []);
  const bad = sampleRecord();
  bad.state = "floating";
  assert.throws(() => writeRecord(dir, bad), /unknown record state/);
  const pending = sampleRecord({ state: "launch-pending" });
  assert.equal(writeRecord(dir, pending).state, "launch-pending");
});

test("inFlightRecords includes launch-pending and excludes offered/settled/failed", () => {
  const states = ["offered", "started", "pane-created", "agent-started", "prompted", "launch-pending", "needs-reconcile", "settled", "failed"];
  const records = states.map((state, index) => ({ taskId: `T${index}`, attempt: 1, state }));
  assert.deepEqual(inFlightRecords(records).map((record) => record.state), ["started", "pane-created", "agent-started", "prompted", "launch-pending", "needs-reconcile"]);
});

test("advanceCandidate: one atomic write moves candidateIndex, consumes the budget, and persists launch-pending", async (t) => {
  const dir = await tempDir(t);
  const prior = writeRecord(dir, sampleRecord({ state: "pane-created" }), { op: "record-create" });
  const next = advanceCandidate(dir, prior, { failure: sampleFailure(1), expectedCandidateIndex: 0, consumeBudget: true });
  assert.equal(next.attempt, 2);
  assert.equal(next.state, "launch-pending");
  assert.equal(next.agentName, "al-t001-a2");
  assert.notEqual(next.nonce, prior.nonce);
  assert.equal(next.pin.candidateIndex, 1);
  assert.equal(next.pin.advanceCount, 1);
  assert.equal(next.executor, "opencode");
  assert.equal(next.promptAttemptedAt, null);
  assert.deepEqual(next.pin.failures.at(-1).candidate.model, "a/one");
  const onDisk = readRecord(dir, "T001");
  assert.equal(onDisk.attempt, 2);
  const advanceOp = readFileSync(path.join(dir, "operations.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)).find((entry) => entry.op === "record-advance");
  assert.deepEqual(JSON.parse(advanceOp.detail), prior, "the prior record content is preserved in operations.jsonl");
});

test("advance idempotency: an interleaved second runner aborts without advancing", async (t) => {
  const dir = await tempDir(t);
  const prior = writeRecord(dir, sampleRecord({ state: "pane-created" }), { op: "record-create" });
  // Another runner advanced first: the on-disk candidateIndex no longer matches.
  advanceCandidate(dir, prior, { failure: sampleFailure(1), expectedCandidateIndex: 0, consumeBudget: true });
  assert.throws(() => advanceCandidate(dir, prior, { failure: sampleFailure(1), expectedCandidateIndex: 0, consumeBudget: true }), /another runner already advanced/);
  assert.equal(readRecord(dir, "T001").pin.advanceCount, 1, "exactly one advance persisted");
});

test("advance idempotency: a second budget-consuming advance from the same attempt is refused", async (t) => {
  const dir = await tempDir(t);
  const record = sampleRecord({ state: "pane-created" });
  record.pin.failures.push(sampleFailure(1));
  record.pin.candidateIndex = 1;
  writeRecord(dir, record, { op: "record-create" });
  assert.throws(() => advanceCandidate(dir, record, { failure: sampleFailure(1), expectedCandidateIndex: 1, consumeBudget: true }), /already consumed an advance/);
});

test("skipCandidate moves candidateIndex, records the failure, and leaves advanceCount at 0", async (t) => {
  const dir = await tempDir(t);
  const record = writeRecord(dir, sampleRecord({ state: "started" }), { op: "record-create" });
  const skipped = skipCandidate(dir, record, { failure: { at: "t", candidate: record.pin.candidates[0], class: "executor-missing", code: "binary_absent", detail: "opencode is not on PATH", fromAttempt: null } });
  assert.equal(skipped.pin.candidateIndex, 1);
  assert.equal(skipped.pin.advanceCount, 0, "a pre-start skip is budget-free");
  assert.equal(skipped.pin.failures[0].fromAttempt, null);
  assert.equal(skipped.attempt, 1, "a skip stays within the current attempt (nothing launched)");
  assert.equal(readRecord(dir, "T001").pin.candidateIndex, 1);
});

test("detectNonce is a strict whole-line parse: the typed REPORT instruction never matches", () => {
  const echoed = "REPORT End your reply with exactly one line: AIRLOCK-RESULT abc-123 ok|blocked <one-line summary>";
  assert.equal(detectNonce(echoed, "abc-123"), null, "the Path A typed prompt always contains the raw nonce string; a .includes would match it");
  assert.equal(detectNonce("AIRLOCK-RESULT abc-123 ok|blocked <one-line summary>", "abc-123"), null);
  assert.equal(detectNonce("prefix AIRLOCK-RESULT abc-123 ok did things", "abc-123"), null, "anchored to the line start");
  assert.deepEqual(detectNonce("prose\nAIRLOCK-RESULT abc-123 ok changed src/alpha.js", "abc-123"), { verdict: "ok", summary: "changed src/alpha.js" });
  assert.deepEqual(detectNonce("AIRLOCK-RESULT abc-123 blocked need credentials", "abc-123"), { verdict: "blocked", summary: "need credentials" });
  assert.equal(detectNonce("AIRLOCK-RESULT other ok fine", "abc-123"), null);
});

test("deleteRecord preserves the prior content in operations.jsonl", async (t) => {
  const dir = await tempDir(t);
  const record = writeRecord(dir, sampleRecord());
  deleteRecord(dir, record, { detail: "test cleanup" });
  assert.equal(existsSync(path.join(dir, "tasks", "T001.json")), false);
  const deletion = readFileSync(path.join(dir, "operations.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)).at(-1);
  assert.equal(deletion.op, "record-delete");
  assert.deepEqual(JSON.parse(deletion.detail).record, record);
});

test("productChanges filters the plan file and .airlock paths and parses porcelain -z", () => {
  const porcelain = [" M src/alpha.js", "?? docs/notes.md", " M airlock.plan.json", "?? .airlock/cache/x", "?? .opencode/agent/airlock-builder.md", "?? .opencode/command/airlock.md", "R  new-name\0old-name", ""].join("\0");
  const changes = productChanges("/repo", "/repo/airlock.plan.json", porcelain);
  assert.deepEqual(changes, [
    { status: " M", path: "src/alpha.js" },
    { status: "??", path: "docs/notes.md" },
    { status: "R ", path: "new-name" },
    { status: "R ", path: "old-name" },
  ]);
});

test("agentNameFor lowercases the task id and encodes the attempt", () => {
  assert.equal(agentNameFor("T001", 1), "al-t001-a1");
  assert.equal(agentNameFor("H12", 3), "al-h12-a3");
});

test("workflow lock: O_EXCL create, contention message, release", async (t) => {
  const dir = await tempDir(t);
  const lock = acquireWorkflowLock(dir, { pid: 1111, hostname: "host-a", isAlive: () => true });
  const held = JSON.parse(readFileSync(path.join(dir, "lock"), "utf8"));
  assert.equal(held.pid, 1111);
  assert.equal(held.hostname, "host-a");
  assert.ok(held.acquiredAt);
  assert.throws(
    () => acquireWorkflowLock(dir, { pid: 2222, hostname: "host-a", isAlive: () => true }),
    (error) => error instanceof LockError && new RegExp(`^LOCKED by pid 1111 since ${held.acquiredAt}; re-run when it finishes$`).test(error.message),
  );
  lock.release();
  assert.equal(existsSync(path.join(dir, "lock")), false);
  const relock = acquireWorkflowLock(dir, { pid: 2222, hostname: "host-a", isAlive: () => true });
  relock.release();
});

test("workflow lock: stale takeover by dead pid on the same hostname, logged, single winner", async (t) => {
  const dir = await tempDir(t);
  acquireWorkflowLock(dir, { pid: 999999, hostname: "host-a", isAlive: () => true });
  const winner = acquireWorkflowLock(dir, { pid: 42, hostname: "host-a", isAlive: (pid) => pid !== 999999 });
  assert.equal(JSON.parse(readFileSync(path.join(dir, "lock"), "utf8")).pid, 42);
  const ops = readFileSync(path.join(dir, "operations.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(ops.some((entry) => entry.op === "lock-takeover"));
  // The loser of a takeover race sees a live lock and exits with contention.
  assert.throws(() => acquireWorkflowLock(dir, { pid: 43, hostname: "host-a", isAlive: (pid) => pid === 42 }), LockError);
  winner.release();
});

test("workflow lock: a dead pid on a different hostname is not takeover grounds, but age is", async (t) => {
  const dir = await tempDir(t);
  acquireWorkflowLock(dir, { pid: 999999, hostname: "host-b", isAlive: () => false, now: () => new Date("2026-09-01T07:00:00Z") });
  assert.throws(
    () => acquireWorkflowLock(dir, { pid: 42, hostname: "host-a", isAlive: () => false, now: () => new Date("2026-09-01T07:10:00Z") }),
    LockError,
    "10 minutes old on another host: not stale",
  );
  const aged = acquireWorkflowLock(dir, { pid: 42, hostname: "host-a", isAlive: () => false, now: () => new Date(Date.parse("2026-09-01T07:00:00Z") + LOCK_STALE_MS + 1) });
  assert.equal(JSON.parse(readFileSync(path.join(dir, "lock"), "utf8")).pid, 42);
  aged.release();
});

test("workflow lock: an unreadable lock file is treated as stale", async (t) => {
  const dir = await tempDir(t);
  writeFileSync(path.join(dir, "lock"), "not json");
  const lock = acquireWorkflowLock(dir, { pid: 7, hostname: "h", isAlive: () => true });
  assert.equal(JSON.parse(readFileSync(path.join(dir, "lock"), "utf8")).pid, 7);
  lock.release();
});
