const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("recordReviewEvent stamps the deck learning language", () => {
  const source = read("js/state.js");
  const start = source.indexOf("function recordReviewEvent(");
  assert.ok(start >= 0, "recordReviewEvent must exist");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.match(body, /learningLanguage: cardLearningLanguage\(card\)/);
});

test("recordReviewEvent labels events by deck language, not by active language", () => {
  const decks = new Map([
    ["deck-en", { id: "deck-en", learningLanguage: "en" }],
    ["deck-nb", { id: "deck-nb", learningLanguage: "nb" }],
  ]);
  const normalizeLearningLanguage = value => (value === "nb" ? "nb" : "en");
  const cardLearningLanguage = card =>
    normalizeLearningLanguage(decks.get(card.deckId)?.learningLanguage);
  const recordReviewEvent = (card, grade, at) => ({
    id: `${card.id}-${at}`,
    cardId: card.id,
    deckId: card.deckId,
    learningLanguage: cardLearningLanguage(card),
    grade,
    at,
  });

  const nbEvent = recordReviewEvent({ id: "c1", deckId: "deck-nb" }, 3, 1);
  const enEvent = recordReviewEvent({ id: "c2", deckId: "deck-en" }, 3, 2);
  assert.strictEqual(nbEvent.learningLanguage, "nb");
  assert.strictEqual(enEvent.learningLanguage, "en");
});

test("resetProgress keeps other-language events and clears legacy ones by deck", () => {
  const source = read("js/import-export.js");
  assert.match(source, /if \(languageDeckIds\.has\(event\.deckId\)\) return false;/);
  assert.match(source, /if \(event\.deckId\) return true;/);

  const languageDeckIds = new Set(["deck-nb"]);
  const activeLanguage = "nb";
  const normalizeLearningLanguage = value => (value === "nb" ? "nb" : "en");
  const keep = event => {
    if (languageDeckIds.has(event.deckId)) return false;
    if (event.deckId) return true;
    return normalizeLearningLanguage(event.learningLanguage) !== activeLanguage;
  };

  const events = [
    { id: "legacy-nb", deckId: "deck-nb" },
    { id: "legacy-en", deckId: "deck-en" },
    { id: "tagged-en", deckId: "deck-en", learningLanguage: "en" },
    { id: "orphan-nb", deckId: null, learningLanguage: "nb" },
    { id: "orphan-en", deckId: null, learningLanguage: "en" },
  ];
  const kept = events.filter(keep).map(event => event.id);
  assert.deepStrictEqual(kept, ["legacy-en", "tagged-en", "orphan-en"]);
});
