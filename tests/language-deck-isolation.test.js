const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

// Загружаем языковой блок state.js вместе с языковыми селекторами и
// функциями создания колод/карточек — без DOM и хранилища.
function loadDeckIsolationApi() {
  const context = vm.createContext({ console, structuredClone, JSON, Object, Array, Number, Date, Math, String, Map, Set, Error });
  vm.runInContext(fs.readFileSync(path.join(root, "languages.js"), "utf8"), context);
  const src = fs.readFileSync(path.join(root, "js/state.js"), "utf8");

  const langStart = src.indexOf("/* ----- Learning languages");
  const langEnd = src.indexOf("function normalizeLoadedState", langStart);
  assert.ok(langStart > 0 && langEnd > langStart, "language block must exist");

  const createDeckStart = src.indexOf("function createDeck(");
  const createCardEnd = src.indexOf("\n}", src.indexOf("function createCard(")) + 2;
  assert.ok(createDeckStart > 0 && createCardEnd > createDeckStart, "deck/card factories must exist");

  vm.runInContext(
    "let state = null;\n" +
    "function cloneSettingValue(value) { return value === undefined ? undefined : structuredClone(value); }\n" +
    "let deckById = new Map();\n" +
    "let cardsByDeck = new Map();\n" +
    "let cardById = new Map();\n" +
    "let seq = 0;\n" +
    "function uid() { seq += 1; return 'id-' + seq; }\n" +
    "function markDeckDirty() {}\n" +
    "function markCardDirty() {}\n" +
    "function calculateDifficultyCache() { return null; }\n" +
    src.slice(langStart, langEnd) +
    src.slice(createDeckStart, createCardEnd) +
    "\nglobalThis.__api = {" +
    " setState: s => { state = s; deckById = new Map(); cardsByDeck = new Map(); cardById = new Map();" +
    "   for (const d of s.decks) { deckById.set(d.id, d); cardsByDeck.set(d.id, []); }" +
    "   for (const c of s.cards) { cardById.set(c.id, c); (cardsByDeck.get(c.deckId) || []).push(c); } }," +
    " getState: () => state," +
    " createDeck, createCard, activeDecks, activeCards, decksForLanguage, cardsForLanguage," +
    " isDeckInActiveLanguage, firstDeckIdForLanguage, deckLearningLanguage, findDuplicateCard };",
    context
  );
  return context.__api;
}

const api = loadDeckIsolationApi();

// Значения приходят из vm-контекста (другой realm), поэтому нормализуем их
// перед структурным сравнением.
const ids = list => JSON.parse(JSON.stringify(Array.from(list, item => item.id)));

function twoLanguageState() {
  const state = {
    activeLearningLanguage: "en",
    settings: { startingEase: 2.5 },
    decks: [
      { id: "deck-en", name: "English basics", learningLanguage: "en" },
      { id: "deck-nb", name: "Norsk start", learningLanguage: "nb" },
    ],
    cards: [
      { id: "card-en-1", deckId: "deck-en", front: "house", state: "new" },
      { id: "card-en-2", deckId: "deck-en", front: "tree", state: "new" },
      { id: "card-nb-1", deckId: "deck-nb", front: "hus", state: "new" },
    ],
  };
  api.setState(state);
  return state;
}

test("селекторы колод и карточек возвращают только активный язык", () => {
  const state = twoLanguageState();

  assert.deepEqual(ids(api.activeDecks()), ["deck-en"]);
  assert.deepEqual(ids(api.activeCards()), ["card-en-1", "card-en-2"]);

  state.activeLearningLanguage = "nb";
  assert.deepEqual(ids(api.activeDecks()), ["deck-nb"]);
  assert.deepEqual(ids(api.activeCards()), ["card-nb-1"]);
});

test("карточки чужой колоды недоступны через activeCards по deckId", () => {
  const state = twoLanguageState();

  assert.deepEqual(ids(api.activeCards("deck-en")), ["card-en-1", "card-en-2"]);
  assert.deepEqual(ids(api.activeCards("deck-nb")), []);
  assert.equal(api.isDeckInActiveLanguage("deck-nb"), false);

  state.activeLearningLanguage = "nb";
  assert.deepEqual(ids(api.activeCards("deck-nb")), ["card-nb-1"]);
  assert.deepEqual(ids(api.activeCards("deck-en")), []);
});

test("новая колода наследует активный язык, а firstDeckIdForLanguage учитывает язык", () => {
  const state = twoLanguageState();
  state.activeLearningLanguage = "nb";

  const deck = api.createDeck("Norsk verb");
  assert.equal(api.deckLearningLanguage(deck), "nb");
  assert.deepEqual(ids(api.activeDecks()), ["deck-nb", deck.id]);

  assert.equal(api.firstDeckIdForLanguage("en"), "deck-en");
  assert.equal(api.firstDeckIdForLanguage("nb"), "deck-nb");
});

test("создание карточки без существующей колоды запрещено", () => {
  twoLanguageState();

  assert.throws(() => api.createCard({ deckId: "", front: "sol" }), /unknown deckId/);
  assert.throws(() => api.createCard({ deckId: "deck-missing", front: "sol" }), /unknown deckId/);

  const card = api.createCard({ deckId: "deck-nb", front: "sol" });
  assert.equal(card.deckId, "deck-nb");
  assert.deepEqual(ids(api.cardsForLanguage("nb")), ["card-nb-1", card.id]);
});

test("идентификаторы карточек глобально уникальны между языками", () => {
  twoLanguageState();

  const a = api.createCard({ deckId: "deck-en", front: "sun" });
  const b = api.createCard({ deckId: "deck-nb", front: "sol" });
  const allIds = ids(api.getState().cards);

  assert.notEqual(a.id, b.id);
  assert.equal(new Set(allIds).size, allIds.length);
});

test("поиск дубликатов ограничен колодой и не пересекает языки", () => {
  twoLanguageState();
  api.createCard({ deckId: "deck-nb", front: "House" });

  assert.ok(api.findDuplicateCard("deck-en", "House"));
  assert.ok(api.findDuplicateCard("deck-nb", "house"));
  assert.equal(api.findDuplicateCard("deck-en", "hus"), null);
});
