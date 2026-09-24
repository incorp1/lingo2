const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stateSrc = fs.readFileSync(path.join(root, "js/state.js"), "utf8");

for (const id of ["aiExamplesDisclosure", "aiPracticeDisclosure"]) {
  test(`${id}: единая разметка раскрывающегося блока`, () => {
    assert.match(html, new RegExp(`data-disclosure-id="${id}"`));
    assert.match(html, new RegExp(`id="${id}Toggle"[^>]*aria-expanded="false"[^>]*aria-controls="${id}Panel"`));
    assert.match(html, new RegExp(`id="${id}Panel"[^>]*hidden`));
    assert.ok(stateSrc.includes(`"disclosure:${id}"`), "ключ сохраняется схемой настроек");
  });
}

test("поля примеров и практики находятся внутри своих панелей", () => {
  const panel = id => html.split(`id="${id}Panel"`)[1].split("settings-disclosure-trigger")[0];
  for (const f of ["setExampleTopics", "setExampleSituations", "setExampleStyles", "setExampleTemperature"])
    assert.ok(panel("aiExamplesDisclosure").includes(`id="${f}"`), f);
  for (const f of ["setPracticeTopics", "setPracticeSituations", "setPracticeStyles", "setPracticeTemperature"])
    assert.ok(panel("aiPracticeDisclosure").includes(`id="${f}"`), f);
});

test("переводы заголовков есть во всех языках", () => {
  for (const l of ["en", "ru", "uk"]) {
    const s = fs.readFileSync(path.join(root, `i18n/${l}.js`), "utf8");
    assert.ok(s.includes('"settings.ai.examplesGroup"') && s.includes('"settings.ai.practiceGroup"'), l);
  }
});
