const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadScheduler() {
  const context = {
    console,
    structuredClone: global.structuredClone,
    Date,
    Math,
    Number,
    Object,
    Array,
    Set,
    Map,
    JSON,
    state: {
      settings: {
        studyCardModes: ["word", "sentence"],
        studyCardFronts: ["english", "local"],
      },
      studyCycles: {},
      cards: [],
    },
    session: null,
    markMetaDirty() {},
    renderStudy() {},
    updateUndoBtn() {},
    toast() {},
    t(value) { return value; },
    getCardById() { return null; },
    getDeckCards() { return []; },
    DAY_MS: 86400000,
    window: {},
    document: {},
  };
  vm.createContext(context);
  vm.runInContext(read("js/scheduler.js"), context, { filename: "scheduler.js" });
  return context;
}

function createSession(cardId = "card-1") {
  return {
    currentId: cardId,
    currentCardVariants: [
      { mode: "word", front: "english" },
      { mode: "sentence", front: "local" },
      { mode: "word", front: "local" },
      { mode: "sentence", front: "english" },
    ],
    currentCardVariantIndex: 0,
    currentCardGrades: [],
    currentCardMode: "word",
    currentCardFront: "english",
    revealed: true,
    startedAt: 1,
  };
}

test("AUD-003: возобновление сохраняет последнюю сессию и точный вариант после перезапуска", () => {
  const runtime = loadScheduler();
  const card = { id: "card-1", deckId: "deck-en", state: "new" };
  runtime.state.cards = [card];
  runtime.getCardById = id => runtime.state.cards.find(item => item.id === id);
  runtime.getDeckCards = () => runtime.state.cards;
  runtime.session = { ...createSession(), deckId: "deck-en" };
  runtime.state.sessionReviewedIds = ["completed-en"];
  runtime.advanceStudyCardVariant(2);
  runtime.saveCurrentStudyResume();
  const saved = structuredClone(runtime.state);
  runtime.session = null;
  runtime.state = saved;
  runtime.startSession("deck-en", { resume: true });
  assert.equal(runtime.session.currentId, "card-1");
  assert.equal(runtime.session.currentCardVariantIndex, 1);
  assert.deepEqual(Array.from(runtime.session.currentCardGrades), [2]);
  assert.deepEqual(Array.from(runtime.state.sessionReviewedIds), ["completed-en"]);
  assert.equal(runtime.session.revealed, false);
  runtime.startSession("deck-en", { preserveCurrent: true });
  assert.equal(runtime.session.currentCardVariants.length, 4);
  assert.equal(runtime.session.currentCardVariantIndex, 1);
});

test("AUD-003: цикл первого варианта сохраняется до первого ответа", () => {
  const runtime = loadScheduler();
  runtime.session = { ...createSession(), deckId: "deck-en" };
  runtime.saveCurrentStudyResume();
  assert.equal(runtime.state.studyCycles["card-1"].index, 0);
  assert.equal(runtime.state.studyResume.currentId, "card-1");
});

test("незавершённый цикл сохраняется после каждого из первых трёх ответов", () => {
  const runtime = loadScheduler();
  runtime.session = createSession();

  for (const grade of [3, 2, 1]) {
    const result = runtime.advanceStudyCardVariant(grade);
    assert.equal(result.complete, false);
    assert.equal(runtime.saveCurrentStudyCycle(), true);
    const saved = runtime.state.studyCycles["card-1"];
    assert.equal(saved.index, saved.grades.length);
    assert.deepEqual(Array.from(saved.grades), [3, 2, 1].slice(0, saved.index));
  }
});

test("после перезапуска цикл продолжается с первого непройденного варианта", () => {
  const first = loadScheduler();
  first.session = createSession();
  first.advanceStudyCardVariant(3);
  first.advanceStudyCardVariant(1);
  first.saveCurrentStudyCycle();

  const restored = loadScheduler();
  restored.state.studyCycles = structuredClone(first.state.studyCycles);
  restored.session = createSession();
  restored.restoreStudyCardVariant({ id: "card-1" });

  assert.equal(restored.session.currentCardVariantIndex, 2);
  assert.deepEqual(Array.from(restored.session.currentCardGrades), [3, 1]);
  assert.equal(restored.session.currentCardMode, "word");
  assert.equal(restored.session.currentCardFront, "local");
});

test("итог цикла использует худшую оценку и очищается ровно один раз", () => {
  const runtime = loadScheduler();
  runtime.session = createSession();

  for (const grade of [3, 2, 1]) {
    assert.equal(runtime.advanceStudyCardVariant(grade).complete, false);
    runtime.saveCurrentStudyCycle();
  }
  const result = runtime.advanceStudyCardVariant(2);
  assert.equal(result.complete, true);
  assert.equal(result.grade, 1);
  assert.equal(runtime.clearStudyCycle("card-1"), true);
  assert.equal(runtime.clearStudyCycle("card-1"), false);
  assert.equal(runtime.state.studyCycles["card-1"], undefined);
});

test("некорректные и относящиеся к удалённым карточкам циклы отбрасываются", () => {
  const source = read("js/state.js");
  const start = source.indexOf("function normalizeStudyCycles");
  const end = source.indexOf("\nfunction normalizeLoadedState", start);
  const context = { Number, Object, Array, Set };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  const normalized = context.normalizeStudyCycles({
    "card-1": {
      variants: [
        { mode: "word", front: "english" },
        { mode: "sentence", front: "local" },
      ],
      index: 1,
      grades: [2],
      updatedAt: 10,
    },
    "card-deleted": {
      variants: [
        { mode: "word", front: "english" },
        { mode: "sentence", front: "local" },
      ],
      index: 1,
      grades: [1],
    },
    "card-2": {
      variants: [{ mode: "invalid", front: "english" }],
      index: 1,
      grades: [],
    },
  }, [{ id: "card-1" }, { id: "card-2" }]);

  assert.deepEqual(Object.keys(normalized), ["card-1"]);
  assert.deepEqual(Array.from(normalized["card-1"].grades), [2]);
});

test("полная резервная копия сохраняет валидный незавершённый цикл", () => {
  const context = {
    window: {},
    structuredClone: global.structuredClone,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    Set,
    String,
    TypeError,
  };
  vm.createContext(context);
  vm.runInContext(read("backup.js"), context, { filename: "backup.js" });

  const state = {
    decks: [{ id: "deck-1", name: "Deck", direction: "forward", createdAt: 1 }],
    cards: [{
      id: "card-1", deckId: "deck-1", type: "basic", front: "word", back: "слово",
      state: "new", step: 0, ease: 250, interval: 0, due: 1, reps: 0, lapses: 0,
      createdAt: 1, lastReview: null,
    }],
    activeDeckId: "deck-1",
    settings: { studyCardModes: ["word", "sentence"], studyCardFronts: ["english", "local"] },
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    studyCycles: {
      "card-1": {
        variants: [
          { mode: "word", front: "english" },
          { mode: "sentence", front: "local" },
        ],
        index: 1,
        grades: [0],
        updatedAt: 5,
      },
    },
  };

  const text = context.window.LCBackup.buildFullExport({
    state,
    reviewEvents: [],
    practiceDraft: null,
  });
  const restored = context.window.LCBackup.parse(text);
  assert.equal(restored.kind, "full");
  assert.equal(restored.state.studyCycles["card-1"].index, 1);
  assert.deepEqual(Array.from(restored.state.studyCycles["card-1"].grades), [0]);
});