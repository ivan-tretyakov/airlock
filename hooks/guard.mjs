// Airlock guard hook (PreToolUse).
//
// Inert unless an active dispatch contract exists: the orchestrator writes
// `.airlock/contract.json` (schema `airlock.contract/v2`) immediately before a
// file-writing worker runs and deletes it after the return audit. While the
// contract exists, this hook deterministically:
//   1. denies Edit/Write/NotebookEdit targets outside the contract's
//      owned and process paths;
//   2. denies worker dispatch unless the contract explicitly allows it; and
//   3. denies broad staging plus obvious out-of-contract shell writes.
//
// Fail-open by design for a missing, unreadable, malformed, or expired
// contract. Once a valid v2 contract is active, evaluation errors fail closed.
// Contract v1 retains its original behavior for compatibility.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const DEFAULT_PROCESS_PATHS = [
  "docs/airlock/**",
  "docs/ledger/**",
  "docs/plans/**",
  "docs/specs/**",
];

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

function contractExpired(contract, now = Date.now()) {
  if (contract.expiresAt === undefined) return false;
  const expiresAt = Date.parse(contract.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function validIsoTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (zone !== "Z") {
    const [zoneHour, zoneMinute] = zone.slice(1).split(":").map(Number);
    if (zoneHour > 23 || zoneMinute > 59) {
      return false;
    }
  }
  return true;
}

function validPathEntries(entries) {
  return (
    Array.isArray(entries) &&
    entries.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function validV2Contract(contract) {
  return (
    validPathEntries(contract.ownedPaths) &&
    (contract.root === undefined ||
      (typeof contract.root === "string" && path.isAbsolute(contract.root))) &&
    (contract.processPaths === undefined || validPathEntries(contract.processPaths)) &&
    (contract.expiresAt === undefined || validIsoTimestamp(contract.expiresAt)) &&
    (contract.allowDispatch === undefined || typeof contract.allowDispatch === "boolean") &&
    (contract.actorMode === undefined ||
      ["agent-id", "trust-toplevel", "single-actor"].includes(contract.actorMode))
  );
}

function normalizeAbsolute(absolutePath) {
  const normalized = path.normalize(String(absolutePath))
    .split(path.sep)
    .join("/")
    .replace(/\\/g, "/");
  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLowerCase()
    : normalized;
}

function absolutePattern(entry, root) {
  const absolute = path.isAbsolute(entry) ? entry : path.resolve(root, entry);
  return normalizeAbsolute(canonicalizeTarget(absolute));
}

function patternMatchesAbsolute(target, pattern) {
  if (pattern.endsWith("/")) {
    return target.startsWith(pattern) || target + "/" === pattern;
  }
  if (target === pattern) {
    return true;
  }
  return /[*?]/.test(pattern) && globToRegExp(pattern).test(target);
}

function pathAllowedAbsolute(absoluteTarget, patterns) {
  const target = normalizeAbsolute(absoluteTarget);
  return patterns.some((pattern) => patternMatchesAbsolute(target, pattern));
}

function broadGitAdd(command, denyUnscopedUpdate = false) {
  // Examine each shell segment so `git commit -m "x" && git add -A` is caught
  // while `grep "git add -A" notes.md` inside quotes is tolerated as a
  // conservative false positive we accept for determinism.
  const segments = String(command).split(/(?:&&|\|\||;|\||\n)/);
  for (const segment of segments) {
    const tokens = shellTokens(segment);
    const gitIndex = tokens.findIndex((token) =>
      /^git(\.exe)?$/i.test(shellCommandName(token))
    );
    if (gitIndex === -1) {
      continue;
    }
    let addIndex = -1;
    for (let index = gitIndex + 1; index < tokens.length; index += 1) {
      const token = unquoteShellToken(tokens[index]);
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
    const addArguments = tokens.slice(addIndex + 1).map(unquoteShellToken);
    const updateRequested = addArguments.some(
      (argument) => argument === "-u" || argument === "--update",
    );
    if (denyUnscopedUpdate && updateRequested) {
      const separatorIndex = addArguments.indexOf("--");
      const pathspecs = separatorIndex === -1
        ? addArguments.filter((argument) => !argument.startsWith("-"))
        : addArguments.slice(separatorIndex + 1);
      if (pathspecs.length === 0) {
        return true;
      }
    }
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

function shellTokens(command) {
  return String(command).match(
    /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\r?\n|&\d+|>>|<<|>|<|&&|\|\||[|;&]|[^\s><|;&]+/g,
  ) ?? [];
}

function unquoteShellToken(token) {
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function parseObviousShellWriteOperands(command) {
  const tokens = shellTokens(command);
  const targets = [];
  const operators = new Set([
    "&&", "||", "|", ";", "&", "\n", "\r\n", ">", ">>", "<", "<<",
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ">" || token === ">>") {
      const target = tokens[index + 1];
      if (target && !operators.has(target) && !/^&\d+$/.test(target)) {
        targets.push(unquoteShellToken(target));
      }
      continue;
    }
    const commandBoundary =
      index === 0 ||
      ["&&", "||", "|", ";", "&", "\n", "\r\n"].includes(tokens[index - 1]);
    if (!commandBoundary || !/^tee(?:\.exe)?$/i.test(token)) {
      continue;
    }
    let parsingOptions = true;
    for (let operandIndex = index + 1; operandIndex < tokens.length; operandIndex += 1) {
      const operand = tokens[operandIndex];
      if (operators.has(operand)) {
        break;
      }
      if (parsingOptions && operand === "--") {
        parsingOptions = false;
        continue;
      }
      if (parsingOptions && operand.startsWith("-")) {
        continue;
      }
      parsingOptions = false;
      targets.push(unquoteShellToken(operand));
    }
  }
  return targets.filter((target) => target.length > 0);
}

const SHELL_BOUNDARIES = new Set(["&&", "||", "|", ";", "&", "\n", "\r\n"]);
const POWERSHELL_COMMAND_BOUNDARIES = new Set([
  ...SHELL_BOUNDARIES,
  "{",
  "(",
]);
const POWERSHELL_SEGMENT_ENDS = new Set([
  ...SHELL_BOUNDARIES,
  "{",
  "}",
  "(",
  ")",
]);
const POWERSHELL_WRITE_COMMANDS = new Set([
  "set-content",
  "add-content",
  "out-file",
  "new-item",
]);

function shellCommandName(token) {
  return unquoteShellToken(token).split(/[\\/]/).at(-1).toLowerCase();
}

function commandBoundary(tokens, index) {
  return index === 0 || SHELL_BOUNDARIES.has(tokens[index - 1]);
}

function powerShellTokens(command) {
  return String(command).match(
    /"(?:\`.|[^"])*"|'(?:''|[^'])*'|\r?\n|&&|\|\||>>|<<|[{}(),;|&><]|[^\s{}(),;|&><]+/g,
  ) ?? [];
}

function powerShellCommandBoundary(tokens, index) {
  return index === 0 || POWERSHELL_COMMAND_BOUNDARIES.has(tokens[index - 1]);
}

function parsePowerShellPathExpression(tokens, startIndex) {
  const targets = [];
  let index = startIndex;
  let needsValue = true;
  let consumed = false;
  let unresolved = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (POWERSHELL_SEGMENT_ENDS.has(token) || /^-[A-Za-z]/.test(token)) {
      break;
    }
    if (token === ",") {
      if (!consumed || needsValue) {
        unresolved = true;
      }
      needsValue = true;
      index += 1;
      continue;
    }
    if (consumed && !needsValue) {
      break;
    }

    const value = unquoteShellToken(token);
    if (!value || /['"]/.test(value)) {
      unresolved = true;
    } else {
      targets.push(value);
      consumed = true;
      needsValue = false;
    }
    index += 1;
  }

  if (!consumed || needsValue) {
    unresolved = true;
  }
  return { targets, unresolved };
}

function parsePowerShellWriteOperands(command) {
  const tokens = powerShellTokens(command);
  const targets = [];
  let unresolved = false;

  for (let index = 0; index < tokens.length; index += 1) {
    if (!powerShellCommandBoundary(tokens, index)) {
      continue;
    }
    const commandName = shellCommandName(tokens[index]);
    if (!POWERSHELL_WRITE_COMMANDS.has(commandName)) {
      continue;
    }

    let end = index + 1;
    while (end < tokens.length && !POWERSHELL_SEGMENT_ENDS.has(tokens[end])) {
      end += 1;
    }
    const argumentsForCommand = tokens.slice(index + 1, end);
    const pathOption = argumentsForCommand.findIndex((argument) =>
      /^-(?:LiteralPath|Path|FilePath)$/i.test(argument)
    );
    const targetIndex = pathOption === -1 ? 0 : pathOption + 1;
    if (
      !argumentsForCommand[targetIndex] ||
      POWERSHELL_SEGMENT_ENDS.has(argumentsForCommand[targetIndex]) ||
      (pathOption === -1 && argumentsForCommand[targetIndex].startsWith("-"))
    ) {
      unresolved = true;
      continue;
    }
    const parsed = parsePowerShellPathExpression(argumentsForCommand, targetIndex);
    targets.push(...parsed.targets);
    unresolved ||= parsed.unresolved;
  }

  return { targets, unresolved };
}

function containsDirectoryChange(command, powershell) {
  const tokens = powershell ? powerShellTokens(command) : shellTokens(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const atCommand = powershell
      ? powerShellCommandBoundary(tokens, index)
      : commandBoundary(tokens, index);
    if (!atCommand) {
      continue;
    }
    if (
      ["cd", "chdir", "set-location", "sl", "pushd", "popd"].includes(
        shellCommandName(tokens[index]),
      )
    ) {
      return true;
    }
  }
  return false;
}

function dynamicShellTarget(target) {
  return /[$*?{}\[\]()]/.test(target);
}

function canonicalizeTarget(targetPath) {
  const resolved = path.resolve(String(targetPath));
  const suffix = [];
  let ancestor = resolved;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return resolved;
    }
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = realpathSync.native
    ? realpathSync.native(ancestor)
    : realpathSync(ancestor);
  return path.join(canonicalAncestor, ...suffix);
}

function shellWriteAnalysis(command, workingDirectory, powershell) {
  const redirectionTargets = parseObviousShellWriteOperands(command);
  const powershellWrites = powershell
    ? parsePowerShellWriteOperands(command)
    : { targets: [], unresolved: false };
  const operands = [...redirectionTargets, ...powershellWrites.targets];
  const unresolved = powershellWrites.unresolved || operands.some(dynamicShellTarget);
  return {
    targets: operands.map((target) =>
      canonicalizeTarget(path.resolve(workingDirectory, target))
    ),
    unresolved,
    unsafeDirectoryChange:
      operands.length > 0 && containsDirectoryChange(command, powershell),
  };
}

function containsAirlockDirectory(target) {
  return normalizeAbsolute(target).split("/").includes(".airlock");
}

function v2TargetAllowed(absoluteTarget, actor, policy) {
  const lexicalTarget = path.resolve(String(absoluteTarget));
  const canonicalTarget = canonicalizeTarget(lexicalTarget);
  if (actor === "top-level") {
    return {
      allowed: pathAllowedAbsolute(canonicalTarget, policy.topLevelPatterns),
      target: canonicalTarget,
    };
  }
  if (
    containsAirlockDirectory(lexicalTarget) ||
    containsAirlockDirectory(canonicalTarget) ||
    pathAllowedAbsolute(lexicalTarget, policy.workerReservedPatterns) ||
    pathAllowedAbsolute(canonicalTarget, policy.workerReservedPatterns)
  ) {
    return { allowed: false, target: canonicalTarget };
  }
  return {
    allowed: pathAllowedAbsolute(canonicalTarget, policy.workerPatterns),
    target: canonicalTarget,
  };
}

function actorFor(input, contract) {
  const actorMode = contract.actorMode ?? "agent-id";
  if (actorMode === "single-actor") {
    return "worker";
  }
  if (actorMode === "trust-toplevel") {
    return "top-level";
  }
  return input?.agent_id === undefined ? "top-level" : "worker";
}

let activeV2MustFailClosed = false;

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

  if (contract?.schema === "airlock.contract/v2") {
    if (!validV2Contract(contract)) {
      allow();
      return;
    }
    if (contractExpired(contract)) {
      allow();
      return;
    }
    activeV2MustFailClosed = true;

    const contractRoot = contract.root ?? located.root;
    const actor = actorFor(input, contract);
    const workerPatterns = contract.ownedPaths.map((entry) =>
      absolutePattern(entry, contractRoot)
    );
    const explicitProcessPatterns = (contract.processPaths ?? []).map((entry) =>
      absolutePattern(entry, contractRoot)
    );
    const defaultProcessPatterns = DEFAULT_PROCESS_PATHS.map((entry) =>
      absolutePattern(entry, contractRoot)
    );
    const controlPatterns = [
      absolutePattern(path.join(path.dirname(located.contractPath), "**"), contractRoot),
    ];
    const policy = {
      topLevelPatterns: [...explicitProcessPatterns, ...controlPatterns],
      workerPatterns,
      workerReservedPatterns: [
        ...defaultProcessPatterns,
        ...explicitProcessPatterns,
        ...controlPatterns,
      ],
    };

    if (toolName === "Agent" || toolName === "Task") {
      if (actor === "worker" && contract.allowDispatch !== true) {
        deny(
          "Airlock contract active: subagent dispatch is blocked unless allowDispatch is explicitly true.",
        );
        return;
      }
      allow();
      return;
    }

    if (toolName === "Bash" || toolName === "PowerShell") {
      const command = toolInput?.command ?? "";
      if (broadGitAdd(command, true)) {
        deny(
          "Airlock contract active: broad staging is blocked. Use scoped git add with exact paths for the current Crossing.",
        );
        return;
      }
      const shellWrites = shellWriteAnalysis(
        command,
        workingDirectory,
        toolName === "PowerShell",
      );
      if (shellWrites.unresolved) {
        deny(
          "Airlock contract active: a shell write target cannot be resolved safely. Use an explicit literal path.",
        );
        return;
      }
      if (shellWrites.unsafeDirectoryChange) {
        deny(
          "Airlock contract active: a write-bearing compound command changes directory. Split the directory change from the write so scope can be checked.",
        );
        return;
      }
      const deniedWrite = shellWrites.targets
        .map((target) => v2TargetAllowed(target, actor, policy))
        .find((verdict) => !verdict.allowed);
      if (deniedWrite) {
        deny(
          "Airlock contract active: shell write target " + deniedWrite.target +
            " is outside the actor's allowed paths. STOP and report instead of writing it.",
        );
        return;
      }
      allow();
      return;
    }

    const v2FilePath = toolInput?.file_path ?? toolInput?.notebook_path ?? "";
    if (!v2FilePath) {
      allow();
      return;
    }
    const v2Verdict = v2TargetAllowed(
      path.resolve(workingDirectory, String(v2FilePath)),
      actor,
      policy,
    );
    if (!v2Verdict.allowed) {
      deny(
        "Airlock contract active: " + v2Verdict.target +
          " is outside the actor's allowed paths. STOP and report instead of editing it.",
      );
      return;
    }
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

  if (toolName === "Bash" || toolName === "PowerShell") {
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
  if (activeV2MustFailClosed) {
    deny(
      "Airlock contract active: guard evaluation failed, so this v2 operation is denied.",
    );
  } else {
    allow();
  }
}
