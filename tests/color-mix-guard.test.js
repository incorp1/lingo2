// Safari 15 (iPhone 7) не поддерживает color-mix(). Каскадный фолбэк с var() там не работает,
// поэтому любой color-mix в CSS обязан быть внутри @supports (color: color-mix(...)) или @supports not.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const fixCssP = import("../tools/fix-color-mix.mjs").then((m) => m.fixCss);

const root = path.join(__dirname, "..");
const dir = path.join(root, "css");
const files = readdirSync(dir).filter((f) => f.endsWith(".css"));

function outsideSupports(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [], bad = [];
  let head = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { stack.push(/@supports[^{]*color-mix/.test(head)); head = ""; }
    else if (ch === "}") { stack.pop(); head = ""; }
    else if (ch === ";") head = "";
    else head += ch;
    if (src.startsWith("color-mix(", i) && !/@supports/.test(head) && !stack.includes(true)) bad.push(src.slice(Math.max(0, i - 60), i + 40).replace(/\s+/g, " "));
  }
  return bad;
}

for (const f of files) {
  test(`${f}: color-mix только внутри @supports`, async () => {
    const fixCss = await fixCssP;
    const css = readFileSync(path.join(dir, f), "utf8");
    assert.deepEqual(outsideSupports(css), [], "запустите: node tools/fix-color-mix.mjs");
    assert.equal(fixCss(css), css, "fix-color-mix.mjs должен быть идемпотентным");
  });
}

test("JS не записывает color-mix в стили", () => {
  for (const f of readdirSync(path.join(root, "js")).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(path.join(root, "js", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /color-mix\(/, f);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "index.html"), "utf8"), /color-mix\(/);
});
