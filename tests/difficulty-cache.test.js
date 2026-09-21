const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadDifficultyApi() {
  const source = read("js/state.js");
  const start = source.indexOf("const DAY_MS");
  const end = source.indexOf("/* ----- State ----- */");
  assert.ok(start >= 0 && end > start, "difficulty implementation must remain before app state");
  const context = { Date, Math, Number, Array, Map, JSON };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}
this.api = {
  calculateDifficultyCache,
  difficultyScore,
  updateCardDifficulty,
  rebuildDifficultyCachesForState,
  difficultyStyle,
  DIFFICULTY_CACHE_VERSION
};`, context);
  return context.api;
}

test("difficulty cache is versioned, bounded and independent from FSRS", () => {
  const api = loadDifficultyApi();
  const now = Date.UTC(2026, 7, 12);
  const events = [
    { grade: 0, at: now - 4 * 86400000 },
    { grade: 1, at: now - 2 * 86400000 },
    { grade: 0, at: now - 86400000 },
  ];
  const cache = api.calculateDifficultyCache(events, now);

  assert.equal(cache.version, 1);
  assert.equal(cache.streakCount, 3);
  assert.ok(cache.score > 0 && cache.score <= 100);
  assert.ok(!("fsrs" in cache));
  assert.equal(api.difficultyScore({ difficultyCache: cache, fsrs: { D: 10 } }, now), cache.score);
});

test("successful answers end the problem streak while an unresolved streak ages harder", () => {
  const api = loadDifficultyApi();
  const now = Date.UTC(2026, 7, 12);
  const problem = [
    { grade: 0, at: now - 2 * 86400000 },
    { grade: 1, at: now - 86400000 },
  ];
  const hardNow = api.calculateDifficultyCache(problem, now);
  const recovered = api.calculateDifficultyCache([...problem, { grade: 3, at: now }], now);
  const unresolvedLater = api.calculateDifficultyCache(problem, now + 120 * 86400000);

  assert.equal(recovered.streakCount, 0);
  assert.ok(recovered.score < hardNow.score);
  assert.ok(unresolvedLater.score >= hardNow.score);
});

test("cache can be rebuilt deterministically from reviewEvents", () => {
  const api = loadDifficultyApi();
  const now = Date.UTC(2026, 7, 12);
  const state = { cards: [{ id: "a" }, { id: "b", difficultyCache: { version: 0 } }] };
  const events = [
    { cardId: "a", grade: 0, at: now - 1000 },
    { cardId: "a", grade: 1, at: now },
    { cardId: "b", grade: 3, at: now },
  ];

  assert.equal(api.rebuildDifficultyCachesForState(state, events, now), 2);
  assert.ok(state.cards[0].difficultyCache.score > state.cards[1].difficultyCache.score);
  const snapshot = JSON.stringify(state.cards.map(card => card.difficultyCache));
  assert.equal(api.rebuildDifficultyCachesForState(state, events, now), 0);
  assert.equal(JSON.stringify(state.cards.map(card => card.difficultyCache)), snapshot);
});

test("practice coloring and deck coloring stay scoped to their explicit surfaces", () => {
  const practice = read("js/ai-practice.js");
  const decks = read("js/decks.js");
  const features = read("css/features.css");
  const deckCss = read("css/decks.css");

  assert.match(practice, /practice-chip selectable[\s\S]*difficultyStyle\(c\)/);
  assert.match(features, /\.practice-chip\.selectable\s*\{[\s\S]*--difficulty-bg/);
  assert.match(decks, /sort === "difficulty"[\s\S]*difficultyScore\(b\) - difficultyScore\(a\)/);
  assert.match(decks, /browse-front-word[\s\S]*difficultyStyle\(card\)/);
  assert.doesNotMatch(decks, /difficultyActive|difficulty-colored/);
  assert.match(deckCss, /\.browse-front-word\s*\{[\s\S]*background-color: var\(--difficulty-bg\)/);
  assert.doesNotMatch(deckCss, /\.table-row\.difficulty-colored/);
  assert.doesNotMatch(read("css/study.css"), /difficulty-colored|--difficulty-bg/);
});

test("difficulty is an explicit localized browse filter and PWA version is synchronized", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const packageJson = JSON.parse(read("package.json"));

  assert.match(html, /<option value="difficulty" data-i18n="browse\.sort\.difficulty">/);
  for (const locale of ["en", "ru", "uk"]) {
    assert.match(read(`i18n/${locale}.js`), /"browse\.sort\.difficulty":/);
  }
  assert.equal(packageJson.version, "3.19.16");
  assert.match(sw, /lingo-cards-v3\.19\.16/);
  assert.doesNotMatch(html + sw, /3\.16\.25|3\.17\.0|3\.18\.0|3\.18\.11/);
});