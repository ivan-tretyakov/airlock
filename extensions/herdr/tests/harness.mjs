import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { dispatch } from "../src/dispatch.mjs";
import { workflowDir, workflowKey } from "../src/state.mjs";
import { airlockClientFor, DEFAULT_ROUTING, fakeHerdr, fakeProbes, makeProject, outCapture } from "./helpers.mjs";

export async function setup(t, { tasks, routing, plan } = {}) {
  const project = await makeProject(t, tasks, { routing: routing === undefined ? DEFAULT_ROUTING : routing, plan });
  const { root, planPath, configDir } = project;
  const airlock = airlockClientFor(root, planPath);
  const herdr = fakeHerdr(t);
  const probes = fakeProbes();
  const capture = outCapture();
  const exits = [];
  const stateDir = path.join(root, ".git", "airlock-test", "herdr-state");
  const dir = workflowDir(stateDir, "test-session", workflowKey(root, planPath));
  const run = async (overrides = {}) =>
    dispatch({ session: "test-session", repoRoot: root, planPath, stateDir, configDir, timeoutMs: 5000, airlock, herdr, probes, env: {}, out: capture.out, exit: (code) => exits.push(code), ...overrides });
  return { root, planPath, configDir, airlock, herdr, probes, capture, exits, stateDir, dir, run };
}

export function readJsonl(dir) {
  const file = path.join(dir, "operations.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function taskStatus(airlock, id) {
  return airlock.status().value.plan.tasks.find((task) => task.id === id)?.status;
}
