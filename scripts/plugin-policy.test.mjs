import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.join(root, "agents");
const commandsDirectory = path.join(root, "commands");
const leafAgents = [
  "worker.md",
  "code-light.md",
  "code-standard.md",
  "code-complex.md",
  "code-critical.md",
  "investigate.md",
  "verify.md",
  "review.md",
  "visual-review.md",
  "browser-verify.md",
];

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, "missing YAML frontmatter");
  return match[1];
}

test("Airlock exposes explicit commands and no auto-discovered workflow skills", async () => {
  const commands = new Set(await readdir(commandsDirectory));
  for (const command of [
    "start.md",
    "stop.md",
    "setup.md",
    "brainstorm.md",
    "plan.md",
    "ship.md",
    "review.md",
    "debug.md",
  ]) {
    assert.ok(commands.has(command), `missing explicit command: ${command}`);
  }

  const skillsRoot = path.join(root, "skills");
  let skillEntries = [];
  try {
    skillEntries = await readdir(skillsRoot, { recursive: true });
  } catch (error) {
    assert.equal(error.code, "ENOENT", "skills directory must be absent or readable");
  }
  assert.equal(
    skillEntries.some((entry) => path.basename(entry).toUpperCase() === "SKILL.MD"),
    false,
    "workflow SKILL.md would make Airlock eligible for automatic activation",
  );
});

test("activation is session-only and runtime configuration cannot activate Airlock", async () => {
  const [start, stop, setup] = await Promise.all([
    source("commands/start.md"),
    source("commands/stop.md"),
    source("commands/setup.md"),
  ]);

  assert.match(start, /Activate Airlock for this session only/i);
  assert.match(start, /Installation and project configuration never activate it/i);
  assert.match(stop, /Stop applying instructions loaded by `\/airlock:start`/i);
  assert.match(setup, /"schema": "airlock\.config\/v1"/);
  assert.match(setup, /Airlock remains off until \/airlock:start/);
});

test("adaptive routing keeps Quick work to one execution and no process artifacts", async () => {
  const start = await source("commands/start.md");
  assert.match(start, /One execution end-to-end/i);
  assert.match(start, /No design, plan, ledger, Crossing, or independent review/i);
  assert.match(start, /Security, credentials, destructive actions, migrations/i);
  assert.match(start, /dispatch exactly one of `code-light` or `code-standard`/i);
  assert.match(start, /may not delegate again/i);
});

test("start.md carries the canonical base rules other commands reference", async () => {
  const start = await source("commands/start.md");
  assert.match(start, /Airlock base rules/);
  assert.match(start, /## Artifacts and cleanup/);
  assert.match(start, /MUST_FIX, SHOULD_FIX, PARK, or OUT_OF_SCOPE/);
  assert.match(start, /Never broad-glob cleanup/i);
  assert.match(start, /at most five bullets/i);
  for (const command of ["plan.md", "ship.md", "review.md", "debug.md"]) {
    const text = await source(path.join("commands", command));
    assert.match(text, /base rules|base-rules/i, `${command} must reference the base rules`);
  }
});

test("browser-role fallback is codified for hosts that defer MCP tools", async () => {
  const plan = await source("commands/plan.md");
  assert.match(plan, /Browser-role fallback/);
  assert.match(plan, /forced substitution, not a preference/i);
  assert.match(plan, /never access.*credentials.*tokens.*cookies.*local storage.*browser profiles/is);
  assert.match(plan, /console and network.*filtered/i);
  assert.match(plan, /never echo token-bearing URLs/i);
  assert.match(plan, /no edit, stage, or commit during gate execution/i);
  assert.match(plan, /must not invoke `Agent` or `Task`/);
  assert.match(plan, /blocked`?, never simulated/i);
  const visualReview = await source("agents/visual-review.md");
  assert.match(visualReview, /STOP immediately and report the exact capability gap/i);
  assert.match(visualReview, /never simulate, infer, or fabricate/i);
});

test("orchestrator delegation is host-compatible and never absorbs unavailable work", async () => {
  const [orchestrator, start] = await Promise.all([
    source("agents/orchestrator.md"),
    source("commands/start.md"),
  ]);
  assert.match(frontmatter(orchestrator), /^\s*- "Agent"$/m);
  assert.match(frontmatter(orchestrator), /^\s*- AskUserQuestion$/m);
  assert.doesNotMatch(frontmatter(orchestrator), /Agent\(/);
  for (const text of [orchestrator, start]) {
    assert.match(text, /delegation.*unavailable.*STOP/i);
    assert.match(text, /never authorizes inline implementation/i);
    assert.match(text, /inline execution is allowed only.*Quick/i);
    assert.match(text, /browser driving.*git history surgery.*environment repair/is);
  }
});

test("browser leaves are read-only, capability-aware, and token-safe", async () => {
  const browser = await source("agents/browser-verify.md");
  const visual = await source("agents/visual-review.md");
  const metadata = frontmatter(browser);
  assert.match(metadata, /ToolSearch/);
  assert.match(metadata, /mcp__chrome-devtools__/);
  assert.doesNotMatch(metadata, /\b(?:Edit|Write|NotebookEdit|Agent)\b/);
  assert.match(browser, /if the required browser backend is unavailable, STOP and report the exact capability gap/i);
  assert.match(browser, /must not invoke `Agent` or `Task`/i);
  for (const text of [browser, visual]) {
    assert.match(text, /never read .*console.*network.*wholesale/i);
    assert.match(text, /filtered output/i);
    assert.match(text, /token-bearing URLs/i);
  }
});

test("projects pin one browser backend", async () => {
  const conventions = await source("PROJECT-CONVENTIONS.template.md");
  assert.match(conventions, /Browser MCP backend.*exactly one/i);
});

test("external machinery lives in the canonical reference, loaded on demand", async () => {
  const reference = await source("references/EXTERNAL-RUNTIME.md");
  assert.match(reference, /airlock\.external-agent\/v2/);
  const manifestFields = "commit{allowed,crossingId,message,messageSha256,candidatePaths}";
  assert.ok(reference.includes(manifestFields));
  for (const file of [
    "commands/start.md",
    "commands/plan.md",
    "commands/ship.md",
    "agents/orchestrator.md",
  ]) {
    const text = await source(file);
    assert.match(
      text,
      /references\/EXTERNAL-RUNTIME\.md/,
      `${file} must point at the external-runtime reference`,
    );
    assert.equal(
      text.includes(manifestFields),
      false,
      `${file} must not duplicate the manifest schema`,
    );
  }
});

test("guard hook is registered, gated on the dispatch contract, and fail-open", async () => {
  const hooks = JSON.parse(await source("hooks/hooks.json"));
  const preToolUse = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(preToolUse));
  assert.deepEqual(
    preToolUse.map((entry) => entry.matcher),
    ["Bash|PowerShell", "Edit|Write|NotebookEdit|Agent|Task"],
  );
  for (const entry of preToolUse) {
    assert.equal(entry.hooks.length, 1);
    assert.equal(entry.hooks[0].type, "command");
    assert.equal(
      entry.hooks[0].command,
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"',
    );
  }
  assert.ok(
    preToolUse.some((entry) => /Agent/.test(entry.matcher) && /Task/.test(entry.matcher)),
    "Agent and Task calls must reach the guard",
  );
  assert.ok(
    preToolUse.some((entry) => /Bash/.test(entry.matcher) && /PowerShell/.test(entry.matcher)),
    "Bash and PowerShell calls must reach the guard",
  );
  const guard = await source("hooks/guard.mjs");
  assert.match(guard, /airlock\.contract\/v1/);
  assert.match(guard, /airlock\.contract\/v2/);
  assert.match(guard, /Fail-open by design/i);
  const retiredAgent = path.join(agentsDirectory, "external-runner.md");
  let retiredExists = true;
  try {
    await readFile(retiredAgent, "utf8");
  } catch (error) {
    retiredExists = error.code !== "ENOENT";
  }
  assert.equal(retiredExists, false, "external-runner tombstone must stay deleted");
});

test("contract v2 is canonical while v1 remains compatible", async () => {
  const [start, plan, orchestrator, readme] = await Promise.all([
    source("commands/start.md"),
    source("commands/plan.md"),
    source("agents/orchestrator.md"),
    source("README.md"),
  ]);
  for (const [filename, text] of [
    ["commands/start.md", start],
    ["commands/plan.md", plan],
    ["agents/orchestrator.md", orchestrator],
    ["README.md", readme],
  ]) {
    assert.match(text, /airlock\.contract\/v2/, filename + " must name v2 as canonical");
  }
  assert.match(readme, /v1 remains supported/i);
  assert.match(readme, /common.*writes/i);
  assert.match(readme, /not hostile-process containment/i);
  assert.match(plan, /ISO-8601 UTC timestamp no more than 2 hours after dispatch/i);
  assert.doesNotMatch(plan, /2030-01-01T00:00:00\.000Z/);
  for (const [filename, text] of [
    ["commands/start.md", start],
    ["commands/plan.md", plan],
    ["agents/orchestrator.md", orchestrator],
    ["README.md", readme],
  ]) {
    assert.match(text, /top-level.*only.*processPaths.*\.airlock/is, filename + ": orchestrator scope");
    assert.match(text, /(?:subagent|leaf|worker).*only.*ownedPaths/is, filename + ": worker scope");
    assert.match(text, /serialize all file-writing workers/i, filename + ": writer serialization");
  }
});

test("native workers are non-Fable leaves without delegation tools", async () => {
  for (const filename of leafAgents) {
    const markdown = await readFile(path.join(agentsDirectory, filename), "utf8");
    const metadata = frontmatter(markdown);
    assert.match(metadata, /^model: (haiku|sonnet|opus)$/m, filename);
    assert.doesNotMatch(metadata, /^model: (inherit|fable)$/m, filename);
    assert.match(metadata, /^color: /m, filename);
    assert.match(metadata, /^tools: /m, filename);
    assert.doesNotMatch(metadata, /\bAgent(?:\(|,|\])/i, filename);
    assert.doesNotMatch(metadata, /\bSkill\b/i, filename);
    assert.match(markdown, /You are a leaf worker/i, filename);
  }
});

test("main routes require fresh approval for every Fable leaf", async () => {
  const [start, orchestrator] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
  ]);
  for (const text of [start, orchestrator]) {
    assert.match(text, /immediately before that individual invocation/i);
    assert.match(text, /even when (?:the main session uses|you run on) Fable/i);
    assert.match(text, /(?:earlier|prior) Fable leaf/i);
  }
});

test("OpenCode is a depth-zero leaf route", async () => {
  const [start, orchestrator, worker, launcher] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
    source("adapters/opencode/agents/airlock-worker.md"),
    source("scripts/run-external-agent.mjs"),
  ]);
  assert.match(start, /For Quick work, derive the exact manifest scope/i);
  assert.match(start, /create no workflow artifacts/i);
  assert.match(orchestrator, /OpenCode Quick work/i);
  assert.match(orchestrator, /only leaf/i);
  assert.match(worker, /task: deny/);
  assert.match(worker, /Never use .*delegate through `task`/i);
  assert.match(launcher, /config\.subagent_depth !== 0/);
});

test("release metadata agrees and credits the concise-output inspiration", async () => {
  const [pluginText, marketplaceText, readme] = await Promise.all([
    source(".claude-plugin/plugin.json"),
    source(".claude-plugin/marketplace.json"),
    source("README.md"),
  ]);
  const plugin = JSON.parse(pluginText);
  const marketplace = JSON.parse(marketplaceText);
  assert.equal(plugin.version, "2.6.0");
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.match(readme, /ayghri\/i-have-adhd/);
  assert.match(readme, /Cowork/);
});

test("core Full-flow prompt surface has a deliberate ceiling", async () => {
  // This 80 KB LF-normalized ceiling stops the 66.3K -> 73.8K -> 78.4K prompt-growth trend.
  const coreFullFlow = [
    "commands/start.md",
    "commands/plan.md",
    "commands/ship.md",
    "commands/review.md",
    "agents/orchestrator.md",
    "references/LIFECYCLE.md",
  ];
  const contents = await Promise.all(coreFullFlow.map(source));
  const bytes = contents.reduce(
    (total, text) => total + Buffer.byteLength(text.replaceAll("\r\n", "\n"), "utf8"),
    0,
  );
  assert.ok(bytes <= 80_000, `core Full-flow prompt surface is ${bytes} bytes; ceiling is 80000`);
});

test("orchestrator loads start.md via the plugin root, not a bare relative path", async () => {
  const orchestrator = await source("agents/orchestrator.md");
  assert.match(orchestrator, /\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/start\.md/);
  assert.doesNotMatch(orchestrator, /read `commands\/start\.md` from this plugin/i);
  assert.doesNotMatch(orchestrator, /read `commands\/start\.md`(?! from)/i);
});

test("Full work requires a guard-capable host and OpenCode checks its adapter", async () => {
  const [start, ocStart, ocPlan, ocShip, ocBrainstorm, ocReview, ocDebug] = await Promise.all([
    source("commands/start.md"),
    source(".opencode/command/airlock-start.md"),
    source(".opencode/command/airlock-plan.md"),
    source(".opencode/command/airlock-ship.md"),
    source(".opencode/command/airlock-brainstorm.md"),
    source(".opencode/command/airlock-review.md"),
    source(".opencode/command/airlock-debug.md"),
  ]);

  assert.match(start, /Full work .*guard-capable host/i);
  assert.match(start, /Host harness gate/i);
  assert.match(start, /never downgraded to Compact/i);
  assert.match(start, /Claude-hosted Full session .*`runtime: opencode`/i);

  for (const wrapper of [ocStart, ocPlan, ocShip, ocBrainstorm, ocReview]) {
    assert.match(wrapper, /OpenCode host/i, "wrapper declares its host");
    assert.match(wrapper, /airlock_guard_status/i, "wrapper probes the guard");
    assert.match(wrapper, /fullCapable/i, "wrapper requires full capability");
    assert.match(wrapper, /BLOCKED/i, "wrapper blocks");
  }

  assert.match(ocStart, /\*?\*?Quick and Compact\*?\*? work may proceed/i);
  assert.match(ocPlan, /BLOCKED/);
  assert.match(ocDebug, /Quick and Compact debugging/i);
  assert.match(ocDebug, /airlock_guard_status/i);
  assert.match(ocDebug, /BLOCKED/);
});

test("OpenCode adapter delegates policy to the canonical guard", async () => {
  const [plugin, core, config, adapter] = await Promise.all([
    source(".opencode/plugins/airlock-guard.js"),
    source(".opencode/airlock-guard-core.mjs"),
    source("opencode.json"),
    source("adapters/opencode/README.md"),
  ]);
  const { COVERED_TOOLS } = await import("../.opencode/airlock-guard-core.mjs");
  assert.match(plugin, /airlock_guard_status/);
  assert.match(plugin, /tool\.execute\.before/);
  assert.match(plugin, /config: async/);
  assert.match(plugin, /effectiveActor/);
  assert.doesNotMatch(plugin, /const effectiveActor/);
  assert.match(plugin, /!active && input\.tool === "bash" && !shell\.guardToolName/);
  assert.match(plugin, /active && !actor/);
  assert.match(plugin, /runGuardInputs/);
  assert.match(core, /apply_patch cannot change an Airlock ledger/);
  assert.match(core, /validV2Contract/);
  assert.match(core, /resolveShellGuard/);
  assert.match(core, /NODE_EXECUTABLE/);
  assert.deepEqual(COVERED_TOOLS, ["edit", "write", "apply_patch", "bash", "task"]);
  for (const toolName of COVERED_TOOLS) assert.match(adapter, new RegExp("`" + toolName + "`"));
  assert.match(adapter, /Harness divergences/);
  assert.equal(JSON.parse(config).permission.airlock_guard_status, "allow");
});

test("reviewer bundle is executable and pinned to the candidate identity", async () => {
  const [plan, lifecycle] = await Promise.all([
    source("commands/plan.md"),
    source("references/LIFECYCLE.md"),
  ]);
  for (const text of [plan, lifecycle]) {
    assert.match(text, /build-review-bundle\.mjs/);
    assert.match(text, /base SHA \+ staged product-diff hash|commit\/tree/i);
    assert.match(text, /regenerate it, never patch it|regenerate, never patch/i);
    assert.match(text, /task-owned temporary artifact/i);
  }
  assert.match(plan, /fails closed/);
  assert.match(lifecycle, /--max-tokens 15000/);
});

function assertInteractionContract(text, filename) {
  assert.match(text, /exactly one of three forms/i, `${filename}: three forms`);
  assert.match(text, /PROGRESS.*one line/is, `${filename}: progress is one line`);
  assert.match(text, /DECISION.*AskUserQuestion.*concrete options.*recommendation/is, `${filename}: decisions are structured`);
  assert.match(text, /BLOCKED.*at most three lines/is, `${filename}: blocked is bounded`);
  assert.match(text, /status only at work-?package or review-round boundaries/is, `${filename}: status boundary`);
  assert.match(text, /Item \| State \| Next \| Owner/, `${filename}: boundary table`);
  assert.match(text, /about fifteen lines/i, `${filename}: message cap`);
  assert.match(text, /final success.*PROGRESS/is, `${filename}: final success form`);
  assert.match(text, /boundary.*explicit exception.*one-line PROGRESS/is, `${filename}: boundary exception`);
  assert.match(text, /logs.*never user-facing.*stable (?:artifact|link)/is, `${filename}: stable detail link`);
  assert.match(text, /internal audit reasoning.*never shown/is, `${filename}: audit privacy`);
  assert.match(text, /plain language/i, `${filename}: plain language`);
}

test("Airlock main routes share the complete interaction contract", async () => {
  const [start, orchestrator] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
  ]);
  assertInteractionContract(start, "commands/start.md");
  assertInteractionContract(orchestrator, "agents/orchestrator.md");
  assert.doesNotMatch(start, /Return contract for every workflow and worker/i);
  assert.doesNotMatch(start, /^### Interaction contract$/m);
  assert.doesNotMatch(orchestrator, /Return only the outcome and actual verification/i);
});

function markdownSection(markdown, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^## ${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^#{1,2} |(?![\\s\\S]))`, "m"));
  assert.ok(match, `missing section: ${heading}`);
  return match[0];
}

test("approval checkpoints link their detailed work-package artifacts", async () => {
  const [brainstorm, plan] = await Promise.all([
    source("commands/brainstorm.md"),
    source("commands/plan.md"),
  ]);
  const brainstormCheckpoint = markdownSection(brainstorm, "Approval message");
  const planCheckpoint = markdownSection(plan, "Approval message");
  assert.match(brainstormCheckpoint, /AskUserQuestion.*concrete options.*recommendation.*no more than three sentences.*Link.*proposed\/unapproved specification.*work-package table/is);
  assert.match(planCheckpoint, /AskUserQuestion.*concrete options.*recommendation.*no more than three sentences.*Link.*written plan.*work-package table/is);
  assert.match(brainstorm, /write.*proposed\/unapproved specification.*before approval/is);
});

test("Full and Compact implementation routes are subagent-only", async () => {
  const [start, orchestrator, plan, brainstorm] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
    source("commands/plan.md"),
    source("commands/brainstorm.md"),
  ]);
  assert.match(start, /\| Compact .*one leaf worker/i);
  assert.match(orchestrator, /\*\*Compact\*\*.*one leaf worker/i);
  assert.match(plan, /Full implementation routes are subagent-only/i);
  assert.doesNotMatch(plan, /\|\s*<IDs>\s*\|[^\r\n]*\|\s*inline(?:\/subagent)?\s*\|/i);
  assert.doesNotMatch(plan, /mix inline and subagent tasks/i);
  assert.match(brainstorm, /reclassify.*\/airlock:start.*Quick.*before.*inline/is);
  assert.doesNotMatch(brainstorm, /implement directly only if genuinely trivial/i);
});

test("review triage approval is an explicit structured checkpoint", async () => {
  const review = await source("commands/review.md");
  assert.match(review, /AskUserQuestion.*triage checkpoint/is);
});

test("Full work has one current dashboard and an archive lifecycle", async () => {
  const [start, plan, ship, review, status] = await Promise.all([
    source("commands/start.md"),
    source("commands/plan.md"),
    source("commands/ship.md"),
    source("commands/review.md"),
    source("references/STATUS.template.md"),
  ]);
  for (const text of [start, plan, ship, review]) assert.match(text, /docs\/airlock\/STATUS\.md/);
  assert.match(plan, /docs\/airlock\/(?:ledger|plans|specs)/);
  assert.match(ship, /archive\/YYYY-MM/);
  assert.match(ship, /all work packages.*accepted/is);
  assert.match(status, /Open work packages/);
  assert.match(status, /Open items/);
  assert.match(status, /Recently closed/);
  assert.match(status, /last five/i);
  const tables = status.match(/^\|[^\r\n]+\|\r?\n\|(?:---\|)+\r?$/gm) ?? [];
  assert.equal(tables.length, 3, "STATUS template must contain exactly three Markdown tables");
  assert.match(status, /\[design\]\(<spec-path>\).*\[plan\]\(<plan-path>\).*\[ledger\]\(<ledger-path>\)/);
  assert.match(status, /Age \(rounds\)/);
  assert.doesNotMatch(status, /^## (?:TODOs?|Bugs?)\b/im);
});

test("MUST_FIX items age and require explicit deferral", async () => {
  const [review, ledger] = await Promise.all([
    source("commands/review.md"), source("references/LEDGER.template.md"),
  ]);
  assert.match(ledger, /Age \(rounds\)/);
  assert.match(review, /MUST_FIX.*first/is);
  assert.match(review, /dependency.*dispatch/is);
  assert.match(review, /AskUserQuestion.*deferr/is);
});

test("SessionStart compact injects one conditional Airlock resume context line", async () => {
  const hooksText = await source("hooks/hooks.json");
  const hooks = JSON.parse(hooksText);
  assert.equal(hooks.hooks.PreCompact, undefined);
  const entries = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length === 1);
  assert.equal(entries[0].matcher, "compact");
  assert.match(entries[0].hooks[0].command, /compact-context\.mjs/);

  const scriptPath = path.join(root, "hooks", "compact-context.mjs");
  const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /When Airlock Full work is active/i);
  assert.match(lines[0], /otherwise ignore/i);
  assert.match(lines[0], /design.*plan.*ledger.*Resume checkpoint.*sections it names.*docs\/airlock\/STATUS\.md/i);
  assert.match(lines[0], /never reread the whole ledger/i);

  const policySources = await Promise.all([
    source("commands/start.md"),
    source("commands/plan.md"),
    source("agents/orchestrator.md"),
    source("README.md"),
  ]);
  assert.doesNotMatch([hooksText, ...policySources].join("\n"), /PreCompact/i);
});

test("code leaves simplify only their own GREEN changes before return", async () => {
  for (const filename of ["code-light.md", "code-standard.md", "code-complex.md", "code-critical.md"]) {
    const text = await source(path.join("agents", filename));
    assert.match(text, /after GREEN/i, filename);
    assert.match(text, /simplif/i, filename);
    assert.match(text, /same owned paths/i, filename);
    assert.match(text, /tests stay green|rerun.*test/i, filename);
  }
});

test("missing runtime configuration is checked silently", async () => {
  const start = await source("commands/start.md");
  assert.match(start, /check whether `.airlock\/config\.json` exists before reading/i);
  assert.match(start, /when absent.*native.*without.*error/is);
});

test("adaptive ceremony uses the multipurpose worker within explicit dispatch budgets", async () => {
  const [worker, start, orchestrator] = await Promise.all([
    source("agents/worker.md"),
    source("commands/start.md"),
    source("agents/orchestrator.md"),
  ]);
  const metadata = frontmatter(worker);
  assert.match(metadata, /^name: worker$/m);
  assert.match(metadata, /^model: sonnet$/m);
  assert.doesNotMatch(metadata, /\b(?:Agent|Task|Skill)\b/);
  assert.match(worker, /investigate, implement, and verify.*one run/is);
  assert.match(worker, /cannot review your own work/i);
  assert.match(worker, /replaces.*investigate.*code.*verify.*not.*independent.*review/is);
  for (const [filename, text] of [["start", start], ["orchestrator", orchestrator]]) {
    assert.match(text, /Quick.*0.?1/is, filename + ": Quick budget");
    assert.match(text, /Compact.*1.?2/is, filename + ": Compact budget");
    assert.match(text, /Full-lite.*(?:at most|=).*3.*Crossing/is, filename + ": Full-lite budget");
    assert.match(text, /prefer `worker`.*investigate.*code.*verify/is, filename + ": worker preference");
    assert.match(text, /investigation.*user decision|Critical|independence/is, filename + ": specialist exceptions");
    assert.match(text, /exceed.*budget.*PROGRESS.*reason/is, filename + ": budget exception");
  }
});

test("right-weighting defaults down and keeps independent verification pack-level", async () => {
  const [start, plan, ship, orchestrator, complex, critical, lifecycle, adapter] = await Promise.all([
    source("commands/start.md"),
    source("commands/plan.md"),
    source("commands/ship.md"),
    source("agents/orchestrator.md"),
    source("agents/code-complex.md"),
    source("agents/code-critical.md"),
    source("references/LIFECYCLE.md"),
    source("adapters/opencode/README.md"),
  ]);

  for (const [filename, text] of [["start", start], ["orchestrator", orchestrator]]) {
    assert.match(text, /(?:name|named).*irreversible or cross-cutting surface/i, filename + ": bounded escalation");
    assert.match(text, /(?:uncertainty is about approach|approach uncertainty).*(?:investigate|read-only).*worker/i, filename + ": investigate approach uncertainty");
    assert.match(text, /unnamed uncertainty.*not grounds for escalation/i, filename + ": unnamed uncertainty defaults down");
    assert.match(text, /at most one `code-critical`.*at most two `code-complex`/i, filename + ": weight budget");
    assert.match(text, /weight budgets?.*(?:additional|separate).*count budgets?/i, filename + ": independent budgets");
  }

  assert.match(plan, /If you cannot name which criterion is met, the class is Standard/i);
  assert.match(plan, /touches at least three modules/i);
  assert.match(plan, /shared interface other code depends on/i);
  assert.match(plan, /published contract others consume/i);
  assert.match(plan, /route row claiming Complex or Critical without its named criterion in `Why \/ criterion \/ independence` is invalid/i);
  assert.match(plan, /Selected leaf \/ runtime.*Selected model \/ variant.*Why \/ criterion \/ independence/i);
  assert.doesNotMatch(plan, /\| Pack \/ Crossing \/ task \|[^\r\n]*\| Named criterion \|/i);
  assert.match(plan, /pass the selected model with the individual `Agent` dispatch/i);
  assert.match(plan, /OpenCode.*resolved model\/variant matches the approved route row/i);
  assert.match(frontmatter(complex), /^model: sonnet$/m);
  assert.match(frontmatter(critical), /^model: opus$/m);

  assert.match(plan, /\| Gate ID .*Executed by.*Execution reason/is);
  assert.doesNotMatch(plan, /\| Gate ID .*Executor host role/is);
  assert.match(plan, /`implementer`.*`orchestrator-inline`.*`independent`/is);
  assert.match(plan, /Deterministic checks.*implementer.*orchestrator-inline/i);
  assert.match(plan, /per-Crossing gate marked `independent` requires a one-line reason/i);
  for (const [filename, text] of [["plan", plan], ["ship", ship], ["lifecycle", lifecycle]]) {
    assert.match(text, /Independent verification is .*pack-level by default/i, filename + ": pack-level default");
  }
  assert.match(ship, /Do not dispatch a verifier per Crossing unless.*`independent`.*stated reason/i);
  assert.match(adapter, /do not declare a project `verify` subagent merely for deterministic checks/i);
});

test("release work is Compact until a direct publication mutation", async () => {
  const [start, orchestrator, readme, conventions] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
    source("README.md"),
    source("PROJECT-CONVENTIONS.template.md"),
  ]);
  for (const [filename, text] of [["start", start], ["orchestrator", orchestrator], ["README", readme]]) {
    assert.match(text, /release PR.*Compact.*default/is, filename);
    assert.match(text, /version bump.*changelog.*validation.*(?:open|opening).*PR/is, filename);
    assert.match(text, /tag.*marketplace|registry|deploy/is, filename);
    assert.match(text, /mutating step.*DECISION|DECISION.*mutating step/is, filename);
    assert.match(text, /migrations.*credential.*irreversible.*Full/is, filename);
  }
  assert.match(conventions, /plugin\.json.*marketplace\.json.*changelog.*README/is);
  assert.match(conventions, /five test suites.*claude plugin validate.*both manifests/is);
  assert.match(conventions, /branch.*PR.*DECISION.*after.*merge.*tag.*publish.*second DECISION/is);
});

test("setup v2 bootstraps one shared browser backend across selected harnesses and hosts", async () => {
  const [setup, start, readme, openCodeSetup] = await Promise.all([
    source("commands/setup.md"),
    source("commands/start.md"),
    source("README.md"),
    source(".opencode/command/airlock-setup.md"),
  ]);
  assert.match(setup, /interactive bootstrap/i);
  assert.match(setup, /idempotent.*reconcil/is);
  assert.match(setup, /exactly one.*playwright.*chrome-devtools.*none/is);
  assert.match(setup, /claude.*opencode.*both/is);
  assert.match(setup, /merge.*never silently overwrite.*show.*diff.*stop/is);
  assert.match(setup, /"schema": "airlock\.config\/v2"/);
  assert.match(setup, /"host".*"os".*"machine"/is);
  assert.match(setup, /\.airlock\/config\.<hostname>\.json/);
  assert.match(setup, /\.mcp\.json.*mcpServers/is);
  assert.match(setup, /opencode\.jsonc?.*"mcp".*"type": "local".*"command": \[/is);
  assert.match(setup, /"environment"/);
  assert.match(setup, /--storage-state.*never `--isolated`.*never.*default profile/is);
  assert.match(setup, /--user-data-dir.*--browserUrl/is);
  assert.match(setup, /native Windows.*"cmd".*"\/c".*"npx"/is);
  assert.match(setup, /OpenCode.*`npx\.cmd`/is);
  assert.match(setup, /@playwright\/mcp@latest/);
  assert.match(setup, /chrome-devtools-mcp@latest/);
  assert.match(setup, /exact.*launch.*(?:command|argv).*config/is);
  assert.match(setup, /Playwright.*state file.*chrome-devtools.*profile.*browserUrl/is);
  assert.match(setup, /re-run \/airlock:setup on this host/i);
  assert.match(setup, /state file.*never.*ownedPaths.*processPaths/is);
  assert.match(setup, /one-line human login command.*wait.*state file exists/is);
  assert.match(setup, /backend reachable.*auth signal/is);
  assert.match(start, /browser gate.*preflight.*refreshCommand/is);
  assert.match(readme, /airlock\.config\/v1.*remain.*valid/is);
  assert.match(readme, /exact.*backend launch command/is);
  assert.match(openCodeSetup, /browser.*bootstrap/i);
});

test("browser leaves return the configured refresh command on auth failure", async () => {
  for (const filename of ["agents/browser-verify.md", "agents/visual-review.md"]) {
    const text = await source(filename);
    assert.match(text, /auth.*failure.*BLOCKED.*refreshCommand.*verbatim/is, filename);
    assert.match(text, /never reads?.*state file/i, filename);
  }
});
test("unattended mode parks decisions, resumes answers, and stops at hard gates or budget", async () => {
  const [start, orchestrator, review, plan, status, decisions, readme] = await Promise.all([
    source("commands/start.md"),
    source("agents/orchestrator.md"),
    source("commands/review.md"),
    source("commands/plan.md"),
    source("references/STATUS.template.md"),
    source("references/DECISIONS.template.md"),
    source("README.md"),
  ]);
  assert.match(plan, /unattended.*park.*approval|park.*approval.*unattended/is);
  for (const [filename, text] of [["start", start], ["orchestrator", orchestrator], ["review", review]]) {
    assert.match(text, /--unattended|AskUserQuestion.*unavailable/is, filename + ": activation");
    assert.match(text, /read.*DECISIONS\.md.*first/is, filename + ": resume first");
    assert.match(text, /blocked-on-user/is, filename + ": parked package");
    assert.match(text, /continue.*next unblocked/is, filename + ": continue queue");
    assert.match(text, /decision: <option>.*answered.*ledger.*unblock/is, filename + ": answer lifecycle");
  }
  assert.match(start, /Airlock: <weight>, <native\|opencode>, unattended/);
  assert.match(start, /max Crossings.*default 5.*wall-clock/is);
  assert.match(start, /design approval.*always-Full.*merges to main.*publication/is);
  assert.match(start, /Last unattended run.*Completed.*Parked decisions.*Blocked.*Budget used.*Next action/is);
  assert.match(decisions, /\| ID \| Asked \| Question \| Options \(2.?4\) \| Recommendation \| Blocks \| Status \|/);
  assert.match(decisions, /Status.*open/i);
  assert.match(status, /## Last unattended run/);
  assert.match(readme, /DECISIONS\.md.*questions waiting for you/i);
  assert.match(
    review,
    /Before any unrelated implementation.*In attended mode, use `AskUserQuestion`; in unattended mode, park the deferral decision/is,
  );
});

test("every dispatch gets a minimal non-delegating contract", async () => {
  const [start, plan, orchestrator] = await Promise.all([
    source("commands/start.md"),
    source("commands/plan.md"),
    source("agents/orchestrator.md"),
  ]);
  for (const [filename, text] of [["start", start], ["plan", plan], ["orchestrator", orchestrator]]) {
    assert.match(text, /before every dispatch/is, filename);
    assert.match(text, /read-only.*ownedPaths.*\[\].*allowDispatch.*false/is, filename);
  }
});

test("release sources and accepted designs have the required archive and line-ending policy", async () => {
  const attributes = await source(".gitattributes");
  assert.equal(
    attributes.replaceAll("\r\n", "\n"),
    "* text=auto\n*.md text eol=lf\n*.mjs text eol=lf\n*.json text eol=lf\n",
  );
  for (const archived of [
    "docs/airlock/archive/2026-08/2026-08-13-airlock-improvements-design.md",
    "docs/airlock/archive/2026-08/2026-08-14-airlock-2.3-design.md",
  ]) {
    assert.match(await source(archived), /^# Airlock/m, archived);
  }
});
