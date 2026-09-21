const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const fsrsSource = fs.readFileSync(path.join(root, "fsrs.js"), "utf8");
const schedulerSource = fs.readFileSync(path.join(root, "js/scheduler.js"), "utf8");
const DAY_MS = 24 * 60 * 60 * 1000;

function card(overrides = {}) {
  return {
    id: "card-1",
    deckId: "deck-1",
    state: "new",
    step: 0,
    ease: 250,
    interval: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    ...overrides,
  };
}

function createRuntime({ settings = {}, cards = [] } = {}) {
  const recordedEvents = [];
  const deletedEventIds = [];
  // Controllable clock: FSRS stability only grows when time passes between
  // answers, so tests must be able to move Date.now() forward.
  const clock = { value: Date.now() };
  class FakeDate extends Date {}
  FakeDate.now = () => clock.value;
  const state = {
    settings: {
      algorithm: "fsrs",
      learnSteps: [1, 10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 250,
      easyBonus: 130,
      hardFactor: 120,
      intervalModifier: 100,
      lapseNewInterval: 0,
      lapseEasePenalty: 20,
      hardEasePenalty: 15,
      easyEaseBoost: 15,
      leechThreshold: 0,
      studyQueue: { new: true, learning: true, review: true },
      studyCardModes: ["word"],
      studyCardFronts: ["english"],
      ...settings,
    },
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    studyCycles: {},
    cards,
  };
  const context = {
    console,
    structuredClone: global.structuredClone,
    Date: FakeDate,
    Math: Object.create(Math),
    Number,
    Object,
    Array,
    Set,
    Map,
    JSON,
    isFinite,
    state,
    window: {},
    document: {},
    DAY_MS,
    todayKey: () => "2026-09-18",
    cardById: new Map(cards.map(item => [item.id, item])),
    cardsByDeck: new Map(),
    getCardById: id => state.cards.find(item => item.id === id) || null,
    getDeckCards: () => state.cards,
    $: () => ({ textContent: "" }),
    toast: () => {},
    t: key => key,
    save: () => {},
    renderStudy: () => {},
    markCardDirty: () => {},
    markMetaDirty: () => {},
    updateCardDifficulty: () => {},
    suspendCard: () => {},
    recordReviewEvent: (value, grade, at) => {
      const event = { id: `evt-${recordedEvents.length + 1}`, cardId: value.id, grade, at };
      recordedEvents.push(event);
      return event;
    },
    session: null,
  };
  context.window.LCStorage = {
    deleteReviewEventsByIds: ids => { deletedEventIds.push(...ids); },
  };
  vm.createContext(context);
  vm.runInContext(fsrsSource, context, { filename: "fsrs.js" });
  vm.runInContext(schedulerSource, context, { filename: "scheduler.js" });
  return { context, state, recordedEvents, deletedEventIds, clock };
}

test("FSRS: память карточки создаётся уже с первого ответа", () => {
  const runtime = createRuntime({ settings: { algorithm: "fsrs", learnSteps: [1] } });
  const value = card();
  runtime.state.cards.push(value);

  runtime.context.scheduleAnswer(value, 2);

  assert.equal(value.state, "review");
  assert.ok(value.fsrs, "fsrs model must exist after the first answer");
  assert.ok(Number.isFinite(value.fsrs.S) && value.fsrs.S > 0);
  assert.ok(Number.isFinite(value.fsrs.D) && value.fsrs.D >= 1 && value.fsrs.D <= 10);
  assert.ok(
    value.interval >= 2,
    "graduation interval must be FSRS-based (fixed settings interval is 1)",
  );
});

test("FSRS: память сохраняется между learning-шагами и растёт", () => {
  const runtime = createRuntime();
  const value = card();

  runtime.context.scheduleAnswer(value, 1);
  assert.equal(value.state, "learning");
  assert.ok(value.fsrs && Number.isFinite(value.fsrs.S));
  const firstStability = value.fsrs.S;

  runtime.clock.value += 10 * 60 * 1000;
  runtime.context.scheduleAnswer(value, 2);
  assert.equal(value.state, "learning");
  assert.ok(value.fsrs.S > firstStability, "stability must grow across learning steps");
  const secondStability = value.fsrs.S;

  runtime.clock.value += 10 * 60 * 1000;
  runtime.context.scheduleAnswer(value, 2);
  assert.equal(value.state, "review");
  assert.ok(value.fsrs.S > secondStability);
  assert.ok(value.interval >= 1);
});

test("FSRS: review-карточка планируется моделью, Again ставит короткий relearning-шаг", () => {
  const now = Date.now();
  const runtime = createRuntime();
  const value = card({
    state: "review",
    interval: 10,
    due: now - DAY_MS,
    reps: 5,
    fsrs: { S: 10, D: 5, lastReview: now - 10 * DAY_MS },
  });
  runtime.state.cards.push(value);

  runtime.context.scheduleAnswer(value, 0);
  assert.equal(value.state, "review");
  assert.equal(value.interval, 0, "Again must park the card on a short relearning step");
  assert.equal(value.lapses, 1);
  assert.ok(value.due - now <= 11 * 60000);

  const afterLapse = value.fsrs.S;
  runtime.clock.value += 10 * 60 * 1000;
  runtime.context.scheduleAnswer(value, 2);
  assert.ok(value.fsrs.S > afterLapse, "successful recall must grow stability after a lapse");
  assert.ok(value.interval >= 1 && value.interval <= 12);
});

test("SM-2 режим по-прежнему не использует FSRS-модель", () => {
  const runtime = createRuntime({ settings: { algorithm: "sm2", learnSteps: [1] } });
  const value = card();

  runtime.context.scheduleAnswer(value, 2);

  assert.equal(value.state, "review");
  assert.equal(value.interval, runtime.state.settings.graduatingInterval);
  assert.equal(value.fsrs, undefined);
});

test("Очередь: подошедшие learning-карточки идут перед review и new", () => {
  const now = Date.now();
  const learning = card({ id: "card-learning", state: "learning", step: 1, due: now - 60000 });
  const review = card({ id: "card-review", state: "review", interval: 10, due: now - 60000 });
  const fresh = card({ id: "card-new", state: "new" });
  const runtime = createRuntime({ cards: [review, fresh, learning] });
  runtime.context.session = {
    deckId: null,
    queue: [],
    queueHead: 0,
    queuedIds: new Set(),
    currentId: null,
  };

  runtime.context.refillStudyQueue(now);

  const ids = runtime.context.session.queue.map(entry => entry.id);
  assert.equal(ids[0], "card-learning");
  assert.ok(ids.indexOf("card-learning") < ids.indexOf("card-review"));
  assert.ok(ids.indexOf("card-learning") < ids.indexOf("card-new"));
});

test("Очередь: relearning-карточка FSRS (review с интервалом 0) тоже приоритетна", () => {
  const now = Date.now();
  const relearning = card({ id: "card-rel", state: "review", interval: 0, due: now - 1000 });
  const review = card({ id: "card-review", state: "review", interval: 10, due: now - 60000 });
  const runtime = createRuntime({ cards: [review, relearning] });
  runtime.context.session = {
    deckId: null,
    queue: [],
    queueHead: 0,
    queuedIds: new Set(),
    currentId: null,
  };

  runtime.context.refillStudyQueue(now);

  const ids = runtime.context.session.queue.map(entry => entry.id);
  assert.equal(ids[0], "card-rel");
  assert.ok(ids.indexOf("card-rel") < ids.indexOf("card-review"));
});

test("Undo восстанавливает снимок карточки, историю и удаляет записанное событие", () => {
  const runtime = createRuntime({ settings: { algorithm: "fsrs", learnSteps: [1] } });
  const value = card();
  runtime.state.cards.push(value);
  runtime.context.session = {
    deckId: null,
    queue: [],
    queueHead: 0,
    queuedIds: new Set(),
    currentId: value.id,
    currentCardVariants: [{ mode: "word", front: "english" }],
    currentCardVariantIndex: 0,
    currentCardGrades: [2],
    revealed: true,
    startedAt: Date.now(),
  };

  runtime.context.scheduleAnswer(value, 2);
  assert.equal(value.state, "review");
  assert.ok(value.fsrs);
  assert.equal(runtime.recordedEvents.length, 1);
  assert.ok(runtime.state.history["2026-09-18"]);

  runtime.context.undo();

  assert.equal(value.state, "new", "card must return to its pre-answer state");
  assert.equal(value.fsrs, undefined, "fsrs model created by the undone answer must be removed");
  assert.equal(value.reps, 0);
  assert.equal(runtime.deletedEventIds.length, 1);
  assert.equal(runtime.deletedEventIds[0], runtime.recordedEvents[0].id);
  assert.equal(runtime.state.history["2026-09-18"], undefined);
  assert.deepEqual(runtime.state.sessionReviewedIds, []);
  assert.equal(runtime.context.session.currentId, value.id);
  assert.equal(runtime.context.session.revealed, true);
});

test("Storage: удаление событий по id поддержано в дельтах и транзакции", () => {
  const storage = fs.readFileSync(path.join(root, "storage.js"), "utf8");
  assert.match(storage, /function deleteReviewEventsByIds/);
  assert.match(
    storage,
    /deleteReviewEventsByIds,\s*\n\s*getReviewEventsForCards/,
    "API must export deleteReviewEventsByIds",
  );
  assert.match(
    storage,
    /for \(const eventId of delta\.reviewEvents\.deleteEventIds \|\| \[\]\) events\.delete\(eventId\);/,
  );
  assert.match(storage, /deleteEventIds: \[\.\.\.\(changes\.reviewEvents\?\.deleteEventIds \|\| \[\]\)\]/);
});

test("Scheduler: undo удаляет review event по сохранённому id", () => {
  assert.match(schedulerSource, /\.reviewEventId = reviewEvent\.id/);
  assert.match(schedulerSource, /deleteReviewEventsByIds\?\.\(\[entry\.reviewEventId\]\)/);
});
