/* Пункт 7: практика, её история и черновики изолированы по языку обучения. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("записи истории практики получают язык обучения", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /function practiceHistoryLanguageOf\(entry\)/);
  assert.match(practice, /learningLanguage: code,/);
  assert.match(practice, /learningLanguage: practiceState\.learningLanguage \|\| activeLearningLanguageCode\(\),/);
});

test("показ, поиск и удаление истории фильтруются по активному языку", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /function activePracticeHistory\(\)/);
  assert.match(practice, /return allPracticeHistory\(\)\.filter\(entry => practiceHistoryLanguageOf\(entry\) === code\);/);
  // Все чтения истории идут через фильтр, а не напрямую по state.settings.
  const directReads = practice.match(/const hist = Array\.isArray\(state\.settings\.practiceHistory\)/g) || [];
  assert.equal(directReads.length, 0);
  assert.match(practice, /entry\.id === id && practiceHistoryLanguageOf\(entry\) === code/);
});

test("лимит истории независим для каждого языка", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /function trimPracticeHistory\(code\)/);
  assert.match(practice, /if \(practiceHistoryLanguageOf\(all\[i\]\) !== code\) continue;/);
  assert.match(practice, /if \(seen > PRACTICE_HISTORY_MAX\) removed\.push\(all\[i\]\);/);
  assert.match(practice, /trimPracticeHistory\(code\);/);
});

test("генерация и проверка практики используют язык обучения", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /const learnCode = activeLearningLanguageCode\(\);/);
  assert.match(practice, /const learnedName = learningLangName\(\);/);
  assert.match(practice, /Write one \$\{learnedName\} reading-comprehension text/);
  assert.match(practice, /questions in \$\{learnedName\} about the text/);
  assert.doesNotMatch(practice, /Write one English reading-comprehension text/);
});

test("поздний AI-ответ не пишет данные в чужой профиль", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /if \(activeLearningLanguageCode\(\) !== learnCode\) return;/);
  assert.match(practice, /if \(snapshot\.learningLanguage && activeLearningLanguageCode\(\) !== snapshot\.learningLanguage\) return false;/);
});

test("generation-токен реально используется, а не только объявлен", () => {
  const practice = read("js/ai-practice.js");
  // Цепочка en→nb→en оставляет код языка прежним: спасает только токен.
  assert.match(practice, /const learnGeneration = currentLanguageGeneration\(\);/);
  assert.match(practice, /if \(!isLanguageGenerationCurrent\(learnGeneration\)\) return;/);
  assert.match(practice, /languageGeneration: currentLanguageGeneration\(\),/);
  assert.match(practice, /!isLanguageGenerationCurrent\(snapshot\.languageGeneration\)\) return false;/);
});

test("массовое добавление карточек не пишет результат в чужой язык", () => {
  const decks = read("js/decks.js");
  assert.match(decks, /const bulkLearnCode = activeLearningLanguageCode\(\);/);
  assert.match(decks, /const bulkLearnGeneration = currentLanguageGeneration\(\);/);
  assert.match(decks, /activeLearningLanguageCode\(\) !== bulkLearnCode/);
  assert.match(decks, /!isLanguageGenerationCurrent\(bulkLearnGeneration\)/);
});

test("черновик практики сбрасывается при смене языка", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /function resetPracticeRuntime\(\)/);
  assert.match(practice, /learningLanguage: null,/);

  const lang = read("js/learning-language.js");
  assert.match(lang, /if \(typeof resetPracticeRuntime === "function"\) resetPracticeRuntime\(\);/);
});
