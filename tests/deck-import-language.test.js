const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadBackup() {
  const context = {
    window: {},
    structuredClone: global.structuredClone,
    Date, JSON, Math, Number, Object, Array, Set, Map, String, TypeError, Error, RegExp, Boolean,
  };
  vm.createContext(context);
  vm.runInContext(read("backup.js"), context, { filename: "backup.js" });
  return context.window.LCBackup;
}

function deckWithCards(learningLanguage) {
  return {
    id: "deck-source",
    name: "Norsk basis",
    desc: "beskrivelse",
    direction: "reverse",
    learningLanguage,
    cards: [{
      id: "card-1",
      deckId: "deck-source",
      type: "cloze",
      front: "hus",
      back: "дом",
      cloze: "Et {{c1::hus}}",
      info: "substantiv",
      exampleSentence: "Et stort hus.",
      state: "review",
      due: 99,
      reps: 7,
      linkedCardId: "card-other",
    }],
  };
}

test("deck export keeps the learning language and drops study progress", () => {
  const backup = loadBackup();
  const payload = JSON.parse(backup.buildDeckExport(deckWithCards("nb")));
  assert.equal(payload.kind, "deck");
  assert.equal(payload.format, 3);
  assert.equal(payload.deck.learningLanguage, "nb");
  assert.equal(payload.deck.direction, "reverse");
  assert.equal(payload.deck.cards[0].info, "substantiv");
  for (const forbidden of ["id", "deckId", "state", "due", "reps", "linkedCardId"]) {
    assert.ok(!(forbidden in payload.deck.cards[0]), forbidden);
  }
});

test("deck round-trip through parse preserves language and content", () => {
  const backup = loadBackup();
  const parsed = backup.parse(backup.buildDeckExport(deckWithCards("nb")));
  assert.equal(parsed.kind, "deck");
  assert.equal(parsed.deck.learningLanguage, "nb");
  assert.equal(parsed.deck.cards[0].cloze, "Et {{c1::hus}}");
  assert.equal(parsed.deck.cards[0].exampleSentence, "Et stort hus.");
});

test("unlabeled and unknown deck languages stay null for an explicit choice", () => {
  const backup = loadBackup();
  const unlabeled = backup.parse(backup.buildDeckExport(deckWithCards(undefined)));
  assert.equal(unlabeled.deck.learningLanguage, null);
  const unknown = backup.sanitizeDeckContent({ ...deckWithCards("zz") });
  assert.equal(unknown.learningLanguage, null);
});

test("legacy deck array import produces decks without a language label", () => {
  const backup = loadBackup();
  const parsed = backup.parse(JSON.stringify([
    { name: "Legacy", cards: [{ front: "a", back: "b" }] },
  ]));
  assert.equal(parsed.kind, "decks");
  assert.equal(parsed.decks[0].learningLanguage, null);
});

test("deck import assigns a new globally unique id and keeps language", () => {
  const source = `
    ${read("js/import-export.js")}
  `;
  assert.ok(source.includes("resolveDeckImportLanguage"), "import flow resolves language");
  assert.ok(source.includes("learningLanguage: importLanguage"), "append uses resolved language");
  const storage = read("storage.js");
  assert.ok(
    storage.includes('learningLanguage: deckInput.learningLanguage === "nb" ? "nb" : "en"'),
    "appendDeck persists the deck language"
  );
  assert.ok(storage.includes('createEntityId("deck", usedDeckIds)'), "new deck id");
  assert.ok(storage.includes('createEntityId("card", usedCardIds)'), "new card ids");
  assert.ok(storage.includes('info: String(cardInput.info || "")'), "card info survives append");
  assert.ok(storage.includes('state: "new"'), "no study progress is imported");
});

test("progress reset touches only the active language and keeps content", () => {
  const source = read("js/import-export.js");
  assert.ok(source.includes("confirm.resetProgress.languageDetail"), "reset warns about the language");
  assert.ok(source.includes("languageDeckIds.has(card.deckId)"), "only active-language cards are reset");
  assert.ok(
    source.includes('normalizeLearningLanguage(event.learningLanguage) !== activeLanguage'),
    "events of other languages are kept"
  );
  assert.ok(
    source.includes("nextState.settings.practiceHistory"),
    "AUD-010: история практики обрабатывается явно в settings.practiceHistory"
  );
  assert.ok(
    !source.includes('normalizeLearningLanguage(entry.learningLanguage) !== activeLanguage'),
    "AUD-007: история практики активного языка больше не удаляется при сбросе"
  );
  assert.ok(source.includes('"reset-progress"'), "reset keeps a recovery operation label");
});

test("global wipe warns about every language and keeps recovery", () => {
  const source = read("js/import-export.js");
  assert.ok(source.includes("confirm.wipeAll.allLanguages"), "wipe warns about all languages");
  assert.ok(source.includes('"wipe-all"'), "wipe keeps a recovery operation label");
});

test("AUD-005: отмена не пишет данные, подтверждение сохраняет выбранный язык", async () => {
  const { Window } = await import("happy-dom");
  for (const action of ["cancel", "close", "en", "nb"]) {
    const window = new Window();
    const html = read("index.html");
    window.document.body.innerHTML = html.slice(html.indexOf('    <!-- Confirmation dialog -->'), html.indexOf('    <!-- Duplicate cards dialog -->'));
    const calls = [];
    const state = { activeLearningLanguage: "nb", revision: 0, decks: [], cards: [] };
    const context = vm.createContext({
      window, document: window.document, HTMLElement: window.HTMLElement,
      requestAnimationFrame: callback => callback(), console, state,
      t: key => key, normalizeLearningLanguage: code => code, languageCodes: () => ["en", "nb"],
      commitSettingsDrafts: async () => { calls.push("settings"); },
      rebuildEntityIndexes() {}, resetDirtyState() {}, renderDecks() {}, renderDeckSelector() {},
    });
    window.LCBackup = { parse: () => ({ kind: "deck", deck: { name: "Legacy", cards: [] } }) };
    window.LCStorage = {
      flush: async () => { calls.push("flush"); },
      appendDeck: async deck => { calls.push(deck.learningLanguage); return { deck, cards: [], revision: 1, updatedAt: 1 }; },
    };
    vm.runInContext(read("js/ui.js") + '\n' + read("js/import-export.js") + '\ntoast = () => {};', context);
    const pending = context.importDeckBackup("{}");
    assert.equal(window.document.querySelector("#confirmChoice").value, "en");
    assert.deepEqual(calls, []);
    if (action === "cancel") context.cancelConfirmDialog();
    else if (action === "close") context.settleConfirmDialog(false);
    else {
      window.document.querySelector("#confirmChoice").value = action;
      context.settleConfirmDialog(true);
    }
    await pending;
    assert.deepEqual(calls, ["cancel", "close"].includes(action) ? [] : ["settings", "flush", action]);
    assert.equal(state.decks.length, ["cancel", "close"].includes(action) ? 0 : 1);
    await window.happyDOM.close();
  }
  const shell = read("js/app-shell.js");
  assert.ok(shell.includes('$("#confirmCancelBtn").onclick = cancelConfirmDialog'));
  assert.ok(shell.includes('activeDialog.id === "confirmModal") cancelConfirmDialog()'));
  assert.ok(shell.includes('e.target.closest("[data-confirm-cancel]")'));
});

test("destructive confirmation strings exist in every interface language", () => {
  const keys = [
    "confirm.resetProgress.languageDetail",
    "confirm.wipeAll.allLanguages",
    "confirm.deckImport.title",
    "confirm.deckImport.unlabeled",
    "confirm.deckImport.mismatch",
    "confirm.deckImport.detail",
    "confirm.deckImport.action",
  ];
  for (const locale of ["ru", "uk", "en"]) {
    const source = read(`i18n/${locale}.js`);
    for (const key of keys) {
      assert.ok(source.includes(`"${key}"`), `${locale} is missing ${key}`);
    }
  }
});
