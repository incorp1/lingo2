const assert = require("node:assert/strict");
const test = require("node:test");
const { createLegacySnapshot } = require("./legacy-language-fixture.cjs");
const { createStorageHarness } = require("./language-storage-harness.cjs");

const plain = value => JSON.parse(JSON.stringify(value));

function assertLegacyContent(actual, expected) {
  assert.deepEqual(plain(actual.state.cards), expected.state.cards);
  assert.deepEqual(plain(actual.state.decks), expected.state.decks);
  for (const field of ["history", "streak", "sessionReviewedIds", "studyCycles", "settings"]) {
    assert.deepEqual(plain(actual.state[field]), expected.state[field], field);
  }
  assert.equal(actual.state.activeDeckId, expected.state.activeDeckId);
  assert.deepEqual(plain(actual.reviewEvents), expected.reviewEvents);
  assert.deepEqual(plain(actual.practiceDraft), expected.practiceDraft);
}

test("фикстуры старого состояния независимы и не содержат пользовательских ключей", () => {
  const first = createLegacySnapshot();
  const second = createLegacySnapshot();
  first.state.cards[0].fsrs.S = 100;
  first.practiceDraft.answers[0] = "Изменено";
  assert.equal(second.state.cards[0].fsrs.S, 12.75);
  assert.equal(second.practiceDraft.answers[0], "The house is");
  assert.equal(second.state.settings.aiKey, "");
  assert.equal(second.state.studyCycles["legacy-review"].index, 1);
  assert.equal(second.state.cards[1].suspendedFrom, "review");
});

test("исходный snapshot сохраняет контент, прогресс, практику и события после переоткрытия IndexedDB", async t => {
  const snapshot = createLegacySnapshot();
  const first = await createStorageHarness();
  t.after(() => first.close());
  await first.storage.replaceAppSnapshot(snapshot, { expectedRevision: 0 });
  assertLegacyContent(await first.storage.readAppSnapshot(), snapshot);
  await first.close();
  const second = await createStorageHarness(first.indexedDB);
  t.after(() => second.close());
  assertLegacyContent(await second.storage.readAppSnapshot(), snapshot);
});

test("отклонённая запись оставляет исходный snapshot восстановимым", async t => {
  const snapshot = createLegacySnapshot();
  const runtime = await createStorageHarness();
  t.after(() => runtime.close());
  await runtime.storage.replaceAppSnapshot(snapshot, { expectedRevision: 0 });
  const before = await runtime.storage.readAppSnapshot();
  runtime.environment.__LCStorageBeforeStateWrite = () => {
    throw Object.assign(new Error("Проверочный отказ записи"), { name: "QuotaExceededError" });
  };
  const changed = createLegacySnapshot();
  changed.state.cards[0].front = "Не должно сохраниться";
  await assert.rejects(runtime.storage.replaceAppSnapshot(changed, { expectedRevision: before.state.revision }), { name: "QuotaExceededError" });
  assert.deepEqual(plain(await runtime.storage.readAppSnapshot()), plain(before));
});
