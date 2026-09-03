import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logOperation } from "./state.mjs";

// 2 × DEFAULT_TIMEOUT_MS (the 900 s prompt wait): a lock older than this is stale.
export const LOCK_STALE_MS = 1_800_000;

export class LockError extends Error {
  constructor(message, { pid, acquiredAt } = {}) {
    super(message);
    this.name = "LockError";
    this.pid = pid ?? null;
    this.acquiredAt = acquiredAt ?? null;
  }
}

export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function lockPath(dir) {
  return path.join(dir, "lock");
}

function readLock(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function heldError(held) {
  return new LockError(`LOCKED by pid ${held?.pid ?? "<unknown>"} since ${held?.acquiredAt ?? "<unknown>"}; re-run when it finishes`, { pid: held?.pid ?? null, acquiredAt: held?.acquiredAt ?? null });
}

export function acquireWorkflowLock(dir, { pid = process.pid, hostname = os.hostname(), now = () => new Date(), isAlive = defaultIsAlive, staleMs = LOCK_STALE_MS } = {}) {
  const filePath = lockPath(dir);
  mkdirSync(dir, { recursive: true });
  const payload = () => `${JSON.stringify({ pid, hostname, acquiredAt: now().toISOString() }, null, 2)}\n`;
  const tryCreate = () => {
    try {
      writeFileSync(filePath, payload(), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  };
  if (!tryCreate()) {
    const held = readLock(filePath);
    const age = held?.acquiredAt && !Number.isNaN(Date.parse(held.acquiredAt)) ? now().getTime() - Date.parse(held.acquiredAt) : Number.POSITIVE_INFINITY;
    const deadOnThisHost = held?.hostname === hostname && Number.isSafeInteger(held?.pid) && !isAlive(held.pid);
    const stale = held === null || deadOnThisHost || age > staleMs;
    if (!stale) throw heldError(held);
    logOperation(dir, { op: "lock-takeover", outcome: "stale", detail: JSON.stringify({ held, reason: deadOnThisHost ? "pid-dead" : "age" }) });
    rmSync(filePath, { force: true });
    if (!tryCreate()) throw heldError(readLock(filePath));
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const current = readLock(filePath);
      if (current?.pid === pid && current?.hostname === hostname) rmSync(filePath, { force: true });
    },
  };
}
