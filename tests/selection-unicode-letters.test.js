const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SELECTION_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "selection.js"), "utf8");

// Те же выражения, что и в js/selection.js.
const HAS_LETTER = /\p{L}/u;
const WORD_CHARS = /[\p{L}\p{M}'’\-]/u;
const WORD_SCAN = /[\p{L}\p{M}'’\-]+/gu;

test("регулярные выражения выделения используют Unicode-свойства", () => {
  assert.match(SELECTION_SRC, /const SELECTION_HAS_LETTER = \/\\p\{L\}\/u;/);
  assert.match(SELECTION_SRC, /const SELECTION_WORD_CHARS = \/\[\\p\{L\}\\p\{M\}'’\\-\]\/u;/);
  assert.match(SELECTION_SRC, /const SELECTION_WORD_SCAN = \/\[\\p\{L\}\\p\{M\}'’\\-\]\+\/gu;/);
  // Латинский диапазон Latin-1 больше не ограничивает выделение.
  assert.doesNotMatch(SELECTION_SRC, /SELECTION_(HAS_LETTER|WORD_CHARS|WORD_SCAN) = \/\[A-Za-z/);
});

test("буквоносными считаются норвежские, кириллические и другие алфавиты", () => {
  const words = [
    "å", "ø", "æ", "øy", "blåbær", "lærer",       // норвежский
    "слово", "їжа", "ёлка",                        // кириллица
    "ā", "ș", "ł", "č",                            // расширенная латиница
    "λόγος", "日本語",                              // греческий и CJK
  ];
  for (const word of words) {
    assert.ok(HAS_LETTER.test(word), `не распознано как слово: ${word}`);
    assert.ok(WORD_CHARS.test(word[0]), `первый символ не словесный: ${word}`);
  }
});

test("небуквенные строки по-прежнему отклоняются", () => {
  for (const value of ["123", "—", "!?", "  ", "…", "$%"]) {
    assert.ok(!HAS_LETTER.test(value), `ошибочно распознано как слово: ${value}`);
  }
});

test("сканер слов сохраняет дефисы и апострофы в разных алфавитах", () => {
  assert.deepEqual("å gå blåbær".match(WORD_SCAN), ["å", "gå", "blåbær"]);
  assert.deepEqual("по-русски, слово!".match(WORD_SCAN), ["по-русски", "слово"]);
  assert.deepEqual("it’s well-known".match(WORD_SCAN), ["it’s", "well-known"]);
  // Цифры не попадают в слово.
  assert.deepEqual("hus 42 gift".match(WORD_SCAN), ["hus", "gift"]);
});

test("touch-fallback и экранирование выделения не затронуты", () => {
  assert.match(SELECTION_SRC, /SELECTION_TOUCH_ID/);
  assert.match(SELECTION_SRC, /SELECTION_HOLD_MS/);
  assert.match(SELECTION_SRC, /SELECTION_MOVE_TOLERANCE/);
});
