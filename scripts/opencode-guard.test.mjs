import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  activeV2Contract,
  effectiveActor,
  guardInputsForOpenCode,
  nodeRuntimeAvailable,
  parsePatchPaths,
  resolveShellGuard,
  runGuardInputs,
  runExistingGuard,
} from "../.opencode/airlock-guard-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardPath = path.join(root, "hooks", "guard.mjs");

async function makeProject(t, contract) {
  const directory = await mkdtemp(path.join(tmpdir(), "airlock-opencode-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (contract) {
    await mkdir(path.join(directory, ".airlock"), { recursive: true });
    await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract));
  }
  return directory;
}

function contract(rootPath, extra = {}) {
  return {
    schema: "airlock.contract/v2",
    root: rootPath,
    ownedPaths: ["src/**"],
    processPaths: ["docs/airlock/**"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    allowDispatch: false,
    ...extra,
  };
}

function verdicts(inputs) {
  return inputs.map((input) => runExistingGuard(guardPath, input));
}

test("OpenCode guard is inert without a contract", async (t) => {
  assert.equal(nodeRuntimeAvailable(), true);
  const directory = await makeProject(t);
  const inputs = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "anything.txt"), content: "x" },
    worktree: directory,
    actor: "worker",
  });
  assert.deepEqual(verdicts(inputs), [{ decision: "allow" }]);
});

test("OpenCode root and worker paths map to the v2 guard", async (t) => {
  const directory = await makeProject(t);
  await mkdir(path.join(directory, ".airlock"), { recursive: true });
  await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract(directory)));

  const rootWrite = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "docs", "airlock", "STATUS.md"), content: "status" },
    worktree: directory,
    actor: "top-level",
  });
  const workerWrite = guardInputsForOpenCode({
    tool: "edit",
    args: { filePath: path.join(directory, "src", "feature.ts"), oldString: "a", newString: "b" },
    worktree: directory,
    actor: "worker",
  });
  const workerProcessWrite = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "docs", "airlock", "STATUS.md"), content: "status" },
    worktree: directory,
    actor: "worker",
  });
  const rootProductWrite = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "src", "feature.ts"), content: "x" },
    worktree: directory,
    actor: "top-level",
  });

  assert.equal(verdicts(rootWrite)[0].decision, "allow");
  assert.equal(verdicts(workerWrite)[0].decision, "allow");
  assert.equal(verdicts(workerProcessWrite)[0].decision, "deny");
  assert.equal(verdicts(rootProductWrite)[0].decision, "deny");
});

test("OpenCode shell and task calls retain v2 restrictions", async (t) => {
  const directory = await makeProject(t, contractPlaceholder());
  await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract(directory)));

  const broadStage = guardInputsForOpenCode({
    tool: "bash",
    args: { command: "git add -A" },
    worktree: directory,
    actor: "worker",
  });
  const nestedTask = guardInputsForOpenCode({
    tool: "task",
    args: { subagent_type: "worker" },
    worktree: directory,
    actor: "worker",
  });

  assert.equal(verdicts(broadStage)[0].decision, "deny");
  assert.equal(verdicts(nestedTask)[0].decision, "deny");
});

test("OpenCode maps the configured shell language instead of the host platform", () => {
  assert.deepEqual(resolveShellGuard("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", { platform: "win32" }), {
    shell: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    guardToolName: "PowerShell",
  });
  assert.deepEqual(resolveShellGuard("C:/Program Files/Git/bin/bash.exe", { platform: "win32" }), {
    shell: "C:/Program Files/Git/bin/bash.exe",
    guardToolName: "Bash",
  });
  assert.equal(resolveShellGuard("/bin/zsh", { platform: "linux" }).guardToolName, "Bash");
  assert.equal(resolveShellGuard(undefined, { platform: "linux", environment: {} }).guardToolName, "Bash");
  assert.equal(resolveShellGuard(undefined, { platform: "win32", environment: {} }).guardToolName, "PowerShell");
  assert.equal(resolveShellGuard("cmd.exe", { platform: "win32" }).guardToolName, undefined);
});

test("OpenCode apply_patch checks every path before execution", async (t) => {
  const directory = await makeProject(t, contractPlaceholder());
  await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract(directory)));
  const patchText = [
    "*** Begin Patch",
    "*** Update File: src/feature.ts",
    "@@",
    "-old",
    "+new",
    "*** Add File: package.json",
    "+{}",
    "*** End Patch",
  ].join("\n");
  const inputs = guardInputsForOpenCode({ tool: "apply_patch", args: { patchText }, worktree: directory, actor: "worker" });

  assert.deepEqual(parsePatchPaths(patchText), ["src/feature.ts", "package.json"]);
  assert.equal(inputs.length, 2);
  assert.deepEqual(verdicts(inputs).map((item) => item.decision), ["allow", "deny"]);
});

test("OpenCode apply_patch rejects ledger paths and tracks moves", async (t) => {
  const directory = await makeProject(t);
  const moved = [
    "*** Begin Patch",
    "*** Update File: src/old.ts",
    "*** Move to: src/new.ts",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(parsePatchPaths(moved), ["src/old.ts", "src/new.ts"]);

  const ledgerPatch = [
    "*** Begin Patch",
    "*** Update File: docs/airlock/ledger/work.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  assert.throws(
    () => guardInputsForOpenCode({ tool: "apply_patch", args: { patchText: ledgerPatch }, worktree: directory, actor: "top-level" }),
    /ledger/,
  );
});

test("active v2 contracts require scoped worker attribution", async (t) => {
  const directory = await makeProject(t, contractPlaceholder());
  await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract(directory)));
  assert.ok(activeV2Contract(directory));
});

test("single-actor contracts apply worker rules without session attribution", async (t) => {
  const directory = await makeProject(t, contractPlaceholder());
  const singleActor = contract(directory, { actorMode: "single-actor" });
  await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(singleActor));
  const actor = effectiveActor(singleActor, undefined);
  assert.equal(actor, "worker");

  const ownedWrite = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "src", "feature.ts"), content: "x" },
    worktree: directory,
    actor,
  });
  const processWrite = guardInputsForOpenCode({
    tool: "write",
    args: { filePath: path.join(directory, "docs", "airlock", "STATUS.md"), content: "x" },
    worktree: directory,
    actor,
  });
  assert.equal(verdicts(ownedWrite)[0].decision, "allow");
  assert.equal(verdicts(processWrite)[0].decision, "deny");
});

test("adapter activity matches canonical v2 validation", async (t) => {
  for (const extra of [
    { root: "relative" },
    { processPaths: [1] },
    { expiresAt: "not-a-timestamp" },
    { allowDispatch: "yes" },
    { actorMode: "unknown" },
  ]) {
    const directory = await makeProject(t, contractPlaceholder());
    await writeFile(path.join(directory, ".airlock", "contract.json"), JSON.stringify(contract(directory, extra)));
    assert.equal(activeV2Contract(directory), undefined);
    const input = guardInputsForOpenCode({
      tool: "write",
      args: { filePath: path.join(directory, "outside.ts"), content: "x" },
      worktree: directory,
      actor: "worker",
    });
    assert.deepEqual(verdicts(input), [{ decision: "allow" }]);
  }
});

test("guard input execution stops at the first denial", () => {
  let calls = 0;
  const verdict = runGuardInputs("unused", [{ id: 1 }, { id: 2 }, { id: 3 }], (_guardPath, input) => {
    calls += 1;
    return input.id === 2 ? { decision: "deny", reason: "blocked" } : { decision: "allow" };
  });
  assert.deepEqual(verdict, { decision: "deny", reason: "blocked" });
  assert.equal(calls, 2);
});

function contractPlaceholder() {
  return { schema: "placeholder" };
}
