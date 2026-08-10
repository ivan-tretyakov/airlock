// Airlock guard hook (PreToolUse).
//
// Inert unless an active dispatch contract exists: the orchestrator writes
// `.airlock/contract.json` (schema `airlock.contract/v1`) immediately before a
// file-writing worker runs and deletes it after the return audit. While the
// contract exists, this hook deterministically:
//   1. denies Edit/Write/NotebookEdit targets outside the contract's
//      `ownedPaths` (the `.airlock/` directory itself stays writable so the
//      orchestrator can manage the contract); and
//   2. denies broad staging (`git add -A`, `git add --all`, `git add .`) in
//      Bash commands, enforcing the scoped-add rule from `ship`.
//
// Fail-open by design: a missing, unreadable, or malformed contract, or any
// internal error, allows the tool call. The hook narrows behavior only when
// the orchestrator has explicitly declared a contract.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function findContract(startDirectory) {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 32; depth += 1) {
    const candidate = path.join(current, ".airlock", "contract.json");
    if (existsSync(candidate)) {
      return { contractPath: candidate, root: current };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          pattern += "(?:[^/]+/)*";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (character === "?") {
      pattern += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(character)) {
      pattern += `\\${character}`;
    } else if (character === "/") {
      pattern += "/";
    } else {
      pattern += character;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function pathAllowed(relativePath, ownedPaths) {
  const target = normalize(relativePath);
  if (target === ".airlock" || target.startsWith(".airlock/")) {
    return true;
  }
  for (const entry of ownedPaths) {
    if (typeof entry !== "string" || entry.length === 0) {
      continue;
    }
    const owned = normalize(entry.replaceAll("\\", "/"));
    if (owned.endsWith("/")) {
      if (target.startsWith(owned) || `${target}/` === owned) {
        return true;
      }
      continue;
    }
    if (target === owned) {
      return true;
    }
    if (/[*?]/.test(owned) && globToRegExp(owned).test(target)) {
      return true;
    }
  }
  return false;
}

function broadGitAdd(command) {
  // Examine each shell segment so `git commit -m "x" && git add -A` is caught
  // while `grep "git add -A" notes.md` inside quotes is tolerated as a
  // conservative false positive we accept for determinism.
  const segments = String(command).split(/(?:&&|\|\||;|\||\n)/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/);
    const gitIndex = tokens.findIndex((token) => /^git(\.exe)?$/i.test(token));
    if (gitIndex === -1) {
      continue;
    }
    let addIndex = -1;
    for (let index = gitIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
        index += 1; // skip the option's value
        continue;
      }
      if (token.startsWith("-")) {
        continue; // other global git options
      }
      if (token === "add") {
        addIndex = index;
      }
      break; // first non-option token is the subcommand
    }
    if (addIndex === -1) {
      continue;
    }
    const addArguments = tokens.slice(addIndex + 1);
    if (
      addArguments.some(
        (argument) =>
          argument === "-A" ||
          argument === "--all" ||
          argument === "." ||
          argument === "./" ||
          argument === ":/",
      )
    ) {
      return true;
    }
  }
  return false;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    allow();
    return;
  }

  const toolName = input?.tool_name ?? "";
  const toolInput = input?.tool_input ?? {};
  const workingDirectory = input?.cwd || process.cwd();

  const located = findContract(workingDirectory);
  if (!located) {
    allow();
    return;
  }

  let contract;
  try {
    contract = JSON.parse(readFileSync(located.contractPath, "utf8"));
  } catch {
    allow();
    return;
  }
  if (
    contract?.schema !== "airlock.contract/v1" ||
    !Array.isArray(contract?.ownedPaths)
  ) {
    allow();
    return;
  }

  if (toolName === "Bash") {
    const command = toolInput?.command ?? "";
    if (broadGitAdd(command)) {
      deny(
        "Airlock contract active: broad staging (`git add -A`, `git add --all`, `git add .`) is blocked. Use scoped `git add <exact paths>` for the current Crossing.",
      );
      return;
    }
    allow();
    return;
  }

  const filePath = toolInput?.file_path ?? toolInput?.notebook_path ?? "";
  if (!filePath) {
    allow();
    return;
  }
  const absolute = path.resolve(workingDirectory, String(filePath));
  const relative = path.relative(located.root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    deny(
      `Airlock contract active: ${absolute} is outside the contract root ${located.root}. STOP and report instead of editing it.`,
    );
    return;
  }
  if (!pathAllowed(relative, contract.ownedPaths)) {
    deny(
      `Airlock contract active: ${normalize(relative)} is not in ownedPaths (.airlock/contract.json). STOP and report instead of editing it; a blocked task reported honestly is a success.`,
    );
    return;
  }
  allow();
}

try {
  main();
} catch {
  allow();
}
