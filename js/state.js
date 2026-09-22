/* Lingo Cards — Core state, IndexedDB persistence, migrations, helpers */

/* ========================================================================
   Lingo Cards — SRS engine (SM-2 with Anki-style learning steps)
   ======================================================================== */

const STORAGE_KEY = "lingo-cards-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const DIFFICULTY_CACHE_VERSION = 1;
const DIFFICULTY_RECENT_LIMIT = 40;
const DIFFICULTY_HALF_LIFE_DAYS = 21;

function clampDifficulty(value) {
  return Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function normalizeDifficultyEvent(event) {
  const grade = Number(event?.grade);
  const at = Number(event?.at);
  if (!Number.isInteger(grade) || grade < 0 || grade > 3 || !Number.isFinite(at) || at <= 0) return null;
  return { grade, at };
}

function calculateDifficultyCache(events, now = Date.now()) {
  const ordered = (Array.isArray(events) ? events : [])
    .map(normalizeDifficultyEvent)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  let streakCount = 0;
  let streakWeight = 0;
  let problemSince = null;
  let lastProblemAt = null;

  for (const event of ordered) {
    if (event.grade <= 1) {
      if (streakCount === 0) problemSince = event.at;
      streakCount += 1;
      streakWeight += event.grade === 0 ? 1 : 0.6;
      lastProblemAt = event.at;
    } else {
      streakCount = 0;
      streakWeight = 0;
      problemSince = null;
      lastProblemAt = null;
    }
  }

  const recent = ordered.slice(-DIFFICULTY_RECENT_LIMIT);
  const recentRaw = recent.reduce((sum, event) => {
    const ageDays = Math.max(0, now - event.at) / DAY_MS;
    const decay = Math.pow(0.5, ageDays / DIFFICULTY_HALF_LIFE_DAYS);
    const weight = [1, 0.6, -0.45, -0.8][event.grade];
    return sum + weight * decay;
  }, 0);
  const streakPart = Math.min(55, 12 * Math.log2(1 + streakWeight * 1.8));
  const durationDays = problemSince ? Math.max(0, now - problemSince) / DAY_MS : 0;
  const durationPart = problemSince ? Math.min(20, 6 * Math.log1p(durationDays)) : 0;
  const recentPart = Math.max(0, Math.min(25, recentRaw * 5));
  const score = Math.round(clampDifficulty(streakPart + durationPart + recentPart));

  return {
    version: DIFFICULTY_CACHE_VERSION,
    score,
    streakCount,
    streakWeight: Number(streakWeight.toFixed(3)),
    problemSince,
    lastProblemAt,
    recent,
    calculatedAt: now,
  };
}

function difficultyScore(card, now = Date.now()) {
  const cache = card?.difficultyCache;
  if (!cache || cache.version !== DIFFICULTY_CACHE_VERSION) return 0;
  return calculateDifficultyCache(cache.recent, now).score;
}

function difficultyStyle(card, now = Date.now()) {
  const score = difficultyScore(card, now);
  const hue = Math.round(120 * (1 - score / 100));
  const lightness = Math.round(94 - score * 0.16);
  return {
    score,
    background: `hsl(${hue} 72% ${lightness}%)`,
    border: `hsl(${hue} 54% ${Math.max(38, lightness - 24)}%)`,
    foreground: `hsl(${hue} 48% 22%)`,
  };
}

function updateCardDifficulty(card, event, now = Date.now()) {
  const previous = card?.difficultyCache?.version === DIFFICULTY_CACHE_VERSION
    ? card.difficultyCache.recent
    : [];
  card.difficultyCache = calculateDifficultyCache([...previous, event], now);
  return card.difficultyCache;
}

function rebuildDifficultyCachesForState(targetState, reviewEvents, now = Date.now()) {
  const grouped = new Map();
  for (const event of reviewEvents || []) {
    if (!event?.cardId) continue;
    if (!grouped.has(event.cardId)) grouped.set(event.cardId, []);
    grouped.get(event.cardId).push(event);
  }
  let changed = 0;
  for (const card of targetState?.cards || []) {
    const next = calculateDifficultyCache(grouped.get(card.id) || [], now);
    if (JSON.stringify(card.difficultyCache) !== JSON.stringify(next)) {
      card.difficultyCache = next;
      changed += 1;
    }
  }
  return changed;
}

/* ----- State ----- */
let state = null;       // entire app state, persisted
let session = null;     // current study session (volatile)

/* ----- Default settings ----- */
const defaultSettings = {
  studyQueue: {
    new: true,
    learning: true,
    review: true,
  },
  learnSteps: [1, 10],        // ordered learning delays in minutes
  graduatingInterval: 1,      // days after completing all learning steps
  easyInterval: 4,            // days when Easy skips learning
  startingEase: 250,          // 2.5
  easyBonus: 130,             // +30% on easy
  hardFactor: 120,            // 1.2x prev interval on hard
  intervalModifier: 100,      // global multiplier
  lapseNewInterval: 0,    // % of old interval to keep after Again on a review card (0 = restart)
  lapseEasePenalty: 20,   // % points to subtract from ease on Again
  hardEasePenalty: 15,    // % points to subtract from ease on Hard
  easyEaseBoost: 15,      // % points to add to ease on Easy
  algorithm: "sm2",            // "sm2" | "fsrs"
  fsrsRetention: 90,           // % desired recall
  fsrsMaxInterval: 36500,      // days
  fsrsWeights: null,           // null = use FSRS defaults
  leechThreshold: 8,           // lapses before auto-suspend; 0 = disabled
  aiMode: "off",                // "off" | "dictionary" | "ai"
  aiProvider: "openai",         // "openai" | "google" | "xai"
  aiKey: "",
  aiModel: "",                  // empty -> use provider default
  aiModelCache: {},             // provider -> [model ids] fetched from API
  aiTargetLang: "uk",           // language to translate into
  exampleTopics: "everyday life; work; travel; learning; technology; health; food and cooking; relationships and friendship; finance and shopping; sports; nature and weather; entertainment and hobbies; family",
  exampleSituations: "a problem; a request; a solution; an observation; advice; a complaint; an explanation; an agreement or plan; a comparison; a joke or light irony",
  exampleStyles: "casual; neutral; formal or business; friendly and warm; sarcastic or humorous",
  exampleTemperature: 0.8,
  autoTTS: false,
  ttsRate: 0.95,
  studyCardModes: ["word"],     // one or both: "word", "sentence"
  studyCardFronts: ["english"], // one or both: "english", "local"
  theme: "auto",
  language: "uk",

  showAdvancedReview: false,  // collapse SM-2/FSRS/leech internals by default
  practiceDays: 7,            // day window for the practice slider
  practiceHistory: [],        // [{ id, at, title, format, level, payload, words }]
};

function cloneSettingValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

const NUMERIC_RANGES = Object.freeze({
  graduatingInterval: { ui: [1, 365], import: [1, 36500] },
  easyInterval: { ui: [1, 36500], import: [1, 36500] },
  startingEase: { ui: [130, 350], import: [130, 350] },
  easyBonus: { ui: [100, 250], import: [100, 250] },
  hardFactor: { ui: [100, 200], import: [100, 200] },
  intervalModifier: { ui: [50, 300], import: [50, 300] },
  lapseNewInterval: { ui: [0, 80], import: [0, 80] },
  lapseEasePenalty: { ui: [0, 50], import: [0, 50] },
  hardEasePenalty: { ui: [0, 30], import: [0, 30] },
  easyEaseBoost: { ui: [0, 30], import: [0, 30] },
  fsrsRetention: { ui: [70, 98], import: [70, 98] },
  fsrsMaxInterval: { ui: [30, 36500], import: [30, 36500] },
  leechThreshold: { ui: [0, 50], import: [0, 50] },
  exampleTemperature: { ui: [0, 2], import: [0, 2] },
  ttsRate: { ui: [0.3, 1.5], import: [0.3, 1.5] },
  practiceDays: { ui: [1, 45], import: [1, 45] },
});

const SETTINGS_SCHEMA = Object.freeze({
  studyQueue: { type: "study-queue" },
  learnSteps: { type: "learning-steps" },
  graduatingInterval: { type: "integer", ranges: NUMERIC_RANGES.graduatingInterval },
  easyInterval: { type: "integer", ranges: NUMERIC_RANGES.easyInterval },
  startingEase: { type: "integer", ranges: NUMERIC_RANGES.startingEase },
  easyBonus: { type: "integer", ranges: NUMERIC_RANGES.easyBonus },
  hardFactor: { type: "integer", ranges: NUMERIC_RANGES.hardFactor },
  intervalModifier: { type: "integer", ranges: NUMERIC_RANGES.intervalModifier },
  lapseNewInterval: { type: "integer", ranges: NUMERIC_RANGES.lapseNewInterval },
  lapseEasePenalty: { type: "integer", ranges: NUMERIC_RANGES.lapseEasePenalty },
  hardEasePenalty: { type: "integer", ranges: NUMERIC_RANGES.hardEasePenalty },
  easyEaseBoost: { type: "integer", ranges: NUMERIC_RANGES.easyEaseBoost },
  algorithm: { type: "enum", values: ["sm2", "fsrs"] },
  fsrsRetention: { type: "integer", ranges: NUMERIC_RANGES.fsrsRetention },
  fsrsMaxInterval: { type: "integer", ranges: NUMERIC_RANGES.fsrsMaxInterval },
  fsrsWeights: { type: "fsrs-weights" },
  leechThreshold: { type: "integer", ranges: NUMERIC_RANGES.leechThreshold },
  aiMode: { type: "enum", values: ["off", "dictionary", "ai"] },
  aiProvider: { type: "enum", values: ["openai", "google", "xai"] },
  aiKey: { type: "string" },
  aiModel: { type: "string" },
  aiModelCache: { type: "ai-model-cache" },
  aiTargetLang: { type: "enum", values: ["uk", "ru", "en"] },
  exampleTopics: { type: "string" },
  exampleSituations: { type: "string" },
  exampleStyles: { type: "string" },
  exampleTemperature: { type: "number", ranges: NUMERIC_RANGES.exampleTemperature, step: 0.1 },
  autoTTS: { type: "boolean" },
  ttsRate: { type: "number", ranges: NUMERIC_RANGES.ttsRate, step: 0.05 },
  studyCardModes: { type: "study-card-modes" },
  studyCardFronts: { type: "study-card-fronts" },
  theme: { type: "enum", values: ["light", "dark", "auto"] },
  language: { type: "enum", values: ["uk", "ru", "en"] },

  showAdvancedReview: { type: "boolean" },
  practiceDays: { type: "integer", ranges: NUMERIC_RANGES.practiceDays },
  practiceHistory: { type: "array" },
  expandedBlocks: { type: "expanded-blocks", default: [] },
});

const STEP_RATINGS = Object.freeze(["again", "hard", "good", "easy"]);
const STEP_UNITS = Object.freeze(["m", "h", "d"]);
const AI_PROVIDERS = Object.freeze(["openai", "google", "xai"]);
const EXPANDED_BLOCK_IDS = new Set(["learning", "again", "hard", "good", "easy", "ai", "algo", "leech"]);

function isSettingsRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInteger(value, fallback, ranges, mode) {
  const range = ranges[mode] || ranges.import;
  return Number.isInteger(value) && value >= range[0] && value <= range[1] ? value : fallback;
}

function normalizeNumber(value, fallback, ranges, mode, step) {
  const range = ranges[mode] || ranges.import;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < range[0] || numeric > range[1]) return fallback;
  if (!step) return numeric;
  const snapped = Math.round(numeric / step) * step;
  return Number(snapped.toFixed(10));
}

function normalizeStudyQueue(value, fallback) {
  const source = isSettingsRecord(value) ? value : {};
  return {
    new: typeof source.new === "boolean" ? source.new : fallback.new,
    learning: typeof source.learning === "boolean" ? source.learning : fallback.learning,
    review: typeof source.review === "boolean" ? source.review : fallback.review,
  };
}

function normalizeNewCardSteps(value, fallback, mode) {
  const source = isSettingsRecord(value) ? value : {};
  const max = mode === "ui" ? 999 : 36500;
  return Object.fromEntries(STEP_RATINGS.map(rating => {
    const step = isSettingsRecord(source[rating]) ? source[rating] : {};
    const defaultStep = fallback[rating];
    return [rating, {
      v: Number.isInteger(step.v) && step.v >= 1 && step.v <= max ? step.v : defaultStep.v,
      u: STEP_UNITS.includes(step.u) ? step.u : defaultStep.u,
    }];
  }));
}

function normalizeAiModelCache(value) {
  if (!isSettingsRecord(value)) return {};
  const result = {};
  for (const provider of AI_PROVIDERS) {
    if (!Array.isArray(value[provider])) continue;
    result[provider] = [...new Set(value[provider]
      .filter(model => typeof model === "string" && model.length > 0 && model.length <= 500))]
      .slice(0, 200);
  }
  return result;
}


function normalizeSettingValue(value, rule, fallback, mode = "import") {
  if (rule.type === "boolean") return typeof value === "boolean" ? value : fallback;
  if (rule.type === "string") return typeof value === "string" ? value : fallback;
  if (rule.type === "integer") return normalizeInteger(value, fallback, rule.ranges, mode);
  if (rule.type === "number") return normalizeNumber(value, fallback, rule.ranges, mode, rule.step);
  if (rule.type === "enum") return rule.values.includes(value) ? value : fallback;
  if (rule.type === "study-queue") return normalizeStudyQueue(value, fallback);
  if (rule.type === "learning-steps") {
    const values = Array.isArray(value) ? value : [];
    const normalized = values
      .map(Number)
      .filter(step => Number.isFinite(step) && step > 0 && step <= 525600)
      .slice(0, 20);
    return normalized.length ? normalized : cloneSettingValue(fallback);
  }
  if (rule.type === "ai-model-cache") return normalizeAiModelCache(value);
  if (rule.type === "study-card-modes") {
    const values = Array.isArray(value) ? value : [value];
    const normalized = [...new Set(values.filter(mode => mode === "word" || mode === "sentence"))];
    return normalized.length ? normalized : cloneSettingValue(fallback);
  }
  if (rule.type === "study-card-fronts") {
    const values = Array.isArray(value) ? value : [value];
    const normalized = [...new Set(values.filter(front => front === "english" || front === "local"))];
    return normalized.length ? normalized : cloneSettingValue(fallback);
  }

  if (rule.type === "expanded-blocks") {
    return Array.isArray(value)
      ? [...new Set(value.filter(item => typeof item === "string" && EXPANDED_BLOCK_IDS.has(item)))]
      : cloneSettingValue(fallback);
  }
  if (rule.type === "array") return Array.isArray(value) ? cloneSettingValue(value) : cloneSettingValue(fallback);
  if (rule.type === "fsrs-weights") {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length !== 17) return null;
    const weights = value.map(Number);
    return weights.every(weight =>
      Number.isFinite(weight) ? (weight >= -1000 ? weight <= 1000 : false) : false
    ) ? weights : null;
  }
  return cloneSettingValue(fallback);
}

function normalizeSettings(raw, mode = "import") {
  const validationMode = mode === "ui" ? "ui" : "import";
  const source = isSettingsRecord(raw) ? raw : {};
  const normalized = {};
  for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
    const fallback = Object.prototype.hasOwnProperty.call(rule, "default")
      ? rule.default
      : defaultSettings[key];
    let sourceValue = source[key];
    if (key === "studyCardModes" && sourceValue === undefined) sourceValue = source.studyCardMode;
    if (key === "studyCardFronts" && sourceValue === undefined) {
      sourceValue = source.cardFrontLanguage || source.studyCardFront;
    }
    normalized[key] = normalizeSettingValue(sourceValue, rule, fallback, validationMode);
  }
  return normalized;
}

function normalizeSettingsScalars(raw) {
  return normalizeSettings(raw, "import");
}

function normalizeSettingsForUi(raw) {
  return normalizeSettings(raw, "ui");
}

/* ----- Persistence (IndexedDB-backed) ----- */
let cardById = new Map();
let deckById = new Map();
let cardsByDeck = new Map();
const dirtyCardIds = new Set();
const deletedCardIds = new Set();
const dirtyDeckIds = new Set();
const deletedDeckIds = new Set();
const dirtyPracticeHistoryIds = new Set();
const deletedPracticeHistoryIds = new Set();
let settingsDirty = false;
let metaDirty = false;
let fullStateDirty = false;

function resetDirtyState() {
  dirtyCardIds.clear();
  deletedCardIds.clear();
  dirtyDeckIds.clear();
  deletedDeckIds.clear();
  dirtyPracticeHistoryIds.clear();
  deletedPracticeHistoryIds.clear();
  settingsDirty = false;
  metaDirty = false;
  fullStateDirty = false;
}

function markCardDirty(cardOrId) {
  const id = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
  if (!id) return;
  deletedCardIds.delete(id);
  dirtyCardIds.add(id);
}

function markCardDeleted(cardOrId) {
  const id = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
  if (!id) return;
  dirtyCardIds.delete(id);
  deletedCardIds.add(id);
}

function markDeckDirty(deckOrId) {
  const id = typeof deckOrId === "string" ? deckOrId : deckOrId?.id;
  if (!id) return;
  deletedDeckIds.delete(id);
  dirtyDeckIds.add(id);
}

function markDeckDeleted(deckOrId) {
  const id = typeof deckOrId === "string" ? deckOrId : deckOrId?.id;
  if (!id) return;
  dirtyDeckIds.delete(id);
  deletedDeckIds.add(id);
}

function markPracticeHistoryDirty(entryOrId) {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  if (!id) return;
  deletedPracticeHistoryIds.delete(id);
  dirtyPracticeHistoryIds.add(id);
}

function markPracticeHistoryDeleted(entryOrId) {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  if (!id) return;
  dirtyPracticeHistoryIds.delete(id);
  deletedPracticeHistoryIds.add(id);
}

function markMetaDirty() {
  metaDirty = true;
}

function markSettingsDirty() {
  settingsDirty = true;
}

function markFullStateDirty() { fullStateDirty = true; }

function removeCards(cardIds) {
  const ids = cardIds instanceof Set ? cardIds : new Set(cardIds || []);
  const existingIds = new Set();
  const affectedDeckIds = new Set();
  for (const id of ids) {
    const card = cardById.get(id);
    if (!card) continue;
    existingIds.add(id);
    affectedDeckIds.add(card.deckId);
  }
  if (existingIds.size === 0) return 0;

  const remainingCards = [];
  const rebuilt = new Map([...affectedDeckIds].map(id => [id, []]));
  for (const card of state.cards) {
    if (existingIds.has(card.id)) continue;
    remainingCards.push(card);
    if (rebuilt.has(card.deckId)) rebuilt.get(card.deckId).push(card);
  }
  state.cards = remainingCards;
  for (const [id, cards] of rebuilt) cardsByDeck.set(id, cards);
  for (const id of existingIds) {
    cardById.delete(id);
    if (state.studyCycles) delete state.studyCycles[id];
    markCardDeleted(id);
  }
  markMetaDirty();
  const storage = typeof window !== "undefined" ? window.LCStorage : null;
  storage?.deleteReviewEventsForCards?.(existingIds);
  return existingIds.size;
}

function removeCard(cardOrId) {
  const id = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
  return removeCards(id ? [id] : []) > 0;
}

function restoreCards(savedCards) {
  const candidates = Array.isArray(savedCards) ? savedCards : [];
  const restored = [];
  for (const savedCard of candidates) {
    if (!savedCard?.id || cardById.has(savedCard.id) || !deckById.has(savedCard.deckId)) continue;
    const card = structuredClone(savedCard);
    state.cards.push(card);
    cardById.set(card.id, card);
    if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
    cardsByDeck.get(card.deckId).push(card);
    markCardDirty(card);
    restored.push(card);
  }
  return restored;
}

function restoreReviewEvents(events) {
  for (const event of events || []) window.LCStorage.appendReviewEvent?.(event);
}

function restoreCardSnapshots(snapshots) {
  const source = Array.isArray(snapshots) ? snapshots : [];
  let restored = 0;
  for (const snapshot of source) {
    const card = getCardById(snapshot?.id);
    if (!card || !snapshot?.card) continue;
    const previousDeckId = card.deckId;
    Object.keys(card).forEach(key => { delete card[key]; });
    Object.assign(card, structuredClone(snapshot.card));
    if (previousDeckId !== card.deckId) {
      cardsByDeck.set(previousDeckId, (cardsByDeck.get(previousDeckId) || []).filter(item => item.id !== card.id));
      if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
      cardsByDeck.get(card.deckId).push(card);
    }
    markCardDirty(card);
    restored++;
  }
  return restored;
}

function moveCardsToDeck(cardIds, deckId) {
  const ids = cardIds instanceof Set ? cardIds : new Set(cardIds || []);
  if (!deckById.has(deckId) || ids.size === 0) return 0;
  const moving = [];
  const affectedDeckIds = new Set([deckId]);
  for (const id of ids) {
    const card = cardById.get(id);
    if (!card || card.deckId === deckId) continue;
    moving.push(card);
    affectedDeckIds.add(card.deckId);
  }
  if (moving.length === 0) return 0;
  for (const card of moving) {
    card.deckId = deckId;
    markCardDirty(card);
  }
  const rebuilt = new Map([...affectedDeckIds].map(id => [id, []]));
  for (const card of state.cards) {
    if (rebuilt.has(card.deckId)) rebuilt.get(card.deckId).push(card);
  }
  for (const [id, cards] of rebuilt) cardsByDeck.set(id, cards);
  return moving.length;
}

function moveCardToDeck(card, deckId) {
  return moveCardsToDeck(card?.id ? [card.id] : [], deckId) > 0;
}

function removeDeck(deckOrId) {
  const id = typeof deckOrId === "string" ? deckOrId : deckOrId?.id;
  const deck = deckById.get(id);
  if (!deck) return false;
  removeCards(new Set((cardsByDeck.get(id) || []).map(card => card.id)));
  state.decks = state.decks.filter(item => item.id !== id);
  deckById.delete(id);
  cardsByDeck.delete(id);
  markDeckDeleted(id);
  return true;
}

function rebuildEntityIndexes() {
  cardById = new Map();
  deckById = new Map();
  cardsByDeck = new Map();
  for (const deck of state?.decks || []) {
    deckById.set(deck.id, deck);
    cardsByDeck.set(deck.id, []);
  }
  for (const card of state?.cards || []) {
    cardById.set(card.id, card);
    if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
    cardsByDeck.get(card.deckId).push(card);
  }
}

const getCard = id => cardById.get(id);
const getDeck = id => deckById.get(id);
const getCardById = getCard;
const getDeckById = getDeck;
// Without a deck id this means "all decks" — which is always scoped to the
// active learning language, never the global card list.
const getDeckCards = id => {
  if (id) return cardsByDeck.get(id) || [];
  return typeof activeCards === "function" ? activeCards() : state.cards;
};

async function load() {
  return window.LCStorage.loadAppState(STORAGE_KEY);
}
function save() {
  syncActiveLanguageProfile(state);
  if (fullStateDirty) {
    window.LCStorage.setAppState(state);
  } else {
    const historyPuts = [];
    if (dirtyPracticeHistoryIds.size) {
      const dirtyIds = dirtyPracticeHistoryIds;
      for (const entry of state.settings.practiceHistory || []) {
        if (dirtyIds.has(entry.id)) historyPuts.push(entry);
      }
    }
    window.LCStorage.setAppState(state, {
      cards: {
        puts: [...dirtyCardIds].map(id => cardById.get(id)).filter(Boolean),
        deletes: [...deletedCardIds],
      },
      decks: {
        puts: [...dirtyDeckIds].map(id => deckById.get(id)).filter(Boolean),
        deletes: [...deletedDeckIds],
      },
      practiceHistory: {
        puts: historyPuts,
        deletes: [...deletedPracticeHistoryIds],
      },
      settings: settingsDirty,
      meta: metaDirty,
    });
  }
  if (window.LCStorage.hasPendingAppState?.()) resetDirtyState();
}

function recordReviewEvent(card, grade, at = Date.now()) {
  const event = {
    id: uid(),
    cardId: card.id,
    deckId: card.deckId,
    learningLanguage: cardLearningLanguage(card),
    grade,
    state: card.state,
    due: card.due,
    at,
  };
  window.LCStorage.appendReviewEvent?.(event);
  return event;
}

async function ensureDifficultyCaches() {
  const staleCards = state.cards.filter(card =>
    !card.difficultyCache || card.difficultyCache.version !== DIFFICULTY_CACHE_VERSION
  );
  if (!staleCards.length) return 0;
  const events = await window.LCStorage.getReviewEventsForCards(staleCards.map(card => card.id));
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.cardId)) grouped.set(event.cardId, []);
    grouped.get(event.cardId).push(event);
  }
  for (const card of staleCards) {
    card.difficultyCache = calculateDifficultyCache(grouped.get(card.id) || []);
    markCardDirty(card);
  }
  save();
  await flushState();
  return staleCards.length;
}

function updateSaveStatus(status = window.LCStorage.getStatus?.().status || "saved") {
  const indicator = $("#saveStatus");
  if (!indicator) return;
  const key = status === "saving" ? "storage.saving" : status === "error" ? "storage.error" : "storage.saved";
  const label = t(key);
  indicator.dataset.status = status;
  indicator.textContent = "";
  indicator.setAttribute("aria-label", label);
  indicator.title = label;
}

async function flushState() {
  await window.LCStorage.flush();
}

async function saveAndFlush() {
  save();
  await flushState();
}

async function mutateAndFlush(mutator) {
  const previous = structuredClone(state);
  try {
    mutator();
    await saveAndFlush();
    return true;
  } catch (error) {
    window.LCStorage.discardAppState?.();
    state = previous;
    rebuildEntityIndexes();
    resetDirtyState();
    reportSaveError(error);
    return false;
  }
}

function reportSaveError(error) {
  console.error("Save failed", error);
  updateSaveStatus("error");
}

function normalizeStudyCycles(raw, cards) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const cardIds = new Set((cards || []).map(card => card.id));
  const normalized = {};
  for (const [cardId, cycle] of Object.entries(raw)) {
    if (!cardIds.has(cardId) || !cycle || typeof cycle !== "object") continue;
    const variants = Array.isArray(cycle.variants)
      ? cycle.variants.filter(variant =>
          variant && (variant.mode === "word" || variant.mode === "sentence") &&
          (variant.front === "english" || variant.front === "local")
        ).map(variant => ({ mode: variant.mode, front: variant.front }))
      : [];
    const index = Number(cycle.index);
    const grades = Array.isArray(cycle.grades)
      ? cycle.grades.filter(grade => Number.isInteger(grade) && grade >= 0 && grade <= 3)
      : [];
    if (variants.length < 1 || !Number.isInteger(index) || index < 0 || index >= variants.length) continue;
    if (grades.length !== index) continue;
    normalized[cardId] = {
      variants,
      index,
      grades,
      updatedAt: Number.isFinite(Number(cycle.updatedAt)) ? Number(cycle.updatedAt) : 0,
    };
  }
  return normalized;
}

/* ----- Learning languages (canonical profiles) -----
   state.decks/state.cards stay global; a deck carries learningLanguage and a
   card inherits it through its deck. Per-language study context lives only in
   state.languageProfiles[code]. */

const LANGUAGE_REGISTRY = () => (typeof window !== "undefined" ? window.LCLanguages : globalThis.LCLanguages);

function defaultLearningLanguage() {
  return LANGUAGE_REGISTRY()?.DEFAULT_LANGUAGE || "en";
}

function normalizeLearningLanguage(value, fallback) {
  const registry = LANGUAGE_REGISTRY();
  if (registry) return registry.normalizeLanguageCode(value, fallback || registry.DEFAULT_LANGUAGE);
  return value === "nb" ? "nb" : "en";
}

function emptyLanguageProfile() {
  const registry = LANGUAGE_REGISTRY();
  if (registry) return registry.emptyProfile();
  return {
    activeDeckId: null,
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    practiceDraft: null,
    studyResume: null,
  };
}

function normalizeLanguageProfile(raw, legacy = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const fallback = legacy && typeof legacy === "object" ? legacy : {};
  const profile = emptyLanguageProfile();
  const history = source.history ?? fallback.history;
  const streak = source.streak ?? fallback.streak;
  const reviewed = source.sessionReviewedIds ?? fallback.sessionReviewedIds;
  const draft = source.practiceDraft ?? fallback.practiceDraft;
  const resume = source.studyResume ?? fallback.studyResume;
  profile.activeDeckId = typeof (source.activeDeckId ?? fallback.activeDeckId) === "string"
    ? (source.activeDeckId ?? fallback.activeDeckId)
    : null;
  if (history && typeof history === "object" && !Array.isArray(history)) profile.history = cloneSettingValue(history);
  if (streak && typeof streak === "object" && !Array.isArray(streak)) {
    profile.streak = {
      current: Number.isFinite(Number(streak.current)) ? Number(streak.current) : 0,
      lastDay: typeof streak.lastDay === "string" ? streak.lastDay : null,
    };
  }
  if (Array.isArray(reviewed)) profile.sessionReviewedIds = reviewed.filter(id => typeof id === "string");
  if (draft && typeof draft === "object" && !Array.isArray(draft)) profile.practiceDraft = cloneSettingValue(draft);
  if (resume && typeof resume === "object" && !Array.isArray(resume)) profile.studyResume = cloneSettingValue(resume);
  return profile;
}

function languageCodes() {
  return LANGUAGE_REGISTRY()?.CODES || ["en", "nb"];
}

// Migrate legacy single-language data into the canonical profile layout.
// Everything that existed before belongs to English; Norwegian starts empty.
function normalizeLanguageModel(loaded) {
  const codes = languageCodes();
  const fallbackCode = defaultLearningLanguage();
  const rawProfiles = loaded.languageProfiles && typeof loaded.languageProfiles === "object" && !Array.isArray(loaded.languageProfiles)
    ? loaded.languageProfiles
    : null;
  const legacyProfile = {
    activeDeckId: loaded.activeDeckId ?? null,
    history: loaded.history,
    streak: loaded.streak,
    sessionReviewedIds: loaded.sessionReviewedIds,
    practiceDraft: loaded.practiceDraft,
    studyResume: loaded.studyResume,
  };

  for (const deck of loaded.decks) {
    deck.learningLanguage = normalizeLearningLanguage(deck.learningLanguage, fallbackCode);
  }

  const profiles = {};
  for (const code of codes) {
    const legacy = !rawProfiles && code === fallbackCode ? legacyProfile : null;
    profiles[code] = normalizeLanguageProfile(rawProfiles?.[code], legacy);
  }
  loaded.languageProfiles = profiles;
  loaded.activeLearningLanguage = normalizeLearningLanguage(loaded.activeLearningLanguage, fallbackCode);
  loaded.dataModelVersion = LANGUAGE_REGISTRY()?.DATA_MODEL_VERSION || 2;

  // Drop dangling deck references instead of silently remapping them.
  const deckIds = new Set(loaded.decks.map(deck => deck.id));
  for (const code of codes) {
    const profile = profiles[code];
    if (profile.activeDeckId && !deckIds.has(profile.activeDeckId)) profile.activeDeckId = null;
    if (!profile.activeDeckId) {
      profile.activeDeckId = loaded.decks.find(deck => deck.learningLanguage === code)?.id || null;
    }
  }

  const active = profiles[loaded.activeLearningLanguage];
  loaded.activeDeckId = active.activeDeckId;
  loaded.history = active.history;
  loaded.streak = active.streak;
  loaded.sessionReviewedIds = active.sessionReviewedIds;
  loaded.practiceDraft = active.practiceDraft;
  loaded.studyResume = active.studyResume;
  return loaded;
}

function activeLanguageProfile(target = state) {
  const code = normalizeLearningLanguage(target?.activeLearningLanguage);
  if (!target.languageProfiles) target.languageProfiles = {};
  if (!target.languageProfiles[code]) target.languageProfiles[code] = emptyLanguageProfile();
  return target.languageProfiles[code];
}

// Copy the live compatibility fields back into the canonical profile.
function syncActiveLanguageProfile(target = state) {
  if (!target) return null;
  const profile = activeLanguageProfile(target);
  profile.activeDeckId = target.activeDeckId ?? null;
  profile.history = target.history || {};
  profile.streak = target.streak || { current: 0, lastDay: null };
  profile.sessionReviewedIds = Array.isArray(target.sessionReviewedIds) ? target.sessionReviewedIds : [];
  profile.practiceDraft = target.practiceDraft ?? null;
  profile.studyResume = target.studyResume ?? null;
  return profile;
}

function deckLearningLanguage(deckOrId) {
  const deck = typeof deckOrId === "string" ? deckById.get(deckOrId) : deckOrId;
  return normalizeLearningLanguage(deck?.learningLanguage);
}

function cardLearningLanguage(card) {
  return deckLearningLanguage(card?.deckId);
}

// Language-scoped selectors. Decks and cards stay global in state, so every
// browsing / study / editor surface must read through these helpers instead of
// walking state.decks or state.cards directly.
function decksForLanguage(language = state?.activeLearningLanguage) {
  const code = normalizeLearningLanguage(language);
  return (state?.decks || []).filter(deck => normalizeLearningLanguage(deck.learningLanguage) === code);
}

function activeDecks() {
  return decksForLanguage();
}

function cardsForLanguage(language = state?.activeLearningLanguage) {
  const code = normalizeLearningLanguage(language);
  return (state?.cards || []).filter(card => deckLearningLanguage(card.deckId) === code);
}

function isDeckInActiveLanguage(deckOrId) {
  const deck = typeof deckOrId === "string" ? deckById.get(deckOrId) : deckOrId;
  if (!deck) return false;
  return deckLearningLanguage(deck) === normalizeLearningLanguage(state?.activeLearningLanguage);
}

// Normalized code of the active learning language (shared helper).
function activeLearningLanguageCode() {
  return window.LCLanguages?.normalizeLanguageCode
    ? window.LCLanguages.normalizeLanguageCode(state.activeLearningLanguage)
    : (state.activeLearningLanguage || "en");
}

// Cards of the active language, or of one deck when an id is given.
function activeCards(deckId = null) {
  if (deckId) return isDeckInActiveLanguage(deckId) ? (cardsByDeck.get(deckId) || []) : [];
  return cardsForLanguage();
}

function firstDeckIdForLanguage(language = state?.activeLearningLanguage) {
  return decksForLanguage(language)[0]?.id || null;
}

function normalizeLoadedState(loaded) {
  loaded.revision = Number.isSafeInteger(Number(loaded.revision)) ? Number(loaded.revision) : 0;
  loaded.updatedAt = Number.isFinite(Number(loaded.updatedAt)) ? Number(loaded.updatedAt) : 0;
  const rawSettings = isSettingsRecord(loaded.settings) ? loaded.settings : {};
  loaded.settings = normalizeSettingsScalars(rawSettings);
  if (isSettingsRecord(rawSettings.newCardSteps)) {
    loaded.settings.newCardSteps = cloneSettingValue(rawSettings.newCardSteps);
  }
  if (!window.LCAi?.PROVIDER_DEFAULTS?.[loaded.settings.aiProvider]) {
    loaded.settings.aiProvider = defaultSettings.aiProvider;
    loaded.settings.aiModel = "";
  }
  if (loaded.settings.aiModelCache && typeof loaded.settings.aiModelCache === "object") {
    delete loaded.settings.aiModelCache.anthropic;
  }
  loaded.decks = Array.isArray(loaded.decks) ? loaded.decks : [];
  loaded.cards = Array.isArray(loaded.cards) ? loaded.cards : [];
  loaded.history = loaded.history && typeof loaded.history === "object" && !Array.isArray(loaded.history) ? loaded.history : {};
  loaded.streak = loaded.streak && typeof loaded.streak === "object" && !Array.isArray(loaded.streak) ? loaded.streak : { current: 0, lastDay: null };
  loaded.studyCycles = normalizeStudyCycles(loaded.studyCycles, loaded.cards);
  delete loaded.dailyNewIntroductions;
  migrateSchedulingSettings(loaded.settings);
  for (const deck of loaded.decks) {
    if (!deck.direction) deck.direction = "forward";
  }
  for (const card of loaded.cards) normalizeCardSuspension(card);
  loaded.cards.forEach(card => {
    card.exampleSentence = String(card.exampleSentence || "").trim();
    card.info = String(card.info || "").trim();
    card.exampleTranslation = String(card.exampleTranslation || "").trim();
    card.exampleTargetTerm = String(card.exampleTargetTerm || "").trim();
    normalizeCardSuspension(card);
    delete card.tags;
  });
  // Audit fix #1: legacy snapshots must be migrated to the canonical language
  // model on every real load path, not only inside tests. Idempotent.
  normalizeLanguageModel(loaded);
  return loaded;
}

function adoptLoadedState(value) {
  state = normalizeLoadedState(value);
  rebuildEntityIndexes();
  resetDirtyState();
  session = null;
  undoStack = [];
  renderActiveView({ includeSelectors: true });
}

function bindStorageEvents() {
  window.addEventListener("lcstorage:status", event => updateSaveStatus(event.detail?.status));
  window.addEventListener("lcstorage:statecommitted", event => {
    if (!state) return;
    state.revision = event.detail?.revision || state.revision;
    state.updatedAt = event.detail?.updatedAt || state.updatedAt;
  });
  window.addEventListener("lcstorage:stateexternalchange", event => {
    if (!state) return;
    if (event.detail?.dirty) {
      window.LCStorage.discardAppState?.();
      window.LCStorage.loadAppState(STORAGE_KEY)
        .then(value => { if (value) adoptLoadedState(value); })
        .catch(reportSaveError);
      return;
    }
    if (event.detail?.value) adoptLoadedState(event.detail.value);
  });
  updateSaveStatus();
}

function isStudyViewActive() {
  return document.body.getAttribute("data-view") === "study";
}

// Re-evaluate the study queue against the wall clock. Cards whose learning /
// review timers elapsed since the last render must move into the study queue
// without a manual app restart.
function refreshStudyViewIfNeeded() {
  if (!isStudyViewActive()) return;
  if (!session || session.deckId !== state.activeDeckId) {
    session = null;
    renderStudy();
    return;
  }
  // When the queue is idle ("all reviewed"), actively try to pull cards whose
  // due time has now arrived. next() handles the top-up + render.
  if (!session.currentId) {
    next({ refreshDue: true });
    scheduleNextDueRefresh();
    return;
  }
  // A card is on screen — don't disrupt the user with a full re-render.
  // Just keep the queue counters honest; scheduleNextDueRefresh already
  // covers waking the idle queue when the next card matures.
  updateStudyCounters();
}

// Lightweight refresh of just the New / Learning / Review count chips.
// The simplified category controls do not display counters.
function updateStudyCounters() {
  const counts = deckStats(state.activeDeckId);
  const setText = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };
  setText("#cntNew", counts.new);
  setText("#cntLearn", counts.learning);
  setText("#cntReview", counts.review);
}

let realtimeStudyTimer = null;
let nextDueTimer = null;

// Set a one-shot timer to fire exactly when the soonest learning/review card
// becomes due, so the queue updates promptly (the periodic poll is a backstop).
function scheduleNextDueRefresh() {
  if (nextDueTimer) { clearTimeout(nextDueTimer); nextDueTimer = null; }
  if (!isStudyViewActive()) return;
  const nd = nextDueAt(state.activeDeckId);
  if (!nd) return;
  let delay = nd - Date.now() + 250;
  if (delay < 0) delay = 0;
  if (delay > 60000) delay = 60000; // cap; periodic poll covers longer waits
  nextDueTimer = setTimeout(() => {
    nextDueTimer = null;
    refreshStudyViewIfNeeded();
  }, delay);
}

function startRealtimeStudyRefresh() {
  if (realtimeStudyTimer) clearInterval(realtimeStudyTimer);
  realtimeStudyTimer = setInterval(refreshStudyViewIfNeeded, 10000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushState().catch(reportSaveError);
  });
  window.addEventListener("pagehide", () => {
    if (typeof commitSettingsDrafts === "function") commitSettingsDrafts("pagehide");
    flushState().catch(reportSaveError);
  });
  window.addEventListener("blur", () => { flushState().catch(reportSaveError); });
  scheduleNextDueRefresh();
}

async function initState() {
  await window.LCStorage.ready();
  await window.LCStorage.migrateFromLocalStorage(STORAGE_KEY);

  const loaded = await load();
  if (loaded && loaded.decks && loaded.cards) {
    state = normalizeLoadedState(loaded);
    rebuildEntityIndexes();
    resetDirtyState();
    await ensureDifficultyCaches();
    return;
  }
  state = {
    decks: [],
    cards: [],
    dataModelVersion: LANGUAGE_REGISTRY()?.DATA_MODEL_VERSION || 2,
    activeLearningLanguage: defaultLearningLanguage(),
    languageProfiles: Object.fromEntries(languageCodes().map(code => [code, emptyLanguageProfile()])),
    activeDeckId: null,
    settings: { ...defaultSettings },
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    studyCycles: {},
  };
  for (const d of window.SEED_DECKS) {
    const deck = createDeck(d.name, d.desc);
    for (const c of d.cards) {
      createCard({
        deckId: deck.id,
        type: "basic",
        front: c.front,
        back: c.back,
        example: c.example || "",
        exampleSentence: c.exampleSentence || "",
        exampleTranslation: c.exampleTranslation || "",
        exampleTargetTerm: c.exampleTargetTerm || "",
        info: c.info || "",
        hint: c.hint || "",
      });
    }
  }
  state.activeDeckId = state.decks[0]?.id || null;
  state = normalizeLoadedState(await window.LCStorage.initializeAppState(STORAGE_KEY, state));
  rebuildEntityIndexes();
}

/* ----- Helpers ----- */
const uid = () => Math.random().toString(36).slice(2, 11);
const todayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const SCHEDULING_STATES = new Set(["new", "learning", "review"]);

function inferredSchedulingState(card) {
  if (card?.fsrs) return "review";
  if (Number(card?.step) > 0) return "learning";
  if (Number(card?.interval) > 0 || Number(card?.reps) > 0) return "review";
  return "new";
}

function inferredLegacySuspendedState(card) {
  return inferredSchedulingState(card);
}

function normalizeCardSuspension(card) {
  if (!card || typeof card !== "object") return;
  if (card.state === "suspended") {
    card.suspendedFrom = SCHEDULING_STATES.has(card.suspendedFrom)
      ? card.suspendedFrom
      : inferredLegacySuspendedState(card);
  } else if (SCHEDULING_STATES.has(card.state)) {
    delete card.suspendedFrom;
  } else {
    card.state = "new";
    delete card.suspendedFrom;
  }
}

function suspendCard(card) {
  if (!card || card.state === "suspended") return false;
  card.suspendedFrom = SCHEDULING_STATES.has(card.state) ? card.state : inferredSchedulingState(card);
  card.state = "suspended";
  card.updatedAt = Date.now();
  if (typeof markCardDirty === "function") markCardDirty(card);
  return true;
}

function unsuspendCard(card) {
  if (!card || card.state !== "suspended") return false;
  card.state = SCHEDULING_STATES.has(card.suspendedFrom) ? card.suspendedFrom : inferredSchedulingState(card);
  delete card.suspendedFrom;
  card.updatedAt = Date.now();
  if (typeof markCardDirty === "function") markCardDirty(card);
  return true;
}

function createDeck(name, desc = "", learningLanguage = null) {
  const language = normalizeLearningLanguage(
    learningLanguage || state?.activeLearningLanguage,
    defaultLearningLanguage()
  );
  const deck = { id: uid(), name, desc, direction: "forward", learningLanguage: language, createdAt: Date.now() };
  state.decks.push(deck);
  deckById.set(deck.id, deck);
  cardsByDeck.set(deck.id, []);
  markDeckDirty(deck);
  return deck;
}

function normalizeCardFront(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function findDuplicateCard(deckId, front, excludeCardId = null) {
  const normalized = normalizeCardFront(front);
  if (!deckId || !normalized) return null;
  return (cardsByDeck.get(deckId) || []).find(card =>
    card.id !== excludeCardId && normalizeCardFront(card.front) === normalized
  ) || null;
}

function createCard({ deckId, type = "basic", front = "", back = "", example = "", exampleSentence = "", exampleTranslation = "", exampleTargetTerm = "", hint = "", cloze = "", info = "" }) {
  if (!deckId || !deckById.has(deckId)) {
    throw new Error(`createCard: unknown deckId "${deckId}"`);
  }
  const card = {
    id: uid(),
    deckId,
    type,
    front, back, example, exampleSentence, exampleTranslation, exampleTargetTerm, hint, cloze, info,
    state: "new",
    step: 0,
    ease: state.settings.startingEase,
    interval: 0,
    due: Date.now(),
    reps: 0,
    lapses: 0,
    createdAt: Date.now(),
    lastReview: null,
    difficultyCache: calculateDifficultyCache([]),
  };
  state.cards.push(card);
  cardById.set(card.id, card);
  if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
  cardsByDeck.get(card.deckId).push(card);
  markCardDirty(card);
  return card;
}

