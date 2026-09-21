const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

// Загружаем языковой блок state.js вместе с getDeckCards и профильными
// помощниками, чтобы проверить изоляцию обучения и статистики без DOM.
function loadStudyIsolationApi() {
  const context = vm.createContext({ console, structuredClone, JSON, Object, Array, Number, Date, Math, String, Map, Set, Error });
  vm.runInContext(fs.readFileSync(path.join(root, "languages.js"), "utf8"), context);
  const src = fs.readFileSync(path.join(root, "js/state.js"), "utf8");

  const langStart = src.indexOf("/* ----- Learning languages");
  const langEnd = src.indexOf("function normalizeLoadedState", langStart);
  assert.ok(langStart > 0 && langEnd > langStart, "language block must exist");

  vm.runInContext(
    "let state = null;\n" +
    "function cloneSettingValue(value) { return value === undefined ? undefined : structuredClone(value); }\n" +
    "let deckById = new Map();\n" +
    "let cardsByDeck = new Map();\n" +
    "const getDeckCards = id => { if (id) return cardsByDeck.get(id) || []; " +
    "  return typeof activeCards === 'function' ? activeCards() : state.cards; };\n" +
    src.slice(langStart, langEnd) +
    "\nglobalThis.__api = {" +
    " setState: s => { state = s; deckById = new Map(); cardsByDeck = new Map();" +
    "   for (const d of s.decks) { deckById.set(d.id, d); cardsByDeck.set(d.id, []); }" +
    "   for (const c of s.cards) { (cardsByDeck.get(c.deckId) || []).push(c); } }," +
    " getState: () => state," +
    " getDeckCards, activeCards, activeDecks, normalizeLanguageModel," +
    " activeLanguageProfile, syncActiveLanguageProfile };",
    context
  );
  return context.__api;
}

const api = loadStudyIsolationApi();

// Значения приходят из vm-контекста (другой realm), нормализуем перед сравнением.
const ids = list => JSON.parse(JSON.stringify(Array.from(list, item => item.id)));

function twoLanguageState(overrides = {}) {
  return Object.assign({
    activeLearningLanguage: "en",
    settings: {},
    decks: [
      { id: "deck-en", name: "English", learningLanguage: "en" },
      { id: "deck-nb", name: "Norsk", learningLanguage: "nb" },
    ],
    cards: [
      { id: "en-1", deckId: "deck-en", state: "new" },
      { id: "en-2", deckId: "deck-en", state: "review", due: 5000, interval: 3 },
      { id: "nb-1", deckId: "deck-nb", state: "new" },
      { id: "nb-2", deckId: "deck-nb", state: "review", due: 1000, interval: 3 },
    ],
  }, overrides);
}

test("режим «Все колоды» не выходит за пределы активного языка", () => {
  const state = twoLanguageState();
  api.setState(state);

  assert.deepEqual(ids(api.getDeckCards(null)), ["en-1", "en-2"]);

  state.activeLearningLanguage = "nb";
  assert.deepEqual(ids(api.getDeckCards(null)), ["nb-1", "nb-2"]);
});

test("getDeckCards по явному deckId остаётся точным для обоих языков", () => {
  api.setState(twoLanguageState());
  assert.deepEqual(ids(api.getDeckCards("deck-nb")), ["nb-1", "nb-2"]);
  assert.deepEqual(ids(api.getDeckCards("deck-en")), ["en-1", "en-2"]);
  assert.deepEqual(ids(api.getDeckCards("deck-missing")), []);
});

test("ближайший срок и наличие новых карточек считаются по активному языку", () => {
  const state = twoLanguageState();
  api.setState(state);

  // Локальные аналоги nextDueAt/hasNewInDeck из stats.js: источник — activeCards().
  const nextDueAt = () => {
    let min = null;
    for (const card of api.activeCards()) {
      if (card.state === "new" || card.state === "suspended") continue;
      if (min === null || card.due < min) min = card.due;
    }
    return min;
  };
  const hasNew = () => api.activeCards().some(card => card.state === "new");

  assert.equal(nextDueAt(), 5000);
  assert.equal(hasNew(), true);

  state.activeLearningLanguage = "nb";
  assert.equal(nextDueAt(), 1000, "норвежский срок не берётся из английских карточек");

  state.decks[1].learningLanguage = "nb";
  state.cards[2].state = "review";
  state.cards[2].due = 9000;
  api.setState(state);
  assert.equal(hasNew(), false, "английские новые карточки не считаются норвежскими");
});

test("history, streak и sessionReviewedIds хранятся отдельно в профилях", () => {
  const state = api.normalizeLanguageModel(twoLanguageState({
    history: { "2026-01-01": { reviewed: 7, good: 7 } },
    streak: { current: 4, lastDay: "2026-01-01" },
    sessionReviewedIds: ["en-2"],
  }));
  api.setState(state);

  assert.equal(state.languageProfiles.en.history["2026-01-01"].reviewed, 7);
  assert.equal(state.languageProfiles.en.streak.current, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(state.languageProfiles.en.sessionReviewedIds)), ["en-2"]);

  assert.deepEqual(JSON.parse(JSON.stringify(state.languageProfiles.nb.history)), {});
  assert.equal(state.languageProfiles.nb.streak.current, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(state.languageProfiles.nb.sessionReviewedIds)), []);

  // Новый прогресс английского не протекает в норвежский профиль.
  state.history["2026-01-02"] = { reviewed: 3, good: 3 };
  state.streak.current = 5;
  state.sessionReviewedIds.push("en-1");
  api.syncActiveLanguageProfile(state);

  assert.equal(state.languageProfiles.en.streak.current, 5);
  assert.equal(state.languageProfiles.nb.streak.current, 0);
  assert.equal(state.languageProfiles.nb.history["2026-01-02"], undefined);
});

test("незавершённый учебный цикл сохраняется в профиле своего языка", () => {
  const resume = { deckId: "deck-en", currentId: "en-2", queuedIds: ["en-1"] };
  const state = api.normalizeLanguageModel(twoLanguageState({ studyResume: resume }));
  api.setState(state);

  assert.deepEqual(JSON.parse(JSON.stringify(state.languageProfiles.en.studyResume)), resume);
  assert.equal(state.languageProfiles.nb.studyResume, null);

  // После синхронизации цикл остаётся привязан к английскому профилю.
  api.syncActiveLanguageProfile(state);
  assert.deepEqual(JSON.parse(JSON.stringify(state.languageProfiles.en.studyResume)), resume);
  assert.equal(state.languageProfiles.nb.studyResume, null);
});

test("активный профиль зеркалится в совместимые поля состояния", () => {
  const state = api.normalizeLanguageModel(twoLanguageState({
    activeLearningLanguage: "nb",
    history: { "2026-01-01": { reviewed: 2 } },
  }));
  api.setState(state);

  // Активен nb, поэтому legacy-прогресс не должен стать видимым состоянием.
  assert.deepEqual(JSON.parse(JSON.stringify(state.history)), {});
  assert.equal(state.activeDeckId, "deck-nb");
  assert.equal(api.activeLanguageProfile(state).activeDeckId, "deck-nb");
});
