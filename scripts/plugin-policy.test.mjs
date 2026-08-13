import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.join(root, "agents");
const commandsDirectory = path.join(root, "commands");
const leafAgents = [
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
  assert.ok(Array.isArray(preToolUse) && preToolUse.length >= 2);
  for (const entry of preToolUse) {
    assert.match(entry.hooks[0].command, /guard\.mjs/);
  }
  assert.ok(
    preToolUse.some((entry) => /Agent/.test(entry.matcher) && /Task/.test(entry.matcher)),
    "Agent and Task calls must reach the guard",
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
  assert.equal(plugin.version, "2.1.0");
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.match(readme, /ayghri\/i-have-adhd/);
  assert.match(readme, /Cowork/);
});

function assertInteractionContract(text, filename) {
  assert.match(text, /exactly one of three forms/i, `${filename}: three forms`);
  assert.match(text, /PROGRESS.*one line/is, `${filename}: progress is one line`);
  assert.match(text, /DECISION.*AskUserQuestion.*concrete options.*recommendation/is, `${filename}: decisions are structured`);
  assert.match(text, /BLOCKED.*at most three lines/is, `${filename}: blocked is bounded`);
  assert.match(text, /status only at work-?package or review-round boundaries/is, `${filename}: status boundary`);
  assert.match(text, /Item \| State \| Next \| Owner/, `${filename}: boundary table`);
  assert.match(text, /about fifteen lines/i, `${filename}: message cap`);
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

test("PreCompact injects the Airlock resume reminder", async () => {
  const hooks = JSON.parse(await source("hooks/hooks.json"));
  const entries = hooks.hooks.PreCompact;
  assert.ok(Array.isArray(entries) && entries.length > 0);
  assert.match(entries[0].matcher, /manual/);
  assert.match(entries[0].matcher, /auto/);
  assert.match(entries[0].hooks[0].command, /precompact\.mjs/);
  const reminder = await source("hooks/precompact.mjs");
  assert.match(reminder, /STATUS\.md/);
  assert.match(reminder, /design.*plan.*ledger/is);
});
