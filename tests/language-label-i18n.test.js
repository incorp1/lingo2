const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadLanguages() {
  const context = { window: {}, globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("languages.js"), context);
  return context.window.LCLanguages;
}

function loadDictionary(file) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read(file), context);
  const registry = context.window.LCI18N || context.window.I18N || context.window;
  const found = JSON.stringify(registry);
  assert.ok(found.includes("language.name.en"), `${file}: словарь не загрузился`);
  return found;
}

test("i18nKey языков ссылается на существующие ключи словарей", () => {
  const languages = loadLanguages();
  const dictionaries = ["i18n/ru.js", "i18n/uk.js", "i18n/en.js"].map(file => ({
    file,
    json: loadDictionary(file),
  }));

  for (const code of languages.CODES) {
    const key = languages.getLanguage(code).i18nKey;
    for (const { file, json } of dictionaries) {
      assert.ok(json.includes(`"${key}"`), `${file}: отсутствует ключ ${key}`);
    }
  }
});

test("устаревшие ключи language.learning.<code> больше не используются", () => {
  const source = read("languages.js");
  assert.doesNotMatch(source, /language\.learning\.(en|nb)/);
});

test("метки языков переведены в ru и uk, а не остаются aiName", () => {
  const ru = loadDictionary("i18n/ru.js");
  const uk = loadDictionary("i18n/uk.js");
  assert.ok(ru.includes('"language.name.nb":"Норвежский"') || ru.includes("Норвежский"));
  assert.ok(uk.includes("Норвезька"));
});
