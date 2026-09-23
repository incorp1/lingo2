const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("settings detail navigation shares the top row with build metadata", () => {
  const html = read("index.html");
  const ui = read("js/ui.js");
  const css = read("css/settings-responsive.css");

  const rowStart = html.indexOf('class="view-title-row settings-title-row"');
  const announcement = html.indexOf('id="settingsRouteAnnouncement"');
  assert.ok(rowStart >= 0, "settings title row must exist");
  assert.ok(announcement >= rowStart, "build metadata must precede the route announcement");
  const titleArea = html.slice(rowStart, announcement);
  assert.ok(titleArea.includes('id="settingsTopBackBtn"'));
  assert.ok(titleArea.includes('id="appBuildMeta"'));
  assert.match(ui, /topBack\.hidden = desktop \|\| route === "home"/);
  assert.match(ui, /topBack\.dataset\.settingsRouteOpen = "home"/);
  assert.match(css, /\.settings-route-panel \.settings-back-row .* \.settings-back-btn/);
  assert.match(css, /\.view-settings \.settings-title-row \{[\s\S]*?flex-flow: row nowrap;/);
  assert.match(css, /\.view-settings \.app-build-meta \{[\s\S]*?margin-left: auto;/);
});

test("settings tooltips use an explicit usefulness whitelist on mobile and desktop", () => {
  const html = read("index.html");
  const tooltips = read("tooltips.js");
  const css = read("css/features.css");

  assert.match(tooltips, /querySelectorAll\("\.block-desc\.js-tooltip, #settings-learning \.block-desc"\)/);
  assert.match(tooltips, /querySelectorAll\("\.row-hint\.js-tooltip, #settings-learning \.row-hint"\)/);
  assert.ok(!html.includes('class="block-desc js-tooltip" data-i18n="settings.learning.dailyDesc"'));
  assert.ok(html.includes('data-i18n="settings.learning.algorithmHelp"'));
  assert.ok(html.includes('data-i18n="settings.learning.retentionHelp"'));
  assert.ok(html.includes('data-i18n="settings.learning.leechHelp"'));
  assert.match(tooltips, /text\.split\(\/\\n\{2,\}\/\)/);
  assert.match(tooltips, /document\.createElement\("p"\)/);
  assert.match(css, /\.info-tip-bubble p \{[\s\S]*?margin: 0;/);
  assert.match(css, /\.info-tip-bubble p \+ p \{[\s\S]*?margin-top: 0\.75em;/);
  assert.match(css, /\.info-tip-icon \{[\s\S]*?display: inline-flex;[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?min-width: 20px;[\s\S]*?min-height: 20px;/);
  assert.match(css, /\.info-tip-wrap,[\s\S]*?\.view-settings \.info-tip-wrap \{[\s\S]*?white-space: nowrap;[\s\S]*?break-inside: avoid;/);
  assert.match(tooltips, /function findTextAnchor\(sourceEl\)/);
  assert.match(tooltips, /:scope > label, :scope > \.stepper-label/);
  assert.match(tooltips, /var anchor = findTextAnchor\(hint\)/);
  assert.match(tooltips, /wrap\.appendChild\(word\);[\s\S]*?wrap\.appendChild\(icon\);/);
  assert.match(css, /\.settings-row\.with-hint > div:first-child > \.stepper-label/);
  assert.match(css, /\.view-settings \.block-desc\.js-tooltip\[data-tip-bound\]/);
  assert.match(css, /\.view-settings \.row-hint\.js-tooltip\[data-tip-bound\]/);
  assert.match(css, /#settings-learning \.block-desc\[data-tip-bound\]/);
  assert.match(css, /#settings-learning \.row-hint\[data-tip-bound\]/);
  assert.match(css, /\.view-settings \.info-tip-wrap \{[\s\S]*?white-space: nowrap;/);
  const desktopRules = css.slice(0, css.indexOf("@media (max-width: 640px)", css.indexOf("Settings info tooltips")));
  assert.match(desktopRules, /display: none !important;/);
});

test("data settings remove deck import and move descriptions into tooltips", () => {
  const html = read("index.html");

  assert.ok(!html.includes('for="deckImportFile"'));
  assert.ok(!html.includes('id="deckImportFile"'));
  assert.ok(!html.includes('data-i18n="settings.backup.addDeck"'));
  assert.match(html, /class="block-desc js-tooltip" data-i18n="settings\.backup\.desc"/);
  for (const key of [
    "settings.backup.restoreFullHint",
    "settings.resetProgressHint",
    "settings.deleteAllHint",
  ]) {
    assert.ok(
      html.includes(`class="row-hint js-tooltip" data-i18n="${key}"`),
      `${key} must be shown through a tooltip`,
    );
  }
});

test("scheduling tooltip contains both algorithm descriptions and learning removes the duplicate selector", () => {
  const html = read("index.html");
  const settings = read("js/settings.js");

  assert.equal((html.match(/data-algo-value="sm2"/g) || []).length, 1);
  assert.equal((html.match(/data-algo-value="fsrs"/g) || []).length, 1);
  assert.match(settings, /block\.classList\.contains\("algo-block"\)[\s\S]*?block\.remove\(\)/);

  const expectedDescriptions = {
    ru: ["SM-2 — простой", "FSRS — современный", "20–30% меньше повторений"],
    uk: ["SM-2 — простий", "FSRS — сучасний", "20–30% менше повторень"],
    en: ["SM-2 is the simple", "FSRS is the modern", "20–30% fewer reviews"],
  };
  for (const [locale, phrases] of Object.entries(expectedDescriptions)) {
    const source = read(`i18n/${locale}.js`);
    const tooltipLine = source
      .split("\n")
      .find(line => line.includes('"settings.learning.algorithmHelp"'));
    assert.ok(tooltipLine, `${locale} misses the scheduling tooltip`);
    for (const phrase of phrases) {
      assert.ok(tooltipLine.includes(phrase), `${locale} scheduling tooltip misses: ${phrase}`);
    }
  }
});

test("text entry controls stay compact on phone layouts", () => {
  const polish = read("css/polish.css");
  const settingsPolish = read("css/settings-polish.css");

  assert.match(polish, /\.form-row input:not\(\[type="checkbox"\]\)[\s\S]*?height: 34px;/);
  assert.match(polish, /\.form-row textarea \{[\s\S]*?min-height: 54px;[\s\S]*?max-height: 132px;/);
  assert.match(polish, /#bulkText \{[\s\S]*?min-height: 112px;[\s\S]*?max-height: 36vh;/);
  assert.match(settingsPolish, /\.view-settings \.settings-row input\[type="text"\][\s\S]*?height: 36px;[\s\S]*?min-height: 36px;/);
});

test("compact selects reserve enough room and height for their visible text", () => {
  const polish = read("css/polish.css");
  const selection = read("js/selection.js");

  assert.match(polish, /select:not\(#edType\):not\(#edDeck\) \{[\s\S]*?var\(--select-text-width, 0px\) \+ 34px[\s\S]*?min-height: 36px;[\s\S]*?line-height: 1\.35;[\s\S]*?padding-block: 5px !important;/);
  assert.match(selection, /probe\.style\.fontFamily = style\.fontFamily;/);
  assert.match(selection, /Math\.ceil\(probe\.getBoundingClientRect\(\)\.width\) \+ 2/);
});

test("ready-made settings are fully removed while legacy saved data remains harmless", () => {
  const html = read("index.html");
  const settings = read("js/settings.js");
  const state = read("js/state.js");
  const scheduler = read("js/scheduler.js");
  const backup = read("backup.js");

  for (const removed of [
    "presets-block", "presetSelect", "applyPresetBtn", "savePresetBtn",
    "deletePresetBtn", "smartDefaultsBtn",
  ]) {
    assert.ok(!html.includes(removed), `HTML still contains ${removed}`);
    assert.ok(!settings.includes(removed), `settings logic still contains ${removed}`);
  }
  assert.ok(!state.includes('"presets"'));
  assert.ok(!backup.includes("sanitizePresetConfig"));
  assert.match(scheduler, /delete s\.presets;/);
});

test("new scheduling help and generation summaries are translated in every supported locale", () => {
  for (const locale of ["ru", "uk", "en"]) {
    const source = read(`i18n/${locale}.js`);
    for (const key of [
      "settings.learning.algorithmHelp",
      "settings.learning.retentionHelp",
      "settings.learning.leechHelp",
      "settings.summary.ai",
      "settings.summary.dictionary",
      "settings.summary.off",
    ]) {
      assert.ok(source.includes(`"${key}"`), `${locale} misses ${key}`);
    }
  }
});

test("study edge menu omits direction and learning settings while desktop actions remain", () => {
  const html = read("index.html");
  const edgeMenu = read("js/edge-menu.js");

  const menuStart = html.indexOf('id="studyEdgeMenu"');
  const menuEnd = html.indexOf("</div>", menuStart);
  assert.ok(menuStart >= 0, "study edge menu must exist");
  const mobileMenu = html.slice(menuStart, menuEnd);
  assert.ok(!mobileMenu.includes('id="edgeSwapBtn"'));
  assert.ok(!mobileMenu.includes('id="edgeSettingsBtn"'));
  assert.ok(!edgeMenu.includes('$("#edgeSwapBtn")'));
  assert.ok(!edgeMenu.includes('$("#edgeSettingsBtn")'));
  assert.ok(html.includes('id="desktopSwapBtn"'));
  assert.ok(html.includes('id="desktopSettingsBtn"'));
  assert.match(edgeMenu, /desktopSwapBtn\.onclick = swapDeckDirection/);
  assert.match(edgeMenu, /desktopSettingsBtn\.onclick = openStudySettings/);
});

test("right swipe from the left edge navigates back only inside mobile settings", () => {
  const ui = read("js/ui.js");

  assert.match(ui, /const settingsView = \$\("#view-settings"\)/);
  assert.match(ui, /currentAppState\.view !== "settings"/);
  assert.match(ui, /settingsView\.classList\.contains\("active"\)/);
  assert.match(ui, /layoutMode\(\) !== "mobile"/);
  assert.match(ui, /function animateSettingsBack\(targetRoute\)/);
  assert.match(ui, /settings-back-transition/);
  assert.match(ui, /currentAppState\.settingsRoute !== "home"/);
  assert.match(ui, /initializeSettingsEdgeSwipe\(\)/);
});

test("settings back buttons and swipe share the same lightweight transition", () => {
  const settings = read("js/settings.js");
  const ui = read("js/ui.js");
  const css = read("css/settings-responsive.css");

  assert.match(settings, /button\.classList\.contains\("settings-back-btn"\)/);
  assert.match(settings, /\? animateSettingsBack\(target\)/);
  assert.match(ui, /animationend/);
  assert.match(ui, /window\.setTimeout\(clearTransition, 260\)/);
  assert.match(css, /@keyframes settings-back-enter/);
  assert.match(css, /\.settings-back-transition > \.settings-route-panel:not\(\[hidden\]\)/);
  assert.match(css, /180ms cubic-bezier/);
});

test("settings routes never remain in Safari history after switching tabs", () => {
  const ui = read("js/ui.js");
  const shell = read("js/app-shell.js");

  assert.match(
    shell,
    /\$\$\("\.nav-item"\)\.forEach\(button => \{[\s\S]*?button\.onclick = \(\) => switchView\(button\.dataset\.view\);/,
  );
  assert.match(
    ui,
    /function navigateToSettings\(settingsRoute = "home", \{ focus = null, replace = true \} = \{\}\)/,
  );
  assert.match(
    ui,
    /navigateAppState\(\{ view: "settings", overlay \}, \{ replace: true \}\)/,
  );
  assert.match(
    ui,
    /return navigateAppState\(\{ view: "settings", overlay: null \}, \{ replace: true \}\);/,
  );
  assert.doesNotMatch(ui, /function closeSettingsOverlay[\s\S]*?history\.back\(\)/);
  assert.match(
    ui,
    /function switchView[\s\S]*?\{ view, settingsRoute: "home", overlay: null \},[\s\S]*?\{ replace: true \}/,
  );
});

test("appearance groups language and theme with consistent mobile styling", () => {
  const html = read("index.html");
  const settings = read("js/settings.js");
  const baseCss = read("css/stats-settings.css");
  const mobileCss = read("css/settings-polish.css");

  assert.ok(!html.includes('id="themePreview"'));
  assert.ok(!settings.includes("syncThemePreview"));
  assert.ok(!baseCss.includes(".theme-preview"));
  assert.ok(html.includes("appearance-language-row"));
  assert.match(html, /label id="settingsLanguageTitle" for="setLang"/);
  assert.match(settings, /languageBlock\.classList\.add\("appearance-settings-block"\)/);
  assert.match(settings, /themeRow\.classList\.add\("appearance-theme-row"\)/);
  assert.match(settings, /languageBlock\.appendChild\(themeRow\)/);
  assert.match(mobileCss, /#settings-appearance \.appearance-settings-block/);
  assert.match(mobileCss, /#settings-appearance \.appearance-settings-block \.appearance-theme-row/);
  assert.match(mobileCss, /grid-template-columns: minmax\(0, 1fr\) minmax\(124px, 46%\)/);
  assert.match(mobileCss, /width: 100% !important/);
  assert.match(mobileCss, /font-family: var\(--font-sans\)/);
  assert.match(mobileCss, /\.settings-action-list > \.settings-action-row:first-of-type/);
  assert.match(mobileCss, /\.settings-action-list > \.settings-action-row:last-of-type/);
});
test("interactive swipe-back is universal and bound to settings and decks", () => {
  const ui = read("js/ui.js");
  const css = read("css/polish.css");
  assert.match(ui, /function bindSwipeBack\(/);
  assert.match(ui, /container\.addEventListener\("touchmove"[\s\S]*?event\.preventDefault\(\)[\s\S]*?\{ passive: false \}/);
  assert.match(ui, /container\.classList\.add\("swipe-back-active"\);[\s\S]*?getBoundingClientRect\(\)/, "класс позиционирования до измерения");
  assert.match(ui, /velocity > 0\.35/);
  assert.match(ui, /g\.width \* 0\.45/);
  assert.match(ui, /prefers-reduced-motion/);
  assert.match(ui, /initializeDeckBrowseSwipe\(\)/);
  assert.match(ui, /getUnder: \(\) => \$\("#decksOverview"\)/);
  assert.doesNotMatch(ui, /settingsEdgeSwipeBack/);
  assert.match(ui, /g\.under\.inert = g\.underWasInert;\n    if \(restoreUnderHidden\)/, "inert всегда снимается");
  assert.match(ui, /g\.panel\.style\.minHeight/, "панель до низа экрана");
  assert.match(css, /\[data-swipe-back-fade\]/);
  assert.match(css, /\.swipe-back-active > \.swipe-back-under::after/);
  assert.doesNotMatch(css, /swipe-back[^{]*#/);
});
