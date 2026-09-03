import { gitStatus, logOperation, productChanges, writeRecord } from "./state.mjs";

export function findPaneInSnapshot(snapshot, record) {
  if (!snapshot) return null;
  const panes = snapshot.panes ?? [];
  if (record.paneId && panes.some((pane) => pane.pane_id === record.paneId)) {
    return { paneId: record.paneId, workspaceId: record.workspaceId };
  }
  const workspace = (snapshot.workspaces ?? []).find((entry) => entry.label === record.agentName);
  if (!workspace) return null;
  const pane = panes.find((entry) => entry.workspace_id === workspace.workspace_id);
  if (!pane) return null;
  return { paneId: pane.pane_id, workspaceId: workspace.workspace_id };
}

const CLOSEABLE_AGENT_STATES = new Set(["idle", "done", "exited"]);

export async function agentStateFor(herdr, record, paneId) {
  const agent = await herdr.agentInfo(record.agentName);
  if (agent.ok && agent.agent?.state) return agent.agent.state;
  if (agent.ok === false && agent.code === "not_found") {
    if (!paneId) return "exited";
    const info = await herdr.paneInfo(paneId);
    return info.ok ? (info.pane?.agent_status ?? "exited") : "exited";
  }
  if (!paneId) return "exited";
  const info = await herdr.paneInfo(paneId);
  return info.ok ? (info.pane?.agent_status ?? "unknown") : "unknown";
}

// The superseded row (rework path): a record beyond `offered` — proof the router's own
// `start` once made the task `doing` — while the plan task is back to `todo` (an
// answered decision reverted it). Settles the record as superseded when it is safe:
// the pane's agent is exited/idle on a successful snapshot and the worktree is clean.
// Otherwise it reports what it found and stays unresolved — an explicit path, not a wedge.
// Requires a successful snapshot; the caller handles class S when the snapshot failed.
export async function evaluateSuperseded({ dir, record, root, planPath, herdr, snapshot, out }) {
  const located = findPaneInSnapshot(snapshot, record);
  if (located) {
    const state = await agentStateFor(herdr, record, located.paneId);
    if (!CLOSEABLE_AGENT_STATES.has(state)) {
      out(`SUPERSEDED ${record.taskId} is pending: the pane's agent is ${state}; let it finish or close it yourself, then re-run reconcile`);
      return "unresolved";
    }
  }
  let changes;
  try {
    changes = productChanges(root, planPath, gitStatus(root));
  } catch (error) {
    out(`SUPERSEDED ${record.taskId} is pending: git status failed: ${error.message}`);
    return "unresolved";
  }
  if (changes.length) {
    out(`SUPERSEDED ${record.taskId} is pending: the worktree is dirty (${changes.map((change) => change.path).join(", ")}); clean or preserve it yourself, then re-run reconcile`);
    return "unresolved";
  }
  if (located) {
    const closed = await herdr.closePane(located.paneId);
    logOperation(dir, { op: "herdr-close-pane", taskId: record.taskId, attempt: record.attempt, outcome: closed.ok ? "ok" : `error:${closed.code}`, detail: located.paneId });
    if (!closed.ok) out(`WARN: could not close pane ${located.paneId}: ${closed.message}`);
  }
  record.state = "settled";
  record.settledAs = "superseded";
  record.settledAt = new Date().toISOString();
  writeRecord(dir, record, { op: "record-state", outcome: "settled:superseded", detail: "task reopened to todo; the pin dies with this record" });
  out(`SUPERSEDED ${record.taskId} · the task was reopened; the record is settled and the next dispatch resolves a fresh chain`);
  return "settled";
}
