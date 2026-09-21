const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("viewport полностью запрещает масштабирование страницы", () => {
  const html = read("index.html");
  assert.match(
    html,
    /name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/
  );
});

test("поля практики чтения и массового добавления сохраняют 16px на iPhone", () => {
  const css = read("css/features.css");
  assert.match(css, /@media \(max-width: 860px\), \(pointer: coarse\)/);
  assert.match(css, /html,\s*body\s*\{\s*touch-action: manipulation;/);
  assert.match(css, /#bulkText,\s*\.practice-answer\s*\{\s*font-size: 16px;/);
});
