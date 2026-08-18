import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contractExpired, validV2Contract } from "../hooks/contract-v2.mjs";

const LEDGER_SEGMENTS = ["docs", "airlock", "ledger"];
const NODE_EXECUTABLE = process.platform === "win32" ? "node.exe" : "node";
export const COVERED_TOOLS = ["edit", "write", "apply_patch", "bash", "task"];

export function findContract(startDirectory) {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 32; depth += 1) {
    const candidate = path.join(current, ".airlock", "contract.json");
    if (existsSync(candidate)) return { contractPath: candidate, root: current };
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

export function activeV2Contract(startDirectory) {
  const located = findContract(startDirectory);
  if (!located) return undefined;
  try {
    const contract = JSON.parse(readFileSync(located.contractPath, "utf8"));
    if (contract?.schema !== "airlock.contract/v2" || !validV2Contract(contract) || contractExpired(contract)) return undefined;
    return { ...located, contract };
  } catch {
    return undefined;
  }
}

export function effectiveActor(contract, actor) {
  return contract?.actorMode === "single-actor" ? "worker" : actor;
}

function shellName(shell) {
  return String(shell).replaceAll("\\", "/").split("/").pop()?.replace(/\.exe$/i, "").toLowerCase();
}

export function resolveShellGuard(shell, { platform = process.platform, environment = process.env } = {}) {
  const classify = (candidate) => {
    const name = shellName(candidate);
    if (["powershell", "pwsh"].includes(name)) return { shell: candidate, guardToolName: "PowerShell" };
    if (["bash", "sh", "zsh", "dash", "ksh"].includes(name)) return { shell: candidate, guardToolName: "Bash" };
    return { shell: candidate, guardToolName: undefined };
  };
  if (shell) return classify(shell);
  if (environment.SHELL) {
    const inherited = classify(environment.SHELL);
    if (inherited.guardToolName) return inherited;
  }
  return platform === "win32"
    ? { shell: "powershell", guardToolName: "PowerShell" }
    : { shell: "bash", guardToolName: "Bash" };
}

export function parsePatchPaths(patchText) {
  if (typeof patchText !== "string" || !patchText.includes("*** Begin Patch")) {
    throw new Error("apply_patch must contain a valid Airlock patch");
  }

  const paths = [];
  let updatePath;
  for (const line of patchText.replaceAll("\r\n", "\n").split("\n")) {
    const file = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (file) {
      const target = file[2].trim();
      if (!target) throw new Error("apply_patch has an empty file path");
      paths.push(target);
      updatePath = file[1] === "Update" ? target : undefined;
      continue;
    }
    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move) {
      if (!updatePath) throw new Error("apply_patch move has no preceding update path");
      const target = move[1].trim();
      if (!target) throw new Error("apply_patch move has an empty destination");
      paths.push(target);
    }
  }

  if (paths.length === 0) throw new Error("apply_patch contains no file operations");
  return [...new Set(paths)];
}

export function isLedgerPath(absolutePath) {
  const segments = path.resolve(absolutePath).replaceAll("\\", "/").split("/");
  return segments.some(
    (segment, index) =>
      (segment === "docs" && segments[index + 1] === "ledger") ||
      (segment === LEDGER_SEGMENTS[0] &&
        segments[index + 1] === LEDGER_SEGMENTS[1] &&
        segments[index + 2] === LEDGER_SEGMENTS[2]),
  );
}

export function guardInputsForOpenCode({ tool, args, worktree, actor, shellToolName }) {
  const withActor = (input) => (actor === "worker" ? { ...input, agent_id: "opencode-worker" } : input);
  const cwd = path.resolve(worktree);

  if (tool === "edit") {
    return [
      withActor({
        tool_name: "Edit",
        tool_input: {
          file_path: args.filePath,
          old_string: args.oldString,
          new_string: args.newString,
          replace_all: args.replaceAll,
        },
        cwd,
      }),
    ];
  }
  if (tool === "write") {
    return [
      withActor({
        tool_name: "Write",
        tool_input: { file_path: args.filePath, content: args.content },
        cwd,
      }),
    ];
  }
  if (tool === "apply_patch") {
    return parsePatchPaths(args.patchText).map((candidate) => {
      const target = path.resolve(cwd, candidate);
      if (isLedgerPath(target)) {
        throw new Error("apply_patch cannot change an Airlock ledger; use edit or write for deterministic ledger hygiene");
      }
      return withActor({ tool_name: "Edit", tool_input: { file_path: target }, cwd });
    });
  }
  if (tool === "bash") {
    const resolvedShellToolName = shellToolName ?? resolveShellGuard().guardToolName;
    if (!resolvedShellToolName) throw new Error("OpenCode shell is unsupported for Airlock guard enforcement");
    return [
      withActor({
        tool_name: resolvedShellToolName,
        tool_input: { command: args.command },
        cwd,
      }),
    ];
  }
  if (tool === "task") {
    return [withActor({ tool_name: "Task", tool_input: {}, cwd })];
  }
  return [];
}

export function nodeRuntimeAvailable() {
  const result = spawnSync(NODE_EXECUTABLE, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

export function runExistingGuard(guardPath, input) {
  const result = spawnSync(NODE_EXECUTABLE, [guardPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "Airlock guard process failed");
  if (!result.stdout.trim()) return { decision: "allow" };

  const parsed = JSON.parse(result.stdout);
  const hook = parsed?.hookSpecificOutput;
  if (hook?.permissionDecision === "deny") {
    return { decision: "deny", reason: hook.permissionDecisionReason || "Airlock guard denied this operation" };
  }
  return { decision: "allow" };
}

export function runGuardInputs(guardPath, inputs, run = runExistingGuard) {
  for (const input of inputs) {
    const verdict = run(guardPath, input);
    if (verdict.decision === "deny") return verdict;
  }
  return { decision: "allow" };
}
