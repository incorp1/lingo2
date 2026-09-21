/* Lingo Cards — FSRS-4.5 implementation.
   Specification: open-spaced-repetition/awesome-fsrs, "The Algorithm", FSRS-4.5.
   https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-45

   Version pin: FSRS-4.5 — the 17-parameter model with DECAY = -0.5.
     R(t,S) = (1 + FACTOR * t / S) ^ DECAY
     I(r,S) = S / FACTOR * (r ^ (1 / DECAY) - 1)
   FACTOR is chosen so R(S,S) = 0.9. Do not combine the FSRS-4.5 FACTOR
   with FSRS v4's DECAY = -1.

   Core rules implemented here:
   - The memory model (S, D) is updated from the very first answer and is kept
     across the short Anki-style learning steps; the steps only decide when the
     card is shown again, they never reset or bypass the model.
   - Per FSRS-4.5 both next-stability formulas consume the difficulty D that
     was current BEFORE the answer; the difficulty is moved only afterwards.
   - Cards learned before FSRS was attached get their model rebuilt from the
     recorded answer history; a legacy-state approximation is used only when
     no history is available.

   Per-card state stored on the card object:
     fsrs: { S: number, D: number, lastReview: ms }

   API:
     FSRS.schedule(card, rating, settings) -> mutates card and returns nothing
     FSRS.previewIntervals(card, settings) -> { again, hard, good, easy } in days
*/

(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULT_W = [
    0.4872, 1.4003, 3.7145, 13.8206,
    5.1618, 1.2298, 0.8975, 0.031,
    1.6474, 0.1367, 1.0461, 2.1072,
    0.0793, 0.3246, 1.587, 0.2272,
    2.8755
  ];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;
  const MIN_RETENTION = 0.70;
  const MAX_RETENTION = 0.98;
  const FSRS_SPEC_VERSION = "FSRS-4.5";

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function requestedRetention(settings) {
    const percent = Number(settings && settings.fsrsRetention);
    const fraction = Number.isFinite(percent) ? percent / 100 : 0.9;
    return clamp(fraction, MIN_RETENTION, MAX_RETENTION);
  }

  function initStability(rating, w) {
    return Math.max(0.1, w[rating - 1]);
  }

  function initDifficulty(rating, w) {
    // d = w[4] - (rating - 3) * w[5], clamped to [1, 10]
    return clamp(w[4] - (rating - 3) * w[5], 1, 10);
  }

  function retrievability(elapsedDays, S) {
    return Math.pow(1 + FACTOR * elapsedDays / S, DECAY);
  }

  function nextInterval(S, requestRetention, maxInterval) {
    const i = (S / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
    return clamp(Math.round(i), 1, maxInterval || 36500);
  }

  function nextDifficulty(D, rating, w) {
    const dPrime = D - w[6] * (rating - 3);
    const dMean = initDifficulty(3, w);
    return clamp(w[7] * dMean + (1 - w[7]) * dPrime, 1, 10);
  }

  function nextStabilityRecall(D, S, R, rating, w) {
    const hard = rating === 2 ? w[15] : 1;
    const easy = rating === 4 ? w[16] : 1;
    return S * (
      1 +
      Math.exp(w[8]) *
      (11 - D) *
      Math.pow(S, -w[9]) *
      (Math.exp((1 - R) * w[10]) - 1) *
      hard * easy
    );
  }

  function nextStabilityForget(D, S, R, w) {
    return Math.min(
      w[11] *
        Math.pow(D, -w[12]) *
        (Math.pow(S + 1, w[13]) - 1) *
        Math.exp((1 - R) * w[14]),
      S
    );
  }

  function validFsrsState(fsrs) {
    return fsrs && Number.isFinite(fsrs.S) && fsrs.S > 0 &&
      Number.isFinite(fsrs.D) && fsrs.D >= 1 && fsrs.D <= 10;
  }

  function migrateLegacyState(card, settings = {}, now = Date.now()) {
    if (validFsrsState(card.fsrs)) return card.fsrs;

    const retention = requestedRetention(settings);
    const maxInt = Number(settings.fsrsMaxInterval) || 36500;
    const interval = clamp(Number(card.interval) || 1, 1, maxInt);
    const reps = Math.max(1, Number(card.reps) || 1);
    const lapses = Math.max(0, Number(card.lapses) || 0);
    const ease = clamp(Number(card.ease) || 250, 130, 400);
    const lapseRate = clamp(lapses / reps, 0, 1);
    const storedLastReview = Number(card.lastReview);
    const inferredLastReview = Number(card.due) - interval * DAY_MS;
    const lastReview = Number.isFinite(storedLastReview) && storedLastReview > 0
      ? Math.min(storedLastReview, now)
      : Number.isFinite(inferredLastReview) && inferredLastReview > 0
        ? Math.min(inferredLastReview, now)
        : now - interval * DAY_MS;
    const elapsedDays = Math.max(0, (now - lastReview) / DAY_MS);
    const inverseIntervalFactor = FACTOR / Math.max(0.0001, Math.pow(retention, 1 / DECAY) - 1);
    const maturityFactor = clamp(0.75 + Math.log1p(reps) / 6 - lapseRate * 0.35, 0.55, 1.25);
    const timingFactor = clamp(0.8 + elapsedDays / Math.max(1, interval) * 0.2, 0.8, 1.3);
    const S = clamp(interval * inverseIntervalFactor * maturityFactor * timingFactor, 0.1, maxInt);
    const overdueRatio = clamp(elapsedDays / Math.max(1, interval), 0, 4);
    const D = clamp(5 + (250 - ease) / 30 + lapseRate * 2 + Math.max(0, overdueRatio - 1) * 0.35, 1, 10);

    return {
      S,
      D,
      lastReview,
      migratedFrom: "sm2",
    };
  }

  // Replay the card's recorded answer history (grade + timestamp pairs kept in
  // difficultyCache.recent) through the FSRS-4.5 formulas. This migrates cards
  // that were learned before the model existed without inventing a memory
  // state; the legacy approximation is only used when no history is present.
  function rebuildFsrsFromHistory(card, w, settings, now = Date.now()) {
    const cache = card?.difficultyCache;
    const events = (cache && cache.version === 1 && Array.isArray(cache.recent) ? cache.recent : [])
      .map(event => ({ rating: Number(event?.grade) + 1, at: Number(event?.at) }))
      .filter(event => Number.isInteger(event.rating) && event.rating >= 1 && event.rating <= 4 &&
        Number.isFinite(event.at) && event.at > 0)
      .sort((a, b) => a.at - b.at);

    if (!events.length) return migrateLegacyState(card, settings, now);

    let S = initStability(events[0].rating, w);
    let D = initDifficulty(events[0].rating, w);
    let lastReview = events[0].at;
    for (let index = 1; index < events.length; index += 1) {
      const event = events[index];
      const elapsed = Math.max(0, (event.at - lastReview) / DAY_MS);
      const R = retrievability(elapsed, S);
      S = Math.max(0.1, event.rating === 1
        ? nextStabilityForget(D, S, R, w)
        : nextStabilityRecall(D, S, R, event.rating, w));
      D = nextDifficulty(D, event.rating, w);
      lastReview = event.at;
    }
    return { S, D, lastReview: Math.min(lastReview, now), rebuiltFrom: "history" };
  }

  // Train the FSRS memory model for this answer. Runs for every card state, so
  // the model is updated from the first answer and is never reset by the short
  // learning steps.
  function updateMemoryState(card, rating, w, settings, now) {
    // Weight vector may be omitted by callers — resolve from settings/defaults.
    if (!Array.isArray(w) || w.length !== 17) {
      w = (settings.fsrsWeights && settings.fsrsWeights.length === 17) ? settings.fsrsWeights : DEFAULT_W;
    }
    if (card.state === "new") {
      card.fsrs = {
        S: initStability(rating, w),
        D: initDifficulty(rating, w),
        lastReview: now,
      };
      return;
    }

    const current = validFsrsState(card.fsrs)
      ? { S: card.fsrs.S, D: card.fsrs.D, lastReview: card.fsrs.lastReview }
      : rebuildFsrsFromHistory(card, w, settings, now);
    const elapsed = Math.max(0, (now - (current.lastReview || now)) / DAY_MS);
    const R = retrievability(elapsed, current.S);
    // FSRS-4.5: stability is derived from the pre-answer difficulty D ...
    const Snew = Math.max(0.1, rating === 1
      ? nextStabilityForget(current.D, current.S, R, w)
      : nextStabilityRecall(current.D, current.S, R, rating, w));
    // ... and only afterwards does the difficulty move.
    card.fsrs = {
      S: Snew,
      D: nextDifficulty(current.D, rating, w),
      lastReview: now,
    };
  }

  // Graduation interval for a learning card whose memory state has just been
  // updated for this answer: under FSRS it replaces the fixed settings.
  function graduatingInterval(card, settings) {
    const maxInt = Number(settings?.fsrsMaxInterval) || 36500;
    if (!validFsrsState(card.fsrs)) {
      return Math.max(1, Math.round(Number(settings?.graduatingInterval) || 1));
    }
    return nextInterval(card.fsrs.S, requestedRetention(settings), maxInt);
  }

  /** Mutates card with new fsrs state, interval, due, lapses, reps. */
  function schedule(card, rating, settings) {
    const w = (settings.fsrsWeights && settings.fsrsWeights.length === 17) ? settings.fsrsWeights : DEFAULT_W;
    const now = Date.now();

    updateMemoryState(card, rating, w, settings, now);

    if (card.state === "new" || card.state === "learning") {
      // Short Anki-style learning steps only decide when the card is shown
      // next. The memory state updated above stays on the card; scheduler.js
      // applies the steps and the FSRS-based graduation interval on top.
      return;
    }

    const retention = requestedRetention(settings);
    const maxInt = settings.fsrsMaxInterval || 36500;

    if (rating === 1) {
      // Re-show soon — short relearning delay before going back to the FSRS
      // schedule (interval 0 marks this review card as relearning).
      card.interval = 0;
      card.due = now + 10 * 60 * 1000;
      card.lapses += 1;
    } else {
      card.interval = nextInterval(card.fsrs.S, retention, maxInt);
      card.due = now + card.interval * DAY_MS;
    }
    card.state = "review";
  }

  function previewIntervals(card, settings) {
    const w = (settings.fsrsWeights && settings.fsrsWeights.length === 17) ? settings.fsrsWeights : DEFAULT_W;
    const retention = requestedRetention(settings);
    const maxInt = settings.fsrsMaxInterval || 36500;
    const out = {};
    const fmt = days => {
      if (days < 1) return "<1d";
      if (days < 30) return `${Math.round(days)}d`;
      if (days < 365) return `${Math.round(days / 30)}mo`;
      return `${(days / 365).toFixed(1)}y`;
    };

    if (card.state === "new") {
      out.again = "<1m";
      for (const r of [2, 3, 4]) {
        const S = initStability(r, w);
        const days = nextInterval(S, retention, maxInt);
        out[["", "again", "hard", "good", "easy"][r]] = fmt(days);
      }
      return out;
    }

    const previewCard = validFsrsState(card.fsrs)
      ? card
      : { ...card, fsrs: rebuildFsrsFromHistory(card, w, settings) };
    const now = Date.now();
    const elapsed = Math.max(0, (now - (previewCard.fsrs.lastReview || now)) / DAY_MS);
    const R = retrievability(elapsed, previewCard.fsrs.S);
    out.again = "10m";
    for (const r of [2, 3, 4]) {
      // Preview uses the pre-answer difficulty, matching schedule().
      const Snew = Math.max(0.1, nextStabilityRecall(previewCard.fsrs.D, previewCard.fsrs.S, R, r, w));
      out[["", "again", "hard", "good", "easy"][r]] = fmt(nextInterval(Snew, retention, maxInt));
    }
    return out;
  }

  window.FSRS = {
    schedule,
    updateMemoryState,
    graduatingInterval,
    previewIntervals,
    migrateLegacyState,
    rebuildFsrsFromHistory,
    DEFAULT_W,
    SPEC: Object.freeze({ version: FSRS_SPEC_VERSION, decay: DECAY, factor: FACTOR }),
    reference: Object.freeze({
      retrievability,
      nextInterval,
      initStability,
      initDifficulty,
      nextDifficulty,
      nextStabilityRecall,
      nextStabilityForget,
      requestedRetention,
    }),
  };
})();
