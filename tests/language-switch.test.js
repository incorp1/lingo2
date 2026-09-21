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
    console,
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
  return context.__api;
}

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
  assert.equal(api.currentLanguageGeneration(), generationBefore, "generation не растёт без записи");
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
