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
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    Set,
    String,
    TypeError,
  };
  vm.createContext(context);
  vm.runInContext(read("backup.js"), context, { filename: "backup.js" });
  return context.window.LCBackup;
}

function sampleState() {
  return {
    decks: [{
      id: "deck-1",
      name: "Core",
      desc: "Main deck",
      direction: "reverse",
      createdAt: 1,
      updatedAt: 2,
    }],
    cards: [{
      id: "card-1",
      deckId: "deck-1",
      type: "cloze",
      front: "A {{c1::word}}",
      back: "слово",
      pronunciation: "wɜːd",
      cloze: "word",
      exampleSentence: "A word matters.",
      exampleTranslation: "Слово имеет значение.",
      exampleTargetTerm: "word",
      state: "review",
      step: 1,
      ease: 250,
      interval: 3,
      due: 10,
      reps: 2,
      lapses: 1,
      lastReview: 8,
      createdAt: 1,
      updatedAt: 9,
    }],
    settings: {
      language: "ru",
      theme: "auto",
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiModelCache: { openai: ["gpt-test"], google: ["gemini-test"] },
      aiKey: "TOP-SECRET-SENTINEL",
      studyCardModes: ["word", "sentence"],
      studyCardFronts: ["english", "local"],
      autoTTS: true,
      practiceHistory: [],
    },
    activeDeckId: "deck-1",
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    revision: 7,
    updatedAt: 9,
  };
}

test("P31: provider cache remains provider-indexed while aiModel is one string", () => {
  const backup = loadBackup();
  const payload = JSON.parse(backup.buildFullExport({
    state: sampleState(),
    reviewEvents: [],
    practiceDraft: null,
  }));
  assert.equal(typeof payload.state.settings.aiModel, "string");
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.state.settings.aiModelCache)),
    { openai: ["gpt-test"], google: ["gemini-test"] },
  );
});

test("P39/P41: canonical full v2 export preserves the API key and updatedAt", () => {
  const backup = loadBackup();
  const text = backup.buildFullExport({
    state: sampleState(),
    reviewEvents: [{
      id: "event-1",
      cardId: "card-1",
      deckId: "deck-1",
      grade: 2,
      at: 9,
    }],
    practiceDraft: null,
  });
  const payload = JSON.parse(text);
  assert.equal(payload.format, 3);
  assert.equal(payload.kind, "full");
  assert.equal(payload.metadata.secretsIncluded, true);
  assert.equal(payload.state.settings.aiKey, "TOP-SECRET-SENTINEL");
  assert.equal(payload.state.cards[0].updatedAt, 9);

  const restored = backup.parse(text);
  assert.equal(restored.kind, "full");
  assert.equal(restored.secretPresent, true);
  assert.equal(restored.state.settings.aiKey, "TOP-SECRET-SENTINEL");
});

test("full backup round-trip preserves valid card links and complete practice entries", () => {
  const backup = loadBackup();
  const state = sampleState();
  state.cards.push({
    ...state.cards[0],
    id: "card-2",
    front: "Second",
    linkedCardId: "card-1",
  });
  state.cards[0].linkedCardId = "card-2";
  state.settings.practiceHistory = [{
    id: "history-1",
    at: 123,
    title: "Story",
    text: "Text",
    glossary: [{ word: "word", meaning: "meaning", note: "kept" }],
    words: [{ front: "word", back: "слово", cardId: "card-1" }],
    questions: [{ q: "Question?", hint: "Hint", answer: "Answer" }],
    feedback: { score: 4, details: ["clear", { category: "grammar" }] },
    customMetadata: { source: "ai", attempt: 2 },
  }];

  const text = backup.buildFullExport({ state, reviewEvents: [], practiceDraft: null });
  const restored = backup.parse(text);
  assert.equal(restored.kind, "full");
  assert.equal(restored.state.cards[0].linkedCardId, "card-2");
  assert.equal(restored.state.cards[1].linkedCardId, "card-1");
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.state.settings.practiceHistory[0].customMetadata)),
    { source: "ai", attempt: 2 },
  );
  assert.equal(restored.state.settings.practiceHistory[0].questions[0].answer, "Answer");
  assert.equal(restored.state.settings.practiceHistory[0].feedback.details[1].category, "grammar");
  assert.equal(restored.state.settings.practiceHistory[0].words[0].cardId, "card-1");

  state.cards[0].linkedCardId = "missing-card";
  const invalidLink = backup.parse(backup.buildFullExport({
    state,
    reviewEvents: [],
    practiceDraft: null,
  }));
  assert.ok(!("linkedCardId" in invalidLink.state.cards[0]));
});

test("P40: unsupported envelopes and legacy secrets are discriminated", () => {
  const backup = loadBackup();
  assert.equal(
    backup.parse(JSON.stringify({ app: "lingo-cards", format: 99, kind: "full" })).reason,
    "unsupported-version",
  );
  assert.equal(
    backup.parse(JSON.stringify({ app: "lingo-cards", format: 2, kind: "other" })).reason,
    "wrong-kind",
  );
  const legacy = sampleState();
  assert.equal(
    backup.parse(JSON.stringify(legacy)).reason,
    "secret-confirmation-required",
  );
});

test("P45: deck v2 strips identity, scheduling, settings, secrets, and linkedCardId", () => {
  const backup = loadBackup();
  const source = {
    ...sampleState().decks[0],
    aiKey: "TOP-SECRET-SENTINEL",
    cards: [{
      ...sampleState().cards[0],
      linkedCardId: "card-other",
    }],
  };
  const text = backup.buildDeckExport(source);
  const payload = JSON.parse(text);
  assert.equal(payload.kind, "deck");
  assert.equal(payload.format, 3);
  assert.equal(payload.deck.cards[0].type, "cloze");
  for (const forbidden of ["id", "deckId", "state", "due", "reps", "linkedCardId"]) {
    assert.ok(!(forbidden in payload.deck.cards[0]), forbidden);
  }
  assert.ok(!text.includes("TOP-SECRET-SENTINEL"));
  assert.equal(backup.parse(text).kind, "deck");
});

test("card-front mode follows Scheduling in Learning and the card timer is fully removed", () => {
  const html = read("index.html");
  const state = read("js/state.js");
  const settings = read("js/settings.js");
  const study = read("js/study.js");
  const scheduler = read("js/scheduler.js");
  const backup = read("backup.js");
  const css = read("css/stats-settings.css");

  const schedulingIndex = html.indexOf('data-i18n="settings.learning.algorithmTitle"');
  const cardModeIndex = html.indexOf('id="setStudyCardMode"');
  const cardFrontIndex = html.indexOf('id="setStudyCardFront"');
  const learningEndIndex = html.indexOf('id="settings-generation"');
  assert.ok([
    schedulingIndex >= 0,
    cardModeIndex > schedulingIndex,
    cardFrontIndex > cardModeIndex,
    learningEndIndex > cardFrontIndex,
  ].every(Boolean));
  assert.match(html, /id="studyModeMenu"[^>]+role="menu"/);
  assert.match(html, /id="studyFrontMenu"[^>]+role="menu"/);
  assert.equal((html.match(/role="menuitemcheckbox"/g) || []).length, 4);
  assert.match(state, /studyCardModes: \["word"\]/);
  assert.match(state, /studyCardFronts: \["english"\]/);
  assert.match(state, /source\.studyCardMode/);
  assert.match(state, /source\.cardFrontLanguage \|\| source\.studyCardFront/);
  assert.match(settings, /if \(!selected\.length\) \{\s*input\.checked = true;/);
  assert.match(settings, /commitStudyCardModes/);
  assert.match(settings, /commitStudyCardFronts/);
  assert.match(scheduler, /function buildStudyCardVariants\(\)/);
  assert.match(scheduler, /modes\.flatMap\(mode => fronts\.map\(front => \(\{ mode, front \}\)\)\)/);
  assert.match(scheduler, /function beginStudyCardVariants\(\)/);
  assert.match(scheduler, /const variants = shuffleStudyCards\(buildStudyCardVariants\(\)\);/);
  assert.match(scheduler, /function shuffleStudyCards\(cards\)[\s\S]*?Math\.floor\(Math\.random\(\) \* \(index \+ 1\)\)/);
  assert.doesNotMatch(scheduler, /const variants = buildStudyCardVariants\(\);\s*session\.currentCardVariants = variants;/);
  assert.match(scheduler, /function advanceStudyCardVariant\(grade\)/);
  assert.match(scheduler, /grade: Math\.min\(\.\.\.grades\)/);
  assert.match(scheduler, /function deferCurrentStudyCardVariant\(\)/);
  assert.match(scheduler, /const offset = remaining === 0[\s\S]*?: 1 \+ Math\.floor\(Math\.random\(\) \* remaining\)/);
  assert.match(scheduler, /function restoreStudyCardVariant\(entry\)/);
  assert.match(scheduler, /restoreStudyCardVariant\(current\);/);
  assert.match(study, /const variantResult = advanceStudyCardVariant\(g\)/);
  assert.match(study, /if \(!variantResult\.complete\) \{[\s\S]*?deferCurrentStudyCardVariant\(\);[\s\S]*?next\(\);/);
  assert.match(study, /scheduleAnswer\(card, variantResult\.grade\)/);
  assert.match(study, /const cardMode = session\.currentCardMode \|\| chooseStudyCardMode\(\)/);
  assert.match(study, /const cardFront = session\.currentCardFront \|\| chooseStudyCardFront\(\)/);
  assert.match(study, /const reversed = cardFront === "local"/);
  assert.match(study, /if \(cardMode === "sentence"\)/);
  assert.match(backup, /out\.studyCardModes/);
  assert.match(backup, /out\.studyCardFronts/);
  assert.match(css, /\.card-front-mode-block \{[\s\S]*?overflow: visible;/);
  assert.match(css, /\.study-mode-menu\.is-viewport-menu \{[\s\S]*?position: fixed;[\s\S]*?z-index: 320;/);
  assert.match(css, /\.study-front-menu \{[\s\S]*?bottom: calc\(100% \+ 5px\);/);
  const settingsPolishCss = read("css/settings-polish.css");
  assert.match(settingsPolishCss, /#settings-learning \.card-front-mode-block \{[\s\S]*?overflow: visible;/);
  assert.match(settings, /function positionCheckboxMenu\(trigger, menu\)/);
  assert.match(settings, /window\.visualViewport\?\.addEventListener\("resize", reposition\)/);
  for (const locale of ["i18n/ru.js", "i18n/uk.js", "i18n/en.js"]) {
    const dictionary = read(locale);
    assert.match(dictionary, /"settings\.cardFrontLanguage"/);
    assert.match(dictionary, /"settings\.cardFrontLanguage\.english"/);
    assert.match(dictionary, /"settings\.cardFrontLanguage\.local"/);
  }
  for (const source of [html, state, settings, study, scheduler, backup, css]) {
    assert.doesNotMatch(source, /showTimer|cardStartedAt|studyCardTimer|study-card-timer|settings\.showTimer|study\.timer/);
  }
});

test("P37-P44: storage exposes locked snapshots, recovery, revisions, and atomic stores", () => {
  const storage = read("storage.js");
  assert.match(storage, /DB_VERSION = 3/);
  assert.match(storage, /recoverySnapshots/);
  assert.match(storage, /withWriteLock\("app-state"/);
  assert.match(storage, /async function readAppSnapshot/);
  assert.match(storage, /async function replaceAppSnapshot/);
  assert.match(storage, /new StaleWriteError\("app-state"/);
  assert.match(storage, /db\.transaction\(names, "readwrite"\)/);
  assert.match(storage, /req\.result\.onversionchange/);
  assert.match(storage, /req\.onblocked/);
});

test("offline shell exactly includes versioned local scripts and styles", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const assets = [
    ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g),
  ]
    .map(match => match[1])
    .filter(url => !url.startsWith("manifest") && /\.(?:js|css)(?:\?|$)/.test(url));
  for (const asset of assets) {
    assert.ok(sw.includes(`"./${asset}"`), `APP_SHELL misses ${asset}`);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.ok(html.includes(`src="seed.js?v=${pkg.version}"`));
});

test("advanced learning settings are mounted directly in Learning", () => {
  const html = read("index.html");
  const css = read("css/settings-polish.css");
  const settings = read("js/settings.js");

  assert.doesNotMatch(html, /data-settings-route="expert"/);
  assert.doesNotMatch(html, /data-settings-route-open="expert"/);
  assert.doesNotMatch(html, /settings\.learning\.expert(?:Label|Btn)/);
  assert.match(settings, /panels\.learning\.appendChild\(block\)/);
  assert.doesNotMatch(settings, /panels\.expert/);
  assert.match(css, /#settings-learning \.settings-block \{[\s\S]*?padding: 0 14px;[\s\S]*?border-radius: 13px;/);
  assert.match(css, /#settings-learning \.button-block::before \{\s*display: none;/);
  assert.match(css, /#settings-learning \.settings-row \{[\s\S]*?border-top: 1px solid var\(--border\);/);
});

test("card generation settings are immediately visible in the grouped Settings layout", () => {
  const html = read("index.html");
  const css = read("css/settings-polish.css");
  const settings = read("js/settings.js");

  assert.match(html, /id="settings-generation" data-settings-route="generation"/);
  assert.match(html, /class="settings-block ai-block"/);
  assert.doesNotMatch(html, /class="settings-block button-block ai-block"/);
  assert.doesNotMatch(html, /id="aiLangNote"/);
  assert.doesNotMatch(html, /id="aiRateInfo"/);
  assert.doesNotMatch(html, /class="ai-privacy-note"/);
  assert.match(settings, /#aiExtra"\)\.hidden = false/g);
  assert.doesNotMatch(settings, /#aiExtra"\)\.hidden = (?:s\.aiMode|next) !== "ai"/);
  assert.match(css, /#settings-generation \.ai-block \{[\s\S]*?padding: 0 14px;[\s\S]*?border-radius: 13px;/);
  assert.match(css, /#settings-generation \.ai-block::before \{\s*display: none;/);
  assert.match(css, /#settings-generation \.block-icon \{\s*display: none;/);
  assert.match(css, /#settings-generation \.settings-row \{[\s\S]*?border-top: 1px solid var\(--border\);/);
  assert.match(css, /#settings-generation \.ai-mode-segmented \{[\s\S]*?width: 100%;/);
});
