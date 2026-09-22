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

  // КРИТИЧНО: правила строк действий не должны зависеть от `:has()`.
  // Safari на iOS 15 (максимум для iPhone 7) не поддерживает `:has()` и
  // отбрасывает весь селекторный список с ним, из-за чего правило переставало
  // применяться и заголовки снова переносились.
  const actionRowRules = css.slice(css.indexOf(".settings-action-row .info-tip-wrap"));
  assert.ok(
    !/\.settings-action-row[^{]*:has\(/.test(css),
    "правила строк действий не должны использовать :has() — он недоступен в Safari iOS 15"
  );

  // Иконка — инлайновый элемент на строке заголовка и не сжимается.
  assert.match(
    actionRowRules,
    /\.settings-action-list \.settings-action-row \.info-tip-wrap \{[\s\S]*?display: inline-flex;[\s\S]*?vertical-align: middle;[\s\S]*?white-space: nowrap;/
  );
  assert.match(
    actionRowRules,
    /\.settings-action-list \.settings-action-row \.info-tip-icon \{[\s\S]*?flex: 0 0 auto;/
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
