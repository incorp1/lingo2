/* Lingo Cards — backup module.
   Single responsibility: serialize / parse a complete account backup
   (decks + cards + ALL settings, including AI provider keys, model,
   theme, language, history, streak, practice history).

   This module knows nothing about the DOM or the app's render layer.
   It only transforms data, so the format can evolve without touching
   the rest of the app.

   Public API (window.LCBackup):
     buildExport(state)      -> JSON string ready to download
     filename(dateKey)       -> suggested file name
     parse(text)             -> { kind, ... } discriminated result
       kind === "full"   -> { kind, state }   full account restore
       kind === "decks"  -> { kind, decks }   legacy deck-only import
       kind === "unknown"-> { kind }
*/

(function () {
  // ---- Config (format constants live here, not scattered in logic) ----
  const CONFIG = {
    app: "lingo-cards",
    format: 3,            // canonical full/deck backup envelope version
    fileBase: "lingo-cards",
  };

  // Every learning language must round-trip; unknown codes are rejected
  // instead of being silently folded into the default language.
  const LEARNING_LANGUAGES = new Set(["en", "nb"]);
  const DEFAULT_LEARNING_LANGUAGE = "en";
  const SUPPORTED_FORMATS = [1, 2, 3];

  function languageCodeList() {
    return Array.from(LEARNING_LANGUAGES);
  }

  const LIMITS = {
    decks: 10000,
    cards: 500000,
    text: 100000,
    shortText: 1000,
    historyDays: 10000,
    practiceHistory: 100,
  };
  const CARD_TYPES = new Set(["basic", "cloze"]);
  const CARD_STATES = new Set(["new", "learning", "review", "suspended"]);
  const SCHEDULING_STATES = new Set(["new", "learning", "review"]);
  const DIRECTIONS = new Set(["forward", "reverse"]);
  const PROVIDERS = new Set(["openai", "google", "xai"]);
  const AI_MODES = new Set(["off", "dictionary", "ai"]);
  const ALGORITHMS = new Set(["sm2", "fsrs"]);
  const THEMES = new Set(["light", "dark", "auto"]);
  const LANGUAGES = new Set(["uk", "ru", "en"]);

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function cleanString(value, max = LIMITS.text) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  function cleanId(value) {
    const id = cleanString(value, 128);
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "";
  }

  function finiteNumber(value, fallback, min, max, integer = false) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    const bounded = Math.min(max, Math.max(min, n));
    return integer ? Math.round(bounded) : bounded;
  }

  function enumValue(value, allowed, fallback) {
    return allowed.has(value) ? value : fallback;
  }

  function uniqueId(candidate, used, prefix) {
    let id = cleanId(candidate);
    if (!id || used.has(id)) {
      do { id = `${prefix}-${Math.random().toString(36).slice(2, 11)}`; }
      while (used.has(id));
    }
    used.add(id);
    return id;
  }

  function learningLanguage(value, fallback = DEFAULT_LEARNING_LANGUAGE) {
    return enumValue(value, LEARNING_LANGUAGES, fallback);
  }

  function sanitizeDeck(raw, usedIds) {
    if (!isRecord(raw)) return null;
    return {
      id: uniqueId(raw.id, usedIds, "deck"),
      name: cleanString(raw.name, LIMITS.shortText) || "Imported",
      desc: cleanString(raw.desc),
      direction: enumValue(raw.direction, DIRECTIONS, "forward"),
      // Legacy decks without a language belong to English by definition.
      learningLanguage: learningLanguage(raw.learningLanguage),
      createdAt: finiteNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER, true),
    };
  }

  function sanitizeCard(raw, deckIds, usedIds, fallbackDeckId) {
    if (!isRecord(raw)) return null;
    const deckId = cleanId(raw.deckId);
    const safeDeckId = deckIds.has(deckId) ? deckId : fallbackDeckId;
    if (!safeDeckId) return null;
    const type = enumValue(raw.type, CARD_TYPES, "basic");
    const card = {
      id: uniqueId(raw.id, usedIds, "card"),
      deckId: safeDeckId,
      type,
      front: cleanString(raw.front),
      back: cleanString(raw.back),
      example: cleanString(raw.example),
      exampleSentence: cleanString(raw.exampleSentence),
      exampleTranslation: cleanString(raw.exampleTranslation),
      exampleTargetTerm: cleanString(raw.exampleTargetTerm),
      info: cleanString(raw.info),
      hint: cleanString(raw.hint),
      cloze: type === "cloze" ? cleanString(raw.cloze) : "",
      state: enumValue(raw.state, CARD_STATES, "new"),
      step: finiteNumber(raw.step, 0, 0, 1000, true),
      ease: finiteNumber(raw.ease, 250, 130, 1000),
      interval: finiteNumber(raw.interval, 0, 0, 36500),
      due: finiteNumber(raw.due, Date.now(), 0, Number.MAX_SAFE_INTEGER, true),
      reps: finiteNumber(raw.reps, 0, 0, 10000000, true),
      lapses: finiteNumber(raw.lapses, 0, 0, 10000000, true),
      createdAt: finiteNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER, true),
      updatedAt: finiteNumber(raw.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER, true),
      lastReview: raw.lastReview == null ? null : finiteNumber(raw.lastReview, null, 0, Number.MAX_SAFE_INTEGER, true),
    };
    const linkedCardId = cleanId(raw.linkedCardId);
    if (linkedCardId) card.linkedCardId = linkedCardId;
    if (card.state === "suspended") {
      if (SCHEDULING_STATES.has(raw.suspendedFrom)) card.suspendedFrom = raw.suspendedFrom;
      else if (isRecord(raw.fsrs)) card.suspendedFrom = "review";
      else if (card.reps > 0 || card.step > 0) card.suspendedFrom = "learning";
      else card.suspendedFrom = "new";
    }
    if (isRecord(raw.fsrs)) {
      const S = finiteNumber(raw.fsrs.S, 0, 0, 100000);
      const D = finiteNumber(raw.fsrs.D, 0, 0, 10);
      const lastReview = finiteNumber(raw.fsrs.lastReview, 0, 0, Number.MAX_SAFE_INTEGER, true);
      if (S > 0 && D > 0 && lastReview > 0) card.fsrs = { S, D, lastReview };
    }
    if (isRecord(raw.difficultyCache) && Number(raw.difficultyCache.version) === 1) {
      const recent = Array.isArray(raw.difficultyCache.recent)
        ? raw.difficultyCache.recent.slice(-40).map(event => {
            if (!isRecord(event)) return null;
            const grade = finiteNumber(event.grade, -1, 0, 3, true);
            const at = finiteNumber(event.at, 0, 0, Number.MAX_SAFE_INTEGER, true);
            return grade >= 0 && at > 0 ? { grade, at } : null;
          }).filter(Boolean)
        : [];
      card.difficultyCache = {
        version: 1,
        score: finiteNumber(raw.difficultyCache.score, 0, 0, 100, true),
        streakCount: finiteNumber(raw.difficultyCache.streakCount, 0, 0, 100000, true),
        streakWeight: finiteNumber(raw.difficultyCache.streakWeight, 0, 0, 100000),
        problemSince: raw.difficultyCache.problemSince == null ? null : finiteNumber(raw.difficultyCache.problemSince, null, 0, Number.MAX_SAFE_INTEGER, true),
        lastProblemAt: raw.difficultyCache.lastProblemAt == null ? null : finiteNumber(raw.difficultyCache.lastProblemAt, null, 0, Number.MAX_SAFE_INTEGER, true),
        recent,
        calculatedAt: finiteNumber(raw.difficultyCache.calculatedAt, 0, 0, Number.MAX_SAFE_INTEGER, true),
      };
    }
    return card;
  }

  function sanitizeSettings(raw, { includeSecrets = true } = {}) {
    if (!isRecord(raw)) return {};
    const out = {};
    if (includeSecrets) out.aiKey = cleanString(raw.aiKey, 10000);
    out.aiModel = cleanString(raw.aiModel, LIMITS.shortText);
    out.aiProvider = enumValue(raw.aiProvider, PROVIDERS, "openai");
    out.aiMode = enumValue(raw.aiMode, AI_MODES, "off");
    out.algorithm = enumValue(raw.algorithm, ALGORITHMS, "sm2");
    out.theme = enumValue(raw.theme, THEMES, "auto");
    out.language = enumValue(raw.language, LANGUAGES, "uk");
    out.aiTargetLang = enumValue(raw.aiTargetLang, LANGUAGES, "uk");
    const rawStudyModes = Array.isArray(raw.studyCardModes)
      ? raw.studyCardModes
      : [raw.studyCardMode];
    out.studyCardModes = [...new Set(rawStudyModes.filter(mode => mode === "word" || mode === "sentence"))];
    if (!out.studyCardModes.length) out.studyCardModes = ["word"];
    const rawStudyFronts = Array.isArray(raw.studyCardFronts)
      ? raw.studyCardFronts
      : [raw.cardFrontLanguage || raw.studyCardFront];
    out.studyCardFronts = [...new Set(rawStudyFronts.filter(front => front === "english" || front === "local"))];
    if (!out.studyCardFronts.length) out.studyCardFronts = ["english"];
    for (const key of ["autoTTS", "showAdvancedReview"]) out[key] = raw[key] === true;
    const numeric = {
      graduatingInterval: [1, 1, 36500],
      easyInterval: [4, 1, 36500], startingEase: [250, 130, 350], easyBonus: [130, 100, 250],
      hardFactor: [120, 100, 200], intervalModifier: [100, 50, 300], lapseNewInterval: [0, 0, 80],
      lapseEasePenalty: [20, 0, 50], hardEasePenalty: [15, 0, 30], easyEaseBoost: [15, 0, 30],
      fsrsRetention: [90, 70, 98], fsrsMaxInterval: [36500, 30, 36500], leechThreshold: [8, 0, 50], practiceDays: [7, 1, 180],
    };
    for (const [key, [fallback, min, max]] of Object.entries(numeric)) out[key] = finiteNumber(raw[key], fallback, min, max, true);
    if (isRecord(raw.studyQueue)) out.studyQueue = { new: raw.studyQueue.new !== false, learning: raw.studyQueue.learning !== false, review: raw.studyQueue.review !== false };
    if (Array.isArray(raw.learnSteps)) {
      out.learnSteps = raw.learnSteps
        .slice(0, 20)
        .map(v => finiteNumber(v, NaN, 0.01, 525600))
        .filter(Number.isFinite);
    }
    if (isRecord(raw.newCardSteps)) {
      const defaults = { again: { v: 1, u: "m" }, hard: { v: 5, u: "m" }, good: { v: 10, u: "m" }, easy: { v: 4, u: "d" } };
      out.newCardSteps = {};
      for (const rating of ["again", "hard", "good", "easy"]) {
        const step = isRecord(raw.newCardSteps[rating]) ? raw.newCardSteps[rating] : defaults[rating];
        out.newCardSteps[rating] = {
          v: finiteNumber(step.v, defaults[rating].v, 0.01, 36500),
          u: enumValue(step.u, new Set(["m", "h", "d"]), defaults[rating].u),
        };
      }
    }
    const hasValidFsrsWeights = Array.isArray(raw.fsrsWeights)
      ? raw.fsrsWeights.length === 17
        ? raw.fsrsWeights.every(value => {
            const weight = Number(value);
            return Number.isFinite(weight) ? (weight >= -1000 ? weight <= 1000 : false) : false;
          })
        : false
      : false;
    if (hasValidFsrsWeights) {
      out.fsrsWeights = raw.fsrsWeights.map(Number);
    } else {
      out.fsrsWeights = null;
    }
    out.aiModelCache = {};
    if (isRecord(raw.aiModelCache)) {
      for (const provider of PROVIDERS) {
        if (Array.isArray(raw.aiModelCache[provider])) out.aiModelCache[provider] = raw.aiModelCache[provider].slice(0, 200).map(v => cleanString(v, LIMITS.shortText)).filter(Boolean);
      }
    }

    function sanitizeHistoryValue(value, depth = 0) {
      if (depth > 8 || value == null) return value == null ? value : null;
      if (typeof value === "string") return cleanString(value);
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "boolean") return value;
      if (Array.isArray(value)) {
        return value.slice(0, 1000).map(item => sanitizeHistoryValue(item, depth + 1));
      }
      if (!isRecord(value)) return null;
      const result = {};
      for (const [key, item] of Object.entries(value).slice(0, 200)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        result[cleanString(key, LIMITS.shortText)] = sanitizeHistoryValue(item, depth + 1);
      }
      return result;
    }

    out.practiceHistory = Array.isArray(raw.practiceHistory)
      ? raw.practiceHistory.slice(0, LIMITS.practiceHistory).filter(isRecord).map(h => {
          const entry = sanitizeHistoryValue(h);
          entry.id = cleanId(h.id) || `history-${Math.random().toString(36).slice(2, 11)}`;
          entry.title = cleanString(h.title);
          entry.text = cleanString(h.text);
          entry.glossary = Array.isArray(h.glossary)
            ? h.glossary.slice(0, 100).filter(isRecord).map(g => ({
                ...sanitizeHistoryValue(g),
                word: cleanString(g.word, LIMITS.shortText),
                meaning: cleanString(g.meaning ?? g.translation),
              }))
            : [];
          entry.questions = Array.isArray(h.questions)
            ? h.questions.slice(0, 20).map(q => typeof q === "string"
                ? { q: cleanString(q, LIMITS.shortText), hint: "" }
                : isRecord(q) ? { q: cleanString(q.q ?? q.question, LIMITS.shortText), hint: cleanString(q.hint, LIMITS.shortText) } : null)
                .filter(q => q && q.q)
            : [];
          entry.words = Array.isArray(h.words)
            ? h.words.slice(0, 1000).map(w => typeof w === "string"
                ? cleanString(w, LIMITS.shortText)
                : sanitizeHistoryValue(w)).filter(Boolean)
            : [];
          entry.at = finiteNumber(h.at, Date.now(), 0, Number.MAX_SAFE_INTEGER, true);
          return entry;
        })
      : [];
    return out;
  }


  function sanitizeStudyCycles(raw, cardIds) {
    if (!isRecord(raw)) return {};
    const out = {};
    for (const [rawCardId, cycle] of Object.entries(raw).slice(0, LIMITS.cards)) {
      const cardId = cleanId(rawCardId);
      if (!cardIds.has(cardId) || !isRecord(cycle)) continue;
      const variants = Array.isArray(cycle.variants)
        ? cycle.variants.slice(0, 4).map(variant => {
            if (!isRecord(variant)) return null;
            const mode = enumValue(variant.mode, new Set(["word", "sentence"]), "");
            const front = enumValue(variant.front, new Set(["english", "local"]), "");
            return mode && front ? { mode, front } : null;
          }).filter(Boolean)
        : [];
      const index = finiteNumber(cycle.index, -1, 0, variants.length, true);
      const grades = Array.isArray(cycle.grades)
        ? cycle.grades.slice(0, 4).map(grade => finiteNumber(grade, -1, 0, 3, true)).filter(grade => grade >= 0)
        : [];
      if (variants.length < 1 || index < 0 || index >= variants.length || grades.length !== index) continue;
      out[cardId] = {
        variants,
        index,
        grades,
        updatedAt: finiteNumber(cycle.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER, true),
      };
    }
    return out;
  }

  function sanitizeHistoryMap(raw) {
    const history = {};
    if (!isRecord(raw)) return history;
    for (const [key, value] of Object.entries(raw).slice(0, LIMITS.historyDays)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord(value)) continue;
      history[key] = {};
      for (const field of ["reviewed", "again", "hard", "good", "easy"]) {
        history[key][field] = finiteNumber(value[field], 0, 0, 10000000, true);
      }
    }
    return history;
  }

  function sanitizeStreak(raw) {
    const streak = isRecord(raw) ? raw : {};
    return {
      current: finiteNumber(streak.current, 0, 0, 1000000, true),
      lastDay: typeof streak.lastDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(streak.lastDay) ? streak.lastDay : null,
    };
  }

  // One profile per learning language. Dangling references are dropped, never
  // repointed at the first deck, so a corrupt backup cannot silently move data.
  function sanitizeLanguageProfile(raw, code, { deckIdsByLanguage, cardIds }) {
    const profile = isRecord(raw) ? raw : {};
    const languageDeckIds = deckIdsByLanguage.get(code) || new Set();
    const activeDeckId = cleanId(profile.activeDeckId);
    return {
      activeDeckId: languageDeckIds.has(activeDeckId) ? activeDeckId : null,
      history: sanitizeHistoryMap(profile.history),
      streak: sanitizeStreak(profile.streak),
      sessionReviewedIds: Array.isArray(profile.sessionReviewedIds)
        ? profile.sessionReviewedIds.map(cleanId).filter(id => cardIds.has(id)).slice(0, LIMITS.cards)
        : [],
      practiceDraft: isRecord(profile.practiceDraft) ? profile.practiceDraft : null,
      studyResume: isRecord(profile.studyResume) ? profile.studyResume : null,
    };
  }

  function sanitizeFullState(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.decks) || !Array.isArray(raw.cards) || raw.decks.length > LIMITS.decks || raw.cards.length > LIMITS.cards) return null;
    const usedDeckIds = new Set();
    const decks = raw.decks.map(d => sanitizeDeck(d, usedDeckIds)).filter(Boolean);
    if (!decks.length && raw.cards.length) return null;
    const deckIds = new Set(decks.map(d => d.id));
    const usedCardIds = new Set();
    const cards = raw.cards.map(c => sanitizeCard(c, deckIds, usedCardIds, decks[0]?.id || "")).filter(Boolean);
    const cardsById = new Map(cards.map(card => [card.id, card]));
    for (const card of cards) {
      if (!card.linkedCardId) continue;
      const linkedCard = cardsById.get(card.linkedCardId);
      if (!linkedCard || linkedCard.deckId !== card.deckId || linkedCard.id === card.id) {
        delete card.linkedCardId;
      }
    }
    const deckIdsByLanguage = new Map();
    for (const code of LEARNING_LANGUAGES) deckIdsByLanguage.set(code, new Set());
    for (const deck of decks) deckIdsByLanguage.get(deck.learningLanguage).add(deck.id);

    // Legacy backups carry a single flat profile; it always belongs to English.
    const rawProfiles = isRecord(raw.languageProfiles) ? raw.languageProfiles : null;
    const legacyProfile = {
      activeDeckId: raw.activeDeckId,
      history: raw.history,
      streak: raw.streak,
      sessionReviewedIds: raw.sessionReviewedIds,
      practiceDraft: raw.practiceDraft,
      studyResume: raw.studyResume,
    };
    const languageProfiles = {};
    for (const code of LEARNING_LANGUAGES) {
      const source = rawProfiles
        ? rawProfiles[code]
        : (code === DEFAULT_LEARNING_LANGUAGE ? legacyProfile : null);
      languageProfiles[code] = sanitizeLanguageProfile(source, code, {
        deckIdsByLanguage,
        cardIds: usedCardIds,
      });
    }

    const activeLearningLanguage = learningLanguage(raw.activeLearningLanguage);
    const activeProfile = languageProfiles[activeLearningLanguage];
    return {
      dataModelVersion: 2,
      activeLearningLanguage,
      languageProfiles,
      decks,
      cards,
      activeDeckId: activeProfile.activeDeckId,
      settings: sanitizeSettings(raw.settings),
      history: activeProfile.history,
      streak: activeProfile.streak,
      sessionReviewedIds: activeProfile.sessionReviewedIds,
      practiceDraft: activeProfile.practiceDraft,
      studyResume: activeProfile.studyResume,
      studyCycles: sanitizeStudyCycles(raw.studyCycles, usedCardIds),
      revision: finiteNumber(raw.revision, 0, 0, Number.MAX_SAFE_INTEGER, true),
      updatedAt: finiteNumber(raw.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER, true),
    };
  }

  function sanitizeDeckContent(raw) {
    if (!isRecord(raw) || typeof raw.name !== "string" || !Array.isArray(raw.cards)
      || raw.cards.length > LIMITS.cards || raw.cards.some(card => !isRecord(card))) return null;
    // A deck export keeps its language when it is known; an unlabeled legacy
    // deck stays null so the import flow can ask the user explicitly.
    const languageCode = typeof raw.learningLanguage === "string"
      && languageCodeList().includes(raw.learningLanguage)
      ? raw.learningLanguage
      : null;
    return {
      name: cleanString(raw.name, LIMITS.shortText) || "Imported",
      desc: cleanString(raw.desc),
      learningLanguage: languageCode,
      direction: enumValue(raw.direction, DIRECTIONS, "forward"),
      cards: raw.cards.map(card => {
        if (!isRecord(card)) return null;
        const type = enumValue(card.type, CARD_TYPES, "basic");
        return {
          type,
          front: cleanString(card.front),
          back: cleanString(card.back),
          cloze: type === "cloze" ? cleanString(card.cloze) : "",
          hint: cleanString(card.hint),
          example: cleanString(card.example),
          exampleSentence: cleanString(card.exampleSentence),
          exampleTranslation: cleanString(card.exampleTranslation),
          exampleTargetTerm: cleanString(card.exampleTargetTerm),
          info: cleanString(card.info),
        };
      }).filter(Boolean),
    };
  }

  function buildDeckExport(rawDeck) {
    const deck = sanitizeDeckContent(rawDeck);
    if (!deck) throw new TypeError("Invalid deck");
    return JSON.stringify({
      app: CONFIG.app,
      format: CONFIG.format,
      kind: "deck",
      exportedAt: new Date().toISOString(),
      deck,
    }, null, 2);
  }

  function sanitizeLegacyDecks(rawDecks) {
    if (!Array.isArray(rawDecks) || rawDecks.length > LIMITS.decks) return null;
    return rawDecks.filter(isRecord).map(raw => sanitizeDeckContent({
      ...raw,
      name: cleanString(raw.name, LIMITS.shortText) || "Imported",
      cards: Array.isArray(raw.cards) ? raw.cards.filter(isRecord) : [],
    })).filter(Boolean);
  }

  function sanitizeReviewEvents(raw, state) {
    if (!Array.isArray(raw)) return [];
    const cardIds = new Set(state.cards.map(card => card.id));
    const deckIds = new Set(state.decks.map(deck => deck.id));
    const used = new Set();
    return raw.slice(0, 200000).map(event => {
      if (!isRecord(event)) return null;
      const id = cleanId(event.id);
      const cardId = cleanId(event.cardId);
      const deckId = cleanId(event.deckId);
      const grade = finiteNumber(event.grade, -1, 0, 3, true);
      if (!id || used.has(id) || !cardIds.has(cardId) || !deckIds.has(deckId) || grade < 0) return null;
      used.add(id);
      return {
        id, cardId, deckId, grade,
        state: enumValue(event.state, CARD_STATES, "review"),
        due: finiteNumber(event.due, 0, 0, Number.MAX_SAFE_INTEGER, true),
        at: finiteNumber(event.at, 0, 0, Number.MAX_SAFE_INTEGER, true),
      };
    }).filter(Boolean);
  }

  function sanitizePracticeDraft(raw, state) {
    if (!isRecord(raw)) return null;
    const cardIds = new Set(state.cards.map(card => card.id));
    const deckIds = new Set(state.decks.map(deck => deck.id));
    const payload = isRecord(raw.payload) ? raw.payload : {};
    const feedback = isRecord(raw.feedback) ? raw.feedback : null;
    return {
      step: enumValue(raw.step, new Set(["setup", "run", "result"]), "setup"),
      period: enumValue(raw.period, new Set(["last", "days", "all"]), "last"),
      selectedIds: Array.isArray(raw.selectedIds) ? [...new Set(raw.selectedIds.map(cleanId).filter(id => cardIds.has(id)))].slice(0, 1000) : [],
      deckId: deckIds.has(cleanId(raw.deckId)) ? cleanId(raw.deckId) : "",
      count: cleanString(String(raw.count ?? "8"), 8),
      level: enumValue(raw.level, new Set(["auto", "A1", "A2", "B1", "B2", "C1"]), "auto"),
      format: enumValue(raw.format, new Set(["story", "dialogue", "article"]), "story"),
      words: Array.isArray(raw.words) ? raw.words.slice(0, 1000).filter(isRecord).map(word => ({
        front: cleanString(word.front, LIMITS.shortText),
        back: cleanString(word.back, LIMITS.shortText),
      })) : [],
      payload: {
        title: cleanString(payload.title),
        text: cleanString(payload.text || payload.story),
        glossary: Array.isArray(payload.glossary) ? payload.glossary.slice(0, 100).filter(isRecord).map(item => ({
          word: cleanString(item.word, LIMITS.shortText),
          meaning: cleanString(item.meaning ?? item.translation),
        })) : [],
        questions: Array.isArray(payload.questions) ? payload.questions.slice(0, 20).map(item => isRecord(item) ? ({
          q: cleanString(item.q || item.question),
          hint: cleanString(item.hint),
        }) : null).filter(item => item?.q) : [],
      },
      answers: Array.isArray(raw.answers) ? raw.answers.slice(0, 20).map(value => cleanString(value)) : [],
      feedback: feedback ? JSON.parse(JSON.stringify(feedback, (key, value) =>
        typeof value === "string" ? cleanString(value) : value
      )) : null,
      revision: finiteNumber(raw.revision, 0, 0, Number.MAX_SAFE_INTEGER, true),
      practiceDays: finiteNumber(raw.practiceDays, 7, 1, 180, true),
      updatedAt: finiteNumber(raw.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER, true),
    };
  }

  function sanitizeSettingsForExport(raw) {
    return sanitizeSettings(raw, { includeSecrets: false });
  }

  function buildFullExport(snapshot, { includeSecrets = true } = {}) {
    if (!isRecord(snapshot)) throw new TypeError("Invalid storage snapshot");
    const state = sanitizeFullState(snapshot.state);
    if (!state) throw new TypeError("Invalid application state");
    state.settings = sanitizeSettings(snapshot.state.settings, { includeSecrets });

    // Format 3 keeps every draft inside its own language profile; the active
    // language additionally mirrors it so an older reader still sees a draft.
    const activeDraft = snapshot.practiceDraft ?? state.practiceDraft;
    if (activeDraft && !state.languageProfiles[state.activeLearningLanguage].practiceDraft) {
      state.languageProfiles[state.activeLearningLanguage].practiceDraft = activeDraft;
    }
    for (const code of LEARNING_LANGUAGES) {
      const profile = state.languageProfiles[code];
      profile.practiceDraft = sanitizePracticeDraft(profile.practiceDraft, state);
    }
    state.practiceDraft = state.languageProfiles[state.activeLearningLanguage].practiceDraft;

    const payload = {
      app: CONFIG.app,
      format: CONFIG.format,
      kind: "full",
      exportedAt: new Date().toISOString(),
      metadata: { secretsIncluded: includeSecrets === true },
      state,
      reviewEvents: sanitizeReviewEvents(snapshot.reviewEvents, state),
      practiceDraft: state.practiceDraft,
    };
    const text = JSON.stringify(payload, null, 2);
    const secret = typeof snapshot.state.settings?.aiKey === "string" ? snapshot.state.settings.aiKey : "";
    if (!includeSecrets && secret && text.includes(secret)) throw new Error("Secret leaked into backup");
    return text;
  }

  function buildExport(state) {
    return buildFullExport({ state, reviewEvents: [], practiceDraft: state?.practiceDraft || null });
  }

  function filename(dateKey) {
    const key = dateKey || new Date().toISOString().slice(0, 10);
    return `${CONFIG.fileBase}-backup-${key}.json`;
  }

  function fullResult(rawState, extra = {}) {
    const secretPresent = isRecord(rawState?.settings) && Object.prototype.hasOwnProperty.call(rawState.settings, "aiKey");
    const state = sanitizeFullState(rawState);
    if (!state) return { kind: "error", reason: "invalid-data" };
    return { kind: "full", state, secretPresent, ...extra };
  }

  // Format 3 is a contract, not a migration: reject broken relationships before
  // any sanitizer can replace identifiers, languages, or destinations.
  function validateFormat3(data) {
    const state = data.state;
    const fail = detail => ({ kind: "error", reason: "invalid-data", detail });
    if (!isRecord(state) || !Array.isArray(state.decks) || !Array.isArray(state.cards)
      || state.decks.length > LIMITS.decks || state.cards.length > LIMITS.cards
      || !LEARNING_LANGUAGES.has(state.activeLearningLanguage)
      || !isRecord(state.languageProfiles)) return fail("state");
    const decks = new Map();
    const cards = new Map();
    for (const deck of state.decks) {
      if (!isRecord(deck) || !cleanId(deck.id) || cleanId(deck.id) !== deck.id
        || decks.has(deck.id) || !LEARNING_LANGUAGES.has(deck.learningLanguage)) return fail("decks");
      decks.set(deck.id, deck);
    }
    for (const card of state.cards) {
      if (!isRecord(card) || !cleanId(card.id) || cleanId(card.id) !== card.id
        || cards.has(card.id) || !decks.has(card.deckId)) return fail("cards");
      cards.set(card.id, card);
    }
    const deckIn = (id, code) => decks.get(id)?.learningLanguage === code;
    const cardIn = (id, code) => cards.has(id) && deckIn(cards.get(id).deckId, code);
    const idsIn = (ids, code) => Array.isArray(ids) && ids.length <= LIMITS.cards
      && new Set(ids).size === ids.length && ids.every(id => cardIn(id, code));
    const optionalDeck = (id, code) => id == null || id === "" || deckIn(id, code);
    const referencesValid = (value, code) => {
      if (!isRecord(value)) return false;
      if (value.learningLanguage != null && value.learningLanguage !== code) return false;
      if (!optionalDeck(value.deckId, code)) return false;
      if (value.cardId != null && !cardIn(value.cardId, code)) return false;
      if (value.currentId != null && (!cardIn(value.currentId, code)
        || (value.deckId && cards.get(value.currentId).deckId !== value.deckId))) return false;
      return value.selectedIds == null || idsIn(value.selectedIds, code);
    };
    for (const card of cards.values()) {
      if (card.learningLanguage != null && card.learningLanguage !== decks.get(card.deckId).learningLanguage) return fail("cards.language");
      if (card.linkedCardId != null && (!cards.has(card.linkedCardId)
        || card.linkedCardId === card.id || cards.get(card.linkedCardId).deckId !== card.deckId)) return fail("cards.linkedCardId");
    }
    if (Object.keys(state.languageProfiles).some(code => !LEARNING_LANGUAGES.has(code))) return fail("languageProfiles.language");
    for (const code of LEARNING_LANGUAGES) {
      const profile = state.languageProfiles[code];
      if (!isRecord(profile) || !optionalDeck(profile.activeDeckId, code)
        || !idsIn(profile.sessionReviewedIds, code)) return fail(`languageProfiles.${code}`);
      if (!isRecord(profile.history) || Object.entries(profile.history).some(([day, value]) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRecord(value)
        || Object.values(value).some(n => !Number.isSafeInteger(n) || n < 0))) return fail(`languageProfiles.${code}.history`);
      if (!isRecord(profile.streak) || !Number.isSafeInteger(profile.streak.current) || profile.streak.current < 0
        || (profile.streak.lastDay != null && !/^\d{4}-\d{2}-\d{2}$/.test(profile.streak.lastDay))) return fail(`languageProfiles.${code}.streak`);
      if (profile.studyResume != null && !referencesValid(profile.studyResume, code)) return fail(`languageProfiles.${code}.studyResume`);
      const draft = profile.practiceDraft;
      if (draft != null) {
        if (!referencesValid(draft, code)
          || !["setup", "run", "result"].includes(draft.step)
          || !["last", "days", "all"].includes(draft.period)
          || !idsIn(draft.selectedIds, code)
          || (draft.payload != null && !isRecord(draft.payload))
          || (draft.feedback != null && !isRecord(draft.feedback))
          || (draft.answers != null && (!Array.isArray(draft.answers) || draft.answers.some(answer => typeof answer !== "string")))
          || (draft.words != null && (!Array.isArray(draft.words) || draft.words.some(word => !isRecord(word))))) return fail(`languageProfiles.${code}.practiceDraft`);
      }
    }
    if (state.studyCycles != null) {
      if (!isRecord(state.studyCycles)) return fail("studyCycles");
      for (const [id, cycle] of Object.entries(state.studyCycles)) {
        if (!cards.has(id) || !isRecord(cycle) || !Array.isArray(cycle.variants)
          || cycle.variants.length < 1 || cycle.variants.length > 4
          || cycle.variants.some(v => !isRecord(v) || !["word", "sentence"].includes(v.mode) || !["english", "local"].includes(v.front))
          || !Number.isInteger(cycle.index) || cycle.index < 0 || cycle.index >= cycle.variants.length
          || !Array.isArray(cycle.grades) || cycle.grades.length !== cycle.index
          || cycle.grades.some(g => !Number.isInteger(g) || g < 0 || g > 3)) return fail("studyCycles");
      }
    }
    if (data.reviewEvents != null) {
      if (!Array.isArray(data.reviewEvents) || data.reviewEvents.length > 200000) return fail("reviewEvents");
      const used = new Set();
      for (const event of data.reviewEvents) {
        if (!isRecord(event) || !cleanId(event.id) || cleanId(event.id) !== event.id || used.has(event.id)
          || !cards.has(event.cardId) || cards.get(event.cardId).deckId !== event.deckId
          || (event.learningLanguage != null && !deckIn(event.deckId, event.learningLanguage))
          || !Number.isInteger(event.grade) || event.grade < 0 || event.grade > 3) return fail("reviewEvents");
        used.add(event.id);
      }
    }
    const history = state.settings?.practiceHistory;
    if (history != null && (!Array.isArray(history) || history.some(entry =>
      !referencesValid(entry, entry?.learningLanguage || "en") || !LEARNING_LANGUAGES.has(entry?.learningLanguage || "en")))) return fail("practiceHistory");
    return null;
  }

  function parse(text, options = {}) {
    if (typeof text !== "string" || text.length > 100 * 1024 * 1024) return { kind: "error", reason: "invalid-data" };
    let data;
    try { data = JSON.parse(text); }
    catch (_) { return { kind: "error", reason: "invalid-data" }; }

    if (isRecord(data) && data.app === CONFIG.app) {
      if (!Number.isInteger(data.format) || !SUPPORTED_FORMATS.includes(data.format)) return { kind: "error", reason: "unsupported-version" };
      if (data.format === 2 || data.format === 3) {
        if (data.kind !== "full" && data.kind !== "deck") return { kind: "error", reason: "wrong-kind" };
        if (data.kind === "deck") {
          if (data.format === 3 && data.deck?.learningLanguage != null
            && !LEARNING_LANGUAGES.has(data.deck.learningLanguage)) return { kind: "error", reason: "invalid-data" };
          const deck = sanitizeDeckContent(data.deck);
          return deck ? { kind: "deck", deck, format: data.format } : { kind: "error", reason: "invalid-data" };
        }
        if (!isRecord(data.metadata) || typeof data.metadata.secretsIncluded !== "boolean") {
          return { kind: "error", reason: "invalid-data" };
        }
        if (data.format === 3) {
          const error = validateFormat3(data);
          if (error) return error;
        }
        // Format 3 keeps drafts inside language profiles only. Older formats
        // carry a single flat draft in the envelope; it belongs to English and
        // is migrated into that profile before sanitizing, so the restored
        // state never depends on a second, independently mutable copy.
        let rawState = data.state;
        if (data.format !== 3 && isRecord(rawState) && isRecord(data.practiceDraft)
          && rawState.practiceDraft == null && !isRecord(rawState.languageProfiles)) {
          rawState = { ...rawState, practiceDraft: data.practiceDraft };
        }
        const result = fullResult(rawState, { reviewEvents: data.reviewEvents, format: data.format });
        if (result.kind !== "full") return result;
        result.reviewEvents = sanitizeReviewEvents(data.reviewEvents, result.state);
        for (const code of LEARNING_LANGUAGES) {
          const profile = result.state.languageProfiles[code];
          profile.practiceDraft = sanitizePracticeDraft(profile.practiceDraft, result.state);
        }
        result.state.practiceDraft = result.state.languageProfiles[result.state.activeLearningLanguage].practiceDraft;
        result.practiceDraft = result.state.practiceDraft;
        result.secretPresent = false;
        if (data.metadata.secretsIncluded === true) {
          if (isRecord(data.state?.settings)) {
            result.secretPresent = Object.prototype.hasOwnProperty.call(data.state.settings, "aiKey");
          }
        }
        return result;
      }
      if (data.kind && data.kind !== "full") return { kind: "error", reason: "wrong-kind" };
      const legacy = fullResult(data.state, { format: 1 });
      if (legacy.kind === "full" && legacy.secretPresent && options.allowLegacySecret !== true) {
        return { kind: "error", reason: "secret-confirmation-required", pending: legacy };
      }
      return legacy;
    }
    if (isRecord(data) && Array.isArray(data.decks) && Array.isArray(data.cards)) {
      const legacy = fullResult(data, { format: 0 });
      if (legacy.kind === "full" && legacy.secretPresent && options.allowLegacySecret !== true) {
        return { kind: "error", reason: "secret-confirmation-required", pending: legacy };
      }
      return legacy;
    }
    if (Array.isArray(data)) {
      const decks = sanitizeLegacyDecks(data);
      return decks ? { kind: "decks", decks } : { kind: "error", reason: "invalid-data" };
    }
    return { kind: "error", reason: "invalid-data" };
  }

  window.LCBackup = {
    buildExport, buildFullExport, buildDeckExport, filename, parse, sanitizeSettingsForExport,
    sanitizeDeckContent, sanitizeReviewEvents, sanitizePracticeDraft, CONFIG,
  };
})();
