import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guardPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "hooks",
  "guard.mjs",
);

function runGuard(input) {
  const result = spawnSync(process.execPath, [guardPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  if (!result.stdout.trim()) {
    return { decision: "allow" };
  }
  const parsed = JSON.parse(result.stdout);
  return {
    decision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

async function makeProject(t, contract) {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (contract !== undefined) {
    if (typeof contract === "string") {
      await mkdir(path.join(root, ".airlock"), { recursive: true });
      await writeFile(path.join(root, ".airlock", "contract.json"), contract);
    } else {
      await writeContract(root, contract);
    }
  }
  return root;
}

async function writeContract(root, contract) {
  await mkdir(path.join(root, ".airlock"), { recursive: true });
  await writeFile(
    path.join(root, ".airlock", "contract.json"),
    JSON.stringify(contract),
  );
}

const CONTRACT = {
  schema: "airlock.contract/v1",
  ownedPaths: ["src/feature.ts", "tests/", "docs/**/*.md"],
};

test("guard is inert without a contract", async (t) => {
  const root = await makeProject(t);
  const verdict = runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "anything.txt") },
    cwd: root,
  });
  assert.equal(verdict.decision, "allow");
});

test("guard is inert for a malformed or wrong-schema contract", async (t) => {
  for (const bad of ["not json", { schema: "other/v1", ownedPaths: [] }]) {
    const root = await makeProject(t, bad);
    const verdict = runGuard({
      tool_name: "Write",
      tool_input: { file_path: path.join(root, "anything.txt") },
      cwd: root,
    });
    assert.equal(verdict.decision, "allow");
  }
});

test("guard allows exact, prefix, and glob owned paths", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const relative of [
    "src/feature.ts",
    "tests/unit/feature.test.ts",
    "docs/design/notes.md",
    ".airlock/contract.json",
  ]) {
    const verdict = runGuard({
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, relative) },
      cwd: root,
    });
    assert.equal(verdict.decision, "allow", relative);
  }
});

test("guard denies writes outside ownedPaths and outside the root", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const target of [
    path.join(root, "src", "other.ts"),
    path.join(root, "package.json"),
    path.join(root, "..", "elsewhere.txt"),
  ]) {
    const verdict = runGuard({
      tool_name: "Write",
      tool_input: { file_path: target },
      cwd: root,
    });
    assert.equal(verdict.decision, "deny", target);
    assert.match(verdict.reason, /Airlock contract active/);
  }
});

test("guard denies broad git add while a contract is active", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const command of [
    "git add -A",
    "git add --all",
    "git add .",
    "git commit -m x && git add -A",
    "git -C sub add .",
  ]) {
    const verdict = runGuard({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    assert.equal(verdict.decision, "deny", command);
    assert.match(verdict.reason, /scoped `git add/);
  }
});

test("guard allows scoped git add and unrelated commands", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const command of [
    "git add src/feature.ts tests/unit/feature.test.ts",
    "git status --porcelain=v2",
    "npm test",
    "git add docs/design/notes.md",
  ]) {
    const verdict = runGuard({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    assert.equal(verdict.decision, "allow", command);
  }
});

test("guard allows broad git add when no contract exists", async (t) => {
  const root = await makeProject(t);
  const verdict = runGuard({
    tool_name: "Bash",
    tool_input: { command: "git add -A" },
    cwd: root,
  });
  assert.equal(verdict.decision, "allow");
});

test("v2 root allows an absolute target outside the contract directory", async (t) => {
  const docsRoot = await makeProject(t);
  const codeRoot = await makeProject(t);
  await writeContract(docsRoot, {
    schema: "airlock.contract/v2",
    root: codeRoot,
    ownedPaths: ["src/**"],
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(codeRoot, "src", "feature.ts") },
    cwd: docsRoot,
  }).decision, "allow");
});

test("v2 supports absolute owned paths under multiple roots", async (t) => {
  const root = await makeProject(t);
  const sibling = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: [path.join(root, "src/**"), path.join(sibling, "tests/**")],
  });
  for (const target of [path.join(root, "src/a.js"), path.join(sibling, "tests/a.test.js")]) {
    assert.equal(runGuard({ tool_name: "Edit", tool_input: { file_path: target }, cwd: root }).decision, "allow");
  }
});

test("v2 allows process paths and ignores expired contracts", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
    processPaths: ["docs/airlock/**"],
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "docs/airlock/STATUS.md") },
    cwd: root,
  }).decision, "allow");
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: [],
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "package.json") },
    cwd: root,
  }).decision, "allow");
});

test("v2 denies worker dispatch unless explicitly allowed", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: [],
  });
  for (const tool_name of ["Agent", "Task"]) {
    assert.equal(runGuard({ tool_name, tool_input: {}, cwd: root }).decision, "deny");
  }
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: [],
    allowDispatch: true,
  });
  assert.equal(runGuard({
    tool_name: "Agent",
    tool_input: {},
    cwd: root,
  }).decision, "allow");
});

test("v2 denies obvious out-of-contract redirection and tee writes", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const command of ["echo x > secrets.txt", "echo x >> ../outside.txt", "echo x | tee package.json"]) {
    assert.equal(runGuard({ tool_name: "Bash", tool_input: { command }, cwd: root }).decision, "deny");
  }
  assert.equal(runGuard({
    tool_name: "Bash",
    tool_input: { command: "echo x > src/generated.txt" },
    cwd: root,
  }).decision, "allow");
});

test("v2 does not treat a tee argument as a tee command", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  assert.equal(runGuard({
    tool_name: "Bash",
    tool_input: { command: "echo tee package.json" },
    cwd: root,
  }).decision, "allow");
});

test("v2 detects a tee command after a newline boundary", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  assert.equal(runGuard({
    tool_name: "Bash",
    tool_input: { command: "echo x\ntee package.json" },
    cwd: root,
  }).decision, "deny");
});

test("v2 accepts POSIX-style separators in relative patterns on Windows", {
  skip: process.platform !== "win32",
}, async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "generated.txt") },
    cwd: root,
  }).decision, "allow");
});

test("v2 treats relative root as malformed and fails open", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    root: "relative/root",
    ownedPaths: [],
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "package.json") },
    cwd: root,
  }).decision, "allow");
});
