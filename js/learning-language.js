/* Lingo Cards — Coordinated learning-language switching.

   One asynchronous operation at a time. The switch validates the target,
   refuses re-entry, waits for the active commit, flushes the source profile,
   writes the new selection and only then clears volatile session state.
   A generation token protects en→nb→en: a late async continuation is rejected
   because its token is stale, not because the language code happens to match
   again. */

let learningLanguageSwitchBusy = false;
let learningLanguageGeneration = 0;

// Every async learning-language consumer captures this token before awaiting
// and re-checks it afterwards.
function currentLanguageGeneration() {
  return learningLanguageGeneration;
}

function isLanguageGenerationCurrent(token) {
  return token === learningLanguageGeneration;
}

function isLearningLanguageSwitchBusy() {
  return learningLanguageSwitchBusy;
}

function learningLanguageLabel(code) {
  const registry = window.LCLanguages;
  const language = registry?.getLanguage(code);
  if (!language) return String(code || "");
  const translated = typeof t === "function" ? t(language.i18nKey) : "";
  return translated && translated !== language.i18nKey ? translated : language.aiName;
}

// Cancel every language-bound async job and volatile UI state. Called only
// after the new selection has been durably written.
function clearVolatileLanguageContext() {
  session = null;
  undoStack = [];
  // The practice draft is per-profile: the in-memory one belongs to the old
  // language and must not be persisted into the new profile.
  if (typeof closeModal === "function") closeModal();
  if (typeof resetPracticeRuntime === "function") resetPracticeRuntime();
  if (typeof clearBulkSelection === "function") clearBulkSelection();
  if (typeof invalidateStudyStage === "function") invalidateStudyStage();
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  if (typeof viewingDeckId !== "undefined") viewingDeckId = null;
}

// AUD-008: погасить UI отменённых языковых операций, не трогая данные текущего
// языка. Используется, когда запись переключения не удалась: задания уже
// отменены и не возобновятся, поэтому их индикаторы и модалки должны исчезнуть,
// но session и undoStack прежнего языка остаются валидными.
function clearCancelledLanguageRuntime() {
  if (typeof closeModal === "function") closeModal();
  if (typeof resetPracticeRuntime === "function") resetPracticeRuntime();
  if (typeof invalidateStudyStage === "function") invalidateStudyStage();
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

// Restore the compatibility mirror of the selected profile.
function adoptLanguageProfile(code) {
  const profile = activeLanguageProfile(state);
  state.activeDeckId = profile.activeDeckId && getDeckById(profile.activeDeckId)
    ? profile.activeDeckId
    : firstDeckIdForLanguage(code);
  profile.activeDeckId = state.activeDeckId;
  state.history = profile.history || {};
  state.streak = profile.streak || { current: 0, lastDay: null };
  state.sessionReviewedIds = Array.isArray(profile.sessionReviewedIds) ? profile.sessionReviewedIds : [];
  state.practiceDraft = profile.practiceDraft ?? null;
  state.studyResume = profile.studyResume ?? null;
}

/* Switch the active learning language.
   Returns true only when the new selection was durably written. */
async function switchLearningLanguage(rawCode) {
  const registry = window.LCLanguages;
  if (!registry?.isLanguageCode(rawCode)) return false;
  const next = registry.normalizeLanguageCode(rawCode);
  const previous = normalizeLearningLanguage(state?.activeLearningLanguage);
  if (next === previous) return true;
  // Re-entry guard: a second tap while the first switch is in flight is a no-op.
  if (learningLanguageSwitchBusy || (typeof gradeSaving !== "undefined" && gradeSaving)) return false;

  learningLanguageSwitchBusy = true;
  try {
    // Pending editor drafts must be committed before the profile is flushed,
    // otherwise their values would land in the wrong language profile.
    if (typeof commitSettingsDrafts === "function" && commitSettingsDrafts("language-switch") === false) {
      return false;
    }
    // Отменённые операции не возобновляются даже при откате записи языка.
    learningLanguageGeneration += 1;
    if (typeof cancelLanguageAiJobs === "function") cancelLanguageAiJobs();
    if (typeof cancelPracticeCheck === "function") cancelPracticeCheck("language switch");
    if (typeof hideSelectionPopover === "function") hideSelectionPopover();
    if (typeof cancelSelectionGesture === "function") cancelSelectionGesture();

    // Wait for the in-flight commit, then flush the source profile.
    if (typeof saveCurrentStudyResume === "function") saveCurrentStudyResume();
    syncActiveLanguageProfile(state);
    markMetaDirty();
    await saveAndFlush();

    const applied = await mutateAndFlush(() => {
      state.activeLearningLanguage = next;
      adoptLanguageProfile(next);
      markMetaDirty();
    });
    if (!applied) {
      // AUD-008: запись не удалась, но поколение уже инвалидировано, а AI-задания
      // и проверка практики уже отменены и не возобновляются. Поэтому ветка
      // отказа явно гасит именно этот отменённый runtime (модалки, практика,
      // индикаторы), оставляя язык прежним. Пользовательские данные прежнего
      // языка — session и undoStack — сохраняются, так как язык не изменился.
      state.activeLearningLanguage = normalizeLearningLanguage(state?.activeLearningLanguage, previous);
      adoptLanguageProfile(state.activeLearningLanguage);
      clearCancelledLanguageRuntime();
      syncLearningLanguageControl();
      if (typeof renderAll === "function") renderAll();
      if (typeof toast === "function") {
        toast(t("language.learning.switchFailedInterrupted"), { error: true });
      }
      return false;
    }

    // Запись подтверждена; поколение инвалидировано до первого await.
    clearVolatileLanguageContext();
    syncLearningLanguageControl();
    if (typeof renderAll === "function") renderAll();
    if (typeof toast === "function") {
      toast(t("language.learning.switched", { lang: learningLanguageLabel(next) }));
    }
    return true;
  } catch (error) {
    syncLearningLanguageControl();
    if (typeof toast === "function") toast(t("language.learning.switchFailed"), { error: true });
    return false;
  } finally {
    // The busy flag must be cleared *before* the final control sync, otherwise
    // syncLearningLanguageControl() would latch `select.disabled = true`
    // permanently and the control could never be tapped again without a reload.
    learningLanguageSwitchBusy = false;
    syncLearningLanguageControl();
  }
}

// Fill the settings control and the visible learning-language context label.
function syncLearningLanguageControl() {
  const code = normalizeLearningLanguage(state?.activeLearningLanguage);
  const select = document.getElementById("setLearningLanguage");
  if (select) {
    const registry = window.LCLanguages;
    const options = registry ? registry.listLanguages() : [];
    if (select.options.length !== options.length) {
      select.replaceChildren();
      for (const language of options) {
        const option = document.createElement("option");
        option.value = language.code;
        select.appendChild(option);
      }
    }
    for (const option of select.options) {
      option.textContent = learningLanguageLabel(option.value);
    }
    select.value = code;
    select.disabled = learningLanguageSwitchBusy;
  }
  for (const element of document.querySelectorAll("[data-learning-language-label]")) {
    element.textContent = learningLanguageLabel(code);
  }
  document.body?.setAttribute("data-learning-language", code);
  // Сводки пикеров «Лицевая сторона» тоже называют изучаемый язык, поэтому их
  // нужно перерисовать вместе с статическими метками.
  if (typeof renderStudyFrontPicker === "function") renderStudyFrontPicker();
  if (typeof renderStudyEdgeModePicker === "function") renderStudyEdgeModePicker();
}

function bindLearningLanguageControl() {
  const select = document.getElementById("setLearningLanguage");
  if (!select || select.dataset.bound === "true") return;
  select.dataset.bound = "true";
  select.addEventListener("change", () => {
    const requested = select.value;
    switchLearningLanguage(requested).then(ok => {
      // Rejected or failed switches must not leave a misleading selection.
      if (!ok) syncLearningLanguageControl();
    });
  });
  syncLearningLanguageControl();
}
