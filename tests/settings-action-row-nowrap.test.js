"use strict";

/* ==========================================================================
 * Регрессия: строки-кнопки списков действий в настройках («Восстановить
 * полную копию», «Сбросить прогресс», «Удалить всё») должны показывать
 * заголовок и подсказку строго в одну строку, а круглая иконка подсказки
 * обязана оставаться на строке заголовка, а не уезжать под него.
 * ========================================================================== */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("подписи строк действий не переносятся на несколько строк", () => {
  const css = read("css/settings-polish.css");

  // Правила заданы на классах, а не на id панелей, поэтому работают и в
  // legacy-разметке, и после переноса блоков в маршруты настроек.
  assert.match(css, /\.settings-action-list \.settings-action-row > span:first-child > b,/);
  assert.match(
    css,
    /\.settings-action-list \.settings-action-row > span:first-child > small \{[\s\S]*?white-space: nowrap !important;[\s\S]*?overflow-wrap: normal !important;[\s\S]*?word-break: normal !important;[\s\S]*?text-overflow: ellipsis;/
  );

  // Колонка текста ограничена по ширине, иначе grid-элемент растягивается и текст переносится.
  assert.match(
    css,
    /\.settings-action-list \.settings-action-row > span:first-child \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/
  );
});

test("иконка подсказки остаётся на строке заголовка", () => {
  const css = read("css/settings-polish.css");
  const tooltips = read("tooltips.js");

  // tooltips.js дописывает .info-tip-wrap внутрь текстового якоря строки.
  assert.match(tooltips, /wrap\.className = "info-tip-wrap"/);

  // Заголовок с иконкой становится flex-строкой, иконка не сжимается.
  assert.match(
    css,
    /\.settings-action-list \.settings-action-row > span:first-child > b:has\(> \.info-tip-wrap\) \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/
  );
  assert.match(
    css,
    /\.settings-action-list \.settings-action-row \.info-tip-wrap \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/
  );

  // Если иконка оказалась прямым потомком колонки, она не занимает отдельную строку грида.
  assert.match(
    css,
    /\.settings-action-list \.settings-action-row > span:first-child > \.info-tip-wrap \{[\s\S]*?grid-row: 1;/
  );
});

test("шеврон строки действий не влияет на высоту и не сжимается", () => {
  const css = read("css/settings-polish.css");

  assert.match(
    css,
    /\.settings-action-list \.settings-action-row > span:last-child \{[\s\S]*?flex: 0 0 auto;[\s\S]*?justify-self: end;[\s\S]*?line-height: 1;/
  );
});
