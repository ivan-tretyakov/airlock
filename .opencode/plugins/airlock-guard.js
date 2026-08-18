import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
  activeV2Contract,
  COVERED_TOOLS,
  effectiveActor,
  guardInputsForOpenCode,
  nodeRuntimeAvailable,
  resolveShellGuard,
  runGuardInputs,
} from "../airlock-guard-core.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const guardPath = path.join(sourceRoot, "hooks", "guard.mjs");

function sourceVersion() {
  try {
    return JSON.parse(readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

export const AirlockGuardPlugin = async ({ client, worktree }) => {
  let shell = resolveShellGuard();
  const healthy = () => existsSync(guardPath) && sourceVersion() !== "unknown" && nodeRuntimeAvailable() && Boolean(shell.guardToolName);
  const sessions = new Map();
  const sessionInfo = (sessionID) => {
    if (!sessions.has(sessionID)) {
      sessions.set(
        sessionID,
        client.session
          .get({ path: { id: sessionID }, query: { directory: worktree } })
          .then((response) => {
            const session = response?.data ?? response;
            if (!session || typeof session !== "object") return { actor: undefined, directory: worktree };
            return {
              actor: session.parentID ? "worker" : "top-level",
              directory: typeof session.directory === "string" ? session.directory : worktree,
            };
          })
          .catch(() => ({ actor: undefined, directory: worktree })),
      );
    }
    return sessions.get(sessionID);
  };
  const directoryFor = (toolName, args, sessionDirectory) => {
    if (toolName === "bash" && typeof args.workdir === "string") return path.resolve(sessionDirectory, args.workdir);
    return sessionDirectory;
  };
  const status = async (sessionID, fallbackDirectory) => {
    const session = await sessionInfo(sessionID);
    const directory = session.directory ?? fallbackDirectory;
    const active = activeV2Contract(directory);
    const actor = effectiveActor(active?.contract, session.actor);
    return {
      healthy: healthy(),
      version: sourceVersion(),
      guardPath,
      coveredTools: COVERED_TOOLS,
      shell: shell.shell,
      shellAnalyser: shell.guardToolName ?? "unsupported",
      activeContract: Boolean(active),
      actor: actor ?? "unresolved",
      fullCapable: Boolean(healthy() && (!active || actor)),
      sessionID,
    };
  };

  return {
    config: async (config) => {
      shell = resolveShellGuard(config.shell);
    },
    tool: {
      airlock_guard_status: tool({
        description: "Reports whether this OpenCode host can enforce an active Airlock Full-work contract.",
        args: {},
        async execute(_args, context) {
          return JSON.stringify(await status(context.sessionID, context.worktree));
        },
      }),
    },
    "tool.execute.before": async (input, output) => {
      if (!COVERED_TOOLS.includes(input.tool)) return;
      const session = await sessionInfo(input.sessionID);
      const directory = directoryFor(input.tool, output.args, session.directory ?? worktree);
      const active = activeV2Contract(directory);
      const actor = effectiveActor(active?.contract, session.actor);
      if (active && !actor) {
        throw new Error("Airlock contract active: OpenCode actor attribution is unavailable, so this operation is denied.");
      }
      if (active && input.tool === "bash" && !shell.guardToolName) {
        throw new Error("Airlock contract active: OpenCode shell is unsupported for Airlock guard enforcement.");
      }
      if (!active && input.tool === "bash" && !shell.guardToolName) return;
      const actorForGuard = actor ?? "top-level";
      const guardInputs = guardInputsForOpenCode({
        tool: input.tool,
        args: output.args,
        worktree: directory,
        actor: actorForGuard,
        shellToolName: shell.guardToolName,
      });
      const verdict = runGuardInputs(guardPath, guardInputs);
      if (verdict.decision === "deny") throw new Error(verdict.reason);
    },
  };
};
