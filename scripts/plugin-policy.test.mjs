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
  const skillEntries = await readdir(skillsRoot, { recursive: true });
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

test("adaptive routing keeps Quick work to one leaf and no process artifacts", async () => {
  const start = await source("commands/start.md");
  assert.match(start, /Exactly one leaf worker implements and validates end-to-end/i);
  assert.match(start, /No design, plan, ledger, Crossing, or independent review/i);
  assert.match(start, /Security, credentials, destructive actions, migrations/i);
  assert.match(start, /dispatch exactly one of `code-light` or `code-standard`/i);
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
  assert.equal(plugin.version, "2.0.0");
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.match(readme, /ayghri\/i-have-adhd/);
  assert.match(readme, /Cowork/);
});
