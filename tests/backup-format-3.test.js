const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadBackup() {
  const context = {
    window: {},
    structuredClone: global.structuredClone,
    Date, JSON, Math, Number, Object, Array, Set, Map, String, TypeError, Error, RegExp, Boolean,
  };
  vm.createContext(context);
  vm.runInContext(read("backup.js"), context, { filename: "backup.js" });
  return context.window.LCBackup;
}

function card(id, deckId, extra = {}) {
  return {
    id,
    deckId,
    type: "basic",
    front: `front-${id}`,
    back: `back-${id}`,
    state: "review",
    due: 10,
    reps: 1,
    lapses: 0,
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  };
}

function multiLanguageState() {
  return {
    dataModelVersion: 2,
    activeLearningLanguage: "nb",
    decks: [
      { id: "deck-en", name: "English", learningLanguage: "en", createdAt: 1, updatedAt: 2 },
      { id: "deck-nb", name: "Norsk", learningLanguage: "nb", createdAt: 1, updatedAt: 2 },
    ],
    cards: [card("card-en", "deck-en"), card("card-nb", "deck-nb")],
    languageProfiles: {
      en: {
        activeDeckId: "deck-en",
        history: { "2026-01-01": { reviewed: 3, again: 1, hard: 0, good: 1, easy: 1 } },
        streak: { current: 4, lastDay: "2026-01-01" },
        sessionReviewedIds: ["card-en"],
        practiceDraft: { step: "run", period: "all", deckId: "deck-en", selectedIds: ["card-en"] },
        studyResume: { deckId: "deck-en", index: 2 },
      },
      nb: {
        activeDeckId: "deck-nb",
        history: { "2026-01-02": { reviewed: 5, again: 0, hard: 1, good: 2, easy: 2 } },
        streak: { current: 9, lastDay: "2026-01-02" },
        sessionReviewedIds: ["card-nb"],
        practiceDraft: { step: "result", period: "days", deckId: "deck-nb", selectedIds: ["card-nb"] },
        studyResume: { deckId: "deck-nb", index: 1 },
      },
    },
    settings: { aiKey: "TOP-SECRET-SENTINEL" },
    revision: 7,
    updatedAt: 42,
  };
}

test("format 3 round-trip keeps every language profile while nb is active", () => {
  const backup = loadBackup();
  const snapshot = { state: multiLanguageState(), reviewEvents: [], practiceDraft: null };

  const text = backup.buildFullExport(snapshot);
  const payload = JSON.parse(text);
  assert.equal(payload.format, 3);
  assert.equal(payload.state.activeLearningLanguage, "nb");
  assert.equal(payload.state.dataModelVersion, 2);

  const restored = backup.parse(text);
  assert.equal(restored.kind, "full");
  assert.equal(restored.state.activeLearningLanguage, "nb");
  assert.equal(restored.state.languageProfiles.en.activeDeckId, "deck-en");
  assert.equal(restored.state.languageProfiles.nb.activeDeckId, "deck-nb");
  assert.equal(restored.state.languageProfiles.en.streak.current, 4);
  assert.equal(restored.state.languageProfiles.nb.streak.current, 9);
  assert.deepEqual(restored.state.languageProfiles.nb.sessionReviewedIds, ["card-nb"]);
  // The active profile drives the flat fields consumed on reload.
  assert.equal(restored.state.activeDeckId, "deck-nb");
  assert.equal(restored.state.streak.current, 9);
});

test("format 3 stores a practice draft inside each language profile", () => {
  const backup = loadBackup();
  const text = backup.buildFullExport({ state: multiLanguageState(), reviewEvents: [], practiceDraft: null });
  const payload = JSON.parse(text);

  assert.equal(payload.state.languageProfiles.en.practiceDraft.deckId, "deck-en");
  assert.equal(payload.state.languageProfiles.nb.practiceDraft.deckId, "deck-nb");
  assert.equal(payload.state.practiceDraft.deckId, "deck-nb");
});

test("legacy format 1 and raw legacy data migrate into the English profile", () => {
  const backup = loadBackup();
  const legacyState = {
    decks: [{ id: "deck-1", name: "Old", createdAt: 1, updatedAt: 2 }],
    cards: [card("card-1", "deck-1")],
    activeDeckId: "deck-1",
    history: { "2025-05-05": { reviewed: 2, again: 0, hard: 0, good: 1, easy: 1 } },
    streak: { current: 3, lastDay: "2025-05-05" },
    sessionReviewedIds: ["card-1"],
    settings: {},
  };

  const v1 = backup.parse(JSON.stringify({ app: backup.CONFIG.app, format: 1, kind: "full", state: legacyState }));
  assert.equal(v1.kind, "full");
  assert.equal(v1.state.activeLearningLanguage, "en");
  assert.equal(v1.state.decks[0].learningLanguage, "en");
  assert.equal(v1.state.languageProfiles.en.streak.current, 3);
  assert.equal(v1.state.languageProfiles.nb.activeDeckId, null);
  assert.equal(v1.state.languageProfiles.nb.streak.current, 0);

  const raw = backup.parse(JSON.stringify(legacyState));
  assert.equal(raw.kind, "full");
  assert.equal(raw.state.languageProfiles.en.activeDeckId, "deck-1");
});

test("format 2 backups stay importable and gain language profiles", () => {
  const backup = loadBackup();
  const v2 = backup.parse(JSON.stringify({
    app: backup.CONFIG.app,
    format: 2,
    kind: "full",
    metadata: { secretsIncluded: false },
    state: {
      decks: [{ id: "deck-1", name: "Old", createdAt: 1, updatedAt: 2 }],
      cards: [card("card-1", "deck-1")],
      activeDeckId: "deck-1",
      settings: {},
    },
    reviewEvents: [],
    practiceDraft: null,
  }));

  assert.equal(v2.kind, "full");
  assert.equal(v2.format, 2);
  assert.equal(v2.state.activeLearningLanguage, "en");
  assert.equal(v2.state.languageProfiles.en.activeDeckId, "deck-1");
});

test("broken references are dropped instead of repointed at the first deck", () => {
  const backup = loadBackup();
  const state = multiLanguageState();
  state.languageProfiles.nb.activeDeckId = "deck-en"; // wrong language
  state.languageProfiles.en.activeDeckId = "deck-missing"; // dangling
  state.languageProfiles.en.sessionReviewedIds = ["card-missing"];

  const restored = backup.parse(backup.buildFullExport({ state, reviewEvents: [], practiceDraft: null }));
  assert.equal(restored.kind, "full");
  assert.equal(restored.state.languageProfiles.nb.activeDeckId, null);
  assert.equal(restored.state.languageProfiles.en.activeDeckId, null);
  assert.deepEqual(restored.state.languageProfiles.en.sessionReviewedIds, []);
  assert.notEqual(restored.state.languageProfiles.nb.activeDeckId, "deck-en");
});

test("an unknown language code never creates an extra profile", () => {
  const backup = loadBackup();
  const state = multiLanguageState();
  state.activeLearningLanguage = "zz";
  state.languageProfiles.zz = { activeDeckId: "deck-nb" };

  const restored = backup.parse(backup.buildFullExport({ state, reviewEvents: [], practiceDraft: null }));
  assert.equal(restored.state.activeLearningLanguage, "en");
  assert.deepEqual(Object.keys(restored.state.languageProfiles).sort(), ["en", "nb"]);
});

test("unsupported and malformed payloads are rejected without data loss", () => {
  const backup = loadBackup();
  assert.equal(backup.parse(JSON.stringify({ app: backup.CONFIG.app, format: 9, kind: "full", state: {} })).reason, "unsupported-version");
  assert.equal(backup.parse("{not json").reason, "invalid-data");
  assert.equal(backup.parse(JSON.stringify({
    app: backup.CONFIG.app, format: 3, kind: "full", metadata: {}, state: multiLanguageState(),
  })).reason, "invalid-data");
});

test("quick backup and share use the same format 3 payload", () => {
  const backup = loadBackup();
  const state = multiLanguageState();
  const full = JSON.parse(backup.buildFullExport({ state, reviewEvents: [], practiceDraft: null }));
  const quick = JSON.parse(backup.buildExport(state));

  assert.equal(quick.format, full.format);
  assert.equal(quick.kind, full.kind);
  assert.deepEqual(Object.keys(quick.state.languageProfiles), Object.keys(full.state.languageProfiles));
  assert.equal(quick.state.activeLearningLanguage, full.state.activeLearningLanguage);
});

test("secret exclusion keeps the key out of a format 3 backup", () => {
  const backup = loadBackup();
  const text = backup.buildFullExport({ state: multiLanguageState(), reviewEvents: [], practiceDraft: null }, { includeSecrets: false });
  assert.ok(!text.includes("TOP-SECRET-SENTINEL"));
  assert.equal(backup.parse(text).secretPresent, false);
});
