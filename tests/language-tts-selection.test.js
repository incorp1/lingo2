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

test("озвучивание всегда идёт на языке обучения, а не на языке интерфейса", () => {
  const shell = read("js/app-shell.js");
  const study = read("js/study.js");
  const settings = read("js/settings.js");
  // Таблица локалей интерфейса для TTS удалена: ru/uk больше не озвучиваются.
  assert.doesNotMatch(shell, /TTS_UI_LOCALES/);
  assert.match(shell, /function translationSpeechLocale\(\) \{\s*return learningSpeechLocale\(\);/);
  // Обе стороны карточки читаются голосом изучаемого языка.
  assert.doesNotMatch(study, /speaksTranslation/);
  assert.match(study, /speak\(toSpeak, \{ lang: learningSpeechLocale\(\) \}\)/);
  assert.match(study, /speak\(textToSpeak, \{ lang: learningSpeechLocale\(\) \}\)/);
  // Превью скорости в настройках тоже использует язык обучения.
  assert.match(settings, /speak\(t\("settings\.ttsRate\.sample"\), \{ rate, lang: learningSpeechLocale\(\) \}\)/);
});

test("ни один вызов speak не использует локаль интерфейса", () => {
  for (const file of ["js/study.js", "js/selection.js", "js/settings.js", "js/ai-practice.js"]) {
    const source = read(file);
    const calls = source.match(/\bspeak\((?:[^;]*?)\)\s*;/gs) || [];
    for (const call of calls) {
      assert.match(call, /lang:\s*learningSpeechLocale\(\)/, `${file}: вызов без языка обучения: ${call.trim()}`);
    }
  }
});

test("скорость сохраняется, голос ищется по локали и не подменяется английским", () => {
  const shell = read("js/app-shell.js");
  assert.match(shell, /u\.rate\s*=\s*Math\.min\(1\.5,\s*Math\.max\(0\.3/);
  assert.match(shell, /function pickSpeechVoice/);
  // Отсутствие голоса не заменяется принудительно английским.
  assert.doesNotMatch(shell, /voices\.find\(v => [^\n]*en-US/);
  assert.match(shell, /addEventListener\("voiceschanged"[\s\S]*?\{ once: true \}\)/);
});

test("норвежский голос находится по алиасам nb/no/nn, а не читается английским", () => {
  const shell = read("js/app-shell.js");
  assert.match(shell, /SPEECH_LOCALE_ALIASES/);
  assert.match(shell, /nb: \["nb", "no", "nn"\]/);

  // Воспроизводим логику подбора голоса для набора системных голосов.
  const baseLocaleCode = l => String(l || "").toLowerCase().split(/[-_]/)[0];
  const normalizeVoiceLang = l => String(l || "").toLowerCase().replace(/_/g, "-");
  const ALIASES = { nb: ["nb", "no", "nn"], no: ["nb", "no", "nn"], nn: ["nb", "no", "nn"] };
  const pick = (locale, voices) => {
    const aliases = ALIASES[baseLocaleCode(locale)] || [baseLocaleCode(locale)];
    const matches = voices.filter(v => aliases.includes(baseLocaleCode(v.lang)));
    if (!matches.length) return null;
    return matches.find(v => normalizeVoiceLang(v.lang) === normalizeVoiceLang(locale))
      || matches.find(v => baseLocaleCode(v.lang) === baseLocaleCode(locale))
      || matches.find(v => v.localService)
      || matches[0];
  };

  const windowsVoices = [{ lang: "en-US" }, { lang: "no-NO", localService: true }];
  assert.equal(pick("nb-NO", windowsVoices).lang, "no-NO");

  const androidVoices = [{ lang: "en-US" }, { lang: "nn-NO" }, { lang: "nb-NO" }];
  assert.equal(pick("nb-NO", androidVoices).lang, "nb-NO");

  // Без норвежских голосов английский не навязывается.
  assert.equal(pick("nb-NO", [{ lang: "en-US" }, { lang: "ru-RU" }]), null);
  // Английская локаль не захватывает норвежские голоса.
  assert.equal(pick("en-US", androidVoices).lang, "en-US");
});

test("норвежская транскрипция не отбраковывается валидатором IPA", () => {
  const ai = read("ai.js");
  assert.match(ai, /ʉ/);
  assert.match(ai, /NEVER give an English reading of a non-English word/);

  const looksLikeIPA = v => {
    v = String(v || "").trim();
    if (!v || v.length > 60) return false;
    if (!/[ˈˌəɪʊɛɔæʌθðʃʒŋɑɒːiuʉɖɭɳʈɕʂɾʁø̜yœɡ˧˨˩]/i.test(v) && !/^\/.*\/$/.test(v)) return false;
    if (/[\u0400-\u04FF]/.test(v)) return false;
    if (/[.,;!?]/.test(v)) return false;
    return true;
  };
  for (const ipa of ["/ˈhʉːs/", "/ˈbloːbær/", "/ˈɕœːrə/", "/ˈɡɑː/", "/ˈwɜːrd/"]) {
    assert.ok(looksLikeIPA(ipa), ipa);
  }
  assert.equal(looksLikeIPA("дом"), false);
  assert.equal(looksLikeIPA("это существительное, означающее дом."), false);
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
