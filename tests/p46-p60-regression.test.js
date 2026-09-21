const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("P46: additive deck append is atomic, revision guarded, and preserves active deck", () => {
  const storage = read("storage.js");
  const importer = read("js/import-export.js");

  assert.match(storage, /async function appendDeck\(deckInput, options = \{\}\)/);
  assert.match(storage, /db\.transaction\(names, "readwrite"\)/);
  assert.match(storage, /actualRevision !== expectedRevision/);
  assert.match(storage, /const deckId = createEntityId\("deck"/);
  assert.match(storage, /const cards = deckInput\.cards\.map/);
  assert.match(storage, /direction: deckInput\.direction === "reverse"/);
  assert.doesNotMatch(storage.slice(storage.indexOf("async function appendDeck"), storage.indexOf("async function replaceAppSnapshot")), /activeDeckId\s*=/);
  assert.match(
    importer,
    /LCStorage\.appendDeck\(\{\s*\.\.\.result\.deck,\s*learningLanguage: importLanguage,\s*\},\s*\{\s*expectedRevision: Number\(state\.revision\)/s
  );
});

test("P47: settings expose only repeatable full restore while legacy deck parsing remains compatible", () => {
  const html = read("index.html");
  const shell = read("js/app-shell.js");
  const importer = read("js/import-export.js");

  assert.match(html, /id="importFile"[^>]+accept="application\/json,\.json"/);
  assert.doesNotMatch(html, /id="deckImportFile"/);
  assert.doesNotMatch(shell, /\$\("#deckImportFile"\)/);
  assert.match(importer, /importData\(file, expectedKind = "full"\)/);
  assert.match(importer, /expectedKind === "deck"/);
  assert.match(importer, /input\.value = ""/);
  assert.match(importer, /unsupported-version/);
  assert.match(importer, /wrong-kind/);
});

test("P48-P50: destructive operations use expected revision and preserve reset content", () => {
  const importer = read("js/import-export.js");

  assert.match(importer, /expectedRevision: Number\(state\.revision\) \|\| 0/);
  assert.match(importer, /const reset = structuredClone\(card\)/);
  for (const field of ["state", "step", "ease", "interval", "due", "reps", "lapses", "lastReview"]) {
    assert.match(importer, new RegExp(`reset\\.${field}\\s*=`));
  }
  assert.match(importer, /delete reset\.suspendedFrom/);
  assert.match(importer, /delete reset\.fsrs/);
  assert.match(importer, /nextState\.history = \{\}/);
  assert.match(importer, /nextState\.sessionReviewedIds = \[\]/);
  assert.match(importer, /practiceDraft: null/);
  assert.match(importer, /restoreRecoverySnapshot\(\{\s*expectedRevision:/s);
});

test("P51-P54: settings retain one DOM, desktop master-detail, native swipe, and accessible touch sizing", () => {
  const html = read("index.html");
  const responsive = read("css/settings-responsive.css");
  const polish = read("css/settings-polish.css");
  const ui = read("js/ui.js");

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "all document IDs must remain unique");
  assert.match(responsive, /@media \(min-width: 900px\)/);
  assert.match(responsive, /grid-template-columns: minmax\(240px, 320px\) minmax\(0, 1fr\)/);
  assert.match(responsive, /overscroll-behavior-x: auto/);
  assert.match(responsive, /min-height: 44px/);
  assert.match(responsive, /prefers-reduced-motion: reduce/);
  assert.match(polish, /font-size: 16px/);
  assert.match(ui, /history\.scrollRestoration = "manual"/);
  assert.match(ui, /aria-current", "page"/);
});

test("data actions and destructive confirmation remain usable on narrow iPhone screens", () => {
  const html = read("index.html");
  const polish = read("css/settings-polish.css");
  const ui = read("js/ui.js");
  const shell = read("js/app-shell.js");

  assert.match(html, /id="settings-data"/);
  assert.match(html, /id="resetProgressBtn"/);
  assert.match(html, /id="wipeBtn"/);
  assert.match(html, /id="textInputModal"[^>]+role="dialog"/);
  assert.match(polish, /#settings-data \.settings-action-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(polish, /:is\(#settings-backup, #settings-data\) \.settings-action-row > span:first-child\s*\{[\s\S]*?overflow: hidden/);
  assert.match(polish, /:is\(#settings-backup, #settings-data\) \.settings-action-row > span:first-child > b,[\s\S]*?white-space: nowrap !important[\s\S]*?text-overflow: ellipsis/);
  assert.match(polish, /#textInputModal \.compact-modal-card\s*\{[\s\S]*?max-height: min\(88dvh, 620px\)/);
  assert.match(polish, /#textInputModal \.modal-footer\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(polish, /padding: 12px 16px calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(polish, /@media \(max-width: 370px\)[\s\S]*?#textInputModal \.modal-footer\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(ui, /const handleCancel = \(\) => \{\s*closeDialog\(modal\);\s*finish\(null\);/);
  assert.match(shell, /modal\?\.id === "textInputModal"\) settleTextInput\(null\)/);
});

test("P55: service worker update is gated by drafts and storage flush with one reload path", () => {
  const stats = read("js/stats.js");

  const commitAt = stats.indexOf('commitSettingsDrafts("service-worker-update")');
  const flushAt = stats.indexOf("storage.flush()");
  const messageAt = stats.indexOf('postMessage({ type: "SKIP_WAITING" })');
  assert.ok(commitAt >= 0 && flushAt > commitAt && messageAt > flushAt);
  assert.match(stats, /SW_UPDATE_FALLBACK_MS = 4_000/);
  assert.match(stats, /navigator\.serviceWorker\.addEventListener\("controllerchange"/);
  assert.match(stats, /isStandalonePwa\(\)/);
});

test("P56-P60: release shell and metadata stay internally consistent", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const html = read("index.html");
  const sw = read("sw.js");
  const stats = read("js/stats.js");

  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(sw, new RegExp(`const CACHE = "lingo-cards-v${pkg.version.replaceAll(".", "\\.")}"`));
  assert.match(stats, new RegExp(`sw\\.js\\?v=${pkg.version.replaceAll(".", "\\.")}`));
  for (const asset of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+\.(?:js|css)\?v=([^"]+))"/g)) {
    assert.equal(asset[2], pkg.version, `stale asset version: ${asset[1]}`);
    assert.ok(sw.includes(`"./${asset[1]}"`), `APP_SHELL misses ${asset[1]}`);
  }
});