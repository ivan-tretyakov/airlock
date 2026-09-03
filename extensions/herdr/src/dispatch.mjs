import { existsSync } from "node:fs";
import path from "node:path";
import { acquireWorkflowLock, LockError } from "./lock.mjs";
import { PLUGIN_ID, PreflightError, SUBSTRATE_CODES } from "./herdr-client.mjs";
import { MAX_FALLBACK_ADVANCES, RoutingError, loadRouting, resolveChain, routerNow } from "./routes.mjs";
import { createExecutorProbes, dispatchPathFor, isApprovedProcess, launchArgs, pathBCommand, preflightCandidate } from "./executors.mjs";
import { evaluateSuperseded } from "./supersede.mjs";
import {
  RECORD_VERSION,
  advanceCandidate,
  createRecord,
  deleteRecord,
  detectNonce,
  gitStatus,
  inFlightRecords,
  listRecords,
  logOperation,
  productChanges,
  readRecord,
  skipCandidate,
  workflowDir,
  workflowKey,
  writePromptFile,
  writeRecord,
} from "./state.mjs";

export const DEFAULT_TIMEOUT_MS = 900_000;
export const THREE_X_MESSAGE = "this router requires Airlock 4.0 or newer; upgrade Airlock (no 3.x-compatible router was ever released)";

export function resolvePlanPath(repoRoot, planPath) {
  if (planPath) return path.resolve(planPath);
  const root = path.resolve(repoRoot);
  const candidates = [path.join(root, "airlock.plan.json"), path.join(root, "docs", "airlock", "airlock.plan.json")].filter((candidate) => existsSync(candidate));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new Error(`no airlock.plan.json found under ${root}; pass --plan <absolute path>`);
  throw new Error(`multiple plans found under ${root}; pass --plan <absolute path>`);
}

export function reportLine(nonce) {
  return `REPORT End your reply with exactly one line: AIRLOCK-RESULT ${nonce} ok|blocked <one-line summary>`;
}

export function buildPrompt(taskText, nonce) {
  return `${taskText}\n${reportLine(nonce)}`;
}

export function roleFromAgent(agent) {
  return String(agent ?? "").replace(/^airlock-/, "");
}

function failureEntry(candidate, { class: failureClass, code, detail, remedy }, fromAttempt) {
  return {
    at: new Date().toISOString(),
    candidate: { executor: candidate.executor, model: candidate.model, effort: candidate.effort ?? null },
    class: failureClass,
    code,
    detail: remedy ? `${detail}; remedy: ${remedy}` : detail,
    fromAttempt,
  };
}

// Every step transition is persisted before the step runs, so an unexpected exception
// still leaves a reconcilable record: mark it and exit 70 (EX_SOFTWARE).
export async function guardedLaunch(deps, record) {
  const { dir, out, finish } = deps;
  try {
    return await runLaunchLoop(deps, record);
  } catch (error) {
    const onDisk = readRecord(dir, record.taskId) ?? record;
    if (onDisk.state !== "settled") {
      onDisk.state = "needs-reconcile";
      onDisk.lastError = String(error.message);
      writeRecord(dir, onDisk, { op: "record-state", outcome: "needs-reconcile", detail: `dispatch interrupted: ${error.message}` });
    }
    out(`DISPATCH INTERRUPTED: ${error.message}`);
    out(`RECONCILE ${record.taskId}`);
    return finish(70);
  }
}

function noticePrinter(out) {
  const seen = new Set();
  return (result) => {
    for (const notice of result?.notices ?? []) {
      if (seen.has(notice)) continue;
      seen.add(notice);
      out(notice);
    }
  };
}

// Steps 7–10 of the dispatch algorithm plus the class-E advance loop. Shared with
// reconcile's launch-pending and orphan-advance rows: `airlock start` is never re-run
// here (a `doing` task needs no re-start for a fresh pane; the retained taskText is reused).
export async function runLaunchLoop(deps, initialRecord) {
  const { dir, root, planPath, session, timeoutMs, airlock, herdr, probes, out, finish } = deps;
  let record = initialRecord;
  const role = roleFromAgent(record.agent);

  const substrate = (detail) => {
    record.state = "needs-reconcile";
    record.lastError = detail;
    writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail });
    out(`HERDR UNAVAILABLE ${detail} (retryable; the chain was not advanced)`);
    return finish(69);
  };

  const reconcileHandoff = (detail, { announce = null } = {}) => {
    record.state = "needs-reconcile";
    record.lastError = detail === "wait finished" ? record.lastError : detail;
    writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail });
    if (announce) out(announce);
    out(`RECONCILE ${record.taskId}`);
    return finish(0);
  };

  const exhaust = async (failure) => {
    record.pin = { ...record.pin, failures: [...(record.pin.failures ?? []), failure] };
    writeRecord(dir, record, { op: "record-state", outcome: record.state, detail: "chain exhausted" });
    const summary = record.pin.failures.map((entry) => `${entry.candidate.executor} ${entry.candidate.model}: ${entry.code}`).join("; ");
    const blocked = airlock.block(record.taskId, `route chain exhausted: ${summary}`);
    logOperation(dir, { op: "airlock-block", taskId: record.taskId, attempt: record.attempt, outcome: blocked.ok ? "ok" : `error:${blocked.exitCode}`, detail: "route chain exhausted" });
    if (!blocked.ok) {
      out(`AIRLOCK ERROR: ${blocked.error}`);
      record.state = "needs-reconcile";
      record.lastError = `route chain exhausted but airlock block failed: ${blocked.error}`;
      writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile" });
      return finish(blocked.exitCode ?? 1);
    }
    out(blocked.value.text);
    record.state = "settled";
    record.settledAs = "blocked";
    record.settledAt = new Date().toISOString();
    writeRecord(dir, record, { op: "record-state", outcome: "settled:blocked", detail: "route chain exhausted; pane(s) preserved" });
    return finish(0);
  };

  // Class E: the only class that may advance the chain — the failure provably precedes
  // prompt delivery (promptAttemptedAt is still null on every path that reaches here).
  const classE = async ({ code, detail }) => {
    const candidate = record.pin.candidates[record.pin.candidateIndex];
    // Condition 2: no agent result — strict parse of a bounded pane read, and a clean
    // product worktree. Any evidence the worker produced something → never fall back.
    let resultSeen = false;
    if (record.paneId) {
      const read = await herdr.readPane(record.paneId);
      if (read.ok && detectNonce(read.text, record.nonce)) resultSeen = true;
    }
    let changes;
    try {
      changes = productChanges(root, planPath, gitStatus(root));
    } catch (error) {
      changes = [{ status: "!!", path: `<git status failed: ${error.message}>` }];
    }
    if (resultSeen || changes.length) {
      return { done: true, result: reconcileHandoff(detail, { announce: `NOT ADVANCING ${record.taskId}: ${resultSeen ? "a result line exists" : "the worktree has product changes"}; reconcile decides` }) };
    }
    if (record.paneId) {
      const closed = await herdr.closePane(record.paneId);
      logOperation(dir, { op: "herdr-close-pane", taskId: record.taskId, attempt: record.attempt, outcome: closed.ok ? "ok" : `error:${closed.code}`, detail: "class-E dead pane" });
    }
    const failure = failureEntry(candidate, { class: "executor-start", code, detail }, record.attempt);
    // Condition 3: a further candidate exists and the budget is not spent.
    if (record.pin.candidateIndex >= record.pin.candidates.length - 1 || record.pin.advanceCount >= MAX_FALLBACK_ADVANCES) {
      return { done: true, result: await exhaust(failure) };
    }
    let advanced;
    try {
      advanced = advanceCandidate(dir, record, { failure, expectedCandidateIndex: record.pin.candidateIndex, consumeBudget: true });
    } catch (error) {
      out(`ADVANCE ABORTED: ${error.message}`);
      return { done: true, result: finish(69) };
    }
    const next = advanced.pin.candidates[advanced.pin.candidateIndex];
    out(`FALLBACK ${record.taskId} · candidate ${advanced.pin.candidateIndex + 1}/${advanced.pin.candidates.length} · ${next.executor} ${next.model}`);
    return { done: false, record: advanced };
  };

  while (true) {
    let candidate = record.pin.candidates[record.pin.candidateIndex];
    const preflight = preflightCandidate(candidate, { role, repoRoot: root, probes });
    if (!preflight.ok) {
      const failure = failureEntry(candidate, preflight, null);
      out(`SKIPPED ${candidate.executor} ${candidate.model}: ${failure.detail}`);
      if (record.pin.candidateIndex >= record.pin.candidates.length - 1) {
        return await exhaust(failure);
      }
      skipCandidate(dir, record, { failure });
      continue;
    }
    candidate = record.pin.candidates[record.pin.candidateIndex];
    record.executor = candidate.executor;
    record.dispatchPath = dispatchPathFor(candidate);

    const pane = await herdr.createPane(session, record.agentName, root);
    logOperation(dir, { op: "herdr-create-pane", taskId: record.taskId, attempt: record.attempt, outcome: pane.ok ? "ok" : `error:${pane.code}`, detail: pane.ok ? `${pane.workspaceId} ${pane.paneId}` : String(pane.message) });
    if (!pane.ok) return substrate(`pane creation failed: ${pane.code}: ${pane.message}`);
    record.workspaceId = pane.workspaceId;
    record.paneId = pane.paneId;
    record.state = "pane-created";
    writeRecord(dir, record, { op: "record-state", outcome: "pane-created" });

    const prompt = buildPrompt(record.taskText, record.nonce);

    if (record.dispatchPath === "A-interactive") {
      const startedAgent = await herdr.agentStart({ name: record.agentName, kind: candidate.executor, paneId: record.paneId, agentArgs: launchArgs(candidate, role), timeoutMs: Math.min(timeoutMs, 300_000) });
      logOperation(dir, { op: "herdr-agent-start", taskId: record.taskId, attempt: record.attempt, outcome: startedAgent.ok ? "ok" : `error:${startedAgent.code}`, detail: startedAgent.ok ? candidate.executor : String(startedAgent.message) });
      if (!startedAgent.ok) {
        if (SUBSTRATE_CODES.includes(startedAgent.code)) return substrate(`agent start failed: ${startedAgent.code}: ${startedAgent.message}`);
        const outcome = await classE({ code: startedAgent.code ?? "launch_rejected", detail: `herdr agent start rejected the ${candidate.executor} launch: ${startedAgent.message ?? startedAgent.code}` });
        if (outcome.done) return outcome.result;
        record = outcome.record;
        continue;
      }
      const info = await herdr.processInfo(record.paneId);
      if (info.ok) {
        const { approved, observed } = isApprovedProcess({ process_info: info.processInfo }, preflight.approvedPaths);
        if (!approved) {
          const outcome = await classE({ code: "process_path_mismatch", detail: `pane foreground process ${observed ?? "<unknown>"} is not the approved ${candidate.executor} path` });
          if (outcome.done) return outcome.result;
          record = outcome.record;
          continue;
        }
      }
      // promptAttemptedAt is persisted before any submission call (Invariant 10): a null
      // value on a persisted record proves no prompt can have been sent.
      record.state = "agent-started";
      record.promptAttemptedAt = new Date().toISOString();
      writeRecord(dir, record, { op: "record-state", outcome: "agent-started", detail: "promptAttemptedAt persisted before submission" });

      const delivered = await herdr.agentPrompt({ name: record.agentName, prompt, timeoutMs });
      logOperation(dir, { op: "herdr-agent-prompt", taskId: record.taskId, attempt: record.attempt, outcome: delivered.ok ? (delivered.timedOut ? "timeout" : `ok:${delivered.state ?? delivered.code}`) : `error:${delivered.code}`, detail: delivered.ok ? null : String(delivered.message) });
      if (!delivered.delivered) {
        if (delivered.code === "agent_blocked") {
          return reconcileHandoff("agent already waiting at a permission/question prompt", { announce: `BLOCKED PROMPT ${record.taskId}: the agent is waiting at a permission/question prompt; the router never answers it` });
        }
        if (SUBSTRATE_CODES.includes(delivered.code)) return substrate(`prompt submission failed: ${delivered.code}: ${delivered.message}`);
        // The attempt marker is already persisted, so this is not provably pre-delivery:
        // never advance — reconcile decides (fail closed toward class P).
        return reconcileHandoff(`prompt delivery failed after the attempt marker: ${delivered.code}`, { announce: `PROMPT FAILED: ${delivered.message ?? delivered.code}` });
      }
      record.state = "prompted";
      record.promptDeliveredAt = new Date().toISOString();
      writeRecord(dir, record, { op: "record-state", outcome: "prompted" });
      return reconcileHandoff("wait finished; signals only schedule reconciliation");
    }

    // Path B (opencode with a non-null effort): the pane's interactive shell executes the
    // line, so every interpolated value is shell-quoted.
    const promptFile = writePromptFile(dir, record.taskId, record.attempt, prompt);
    logOperation(dir, { op: "prompt-write", taskId: record.taskId, attempt: record.attempt, outcome: "ok", detail: promptFile });
    record.state = "agent-started";
    record.promptAttemptedAt = new Date().toISOString();
    writeRecord(dir, record, { op: "record-state", outcome: "agent-started", detail: "promptAttemptedAt persisted before submission" });
    const command = pathBCommand({ role, model: candidate.model, effort: candidate.effort, promptFile });
    const result = await herdr.runInPane({ paneId: record.paneId, command, match: `AIRLOCK-RESULT ${record.nonce}`, timeoutMs });
    logOperation(dir, { op: "herdr-run-in-pane", taskId: record.taskId, attempt: record.attempt, outcome: result.ok ? (result.matched ? "matched" : result.timedOut ? "timeout" : "delivered") : `error:${result.code}`, detail: result.ok ? null : String(result.message) });
    if (!result.delivered) {
      if (SUBSTRATE_CODES.includes(result.code)) return substrate(`pane run failed: ${result.code}: ${result.message}`);
      return reconcileHandoff(`prompt delivery failed after the attempt marker: ${result.code}`, { announce: `PROMPT FAILED: ${result.message ?? result.code}` });
    }
    record.state = "prompted";
    record.promptDeliveredAt = new Date().toISOString();
    writeRecord(dir, record, { op: "record-state", outcome: "prompted" });
    return reconcileHandoff("wait finished; signals only schedule reconciliation");
  }
}

export async function dispatch({
  session,
  repoRoot,
  planPath = null,
  stateDir,
  configDir = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  airlock,
  herdr,
  probes = createExecutorProbes(),
  env = process.env,
  lockOptions = {},
  out = (line) => console.log(line),
  exit = () => {},
} = {}) {
  const plan = resolvePlanPath(repoRoot, planPath);
  const root = path.resolve(repoRoot);
  const key = workflowKey(root, plan);
  const dir = workflowDir(stateDir, session, key);
  const finish = (code) => {
    exit(code);
    return { code };
  };
  const printNotices = noticePrinter(out);

  let lock;
  try {
    lock = acquireWorkflowLock(dir, lockOptions);
  } catch (error) {
    if (error instanceof LockError) {
      out(error.message);
      return finish(69);
    }
    throw error;
  }
  try {
    return await run();
  } finally {
    lock.release();
  }

  async function run() {
    // Step 1: preflight (herdr V1/V2 incl. plugin config-dir), 4.0 detection, session.
    try {
      const preflightResult = await herdr.preflight();
      logOperation(dir, { op: "preflight", outcome: "ok", detail: `herdr ${preflightResult.version}` });
      await herdr.ensureSession(session);
      logOperation(dir, { op: "ensure-session", outcome: "ok", detail: session });
    } catch (error) {
      out(`PREFLIGHT FAILED: ${error.message}`);
      logOperation(dir, { op: "preflight", outcome: "failed", detail: String(error.message) });
      const substrateFailure = error instanceof PreflightError && error.code === "substrate";
      return finish(substrateFailure ? 69 : 78);
    }

    // 4.0 detection, fail closed on key presence: 3.x `status` always carries a `routes`
    // key (even the empty array); `status` is the probe because it is a pure read verb
    // in both versions — a 3.x `next` would write an offered pin as a side effect.
    const probeStatus = airlock.status();
    logOperation(dir, { op: "airlock-status", outcome: probeStatus.ok ? "ok" : `error:${probeStatus.exitCode}`, detail: probeStatus.ok ? "preflight probe" : String(probeStatus.error) });
    if (!probeStatus.ok) {
      out(`AIRLOCK ERROR: ${probeStatus.error}`);
      return finish(probeStatus.exitCode ?? 1);
    }
    printNotices(probeStatus);
    if ("routes" in probeStatus.value) {
      out(THREE_X_MESSAGE);
      return finish(78);
    }
    const taskStatuses = new Map(probeStatus.value.plan.tasks.map((task) => [task.id, task.status]));

    // In-flight records: legacy refusal, then the superseded row, then launch-pending resume.
    const records = listRecords(dir);
    const legacy = records.filter((record) => record.recordVersion !== RECORD_VERSION);
    if (legacy.length) {
      for (const record of legacy) out(`LEGACY RECORD ${record.taskId} (recordVersion ${record.recordVersion}): settle it by hand; the router does not migrate live state`);
      logOperation(dir, { op: "dispatch", outcome: "refused-legacy-record", detail: legacy.map((record) => record.taskId).join(",") });
      return finish(3);
    }
    let inFlight = inFlightRecords(records);
    const reopened = inFlight.filter((record) => taskStatuses.get(record.taskId) === "todo");
    if (reopened.length) {
      const snap = await herdr.snapshot();
      if (!snap.ok) {
        out(`HERDR UNAVAILABLE session snapshot failed: ${snap.code}: ${snap.message} (retryable; the chain was not advanced)`);
        return finish(69);
      }
      for (const record of reopened) {
        const outcome = await evaluateSuperseded({ dir, record, root, planPath: plan, herdr, snapshot: snap.snapshot, out });
        if (outcome === "settled") inFlight = inFlight.filter((entry) => entry !== record);
      }
    }
    const pending = inFlight.find((record) => record.state === "launch-pending" && taskStatuses.get(record.taskId) === "doing");
    if (pending) {
      out(`RESUMING ${pending.taskId} · launch-pending attempt ${pending.attempt} · candidate ${pending.pin.candidateIndex + 1}/${pending.pin.candidates.length}`);
      logOperation(dir, { op: "dispatch", taskId: pending.taskId, attempt: pending.attempt, outcome: "resume-launch-pending", detail: null });
      return await guardedLaunch({ dir, root, planPath: plan, session, timeoutMs, airlock, herdr, probes, out, finish }, pending);
    }
    if (inFlight.length) {
      for (const record of inFlight) out(`RECONCILE REQUIRED ${record.taskId}`);
      logOperation(dir, { op: "dispatch", outcome: "refused-in-flight", detail: inFlight.map((record) => `${record.taskId}:${record.state}`).join(",") });
      return finish(3);
    }

    // Step 2: next (no --host; unattended so a blocking decision parks with exit 2).
    const next = airlock.next({ unattended: true });
    logOperation(dir, { op: "airlock-next", outcome: next.ok ? "ok" : `error:${next.exitCode}`, detail: next.ok ? `task ${next.value.task}` : String(next.error) });
    if (!next.ok) {
      out(next.exitCode === 2 ? String(next.error) : `AIRLOCK ERROR: ${next.error}`);
      return finish(next.exitCode ?? 1);
    }
    printNotices(next);
    if ("route" in next.value) {
      // Belt-and-braces late 3.x check; the stray offered pin a 3.x next wrote expires
      // on its own five-minute TTL — nothing was dispatched.
      out(THREE_X_MESSAGE);
      return finish(78);
    }
    const { text, task, agent } = next.value;
    if (task === null) {
      logOperation(dir, { op: "next-nothing-to-do", outcome: "recorded", detail: String(text) });
      out(String(text));
      return finish(0);
    }

    // Step 3: tier from status (once per dispatch, after next and before start).
    const status = airlock.status();
    logOperation(dir, { op: "airlock-status", outcome: status.ok ? "ok" : `error:${status.exitCode}`, detail: status.ok ? null : String(status.error) });
    if (!status.ok) {
      out(`AIRLOCK ERROR: ${status.error}`);
      return finish(status.exitCode ?? 1);
    }
    printNotices(status);
    const role = roleFromAgent(agent);
    const tier = status.value.plan.tasks.find((entry) => entry.id === task)?.expensive === true ? "expensive" : "default";

    let pin;
    try {
      if (!configDir) throw new RoutingError(`no routing config directory: pass --config-dir <path>, or install the plugin so 'herdr plugin config-dir ${PLUGIN_ID}' resolves one`, "missing-file");
      const routing = loadRouting(configDir);
      pin = resolveChain(routing.bindings, role, tier, routerNow(env));
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      const message = error.code === "missing-binding"
        ? `no route for ${role}/${tier}; add bindings.${role}.${tier} to ${configDir}/routing.json, e.g. {"primary": {"executor": "opencode", "model": "<provider/model>", "effort": null}} — or import a 3.x config with: airlock-herdr import-routes --host <claude|opencode>`
        : error.message;
      out(message);
      logOperation(dir, { op: "route-resolution", taskId: task, outcome: "failed", detail: message });
      return finish(6);
    }

    // Step 4: per-candidate executor preflight in chain order — pre-start skips are
    // budget-free; if no candidate survives, `airlock start` was never called (exit 6).
    while (pin.candidateIndex < pin.candidates.length) {
      const candidate = pin.candidates[pin.candidateIndex];
      const preflight = preflightCandidate(candidate, { role, repoRoot: root, probes });
      if (preflight.ok) break;
      pin.failures.push(failureEntry(candidate, preflight, null));
      pin.candidateIndex += 1;
    }
    if (pin.candidateIndex >= pin.candidates.length) {
      out(`NO CANDIDATE SURVIVED preflight for ${role}/${tier}; the task stays todo:`);
      for (const entry of pin.failures) out(`  - ${entry.candidate.executor} ${entry.candidate.model}: ${entry.detail}`);
      logOperation(dir, { op: "route-resolution", taskId: task, outcome: "no-candidate-survived", detail: JSON.stringify(pin.failures) });
      return finish(6);
    }

    // Step 5: persist the record (offered) — chain resolved once, at dispatch time.
    const record = createRecord({
      workflowKey: key,
      repoRoot: root,
      planPath: plan,
      sessionName: session,
      taskId: task,
      executor: pin.candidates[pin.candidateIndex].executor,
      agent,
      pin,
      taskText: String(text),
      dispatchPath: dispatchPathFor(pin.candidates[pin.candidateIndex]),
    });
    writeRecord(dir, record, { op: "record-create", outcome: "offered" });

    // Step 6: start; the mismatch check compares the `agent` JSON fields, never `task`
    // (`next.task` is an id string, `start.task` a full object).
    const started = airlock.start(record.taskId);
    logOperation(dir, { op: "airlock-start", taskId: record.taskId, attempt: record.attempt, outcome: started.ok ? "ok" : `error:${started.exitCode}`, detail: started.ok ? null : String(started.error) });
    if (!started.ok) {
      deleteRecord(dir, record, { detail: `airlock start failed: ${started.error}` });
      out(`AIRLOCK ERROR: ${started.error}`);
      return finish(started.exitCode ?? 1);
    }
    printNotices(started);
    if (started.value.agent !== agent) {
      const blocked = airlock.block(record.taskId, "agent changed between next and start");
      logOperation(dir, { op: "airlock-block", taskId: record.taskId, attempt: record.attempt, outcome: blocked.ok ? "ok" : `error:${blocked.exitCode}`, detail: "agent changed between next and start" });
      record.state = "failed";
      record.lastError = "agent changed between next and start";
      writeRecord(dir, record, { op: "record-state", outcome: "failed" });
      out(`AGENT MISMATCH: next offered ${agent}, start returned ${started.value.agent ?? "<missing>"}; task ${record.taskId} blocked for human inspection`);
      return finish(5);
    }
    record.state = "started";
    writeRecord(dir, record, { op: "record-state", outcome: "started" });

    return await guardedLaunch({ dir, root, planPath: plan, session, timeoutMs, airlock, herdr, probes, out, finish }, record);
  }
}
