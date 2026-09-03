import path from "node:path";
import { spawnSync } from "node:child_process";
import { sanitizeReason } from "./airlock-client.mjs";
import { buildPrompt, DEFAULT_TIMEOUT_MS, guardedLaunch, roleFromAgent } from "./dispatch.mjs";
import { createExecutorProbes, pathBCommand } from "./executors.mjs";
import { acquireWorkflowLock, LockError } from "./lock.mjs";
import { MAX_FALLBACK_ADVANCES } from "./routes.mjs";
import { agentStateFor, evaluateSuperseded, findPaneInSnapshot } from "./supersede.mjs";
import { RECORD_VERSION, advanceCandidate, deleteRecord, detectNonce, gitStatus, listRecords, logOperation, productChanges, readRecord, workflowDir, workflowKey, writePromptFile, writeRecord } from "./state.mjs";

export { detectNonce };

const EXTERNALLY_SETTLED = new Set(["done", "blocked"]);
const CLOSEABLE = new Set(["idle", "done", "exited"]);

export function extractOutOfScope(errorText) {
  const section = String(errorText ?? "").split(/^OUT OF SCOPE$/m)[1];
  if (!section) return null;
  const collected = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collected.length) break;
      continue;
    }
    if (trimmed.startsWith("FOREIGN") || trimmed.startsWith("RECOVERY")) break;
    collected.push(trimmed);
  }
  return collected.length ? collected : null;
}

function nonInteractiveUi() {
  return { confirm: async () => false, input: async () => null };
}

export async function reconcile({
  session,
  repoRoot,
  planPath = null,
  task = null,
  stateDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  airlock,
  herdr,
  probes = createExecutorProbes(),
  lockOptions = {},
  ui = nonInteractiveUi(),
  out = (line) => console.log(line),
  exit = () => {},
} = {}) {
  const root = path.resolve(repoRoot);
  const plan = airlock.planPath ?? planPath;
  const key = workflowKey(root, plan);
  const dir = workflowDir(stateDir, session, key);
  const finishRun = (code, settled = 0, unresolved = 0) => {
    exit(code);
    return { code, settled, unresolved };
  };

  let lock;
  try {
    lock = acquireWorkflowLock(dir, lockOptions);
  } catch (error) {
    if (error instanceof LockError) {
      out(error.message);
      return finishRun(69);
    }
    throw error;
  }
  try {
    return await run();
  } finally {
    lock.release();
  }

  async function run() {
    const records = task ? [readRecord(dir, task)].filter(Boolean) : listRecords(dir);
    if (task && records.length === 0) {
      out(`NO RECORD ${task}`);
      return finishRun(0);
    }

    const statusResult = airlock.status();
    logOperation(dir, { op: "airlock-status", outcome: statusResult.ok ? "ok" : `error:${statusResult.exitCode}`, detail: statusResult.ok ? null : String(statusResult.error) });
    if (!statusResult.ok) {
      out(`AIRLOCK ERROR: ${statusResult.error}`);
      return finishRun(statusResult.exitCode ?? 1);
    }
    for (const notice of statusResult.notices ?? []) out(notice);
    const planTasks = new Map(statusResult.value.plan.tasks.map((entry) => [entry.id, entry]));
    const decisions = statusResult.value.plan.decisions ?? [];

    // One successful session snapshot corroborates every pane decision below. A failed
    // snapshot is class S: mutate nothing, exit 69 — it must never be read as "pane gone".
    const snap = await herdr.snapshot();
    logOperation(dir, { op: "herdr-snapshot", outcome: snap.ok ? "ok" : `error:${snap.code}`, detail: snap.ok ? null : String(snap.message) });
    if (!snap.ok) {
      out(`HERDR UNAVAILABLE session snapshot failed: ${snap.code}: ${snap.message} (retryable; the chain was not advanced)`);
      return finishRun(69);
    }
    const snapshot = snap.snapshot;

    let settledCount = 0;
    let unresolvedCount = 0;
    let abortCode = null;
    for (const record of records) {
      const outcome = await processRecord(record);
      if (outcome === "settled") settledCount += 1;
      else unresolvedCount += 1;
      if (abortCode !== null) return finishRun(abortCode, settledCount, unresolvedCount);
    }
    return finishRun(0, settledCount, unresolvedCount);

    async function processRecord(record) {
      if (record.recordVersion !== RECORD_VERSION) {
        out(`LEGACY RECORD ${record.taskId} (recordVersion ${record.recordVersion}): settle it by hand; the router does not migrate live state`);
        return "unresolved";
      }
      if (record.state === "settled") {
        out(`${record.taskId} · already settled (${record.settledAs ?? "?"})`);
        return "settled";
      }
      const planTask = planTasks.get(record.taskId);
      if (!planTask) {
        record.state = "failed";
        record.lastError = "task no longer present in the plan";
        writeRecord(dir, record, { op: "record-state", outcome: "failed" });
        out(`STALE RECORD ${record.taskId} · task removed from plan; record marked failed`);
        return "unresolved";
      }
      const status = planTask.status;
      if (status === "needs-you") {
        // A pause, not a settlement: the worker may be mid-run with unsaved context.
        const decision = decisions.find((entry) => entry.status === "open" && (entry.blocks ?? []).includes(record.taskId))?.id
          ?? String(planTask.note ?? "").match(/waiting on (\S+)/)?.[1]
          ?? "<unknown decision>";
        record.state = "needs-reconcile";
        record.parkedForHuman = decision;
        writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail: `parkedForHuman ${decision}` });
        out(`PARKED ${record.taskId} on ${decision}; answer it, then re-run reconcile`);
        return "unresolved";
      }
      if (EXTERNALLY_SETTLED.has(status)) {
        await settleExternally(record, status);
        return "settled";
      }
      if (status === "todo") {
        if (record.state === "offered") {
          deleteRecord(dir, record, { detail: "stale offer: airlock start never ran (task still todo)" });
          out(`STALE OFFER ${record.taskId} removed (dispatch never started the task)`);
          return "unresolved";
        }
        return await evaluateSuperseded({ dir, record, root, planPath: plan, herdr, snapshot, out });
      }
      if (record.state === "launch-pending") {
        // Resume the launch of the same recorded candidate — never a further advance,
        // never a fresh qualifying failure.
        out(`RESUMING ${record.taskId} · launch-pending attempt ${record.attempt} · candidate ${record.pin.candidateIndex + 1}/${record.pin.candidates.length}`);
        return await resumeLaunch(record);
      }
      return await reconcileDoing(record);
    }

    async function resumeLaunch(record) {
      record.paneId = null;
      record.workspaceId = null;
      let code = 0;
      const result = await guardedLaunch({ dir, root, planPath: plan, session, timeoutMs, airlock, herdr, probes, out, finish: (value) => ({ code: (code = value) }) }, record);
      if ((result?.code ?? code) === 69) {
        abortCode = 69;
        return "unresolved";
      }
      const refreshed = readRecord(dir, record.taskId);
      return refreshed?.state === "settled" ? "settled" : "unresolved";
    }

    async function reconcileDoing(record) {
      const located = findPaneInSnapshot(snapshot, record);
      const paneId = located?.paneId ?? null;
      if (paneId && paneId !== record.paneId) {
        record.paneId = paneId;
        record.workspaceId = located.workspaceId ?? record.workspaceId;
        writeRecord(dir, record, { op: "record-state", outcome: "pane-adopted", detail: `${record.workspaceId} ${record.paneId}` });
        out(`ADOPTED PANE ${paneId} for ${record.taskId} (found by explicit workspace label)`);
      }
      const info = paneId ? await herdr.paneInfo(paneId) : { ok: false, pane: null };
      const pane = info.ok ? info.pane : null;
      logOperation(dir, { op: "herdr-pane-get", taskId: record.taskId, attempt: record.attempt, outcome: info.ok ? "ok" : `error:${info.code ?? "missing"}`, detail: pane ? pane.agent_status : "pane missing" });

      const agent = await herdr.agentInfo(record.agentName);
      const agentState = agent.ok ? (agent.agent?.state ?? null) : null;
      const herdrState = agentState ?? pane?.agent_status ?? (pane ? "unknown" : "missing");

      const read = paneId ? await herdr.readPane(paneId) : { ok: false, text: "" };
      logOperation(dir, { op: "herdr-read-pane", taskId: record.taskId, attempt: record.attempt, outcome: read.ok ? "ok" : `error:${read.code ?? "no-pane"}`, detail: `${Buffer.byteLength(read.text ?? "", "utf8")} bytes` });
      const nonce = detectNonce(read.text, record.nonce);

      let changes = [];
      try {
        changes = productChanges(root, plan, gitStatus(root));
      } catch (error) {
        out(`GIT ERROR: ${error.message}`);
        return "unresolved";
      }
      const exited = pane ? await foregroundIsShell(paneId, record.executor) : false;

      if (nonce?.verdict === "blocked") {
        out(`WORKER REPORTED BLOCKED ${record.taskId}: ${sanitizeReason(nonce.summary)}`);
        return await blockTask(record, sanitizeReason(nonce.summary), { closePane: false });
      }
      if (nonce?.verdict === "ok") {
        if (changes.length === 0) {
          out(`SUSPICIOUS ${record.taskId} · worker claimed success but the worktree has no product changes; inspect the output below and decide yourself (a read-only acceptance may legitimately pass).`);
          printPaneOutput(read.text);
          markUnresolved(record, "nonce ok without changes; awaiting human decision");
          return "unresolved";
        }
        return await completionCandidate(record, { read, changes });
      }
      if (herdrState === "blocked") {
        out(`BLOCKED PROMPT ${record.taskId} · Herdr recognized a permission/question prompt; the router never answers it.`);
        printPaneOutput(read.text, 30);
        if (await ui.confirm(`Block ${record.taskId} so you can resolve it later?`)) return await blockTask(record, "worker waiting on a permission/question prompt", { closePane: false });
        out(`Resolve the prompt in the pane yourself, then re-run reconcile.`);
        markUnresolved(record, "herdr reported a blocked prompt");
        return "unresolved";
      }
      if (!pane) {
        return await orphan(record, { nonce, changes });
      }
      if (herdrState === "idle" || herdrState === "done" || exited) {
        if (changes.length > 0) return await completionCandidate(record, { read, changes });
        return await noResult(record, { read });
      }
      out(`${record.taskId} · worker ${herdrState}; still running`);
      return "unresolved";
    }

    async function completionCandidate(record, { read, changes }) {
      out(`RESULT CANDIDATE ${record.taskId} · ${changes.length} product change(s):`);
      out(changes.map((change) => `  ${change.status} ${change.path}`).join("\n"));
      printPaneOutput(read.text);
      printDiffSummary(root);
      if (!(await ui.confirm(`Run airlock audit for ${record.taskId} and, if it passes, complete it? [y/N]`))) {
        out(`Left unresolved: inspect the output and diff, then re-run reconcile.`);
        markUnresolved(record, "awaiting human completion decision");
        return "unresolved";
      }
      const audit = airlock.audit(record.taskId);
      logOperation(dir, { op: "airlock-audit", taskId: record.taskId, attempt: record.attempt, outcome: audit.ok ? "ok" : "failed", detail: audit.ok ? null : String(audit.error).slice(0, 300) });
      if (!audit.ok) {
        out(`AUDIT FAILED ${record.taskId}: ${audit.error}`);
        return await auditFailed(record, audit.error);
      }
      out(audit.value.text);
      const evidence = await ui.input(`Evidence for ${record.taskId} (command + result): `);
      if (!evidence || !evidence.trim()) {
        out(`No evidence supplied; done was not called. Task ${record.taskId} stays doing.`);
        markUnresolved(record, "human did not supply evidence");
        return "unresolved";
      }
      const completed = airlock.done(record.taskId, evidence);
      logOperation(dir, { op: "airlock-done", taskId: record.taskId, attempt: record.attempt, outcome: completed.ok ? "ok" : `error:${completed.exitCode}`, detail: completed.ok ? completed.value.commit : String(completed.error).slice(0, 300) });
      if (!completed.ok) {
        out(`AIRLOCK ERROR: ${completed.error}`);
        out(`Airlock restored ${record.taskId} to doing; inspect and retry.`);
        markUnresolved(record, "airlock done failed; task restored to doing");
        return "unresolved";
      }
      out(completed.value.text);
      await settle(record, "done", { closePane: true });
      return "settled";
    }

    async function auditFailed(record, errorText) {
      const paths = extractOutOfScope(errorText);
      const reason = `audit failed: ${paths ? paths.join(", ") : sanitizeReason(errorText)}`;
      return await blockTask(record, reason, { closePane: false });
    }

    async function noResult(record, { read }) {
      // The pane exists and the submission was accepted — class P by definition:
      // this row never auto-advances (the worker got the task).
      out(`NO RESULT ${record.taskId} · worker settled without a result marker and without product changes.`);
      printPaneOutput(read.text);
      if ((record.promptRetryCount ?? 0) < 1 && (await ui.confirm(`Retry the prompt once for ${record.taskId}? [y/N]`))) {
        return await redeliver(record);
      }
      if (await ui.confirm(`Block ${record.taskId} as a failed attempt? [y/N]`)) {
        return await blockTask(record, "worker produced nothing", { closePane: true });
      }
      markUnresolved(record, "worker produced nothing; human decides retry or block");
      return "unresolved";
    }

    async function orphan(record, { nonce, changes }) {
      // The workspace/agent is missing on a *successful* snapshot. First branch: a
      // proven class-E failure (all four conditions) advances automatically.
      const provenPreDelivery = record.promptAttemptedAt === null && ["pane-created", "agent-started"].includes(record.state);
      const noAgentResult = !nonce && changes.length === 0;
      if (provenPreDelivery && noAgentResult) {
        const from = record.pin.candidates[record.pin.candidateIndex];
        const failure = {
          at: new Date().toISOString(),
          candidate: { executor: from.executor, model: from.model, effort: from.effort ?? null },
          class: "executor-start",
          code: "pane_gone_before_submission",
          detail: "workspace/agent missing on a successful snapshot before any prompt submission",
          fromAttempt: record.attempt,
        };
        if (record.pin.candidateIndex >= record.pin.candidates.length - 1 || record.pin.advanceCount >= MAX_FALLBACK_ADVANCES) {
          out(`ORPHANED ${record.taskId} · executor died before the prompt and the chain is exhausted.`);
          record.pin = { ...record.pin, failures: [...(record.pin.failures ?? []), failure] };
          const summary = record.pin.failures.map((entry) => `${entry.candidate.executor} ${entry.candidate.model}: ${entry.code}`).join("; ");
          return await blockTask(record, `route chain exhausted: ${summary}`, { closePane: false });
        }
        let advanced;
        try {
          advanced = advanceCandidate(dir, record, { failure, expectedCandidateIndex: record.pin.candidateIndex, consumeBudget: true });
        } catch (error) {
          out(`ADVANCE ABORTED: ${error.message}`);
          abortCode = 69;
          return "unresolved";
        }
        const to = advanced.pin.candidates[advanced.pin.candidateIndex];
        out(`FALLBACK ${record.taskId} · ${from.executor} ${from.model} -> ${to.executor} ${to.model}`);
        return await resumeLaunch(advanced);
      }
      out(`ORPHANED ${record.taskId} · no live pane or agent; the task stays doing and nothing is redispatched automatically.`);
      out(`Choose: resume it in a fresh pane (reuses the retained task brief) | block it.`);
      if (await ui.confirm(`Resume ${record.taskId} in a fresh pane? [y/N]`)) return await resume(record);
      if (await ui.confirm(`Block ${record.taskId}? [y/N]`)) return await blockTask(record, "worker pane disappeared", { closePane: false });
      markUnresolved(record, "orphaned pane; awaiting human choice");
      return "unresolved";
    }

    async function resume(record) {
      const restarted = airlock.start(record.taskId);
      logOperation(dir, { op: "airlock-start", taskId: record.taskId, attempt: record.attempt, outcome: restarted.ok ? "ok" : `error:${restarted.exitCode}`, detail: restarted.ok ? "resume" : String(restarted.error).slice(0, 300) });
      if (!restarted.ok) {
        out(`AIRLOCK ERROR: ${restarted.error}`);
        markUnresolved(record, "resume start failed");
        return "unresolved";
      }
      out(`RESUMED ${record.taskId} · same candidate, fresh pane`);
      return await resumeLaunch(record);
    }

    async function redeliver(record) {
      record.promptRetryCount = (record.promptRetryCount ?? 0) + 1;
      writeRecord(dir, record, { op: "record-state", outcome: `retry-${record.promptRetryCount}` });
      const prompt = buildPrompt(record.taskText, record.nonce);
      try {
        record.promptAttemptedAt = new Date().toISOString();
        writeRecord(dir, record, { op: "record-state", outcome: record.state, detail: "promptAttemptedAt persisted before retry submission" });
        let delivered;
        if (record.dispatchPath === "B-headless") {
          const candidate = record.pin.candidates[record.pin.candidateIndex];
          const promptFile = writePromptFile(dir, record.taskId, record.attempt, prompt);
          delivered = await herdr.runInPane({ paneId: record.paneId, command: pathBCommand({ role: roleFromAgent(record.agent), model: candidate.model, effort: candidate.effort, promptFile }), match: `AIRLOCK-RESULT ${record.nonce}`, timeoutMs });
        } else {
          delivered = await herdr.agentPrompt({ name: record.agentName, prompt, timeoutMs });
        }
        if (!delivered.delivered) throw new Error(`prompt delivery failed: ${delivered.code}`);
        record.state = "prompted";
        record.promptDeliveredAt = new Date().toISOString();
        writeRecord(dir, record, { op: "record-state", outcome: "prompted", detail: "retry" });
        record.state = "needs-reconcile";
        writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail: "retry wait finished" });
        out(`RETRIED ${record.taskId}`);
        out(`RECONCILE ${record.taskId}`);
        return "unresolved";
      } catch (error) {
        record.state = "needs-reconcile";
        record.lastError = String(error.message);
        writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail: record.lastError });
        out(`RETRY FAILED: ${error.message}`);
        return "unresolved";
      }
    }

    async function blockTask(record, reason, { closePane }) {
      const blocked = airlock.block(record.taskId, reason);
      logOperation(dir, { op: "airlock-block", taskId: record.taskId, attempt: record.attempt, outcome: blocked.ok ? "ok" : `error:${blocked.exitCode}`, detail: sanitizeReason(reason) });
      if (!blocked.ok) {
        out(`AIRLOCK ERROR: ${blocked.error}`);
        markUnresolved(record, "airlock block failed");
        return "unresolved";
      }
      out(blocked.value.text);
      await settle(record, "blocked", { closePane });
      return "settled";
    }

    async function settleExternally(record, status) {
      out(`${record.taskId} · airlock already ${status}; syncing the router record.`);
      await settle(record, status, { closePane: true });
    }

    // Settles close only plugin-owned panes whose agent is exited or idle on the
    // successful snapshot; a live working pane is never closed — it is reported instead.
    async function settle(record, settledAs, { closePane }) {
      if (closePane) {
        const located = findPaneInSnapshot(snapshot, record);
        if (located) {
          const state = await agentStateFor(herdr, record, located.paneId);
          if (CLOSEABLE.has(state)) {
            const closed = await herdr.closePane(located.paneId);
            logOperation(dir, { op: "herdr-close-pane", taskId: record.taskId, attempt: record.attempt, outcome: closed.ok ? "ok" : `error:${closed.code}`, detail: located.paneId });
            if (!closed.ok) out(`WARN: could not close pane ${located.paneId}: ${closed.message}`);
          } else {
            out(`PANE LEFT OPEN ${located.paneId} for ${record.taskId}: its agent is ${state}; close it yourself when it is done`);
          }
        }
      }
      record.state = "settled";
      record.settledAs = settledAs;
      record.settledAt = new Date().toISOString();
      writeRecord(dir, record, { op: "record-state", outcome: `settled:${settledAs}` });
      out(`SETTLED ${record.taskId} (${settledAs})`);
    }

    async function foregroundIsShell(paneId, executor) {
      const info = await herdr.processInfo(paneId);
      if (!info.ok || !info.processInfo) return false;
      const foreground = info.processInfo.foreground_processes ?? [];
      const bin = executor ?? "opencode";
      return !foreground.some((process) => process?.name === bin || String(process?.cmdline ?? "").includes(`/${bin}`));
    }

    function markUnresolved(record, detail) {
      record.state = "needs-reconcile";
      record.lastError = detail;
      writeRecord(dir, record, { op: "record-state", outcome: "needs-reconcile", detail });
      out(`UNRESOLVED ${record.taskId} · ${detail}`);
    }

    function printPaneOutput(text, maxLines = 40) {
      const lines = String(text ?? "").split("\n").filter((line) => line.trim().length > 0);
      if (!lines.length) return;
      out("--- pane output (bounded tail) ---");
      out(lines.slice(-maxLines).join("\n"));
      out("--- end pane output ---");
    }

    function printDiffSummary(repoRoot) {
      try {
        const stat = runGit(repoRoot, ["diff", "--stat", "HEAD"]);
        if (stat) out(`--- diff summary ---\n${stat}`);
        const untracked = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
        if (untracked) out(`--- untracked ---\n${untracked}`);
      } catch {}
    }
  }
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  return result.stdout?.trim() ?? "";
}
