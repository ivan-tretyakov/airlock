import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const guardPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "hooks",
  "guard.mjs",
);

function runGuard(input, options = {}) {
  const nodeArguments = options.importPath
    ? ["--import", pathToFileURL(options.importPath).href, guardPath]
    : [guardPath];
  const result = spawnSync(process.execPath, nodeArguments, {
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

test("v1 preserves unscoped update staging while v2 requires pathspecs", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const tool_name of ["Bash", "PowerShell"]) {
    for (const command of ["git add -u", "git add --update"]) {
      assert.equal(
        runGuard({ tool_name, tool_input: { command }, cwd: root }).decision,
        "allow",
        "v1 " + tool_name + ": " + command,
      );
    }
  }

  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const tool_name of ["Bash", "PowerShell"]) {
    for (const command of ["git add -u", "git add --update"]) {
      assert.equal(
        runGuard({ tool_name, tool_input: { command }, cwd: root }).decision,
        "deny",
        "v2 " + tool_name + ": " + command,
      );
    }
    for (const command of [
      "git add -u -- src/feature.ts",
      "git add --update src/feature.ts",
    ]) {
      assert.equal(
        runGuard({ tool_name, tool_input: { command }, cwd: root }).decision,
        "allow",
        "v2 scoped " + tool_name + ": " + command,
      );
    }
  }
});

test("guard allows scoped git add and unrelated commands", async (t) => {
  const root = await makeProject(t, CONTRACT);
  for (const command of [
    "git add src/feature.ts tests/unit/feature.test.ts",
    "git status --porcelain=v2",
    "npm test",
    "git add docs/design/notes.md",
    "git add -u -- src/feature.ts",
    "git add --update src/feature.ts",
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
    agent_id: "worker-1",
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
    assert.equal(runGuard({
      tool_name: "Edit",
      tool_input: { file_path: target },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "allow");
  }
});

test("v2 allows custom absolute process paths and ignores expired contracts", async (t) => {
  const root = await makeProject(t);
  const processRoot = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
    processPaths: [path.join(processRoot, "evidence/**")],
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(processRoot, "evidence/STATUS.md") },
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

test("v2 fails open for malformed field values", async (t) => {
  const root = await makeProject(t);
  const malformedContracts = [
    {
      schema: "airlock.contract/v2",
      ownedPaths: [],
      expiresAt: "not-a-timestamp",
    },
    {
      schema: "airlock.contract/v2",
      ownedPaths: [],
      expiresAt: 0,
    },
    {
      schema: "airlock.contract/v2",
      ownedPaths: ["src/**", 42],
    },
    {
      schema: "airlock.contract/v2",
      ownedPaths: [],
      processPaths: ["docs/airlock/**", ""],
    },
    {
      schema: "airlock.contract/v2",
      ownedPaths: [],
      allowDispatch: "false",
    },
  ];
  for (const contract of malformedContracts) {
    await writeContract(root, contract);
    const input = contract.allowDispatch === undefined
      ? {
          tool_name: "Write",
          tool_input: { file_path: path.join(root, "package.json") },
          cwd: root,
        }
      : { tool_name: "Agent", tool_input: {}, cwd: root };
    assert.equal(runGuard(input).decision, "allow", JSON.stringify(contract));
  }
});

test("valid v2 fails closed when scope evaluation throws", async (t) => {
  const root = await makeProject(t);
  const preloadPath = path.join(root, "force-realpath-error.mjs");
  await writeFile(
    preloadPath,
    [
      'import fs from "node:fs";',
      'import { syncBuiltinESMExports } from "node:module";',
      'const fail = () => { throw Object.assign(new Error("forced realpath failure"), { code: "EIO" }); };',
      "fail.native = fail;",
      "fs.realpathSync = fail;",
      "syncBuiltinESMExports();",
      "",
    ].join("\n"),
  );
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  const validVerdict = runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "feature.ts") },
    cwd: root,
    agent_id: "worker-1",
  }, { importPath: preloadPath });
  assert.equal(validVerdict.decision, "deny");
  assert.match(validVerdict.reason, /guard evaluation failed/i);

  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
    expiresAt: "not-a-timestamp",
  });
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "package.json") },
    cwd: root,
    agent_id: "worker-1",
  }, { importPath: preloadPath }).decision, "allow");
});

test("v2 allows top-level dispatch and denies nested dispatch unless explicitly allowed", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: [],
  });
  for (const tool_name of ["Agent", "Task"]) {
    assert.equal(
      runGuard({ tool_name, tool_input: {}, cwd: root }).decision,
      "allow",
      "top-level " + tool_name,
    );
    assert.equal(
      runGuard({ tool_name, tool_input: {}, cwd: root, agent_id: "worker-1" }).decision,
      "deny",
      "nested " + tool_name,
    );
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
    agent_id: "worker-1",
  }).decision, "allow");
});

test("v2 separates orchestrator process paths from worker owned paths", async (t) => {
  const root = await makeProject(t);
  const status = path.join(root, "docs", "airlock", "STATUS.md");
  const owned = path.join(root, "src", "feature.ts");
  const contractPath = path.join(root, ".airlock", "contract.json");
  const unlistedProcessDocument = path.join(root, "docs", "airlock", "notes.md");
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
    processPaths: ["docs/airlock/STATUS.md"],
  });

  for (const target of [status, contractPath]) {
    assert.equal(runGuard({
      tool_name: "Write",
      tool_input: { file_path: target },
      cwd: root,
    }).decision, "allow", "top-level process write: " + target);
  }
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: owned },
    cwd: root,
  }).decision, "deny", "top-level product write");

  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: owned },
    cwd: root,
    agent_id: "worker-1",
  }).decision, "allow", "worker owned write");
  for (const target of [status, contractPath, unlistedProcessDocument]) {
    assert.equal(runGuard({
      tool_name: "Write",
      tool_input: { file_path: target },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", "worker process/control write: " + target);
  }
  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: unlistedProcessDocument },
    cwd: root,
  }).decision, "deny", "unlisted top-level process write");
});

test("v2 screens Bash and PowerShell staging and obvious writes with actor scope", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const tool_name of ["Bash", "PowerShell"]) {
    for (const command of ["git add -A", "echo x > package.json"]) {
      assert.equal(runGuard({
        tool_name,
        tool_input: { command },
        cwd: root,
        agent_id: "worker-1",
      }).decision, "deny", tool_name + ": " + command);
    }
  }
  for (const command of [
    "Set-Content -Path package.json -Value x",
    "Add-Content -LiteralPath package.json -Value x",
    "x | Out-File -FilePath package.json",
    "New-Item -Path package.json -ItemType File",
  ]) {
    assert.equal(runGuard({
      tool_name: "PowerShell",
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", command);
  }
  for (const pair of [
    ["Bash", "echo x > src/generated.txt"],
    ["PowerShell", "Set-Content -Path src/generated.txt -Value x"],
  ]) {
    const [tool_name, command] = pair;
    assert.equal(runGuard({
      tool_name,
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "allow", tool_name + ": " + command);
  }
});

test("v2 checks every literal PowerShell path-array target", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const command of [
    "Set-Content -Path src/owned.txt, package.json -Value x",
    "Add-Content -LiteralPath src/owned.txt,package.json -Value x",
    "New-Item -Path \src/owned.txt\,\package.json\ -ItemType File",
  ]) {
    assert.equal(runGuard({
      tool_name: "PowerShell",
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", command);
  }
  assert.equal(runGuard({
    tool_name: "PowerShell",
    tool_input: {
      command: "Set-Content -Path src/one.txt, src/two.txt -Value x",
    },
    cwd: root,
    agent_id: "worker-1",
  }).decision, "allow");
  for (const command of [
    "Set-Content -Path src/generated.txt -Value cd",
    "Set-Content -Path src/cd -Value x",
    "Write-Output Set-Content",
  ]) {
    assert.equal(runGuard({
      tool_name: "PowerShell",
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "allow", command);
  }
});

test("v2 catches PowerShell write cmdlets inside script and control blocks", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const command of [
    "& { Set-Content -Path package.json -Value x }",
    "& {Set-Content -Path package.json -Value x}",
    "if ($true) { Add-Content -Path package.json -Value x }",
    "if($true){Add-Content -Path package.json -Value x}",
    "& {Set-Location ../outside; Set-Content -Path src/generated.txt -Value x}",
  ]) {
    assert.equal(runGuard({
      tool_name: "PowerShell",
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", command);
  }
});

test("v2 broad staging catches quoted and path-qualified Git executables", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const pair of [
    ["Bash", '"git" add -A'],
    ["Bash", "/usr/bin/git add --all"],
    ["PowerShell", '& "git" add -A'],
    ["PowerShell", "C:\\Git\\cmd\\git.exe add --all"],
  ]) {
    const [tool_name, command] = pair;
    assert.equal(runGuard({
      tool_name,
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", tool_name + ": " + command);
  }
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
    agent_id: "worker-1",
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
    agent_id: "worker-1",
  }).decision, "deny");
});

test("v2 canonicalizes existing links before checking worker file targets", async (t) => {
  const root = await makeProject(t);
  const outside = await makeProject(t);
  await mkdir(path.join(root, "src"), { recursive: true });
  const escape = path.join(root, "src", "escape");
  await symlink(outside, escape, process.platform === "win32" ? "junction" : "dir");
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });

  assert.equal(runGuard({
    tool_name: "Write",
    tool_input: { file_path: path.join(escape, "escaped.txt") },
    cwd: root,
    agent_id: "worker-1",
  }).decision, "deny");
});

test("v2 denies write-bearing compounds after cd or Set-Location", async (t) => {
  const root = await makeProject(t);
  await writeContract(root, {
    schema: "airlock.contract/v2",
    ownedPaths: ["src/**"],
  });
  for (const pair of [
    ["Bash", "cd ../outside && echo x > src/generated.txt"],
    ["PowerShell", "Set-Location ../outside; Set-Content -Path src/generated.txt -Value x"],
  ]) {
    const [tool_name, command] = pair;
    assert.equal(runGuard({
      tool_name,
      tool_input: { command },
      cwd: root,
      agent_id: "worker-1",
    }).decision, "deny", tool_name + ": " + command);
  }
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
    agent_id: "worker-1",
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
