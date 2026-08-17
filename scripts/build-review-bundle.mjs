// build-review-bundle.mjs — deterministic reviewer context bundle (Airlock 2.4, WS-2).
//
// The bundle is generated ONCE from a frozen candidate and shipped verbatim in the
// reviewer prompt, so the reviewer verifies from artifacts instead of sweeping the
// repository. Determinism contract:
//   - input is the exact candidate identity and the scoped inputs below;
//   - ordering of every section and list is deterministic (sorted, fixed separators);
//   - the bundle is identified by a SHA-256 of its exact bytes;
//   - any candidate-bearing change means the whole bundle is stale and must be
//     regenerated, never patched.
//
// The orchestrator owns the bundle as a task-owned temporary artifact: it records
// the exact path and removes it after the return audit per the base cleanup rules.
//
// Usage:
//   node scripts/build-review-bundle.mjs --repo <path> --candidate <sha> --out <path> \
//     --diff <path> --files <path> [--evidence <path>] [--spec <path>] \
//     [--max-tokens 15000]
//
// `--files` accepts a newline-delimited list or a JSON array. The generated bundle
// contains the sections present among the inputs. If the mandatory diff plus the
// changed-file list would exceed the token cap, the builder FAILS CLOSED (it does
// not silently truncate evidence). Otherwise it records explicit omissions only for
// optional sections that would overflow, and says so in the bundle.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_TOKENS = 15_000;
const COMMIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const STAGED_CANDIDATE = /^staged:([a-f0-9]{40}(?:[a-f0-9]{24})?)\+diff:([a-f0-9]{64})$/;

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${flag}`);
    }
    const key = flag.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function approximateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function splitLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function readOptionalList(filePath) {
  if (!filePath) return [];
  const raw = readFileSync(filePath, "utf8").trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`--files JSON is not an array: ${filePath}`);
    return parsed.map(String).sort();
  }
  return splitLines(raw).sort();
}

function canonicalCandidate(value) {
  const candidate = String(value);
  if (COMMIT_SHA.test(candidate)) return { kind: "commit", commit: candidate };
  const staged = candidate.match(STAGED_CANDIDATE);
  if (staged) return { kind: "staged", base: staged[1], diffSha256: staged[2] };
  throw new Error(
    "--candidate must be a 40/64-character commit SHA or staged:<base SHA>+diff:<sha256>",
  );
}

function gitOutput(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function deriveCandidateInputs(repo, candidate) {
  const parsed = canonicalCandidate(candidate);
  if (parsed.kind === "commit") {
    const diff = gitOutput(repo, ["diff", "--no-ext-diff", "--binary", `${parsed.commit}^`, parsed.commit]);
    const files = gitOutput(repo, ["diff", "--no-ext-diff", "--name-only", `${parsed.commit}^`, parsed.commit])
      .split(/\r?\n/)
      .filter(Boolean)
      .sort();
    return { diff, files, identity: parsed };
  }
  const diff = gitOutput(repo, ["diff", "--no-ext-diff", "--binary", "--cached"]);
  const head = gitOutput(repo, ["rev-parse", "HEAD"]).trim();
  if (head !== parsed.base) {
    throw new Error(`staged candidate base mismatch: expected ${parsed.base}, got ${head}`);
  }
  const actualHash = createHash("sha256").update(Buffer.from(diff, "utf8")).digest("hex");
  if (actualHash !== parsed.diffSha256) {
    throw new Error(`staged candidate diff hash mismatch: expected ${parsed.diffSha256}, got ${actualHash}`);
  }
  const files = gitOutput(repo, ["diff", "--no-ext-diff", "--name-only", "--cached"])
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  return { diff, files, identity: parsed };
}

function section(heading, content) {
  if (content === "") return "";
  return `## ${heading}\n\n${content}\n`;
}

function buildBundle(inputs, maxTokens) {
  if (!inputs.candidate || !inputs.diff || !Array.isArray(inputs.files) || inputs.files.length === 0) {
    throw new Error("review bundle requires candidate, non-empty diff, and non-empty changed-file list");
  }
  const changedFiles = [...inputs.files].sort();
  const diff = inputs.diff ?? "";
  const mandatorySection = section(
    "Changed files",
    changedFiles.length > 0 ? changedFiles.join("\n") : "(none)",
  ) + section("Scoped diff", diff);
  const mandatoryTokens = approximateTokens(mandatorySection);

  const candidateSection = section("Candidate", inputs.candidate);
  if (approximateTokens(candidateSection) + mandatoryTokens > maxTokens) {
    throw new Error(
      `review bundle overflows its token cap: mandatory diff + changed-file list is ` +
        `~${mandatoryTokens} tokens, cap is ${maxTokens}. Narrow the candidate package ` +
        `or the diff before dispatching; the bundle is never silently truncated.`,
    );
  }

  const parts = [];
  parts.push(candidateSection);
  parts.push(mandatorySection);

  let remaining = maxTokens - approximateTokens(parts.join(""));
  const optionalSections = [];
  for (const [name, content] of [
    ["Focused evidence", inputs.evidence ?? ""],
    ["Relevant plan/spec excerpts", inputs.spec ?? ""],
  ]) {
    if (content === "") continue;
    optionalSections.push({ name, content });
  }
  for (const { name, content } of optionalSections) {
    const block = section(name, content);
    const blockTokens = approximateTokens(block);
    if (blockTokens <= remaining) {
      parts.push(block);
      remaining -= blockTokens;
    } else {
      const omission =
        `## Omissions\n\n${name} was omitted: it would exceed the ${maxTokens}-token bundle cap. ` +
        `See the named source path in the dispatch.\n`;
      const omissionTokens = approximateTokens(omission);
      if (omissionTokens > remaining) {
        throw new Error(
          `review bundle cannot record the ${name} omission within its ${maxTokens}-token cap`,
        );
      }
      parts.push(omission);
      remaining -= omissionTokens;
    }
  }

  const body = parts.join("").trimEnd() + "\n";
  const tokenEstimate = approximateTokens(body);
  if (tokenEstimate > maxTokens) {
    throw new Error(`review bundle exceeds its token cap: ${tokenEstimate} > ${maxTokens}`);
  }
  const hash = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  return {
    candidate: inputs.candidate,
    tokenEstimate,
    maxTokens,
    sha256: hash,
    content: body,
  };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.candidate) throw new Error("--candidate is required");
  if (!args.out) throw new Error("--out is required");
  if (!args.repo) throw new Error("--repo is required");
  if (!args.diff) throw new Error("--diff is required");
  if (!args.files) throw new Error("--files is required");
  const maxTokens = args["max-tokens"] ? Number(args["max-tokens"]) : DEFAULT_MAX_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    throw new Error("--max-tokens must be a positive integer");
  }

  const derived = deriveCandidateInputs(args.repo, args.candidate);
  const diff = readFileSync(args.diff, "utf8");
  const evidence = args.evidence ? readFileSync(args.evidence, "utf8") : "";
  const spec = args.spec ? readFileSync(args.spec, "utf8") : "";
  const files = readOptionalList(args.files);
  if (diff !== derived.diff || JSON.stringify(files) !== JSON.stringify(derived.files)) {
    throw new Error("review inputs do not match the exact candidate diff and changed-file list");
  }

  const bundle = buildBundle(
    { candidate: args.candidate, diff, evidence, spec, files },
    maxTokens,
  );

  writeFileSync(args.out, bundle.content, "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        candidate: bundle.candidate,
        sha256: bundle.sha256,
        tokenEstimate: bundle.tokenEstimate,
        maxTokens: bundle.maxTokens,
        path: path.resolve(args.out),
      },
      null,
      2,
    ) + "\n",
  );
}

export { approximateTokens, buildBundle, DEFAULT_MAX_TOKENS };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
