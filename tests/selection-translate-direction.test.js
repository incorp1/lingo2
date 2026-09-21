const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("быстрый перевод не угадывает исходный язык через sl=auto", () => {
  const ai = read("ai.js");
  assert.doesNotMatch(ai, /sl=auto/);
  assert.match(ai, /sl=\$\{encodeURIComponent\(source \|\| "auto"\)\}/);
  assert.match(ai, /google: \(\{ text, source, target \}\)/);
});

test("перевод выделенного слова идёт с языка обучения на язык интерфейса", () => {
  const selection = read("js/selection.js");
  const body = selection.slice(selection.indexOf("async function translateSelection"));
  // Цель перевода — язык интерфейса.
  assert.match(body, /const lang = state\.settings\.language \|\| "uk";/);
  // Источник — активный язык обучения, а не интерфейсный и не "auto".
  assert.match(body, /const sourceCode = activeLearningLanguageCode\(\);/);
  assert.match(body, /learningLanguage: sourceCode,/);
  assert.match(body, /sourceLangCode: sourceCode,/);
  assert.doesNotMatch(body, /sourceLangCode: "auto"/);
  assert.doesNotMatch(body, /sourceLangCode: state\.settings\.language/);
});
