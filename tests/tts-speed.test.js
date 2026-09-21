const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("скорость TTS хранится в схеме и ограничена диапазоном 0.3–1.5 с шагом 0.05", () => {
  const state = read("js/state.js");

  assert.match(state, /ttsRate:\s*0\.95/);
  assert.match(state, /ttsRate:\s*\{\s*ui:\s*\[0\.3,\s*1\.5\],\s*import:\s*\[0\.3,\s*1\.5\]\s*\}/);
  assert.match(state, /ttsRate:\s*\{\s*type:\s*"number"[\s\S]*?step:\s*0\.05\s*\}/);
  assert.match(state, /rule\.type === "number"/);
});

test("раздел Звук содержит доступный ползунок и реальный предпросмотр", () => {
  const html = read("index.html");
  const settings = read("js/settings.js");

  assert.match(html, /id="setTtsRate" type="range" min="0\.3" max="1\.5" step="0\.05"/);
  assert.match(html, /id="ttsRateDisplay"[\s\S]*?aria-live="polite"/);
  assert.match(html, /id="ttsPreviewBtn"/);
  assert.match(settings, /setTtsRate/);
  assert.match(settings, /commitTtsRate/);
  assert.match(settings, /speak\(t\("settings\.ttsRate\.sample"\), \{ rate, lang: learningSpeechLocale\(\) \}\)/);
});

test("общая функция озвучивания применяет сохранённую скорость", () => {
  const shell = read("js/app-shell.js");

  assert.match(shell, /state\?\.settings\?\.ttsRate/);
  assert.match(shell, /u\.rate\s*=\s*Math\.min\(1\.5,\s*Math\.max\(0\.3/);
});

test("настройка скорости локализована на русский, украинский и английский", () => {
  for (const locale of ["ru", "uk", "en"]) {
    const dictionary = read(`i18n/${locale}.js`);
    assert.match(dictionary, /"settings\.ttsRate"/);
    assert.match(dictionary, /"settings\.ttsRate\.hint"/);
    assert.match(dictionary, /"settings\.ttsRate\.preview"/);
    assert.match(dictionary, /"settings\.ttsRate\.sample"/);
  }
});