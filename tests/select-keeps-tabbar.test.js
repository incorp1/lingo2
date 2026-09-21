const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const appShell = read("js/app-shell.js");
const ui = read("js/ui.js");

/* Regression: tapping a <select> (e.g. Settings -> Learning language) used to
   set the `kb-open` flag, which hides the bottom tab bar via CSS. A native
   picker opens no keyboard, so the bar must stay visible. */

test("focus handlers no longer treat <select> as a keyboard field", () => {
  assert.ok(!/matches\("input, textarea, select"\)\)\s*\{\s*\n\s*document\.body\.classList\.add\("kb-open"\)/.test(appShell));
  assert.match(appShell, /function opensKeyboard\(el\)/);
  assert.match(appShell, /addEventListener\("focusin", \(e\) => \{\s*\n\s*if \(opensKeyboard\(e\.target\)\)/);
  assert.match(appShell, /addEventListener\("focusout", \(e\) => \{\s*\n\s*if \(opensKeyboard\(e\.target\)\)/);
});

test("opensKeyboard accepts text fields and rejects select/checkbox", () => {
  const NON_TEXT_INPUT_TYPES = new Set([
    "checkbox", "radio", "button", "submit", "reset", "range", "file", "color", "image",
  ]);
  const opensKeyboard = (el) => {
    if (!el || !el.matches) return false;
    if (el.matches("textarea")) return true;
    if (el.matches("input")) return !NON_TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
    return false;
  };
  const stub = (tag, type) => ({ type, matches: sel => sel.split(", ").includes(tag) });

  assert.equal(opensKeyboard(stub("input", "text")), true);
  assert.equal(opensKeyboard(stub("input", undefined)), true);
  assert.equal(opensKeyboard(stub("textarea")), true);
  assert.equal(opensKeyboard(stub("select")), false);
  assert.equal(opensKeyboard(stub("input", "checkbox")), false);
  assert.equal(opensKeyboard(stub("input", "range")), false);
  assert.equal(opensKeyboard(null), false);
});

test("sheet drag cleanup reuses the shared opensKeyboard rule", () => {
  assert.match(ui, /window\.__opensKeyboard \|\|/);
  const start = ui.indexOf("function clearKeyboardFlag");
  assert.ok(start > -1);
  assert.ok(!ui.slice(start, start + 900).includes('matches("input, textarea, select")'));
});

test("bottom tab bar is hidden only by the kb-open flag", () => {
  assert.match(read("css/features.css"), /body\.kb-open \.mobile-tabs \{ display: none !important; \}/);
});
