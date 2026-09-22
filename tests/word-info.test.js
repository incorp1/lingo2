const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("кнопка «i» на карточке активна только после показа ответа", () => {
  const study = read("js/study.js");
  assert.match(study, /id="wordInfoBtn"\$\{session\.revealed \? "" : " disabled"\}/);
  assert.match(study, /class="edit-link info-link" id="wordInfoBtn"/);
  assert.match(study, /#wordInfoBtn"\)\.onclick = \(\) => openWordInfo\(card\)/);

  const css = read("css/study.css");
  assert.match(css, /\.card-stage \.info-link:disabled/);
  assert.match(css, /\.sheet-grabber/);
  assert.match(css, /\.modal-panel \.modal-head \{ touch-action: none/);

  /* Раньше глифы правых кнопок «покачивались» (card-tool-float). В коммите
     a3b362a анимацию осознанно отключили: вертикальный сдвиг ломал
     выравнивание правого ряда с кнопками «назад»/«редактирование».
     Контракт теперь обратный — иконки в правом ряду стоят неподвижно. */
  assert.match(css, /\.card-stage \.card-stage-side-tools \.speaker-btn svg,[\s\S]{0,80}?animation: none/);
  assert.match(css, /\.card-stage \.card-stage-side-tools \.info-link svg/);
  assert.match(css, /\.card-stage \.info-link:not\(:disabled\)/);
  assert.doesNotMatch(css, /animation: card-tool-float/);
});

test("модалка информации о слове подключена к разметке и i18n", () => {
  const html = read("index.html");
  assert.match(html, /id="wordInfoModal"/);
  assert.match(html, /class="sheet-grabber"/);
  assert.match(html, /id="wordInfoContent"/);
  assert.match(html, /id="wordInfoGenerateBtn"/);
  assert.match(html, /id="wordInfoRefreshBtn"/);
  assert.match(html, /data-i18n="study\.info\.title"/);

  const ru = read("i18n/ru.js");
  const en = read("i18n/en.js");
  const uk = read("i18n/uk.js");
  for (const key of [
    "study.info.title",
    "study.info.generate",
    "study.info.regenerate",
    "study.info.empty",
    "study.info.generating",
    "study.info.failed",
  ]) {
    assert.match(ru, new RegExp(`"${key.replace(/\./g, "\\.")}"`));
    assert.match(en, new RegExp(`"${key.replace(/\./g, "\\.")}"`));
    assert.match(uk, new RegExp(`"${key.replace(/\./g, "\\.")}"`));
  }
});

test("генерация информации идёт через AI-провайдера по промпту пользователя", () => {
  const ai = read("ai.js");
  assert.match(ai, /async function generateWordInfo\(card, opts = \{\}\)/);
  assert.match(ai, /generateWordInfo,/);
  assert.match(ai, /ОБЪЯСНИ СЛОВО `;/);
  assert.match(ai, /Правила ответа:/);
  assert.match(ai, /Похожие слова/);
  assert.match(ai, /wordInfoSystemPrompt\(learnedName\),/);
  assert.match(ai, /wordInfoPrompt\(word, learnedName\),/);

  const study = read("js/study.js");
  assert.match(study, /window\.LCAi\.generateWordInfo\(card/);
});

test("информация о слове сохраняется в карточке и попадает в экспорт/бэкап", () => {
  const state = read("js/state.js");
  assert.match(state, /front, back, example, exampleSentence, exampleTranslation, exampleTargetTerm, hint, cloze, info,/);
  assert.match(state, /card\.info = String\(card\.info \|\| ""\)\.trim\(\);/);
  assert.match(state, /info: c\.info \|\| "",/);

  const backup = read("backup.js");
  assert.match(backup, /info: cleanString\(raw\.info\),/);
  assert.match(backup, /info: cleanString\(card\.info\),/);

  const study = read("js/study.js");
  assert.match(study, /stored\.info = info;/);
  assert.match(study, /markCardDirty\(stored\);/);
});

test("шторки тянутся жестом: порог закрытия 20% экрана, отклик кнопке отмены", () => {
  const ui = read("js/ui.js");
  assert.match(ui, /bindSheetDrag/);
  assert.match(ui, /touchmove/);
  assert.match(ui, /window\.innerHeight \* 0\.2/);
  assert.match(ui, /"#editorModal", "#deckModal", "#bulkModal", "#wordInfoModal", "#practiceModal"/);

  const html = read("index.html");
  assert.equal((html.match(/class="sheet-grabber"/g) || []).length, 5);

  const scheduler = read("js/scheduler.js");
  assert.doesNotMatch(scheduler, /updateUndoBtn[\s\S]*?b\.disabled = disabled;/);
  assert.match(scheduler, /aria-disabled/);
});

test("стили модалки информации входят в PWA app shell", () => {
  const css = read("css/study.css");
  assert.match(css, /\.word-info-panel/);
  assert.match(css, /\.word-info-content/);

  const sw = read("sw.js");
  assert.match(sw, /"\.\/css\/study\.css\?v=/);
});
