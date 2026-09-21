const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createLegacySnapshot } = require("./legacy-language-fixture.cjs");
const { createStorageHarness } = require("./language-storage-harness.cjs");

const root = path.join(__dirname, "..");
const plain = value => JSON.parse(JSON.stringify(value));

// Execute languages.js plus the language-model part of js/state.js in an
// isolated context: no DOM, no storage, only the real production source.
function loadLanguageModel() {
  const context = vm.createContext({ console, structuredClone, JSON, Object, Array, Number, Date, Math, String });
  vm.runInContext(fs.readFileSync(path.join(root, "languages.js"), "utf8"), context);
  const stateSource = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
  const start = stateSource.indexOf("/* ----- Learning languages");
  const end = stateSource.indexOf("function normalizeLoadedState", start);
  assert.ok(start > 0 && end > start, "language model block must exist in js/state.js");
  vm.runInContext(
    "let state = null;\n" +
    "function cloneSettingValue(value) { return value === undefined ? undefined : structuredClone(value); }\n" +
    "let deckById = new Map();\n" +
    stateSource.slice(start, end) +
    "\nglobalThis.__api = { normalizeLanguageModel, normalizeLearningLanguage, emptyLanguageProfile, activeLanguageProfile, syncActiveLanguageProfile, languageCodes };",
    context
  );
  return context.__api;
}

const api = loadLanguageModel();

function legacyLoadedState() {
  const snapshot = createLegacySnapshot();
  const loaded = snapshot.state;
  loaded.practiceDraft = snapshot.practiceDraft;
  return loaded;
}

test("реестр языков содержит только en и nb с ожидаемыми атрибутами", () => {
  assert.deepEqual(plain(api.languageCodes()), ["en", "nb"]);
  assert.equal(api.normalizeLearningLanguage("nb"), "nb");
  assert.equal(api.normalizeLearningLanguage("de"), "en");
  assert.equal(api.normalizeLearningLanguage(undefined), "en");
});

test("миграция старого состояния переносит весь прогресс в en и оставляет nb пустым", () => {
  const migrated = api.normalizeLanguageModel(legacyLoadedState());
  assert.equal(migrated.activeLearningLanguage, "en");
  assert.equal(migrated.dataModelVersion, 2);
  assert.equal(migrated.decks[0].learningLanguage, "en");

  const en = migrated.languageProfiles.en;
  assert.equal(en.activeDeckId, "legacy-deck");
  assert.deepEqual(plain(en.streak), { current: 7, lastDay: "2025-06-15" });
  assert.deepEqual(plain(en.sessionReviewedIds), ["legacy-review"]);
  assert.equal(en.history["2025-06-15"].reviewed, 9);
  assert.equal(en.practiceDraft.payload.title, "The house");

  const nb = migrated.languageProfiles.nb;
  assert.deepEqual(plain(nb), plain(api.emptyLanguageProfile()));

  // Общие данные остаются глобальными и не дробятся по языкам.
  assert.equal(migrated.cards.length, 2);
  assert.equal(migrated.studyCycles["legacy-review"].index, 1);
  assert.equal(migrated.settings.practiceHistory.length, 1);
});

test("повторная миграция уже мигрированного состояния ничего не меняет", () => {
  const once = api.normalizeLanguageModel(legacyLoadedState());
  const twice = api.normalizeLanguageModel(structuredClone(once));
  assert.deepEqual(plain(twice.languageProfiles), plain(once.languageProfiles));
  assert.equal(twice.activeLearningLanguage, once.activeLearningLanguage);
  assert.equal(twice.dataModelVersion, once.dataModelVersion);
});

test("активный профиль зеркалится в совместимые поля и синхронизируется обратно", () => {
  const migrated = api.normalizeLanguageModel(legacyLoadedState());
  migrated.activeLearningLanguage = "nb";
  const normalized = api.normalizeLanguageModel(migrated);
  assert.equal(normalized.activeDeckId, null);
  assert.deepEqual(plain(normalized.streak), { current: 0, lastDay: null });

  normalized.streak = { current: 3, lastDay: "2025-07-01" };
  normalized.sessionReviewedIds = ["nb-card"];
  api.syncActiveLanguageProfile(normalized);
  assert.deepEqual(plain(normalized.languageProfiles.nb.streak), { current: 3, lastDay: "2025-07-01" });
  // Английский профиль не затронут записью норвежского.
  assert.deepEqual(plain(normalized.languageProfiles.en.streak), { current: 7, lastDay: "2025-06-15" });
});

test("повреждённая ссылка activeDeckId не переносит прогресс в чужую колоду", () => {
  const loaded = legacyLoadedState();
  loaded.activeDeckId = "missing-deck";
  const migrated = api.normalizeLanguageModel(loaded);
  assert.equal(migrated.languageProfiles.en.activeDeckId, "legacy-deck");
  assert.equal(migrated.languageProfiles.nb.activeDeckId, null);
});

test("языковая метаинформация переживает запись и переоткрытие IndexedDB", async t => {
  const snapshot = createLegacySnapshot();
  snapshot.state = api.normalizeLanguageModel(snapshot.state);
  snapshot.state.activeLearningLanguage = "nb";
  snapshot.state.languageProfiles.nb.streak = { current: 2, lastDay: "2025-07-02" };

  const first = await createStorageHarness();
  t.after(() => first.close());
  await first.storage.replaceAppSnapshot(snapshot, { expectedRevision: 0 });
  await first.close();

  const second = await createStorageHarness(first.indexedDB);
  t.after(() => second.close());
  const reopened = await second.storage.readAppSnapshot();
  assert.equal(reopened.state.activeLearningLanguage, "nb");
  assert.equal(reopened.state.dataModelVersion, 2);
  assert.deepEqual(reopened.state.languageProfiles.nb.streak, { current: 2, lastDay: "2025-07-02" });
  assert.deepEqual(reopened.state.languageProfiles.en.streak, { current: 7, lastDay: "2025-06-15" });
  assert.equal(reopened.state.decks[0].learningLanguage, "en");
});

test("отклонённая запись не повреждает сохранённые языковые профили", async t => {
  const snapshot = createLegacySnapshot();
  snapshot.state = api.normalizeLanguageModel(snapshot.state);
  const runtime = await createStorageHarness();
  t.after(() => runtime.close());
  await runtime.storage.replaceAppSnapshot(snapshot, { expectedRevision: 0 });
  const before = await runtime.storage.readAppSnapshot();

  runtime.environment.__LCStorageBeforeStateWrite = () => {
    throw Object.assign(new Error("Проверочный отказ записи"), { name: "QuotaExceededError" });
  };
  const broken = structuredClone(snapshot);
  broken.state.languageProfiles.en.streak = { current: 999, lastDay: "2030-01-01" };
  await assert.rejects(
    runtime.storage.replaceAppSnapshot(broken, { expectedRevision: before.state.revision }),
    { name: "QuotaExceededError" }
  );
  assert.deepEqual(plain(await runtime.storage.readAppSnapshot()), plain(before));
});
