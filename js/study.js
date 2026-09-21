/* Lingo Cards — Deck selector, study session and example refresh */

/* Deck selector + counts */
function renderDeckSelector() {
  const sel = $("#deckSelect");
  const filter = $("#filterDeck");
  const edDeck = $("#edDeck");
  [sel, filter, edDeck].forEach(s => { if (s) s.innerHTML = ""; });

  const all = document.createElement("option");
  all.value = "";
  all.textContent = t("browse.allDecks");
  sel.appendChild(all.cloneNode(true));
  filter.appendChild(all.cloneNode(true));

  for (const d of activeDecks()) {
    const cards = getDeckCards(d.id);
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.name;
    sel.appendChild(o.cloneNode(true));
    filter.appendChild(o.cloneNode(true));
    edDeck.appendChild(o);
  }
  sel.value = state.activeDeckId || "";
  syncCompactSelectWidth(sel);
  sel.onchange = () => {
    state.activeDeckId = sel.value || null;
    markMetaDirty();
    save();
    startSession(state.activeDeckId);
    if (typeof updateSwapBtnTitle === "function") updateSwapBtnTitle();
  };
}

function deckStats(deckId) {
  const all = getDeckCards(deckId);
  const now = Date.now();
  let fresh = 0;
  let learning = 0;
  let review = 0;
  for (const card of all) {
    if (card.state === "new") fresh += 1;
    else if (card.state === "learning" && card.due <= now) learning += 1;
    else if (card.state === "review" && card.due <= now) review += 1;
  }
  return { total: all.length, new: fresh, learning, review };
}

function renderStudyQueueControls(deckId) {
  const q = state.settings.studyQueue || { new: true, learning: true, review: true };
  const counts = deckStats(deckId);
  const currentCard = session ? getCardById(session.currentId) : null;
  const map = {
    new: { btn: $("#studyFilterNew"), count: $("#cntNew") },
    learning: { btn: $("#studyFilterLearning"), count: $("#cntLearn") },
    review: { btn: $("#studyFilterReview"), count: $("#cntReview") },
  };
  for (const key of Object.keys(map)) {
    const { btn, count } = map[key];
    if (!btn) continue;
    const on = q[key] !== false;
    btn.classList.toggle("filter-off", !on);
    btn.classList.toggle("current-state", currentCard?.state === key);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const mark = btn.querySelector(".filter-state-mark");
    if (mark) mark.textContent = on ? "✓" : "×";
    if (count) count.textContent = counts[key];
  }
}

function studyQueueHasEnabledCategories() {
  const q = state.settings.studyQueue || { new: true, learning: true, review: true };
  return ["new", "learning", "review"].some(key => q[key] !== false);
}

function enableAllStudyCategories() {
  state.settings.studyQueue = { new: true, learning: true, review: true };
  markSettingsDirty();
  save();
  session = null;
  renderStudy();
}

/* ----- Study view ----- */
let studyStageKey = "";

function patchStudyStage(stage, key, html) {
  if (studyStageKey === key && stage.firstElementChild) return false;
  stage.replaceChildren();
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  stage.appendChild(template.content);
  studyStageKey = key;
  return true;
}

function invalidateStudyStage() {
  studyStageKey = "";
}

function renderStudy() {
  const stage = $("#cardStage");
  const actions = $("#cardActions");
  const revealEl = $("#revealBar");
  const deckId = state.activeDeckId;
  const stats = deckStats(deckId);
  renderStudyQueueControls(deckId);

  if (!session || session.deckId !== deckId) {
    startSession(deckId, { resume: true });
    return;
  }

  if (!session.currentId) {
    refreshDueStudyQueue();
    pruneStudyQueue(Date.now());
    if (studyQueueLength() > 0) {
      next();
      return;
    }

    const nd = nextDueAt(deckId);
    const hasAny = activeCards(deckId).length > 0;
    const hasEnabledCategories = studyQueueHasEnabledCategories();
    let title, desc;
    if (!hasEnabledCategories) {
      title = t("study.empty.filtersOff.title");
      desc = t("study.empty.filtersOff.desc");
    } else if (!hasAny) {
      title = t("study.empty.title");
      desc = t("study.empty.nocards");
    } else if (nd) {
      title = t("study.empty.allLabel");
      desc = t("study.empty.next", { when: friendlyWhen(nd) });
    } else {
      title = t("study.empty.allLabel");
      desc = t("study.empty.doneNoNext");
    }
    const emptyKey = `empty:${deckId || "all"}:${title}:${desc}:${stats.new}:${stats.learning}:${stats.review}`;
    const changed = patchStudyStage(stage, emptyKey, `
      <div class="empty-state">
        <div class="emoji">${!hasEnabledCategories ? "🎛️" : hasAny && (nd || hasNewInDeck(deckId)) ? "🎉" : "🌱"}</div>
        <h2>${escape(title)}</h2>
        <p>${escape(desc)}</p>
        ${hasEnabledCategories ? `<div class="study-queue-summary">
          <span>${escape(t("study.queue.summary", { n: stats.new + stats.learning + stats.review }))}</span>
        </div>` : ""}
        <div class="empty-state-actions">
          ${!hasEnabledCategories ? `<button class="btn primary" id="enableStudyCategoriesBtn" type="button">${escape(t("study.filters.enableCta"))}</button>` : `
          <button class="btn primary add-card-trigger empty-add-trigger" id="emptyAddBtn" type="button" aria-haspopup="menu" aria-controls="addCardMenu" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
            <span>${escape(t("topbar.addCard"))}</span>
            <svg class="add-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>
          </button>
          <button class="btn ghost" id="emptyDecksBtn">${escape(t("study.empty.manage"))}</button>`}
        </div>
      </div>`);
    actions.hidden = true;
    revealEl.hidden = true;
    if (changed) {
      if (!hasEnabledCategories) {
        $("#enableStudyCategoriesBtn").onclick = enableAllStudyCategories;
      } else {
        $("#emptyAddBtn").onclick = event => openAddCardMenu(event.currentTarget);
        $("#emptyDecksBtn").onclick = () => switchView("decks");
      }
    }
    syncExampleRefreshBar();
    if (typeof scheduleNextDueRefresh === "function") scheduleNextDueRefresh();
    return;
  }

  const card = getCardById(session.currentId);
  if (!card) { next(); return; }

  let frontHTML = "", backHTML = "", exampleHTML = "";
  let contextFront = null;
  const deck = getDeckById(card.deckId);
  const cardMode = session.currentCardMode || chooseStudyCardMode();
  const cardFront = session.currentCardFront || chooseStudyCardFront();
  session.currentCardMode = cardMode;
  session.currentCardFront = cardFront;
  const reversed = cardFront === "local" && card.type !== "cloze";
  const frontText = reversed ? card.back : card.front;
  const backText  = reversed ? card.front : card.back;
  if (card.type === "cloze") {
    const cloze = escape(card.cloze || "");
    if (!session.revealed) {
      frontHTML = cloze.replace(/\{\{(.+?)\}\}/g, '<span class="cloze hidden">$1</span>');
    } else {
      frontHTML = cloze.replace(/\{\{(.+?)\}\}/g, '<span class="cloze">$1</span>');
    }
  } else {
    if (cardMode === "sentence") {
      const normalizedExamples = normalizedExampleFields(card);
      if (reversed && normalizedExamples.translation) {
        contextFront = {
          sentence: normalizedExamples.translation,
          term: resolveStoredExampleTargetTerm(normalizedExamples.translation, card.exampleTargetTerm)
            || findContextTerm(normalizedExamples.translation, contextTermCandidates(frontText))
            || "",
          otherLines: [normalizedExamples.sentence].filter(Boolean),
        };
      } else if (!reversed && normalizedExamples.sentence) {
        contextFront = {
          sentence: normalizedExamples.sentence,
          term: findContextTerm(normalizedExamples.sentence, contextTermCandidates(frontText)) || "",
          otherLines: [normalizedExamples.translation].filter(Boolean),
        };
      }
      if (!contextFront?.sentence) {
        contextFront = findContextSentence(card.example, frontText, backText);
      }
    }
    frontHTML = contextFront
      ? highlightContextTerm(contextFront.sentence, contextFront.term)
      : escape(frontText);
  }
  backHTML = backText ? escape(backText) : "";
  const definitionHTML = cardMode === "sentence" && reversed && contextFront && card.back
    ? escape(card.back)
    : "";
  const normalizedExamples = normalizedExampleFields(card);
  const answerExampleLines = contextFront
    ? contextFront.otherLines
    : [normalizedExamples.sentence, normalizedExamples.translation].filter(Boolean);
  exampleHTML = answerExampleLines.map(escape).join("<br>");

  const cardKey = `card:${card.id}:${session.revealed ? 1 : 0}:${cardFront}:${cardMode}:${window.I18N_LANG || state.settings.language || ""}:${card.updatedAt || card.lastReview || card.createdAt || 0}`;
  const changed = patchStudyStage(stage, cardKey, `
    <div class="card-stage-tools">
      <button class="edit-link undo-link" id="undoBtn" title="${escape(t("study.undo"))}" aria-label="${escape(t("study.undo"))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button class="edit-link" id="editCurrentBtn" title="${escape(t("study.edit"))}" aria-label="${escape(t("study.edit"))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>

      <button class="edit-link info-link" id="wordInfoBtn"${session.revealed ? "" : " disabled"} title="${escape(t("study.info.button"))}" aria-label="${escape(t("study.info.button"))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      </button>
    </div>
    <button class="speaker-btn" id="ttsBtn"${reversed ? " disabled" : ""} title="${escape(t("study.pronounce"))}" aria-label="${escape(t("study.pronounce"))}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M11 5L6 9H3v6h3l5 4z"/>
        <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
        <path d="M18.5 5.5a9 9 0 0 1 0 13"/>
      </svg>
    </button>
    <div class="card-front${contextFront ? " context-front" : ""}">${frontHTML}</div>
    ${(!reversed && card.hint) ? `<div class="pronunciation">${escape(card.hint)}</div>` : ""}
    ${session.revealed && card.type !== "cloze" ? `
      <div class="divider"></div>
      <div class="card-back${contextFront ? " card-translation" : ""}">${backHTML}</div>
      ${(reversed && card.hint) ? `<div class="pronunciation pronunciation-back">${escape(card.hint)}</div>` : ""}
      ${definitionHTML ? `<div class="card-definition">${definitionHTML}</div>` : ""}
      ${exampleHTML ? `<div class="card-example">"${exampleHTML}"</div>` : ""}
    ` : ""}
    ${session.revealed && card.type === "cloze" && exampleHTML ? `
      <div class="divider"></div>
      <div class="card-example">"${exampleHTML}"</div>
    ` : ""}
  `);

  if (changed) {
    $("#undoBtn").onclick = undo;
    updateUndoBtn();
    $("#editCurrentBtn").onclick = () => openCardEditor(card.id);
    $("#wordInfoBtn").onclick = () => openWordInfo(card);
    $("#ttsBtn").onclick = () => {
      const visibleFrontSpeech = contextFront ? contextFront.sentence : frontText;
      // Озвучивание всегда идёт на языке обучения: русская/украинская сторона
      // карточки не произносится, вместо неё читается термин на изучаемом
      // языке, иначе кнопка TTS проговаривала бы перевод голосом интерфейса.
      const learningSideText = reversed ? card.back : card.front;
      const toSpeak = session.revealed
        ? (reversed ? card.front : (learningSideText || card.front))
        : (card.type === "cloze" ? stripCloze(card.cloze) : visibleFrontSpeech);
      speak(toSpeak, { lang: learningSpeechLocale() });
    };
  }

  syncExampleRefreshBar();

  if (session.revealed) {
    actions.hidden = false;
    revealEl.hidden = true;
    const iv = previewIntervals(card);
    $("#ivAgain").textContent = iv.again;
    $("#ivHard").textContent  = iv.hard;
    $("#ivGood").textContent  = iv.good;
    $("#ivEasy").textContent  = iv.easy;
  } else {
    actions.hidden = true;
    revealEl.hidden = false;
  }
}

function splitExampleLines(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 1) return lines;

  const legacyPair = lines[0].split(/\s+[—–]\s+/).map(line => line.trim()).filter(Boolean);
  if (legacyPair.length === 2) {
    const firstScript = dominantContextScript(legacyPair[0]);
    const secondScript = dominantContextScript(legacyPair[1]);
    if (firstScript && secondScript && firstScript !== secondScript) return legacyPair;
  }
  return lines;
}

function normalizeExampleLine(value) {
  return String(value || "").trim().replace(/^[\s"“”«»']+|[\s"“”«»']+$/g, "");
}

function normalizedExampleFields(card) {
  const storedSentence = normalizeExampleLine(card?.exampleSentence);
  const storedTranslation = normalizeExampleLine(card?.exampleTranslation);
  const lines = splitExampleLines(card?.example);
  return {
    sentence: storedSentence || normalizeExampleLine(lines[0]),
    translation: storedTranslation || normalizeExampleLine(lines.slice(1).join(" ")),
  };
}

function normalizedSearchRange(haystack, needle) {
  const source = String(haystack || "");
  const query = String(needle || "").trim();
  if (!source || !query) return null;

  const normalizeUnit = value => String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-");
  const build = value => {
    let normalized = "";
    const starts = [];
    const ends = [];
    let offset = 0;
    let previousSpace = false;
    for (const symbol of String(value || "")) {
      const start = offset;
      offset += symbol.length;
      let unit = normalizeUnit(symbol);
      if (/^\s+$/u.test(unit)) unit = " ";
      if (unit === " " && previousSpace) continue;
      previousSpace = unit === " ";
      for (const char of unit) {
        normalized += char;
        starts.push(start);
        ends.push(offset);
      }
    }
    return { normalized, starts, ends };
  };

  const sourceIndex = build(source);
  const normalizedNeedle = build(query).normalized.trim();
  if (!normalizedNeedle) return null;
  const normalizedStart = sourceIndex.normalized.indexOf(normalizedNeedle);
  if (normalizedStart < 0) return null;
  const normalizedEnd = normalizedStart + normalizedNeedle.length - 1;
  return {
    start: sourceIndex.starts[normalizedStart],
    end: sourceIndex.ends[normalizedEnd],
  };
}

function resolveStoredExampleTargetTerm(sentence, storedTerm) {
  const text = String(sentence || "");
  const range = normalizedSearchRange(text, storedTerm);
  return range ? text.slice(range.start, range.end) : "";
}

function contextTermCandidates(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const cleaned = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [cleaned, ...cleaned.split(/\s*(?:;|,|\/|\||·|\n)\s*/)]
    .map(value => value.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim())
    .filter(value => value.length > 1);
  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

function findContextSentence(example, promptText, answerText = "") {
  const lines = splitExampleLines(example);
  if (!lines.length) return null;

  const candidates = contextTermCandidates(promptText);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const sentence = lines[lineIndex];
    const term = findContextTerm(sentence, candidates);
    if (term) return contextSentenceResult(lines, lineIndex, term);
  }

  const promptScript = dominantContextScript(promptText);
  if (promptScript) {
    const matchingLineIndex = lines.findIndex(line => dominantContextScript(line) === promptScript);
    if (matchingLineIndex >= 0) {
      return contextSentenceResult(
        lines,
        matchingLineIndex,
        findContextTerm(lines[matchingLineIndex], candidates)
      );
    }
  }

  const answerCandidates = contextTermCandidates(answerText);
  let answerLineIndex = -1;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (findContextTerm(lines[lineIndex], answerCandidates)) {
      answerLineIndex = lineIndex;
      break;
    }
  }
  if (answerLineIndex < 0 || lines.length < 2) return null;

  const pairedIndex = answerLineIndex % 2 === 0
    ? answerLineIndex + 1
    : answerLineIndex - 1;
  const sentenceIndex = pairedIndex >= 0 && pairedIndex < lines.length
    ? pairedIndex
    : lines.findIndex((_, index) => index !== answerLineIndex);
  return sentenceIndex < 0
    ? null
    : contextSentenceResult(lines, sentenceIndex, findContextTerm(lines[sentenceIndex], candidates));
}

function contextSentenceResult(lines, sentenceIndex, term) {
  return {
    sentence: lines[sentenceIndex],
    term: term || "",
    otherLines: lines.filter((_, index) => index !== sentenceIndex),
  };
}

function dominantContextScript(text) {
  const value = String(text || "");
  // Norwegian å/ø/æ and other diacritics are Latin script too: counting only
  // ASCII letters made "blåbær" look less Latin than it is.
  const latin = (value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const cyrillic = (value.match(/[\u0400-\u052f]/g) || []).length;
  if (!latin && !cyrillic) return "";
  return cyrillic > latin ? "cyrillic" : "latin";
}

function findContextTerm(sentence, candidates) {
  const sentenceText = String(sentence || "");
  const lowerSentence = sentenceText.toLocaleLowerCase();
  for (const candidate of candidates) {
    if (/\s/u.test(candidate)) {
      const index = lowerSentence.indexOf(candidate.toLocaleLowerCase());
      if (index >= 0) return sentenceText.slice(index, index + candidate.length);
    }
  }

  const sentenceWords = [...sentenceText.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’ʼ-]*/gu)];
  const candidateWords = [...new Set(candidates.flatMap(candidate =>
    candidate.match(/[\p{L}\p{M}][\p{L}\p{M}'’ʼ-]*/gu) || []
  ))];
  let best = null;

  for (const match of sentenceWords) {
    const sentenceWord = match[0];
    const normalizedSentenceWord = normalizeContextWord(sentenceWord);
    for (const candidateWord of candidateWords) {
      const normalizedCandidateWord = normalizeContextWord(candidateWord);
      const score = contextWordMatchScore(normalizedSentenceWord, normalizedCandidateWord);
      if (score > 0 && (!best || score > best.score)) {
        best = { term: sentenceWord, score };
      }
    }
  }
  return best?.term || null;
}

function normalizeContextWord(word) {
  const normalized = String(word || "")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’ʼ]/g, "'");
  if (/^(?:весь|вся|все|всю|всего|всей|всему|всем|всех)$/.test(normalized)) return "весь";
  if (/^(?:весь|вся|все|всі|всю|всього|всієї|всій|всьому|всім|всіх)$/.test(normalized)) return "весь";
  return normalized;
}

function contextWordMatchScore(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1000 + left.length;

  const shorter = Math.min(left.length, right.length);
  const longer = Math.max(left.length, right.length);
  let common = 0;
  while (common < shorter && left[common] === right[common]) common++;

  if (shorter >= 4 && common === shorter && longer - shorter <= 5) {
    return 800 + common * 10 - (longer - shorter);
  }

  const required = shorter >= 9 ? 6 : shorter >= 7 ? 5 : shorter >= 5 ? 4 : 3;
  if (shorter >= 4 && common >= required && common / shorter >= 0.62) {
    return 500 + common * 10 - Math.abs(left.length - right.length);
  }
  return 0;
}

function highlightContextTerm(sentence, term) {
  const text = String(sentence || "");
  const range = normalizedSearchRange(text, term);
  if (!range) return escape(text);
  return `${escape(text.slice(0, range.start))}<strong class="context-target">${escape(text.slice(range.start, range.end))}</strong>${escape(text.slice(range.end))}`;
}

function stripCloze(text) {
  return (text || "").replace(/\{\{(.+?)\}\}/g, "$1");
}

function cardEnglishTerm(card) {
  if (!card) return "";
  if (card.type === "cloze") return stripCloze(card.cloze);
  return String(card.front || "").trim();
}

function autoSpeakRevealedCard(card) {
  if (!state.settings.autoTTS || session._spoken) return;
  const textToSpeak = cardEnglishTerm(card);
  if (!textToSpeak) return;
  speak(textToSpeak, { lang: learningSpeechLocale() });
  session._spoken = true;
}

function humanInterval(card) {
  if (card.state === "new") return t("study.firstSight");
  if (card.state === "learning") return t("study.state.learning");
  return `${t("study.interval")} ${card.interval}d · ${t("study.ease")} ${(card.ease/100).toFixed(2)}`;
}

function reveal() {
  if (!session?.currentId || session.revealed) return;
  const card = getCardById(session.currentId);
  if (!card) return;
  session.revealed = true;
  session._spoken = false;
  renderStudy();
  autoSpeakRevealedCard(card);
}
let gradeSaving = false;

async function grade(g) {
  if (gradeSaving || (typeof isLearningLanguageSwitchBusy === "function" && isLearningLanguageSwitchBusy()) || !session?.currentId || !session.revealed) return;
  const card = getCardById(session.currentId);
  if (!card) return;

  const previousState = structuredClone(state);
  const previousSession = structuredClone(session);
  const previousUndoLength = undoStack.length;
  gradeSaving = true;
  try {
    const variantResult = advanceStudyCardVariant(g);
    session._spoken = false;
    if (!variantResult.complete) {
      state.studyResume = { deckId: session.deckId ?? null, currentId: session.currentId ?? null };
      markMetaDirty();
      saveCurrentStudyCycle();
      await saveAndFlush();
      await window.LCMotion?.transitionStudyCardOut();
      deferCurrentStudyCardVariant();
      next();
      window.LCMotion?.transitionStudyCardIn();
      return;
    }

    clearStudyCycle(card.id);
    state.studyResume = { deckId: session.deckId ?? null, currentId: null };
    markMetaDirty();
    if (!Array.isArray(state.sessionReviewedIds)) state.sessionReviewedIds = [];
    if (!state.sessionReviewedIds.includes(card.id)) state.sessionReviewedIds.push(card.id);
    scheduleAnswer(card, variantResult.grade);
    updateStreak(false, false);
    await saveAndFlush();
    await window.LCMotion?.transitionStudyCardOut();
    $("#streakDays").textContent = state.streak.current || 0;
    next();
    window.LCMotion?.transitionStudyCardIn();
  } catch (error) {
    window.LCStorage.discardAppState?.();
    state = previousState;
    session = previousSession;
    rebuildEntityIndexes();
    undoStack.length = previousUndoLength;
    reportSaveError(error);
    renderActiveView({ includeSelectors: true });
    toast(t("toast.saveFailed"), { error: true });
  } finally {
    gradeSaving = false;
  }
}

const EXAMPLE_BATCH_SIZE = 20;
const EXAMPLE_MAX_ATTEMPTS = 3;
const EXAMPLE_GEMINI_REQUEST_INTERVAL_MS = 10000;
let exampleRefreshRunning = false;
let activeExampleRefreshProgress = null;

function exampleRefreshTarget(progress) {
  if (progress?.deckId) {
    return Array.from(document.querySelectorAll(".deck-row"))
      .find(row => row.dataset.deckId === progress.deckId) || null;
  }
  if (progress?.surface === "browse") return $("#deckBrowse");
  return $("#cardStage");
}

function syncExampleRefreshBar() {
  const progress = activeExampleRefreshProgress;
  if (!progress?.bar) return;
  const target = exampleRefreshTarget(progress);
  if (!target) return;
  if (progress.target !== target) {
    progress.target?.classList.remove("example-refresh-bar-host");
    progress.target = target;
  }
  target.classList.add("example-refresh-bar-host");
  if (progress.bar.parentElement !== target) target.prepend(progress.bar);
}

/* Кольцевой индикатор на кнопке обновления анимируется из JS.
   Переход `transition: --example-progress` требует регистрации через
   `@property`, доступной только с Safari 16.4, поэтому на iPhone 7
   (максимум — iOS 15) заливка прыгала между значениями без анимации.
   Покадровая интерполяция даёт одинаковый результат во всех браузерах. */
const EXAMPLE_RING_TWEEN_MS = 650;
let exampleRingTween = null;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function motionTimestamp() {
  return typeof window.performance?.now === "function" ? window.performance.now() : Date.now();
}

function cancelExampleRefreshRing() {
  if (!exampleRingTween) return;
  cancelAnimationFrame(exampleRingTween.frame);
  exampleRingTween = null;
}

function tweenExampleRefreshRing(button, fraction) {
  if (!button) return;
  const safeFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
  const to = safeFraction * 360;
  const from = Number.parseFloat(button.style.getPropertyValue("--example-progress")) || 0;
  cancelExampleRefreshRing();
  if (prefersReducedMotion() || Math.abs(to - from) < 0.5) {
    button.style.setProperty("--example-progress", `${to}deg`);
    return;
  }
  const startedAt = motionTimestamp();
  const step = () => {
    const linear = Math.min(1, (motionTimestamp() - startedAt) / EXAMPLE_RING_TWEEN_MS);
    const eased = 1 - Math.pow(1 - linear, 3);
    button.style.setProperty("--example-progress", `${(from + (to - from) * eased).toFixed(2)}deg`);
    if (linear < 1) exampleRingTween = { button, frame: requestAnimationFrame(step) };
    else exampleRingTween = null;
  };
  exampleRingTween = { button, frame: requestAnimationFrame(step) };
}

function createExampleRefreshBar(sourceButton, total, deckId = null) {
  const surface = sourceButton?.id === "bulkRefreshExamplesBtn" ? "browse" : "study";
  const bar = document.createElement("div");
  const label = document.createElement("span");
  bar.className = "example-refresh-bar is-indeterminate";
  label.className = "example-refresh-count";
  label.textContent = `0/${total}`;
  bar.appendChild(label);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", "0");
  bar.setAttribute("aria-valuetext", t("examples.progressStarting"));
  const progress = { target: null, bar, label, total, deckId, surface };
  activeExampleRefreshProgress = progress;
  syncExampleRefreshBar();
  requestAnimationFrame(() => bar.classList.add("is-visible"));
  return progress;
}

function waitForExampleRefreshPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function waitForExampleRefreshDelay(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function ensureExampleRefreshBar(progress) {
  if (!progress?.bar || activeExampleRefreshProgress !== progress) return;
  syncExampleRefreshBar();
}

function setExampleRefreshBar(progress, completed) {
  ensureExampleRefreshBar(progress);
  if (!progress?.bar?.isConnected) return;
  const done = Math.max(0, Math.min(progress.total, Number(completed) || 0));
  const fraction = progress.total ? done / progress.total : 1;
  progress.bar.classList.toggle("is-indeterminate", done <= 0);
  progress.bar.style.setProperty("--example-linear-progress", String(fraction));
  progress.bar.setAttribute("aria-valuenow", String(done));
  progress.bar.setAttribute("aria-valuetext", `${done}/${progress.total}`);
  progress.label.textContent = `${done}/${progress.total}`;
}

async function removeExampleRefreshBar(progress, completed) {
  if (!progress?.bar) return;
  if (completed) {
    setExampleRefreshBar(progress, progress.total);
    await new Promise(resolve => setTimeout(resolve, 320));
  }
  progress.bar.classList.remove("is-visible");
  await new Promise(resolve => setTimeout(resolve, 180));
  progress.bar.remove();
  progress.target?.classList.remove("example-refresh-bar-host");
  if (activeExampleRefreshProgress === progress) activeExampleRefreshProgress = null;
}

function exampleRefreshErrorStatus(error) {
  return Number(error?.status || (String(error?.message || "").match(/HTTP (\d{3})/) || [])[1] || 0);
}

function exampleRefreshAiReady() {
  const s = state.settings || {};
  return s.aiMode === "ai" && s.aiKey && window.LCAi?.generateExamplesBatch;
}

function enabledStudyExampleCategories() {
  const queueSettings = state.settings.studyQueue || {
    new: true,
    learning: true,
    review: true,
  };
  return new Set(
    ["new", "learning", "review"].filter(category => queueSettings[category] !== false)
  );
}

function cardsForStudyExampleRefresh() {
  const enabledCategories = enabledStudyExampleCategories();
  const deckId = state.activeDeckId;
  return activeCards().filter(card =>
    card.type !== "cloze" &&
    card.state !== "suspended" &&
    (!deckId || card.deckId === deckId) &&
    enabledCategories.has(card.state)
  );
}

// Снимок фиксируется до первого await: смена языка или редактирование
// карточки не должны превращать старый ответ в актуальную запись.
function captureStudyAiContext(cards) {
  const language = activeLearningLanguageCode();
  const languageName = learningLangName();
  // Языковые параметры запроса фиксируются вместе со снимком карточек.
  const aiLanguageOptions = {
    learningLanguage: activeLearningLanguageCode(),
    learningLangName: learningLangName(),
  };
  const generation = currentLanguageGeneration();
  const identities = new Map((cards || []).filter(Boolean).map(card => [card.id, card]));
  const snapshots = [...identities.values()].map(card => JSON.parse(JSON.stringify(card)));
  const current = () => isLanguageGenerationCurrent(generation)
    && activeLearningLanguageCode() === language
    && !isLearningLanguageSwitchBusy();
  const matches = original => {
    const card = getCardById(original.id);
    const deck = card && getDeckById(card.deckId);
    return current() && card === identities.get(original.id) && !!deck && normalizeLearningLanguage(deck.learningLanguage) === language
      && card.deckId === original.deckId
      && ["front", "back", "type", "info", "example", "exampleSentence", "exampleTranslation", "exampleTargetTerm"]
        .every(key => JSON.stringify(card[key]) === JSON.stringify(original[key]));
  };
  return { language, languageName, aiLanguageOptions, snapshots, current, matches };
}

async function refreshExamplesForCards(cards, sourceButton, deckId = null) {
  const context = captureStudyAiContext(cards);
  if (!await prepareAiJob("example-refresh") || !context.current()) return;
  const unique = [...new Map(context.snapshots
    .filter(card => context.matches(card) && card.type !== "cloze" && String(card.front || "").trim())
    .map(card => [card.id, card])).values()];
  if (!unique.length) {
    toast(t("examples.none"));
    return;
  }
  if (!exampleRefreshAiReady()) {
    toast(t("examples.aiRequired"), { error: true });
    return;
  }
  const contextId = `examples:${unique.map(card => card.id).sort().join(",")}`;
  const job = await startAiJob("example-refresh", contextId);
  if (!job) return;
  const confirmed = await confirmDialog({
    title: t("confirm.refreshExamples.title"),
    message: t("examples.confirm", { n: unique.length, batches: Math.ceil(unique.length / EXAMPLE_BATCH_SIZE) }),
    confirmLabel: t("confirm.refreshExamples.action"),
  });
  if (!confirmed || !context.current() || !isCurrentAiJob(job)) {
    finishAiJob(job);
    return;
  }

  exampleRefreshRunning = true;
  const progress = createExampleRefreshBar(sourceButton, unique.length, deckId);
  const buttons = [...new Set([sourceButton, $("#desktopRefreshBtn"), $("#edgeRefreshBtn"), $("#bulkRefreshExamplesBtn")].filter(Boolean))];
  buttons.forEach(button => {
    button.setAttribute("aria-busy", "true");
    button.classList.add("loading");
  });
  sourceButton?.classList.add("example-refresh-progress");
  cancelExampleRefreshRing();
  sourceButton?.style.setProperty("--example-progress", "0deg");

  const pending = unique.map(card => ({ card, attempts: 0 }));
  const failedCards = [];
  let updated = 0;
  let resolved = 0;
  let nextRequestAt = 0;

  try {
    await waitForExampleRefreshPaint();
    while (pending.length) {
      if (!isCurrentAiJob(job) || !context.current()) throw new DOMException("stale", "AbortError");
      const waitMs = Math.max(0, nextRequestAt - Date.now());
      await waitForExampleRefreshDelay(waitMs, job.controller.signal);
      if (!isCurrentAiJob(job) || !context.current()) throw new DOMException("stale", "AbortError");
      const batchEntries = pending.splice(0, EXAMPLE_BATCH_SIZE).filter(entry => {
        if (context.matches(entry.card)) return true;
        resolved += 1;
        return false;
      });
      if (!batchEntries.length) continue;
      const batch = batchEntries.map(entry => entry.card);

      batchEntries.forEach(entry => { entry.attempts += 1; });
      nextRequestAt = Date.now() + (state.settings.aiProvider === "google" ? EXAMPLE_GEMINI_REQUEST_INTERVAL_MS : 0);

      let result;
      try {
        result = await window.LCAi.generateExamplesBatch(batch, {
          provider: state.settings.aiProvider,
          key: state.settings.aiKey,
          model: state.settings.aiModel || undefined,
          targetLang: aiTargetLangName(),
          ...context.aiLanguageOptions,
          topics: state.settings.exampleTopics,
          situations: state.settings.exampleSituations,
          styles: state.settings.exampleStyles,
          temperature: state.settings.exampleTemperature,
          signal: job.controller.signal,
          timeoutMs: AI_TIMEOUT_MS,
          retryAttempts: 1,
        });
      } catch (error) {
        if (!context.current() || !isCurrentAiJob(job)) throw new DOMException("stale", "AbortError");
        if (isAbortError(error)) throw error;
        if (error?.storageError) throw error;
        if (exampleRefreshErrorStatus(error) === 429) {
          nextRequestAt = Math.max(nextRequestAt, Date.now() + Math.max(0, Number(error.retryAfterMs) || 0));
        }
        for (const entry of batchEntries) {
          if (entry.attempts < EXAMPLE_MAX_ATTEMPTS) pending.push(entry);
          else {
            failedCards.push(entry.card);
            resolved += 1;
          }
        }
        setExampleRefreshBar(progress, updated);
        tweenExampleRefreshRing(sourceButton, updated / unique.length);
        continue;
      }

      if (!isCurrentAiJob(job) || !context.current()) throw new DOMException("stale", "AbortError");
      const byId = new Map(result.map(item => [String(item.id), item]));
      const updates = [];
      const retryEntries = [];

      for (const entry of batchEntries) {
        const original = entry.card;
        if (!context.matches(original)) { resolved += 1; continue; }
        const current = getCardById(original.id);
        const item = byId.get(String(original.id));
        const unchanged = current && String(current.front || "").trim() === String(original.front || "").trim();
        const currentExamples = current ? normalizedExampleFields(current) : { sentence: "", translation: "" };
        const nextSentence = normalizeExampleLine(item?.example);
        const nextTranslation = normalizeExampleLine(item?.exampleTranslation);
        const materiallyChanged = nextSentence !== currentExamples.sentence
          || nextTranslation !== currentExamples.translation;
        if (!unchanged || !nextSentence || !nextTranslation || !materiallyChanged) {
          if (entry.attempts < EXAMPLE_MAX_ATTEMPTS) retryEntries.push(entry);
          else {
            failedCards.push(original);
            resolved += 1;
          }
          continue;
        }
        updates.push({
          entry,
          id: original.id,
          expectedFront: String(original.front || "").trim(),
          previousSentence: currentExamples.sentence,
          previousTranslation: currentExamples.translation,
          example: `${nextSentence}\n${nextTranslation}`,
          exampleSentence: nextSentence,
          exampleTranslation: nextTranslation,
          exampleTargetTerm: normalizeExampleLine(item.exampleTargetTerm),
        });
      }

      if (updates.length) {
        const savedIds = new Set();
        const ok = await mutateAndFlush(() => {
          if (!context.current() || !isCurrentAiJob(job)) throw new DOMException("stale", "AbortError");
          for (const update of updates) {
            if (!context.matches(update.entry.card)) continue;
            const card = getCardById(update.id);
            const storedExamples = card ? normalizedExampleFields(card) : null;
            const stillMatchesOriginal = storedExamples
              && storedExamples.sentence === update.previousSentence
              && storedExamples.translation === update.previousTranslation;
            if (card && String(card.front || "").trim() === update.expectedFront && stillMatchesOriginal) {
              card.example = update.example;
              card.exampleSentence = update.exampleSentence;
              card.exampleTranslation = update.exampleTranslation;
              card.exampleTargetTerm = update.exampleTargetTerm;
              card.updatedAt = Date.now();
              markCardDirty(card);
              savedIds.add(String(update.id));
            }
          }
        });
        if (!context.current() || !isCurrentAiJob(job)) throw new DOMException("stale", "AbortError");
        if (!ok) {
          const storageError = new Error("Failed to save refreshed examples");
          storageError.storageError = true;
          throw storageError;
        }
        updated += savedIds.size;
        resolved += savedIds.size;
        for (const update of updates) {
          if (savedIds.has(String(update.id))) continue;
          if (update.entry.attempts < EXAMPLE_MAX_ATTEMPTS) retryEntries.push(update.entry);
          else {
            failedCards.push(update.entry.card);
            resolved += 1;
          }
        }
      }

      pending.push(...retryEntries);
      setExampleRefreshBar(progress, updated);
      tweenExampleRefreshRing(sourceButton, updated / unique.length);
    }

    if (failedCards.length) {
      const names = failedCards.map(card => String(card.front || "").trim()).filter(Boolean).join(", ");
      toast(`${t("examples.donePartial", { updated, failed: failedCards.length })}${names ? `: ${names}` : ""}`, {
        error: true,
        duration: 12000,
      });
    } else {
      toast(t("examples.done", { n: updated }));
    }
  } catch (error) {
    if (!isAbortError(error)) {
      reportSaveError(error);
      toast(t("toast.saveFailed"), { error: true });
    }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      await removeExampleRefreshBar(progress, resolved >= unique.length && failedCards.length === 0);
      exampleRefreshRunning = false;
      buttons.forEach(button => {
        button.removeAttribute("aria-busy");
        button.classList.remove("loading");
      });
      cancelExampleRefreshRing();
      sourceButton?.classList.remove("example-refresh-progress");
      sourceButton?.style.removeProperty("--example-progress");
      renderBrowse();
      renderDecks();
      refreshDeckCardsModal();
    }
  }
}

function refreshDeckExamples(deckId, button) {
  const cards = activeCards(deckId);
  return refreshExamplesForCards(cards, button, deckId);
}

function refreshSelectedExamples() {
  const cards = activeCards().filter(card => bulkSelected.has(card.id));
  return refreshExamplesForCards(cards, $("#bulkRefreshExamplesBtn"));
}

function refreshStudyExamples(sourceButton = $("#edgeRefreshBtn")) {
  return refreshExamplesForCards(cardsForStudyExampleRefresh(), sourceButton);
}
/* ----- Word info (AI explanation of the current word) ----- */
let wordInfoCardId = null;

function wordInfoModalCard() {
  return wordInfoCardId ? getCardById(wordInfoCardId) : null;
}

/* Render the AI explanation as light, readable structure: numbered shades,
   bullet points, the "Похожие слова" block and quoted examples. */
function wordInfoInline(raw) {
  const re = /"([^"]*)"|\u201C([^\u201D]*)\u201D|\*\*([^*]+)\*\*/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    out += escape(raw.slice(last, m.index));
    if (m[1] !== undefined) out += `<span class="word-info-quote">«${escape(m[1])}»</span>`;
    else if (m[2] !== undefined) out += `<span class="word-info-quote">«${escape(m[2])}»</span>`;
    else out += `<strong>${escape(m[3])}</strong>`;
    last = m.index + m[0].length;
  }
  out += escape(raw.slice(last));
  return out;
}

function formatWordInfoHTML(text) {
  const lines = String(text || "").trim().split(/\n/);
  let html = "";
  let list = null;
  let step = 0;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) { closeList(); continue; }
    const header = trimmed.match(/^\**\s*(Похожие слова|Similar words)\s*\**\s*:?\s*$/i);
    const numbered = trimmed.match(/^(\d{1,2})[.)]\s+(.*)$/);
    const bulleted = trimmed.match(/^[-–—•]\s+(.*)$/);
    const nested = bulleted && /^\s/.test(line);
    if (header) {
      closeList();
      html += `<h3 class="word-info-subject">${wordInfoInline(header[1])}</h3>`;
    } else if (numbered) {
      if (list !== "ol") { closeList(); html += '<ol class="word-info-list">'; list = "ol"; }
      step += 1;
      html += `<li><span class="word-info-num" aria-hidden="true">${step}</span><span class="word-info-li">${wordInfoInline(numbered[2])}</span></li>`;
    } else if (bulleted) {
      const tag = nested ? "ul2" : "ul";
      if (list !== tag) { closeList(); html += `<ul class="${nested ? "word-info-nested" : "word-info-list"}">`; list = tag; }
      html += `<li><span class="word-info-dot" aria-hidden="true"></span><span class="word-info-li">${wordInfoInline(bulleted[1])}</span></li>`;
    } else {
      closeList();
      html += `<p class="word-info-para">${wordInfoInline(trimmed)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderWordInfoModal() {
  const modal = $("#wordInfoModal");
  if (!modal || modal.hidden) return;
  const card = wordInfoModalCard();
  if (!card) { closeDialog(modal); return; }
  const content = $("#wordInfoContent");
  const generateBtn = $("#wordInfoGenerateBtn");
  const refreshBtn = $("#wordInfoRefreshBtn");
  const busy = modal.dataset.busy === "1";
  $("#wordInfoWord").textContent = String(card.front || "").trim();
  if (busy) {
    content.textContent = t("study.info.generating");
    content.classList.remove("word-info-empty", "word-info-error");
    generateBtn.hidden = true;
    refreshBtn.hidden = true;
  } else {
    const info = String(card.info || "").trim();
    if (info) {
      content.innerHTML = formatWordInfoHTML(info);
      content.classList.remove("word-info-empty", "word-info-error");
      generateBtn.hidden = true;
      refreshBtn.hidden = false;
    } else {
      content.textContent = t("study.info.empty");
      content.classList.add("word-info-empty");
      content.classList.remove("word-info-error");
      generateBtn.hidden = false;
      refreshBtn.hidden = true;
    }
  }
}

function openWordInfo(card) {
  if (!card) return;
  wordInfoCardId = card.id;
  const modal = $("#wordInfoModal");
  delete modal.dataset.busy;
  if (window.applyI18N) window.applyI18N(modal);
  openDialog(modal, $("#wordInfoRefreshBtn").hidden ? $("#wordInfoGenerateBtn") : $("#wordInfoRefreshBtn"));
  renderWordInfoModal();
}

async function requestWordInfo() {
  const card = wordInfoModalCard();
  const modal = $("#wordInfoModal");
  if (!card || !modal || modal.hidden) return;
  if (!String(card.front || "").trim()) return;
  if (!String(state.settings.aiKey || "").trim()) {
    toast(t("examples.aiRequired"), { error: true });
    return;
  }
  const context = captureStudyAiContext([card]);
  const original = context.snapshots[0];
  if (!await prepareAiJob() || !context.matches(original)) return;
  const job = await startAiJob("word-info", `word-info:${card.id}`);
  if (!job) return;
  if (!context.matches(original)) { finishAiJob(job); return; }
  modal.dataset.busy = "1";
  renderWordInfoModal();
  try {
    const info = await window.LCAi.generateWordInfo(card, {
      provider: state.settings.aiProvider,
      key: state.settings.aiKey,
      model: state.settings.aiModel || undefined,
      temperature: state.settings.exampleTemperature,
      learningLanguage: context.aiLanguageOptions.learningLanguage,
      learningLangName: learningLangName(),
      signal: job.controller.signal,
      timeoutMs: AI_TIMEOUT_MS,
      retryAttempts: 1,
    });
    if (!isCurrentAiJob(job)) return;
    if (!context.matches(original)) return;
    const ok = await mutateAndFlush(() => {
      if (!isCurrentAiJob(job) || !context.matches(original)) throw new DOMException("stale", "AbortError");
      const stored = getCardById(original.id);
      if (!stored) throw new Error("Card not found");
      stored.info = info;
      stored.updatedAt = Date.now();
      markCardDirty(stored);
    });
    if (!isCurrentAiJob(job) || !context.current()) return;
    if (!ok) throw new Error("storage");
    updateEditorInfoBtn();
    if (wordInfoCardId !== card.id || modal.hidden) return;
    delete modal.dataset.busy;
    renderWordInfoModal();
  } catch (error) {
    if (isCurrentAiJob(job) && context.current() && !isAbortError(error) && !modal.hidden) {
      delete modal.dataset.busy;
      const content = $("#wordInfoContent");
      const card2 = wordInfoModalCard();
      content.textContent = `${t("study.info.failed")}${error?.message ? `: ${error.message}` : ""}`;
      content.classList.add("word-info-error");
      content.classList.remove("word-info-empty");
      const hasInfo = String(card2?.info || "").trim();
      $("#wordInfoGenerateBtn").hidden = !!hasInfo;
      $("#wordInfoRefreshBtn").hidden = !hasInfo;
    }
  } finally {
    if (ownsAiJob(job) && wordInfoCardId === original.id && !modal.hidden && modal.dataset.busy === "1") {
      delete modal.dataset.busy;
      renderWordInfoModal();
    }
    finishAiJob(job);
  }
}

$("#wordInfoGenerateBtn").onclick = requestWordInfo;
$("#wordInfoRefreshBtn").onclick = requestWordInfo;

/* Info button inside the card editor: opens the info sheet on top of the
   editor; dimmed when this card has no generated info yet. */
function updateEditorInfoBtn() {
  const btn = $("#editorInfoBtn");
  if (!btn) return;
  const card = editingCardId ? getCardById(editingCardId) : null;
  btn.classList.toggle("no-info", !(card && (card.info || "").trim()));
}

$("#editorInfoBtn").onclick = () => {
  const card = editingCardId ? getCardById(editingCardId) : null;
  if (!card) { toast(t("study.info.needSave")); return; }
  updateEditorInfoBtn();
  openWordInfo(card);
};


$("#editorInfoBtn").onclick = () => {
  const card = editingCardId ? getCardById(editingCardId) : null;
  if (!card) {
    toast(t("study.info.needSave"));
    return;
  }
  openWordInfo(card);
};

function updateEditorInfoBtn() {
  const btn = $("#editorInfoBtn");
  if (!btn) return;
  const card = editingCardId ? getCardById(editingCardId) : null;
  btn.classList.toggle("has-info", !!(card && String(card.info || "").trim()));
}
