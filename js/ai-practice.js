/* Lingo Cards — AI card generation and reading practice */

/* ----- AI generation ----- */
/* Language used for AI translations & example translations:
   always follows the interface language. */
const UI_LANG_NAMES = {
  uk: "Ukrainian", ru: "Russian", en: "English",
  de: "German", fr: "French", es: "Spanish", pl: "Polish",
};
function aiTargetLangName() {
  const code = (state.settings && state.settings.language) || window.I18N_LANG || "uk";
  return UI_LANG_NAMES[code] || "Ukrainian";
}

function applyAdvancedReviewState() {
  const show = !!state.settings.showAdvancedReview;
  ["#reviewAdvanced", "#reviewAdvanced2"].forEach(sel => {
    const el = $(sel);
    if (el) el.hidden = !show;
  });
  const btn = $("#reviewAdvancedToggle");
  if (btn) {
    btn.textContent = show ? t("settings.advanced.hide") : t("settings.advanced.show");
    btn.classList.toggle("active", show);
  }
}

function aiModelCacheKey(provider) { return `models_${provider}`; }

let aiModelsRequest = null;
let aiKeyTestRequest = null;

function cancelAiSettingsRequests() {
  const reason = new DOMException("settings changed", "AbortError");
  if (aiModelsRequest) aiModelsRequest.controller.abort(reason);
  if (aiKeyTestRequest && aiKeyTestRequest.id !== aiModelsRequest?.id) {
    aiKeyTestRequest.controller.abort(reason);
  }
  if (aiModelsRequest && ownsAiJob(aiModelsRequest)) finishAiJob(aiModelsRequest);
  if (aiKeyTestRequest && ownsAiJob(aiKeyTestRequest)) finishAiJob(aiKeyTestRequest);
  aiModelsRequest = null;
  aiKeyTestRequest = null;
}

function aiSettingsSnapshot() {
  return {
    language: state.settings?.language || window.I18N_LANG || "uk",
    mode: state.settings?.aiMode || "off",
    provider: $("#setAiProvider")?.value || "",
    key: $("#setAiKey")?.value.trim() || "",
    model: $("#setAiModel")?.value.trim() || "",
  };
}

function sameAiSettings(a, b, includeModel = true) {
  return a?.language === b?.language &&
    a?.mode === b?.mode &&
    a?.provider === b?.provider &&
    a?.key === b?.key &&
    (!includeModel || a?.model === b?.model);
}

function replaceAiSettingsRequest(current, kind) {
  current?.controller.abort(new DOMException("replaced", "AbortError"));
  return { id: uid(), kind, controller: new AbortController() };
}

function populateAiModels(provider, selected) {
  const sel = $("#setAiModel");
  if (!sel) return;
  const defaults = (window.LCAi?.MODEL_CATALOG || {})[provider] || [];
  const cache = (state.settings.aiModelCache || {})[provider] || [];
  const merged = [...new Set([...(cache || []), ...defaults].map(String).filter(Boolean))];
  const want = (selected || "").trim();
  if (want && !merged.includes(want)) merged.unshift(want);
  if (merged.length === 0) {
    const fallback = (window.LCAi?.PROVIDER_DEFAULTS || {})[provider]?.model;
    if (fallback) merged.push(fallback);
  }
  const def = (window.LCAi?.PROVIDER_DEFAULTS || {})[provider]?.model || merged[0] || "";
  const chosen = want || def;
  sel.innerHTML = merged.map(m => {
    const isDef = m === def;
    const label = isDef ? `${m} · ${t("settings.ai.recommended")}` : m;
    return `<option value="${escape(m)}"${m === chosen ? " selected" : ""}>${escape(label)}</option>`;
  }).join("");
  state.settings.aiModel = chosen;
}

async function refreshAiModels() {
  if (!await prepareAiJob("settings-models")) return;
  const snapshot = aiSettingsSnapshot();
  const { provider, key } = snapshot;
  const btn = $("#refreshAiModelsBtn");
  const statusEl = $("#aiTestStatus");
  const job = await startAiJob("settings-models", "settings:ai-models");
  if (!job) return;
  aiModelsRequest = job;
  const request = job;
  if (btn) { btn.setAttribute("aria-busy", "true"); btn.classList.add("loading"); }
  if (statusEl) { statusEl.hidden = false; statusEl.className = "ai-test-status"; statusEl.textContent = t("settings.ai.loadingModels"); }
  try {
    const list = await window.LCAi.fetchModelCatalog(provider, key, {
      signal: request.controller.signal,
      timeoutMs: AI_TIMEOUT_MS,
    });
    if (aiModelsRequest?.id !== request.id || !sameAiSettings(snapshot, aiSettingsSnapshot(), false)) return;
    if (!state.settings.aiModelCache) state.settings.aiModelCache = {};
    state.settings.aiModelCache[provider] = list;
    markSettingsDirty();
    save();
    populateAiModels(provider, state.settings.aiModel);
    if (statusEl) { statusEl.className = "ai-test-status success"; statusEl.textContent = t("settings.ai.modelsLoaded", { n: list.length }); }
  } catch (e) {
    if (isAbortError(e) || aiModelsRequest?.id !== request.id || !sameAiSettings(snapshot, aiSettingsSnapshot(), false)) return;
    if (statusEl) { statusEl.className = "ai-test-status error"; statusEl.textContent = t("settings.ai.modelsFail", { msg: shortErr(e) }); }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      aiModelsRequest = null;
      if (btn) { btn.removeAttribute("aria-busy"); btn.classList.remove("loading"); }
    }
  }
}

function renderAiRateInfo() {
  const el = $("#aiRateInfo");
  if (!el) return;
  const info = window.LCAi && window.LCAi.lastRateInfo;
  if (!info || !info.headers) { el.textContent = t("settings.ai.rateInfo.none"); return; }
  const h = info.headers;
  const remainReq = h["x-ratelimit-remaining-requests"];
  const remainTok = h["x-ratelimit-remaining-tokens"];
  const parts = [];
  if (remainReq != null) parts.push(t("settings.ai.rateInfo.requests", { n: remainReq }));
  if (remainTok != null) parts.push(t("settings.ai.rateInfo.tokens", { n: remainTok }));
  if (parts.length === 0) { el.textContent = t("settings.ai.rateInfo.unknown"); return; }
  const when = new Date(info.at).toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" });
  el.textContent = parts.join(" · ") + " · " + t("settings.ai.rateInfo.updated", { time: when });
}

async function testAiKey() {
  if (!await prepareAiJob("settings-key-test")) return;
  const statusEl = $("#aiTestStatus");
  const snapshot = aiSettingsSnapshot();
  const { provider, key, model } = snapshot;
  const targetLang = aiTargetLangName();

  const job = await startAiJob("settings-key-test", "settings:ai-key");
  if (!job) return;
  aiKeyTestRequest = job;
  const request = job;
  const btn = $("#aiTestBtn");
  if (btn) { btn.setAttribute("aria-busy", "true"); btn.classList.add("loading"); }
  if (!key) {
    finishAiJob(job);
    aiKeyTestRequest = null;
    if (btn) { btn.removeAttribute("aria-busy"); btn.classList.remove("loading"); }
    statusEl.hidden = false;
    statusEl.className = "ai-test-status error";
    statusEl.textContent = t("ai.noKey");
    return;
  }
  statusEl.hidden = false;
  statusEl.className = "ai-test-status";
  statusEl.textContent = t("settings.ai.testing");
  try {
    await window.LCAi.chatJson(
      provider,
      model || window.LCAi.PROVIDER_DEFAULTS?.[provider]?.model,
      key,
      "Return only valid JSON.",
      'Return exactly this JSON object: {"ok":true}',
      0,
      {
        signal: request.controller.signal,
        timeoutMs: AI_TIMEOUT_MS,
      }
    );
    if (aiKeyTestRequest?.id !== request.id || !sameAiSettings(snapshot, aiSettingsSnapshot())) return;
    statusEl.className = "ai-test-status success";
    statusEl.textContent = t("settings.ai.testOk");
    renderAiRateInfo();
  } catch (e) {
    if (isAbortError(e) || aiKeyTestRequest?.id !== request.id || !sameAiSettings(snapshot, aiSettingsSnapshot())) return;
    statusEl.className = "ai-test-status error";
    statusEl.textContent = t("settings.ai.testFail", { msg: shortErr(e) });
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      aiKeyTestRequest = null;
      if (btn) { btn.removeAttribute("aria-busy"); btn.classList.remove("loading"); }
    }
  }
}

function shortErr(e) {
  const m = String(e?.message || e || "");
  return m.length > 140 ? m.slice(0, 140) + "…" : m;
}

async function generateCard() {
  if (!await prepareAiJob("card-generation")) return;
  const word = $("#edFront").value.trim();
  const statusEl = $("#aiStatus");
  const btn = $("#aiGenBtn");
  const editorContext = `editor:${editingCardId || "new"}`;
  const job = await startAiJob("card-generation", editorContext);
  if (!job) return;
  if (!word) {
    finishAiJob(job);
    statusEl.className = "ai-status error";
    statusEl.textContent = t("ai.needFront");
    return;
  }
  const deckIdAtStart = $("#edDeck").value;
  const wordAtStart = word;
  btn.setAttribute("aria-busy", "true");
  btn.classList.add("loading");
  statusEl.className = "ai-status";
  statusEl.textContent = t("ai.generating");
  $("#aiSpin")?.classList.add("spinning");

  try {
    const data = await window.LCAi.generate(word, {
      mode: state.settings.aiMode,
      provider: state.settings.aiProvider,
      key: state.settings.aiKey,
      model: state.settings.aiModel || undefined,
      targetLang: aiTargetLangName(),
      sourceLang: "English",
      targetLangCode: state.settings.language || "uk",
      signal: job.controller.signal,
      timeoutMs: AI_TIMEOUT_MS,
    });
    if (!isCurrentAiJob(job) || $("#editorModal").hidden || $("#edFront").value.trim() !== wordAtStart || $("#edDeck").value !== deckIdAtStart) return;

    const setAlways = (sel, val) => {
      const el = $(sel);
      if (el && val) {
        el.value = val;
        resizeEditorTextarea(el);
        flash(el);
      }
    };
    setAlways("#edBack", data.back);
    const generatedExample = {
      sentence: String(data.example || "").trim(),
      translation: String(data.exampleTranslation || "").trim(),
      targetTerm: String(data.exampleTargetTerm || "").trim(),
    };
    generatedExample.displayValue = [generatedExample.sentence, generatedExample.translation].filter(Boolean).join("\n");
    editorGeneratedExample = generatedExample;
    setAlways("#edExample", generatedExample.displayValue);
    setAlways("#edHint", String(data.ipa || "").trim());
    statusEl.className = "ai-status success";
    statusEl.textContent = t("ai.filled");
  } catch (e) {
    if (isAbortError(e)) return;
    if (!isCurrentAiJob(job)) return;
    statusEl.className = "ai-status error";
    statusEl.textContent = `${t("ai.failed")}: ${shortErr(e)}`;
    toast(statusEl.textContent, { error: true });
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      btn.removeAttribute("aria-busy");
      btn.classList.remove("loading");
      $("#aiSpin")?.classList.remove("spinning");
    }
  }
}

/* ========================================================================
   Reading practice — AI-generated text from your reviewed words + Q&A
   ======================================================================== */
let practiceState = {
  step: "setup",
  period: "last",
  selectedIds: null,  // null = use all from pool; otherwise Set of card ids
  deckId: "",
  count: "8",
  level: "auto",
  format: "story",
  words: [],          // [{front, back}]
  payload: null,      // { title, text, glossary, questions:[{q, hint}] }
  answers: [],        // user answers (strings) per question
  feedback: null,
  revision: 0,
};

const PRACTICE_LEVELS = {
  auto: {
    label: "adaptive (infer the most suitable CEFR level from the target words, but keep it accessible to a language learner)",
    length: "180–280 words",
  },
  A1: {
    label: "CEFR A1 beginner: very common vocabulary, short simple sentences, present tense where natural, and explicit connections",
    length: "100–140 words",
  },
  A2: {
    label: "CEFR A2 elementary: common vocabulary, straightforward sentences, familiar situations, and limited subordination",
    length: "130–180 words",
  },
  B1: {
    label: "CEFR B1 intermediate: clear standard English, varied everyday vocabulary, connected paragraphs, and some inference",
    length: "170–230 words",
  },
  B2: {
    label: "CEFR B2 upper-intermediate: varied vocabulary, natural complex sentences, nuanced connections, and meaningful inference",
    length: "220–300 words",
  },
  C1: {
    label: "CEFR C1 advanced: precise and idiomatic vocabulary, sophisticated syntax, implicit meaning, and nuanced argument or narration",
    length: "280–380 words",
  },
};

const PRACTICE_FORMATS = {
  story: "a coherent narrative story with a clear setting, progression, and ending",
  dialogue: "a natural dialogue between two or more named speakers; most of the text must be spoken turns with only minimal scene-setting",
  article: "a structured informative article with a descriptive title and 2–4 concise paragraphs; do not turn it into a fictional story",
};

function practiceGenerationInstructions(level, format) {
  const safeLevel = Object.prototype.hasOwnProperty.call(PRACTICE_LEVELS, level) ? level : "auto";
  const safeFormat = Object.prototype.hasOwnProperty.call(PRACTICE_FORMATS, format) ? format : "story";
  const levelConfig = PRACTICE_LEVELS[safeLevel];
  return {
    level: safeLevel,
    format: safeFormat,
    prompt: `Difficulty: ${levelConfig.label}.\nLength: ${levelConfig.length}.\nFormat: ${PRACTICE_FORMATS[safeFormat]}.`,
  };
}

function bumpPracticeRevision() {
  practiceState.revision = (Number(practiceState.revision) || 0) + 1;
  return practiceState.revision;
}

function cancelPracticeCheck(reason = "practice changed") {
  bumpPracticeRevision();
  if (activeAiJob?.kind === "practice-check") {
    activeAiJob.controller.abort(new DOMException(reason, "AbortError"));
  }
}

function currentPracticeAnswerSnapshot() {
  return $$("#practiceQuestions textarea").map(el => el.value.trim());
}

function practiceCheckSnapshotIsCurrent(snapshot) {
  if (!snapshot || practiceState.revision !== snapshot.revision) return false;
  if (practiceContextId() !== snapshot.contextId || practiceState.step !== "run") return false;
  if ($("#practiceModal")?.hidden) return false;
  return JSON.stringify(currentPracticeAnswerSnapshot()) === snapshot.answersSignature;
}

function clonePracticePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  return {
    title: String(payload.title || ""),
    text: String(payload.text || payload.story || ""),
    glossary: sanitizeGlossary(payload.glossary),
    questions: rawQuestions.map(q => {
      if (typeof q === "string") return { q: q.trim(), hint: "" };
      if (!q || typeof q !== "object" || Array.isArray(q)) return null;
      return {
        q: String(q.q || q.question || "").trim(),
        hint: String(q.hint || "").trim(),
      };
    }).filter(q => q?.q),
  };
}

function normalizePracticePayload(payload) {
  return clonePracticePayload(payload);
}

function sanitizeGlossary(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100)
    .filter(item => item && typeof item === "object" && !Array.isArray(item))
    .map(item => ({
      word: typeof item.word === "string" ? item.word.trim().slice(0, 1000) : "",
      meaning: typeof (item.meaning ?? item.translation) === "string"
        ? String(item.meaning ?? item.translation).trim().slice(0, 100000)
        : "",
    }))
    .filter(item => item.word && item.meaning);
}

function sampleRandom(items, count) {
  const copy = Array.isArray(items) ? [...items] : [];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, count));
}

function practiceContextId() {
  return practiceState.id ? `practice:${practiceState.id}` : "practice:draft";
}

function practiceSnapshot() {
  return {
    step: practiceState.step || "setup",
    period: practiceState.period || "last",
    selectedIds: practiceState.selectedIds ? [...practiceState.selectedIds] : [],
    deckId: practiceState.deckId || "",
    count: practiceState.count || "8",
    level: practiceState.level || "auto",
    format: practiceState.format || "story",
    words: Array.isArray(practiceState.words) ? practiceState.words.map(w => ({
      front: String(w.front || ""),
      back: String(w.back || ""),
    })) : [],
    payload: clonePracticePayload(practiceState.payload),
    answers: Array.isArray(practiceState.answers) ? [...practiceState.answers] : [],
    feedback: practiceState.feedback ? JSON.parse(JSON.stringify(practiceState.feedback)) : null,
    revision: Number(practiceState.revision) || 0,
    practiceDays: practiceDayWindow(),
    updatedAt: Date.now(),
  };
}

function persistPracticeDraft() {
  if (!state) return;
  state.practiceDraft = practiceSnapshot();
  markMetaDirty();
  save();
}

function restorePracticeDraft() {
  const draft = state && state.practiceDraft;
  if (!draft) return false;
  practiceState = {
    step: draft.step || "setup",
    period: draft.period || "last",
    selectedIds: (Array.isArray(draft.selectedIds) && draft.selectedIds.length)
      ? new Set(draft.selectedIds)
      : null,
    deckId: draft.deckId || "",
    count: String(draft.count || "8"),
    level: draft.level || "auto",
    format: draft.format || "story",
    words: Array.isArray(draft.words) ? draft.words.map(w => ({
      front: String(w.front || ""),
      back: String(w.back || ""),
    })) : [],
    payload: clonePracticePayload(draft.payload),
    answers: Array.isArray(draft.answers) ? [...draft.answers] : [],
    feedback: draft.feedback ? JSON.parse(JSON.stringify(draft.feedback)) : null,
    revision: Number(draft.revision) || 0,
  };
  return true;
}

function clearPracticeDraft() {
  if (!state) return;
  delete state.practiceDraft;
  markMetaDirty();
  save();
}

function practiceDayWindow() {
  const v = parseInt((state.settings && state.settings.practiceDays) || 7, 10);
  return Math.min(180, Math.max(1, isNaN(v) ? 7 : v));
}

function practiceWordPool(period, deckId) {
  const now = Date.now();
  const inDeck = c => !deckId || c.deckId === deckId;
  // Only basic/reverse cards with a real word make sense here.
  const usable = c => c.type !== "cloze" && c.front && c.front.trim();

  if (period === "last") {
    const ids = Array.isArray(state.sessionReviewedIds) ? state.sessionReviewedIds : [];
    return activeCards(deckId || null).filter(c => ids.includes(c.id) && usable(c));
  }
  let cutoff = 0;
  if (period === "days") {
    cutoff = now - practiceDayWindow() * DAY_MS;
  } else cutoff = 0; // all

  return activeCards(deckId || null).filter(c => {
    if (!usable(c)) return false;
    if (c.reps <= 0 && !c.lastReview) return false;
    if (period === "all") return c.reps > 0 || !!c.lastReview;
    return c.lastReview && c.lastReview >= cutoff;
  });
}

/* Words actually chosen for generation: respects manual selection. */
function practiceChosenCards(deckId) {
  const pool = practiceWordPool(practiceState.period, deckId);
  if (!practiceState.selectedIds || practiceState.selectedIds.size === 0) return pool;
  return pool.filter(c => practiceState.selectedIds.has(c.id));
}

function updatePracticeCounts() {
  const deckId = $("#practiceDeck")?.value || null;
  ["last", "all", "days"].forEach(p => {
    const el = document.querySelector(`[data-period-count="${p}"]`);
    if (el) el.textContent = practiceWordPool(p, deckId).length;
  });
  // Days slider label
  const daysValue = $("#practiceDaysValue");
  if (daysValue) daysValue.textContent = practiceDayWindow();
  const daysInput = $("#practiceDays");
  if (daysInput && String(daysInput.value) !== String(practiceDayWindow())) daysInput.value = practiceDayWindow();

  // Highlight active period control
  $$("#practicePeriod .period-opt").forEach(b => b.classList.toggle("active", b.dataset.period === practiceState.period));
  const daysRow = document.querySelector(".practice-days-row");
  if (daysRow) daysRow.classList.toggle("active", practiceState.period === "days");

  renderPracticeWordPreview(deckId);

  // History toggle
  const hist = Array.isArray(state.settings.practiceHistory) ? state.settings.practiceHistory : [];
  const histCount = $("#practiceHistoryCount");
  if (histCount) histCount.textContent = hist.length;
  const histBlock = document.querySelector(".practice-history-block");
  if (histBlock) histBlock.hidden = hist.length === 0;
}

function renderPracticeWordPreview(deckId) {
  const pool = practiceWordPool(practiceState.period, deckId);
  const preview = $("#practiceWordPreview");
  const note = $("#practiceSelectionNote");
  if (!preview) return;

  // Drop selection ids that are no longer in the pool
  if (practiceState.selectedIds) {
    const poolIds = new Set(pool.map(c => c.id));
    for (const id of [...practiceState.selectedIds]) if (!poolIds.has(id)) practiceState.selectedIds.delete(id);
    if (practiceState.selectedIds.size === 0) practiceState.selectedIds = null;
  }

  if (pool.length === 0) {
    preview.innerHTML = `<span class="practice-empty">${escape(t("practice.noWords"))}</span>`;
    if (note) note.textContent = "";
    return;
  }

  const selected = practiceState.selectedIds;
  preview.replaceChildren();
  for (const c of pool) {
    const on = !selected || selected.has(c.id);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `practice-chip selectable${on ? " on" : ""}`;
    chip.dataset.cardId = c.id;
    const visual = difficultyStyle(c);
    chip.dataset.difficultyScore = String(visual.score);
    chip.style.setProperty("--difficulty-bg", visual.background);
    chip.style.setProperty("--difficulty-border", visual.border);
    chip.style.setProperty("--difficulty-fg", visual.foreground);
    chip.title = String(c.back || "");
    chip.textContent = String(c.front || "");
    preview.appendChild(chip);
  }

  preview.querySelectorAll(".practice-chip.selectable").forEach(chip => {
    chip.onclick = () => {
      const id = chip.dataset.cardId;
      if (!practiceState.selectedIds) {
        // First explicit pick: select only this one.
        practiceState.selectedIds = new Set([id]);
      } else if (practiceState.selectedIds.has(id)) {
        practiceState.selectedIds.delete(id);
        if (practiceState.selectedIds.size === 0) practiceState.selectedIds = null;
      } else {
        practiceState.selectedIds.add(id);
      }
      persistPracticeDraft();
      renderPracticeWordPreview(deckId);
    };
  });

  const chosen = practiceChosenCards(deckId).length;
  if (note) {
    note.textContent = selected
      ? t("practice.words.selected", { n: chosen })
      : t("practice.words.hint");
  }
  const clearBtn = $("#practiceClearSelectionBtn");
  if (clearBtn) clearBtn.hidden = !selected;
}

function openPractice() {
  const s = state.settings;
  if (s.aiMode !== "ai" || !s.aiKey) {
    toast(t("practice.needAi"), { error: true });
    navigateToSettings("generation", { focus: "setAiMode" });
    return;
  }

  // Build deck selector
  const deckSel = $("#practiceDeck");
  deckSel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = ""; allOpt.textContent = t("browse.allDecks");
  deckSel.appendChild(allOpt);
  const practiceDecks = activeDecks();
  for (const d of practiceDecks) {
    const o = document.createElement("option");
    o.value = d.id; o.textContent = d.name;
    deckSel.appendChild(o);
  }

  // Try to restore an in-progress session; otherwise start fresh.
  const hasDraft = restorePracticeDraft();
  if (hasDraft) {
    // Restore the saved deck selection (fall back to "all" if the deck is gone).
    const savedDeck = practiceState.deckId || "";
    deckSel.value = practiceDecks.some(d => d.id === savedDeck) ? savedDeck : "";
    practiceState.deckId = deckSel.value;
    syncPracticeFormFromState();
    applyI18NSafe($("#practiceModal"));
    openDialog($("#practiceModal"), $("#practiceDeck"));
    renderPracticeHistory();

    const step = practiceState.step || "setup";
    if (step === "run" && practiceState.payload && practiceState.payload.text) {
      practiceShowStep("run");
      $("#practiceLoading").hidden = true;
      renderPracticeStory();
      restorePracticeAnswers();
    } else if (step === "result" && practiceState.payload && practiceState.feedback) {
      practiceShowStep("run");
      $("#practiceLoading").hidden = true;
      renderPracticeStory();
      restorePracticeAnswers();
      practiceShowStep("result");
      $("#practiceChecking").hidden = true;
      renderPracticeFeedback(practiceState.feedback);
    } else {
      practiceShowStep("setup");
      updatePracticeCounts();
    }
    return;
  }

  deckSel.value = state.activeDeckId || "";
  practiceState.deckId = deckSel.value;
  practiceState.period = (Array.isArray(state.sessionReviewedIds) && state.sessionReviewedIds.length) ? "last" : "days";
  practiceState.selectedIds = null;
  practiceState.payload = null;
  practiceState.answers = [];
  practiceState.feedback = null;

  practiceShowStep("setup");
  updatePracticeCounts();
  renderPracticeHistory();
  applyI18NSafe($("#practiceModal"));
  openDialog($("#practiceModal"), $("#practiceDeck"));
}

/* Mirror the saved practiceState onto the setup form controls. */
function syncPracticeFormFromState() {
  const deckSel = $("#practiceDeck");
  if (deckSel) deckSel.value = practiceState.deckId || "";
  const countSel = $("#practiceCount");
  if (countSel && practiceState.count) countSel.value = String(practiceState.count);
  const levelSel = $("#practiceLevel");
  if (levelSel && practiceState.level) levelSel.value = practiceState.level;
  const formatSel = $("#practiceFormat");
  if (formatSel && practiceState.format) formatSel.value = practiceState.format;
}

/* Re-fill the answer textareas from the saved answers. */
function restorePracticeAnswers() {
  const answers = Array.isArray(practiceState.answers) ? practiceState.answers : [];
  $$("#practiceQuestions .practice-answer").forEach(ta => {
    const i = +ta.dataset.qi;
    if (answers[i] != null) ta.value = answers[i];
  });
}

function applyI18NSafe(root) {
  if (window.applyI18N) window.applyI18N(root || document);
}

function practiceShowStep(step) {
  if (practiceState.step !== step) cancelPracticeCheck("practice navigation");
  practiceState.step = step;
  $("#practiceSetup").hidden  = step !== "setup";
  $("#practiceRun").hidden    = step !== "run";
  $("#practiceResult").hidden = step !== "result";

  $("#practiceStartBtn").hidden = step !== "setup";
  $("#practiceCheckBtn").hidden = step !== "run";
  $("#practiceAgainBtn").hidden = step === "setup";
  $("#practiceBackBtn").hidden  = step === "setup";
  persistPracticeDraft();
}

function closePractice() {
  cancelPracticeCheck("practice closed");
  cancelAiJobsForContext(practiceContextId());
  closeDialog($("#practiceModal"));
}

async function practiceGenerate() {
  if (!await prepareAiJob("practice-generate")) return;
  const s = state.settings;
  if (s.aiMode !== "ai" || !s.aiKey) {
    const st = $("#practiceSetupStatus");
    st.hidden = false; st.className = "ai-status error";
    st.textContent = t("practice.aiRequired");
    return;
  }

  const deckId = $("#practiceDeck").value;
  const period = practiceState.period || "days";
  practiceState.period = period;
  practiceState.deckId = deckId;
  const count = Math.max(2, Math.min(20, Number($("#practiceCount").value) || 8));
  const level = $("#practiceLevel")?.value || practiceState.level || "auto";
  const format = $("#practiceFormat")?.value || practiceState.format || "story";
  const generation = practiceGenerationInstructions(level, format);
  practiceState.count = String(count);
  practiceState.level = generation.level;
  practiceState.format = generation.format;
  const pool = practiceChosenCards(deckId);
  if (pool.length === 0) {
    const st = $("#practiceSetupStatus");
    st.hidden = false; st.className = "ai-status error";
    st.textContent = t("practice.empty");
    return;
  }

  const chosen = sampleRandom(pool, Math.min(count, pool.length));
  const targetWords = chosen.map(c => ({ word: c.front, translation: c.back || "" }));
  const contextId = `practice:draft:${uid()}`;
  practiceState.id = contextId.slice("practice:".length);
  const job = await startAiJob("practice-generate", contextId);
  if (!job) return;
  const btn = $("#practiceStartBtn");
  const st = $("#practiceSetupStatus");
  btn.classList.add("loading");
  btn.textContent = t("practice.generating");
  st.hidden = false; st.className = "ai-status"; st.textContent = t("practice.generating");

  const sys = `You create compact reading-comprehension exercises for language learners.
Output ONLY valid JSON. No prose, markdown, or code fences.`;
  const prompt = `Write one English reading-comprehension text using ALL target words below.
${generation.prompt}
Bold each target word with **double asterisks** in the text.
Then create exactly 3 comprehension questions in English about the text. Questions must test understanding of context (mix of meaning, inference, and usage). Questions should be open-ended (short answer), not multiple choice.
Also return a glossary: for each target word give its translation exactly as provided.

Target words:
${targetWords.map((x, i) => `${i + 1}. ${x.word} — ${x.translation}`).join("\n")}

Return JSON with this exact shape:
{"title":"...","story":"...","questions":[{"q":"...","hint":"..."},{"q":"...","hint":"..."},{"q":"...","hint":"..."}],"glossary":[{"word":"...","meaning":"..."}]}`;

  try {
    const data = await window.LCAi.chatJson(s.aiProvider, s.aiModel || undefined, s.aiKey, sys, prompt, 0.7, {
      signal: job.controller.signal,
      timeoutMs: AI_TIMEOUT_MS,
    });
    if (!isCurrentAiJob(job) || $("#practiceModal").hidden || practiceContextId() !== contextId) return;
    const payload = normalizePracticePayload(data);
    if (!payload?.text || payload.questions.length < 3) throw new Error("Invalid response");
    payload.questions = payload.questions.slice(0, 3);
    practiceState.period = period;
    practiceState.deckId = deckId;
    practiceState.words = chosen.map(c => ({ front: String(c.front || ""), back: String(c.back || "") }));
    practiceState.payload = payload;
    practiceState.answers = [];
    practiceState.feedback = null;
    st.hidden = true;
    renderPracticeRun();
  } catch (error) {
    if (!isAbortError(error) && isCurrentAiJob(job)) {
      st.hidden = false; st.className = "ai-status error";
      st.textContent = `${t("practice.failed")} — ${shortErr(error)}`;
      toast(`${t("practice.failed")} — ${shortErr(error)}`, { error: true });
    }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      btn.classList.remove("loading");
      btn.textContent = t("practice.start");
    }
  }
}

function renderPracticeRun() {
  practiceShowStep("run");
  $("#practiceFeedback").hidden = true;
  $("#practiceFeedback").replaceChildren();
  renderPracticeStory();
  persistPracticeDraft();
}

function renderPracticeStory() {
  const p = clonePracticePayload(practiceState.payload);
  if (!p) return;
  practiceState.payload = p;
  $("#practiceLoading").hidden = true;

  const storyEl = $("#practiceStory");
  const bodyHTML = escape(p.text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="practice-target">$1</strong>')
    .replace(/\n+/g, "</p><p>");
  let glossHTML = "";
  if (p.glossary.length) {
    glossHTML = `<div class="practice-glossary"><div class="practice-glossary-title">${escape(t("practice.glossary"))}</div>` +
      p.glossary.map(g => `<div class="gloss-item"><b>${escape(g.word)}</b> — ${escape(g.meaning)}</div>`).join("") +
      `</div>`;
  }
  storyEl.innerHTML =
    (p.title ? `<h3 class="practice-story-title">${escape(p.title)}</h3>` : "") +
    `<div class="practice-story-body"><p>${bodyHTML}</p></div>` +
    glossHTML +
    `<button class="btn ghost small practice-tts" id="practiceTtsBtn" type="button">🔊 ${escape(t("practice.listen"))}</button>`;
  storyEl.hidden = false;

  $("#practiceTtsBtn").onclick = () => speak(p.text.replace(/\*\*/g, ""));

  // Questions
  const qWrap = $("#practiceQuestions");
  if (!p.questions || p.questions.length === 0) {
    qWrap.hidden = true;
    qWrap.innerHTML = "";
    $("#practiceCheckBtn").hidden = true;
    $("#practiceAgainBtn").hidden = false;
    $("#practiceBackBtn").hidden = false;
    $("#practiceRun").scrollTop = 0;
    return;
  }
  qWrap.innerHTML =
    `<div class="practice-q-title">${escape(t("practice.questionsTitle"))}</div>` +
    p.questions.map((q, i) => `
      <div class="practice-q">
        <label class="practice-q-label">${i + 1}. ${escape(q.q)}</label>
        <textarea class="practice-answer" data-qi="${i}" rows="2" data-i18n-ph="practice.answerPh" placeholder="${escape(t("practice.answerPh"))}">${escape(practiceState.answers[i] || "")}</textarea>
      </div>`).join("");
  qWrap.hidden = false;
  qWrap.querySelectorAll(".practice-answer").forEach(ta => {
    ta.addEventListener("input", e => {
      cancelPracticeCheck("answers changed");
      practiceState.answers[+e.target.dataset.qi] = e.target.value;
      practiceState.feedback = null;
      persistPracticeDraft();
    });
  });

  $("#practiceCheckBtn").hidden = false;
  $("#practiceAgainBtn").hidden = false;
  $("#practiceBackBtn").hidden = false;
  $("#practiceRun").scrollTop = 0;
}

async function practiceCheck() {
  if (!await prepareAiJob("practice-check")) return;
  const s = state.settings;
  if (s.aiMode !== "ai" || !s.aiKey) return;
  const p = practiceState.payload;
  if (!p) return;
  const answers = $$("#practiceQuestions textarea").map((el, i) => ({ question: p.questions[i].q, answer: el.value.trim() }));
  if (answers.some(x => !x.answer)) { toast(t("practice.answerAll"), { error: true }); return; }

  practiceState.answers = answers.map(x => x.answer);
  practiceState.feedback = null;
  const contextId = practiceContextId();
  const revision = bumpPracticeRevision();
  const checkSnapshot = {
    contextId,
    revision,
    answersSignature: JSON.stringify(answers.map(x => x.answer)),
  };
  persistPracticeDraft();
  const job = await startAiJob("practice-check", contextId);
  if (!job) return;
  const btn = $("#practiceCheckBtn");
  const fb = $("#practiceFeedback");
  btn.classList.add("loading"); btn.textContent = t("practice.checking");
  fb.hidden = false; fb.innerHTML = `<div class="ai-status">${escape(t("practice.checking"))}</div>`;

  const sys = `You evaluate reading-comprehension answers for language learners: both the content of each answer and the grammatical correctness of the learner's wording. Output ONLY valid JSON.`;
  const prompt = `Story:
${p.text}

Questions and answers (JSON):
${JSON.stringify(answers, null, 2)}

Return JSON with this shape:
{"items":[{"verdict":"correct|partial|incorrect","feedback":"brief helpful feedback","model":"a concise model answer","grammar":{"verdict":"correct|partial|incorrect","note":"brief note about grammar mistakes in the learner's answer wording; empty string if grammar is fine"}}],"summary":"one brief encouraging overall comment"}
"verdict" grades ONLY the meaning/content of the answer. "grammar.verdict" grades ONLY the grammatical correctness of how the learner wrote the answer: "correct" = no mistakes, "partial" = minor mistakes (articles, minor word forms), "incorrect" = serious grammar mistakes. Judge grammar independently from content.
The items array must match the question order and length.`;
  try {
    const data = await window.LCAi.chatJson(s.aiProvider, s.aiModel || undefined, s.aiKey, sys, prompt, 0.3, {
      signal: job.controller.signal,
      timeoutMs: AI_TIMEOUT_MS,
    });
    if (!isCurrentAiJob(job) || !practiceCheckSnapshotIsCurrent(checkSnapshot)) return;
    const result = normalizePracticeResult(data);
    if (!practiceCheckSnapshotIsCurrent(checkSnapshot)) return;
    practiceState.answers = answers.map(x => x.answer);
    showPracticeFeedback(result);
    addPracticeHistory({
      id: uid(), createdAt: Date.now(), period: practiceState.period, deckId: practiceState.deckId,
      words: [...practiceState.words], payload: normalizePracticePayload(practiceState.payload),
      answers: [...practiceState.answers], results: result,
    });
  } catch (error) {
    if (!isAbortError(error) && isCurrentAiJob(job)) {
      fb.hidden = false;
      fb.innerHTML = `<div class="ai-status error">${escape(t("practice.checkFail"))} — ${escape(shortErr(error))}</div>`;
      toast(`${t("practice.checkFail")} — ${shortErr(error)}`, { error: true });
    }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      btn.classList.remove("loading");
      btn.textContent = t("practice.check");
    }
  }
}

function normalizePracticeGrammar(raw) {
  if (!raw || typeof raw !== "object") return null;
  const allowed = new Set(["correct", "partial", "incorrect"]);
  const verdict = allowed.has(raw.verdict) ? raw.verdict : null;
  const note = String(raw.note || "").slice(0, 10000);
  if (!verdict && !note) return null;
  return { verdict: verdict || "partial", note };
}

function normalizePracticeResult(data) {
  const questionCount = practiceState.payload?.questions?.length || 0;
  const allowedVerdicts = new Set(["correct", "partial", "incorrect"]);
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = Array.from({ length: questionCount }, (_, index) => {
    const item = rawItems[index] || {};
    return {
      verdict: allowedVerdicts.has(item.verdict) ? item.verdict : "partial",
      feedback: String(item.feedback || "").slice(0, 10000),
      model: String(item.model || item.modelAnswer || "").slice(0, 10000),
      grammar: normalizePracticeGrammar(item.grammar),
    };
  });
  return {
    score: Number.isFinite(Number(data?.score))
      ? Math.max(0, Math.min(questionCount, Math.round(Number(data.score))))
      : items.filter(item => item.verdict === "correct").length,
    total: questionCount,
    summary: String(data?.summary || "").slice(0, 10000),
    items,
  };
}

function showPracticeFeedback(result) {
  practiceShowStep("result");
  renderPracticeFeedback(result);
}

function addPracticeHistory(entry) {
  const payload = normalizePracticePayload(entry?.payload);
  if (!payload?.text) return;
  if (!Array.isArray(state.settings.practiceHistory)) state.settings.practiceHistory = [];
  const words = Array.isArray(entry.words)
    ? entry.words.map(word => String(word?.front ?? word ?? "")).filter(Boolean)
    : [];
  state.settings.practiceHistory.unshift({
    id: String(entry.id || uid()),
    at: Number(entry.createdAt || Date.now()),
    title: payload.title,
    text: payload.text,
    glossary: payload.glossary,
    words,
  });
  markPracticeHistoryDirty(state.settings.practiceHistory[0]);
  if (state.settings.practiceHistory.length > PRACTICE_HISTORY_MAX) {
    const removed = state.settings.practiceHistory.splice(PRACTICE_HISTORY_MAX);
    removed.forEach(entry => markPracticeHistoryDeleted(entry.id));
  }
  save();
}

function deletePracticeHistoryEntry(id) {
  if (!id || !Array.isArray(state.settings.practiceHistory)) return;
  const index = state.settings.practiceHistory.findIndex(entry => entry.id === id);
  if (index < 0) return;
  state.settings.practiceHistory.splice(index, 1);
  markPracticeHistoryDeleted(id);
}

function renderPracticeFeedback(data) {
  $("#practiceChecking").hidden = true;
  const allowedVerdicts = new Set(["correct", "partial", "incorrect"]);
  const p = practiceState.payload;
  const rawItems = data && Array.isArray(data.items) ? data.items : [];
  const items = rawItems.slice(0, p.questions.length).map(item => ({
    verdict: allowedVerdicts.has(item && item.verdict) ? item.verdict : "partial",
    feedback: String(item && item.feedback || "").slice(0, 10000),
    model: String(item && item.model || "").slice(0, 10000),
    grammar: normalizePracticeGrammar(item && item.grammar),
  }));
  const safeData = {
    score: Number.isFinite(Number(data && data.score)) ? Math.max(0, Math.min(p.questions.length, Math.round(Number(data.score)))) : items.filter(i => i.verdict === "correct").length,
    total: p.questions.length,
    summary: String(data && data.summary || "").slice(0, 10000),
    items,
  };
  practiceState.feedback = safeData;
  persistPracticeDraft();
  const total = safeData.total;
  const score = safeData.score;
  const pct = total ? Math.max(0, Math.min(100, Math.round((score / total) * 100))) : 0;

  const verdictLabel = v => t("practice.verdict." + v);
  const html = `
    <div class="practice-scorecard">
      <div class="practice-score-ring" data-score-pct="${pct}">
        <span>${score}/${total}</span>
      </div>
      <div class="practice-score-text">
        <div class="practice-score-head">${escape(t("practice.scoreHead"))}</div>
        <div class="practice-score-sum">${escape(safeData.summary)}</div>
      </div>
    </div>
    <div class="practice-feedback-list">
      ${p.questions.map((q, i) => {
        const it = items[i] || { verdict: "partial", feedback: "", model: "" };
        const v = it.verdict;
        return `
        <div class="practice-fb-item ${v}">
          <div class="practice-fb-q">${i + 1}. ${escape(q.q)}</div>
          <div class="practice-fb-your"><span>${escape(t("practice.yourAnswer"))}:</span> ${escape(practiceState.answers[i] || "—")}</div>
          <div class="practice-fb-verdict ${v}">${escape(verdictLabel(v))}</div>
          ${it.feedback ? `<div class="practice-fb-text">${escape(it.feedback)}</div>` : ""}
          ${it.grammar ? `<div class="practice-fb-grammar ${it.grammar.verdict}"><span>${escape(t("practice.grammar"))}:</span> ${escape(t("practice.grammar." + it.grammar.verdict))}${it.grammar.note ? ` — ${escape(it.grammar.note)}` : ""}</div>` : ""}
          ${it.model ? `<div class="practice-fb-model"><span>${escape(t("practice.modelAnswer"))}:</span> ${escape(it.model)}</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
  const fb = $("#practiceFeedback");
  fb.innerHTML = html;
  const scoreRing = fb.querySelector(".practice-score-ring");
  if (scoreRing) scoreRing.style.setProperty("--pct", String(pct));
  fb.hidden = false;
  $("#practiceResult").scrollTop = 0;
}

function practiceBack() {
  if (!$("#practiceResult").hidden) {
    // From feedback back to the questions
    practiceShowStep("run");
    $("#practiceCheckBtn").hidden = false;
  } else {
    practiceShowStep("setup");
    updatePracticeCounts();
  }
}

const PRACTICE_HISTORY_MAX = 20;
const PRACTICE_HISTORY_ROW_HEIGHT = 58;
const PRACTICE_HISTORY_OVERSCAN = 5;
let practiceHistoryScrollBound = false;

function createPracticeHistoryItem() {
  const item = document.createElement("div");
  item.className = "practice-history-item";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "practice-history-open";
  const titleSpan = document.createElement("span");
  titleSpan.className = "practice-history-item-title";
  const metaSpan = document.createElement("span");
  metaSpan.className = "practice-history-item-meta";
  open.append(titleSpan, metaSpan);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "practice-history-del icon-btn";
  del.textContent = "×";
  item.append(open, del);
  return item;
}

function patchPracticeHistoryItem(item, h) {
  item.dataset.historyId = h.id;
  const when = new Date(h.at).toLocaleDateString(uiLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  item.querySelector(".practice-history-item-title").textContent = h.title || (h.words || []).slice(0, 3).join(", ") || t("practice.history.untitled");
  item.querySelector(".practice-history-item-meta").textContent = `${when} · ${(h.words || []).length} ${t("practice.history.words")}`;
  const open = item.querySelector(".practice-history-open");
  open.dataset.historyId = h.id;
  const del = item.querySelector(".practice-history-del");
  const deleteLabel = t("practice.history.delete");
  del.title = deleteLabel;
  del.setAttribute("aria-label", deleteLabel);
  del.onclick = async () => {
    const ok = await mutateAndFlush(() => deletePracticeHistoryEntry(h.id));
    if (ok) {
      renderPracticeHistory();
      updatePracticeCounts();
    }
  };
}

function drawPracticeHistoryWindow() {
  const list = $("#practiceHistoryList");
  if (!list || list.hidden) return;
  const hist = Array.isArray(state.settings.practiceHistory) ? state.settings.practiceHistory : [];
  if (hist.length === 0) {
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "practice-empty";
    empty.textContent = t("practice.history.empty");
    list.appendChild(empty);
    return;
  }
  const scrollTop = list.scrollTop;
  const viewportHeight = list.clientHeight || PRACTICE_HISTORY_ROW_HEIGHT * 6;
  const start = Math.max(0, Math.floor(scrollTop / PRACTICE_HISTORY_ROW_HEIGHT) - PRACTICE_HISTORY_OVERSCAN);
  const end = Math.min(hist.length, Math.ceil((scrollTop + viewportHeight) / PRACTICE_HISTORY_ROW_HEIGHT) + PRACTICE_HISTORY_OVERSCAN);
  const existing = new Map(Array.from(list.querySelectorAll(".practice-history-item")).map(item => [item.dataset.historyId, item]));
  const fragment = document.createDocumentFragment();
  const top = document.createElement("div");
  top.className = "practice-history-spacer";
  top.style.height = `${start * PRACTICE_HISTORY_ROW_HEIGHT}px`;
  fragment.appendChild(top);
  for (let index = start; index < end; index++) {
    const h = hist[index];
    let item = existing.get(h.id);
    if (!item) item = createPracticeHistoryItem();
    existing.delete(h.id);
    patchPracticeHistoryItem(item, h);
    fragment.appendChild(item);
  }
  const bottom = document.createElement("div");
  bottom.className = "practice-history-spacer";
  bottom.style.height = `${(hist.length - end) * PRACTICE_HISTORY_ROW_HEIGHT}px`;
  fragment.appendChild(bottom);
  list.replaceChildren(fragment);
}

function savePracticeToHistory(payload, words) {
  const safePayload = clonePracticePayload(payload);
  if (!safePayload?.text) return;
  if (!Array.isArray(state.settings.practiceHistory)) state.settings.practiceHistory = [];
  state.settings.practiceHistory.unshift({
    id: uid(),
    title: safePayload.title,
    text: safePayload.text,
    glossary: safePayload.glossary,
    words: (words || []).map(w => String(w?.front || "")).filter(Boolean),
    at: Date.now(),
  });
  markPracticeHistoryDirty(state.settings.practiceHistory[0]);
  if (state.settings.practiceHistory.length > PRACTICE_HISTORY_MAX) {
    const removed = state.settings.practiceHistory.splice(PRACTICE_HISTORY_MAX);
    removed.forEach(entry => markPracticeHistoryDeleted(entry.id));
  }
  save();
}

function togglePracticeHistory() {
  const list = $("#practiceHistoryList");
  if (!list) return;
  const willShow = list.hidden;
  list.hidden = !willShow;
  if (willShow) renderPracticeHistory();
}

function renderPracticeHistory() {
  const list = $("#practiceHistoryList");
  if (!list) return;
  if (!practiceHistoryScrollBound) {
    list.addEventListener("scroll", drawPracticeHistoryWindow, { passive: true });
    list.addEventListener("click", event => {
      const trigger = event.target.closest(".practice-history-open[data-history-id]");
      if (!trigger || !list.contains(trigger)) return;
      openPracticeFromHistory(trigger.dataset.historyId);
    });
    practiceHistoryScrollBound = true;
  }
  drawPracticeHistoryWindow();
}

function openPracticeFromHistory(id) {
  const hist = Array.isArray(state.settings.practiceHistory) ? state.settings.practiceHistory : [];
  const h = hist.find(entry => String(entry.id) === String(id));
  if (!h) return;
  const payload = clonePracticePayload({
    title: h.title || "",
    text: h.text,
    glossary: h.glossary,
    questions: [],
  });
  if (!payload?.text) return;

  cancelPracticeCheck("history opened");
  practiceState.id = `history-${h.id}`;
  practiceState.payload = payload;
  practiceState.words = Array.isArray(h.words)
    ? h.words.map(word => ({ front: String(word?.front ?? word ?? ""), back: String(word?.back || "") }))
    : [];
  practiceState.answers = [];
  practiceState.feedback = null;
  practiceShowStep("run");
  $("#practiceLoading").hidden = true;
  renderPracticeStory();
  $("#practiceQuestions").hidden = true;
  $("#practiceCheckBtn").hidden = true;
  $("#practiceHistoryList").hidden = true;
  persistPracticeDraft();
}

function uiLocale() {
  const code = (state.settings && state.settings.language) || window.I18N_LANG || "uk";
  return { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[code] || "uk-UA";
}

function setupCollapsibleBlocks() {
  const blocks = document.querySelectorAll(".button-block");
  if (!state.settings.expandedBlocks) state.settings.expandedBlocks = [];
  const expanded = new Set(state.settings.expandedBlocks);

  const chevronSVG = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

  blocks.forEach(block => {
    const id = [...block.classList].find(c => c.endsWith("-block") && c !== "button-block")?.replace("-block", "");
    if (!id) return;
    const header = block.querySelector(".block-header");
    if (!header) return;

    if (!header.querySelector(".chevron")) {
      const title = header.querySelector(".block-heading h3");
      if (title) title.insertAdjacentHTML("beforeend", chevronSVG);
    }

    block.classList.toggle("collapsed", !expanded.has(id));
    const title = header.querySelector(".block-heading h3");
    const trigger = title || header;
    header.removeAttribute("role");
    header.removeAttribute("tabindex");
    header.removeAttribute("aria-expanded");
    trigger.setAttribute("role", "button");
    trigger.setAttribute("tabindex", "0");
    trigger.setAttribute("aria-expanded", String(!block.classList.contains("collapsed")));

    if (!trigger.dataset.bound) {
      trigger.dataset.bound = "1";
      const toggleBlock = () => {
        const isCollapsed = block.classList.toggle("collapsed");
        trigger.setAttribute("aria-expanded", String(!isCollapsed));
        const setNow = new Set(state.settings.expandedBlocks || []);
        if (isCollapsed) setNow.delete(id);
        else setNow.add(id);
        state.settings.expandedBlocks = [...setNow];
        markSettingsDirty();
        save();
      };
      trigger.addEventListener("click", event => {
        if (event.target.closest(".info-tip-icon")) return;
        toggleBlock();
      });
      trigger.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggleBlock();
      });
    }
  });
}