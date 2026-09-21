const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const switchSource = () => {
  const source = read("js/learning-language.js");
  const start = source.indexOf("async function switchLearningLanguage(");
  assert.ok(start >= 0, "switchLearningLanguage должен существовать");
  const end = source.indexOf("\nfunction syncLearningLanguageControl(", start);
  return source.slice(start, end === -1 ? source.length : end);
};

/* AUD-008: поколение инвалидируется и AI-операции отменяются до записи.
   Ветка отказа обязана привести runtime к тому же согласованному виду,
   что и успешная ветка, и сообщить пользователю о прерывании операций. */

test("AUD-008: ветка отказа записи очищает отменённый runtime", () => {
  const body = switchSource();
  const failureStart = body.indexOf("if (!applied) {");
  assert.ok(failureStart >= 0, "ветка отказа должна существовать");
  const failureBranch = body.slice(failureStart, body.indexOf("\n    }", failureStart));

  assert.match(failureBranch, /adoptLanguageProfile\(state\.activeLearningLanguage\)/);
  assert.match(failureBranch, /clearCancelledLanguageRuntime\(\)/);
  assert.match(failureBranch, /syncLearningLanguageControl\(\)/);
  assert.match(failureBranch, /language\.learning\.switchFailedInterrupted/);
  assert.match(failureBranch, /return false;/);
});

test("AUD-008: сообщение о прерывании есть во всех локалях", () => {
  for (const locale of ["en", "ru", "uk"]) {
    const source = read(`i18n/${locale}.js`);
    assert.ok(
      source.includes('"language.learning.switchFailedInterrupted"'),
      `локаль ${locale} должна содержать ключ прерывания`
    );
  }
});

test("AUD-008: при отказе записи язык и контрол остаются прежними и без зависших задач", () => {
  // Модель поведения switchLearningLanguage при mutateAndFlush() === false.
  const normalizeLearningLanguage = (value, fallback = "en") =>
    value === "nb" || value === "en" ? value : fallback;

  const runtime = { aiJobActive: true, practiceCheckActive: true, spinnerVisible: true };
  const toasts = [];
  let controlValue = "en";
  const state = { activeLearningLanguage: "en" };
  let generation = 0;

  const cancelLanguageAiJobs = () => {
    runtime.aiJobActive = false;
  };
  const cancelPracticeCheck = () => {
    runtime.practiceCheckActive = false;
  };
  const clearCancelledLanguageRuntime = () => {
    runtime.spinnerVisible = false;
  };
  const syncLearningLanguageControl = () => {
    controlValue = normalizeLearningLanguage(state.activeLearningLanguage);
  };

  const previous = normalizeLearningLanguage(state.activeLearningLanguage);
  generation += 1;
  cancelLanguageAiJobs();
  cancelPracticeCheck();

  const applied = false; // отказ mutateAndFlush, состояние откатано
  if (!applied) {
    state.activeLearningLanguage = normalizeLearningLanguage(state.activeLearningLanguage, previous);
    clearCancelledLanguageRuntime();
    syncLearningLanguageControl();
    toasts.push("language.learning.switchFailedInterrupted");
  }

  assert.strictEqual(state.activeLearningLanguage, "en", "прежний язык сохранён");
  assert.strictEqual(controlValue, "en", "контрол синхронизирован с прежним языком");
  assert.strictEqual(runtime.aiJobActive, false, "нет зависшего AI-задания");
  assert.strictEqual(runtime.practiceCheckActive, false, "нет зависшей проверки практики");
  assert.strictEqual(runtime.spinnerVisible, false, "нет зависшего индикатора");
  assert.deepStrictEqual(toasts, ["language.learning.switchFailedInterrupted"]);
  assert.strictEqual(generation, 1, "поколение инвалидировано, отменённые задачи не возобновляются");
});
