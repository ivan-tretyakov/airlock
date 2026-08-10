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
    await mkdir(path.join(root, ".airlock"), { recursive: true });
    await writeFile(
      path.join(root, ".airlock", "contract.json"),
      typeof contract === "string" ? contract : JSON.stringify(contract),
    );
  }
  return root;
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
