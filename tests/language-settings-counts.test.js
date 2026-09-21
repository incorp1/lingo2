const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function sliceFunction(source, header) {
  const start = source.indexOf(header);
  assert.notStrictEqual(start, -1, `не найдена функция ${header}`);
  const next = source.indexOf("\n}", start);
  assert.notStrictEqual(next, -1, `не найден конец функции ${header}`);
  return source.slice(start, next);
}

test("AUD-009: сводка настроек считает только колоды и карточки активного языка", () => {
  const source = read("js/settings.js");
  const summaryBlock = source.slice(
    source.indexOf('const summaryData = $("#summaryData")'),
    source.indexOf("// Footer version/storage")
  );
  assert.ok(summaryBlock.includes("activeDecks()"), "сводка должна использовать activeDecks()");
  assert.ok(summaryBlock.includes("activeCards()"), "сводка должна использовать activeCards()");
  assert.doesNotMatch(summaryBlock, /state\.decks/, "сводка не должна читать глобальные колоды");
  assert.doesNotMatch(summaryBlock, /state\.cards/, "сводка не должна читать глобальные карточки");
});

test("AUD-009: счётчик резервной копии явно помечен как охватывающий все языки", () => {
  const backupBlock = sliceFunction(read("js/settings.js"), "async function renderBackupMetadata()");
  assert.ok(
    backupBlock.includes("settings.backup.countsAllLanguages"),
    "блок резервной копии должен использовать явно помеченный ключ"
  );
});

test("AUD-009: ключ settings.backup.countsAllLanguages есть во всех словарях", () => {
  for (const file of ["i18n/ru.js", "i18n/uk.js", "i18n/en.js"]) {
    const dictionary = read(file);
    assert.ok(
      dictionary.includes('"settings.backup.countsAllLanguages"'),
      `${file}: отсутствует ключ settings.backup.countsAllLanguages`
    );
    assert.ok(
      /countsAllLanguages":\s*"[^"]*\{decks\}[^"]*\{cards\}[^"]*"/.test(dictionary),
      `${file}: строка должна содержать плейсхолдеры {decks} и {cards}`
    );
  }
});
