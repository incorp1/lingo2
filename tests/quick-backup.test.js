const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("быстрое резервное копирование — последний пункт группы «Данные»", () => {
  const html = read("index.html");
  const dataGroupStart = html.indexOf('data-i18n="settings.group.data"');
  const dataGroupEnd = html.indexOf("</div>", html.indexOf("</button>", html.indexOf('id="quickBackupBtn"')));
  const dataGroup = html.slice(dataGroupStart, dataGroupEnd);

  assert.ok(dataGroupStart >= 0);
  assert.match(dataGroup, /data-settings-route-open="data"[\s\S]*id="quickBackupBtn"/);
  assert.match(dataGroup, /id="quickBackupBtn"[\s\S]*data-i18n="settings\.backup\.create"/);
  assert.doesNotMatch(dataGroup, /id="quickBackupBtn"[^>]+data-settings-route-open/);
  assert.equal(dataGroup.lastIndexOf("<button"), dataGroup.indexOf('id="quickBackupBtn"') - '<button type="button" class="settings-route-btn" '.length);
});

test("быстрая кнопка вызывает тот же Share Sheet, что и исходная", () => {
  const shell = read("js/app-shell.js");

  assert.match(shell, /\$\("#shareExportBtn"\)\.onclick = shareExportData;/);
  assert.match(shell, /\$\("#quickBackupBtn"\)\.onclick = shareExportData;/);
});

test("название быстрой резервной копии локализовано", () => {
  const expected = {
    "i18n/ru.js": "Создать резервную копию",
    "i18n/uk.js": "Створити резервну копію",
    "i18n/en.js": "Create backup",
  };

  for (const [file, label] of Object.entries(expected)) {
    assert.ok(read(file).includes(`"settings.backup.create": "${label}"`), file);
  }
});