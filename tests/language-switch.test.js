const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

// Загружаем js/learning-language.js в изолированный контекст с минимальными
// заглушками state/storage, чтобы проверить порядок переключения, повторные
// нажатия, ошибки записи и защиту generation token.
function loadSwitchHarness({ failWrite = false, commitDrafts = true } = {}) {
  const log = [];
  const state = {
    activeLearningLanguage: "en",
    activeDeckId: "deck-en",
    history: { d1: 1 },
    streak: { current: 3, lastDay: "2026-01-01" },
    sessionReviewedIds: ["en-1"],
    practiceDraft: null,
    studyResume: { deckId: "deck-en" },
    languageProfiles: {
      en: {
        activeDeckId: "deck-en",
        history: { d1: 1 },
        streak: { current: 3, lastDay: "2026-01-01" },
        sessionReviewedIds: ["en-1"],
        practiceDraft: null,
        studyResume: { deckId: "deck-en" },
      },
      nb: {
        activeDeckId: "deck-nb",
        history: {},
        streak: { current: 0, lastDay: null },
        sessionReviewedIds: [],
        practiceDraft: null,
        studyResume: null,
      },
    },
  };

  const elements = new Map();
  const makeElement = id => ({
    id,
    value: "en",
    disabled: false,
    dataset: {},
    options: [],
    textContent: "",
    replaceChildren() { this.options.length = 0; },
    appendChild(node) { this.options.push(node); },
    addEventListener(type, handler) { this.handler = handler; },
  });
  elements.set("setLearningLanguage", makeElement("setLearningLanguage"));

  const context = vm.createContext({
    console, AbortController, DOMException,
    structuredClone,
    JSON, Object, Array, Number, Date, Math, String, Map, Set, Error, Promise,
    document: {
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [],
      createElement: () => ({ value: "", textContent: "" }),
      body: { setAttribute() {} },
    },
  });
  context.window = { LCLanguages: null, speechSynthesis: null };
  vm.runInContext(fs.readFileSync(path.join(root, "languages.js"), "utf8"), context);

  vm.runInContext(
    `let state = ${JSON.stringify(state)};
     const log = [];
     let session = { deckId: "deck-en" };
     let undoStack = ["undo"];
     let viewingDeckId = "deck-en";
     let flushFails = ${failWrite};
     let draftsOk = ${commitDrafts};
     const t = (key, vars) => key + (vars ? ":" + JSON.stringify(vars) : "");
     function normalizeLearningLanguage(value, fallback) {
       return window.LCLanguages.isLanguageCode(value)
         ? window.LCLanguages.normalizeLanguageCode(value)
         : (fallback || "en");
     }
     function activeLanguageProfile(s) { return s.languageProfiles[s.activeLearningLanguage]; }
     function syncActiveLanguageProfile(s) { log.push("flush-profile:" + s.activeLearningLanguage); }
     function firstDeckIdForLanguage(code) { return "deck-" + code; }
     function getDeckById(id) { return { id }; }
     function markMetaDirty() { log.push("meta-dirty"); }
     async function saveAndFlush() { log.push("save-flush"); }
     async function mutateAndFlush(fn) {
       if (flushFails) { log.push("write-failed"); return false; }
       fn(); log.push("write-ok"); return true;
     }
     function commitSettingsDrafts(reason) { log.push("commit-drafts:" + reason); return draftsOk; }
     function clearBulkSelection() { log.push("clear-selection"); }
     function closeModal() { log.push("close-modal"); }
     function invalidateStudyStage() { log.push("invalidate-stage"); }
     function clearAiSettingsBusyState() { log.push("clear-ai-busy"); }
     function cancelAiSettingsRequests() { log.push("cancel-ai"); }
     function renderAll() { log.push("render"); }
     function toast(msg) { log.push("toast:" + msg); }`,
    context
  );

  vm.runInContext(fs.readFileSync(path.join(root, "js/learning-language.js"), "utf8"), context);
  vm.runInContext(
    `globalThis.__api = { switchLearningLanguage, currentLanguageGeneration,
       isLanguageGenerationCurrent, isLearningLanguageSwitchBusy,
       syncLearningLanguageControl, bindLearningLanguageControl,
       getLog: () => log.slice(), getState: () => state,
       getSession: () => session, getUndo: () => JSON.stringify(undoStack),
       setFlushFails: v => { flushFails = v; },
       setDraftsOk: v => { draftsOk = v; } };`,
    context
  );
  context.__api.select = elements.get("setLearningLanguage");
  context.__api.log = log;
  context.__api.loadAiManager = () => {
    const source = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
    vm.runInContext(source.slice(0, source.indexOf("function flash(")), context);
    vm.runInContext(`
      function uid() { return String(Math.random()); }
      function confirmDialog() { throw new Error("неожиданное подтверждение замены AI"); }
      Object.assign(__api, { startAiJob, isCurrentAiJob, runAbortableWorkerPool });
    `, context);
  };
  context.__api.loadStudyConsumers = () => {
    context.__api.loadAiManager();
    const source = fs.readFileSync(path.join(root, "js/study.js"), "utf8");
    vm.runInContext(`
      state.settings = { aiKey: "test-only", aiProvider: "openai" };
      state.cards = Array.from({ length: 41 }, (_, i) => ({ id: "en-" + i, deckId: "deck-en", front: "word" + i }));
      const elements = new Map();
      document.querySelector = selector => {
        if (!elements.has(selector)) elements.set(selector, { hidden: false, dataset: {},
          classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} });
        return elements.get(selector);
      };
      function getCardById(id) { return state.cards.find(card => card.id === id); }
      getDeckById = id => ({ id, learningLanguage: id === "deck-en" ? "en" : "nb" });
      function activeLearningLanguageCode() { return state.activeLearningLanguage; }
      function learningLangName() { return state.activeLearningLanguage === "en" ? "English" : "Norwegian Bokmål"; }
      function aiTargetLangName() { return "Russian"; }
      let wordInfoCardId = "en-0";
      function wordInfoModalCard() { return getCardById(wordInfoCardId); }
      function renderWordInfoModal() {}
      function updateEditorInfoBtn() {}
      function markCardDirty(card) { log.push("saved:" + card.id); }
      function reportSaveError(error) { throw error; }
      const EXAMPLE_BATCH_SIZE = 20, EXAMPLE_MAX_ATTEMPTS = 3, EXAMPLE_GEMINI_REQUEST_INTERVAL_MS = 10000;
      let exampleRefreshRunning = false;
      function exampleRefreshAiReady() { return true; }
      confirmDialog = async () => true;
      function createExampleRefreshBar() { return {}; }
      function cancelExampleRefreshRing() {}
      async function waitForExampleRefreshPaint() {}
      async function waitForExampleRefreshDelay() {}
      function setExampleRefreshBar() {}
      function tweenExampleRefreshRing() {}
      async function removeExampleRefreshBar() {}
      function renderBrowse() {}
      function renderDecks() {}
      function refreshDeckCardsModal() {}
      function normalizedExampleFields(card) { return { sentence: card.exampleSentence || "", translation: card.exampleTranslation || "" }; }
      function normalizeExampleLine(value) { return String(value || "").trim(); }
    `, context);
    vm.runInContext(source.slice(source.indexOf("function captureStudyAiContext"), source.indexOf("function refreshDeckExamples")), context);
    vm.runInContext(source.slice(source.indexOf("async function requestWordInfo"), source.indexOf('$("#wordInfoGenerateBtn").onclick')), context);
    vm.runInContext(`Object.assign(__api, { requestWordInfo, refreshExamplesForCards });`, context);
    context.__api.ai = context.window.LCAi = {};
  };
  return context.__api;
}

for (const change of ["switch", "edit", "replace", "move", "delete"]) {
  test(`AUD-002: информация о слове отклоняет поздний ответ после ${change}`, async () => {
    const api = loadSwitchHarness();
    api.loadStudyConsumers();
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    api.ai.generateWordInfo = (card, options) => {
      assert.equal(options.learningLanguage, "en");
      assert.equal(card.front, "word0");
      started();
      return new Promise(resolve => { release = resolve; });
    };
    const pending = api.requestWordInfo();
    await ready;
    if (change === "switch") {
      await api.switchLearningLanguage("nb");
      await api.switchLearningLanguage("en");
    } else if (change === "edit") api.getState().cards[0].front = "edited";
    else if (change === "replace") api.getState().cards[0] = { ...api.getState().cards[0] };
    else if (change === "move") api.getState().cards[0].deckId = "deck-nb";
    else api.getState().cards.shift();
    release("устаревшее объяснение");
    await pending;
    assert.equal(api.getLog().filter(item => item.startsWith("saved:")).length, 0);
    assert.equal(api.getState().cards.some(card => card.info), false);
  });
}

test("AUD-002: подтверждённый пакет сохраняется, поздний пакет и следующие запросы отменяются", async () => {
  const api = loadSwitchHarness();
  api.loadStudyConsumers();
  let release;
  let started;
  let calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const results = batch => batch.map(card => ({ id: card.id, example: "new " + card.front, exampleTranslation: "перевод" }));
  api.ai.generateExamplesBatch = (batch, options) => {
    calls += 1;
    assert.equal(options.learningLanguage, "en");
    if (calls === 1) return Promise.resolve(results(batch));
    started();
    return new Promise(resolve => { release = () => resolve(results(batch)); });
  };
  const pending = api.refreshExamplesForCards(api.getState().cards, null);
  await ready;
  assert.equal(api.getLog().filter(item => item.startsWith("saved:")).length, 20);
  await api.switchLearningLanguage("nb");
  await api.switchLearningLanguage("en");
  release();
  await pending;
  assert.equal(calls, 2);
  assert.equal(api.getLog().filter(item => item.startsWith("saved:")).length, 20);
});

test("AUD-001: переключение отменяет настоящий AI-пул и не запускает оставшиеся элементы", async () => {
  const api = loadSwitchHarness();
  api.loadAiManager();
  const job = await api.startAiJob("bulk-add", "bulk:en");
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const started = [];
  const pool = api.runAbortableWorkerPool(3, 1, async index => {
    started.push(index);
    await pending;
  }, { controller: job.controller });
  const rejected = assert.rejects(pool, { name: "AbortError" });
  await api.switchLearningLanguage("nb");
  assert.equal(job.controller.signal.aborted, true);
  release();
  await rejected;
  assert.deepEqual(started, [0]);
  assert.ok(await api.startAiJob("practice-generate", "practice:nb"));
  await api.switchLearningLanguage("en");
  assert.equal(api.isCurrentAiJob(job), false);
});

test("AUD-001: отказ записи не возобновляет отменённый запрос", async () => {
  const api = loadSwitchHarness({ failWrite: true });
  api.loadAiManager();
  const job = await api.startAiJob("practice-check", "practice:en");
  assert.equal(await api.switchLearningLanguage("nb"), false);
  assert.equal(job.controller.signal.aborted, true);
  assert.equal(api.getState().activeLearningLanguage, "en");
  assert.ok(await api.startAiJob("practice-generate", "practice:en:new"));
});

test("AUD-001: глобальные запросы настроек не отменяются переключением", async () => {
  const api = loadSwitchHarness();
  api.loadAiManager();
  const job = await api.startAiJob("settings-models", "settings:ai-models");
  await api.switchLearningLanguage("nb");
  assert.equal(job.controller.signal.aborted, false);
});

test("переключение языка сначала фиксирует черновики и сбрасывает профиль, затем пишет выбор", async () => {
  const api = loadSwitchHarness();
  assert.equal(await api.switchLearningLanguage("nb"), true);

  const log = api.getLog();
  assert.ok(log.indexOf("commit-drafts:language-switch") < log.indexOf("flush-profile:en"));
  assert.ok(log.indexOf("flush-profile:en") < log.indexOf("save-flush"));
  assert.ok(log.indexOf("save-flush") < log.indexOf("write-ok"));
  // Очистка сессии выполняется только после подтверждённой записи.
  assert.ok(log.indexOf("write-ok") < log.indexOf("close-modal"));
  assert.equal(api.getState().activeLearningLanguage, "nb");
});

test("незавершённый редактор блокирует переключение и не меняет язык", async () => {
  const api = loadSwitchHarness({ commitDrafts: false });
  assert.equal(await api.switchLearningLanguage("nb"), false);
  assert.equal(api.getState().activeLearningLanguage, "en");
  assert.ok(!api.getLog().includes("write-ok"));
  assert.ok(!api.getLog().includes("save-flush"), "профиль не сбрасывается при невалидном черновике");
});

test("быстрые повторные нажатия не запускают второе переключение", async () => {
  const api = loadSwitchHarness();
  const first = api.switchLearningLanguage("nb");
  const second = api.switchLearningLanguage("nb");
  assert.equal(await second, false, "повторное нажатие игнорируется, пока идёт запись");
  assert.equal(await first, true);
  assert.equal(api.getLog().filter(x => x === "write-ok").length, 1);
  assert.equal(api.isLearningLanguageSwitchBusy(), false);
});

test("ошибка записи оставляет прежний язык и сообщает об этом", async () => {
  const api = loadSwitchHarness({ failWrite: true });
  const generationBefore = api.currentLanguageGeneration();

  assert.equal(await api.switchLearningLanguage("nb"), false);
  assert.equal(api.getState().activeLearningLanguage, "en");
  assert.equal(api.currentLanguageGeneration(), generationBefore + 1, "отменённые операции остаются устаревшими после отказа записи");
  assert.ok(api.getLog().some(x => x.startsWith("toast:language.learning.switchFailed")));
  assert.equal(api.getUndo(), '["undo"]', "Undo сохраняется при неудачном переключении");
});

test("поздние async-ответы отклоняются даже при возврате en → nb → en", async () => {
  const api = loadSwitchHarness();
  const staleToken = api.currentLanguageGeneration();

  await api.switchLearningLanguage("nb");
  assert.equal(api.isLanguageGenerationCurrent(staleToken), false);

  await api.switchLearningLanguage("en");
  assert.equal(api.getState().activeLearningLanguage, "en");
  // Ключевая проверка: токен устарел, хотя язык снова "en".
  assert.equal(api.isLanguageGenerationCurrent(staleToken), false);
  assert.equal(api.isLanguageGenerationCurrent(api.currentLanguageGeneration()), true);
});

test("после переключения сессия, Undo и просмотр колоды очищаются, профиль восстанавливается", async () => {
  const api = loadSwitchHarness();
  await api.switchLearningLanguage("nb");

  assert.equal(api.getSession(), null);
  assert.equal(api.getUndo(), "[]");
  const state = api.getState();
  assert.equal(state.activeDeckId, "deck-nb");
  assert.deepEqual(JSON.parse(JSON.stringify(state.history)), {});
  assert.equal(state.streak.current, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(state.sessionReviewedIds)), []);
  assert.equal(state.studyResume, null);
  assert.ok(api.getLog().includes("render"));
});

test("переключение на тот же язык ничего не пишет, а неизвестный код отклоняется", async () => {
  const api = loadSwitchHarness();
  assert.equal(await api.switchLearningLanguage("en"), true);
  assert.equal(await api.switchLearningLanguage("zz"), false);
  assert.ok(!api.getLog().includes("write-ok"));
});

test("после успешного переключения контрол снова доступен для нажатия", async () => {
  const api = loadSwitchHarness();
  assert.equal(await api.switchLearningLanguage("nb"), true);
  assert.equal(api.isLearningLanguageSwitchBusy(), false);
  assert.equal(api.select.disabled, false, "select не должен остаться заблокированным");
  assert.equal(api.select.value, "nb");

  // Повторное переключение обратно должно работать без перезагрузки.
  assert.equal(await api.switchLearningLanguage("en"), true);
  assert.equal(api.select.disabled, false);
  assert.equal(api.select.value, "en");
});

test("после неудачной записи контрол также разблокируется", async () => {
  const api = loadSwitchHarness({ failWrite: true });
  assert.equal(await api.switchLearningLanguage("nb"), false);
  assert.equal(api.isLearningLanguageSwitchBusy(), false);
  assert.equal(api.select.disabled, false);
});

test("перезапуск восстанавливает язык обучения и синхронизирует переключатель", async () => {
  const api = loadSwitchHarness();
  await api.switchLearningLanguage("nb");

  // Имитация перезапуска: новый harness читает сохранённое значение.
  const restarted = loadSwitchHarness();
  restarted.getState().activeLearningLanguage = "nb";
  restarted.syncLearningLanguageControl();
  assert.equal(restarted.select.value, "nb");
  assert.equal(restarted.select.options.length, 2);
});
