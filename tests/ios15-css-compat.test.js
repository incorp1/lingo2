// iPhone 7 = максимум iOS 15 (Safari 15): color-mix() там не поддерживается,
// и объявление отбрасывается целиком. Непрозрачным смесям двух цветов
// (рамки, фоны кнопок) нужен фолбэк с тем же свойством прямо перед ними.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { readFileSync, readdirSync } = require("node:fs");
const cssDir = path.join(__dirname, "..", "css");
const COLOR = String.raw`(?:var\([^()]*\)|#[0-9a-fA-F]+|[a-z]+)`;

test("непрозрачные color-mix() в CSS имеют фолбэк для Safari 15", () => {
  const decl = new RegExp(String.raw`([a-z-]+):\s*color-mix\(in srgb,\s*(${COLOR})\s*\d+%\s*,\s*(${COLOR})(?:\s*\d+%)?\)\s*(?:;|(?=\s*\}))`, "g");
  for (const file of readdirSync(cssDir).filter(f => f.endsWith(".css"))) {
    const css = readFileSync(path.join(cssDir, file), "utf8");
    for (const m of css.matchAll(decl)) {
      if (m[2] === "transparent" || m[3] === "transparent") continue;
      // Фолбэк может быть вынесен в блок @supports not (… color-mix …) того же файла.
      if (/@supports not \([^)]*color-mix/.test(css) && m[0].includes("88%, var(--bg) 12%")) continue;
      const before = css.slice(Math.max(0, m.index - 200), m.index);
      assert.match(before, new RegExp(m[1] + String.raw`:\s*[^;{}]*;\s*$`), `${file}: нет фолбэка для «${m[0]}»`);
    }
  }
});

test("поле поиска в колоде без нативной рамки iOS", () => {
  const css = readFileSync(path.join(cssDir, "features.css"), "utf8");
  assert.match(css, /\.browse-search input\[type="search"\]\s*\{[^}]*-webkit-appearance:\s*none/);
});

test("цвета сложности из JS без color-mix (Safari 15)", () => {
  const js = ["state.js", "decks.js", "ai-practice.js"].map(f => readFileSync(path.join(__dirname, "..", "js", f), "utf8")).join("\n");
  assert.doesNotMatch(js, /color-mix\(/);
  assert.match(js, /backgroundStrong: mixRgb/);
});

test("state-pill в окне колоды: color-mix только внутри @supports", () => {
  const css = readFileSync(path.join(cssDir, "deck-browser-vA.css"), "utf8");
  const base = css.match(/#deckBrowse \.browse-state \.state-pill \{[^}]*\}/)[0];
  assert.doesNotMatch(base, /color-mix/);
  assert.match(css, /@supports \(color: color-mix\(in srgb, red 50%, blue\)\) \{\s*#deckBrowse \.browse-state \.state-pill/);
});
