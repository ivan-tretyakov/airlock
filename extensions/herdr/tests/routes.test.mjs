import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRouting, parseClock, resolveChain, routerNow, RoutingError, validateBinding, validateCandidate, validateFallbacks, validateRouting, validateWindow } from "../src/routes.mjs";
import { assert } from "./helpers.mjs";

const CANDIDATE = { executor: "opencode", model: "prov/model", effort: "max" };
const OTHER = { executor: "opencode", model: "prov/other", effort: "max" };

function windowOf(overrides = {}) {
  return { name: "peak", days: ["mon"], utc: "06:00-10:00", ...CANDIDATE, ...overrides };
}

test("parseClock enforces HH:MM UTC and 24:00 end-only, with the 3.x error texts", () => {
  assert.equal(parseClock("06:30", "x start"), 390);
  assert.equal(parseClock("24:00", "x end", true), 1440);
  assert.throws(() => parseClock("6:30", "x start"), /x start must be HH:MM UTC/);
  assert.throws(() => parseClock("25:00", "x start"), /x start must be HH:MM UTC/);
  assert.throws(() => parseClock("24:00", "x start"), /x start may use 24:00 only as a window end/);
  assert.throws(() => parseClock("24:30", "x end", true), /x end may use 24:00 only as a window end/);
});

test("windows cannot cross midnight and keep the two-window remedy text", () => {
  assert.throws(() => validateWindow(windowOf({ utc: "22:00-02:00" }), "w"), /w cannot cross midnight; use two windows such as 22:00-24:00 and 00:00-02:00/);
  assert.throws(() => validateWindow(windowOf({ utc: "10:00-10:00" }), "w"), /cannot cross midnight/);
  const legal = validateWindow(windowOf({ utc: "22:00-24:00" }), "w");
  assert.equal(legal.endMinutes, 1440);
});

test("window validation requires name, valid days, and a single-dash utc", () => {
  assert.throws(() => validateWindow(windowOf({ name: "" }), "w"), /w requires name/);
  assert.throws(() => validateWindow(windowOf({ days: [] }), "w"), /w days must contain valid weekdays/);
  assert.throws(() => validateWindow(windowOf({ days: ["monday"] }), "w"), /w days must contain valid weekdays/);
  assert.throws(() => validateWindow(windowOf({ utc: "06:00" }), "w"), /w utc must be START-END/);
  assert.throws(() => validateWindow(windowOf({ utc: "06:00-07:00-08:00" }), "w"), /w utc must be START-END/);
});

test("duplicate window names and day/time overlaps are rejected", () => {
  const binding = { primary: CANDIDATE, windows: [windowOf(), windowOf({ utc: "11:00-12:00" })] };
  assert.throws(() => validateBinding(binding, "b"), /b has duplicate window name: peak/);
  const overlapping = { primary: CANDIDATE, windows: [windowOf(), windowOf({ name: "late", utc: "09:00-11:00" })] };
  assert.throws(() => validateBinding(overlapping, "b"), /b windows peak and late overlap/);
  const disjointDays = { primary: CANDIDATE, windows: [windowOf(), windowOf({ name: "late", days: ["tue"], utc: "09:00-11:00" })] };
  assert.equal(validateBinding(disjointDays, "b").windows.length, 2);
  const adjacent = { primary: CANDIDATE, windows: [windowOf(), windowOf({ name: "late", utc: "10:00-12:00" })] };
  assert.equal(validateBinding(adjacent, "b").windows.length, 2, "start == other end is not an overlap");
});

test("fallbacks: non-empty, at most 2, duplicate executor+model+effort triples rejected", () => {
  assert.deepEqual(validateFallbacks(undefined, CANDIDATE, "b"), []);
  assert.throws(() => validateFallbacks([], CANDIDATE, "b"), /b fallbacks must be a non-empty array/);
  assert.throws(() => validateFallbacks([OTHER, { ...OTHER, model: "a/b" }, { ...OTHER, model: "c/d" }], CANDIDATE, "b"), /b fallbacks cannot exceed 2 candidates/);
  assert.throws(() => validateFallbacks([CANDIDATE], CANDIDATE, "b"), /duplicate fallback candidate/);
  assert.throws(() => validateFallbacks([OTHER, { ...OTHER }], CANDIDATE, "b"), /duplicate fallback candidate/);
  const differentEffort = validateFallbacks([OTHER, { ...OTHER, effort: "low" }], CANDIDATE, "b");
  assert.equal(differentEffort.length, 2, "a differing effort makes a distinct triple");
  const differentExecutor = validateFallbacks([{ ...CANDIDATE, executor: "codex" }], CANDIDATE, "b");
  assert.equal(differentExecutor.length, 1, "a differing executor makes a distinct triple");
});

test("candidates: executor enum, non-empty model, claude effort enum, null effort legal", () => {
  assert.throws(() => validateCandidate({ model: "m", effort: "x" }, "c"), /c executor must be one of claude, codex, opencode/);
  assert.throws(() => validateCandidate({ executor: "gemini", model: "m" }, "c"), /executor must be one of/);
  assert.throws(() => validateCandidate({ executor: "codex", model: " " }, "c"), /c requires a non-empty model/);
  assert.throws(() => validateCandidate({ executor: "codex", model: "m", effort: "" }, "c"), /c effort must be null or a non-empty string/);
  assert.throws(() => validateCandidate({ executor: "claude", model: "opus", effort: "extreme" }, "c"), /c effort must be one of low\|medium\|high\|xhigh\|max for executor claude/);
  assert.deepEqual(validateCandidate({ executor: "claude", model: "opus", effort: "xhigh" }, "c"), { executor: "claude", model: "opus", effort: "xhigh" });
  assert.deepEqual(validateCandidate({ executor: "codex", model: "gpt-x", effort: "anything-provider-defined" }, "c"), { executor: "codex", model: "gpt-x", effort: "anything-provider-defined" });
  assert.equal(validateCandidate({ executor: "opencode", model: "p/m" }, "c").effort, null);
  assert.equal(validateCandidate({ executor: "opencode", model: "p/m", effort: null }, "c").effort, null);
});

test("unknown keys are rejected everywhere (fail closed; no 3.x reader tolerance)", () => {
  assert.throws(() => validateRouting({ version: 1, bindings: {}, extra: true }), /routing.json has unknown key: extra/);
  assert.throws(() => validateBinding({ primary: CANDIDATE, catalog: {} }, "b"), /b has unknown key: catalog/);
  assert.throws(() => validateBinding({ primary: { ...CANDIDATE, agent: "x" } }, "b"), /b primary has unknown key: agent/);
  assert.throws(() => validateWindow(windowOf({ risk: "standard" }), "w"), /w has unknown key: risk/);
  assert.throws(() => validateFallbacks([{ ...OTHER, weight: 2 }], CANDIDATE, "b"), /b fallbacks\[0\] has unknown key: weight/);
});

test("whole file: version pinned to 1, roles and tiers restricted, JSON-path labels", () => {
  assert.throws(() => validateRouting({ version: 2, bindings: {} }), /routing.json version must be 1/);
  assert.throws(() => validateRouting({ version: 1 }), /routing.json requires a bindings object/);
  assert.throws(() => validateRouting({ version: 1, bindings: { deployer: {} } }), /bindings has invalid role: deployer/);
  assert.throws(() => validateRouting({ version: 1, bindings: { builder: { light: { primary: CANDIDATE } } } }), /bindings.builder has invalid tier: light/);
  assert.throws(
    () => validateRouting({ version: 1, bindings: { builder: { default: { primary: CANDIDATE, windows: [windowOf({ utc: "6:00-10:00" })] } } } }),
    /bindings\.builder\.default windows\[0\] start must be HH:MM UTC/,
  );
});

test("resolveChain: window boundaries are start-inclusive, end-exclusive, day-scoped", () => {
  const bindings = validateRouting({
    version: 1,
    bindings: {
      builder: {
        default: {
          primary: { executor: "opencode", model: "base/primary", effort: null },
          fallbacks: [{ executor: "opencode", model: "base/fb", effort: null }],
          windows: [
            { name: "peak", days: ["mon", "tue"], utc: "06:00-10:00", executor: "opencode", model: "win/primary", effort: "max", fallbacks: [{ executor: "opencode", model: "win/fb", effort: "max" }] },
            { name: "night", days: ["mon"], utc: "22:00-24:00", executor: "codex", model: "night/model", effort: "high" },
          ],
        },
      },
    },
  }).bindings;
  // 2026-08-31 is a Monday.
  const inWindow = resolveChain(bindings, "builder", "default", new Date("2026-08-31T06:00:00Z"));
  assert.equal(inWindow.window, "peak");
  assert.deepEqual(inWindow.candidates.map((candidate) => candidate.model), ["win/primary", "win/fb"], "no cross-window inheritance: the window's own complete fallbacks");
  const lastMinute = resolveChain(bindings, "builder", "default", new Date("2026-08-31T09:59:00Z"));
  assert.equal(lastMinute.window, "peak");
  const atEnd = resolveChain(bindings, "builder", "default", new Date("2026-08-31T10:00:00Z"));
  assert.equal(atEnd.window, "default", "end is exclusive");
  assert.deepEqual(atEnd.candidates.map((candidate) => candidate.model), ["base/primary", "base/fb"]);
  const midnightEnd = resolveChain(bindings, "builder", "default", new Date("2026-08-31T23:59:00Z"));
  assert.equal(midnightEnd.window, "night", "a 24:00 end covers the last minute of the day");
  assert.deepEqual(midnightEnd.candidates, [{ executor: "codex", model: "night/model", effort: "high" }], "a window with no fallbacks yields a one-candidate chain");
  const wrongDay = resolveChain(bindings, "builder", "default", new Date("2026-09-02T07:00:00Z"));
  assert.equal(wrongDay.window, "default", "Wednesday is not in the window's days");
  const sameTimeTue = resolveChain(bindings, "builder", "default", new Date("2026-09-01T07:00:00Z"));
  assert.equal(sameTimeTue.window, "peak");
});

test("resolveChain returns the pin shape with a zeroed budget and fails closed on a missing binding", () => {
  const bindings = validateRouting({ version: 1, bindings: { builder: { default: { primary: CANDIDATE } } } }).bindings;
  const now = new Date("2026-09-01T07:12:00.000Z");
  const pin = resolveChain(bindings, "builder", "default", now);
  assert.deepEqual(pin, {
    role: "builder",
    tier: "default",
    window: "default",
    resolvedAt: "2026-09-01T07:12:00.000Z",
    candidates: [{ executor: "opencode", model: "prov/model", effort: "max" }],
    candidateIndex: 0,
    advanceCount: 0,
    failures: [],
  });
  assert.throws(() => resolveChain(bindings, "builder", "expensive", now), (error) => error instanceof RoutingError && error.code === "missing-binding" && /no route for builder\/expensive/.test(error.message));
  assert.throws(() => resolveChain(bindings, "checker", "default", now), /no route for checker\/default/);
});

test("routerNow honors AIRLOCK_NOW so one variable freezes both clocks", () => {
  assert.equal(routerNow({ AIRLOCK_NOW: "2026-09-01T07:00:00Z" }).toISOString(), "2026-09-01T07:00:00.000Z");
  assert.ok(Math.abs(routerNow({}).getTime() - Date.now()) < 5000);
  assert.ok(Math.abs(routerNow({ AIRLOCK_NOW: "not a date" }).getTime() - Date.now()) < 5000);
});

test("loadRouting fails closed on a missing file (with the import remedy) and on invalid JSON", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.throws(() => loadRouting(dir), (error) => {
    assert.ok(error instanceof RoutingError);
    assert.equal(error.code, "missing-file");
    assert.match(error.message, new RegExp(`no routing.json at ${dir}`));
    assert.match(error.message, /airlock-herdr import-routes --host <claude\|opencode>/);
    return true;
  });
  await writeFile(path.join(dir, "routing.json"), "{ nope");
  assert.throws(() => loadRouting(dir), /not valid JSON/);
  await writeFile(path.join(dir, "routing.json"), JSON.stringify({ version: 1, bindings: { builder: { default: { primary: CANDIDATE } } } }));
  assert.equal(loadRouting(dir).bindings.builder.default.primary.model, "prov/model");
});
