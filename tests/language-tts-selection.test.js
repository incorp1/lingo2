const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("speak принимает явную локаль, а detectLang использует язык обучения", () => {
  const shell = read("js/app-shell.js");
  assert.match(shell, /function speak\(text, \{ rate, lang \} = \{\}\)/);
  assert.match(shell, /u\.lang = lang \|\| detectLang\(text\)/);
  assert.match(shell, /function learningSpeechLocale/);
  assert.match(shell, /return learningSpeechLocale\(\);/);
});

test("hus озвучивается как nb-NO, когда активен норвежский", () => {
  const languages = read("languages.js");
  assert.match(languages, /code: "nb"[\s\S]*?locale: "nb-NO"/);

  const registry = {};
  new Function("window", languages)(registry);
  const locale = registry.LCLanguages.getLanguage("nb").locale;
  assert.equal(locale, "nb-NO");
  assert.equal(registry.LCLanguages.getLanguage("en").locale, "en-US");
});

test("перевод озвучивается по языку интерфейса, а термин — по языку обучения", () => {
  const shell = read("js/app-shell.js");
  const study = read("js/study.js");
  assert.match(shell, /function translationSpeechLocale/);
  assert.match(shell, /ru: "ru-RU", uk: "uk-UA", en: "en-US"/);
  assert.match(study, /speaksTranslation \? translationSpeechLocale\(\) : learningSpeechLocale\(\)/);
  assert.match(study, /speak\(textToSpeak, \{ lang: learningSpeechLocale\(\) \}\)/);
});

test("скорость сохраняется, голос ищется по локали и не подменяется английским", () => {
  const shell = read("js/app-shell.js");
  assert.match(shell, /u\.rate\s*=\s*Math\.min\(1\.5,\s*Math\.max\(0\.3/);
  assert.match(shell, /function pickSpeechVoice/);
  assert.match(shell, /baseLocaleCode\(v\.lang\) === base/);
  // Отсутствие голоса не заменяется принудительно английским.
  assert.doesNotMatch(shell, /voices\.find\(v => [^\n]*en-US/);
  assert.match(shell, /addEventListener\("voiceschanged"[\s\S]*?\{ once: true \}\)/);
});

test("выделение распознаёт норвежские буквы без потери touch-fallback и экранирования", () => {
  const selection = read("js/selection.js");
  assert.match(selection, /const SELECTION_HAS_LETTER = \/\\p\{L\}\/u/);
  // Все три прежние ASCII-проверки заменены.
  assert.doesNotMatch(selection, /\/\[A-Za-z\]\/\.test/);
  assert.equal((selection.match(/SELECTION_HAS_LETTER\.test/g) || []).length, 3);
  assert.match(selection, /speak\(word, \{ lang: learningSpeechLocale\(\) \}\)/);
  // touch-fallback сохранён.
  assert.match(selection, /SELECTION_TOUCH_ID/);

  const hasLetter = /\p{L}/u;
  for (const word of ["å", "ø", "øy", "gå", "blåbær", "lærer", "hus", "gift"]) {
    assert.ok(hasLetter.test(word), word);
  }
  const wordScan = /[\p{L}\p{M}'’\-]+/gu;
  assert.deepEqual("å gå blåbær".match(wordScan), ["å", "gå", "blåbær"]);
});

test("доминирующий алфавит считает норвежскую диакритику латиницей", () => {
  const study = read("js/study.js");
  assert.match(study, /const latin = \(value\.match\(\/\[A-Za-zÀ-ÖØ-öø-ÿ\]\/g\)/);
  const latin = "blåbær".match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || [];
  assert.equal(latin.length, 6);
});

test("подпись стороны карточки следует языку обучения во всех локалях", () => {
  const settings = read("js/settings.js");
  assert.match(settings, /learningLanguageLabel\(state\?\.activeLearningLanguage\)/);
  for (const locale of ["ru", "uk", "en"]) {
    const dictionary = read(`i18n/${locale}.js`);
    assert.match(dictionary, /"language\.learning\.en"|"language\.name\.en"/);
    assert.match(dictionary, /"language\.name\.nb"/);
    assert.match(dictionary, /"settings\.cardFrontLanguage\.local"/);
  }
  // DOM-id не менялись.
  const html = read("index.html");
  assert.match(html, /id="studyFrontMenu"/);
  assert.match(html, /id="studyFrontSummary"/);
});
