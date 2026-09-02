import path from "node:path";
import { detectNonce, workflowDir, workflowKey, listRecords } from "./state.mjs";

export function renderStatus({ airlockText, rows }) {
  const lines = [String(airlockText ?? "").trimEnd(), "", "HERDR ROUTER"];
  if (rows.length === 0) lines.push("  (no correlation records)");
  for (const row of rows) lines.push(`  ${row}`);
  return lines.join("\n");
}

// Strict parse only (§Failure classes condition 2): the typed Path A REPORT line always
// contains the raw `AIRLOCK-RESULT <nonce>` string, so a substring check would show
// "seen" for every prompted pane. status/watch rows must agree with reconcile.
export function nonceSeenIn(text, nonce) {
  return detectNonce(text, nonce) !== null;
}

export async function collectRows({ session, repoRoot, planPath, stateDir, herdr }) {
  const root = path.resolve(repoRoot);
  const plan = path.resolve(planPath);
  const dir = workflowDir(stateDir, session, workflowKey(root, plan));
  const rows = [];
  for (const record of listRecords(dir)) {
    let paneState = record.paneId ? "unknown" : "no pane";
    let nonceSeen = "?";
    if (record.paneId) {
      const info = await herdr.paneInfo(record.paneId);
      if (info.ok) {
        paneState = info.pane?.agent_status ?? "present";
        const read = await herdr.readPane(record.paneId);
        nonceSeen = read.ok && nonceSeenIn(read.text, record.nonce) ? "seen" : "not seen";
      } else {
        paneState = "missing";
      }
    }
    const chain = record.pin ? ` · candidate ${record.pin.candidateIndex + 1}/${record.pin.candidates.length}` : "";
    rows.push(`${record.taskId} · attempt ${record.attempt} · ${record.state} · ${record.executor ?? "?"}${chain} · pane ${paneState} · nonce ${nonceSeen}`);
  }
  return rows;
}

export async function status({ session, repoRoot, planPath, stateDir, airlock, herdr, out = (line) => console.log(line), exit = () => {}, json = false }) {
  const statusResult = airlock.status();
  if (!statusResult.ok) {
    out(`AIRLOCK ERROR: ${statusResult.error}`);
    exit(1);
    return { code: 1 };
  }
  const rows = await collectRows({ session, repoRoot, planPath: airlock.planPath ?? planPath, stateDir, herdr });
  if (json) {
    out(JSON.stringify({ status: statusResult.value, rows }, null, 2));
  } else {
    out(renderStatus({ airlockText: statusResult.value.text, rows }));
  }
  exit(0);
  return { code: 0 };
}

export async function watch({ session, repoRoot, planPath, stateDir, airlock, herdr, out = (line) => console.log(line), exit = () => {}, intervalMs = 5000, signal = null }) {
  const abort = signal ?? new AbortController().signal;
  while (!abort.aborted) {
    const statusResult = airlock.status();
    if (!statusResult.ok) {
      out(`AIRLOCK ERROR: ${statusResult.error}`);
    } else {
      const rows = await collectRows({ session, repoRoot, planPath: airlock.planPath ?? planPath, stateDir, herdr });
      out(`\u001B[2J\u001B[H${renderStatus({ airlockText: statusResult.value.text, rows })}`);
    }
    await sleep(intervalMs, abort);
  }
  exit(0);
  return { code: 0 };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}
