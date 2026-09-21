const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("очередь обновления использует пакеты по 20 и не превышает 4 запроса Gemini в минуту", () => {
  const study = read("js/study.js");

  assert.match(study, /const EXAMPLE_BATCH_SIZE = 20;/);
  assert.match(study, /const EXAMPLE_MAX_ATTEMPTS = 3;/);
  assert.match(study, /const EXAMPLE_GEMINI_REQUEST_INTERVAL_MS = 10000;/);
  assert.match(study, /pending\.splice\(0, EXAMPLE_BATCH_SIZE\)/);
  assert.match(study, /state\.settings\.aiProvider === "google"/);
  assert.match(study, /retryAttempts: 1/);
});

test("пропуски возвращаются в очередь, Retry-After останавливает её, а успех сохраняется сразу", () => {
  const study = read("js/study.js");
  const ai = read("ai.js");

  assert.match(study, /entry\.attempts < EXAMPLE_MAX_ATTEMPTS\) pending\.push\(entry\)/);
  assert.match(study, /error\.retryAfterMs/);
  assert.match(study, /pending\.push\(\.\.\.retryEntries\)/);
  assert.match(study, /const ok = await mutateAndFlush/);
  assert.match(study, /const savedIds = new Set\(\)/);
  assert.match(study, /savedIds\.add\(String\(update\.id\)\)/);
  assert.match(study, /updated \+= savedIds\.size/);
  assert.match(study, /const materiallyChanged = nextSentence !== currentExamples\.sentence/);
  assert.match(study, /setExampleRefreshBar\(progress, updated\)/);
  assert.match(study, /update\.entry\.attempts < EXAMPLE_MAX_ATTEMPTS\) retryEntries\.push\(update\.entry\)/);
  assert.doesNotMatch(study, /updated \+= updates\.length/);
  const refreshBody = study.slice(
    study.indexOf("async function refreshExamplesForCards"),
    study.indexOf("function refreshDeckExamples")
  );
  assert.doesNotMatch(refreshBody, /setExampleRefreshBar\(progress, completed\)/);
  assert.match(study, /failedCards\.map\(card => String\(card\.front/);
  assert.match(ai, /attempts: Number\.isFinite\(opts\.retryAttempts\)/);
});

test("темы, ситуации, стили и температура обновления примеров берутся из настроек", () => {
  const ai = read("ai.js");
  const state = read("js/state.js");
  const settings = read("js/settings.js");
  const study = read("js/study.js");
  const html = read("index.html");

  assert.doesNotMatch(ai, /const EXAMPLE_(?:TOPICS|SITUATIONS|STYLES) = \[/);
  assert.match(ai, /function parsePromptList\(value, settingName\)/);
  assert.match(ai, /topic: randomItem\(topics\)/);
  assert.match(ai, /situation: randomItem\(situations\)/);
  assert.match(ai, /style: randomItem\(styles\)/);
  assert.match(ai, /batchExamplesPrompt\(items,[\s\S]*?\{ topics, situations, styles \}\)/);
  assert.match(ai, /modelTemperature/);
  assert.match(state, /exampleTopics:/);
  assert.match(state, /exampleSituations:/);
  assert.match(state, /exampleStyles:/);
  assert.match(state, /exampleTemperature: 0\.8/);
  assert.match(settings, /PROMPT_LIST_CONTROLS/);
  assert.match(study, /topics: state\.settings\.exampleTopics/);
  assert.match(study, /situations: state\.settings\.exampleSituations/);
  assert.match(study, /styles: state\.settings\.exampleStyles/);
  assert.match(study, /temperature: state\.settings\.exampleTemperature/);
  for (const id of ["setExampleTopics", "setExampleSituations", "setExampleStyles", "setExampleTemperature"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("обновление не показывает промежуточный toast и не перерисовывает учебную карточку при завершении", () => {
  const study = read("js/study.js");
  const refreshBody = study.slice(
    study.indexOf("async function refreshExamplesForCards"),
    study.indexOf("function refreshDeckExamples")
  );

  assert.doesNotMatch(refreshBody, /toast\(t\("examples\.progress"/);
  assert.doesNotMatch(refreshBody, /renderStudy\(\)/);
  assert.match(refreshBody, /renderBrowse\(\)/);
});

test("полоса прогресса вдвое толще, переливается и показывает цифровой счётчик без обводки", () => {
  const study = read("js/study.js");
  const css = read("css/polish.css");

  assert.match(study, /label\.className = "example-refresh-count"/);
  assert.match(study, /label\.textContent = `0\/\$\{total\}`/);
  assert.match(study, /progress\.label\.textContent = `\$\{done\}\/\$\{progress\.total\}`/);
  assert.match(css, /\.example-refresh-bar\s*\{[\s\S]*?height: 6px;/);
  assert.match(css, /@keyframes example-refresh-bar-shimmer/);
  assert.match(css, /\.example-refresh-count\s*\{[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});

test("активная полоса повторно монтируется после перерисовки учебной карточки", () => {
  const study = read("js/study.js");

  assert.match(study, /let activeExampleRefreshProgress = null;/);
  assert.match(study, /function syncExampleRefreshBar\(\)/);
  assert.match(study, /if \(progress\.bar\.parentElement !== target\) target\.prepend\(progress\.bar\);/);
  assert.match(study, /function renderStudy\(\)[\s\S]*?syncExampleRefreshBar\(\);/);
  assert.match(study, /if \(activeExampleRefreshProgress === progress\) activeExampleRefreshProgress = null;/);
});

test("обновление из меню колоды показывает полосу на строке выбранной колоды", () => {
  const study = read("js/study.js");
  const decks = read("js/decks.js");

  assert.match(study, /function exampleRefreshTarget\(progress\)[\s\S]*?row\.dataset\.deckId === progress\.deckId/);
  assert.match(study, /function refreshDeckExamples\(deckId, button\)[\s\S]*?refreshExamplesForCards\(cards, button, deckId\)/);
  assert.match(decks, /function renderDecks\(\)[\s\S]*?list\.appendChild\(fragment\);\s*syncExampleRefreshBar\(\);/);
});