const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/* AUD-007: сброс прогресса относится только к расписанию повторений.
   История AI-практики не может быть восстановлена пользователем, поэтому
   она обязана пережить сброс для всех языков, включая активный. */

test("resetProgress не фильтрует историю практики по активному языку", () => {
  const source = read("js/import-export.js");
  const start = source.indexOf("async function resetProgress(");
  assert.ok(start >= 0, "resetProgress должен существовать");
  const end = source.indexOf("\nasync function", start + 10);
  const body = source.slice(start, end === -1 ? source.length : end);

  assert.ok(
    !/practiceHistory[\s\S]{0,200}?\.filter\(/.test(body),
    "история практики не должна фильтроваться при сбросе прогресса"
  );
  assert.ok(
    !body.includes("keptPractice"),
    "удалённая ветка keptPractice не должна возвращаться"
  );
  assert.match(body, /nextState\.practiceHistory/);
});

test("сброс прогресса сохраняет историю практики обоих языков", () => {
  const normalizeLearningLanguage = value => (value === "nb" ? "nb" : "en");
  const activeLanguage = "en";
  const languageDeckIds = new Set(["deck-en"]);

  const state = {
    decks: [
      { id: "deck-en", learningLanguage: "en" },
      { id: "deck-nb", learningLanguage: "nb" },
    ],
    cards: [
      { id: "c-en", deckId: "deck-en", state: "review", reps: 5, interval: 40 },
      { id: "c-nb", deckId: "deck-nb", state: "review", reps: 3, interval: 12 },
    ],
    practiceHistory: [
      { id: "p-en-1", learningLanguage: "en", text: "English story" },
      { id: "p-nb-1", learningLanguage: "nb", text: "Norsk historie" },
      { id: "p-legacy", text: "Legacy story" },
    ],
  };

  // Модель текущего поведения сброса после исправления AUD-007.
  const nextState = structuredClone(state);
  nextState.cards = nextState.cards.map(card =>
    languageDeckIds.has(card.deckId)
      ? { ...card, state: "new", reps: 0, interval: 0 }
      : card
  );
  nextState.practiceHistory = Array.isArray(nextState.practiceHistory)
    ? nextState.practiceHistory
    : [];

  const resetCard = nextState.cards.find(card => card.id === "c-en");
  const untouched = nextState.cards.find(card => card.id === "c-nb");
  assert.strictEqual(resetCard.state, "new");
  assert.strictEqual(resetCard.reps, 0);
  assert.strictEqual(untouched.reps, 3);

  assert.deepStrictEqual(
    nextState.practiceHistory.map(entry => entry.id),
    ["p-en-1", "p-nb-1", "p-legacy"],
    "история практики активного языка также должна сохраняться"
  );

  const activeEntries = nextState.practiceHistory.filter(
    entry => normalizeLearningLanguage(entry.learningLanguage) === activeLanguage
  );
  assert.strictEqual(activeEntries.length, 2, "en-записи и legacy-записи остаются доступными");
});
