import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildBundle, approximateTokens, DEFAULT_MAX_TOKENS } from "./build-review-bundle.mjs";

test("bundle is deterministic and hash-identified for identical inputs", () => {
  const inputs = {
    candidate: "abc123".repeat(6),
    diff: "- a\n+ b\n",
    evidence: "evidence snippet",
    spec: "approved plan excerpt",
    files: ["b.txt", "a.txt"],
  };
  const first = buildBundle(inputs, DEFAULT_MAX_TOKENS);
  const second = buildBundle(inputs, DEFAULT_MAX_TOKENS);
  assert.equal(first.content, second.content);
  assert.equal(first.sha256, second.sha256);
  assert.match(first.content, /candidate|Candidate/i);
  assert.match(first.content, /scoped diff/i);
  assert.match(first.content, /changed files/i);
});

test("changed-file list is sorted regardless of input order", () => {
  const bundle = buildBundle(
    {
      candidate: "c",
      diff: "diff",
      files: ["z.txt", "a.txt", "m.txt"],
    },
    DEFAULT_MAX_TOKENS,
  );
  const filesIndex = bundle.content.indexOf("## Changed files");
  const diffIndex = bundle.content.indexOf("## Scoped diff");
  assert.ok(filesIndex < diffIndex);
  const filesBlock = bundle.content.slice(filesIndex, diffIndex);
  assert.ok(filesBlock.indexOf("a.txt") < filesBlock.indexOf("m.txt"));
  assert.ok(filesBlock.indexOf("m.txt") < filesBlock.indexOf("z.txt"));
});

test("a candidate-bearing change invalidates the whole bundle", () => {
  const base = {
    candidate: "aaaa",
    diff: "diff-a",
    files: ["a.txt"],
  };
  const bundleA = buildBundle(base, DEFAULT_MAX_TOKENS);
  const bundleB = buildBundle({ ...base, candidate: "bbbb" }, DEFAULT_MAX_TOKENS);
  assert.notEqual(bundleA.sha256, bundleB.sha256);
  assert.notEqual(bundleA.content, bundleB.content);
});

test("overflow of mandatory diff + file list fails closed, never truncates", () => {
  const hugeDiff = "x".repeat(200_000);
  assert.throws(
    () => buildBundle({ candidate: "c", diff: hugeDiff, files: ["a.txt"] }, 500),
    /overflows its token cap/,
  );
});

test("optional sections overflow is recorded as an explicit omission", () => {
  const bundle = buildBundle(
    {
      candidate: "c",
      diff: "diff",
      files: ["a.txt"],
      evidence: "e".repeat(100_000),
      spec: "s",
    },
    1_000,
  );
  assert.match(bundle.content, /## Omissions/);
  assert.match(bundle.content, /Focused evidence was omitted/);
});

test("token estimate is computed and bounded", () => {
  const bundle = buildBundle(
    { candidate: "c", diff: "diff", files: ["a.txt"] },
    DEFAULT_MAX_TOKENS,
  );
  assert.ok(Number.isSafeInteger(bundle.tokenEstimate));
  assert.ok(bundle.tokenEstimate <= DEFAULT_MAX_TOKENS);
  assert.equal(approximateTokens("abcd"), 1);
});

test("full CLI run writes a file and returns metadata", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-bundle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("git", ["-C", dir, "init", "--initial-branch=main"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "airlock@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Airlock Test"]);
  await writeFile(path.join(dir, "owned.txt"), "old\n");
  execFileSync("git", ["-C", dir, "add", "owned.txt"]);
  execFileSync("git", ["-C", dir, "commit", "-m", "baseline"]);
  await writeFile(path.join(dir, "owned.txt"), "new\n");
  execFileSync("git", ["-C", dir, "add", "owned.txt"]);
  execFileSync("git", ["-C", dir, "commit", "-m", "change"]);
  const diffPath = path.join(dir, "diff.txt");
  const filesPath = path.join(dir, "files.txt");
  const outPath = path.join(dir, "bundle.md");
  const candidate = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  const diff = execFileSync("git", ["-C", dir, "diff", "--no-ext-diff", "--binary", `${candidate}^`, candidate]).toString();
  const files = execFileSync("git", ["-C", dir, "diff", "--no-ext-diff", "--name-only", `${candidate}^`, candidate]).toString();
  await writeFile(diffPath, diff);
  await writeFile(filesPath, files);

  const { spawnSync } = await import("node:child_process");
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "build-review-bundle.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      dir,
      "--candidate",
      candidate,
      "--diff",
      diffPath,
      "--files",
      filesPath,
      "--out",
      outPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.candidate, candidate);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  const written = await readFile(outPath, "utf8");
  const expected = buildBundle(
    { candidate, diff, files: ["owned.txt"] },
    DEFAULT_MAX_TOKENS,
  ).content;
  assert.equal(written, expected);
});
