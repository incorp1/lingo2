const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STATS_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "stats.js"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = STATS_SRC.indexOf(marker);
  assert.ok(start >= 0, `${name}() not found in js/stats.js`);
  let depth = 0;
  let i = STATS_SRC.indexOf("{", start);
  const open = i;
  for (; i < STATS_SRC.length; i++) {
    if (STATS_SRC[i] === "{") depth += 1;
    else if (STATS_SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return STATS_SRC.slice(start, i + 1);
    }
  }
  assert.fail(`unbalanced braces while extracting ${name}(), started at ${open}`);
}

function makeContext(state, profiles) {
  const sandbox = {
    state,
    activeLanguageProfile(target = state) {
      return profiles[target.activeLearningLanguage] || null;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction("statsHistory"), sandbox);
  return sandbox;
}

test("statsHistory() reads the canonical profile of the active language", () => {
  const profiles = {
    nb: { history: { "2026-01-01": { reviewed: 7 } } },
    en: { history: { "2026-01-01": { reviewed: 2 } } },
  };
  const state = { activeLearningLanguage: "nb", history: profiles.nb.history };
  const ctx = makeContext(state, profiles);

  assert.strictEqual(ctx.statsHistory()["2026-01-01"].reviewed, 7);

  // Switching the language must change the statistics source even when the
  // compatibility mirror still holds the previous language data.
  state.activeLearningLanguage = "en";
  assert.strictEqual(ctx.statsHistory()["2026-01-01"].reviewed, 2);
});

test("statsHistory() ignores a stale state.history mirror", () => {
  const profiles = { nb: { history: { "2026-02-02": { reviewed: 5, good: 5 } } } };
  const state = {
    activeLearningLanguage: "nb",
    // Stale mirror left over from another language profile.
    history: { "2026-02-02": { reviewed: 99, good: 99 } },
  };
  const ctx = makeContext(state, profiles);
  assert.strictEqual(ctx.statsHistory()["2026-02-02"].reviewed, 5);
});

test("statsHistory() falls back to state.history when no profile exists", () => {
  const state = { activeLearningLanguage: "nb", history: { "2026-03-03": { reviewed: 3 } } };
  const ctx = makeContext(state, {});
  assert.strictEqual(ctx.statsHistory()["2026-03-03"].reviewed, 3);
});

test("statistics and heatmap no longer read state.history directly", () => {
  const body = STATS_SRC.slice(STATS_SRC.indexOf("function renderHeatmap("));
  assert.ok(!/state\.history/.test(body), "js/stats.js still reads state.history directly");
  assert.ok(/const history = statsHistory\(\);/.test(body), "statsHistory() is not used by stats");
});
