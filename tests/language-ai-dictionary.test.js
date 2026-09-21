/* Пункт 6: AI, словарь и перевод должны учитывать язык обучения. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("словарь не вызывается для неподдерживаемого языка и не падает на английский", () => {
  const ai = read("ai.js");
  assert.match(ai, /function dictionaryCodeFor\(code\)/);
  assert.match(ai, /return lang\.dictionary \? \(lang\.dictionaryCode \|\| lang\.code\) : null;/);
  assert.match(ai, /const dictCode = dictionaryCodeFor\(options\.learningLanguage\);/);
  assert.match(ai, /if \(!dictCode\) return null;/);
  // Эндпоинт строится по коду языка, а не жёстко по /entries/en.
  assert.match(ai, /entries\/\$\{encodeURIComponent\(code\)\}/);
  assert.doesNotMatch(ai, /api\/v2\/entries\/en\//);
});

test("переводчик использует код языка обучения как исходный", () => {
  const ai = read("ai.js");
  assert.match(ai, /function translatorCodeFor\(code, fallback = "en"\)/);
  assert.match(ai, /options\.sourceLangCode \|\| options\.learningLanguage \|\| "en"/);
  assert.match(ai, /if \(sourceLang === target\) return source;/);
});

test("промпты генерации карточки строятся на языке обучения", () => {
  const ai = read("ai.js");
  assert.match(ai, /const learnedName = sourceLang \|\| learningAiName\(learnCode\);/);
  assert.match(ai, /key, word, targetLang, learnedName, requestOptions\)/);
  assert.match(ai, /learningLanguage: learnCode,/);
  assert.match(ai, /sourceLangCode: opts\.sourceLangCode \|\| learnCode \|\| "en",/);
});

test("пакетные примеры и Word Info получают название языка обучения", () => {
  const ai = read("ai.js");
  assert.match(ai, /learningLangName: opts\.learningLangName \|\| learningAiName\(opts\.learningLanguage\)/);
  assert.match(ai, /function wordInfoSystemPrompt\(learnedName\)/);
  assert.match(ai, /function wordInfoPrompt\(word, learnedName\)/);
  assert.match(ai, /const learned = promptOptions\?\.learningLangName \|\| "English";/);
  assert.match(ai, /Learning language of the cards: \$\{learned\}/);
});

test("вызывающие модули передают активный язык обучения", () => {
  const practice = read("js/ai-practice.js");
  assert.match(practice, /function activeLearningLanguageCode\(\)/);
  assert.match(practice, /function learningLangName\(\)/);
  assert.match(practice, /sourceLang: learningLangName\(\),/);
  assert.doesNotMatch(practice, /sourceLang: "English",/);

  const study = read("js/study.js");
  assert.match(study, /learningLanguage: activeLearningLanguageCode\(\),[\s\S]*?learningLangName: learningLangName\(\),/);
  const wordInfoCall = study.slice(study.indexOf("generateWordInfo(card"));
  assert.match(wordInfoCall, /learningLangName: learningLangName\(\),/);

  const decks = read("js/decks.js");
  assert.match(decks, /const learnCode = activeLearningLanguageCode\(\);/);
  assert.match(decks, /sourceLang: learningLangName\(\),/);
  assert.doesNotMatch(decks, /sourceLang: "auto",/);

  const selection = read("js/selection.js");
  assert.match(selection, /sourceLangCode: activeLearningLanguageCode\(\),/);
});

test("устаревшие async-ответы AI отбрасываются по generation token", () => {
  const study = read("js/study.js");
  assert.match(study, /if \(!isCurrentAiJob\(job\)\) return;/);
  const practice = read("js/ai-practice.js");
  assert.match(practice, /if \(!isCurrentAiJob\(job\)/);
});
