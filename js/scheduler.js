/* Lingo Cards — Review undo, scheduling algorithms, queue and streak */

/* ----- Undo stack (in-memory, capped) ----- */
const UNDO_MAX = 50;
let undoStack = [];

function pushUndo(card) {
  const dk = todayKey();
  const entry = {
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    historyKey: dk,
    historySnapshot: state.history[dk] ? JSON.parse(JSON.stringify(state.history[dk])) : null,
    streakSnapshot: JSON.parse(JSON.stringify(state.streak)),
    // Analysis fix #4: enough data to restore the study cycle and to remove
    // the recorded review event when the answer is undone.
    studyCycleSnapshot: state.studyCycles?.[card.id]
      ? JSON.parse(JSON.stringify(state.studyCycles[card.id]))
      : null,
    sessionVariantState: session?.currentId === card.id &&
        Array.isArray(session.currentCardVariants) && session.currentCardVariants.length
      ? {
          variants: session.currentCardVariants.map(variant => ({ ...variant })),
          index: session.currentCardVariantIndex,
          // Pre-answer grades only: the grade being undone was already pushed
          // onto the session by advanceStudyCardVariant before scheduling.
          grades: (session.currentCardGrades || []).slice(0, session.currentCardVariantIndex || 0),
        }
      : null,
    reviewEventId: null,
    ts: Date.now(),
  };
  undoStack.push(entry);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoBtn();
  return entry;
}

function undo() {
  if (undoStack.length === 0) { toast(t("study.noUndo")); return; }
  const entry = undoStack.pop();
  let card = getCardById(entry.cardId);
  if (card) {
    // Analysis fix #4: restore the exact pre-answer snapshot — fields that
    // appeared after the snapshot (e.g. a first-created fsrs model) must be
    // removed instead of surviving Object.assign.
    for (const key of Object.keys(card)) {
      if (!(key in entry.cardSnapshot)) delete card[key];
    }
    Object.assign(card, entry.cardSnapshot);
  } else {
    card = entry.cardSnapshot;
    state.cards.push(card);
    cardById.set(card.id, card);
    if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
    cardsByDeck.get(card.deckId).push(card);
  }
  markCardDirty(card);
  // Analysis fix #4: drop the recorded review event so the journal matches
  // the undone answer and difficulty recalculation cannot re-count it.
  if (entry.reviewEventId) window.LCStorage?.deleteReviewEventsByIds?.([entry.reviewEventId]);
  if (Array.isArray(state.sessionReviewedIds)) {
    state.sessionReviewedIds = state.sessionReviewedIds.filter(id => id !== entry.cardId);
  }
  // Restore the study cycle the card was in before the answer.
  const cycle = entry.studyCycleSnapshot
    || (entry.sessionVariantState && entry.sessionVariantState.index > 0
      ? {
          variants: entry.sessionVariantState.variants,
          index: entry.sessionVariantState.index,
          grades: entry.sessionVariantState.grades,
          updatedAt: Date.now(),
        }
      : null);
  if (cycle) {
    if (!state.studyCycles || typeof state.studyCycles !== "object") state.studyCycles = {};
    state.studyCycles[card.id] = JSON.parse(JSON.stringify(cycle));
  } else {
    clearStudyCycle(card.id);
  }
  if (entry.historySnapshot == null) delete state.history[entry.historyKey];
  else state.history[entry.historyKey] = entry.historySnapshot;
  state.streak = entry.streakSnapshot;
  markMetaDirty();
  // Put the card back to the front of the active queue and show it answered.
  if (session) {
    compactStudyQueue(true);
    session.queue.splice(session.queueHead || 0, 0, {
      id: entry.cardId,
      variantState: entry.sessionVariantState || undefined,
    });
    session.queuedIds?.add(entry.cardId);
    session.currentId = entry.cardId;
    if (entry.sessionVariantState) {
      restoreStudyCardVariant({ id: entry.cardId, variantState: entry.sessionVariantState });
    } else {
      session.currentCardMode = chooseStudyCardMode();
      session.currentCardFront = chooseStudyCardFront();
    }
    session.revealed = true;
  }
  save();
  $("#streakDays").textContent = state.streak.current || 0;
  renderStudy();
  updateUndoBtn();
  toast(t("study.undone.toast"));
}

function undoReview() {
  undo();
}

function updateUndoBtn() {
  const b = $("#undoBtn");
  if (!b) return;
  // Never fully dead: tapping with an empty stack still gives feedback
  // (undo() shows the "nothing to undo" toast) — important on touch screens
  // where a disabled 24px button just feels broken.
  const disabled = undoStack.length === 0;
  if (b.removeAttribute) b.removeAttribute("disabled");
  if (b.setAttribute) b.setAttribute("aria-disabled", disabled ? "true" : "false");
  if (b.classList) b.classList.toggle("is-disabled", disabled);
}

/* ----- Anki-style sequential learning steps ----- */
const MINUTE_MS = 60 * 1000;

function normalizeLearningSteps(steps) {
  const source = Array.isArray(steps) ? steps : [];
  const normalized = source
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => Math.min(525600, Math.max(0.01, value)));
  return normalized.length ? normalized : [1, 10];
}

function legacyStepToMinutes(step) {
  if (!step || typeof step !== "object") return null;
  const value = Number(step.v);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (step.u === "d") return value * 1440;
  if (step.u === "h") return value * 60;
  return value;
}

function migrateSchedulingSettings(s) {
  delete s.presets;
  if (!s.studyQueue || typeof s.studyQueue !== "object") {
    s.studyQueue = { new: true, learning: true, review: true };
  } else {
    s.studyQueue = {
      new: s.studyQueue.new !== false,
      learning: s.studyQueue.learning !== false,
      review: s.studyQueue.review !== false,
    };
  }

  const legacySteps = s.newCardSteps && typeof s.newCardSteps === "object"
    ? [
        legacyStepToMinutes(s.newCardSteps.again),
        legacyStepToMinutes(s.newCardSteps.good),
      ].filter(value => value != null && value < 1440)
    : null;
  const storedSteps = legacySteps?.length ? legacySteps : s.learnSteps;
  s.learnSteps = normalizeLearningSteps(storedSteps);
  s.relearnSteps = normalizeLearningSteps(s.relearnSteps || [10]);
  s.easyInterval = Math.max(
    1,
    Math.round(Number(s.easyInterval) || (
      s.newCardSteps?.easy?.u === "d" ? Number(s.newCardSteps.easy.v) : 4
    ) || 4),
  );
  delete s.newCardSteps;
}

function learningStepMs(steps, index) {
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), steps.length - 1);
  return steps[safeIndex] * MINUTE_MS;
}

function hardLearningDelayMs(steps, index) {
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), steps.length - 1);
  // On a single step, Hard waits 1.5 times as long without advancing.
  const minutes = steps.length === 1 ? steps[0] * 1.5
    : safeIndex === 0 ? (steps[0] + steps[1]) / 2 : steps[safeIndex];
  return Math.max(MINUTE_MS, minutes * MINUTE_MS);
}

function sm2GoodBaseInterval(card, settings, ease = card.ease) {
  return Math.max(card.interval + 1,
    Math.round(card.interval * (ease / 100) * (settings.intervalModifier / 100)));
}

function sm2HardCeiling(card, settings, ease) {
  // Even the longest fuzzed Hard must precede the shortest fuzzed Good.
  return Math.max(1, Math.min(365 * 5, sm2FuzzRange(sm2GoodBaseInterval(card, settings, ease)).min) - 1);
}

function sm2FuzzRange(interval) {
  const days = Math.max(1, Math.round(Number(interval) || 1));
  if (days <= 2) return { min: days, max: days };
  let delta;
  if (days <= 7) delta = 1;
  else if (days <= 30) delta = Math.max(2, Math.round(days * 0.15));
  else delta = Math.max(4, Math.round(days * 0.05));
  return { min: Math.max(1, days - delta), max: days + delta };
}

function fuzzSm2Interval(interval, random = Math.random) {
  const range = sm2FuzzRange(interval);
  if (range.min === range.max) return range.min;
  return range.min + Math.floor(random() * (range.max - range.min + 1));
}

/* ----- SM-2-ish scheduler with Anki-style learning steps ----- */
function scheduleAnswerSM2(card, grade) {
  const s = state.settings;
  const now = Date.now();
  const useFsrs = s.algorithm === "fsrs" && window.FSRS;
  const steps = normalizeLearningSteps(card.relearnInterval > 0 && !useFsrs
    ? s.relearnSteps || [10] : s.learnSteps);
  // Analysis fix #1: under FSRS the memory model is computed from the first
  // answer and kept on the card; the short steps only decide WHEN the card is
  // shown next. Under SM-2 the model is invalidated instead.
  if (!useFsrs) delete card.fsrs;

  if (card.state === "new" || card.state === "learning") {
    if (useFsrs) window.FSRS.updateMemoryState(card, grade + 1, undefined, s, now);
    if (card.state === "new") {
      card.step = 0;
      if (!card.ease) card.ease = s.startingEase;
    }
    card.step = Math.min(Math.max(0, Number(card.step) || 0), steps.length - 1);
    const graduate = days => {
      card.state = "review";
      card.step = 0;
      card.interval = Math.max(1, Math.round(days));
      delete card.relearnInterval;
      card.due = now + card.interval * DAY_MS;
    };

    if (grade === 0) {
      card.state = "learning";
      card.step = 0;
      card.due = now + learningStepMs(steps, 0);
    } else if (grade === 1) {
      card.state = "learning";
      card.due = now + hardLearningDelayMs(steps, card.step);
    } else if (grade === 2) {
      const nextStep = card.step + 1;
      if (nextStep < steps.length) {
        card.state = "learning";
        card.step = nextStep;
        card.due = now + learningStepMs(steps, nextStep);
      } else {
        graduate(useFsrs
          ? window.FSRS.graduatingInterval(card, s)
          : card.relearnInterval || s.graduatingInterval);
      }
    } else if (grade === 3) {
      card.ease += s.easyEaseBoost;
      graduate(useFsrs
        ? window.FSRS.graduatingInterval(card, s)
        : card.relearnInterval || s.easyInterval);
    }
  } else if (card.state === "review") {
    if (grade === 0) {
      card.lapses += 1;
      card.ease = Math.max(130, card.ease - s.lapseEasePenalty);
      card.relearnInterval = s.lapseNewInterval > 0
        ? fuzzSm2Interval(Math.max(1, Math.round(card.interval * (s.lapseNewInterval / 100))))
        : 1;
      card.state = "learning";
      card.step = 0;
      card.due = now + learningStepMs(normalizeLearningSteps(s.relearnSteps || [10]), 0);
    } else {
      const mod = s.intervalModifier / 100;
      const previousEase = card.ease;
      let baseInterval;
      if (grade === 1) {
        card.ease = Math.max(130, previousEase - s.hardEasePenalty);
        baseInterval = Math.max(1, Math.round(card.interval * (s.hardFactor / 100) * mod));
      } else if (grade === 2) {
        baseInterval = sm2GoodBaseInterval(card, s);
      } else {
        baseInterval = Math.max(
          card.interval + 1,
          Math.round(card.interval * (previousEase / 100) * (s.easyBonus / 100) * mod),
        );
        card.ease = previousEase + s.easyEaseBoost;
      }
      card.interval = Math.min(fuzzSm2Interval(baseInterval),
        grade === 1 ? sm2HardCeiling(card, s, previousEase) : 365 * 5);
      card.due = now + card.interval * DAY_MS;
    }
  }
}

/* ----- SM-2-ish scheduler ----- */
function scheduleAnswer(card, grade) {
  const s = state.settings;
  const now = Date.now();
  const undoEntry = pushUndo(card);

  // Dispatch before incrementing reps so a legacy SM-2 review card is migrated
  // into FSRS from the persisted pre-answer memory state. Any real SM-2 answer
  // invalidates FSRS memory so a later switch back rebuilds it from current
  // interval/ease/reps/lapses instead of reusing a stale snapshot.
  // Analysis fix #1: under FSRS new/learning cards also run the FSRS memory
  // update (inside scheduleAnswerSM2) instead of dropping the model.
  if (card.state === "new" || card.state === "learning") {
    scheduleAnswerSM2(card, grade);
  } else if (s.algorithm === "fsrs" && window.FSRS) {
    window.FSRS.schedule(card, grade + 1, s);
  } else {
    scheduleAnswerSM2(card, grade);
    delete card.fsrs;
  }

  card.reps = Math.max(0, Number(card.reps) || 0) + 1;

  // History bookkeeping
  const dk = todayKey();
  state.history[dk] = state.history[dk] || { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
  state.history[dk].reviewed += 1;
  state.history[dk][["again", "hard", "good", "easy"][grade]] += 1;

  card.lastReview = now;
  const reviewEvent = recordReviewEvent(card, grade, now);
  if (undoEntry) undoEntry.reviewEventId = reviewEvent.id;
  updateCardDifficulty(card, reviewEvent, now);
  markCardDirty(card);
  markMetaDirty();

  // Leech detection
  if (s.leechThreshold > 0 && card.lapses >= s.leechThreshold && card.state !== "suspended") {
    suspendCard(card);
    toast(t("study.leech.toast"));
  }
}

/* Preview intervals for the grade buttons */
function previewIntervals(card) {
  const s = state.settings;
  const fmt = ms => {
    if (ms < 60000) return "<1m";
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}m`;
    if (ms < DAY_MS) return `${Math.round(ms / (60 * 60 * 1000))}h`;
    const d = Math.round(ms / DAY_MS);
    if (d < 30) return `${d}d`;
    if (d < 365) return `${Math.round(d / 30)}mo`;
    return `${(d / 365).toFixed(1)}y`;
  };
  const result = { again: "", hard: "", good: "", easy: "" };
  const steps = normalizeLearningSteps(card.relearnInterval > 0 && !(s.algorithm === "fsrs" && window.FSRS)
    ? s.relearnSteps || [10] : s.learnSteps);
  const fmtFuzzedDays = days => {
    const range = sm2FuzzRange(days);
    return range.min === range.max
      ? fmt(range.min * DAY_MS)
      : `${fmt(range.min * DAY_MS)}–${fmt(range.max * DAY_MS)}`;
  };
  if (card.state === "new" || card.state === "learning") {
    const step = Math.min(Math.max(0, Number(card.step) || 0), steps.length - 1);
    const useFsrs = s.algorithm === "fsrs" && window.FSRS;
    // Under FSRS graduation no longer uses the fixed settings: preview the
    // interval the memory model will actually produce for Good / Easy.
    const graduationPreview = rating => {
      if (!useFsrs) return null;
      const clone = JSON.parse(JSON.stringify(card));
      window.FSRS.updateMemoryState(clone, rating, undefined, s, Date.now());
      return window.FSRS.graduatingInterval(clone, s);
    };
    result.again = fmt(learningStepMs(steps, 0));
    result.hard = fmt(hardLearningDelayMs(steps, step));
    result.good = step + 1 < steps.length
      ? fmt(learningStepMs(steps, step + 1))
      : fmt(((useFsrs ? graduationPreview(3) : card.relearnInterval) || s.graduatingInterval) * DAY_MS);
    result.easy = fmt(((useFsrs ? graduationPreview(4) : card.relearnInterval) || s.easyInterval) * DAY_MS);
    return result;
  }
  if (s.algorithm === "fsrs" && window.FSRS) {
    return window.FSRS.previewIntervals(card, s);
  }
  const mod = s.intervalModifier / 100;
  result.again = fmt(learningStepMs(normalizeLearningSteps(s.relearnSteps || [10]), 0));
  const hardRange = sm2FuzzRange(Math.max(1, Math.round(card.interval * (s.hardFactor / 100) * mod)));
  const hardCeiling = sm2HardCeiling(card, s, card.ease);
  result.hard = hardRange.min === hardRange.max || hardRange.min >= hardCeiling
    ? fmt(Math.min(hardRange.min, hardCeiling) * DAY_MS)
    : `${fmt(hardRange.min * DAY_MS)}–${fmt(Math.min(hardRange.max, hardCeiling) * DAY_MS)}`;
  result.good = fmtFuzzedDays(sm2GoodBaseInterval(card, s));
  result.easy = fmtFuzzedDays(
    Math.max(card.interval + 1, Math.round(card.interval * (card.ease / 100) * (s.easyBonus / 100) * mod)),
  );
  return result;
}

/* ----- Queue building ----- */
const STUDY_QUEUE_COMPACT_MIN = 256;
const STUDY_QUEUE_BATCH_SIZE = 50;

function studyQueueLength() {
  if (!session) return 0;
  return Math.max(0, session.queue.length - (session.queueHead || 0));
}

function compactStudyQueue(force = false) {
  if (!session) return;
  const head = session.queueHead || 0;
  if (head === 0) return;
  if (!force && head < STUDY_QUEUE_COMPACT_MIN && head * 2 < session.queue.length) return;
  session.queue = session.queue.slice(head);
  session.queueHead = 0;
}

function activeStudyQueueEntries() {
  return session ? session.queue.slice(session.queueHead || 0) : [];
}

function chooseStudyCardMode() {
  const modes = state?.settings?.studyCardModes;
  const available = Array.isArray(modes) && modes.length ? modes : ["word"];
  return available[Math.floor(Math.random() * available.length)] || "word";
}

function chooseStudyCardFront() {
  const fronts = state?.settings?.studyCardFronts;
  const available = Array.isArray(fronts) && fronts.length ? fronts : ["english"];
  return available[Math.floor(Math.random() * available.length)] || "english";
}

function buildStudyCardVariants() {
  const configuredModes = state?.settings?.studyCardModes;
  const configuredFronts = state?.settings?.studyCardFronts;
  const modes = Array.isArray(configuredModes) && configuredModes.length
    ? configuredModes
    : ["word"];
  const fronts = Array.isArray(configuredFronts) && configuredFronts.length
    ? configuredFronts
    : ["english"];
  return modes.flatMap(mode => fronts.map(front => ({ mode, front })));
}

function beginStudyCardVariants() {
  const variants = shuffleStudyCards(buildStudyCardVariants());
  session.currentCardVariants = variants;
  session.currentCardVariantIndex = 0;
  session.currentCardGrades = [];
  session.currentCardMode = variants[0]?.mode || "word";
  session.currentCardFront = variants[0]?.front || "english";
}

function saveCurrentStudyResume() {
  if (!session) return;
  state.studyResume = { deckId: session.deckId ?? null, currentId: session.currentId ?? null };
  saveCurrentStudyCycle();
  markMetaDirty();
}

function saveCurrentStudyCycle() {
  if (!session?.currentId || !session.currentCardVariants?.length ||
      session.currentCardGrades?.length !== session.currentCardVariantIndex) return false;
  if (!state.studyCycles || typeof state.studyCycles !== "object") state.studyCycles = {};
  state.studyCycles[session.currentId] = {
    variants: session.currentCardVariants.map(variant => ({ ...variant })),
    index: session.currentCardVariantIndex,
    grades: [...session.currentCardGrades],
    updatedAt: Date.now(),
  };
  markMetaDirty();
  return true;
}

function clearStudyCycle(cardId) {
  if (!cardId || !state.studyCycles?.[cardId]) return false;
  delete state.studyCycles[cardId];
  markMetaDirty();
  return true;
}

function advanceStudyCardVariant(grade) {
  if (!session) return { complete: true, grade };
  const variants = Array.isArray(session.currentCardVariants)  &&  session.currentCardVariants.length
    ? session.currentCardVariants
    : [{ mode: session.currentCardMode || "word", front: session.currentCardFront || "english" }];
  const grades = Array.isArray(session.currentCardGrades) ? session.currentCardGrades : [];
  grades.push(grade);
  session.currentCardGrades = grades;

  const nextIndex = (session.currentCardVariantIndex || 0) + 1;
  if (nextIndex >= variants.length) {
    return { complete: true, grade: Math.min(...grades) };
  }

  session.currentCardVariantIndex = nextIndex;
  session.currentCardMode = variants[nextIndex].mode;
  session.currentCardFront = variants[nextIndex].front;
  session.revealed = false;
  session.startedAt = Date.now();
  return { complete: false, grade: null };
}

function deferCurrentStudyCardVariant() {
  if (!session?.currentId) return false;
  compactStudyQueue();

  const entry = {
    id: session.currentId,
    variantState: {
      variants: session.currentCardVariants.map(variant => ({ ...variant })),
      index: session.currentCardVariantIndex,
      grades: [...session.currentCardGrades],
    },
  };
  const remaining = studyQueueLength();
  const offset = remaining === 0
    ? 0
    : 1 + Math.floor(Math.random() * remaining);
  const insertAt = Math.min(session.queue.length, (session.queueHead || 0) + offset);

  session.queue.splice(insertAt, 0, entry);
  session.queuedIds.add(entry.id);
  session.currentId = null;
  session.currentCardMode = null;
  session.currentCardFront = null;
  session.currentCardVariants = [];
  session.currentCardVariantIndex = 0;
  session.currentCardGrades = [];
  session.revealed = false;
  return true;
}

function restoreStudyCardVariant(entry) {
  const deferredState = entry?.variantState;
  const persistedState = state.studyCycles?.[entry?.id];
  const variantState = deferredState || persistedState;
  if (!variantState || !Array.isArray(variantState.variants) || !variantState.variants.length) {
    beginStudyCardVariants();
    return;
  }

  const index = Math.min(
    Math.max(0, Number(variantState.index) || 0),
    variantState.variants.length - 1,
  );
  session.currentCardVariants = variantState.variants.map(variant => ({ ...variant }));
  session.currentCardVariantIndex = index;
  session.currentCardGrades = Array.isArray(variantState.grades) ? [...variantState.grades] : [];
  session.currentCardMode = session.currentCardVariants[index].mode;
  session.currentCardFront = session.currentCardVariants[index].front;
}

function startSession(deckId, options = {}) {
  const preserve = options.preserveCurrent === true && session?.deckId === deckId;
  if (preserve) saveCurrentStudyCycle();
  const resume = options.resume === true && state.studyResume?.deckId === deckId
    ? state.studyResume : null;
  const currentId = preserve ? session.currentId : resume?.currentId;
  const card = currentId ? getCardById(currentId) : null;
  const include = state.settings.studyQueue || { new: true, learning: true, review: true };
  const source = typeof activeCards === "function" ? activeCards(deckId) : getDeckCards(deckId);
  const available = card && source.some(item => item.id === card.id) && card.state !== "suspended" &&
    (preserve || (include[card.state] && (card.state === "new" || card.due <= Date.now())));
  const revealed = preserve && session.revealed === true;
  const startedAt = preserve ? session.startedAt : Date.now();
  session = {
    deckId,
    queue: [],
    queueHead: 0,
    queuedIds: new Set(),
    currentId: available ? card.id : null,
    currentCardMode: null,
    currentCardFront: null,
    currentCardVariants: [],
    currentCardVariantIndex: 0,
    currentCardGrades: [],
    revealed,
    startedAt,
  };
  if (!preserve && options.resume !== true) state.sessionReviewedIds = [];
  if (session.currentId) restoreStudyCardVariant({ id: session.currentId });
  markMetaDirty();
  refillStudyQueue(Date.now());
  if (session.currentId) {
    saveCurrentStudyResume();
    if (typeof save === "function") save();
    renderStudy();
  } else next();
}

function insertQueuedCard(card) {
  if (!session || !card || session.queuedIds.has(card.id) || card.id === session.currentId) return false;
  compactStudyQueue();
  let low = session.queueHead || 0;
  let high = session.queue.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const candidate = getCardById(session.queue[mid].id) || session.queue[mid];
    if ((candidate.due || 0) <= (card.due || 0)) low = mid + 1;
    else high = mid;
  }
  session.queue.splice(low, 0, card);
  session.queuedIds.add(card.id);
  return true;
}

function pruneStudyQueue(now) {
  while (studyQueueLength() > 0) {
    const entry = session.queue[session.queueHead || 0];
    const card = getCardById(entry.id);
    if (card && card.state !== "suspended" && (card.state === "new" || card.due <= now)) break;
    session.queueHead = (session.queueHead || 0) + 1;
    session.queuedIds.delete(entry.id);
  }
  compactStudyQueue();
}

function shuffleStudyCards(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function isUrgentLearningCard(card, now = Date.now()) {
  if (!card) return false;
  if (card.state === "learning") return card.due <= now;
  // FSRS relearning: a review card with interval 0 sits on a short re-show step
  return card.state === "review" && (Number(card.interval) || 0) === 0 && card.due <= now;
}

function refillStudyQueue(now = Date.now()) {
  if (!session) return;
  compactStudyQueue();
  const availableSlots = STUDY_QUEUE_BATCH_SIZE - studyQueueLength();
  if (availableSlots <= 0) return;

  const include = state.settings.studyQueue || { new: true, learning: true, review: true };
  const sourceCards = session.deckId
    ? getDeckCards(session.deckId)
    : (typeof activeCards === "function" ? activeCards() : state.cards);
  const eligibleCards = [];

  for (const card of sourceCards) {
    if (card.state === "suspended" || card.id === session.currentId || session.queuedIds.has(card.id)) continue;
    const isDueLearning = include.learning && card.state === "learning" && card.due <= now;
    const isDueReview = include.review && card.state === "review" && card.due <= now;
    const isNew = include.new && card.state === "new";
    if (isDueLearning || isDueReview || isNew) eligibleCards.push(card);
  }

  const batch = shuffleStudyCards(eligibleCards).slice(0, availableSlots);
  // Analysis fix #3: intraday learning/relearning steps are urgent — they are
  // placed at the front of the queue ahead of reviews and new cards, like
  // Anki does; everything else keeps its shuffled order.
  const urgent = batch.filter(card => isUrgentLearningCard(card, now));
  const regular = batch.filter(card => !isUrgentLearningCard(card, now));
  const head = session.queueHead || 0;
  for (let index = urgent.length - 1; index >= 0; index -= 1) {
    const card = urgent[index];
    session.queue.splice(head, 0, card);
    session.queuedIds.add(card.id);
  }
  for (const card of regular) {
    session.queue.push(card);
    session.queuedIds.add(card.id);
  }
}

function refreshDueStudyQueue(now = Date.now()) {
  refillStudyQueue(now);
}

function next({ refreshDue = false } = {}) {
  if (!session) return;
  const now = Date.now();
  if (!Number.isInteger(session.queueHead)) session.queueHead = 0;
  if (!session.queuedIds) session.queuedIds = new Set(activeStudyQueueEntries().map(entry => entry.id));
  pruneStudyQueue(now);
  if (refreshDue || studyQueueLength() === 0) {
    refreshDueStudyQueue(now);
    pruneStudyQueue(now);
  }

  if (studyQueueLength() === 0) {
    compactStudyQueue(true);
    session.currentId = null;
    session.currentCardMode = null;
    session.currentCardFront = null;
    session.currentCardVariants = [];
    session.currentCardVariantIndex = 0;
    session.currentCardGrades = [];
    session.revealed = false;
    saveCurrentStudyResume();
    if (typeof save === "function") save();
    renderStudy();
    updateStreak();
    if (typeof scheduleNextDueRefresh === "function") scheduleNextDueRefresh();
    return;
  }
  const current = session.queue[session.queueHead];
  session.queueHead += 1;
  session.queuedIds.delete(current.id);
  compactStudyQueue();
  session.currentId = current.id;
  restoreStudyCardVariant(current);
  session.revealed = false;
  saveCurrentStudyResume();
  if (typeof save === "function") save();
  refillStudyQueue(now);
  renderStudy();
  if (typeof scheduleNextDueRefresh === "function") scheduleNextDueRefresh();
}

function updateStreak(persist = true, render = true) {
  const dk = todayKey();
  const reviewedToday = (state.history[dk]?.reviewed) || 0;
  if (reviewedToday === 0) return false;
  const last = state.streak.lastDay;
  if (last === dk) return false;
  if (!last) {
    state.streak.current = 1;
  } else {
    const lastDate = new Date(last);
    const today = new Date(dk);
    const diff = Math.round((today - lastDate) / DAY_MS);
    if (diff === 1) state.streak.current += 1;
    else if (diff > 1) state.streak.current = 1;
  }
  state.streak.lastDay = dk;
  markMetaDirty();
  if (persist) save();
  if (render) $("#streakDays").textContent = state.streak.current;
  return true;
}