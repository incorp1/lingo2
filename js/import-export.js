/* Lingo Cards — Backup import/export and destructive data actions */

/* ----- Import / Export ----- */
let recoveryExpiryTimer = 0;

function stopVolatileWorkAfterReplacement() {
  session = null;
  undoStack = [];
  if (typeof clearAiSettingsBusyState === "function") clearAiSettingsBusyState();
  if (typeof cancelGlobalAiJob === "function") cancelGlobalAiJob();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (typeof stopStudyCardTimer === "function") stopStudyCardTimer();
}

function applyCommittedSnapshot(committed) {
  state = normalizeLoadedState(committed.state);
  // The active language profile is the single source of truth for the draft;
  // the flat field is only a compatibility mirror of that profile.
  const activeProfile = activeLanguageProfile(state);
  if (committed.practiceDraft && !activeProfile.practiceDraft) {
    activeProfile.practiceDraft = committed.practiceDraft;
  }
  state.practiceDraft = activeProfile.practiceDraft || null;
  rebuildEntityIndexes();
  resetDirtyState();
  stopVolatileWorkAfterReplacement();
  applyTheme();
  applyLanguage();
  // Полная замена снимка (импорт резервной копии, сброс, восстановление)
  // приносит собственный `activeLearningLanguage`. Контрол языка обучения и
  // `data-learning-language` не входят в renderAll(), поэтому без явной
  // синхронизации в настройках остаётся прежний выбор (например «Норвежский»),
  // хотя учебная очередь уже работает с языком из резервной копии.
  if (typeof syncLearningLanguageControl === "function") syncLearningLanguageControl();
  renderAll();
}

async function commitDestructiveSnapshot(snapshot, operation) {
  if (typeof commitSettingsDrafts === "function") {
    const committedDrafts = await commitSettingsDrafts(operation);
    if (committedDrafts === false) return null;
  }
  await window.LCStorage.flush();
  const committed = await window.LCStorage.replaceAppSnapshot(snapshot, {
    operation,
    expectedRevision: Number(state.revision) || 0,
  });
  applyCommittedSnapshot(committed);
  await refreshRecoveryAction();
  return committed;
}

function resetCardProgress(card, startingEase, now) {
  const reset = structuredClone(card);
  reset.state = "new";
  delete reset.suspendedFrom;
  reset.step = 0;
  reset.ease = startingEase;
  reset.interval = 0;
  reset.due = now;
  reset.reps = 0;
  reset.lapses = 0;
  reset.lastReview = null;
  delete reset.fsrs;
  reset.difficultyCache = calculateDifficultyCache([], now);
  return reset;
}

async function resolveDeckImportLanguage(deckLanguage) {
  const activeLanguage = normalizeLearningLanguage(state.activeLearningLanguage);
  const languageLabel = code => t(`language.name.${code}`);
  // An unlabeled legacy deck must be assigned explicitly; default is English.
  if (!deckLanguage) {
    const selected = await confirmDialog({
      title: t("confirm.deckImport.title"),
      message: t("confirm.deckImport.chooseLanguage"),
      detail: t("confirm.deckImport.detail"),
      confirmLabel: t("confirm.deckImport.action"),
      choice: { value: "en", options: languageCodes().map(code => ({ value: code, label: languageLabel(code) })) },
    });
    return languageCodes().includes(selected) ? selected : null;
  }
  if (deckLanguage === activeLanguage) return deckLanguage;
  const keepDeckLanguage = await confirmDialog({
    title: t("confirm.deckImport.title"),
    message: t("confirm.deckImport.mismatch", {
      deckLang: languageLabel(deckLanguage),
      activeLang: languageLabel(activeLanguage),
    }),
    detail: t("confirm.deckImport.detail"),
    confirmLabel: t("confirm.deckImport.action"),
  });
  return keepDeckLanguage ? deckLanguage : null;
}

async function resetProgress() {
  const activeLanguage = normalizeLearningLanguage(state.activeLearningLanguage);
  const confirmed = await confirmDialog({
    title: t("confirm.resetProgress.title"),
    message: t("settings.resetConfirm"),
    detail: t("confirm.resetProgress.languageDetail", {
      lang: t(`language.name.${activeLanguage}`),
    }),
    confirmLabel: t("confirm.resetProgress.action"),
    danger: true,
  });
  if (!confirmed) return;
  const now = Date.now();
  const nextState = structuredClone(state);
  // Only the active language is reset; other languages keep their progress.
  const languageDeckIds = new Set(
    nextState.decks
      .filter(deck => normalizeLearningLanguage(deck.learningLanguage) === activeLanguage)
      .map(deck => deck.id)
  );
  nextState.cards = nextState.cards.map(card =>
    languageDeckIds.has(card.deckId)
      ? resetCardProgress(card, nextState.settings.startingEase, now)
      : card
  );
  const profile = nextState.languageProfiles?.[activeLanguage];
  if (profile) {
    profile.history = {};
    profile.streak = { current: 0, lastDay: null };
    profile.sessionReviewedIds = [];
    profile.practiceDraft = null;
    profile.studyResume = null;
  }
  nextState.history = {};
  nextState.streak = { current: 0, lastDay: null };
  nextState.sessionReviewedIds = [];
  nextState.practiceDraft = null;
  nextState.studyResume = null;
  nextState.studyCycles = Object.fromEntries(
    Object.entries(nextState.studyCycles || {}).filter(([cardId]) => {
      const card = nextState.cards.find(item => item.id === cardId);
      return card ? !languageDeckIds.has(card.deckId) : false;
    })
  );
  // Legacy events predate `learningLanguage`, so deck membership is the
  // authoritative signal and the stored label is only a fallback.
  const keptEvents = (await window.LCStorage.readAppSnapshot()).reviewEvents
    .filter(event => {
      if (languageDeckIds.has(event.deckId)) return false;
      if (event.deckId) return true;
      return normalizeLearningLanguage(event.learningLanguage) !== activeLanguage;
    });
  // AUD-007/AUD-010: сброс прогресса касается только расписания повторений.
  // История AI-практики — отдельный пользовательский контент, который нельзя
  // восстановить, поэтому она сохраняется для всех языков, включая активный.
  // Хранится она в `state.settings.practiceHistory`, поэтому нормализуем именно
  // это поле и не создаём дублирующее поле на верхнем уровне состояния.
  if (nextState.settings && !Array.isArray(nextState.settings.practiceHistory)) {
    nextState.settings.practiceHistory = [];
  }
  try {
    const committed = await commitDestructiveSnapshot({
      state: nextState,
      reviewEvents: keptEvents,
      practiceDraft: null,
    }, "reset-progress");
    if (committed) toast(t("toast.progressReset"));
  } catch (error) {
    console.error(error);
    reportSaveError(error);
  }
}

async function wipeAll() {
  const typed = await requestTextInput({
    title: t("confirm.wipeAll.title"),
    message: t("confirm.wipeAll.allLanguages"),
    placeholder: t("confirm.wipeAll.placeholder"),
    confirmLabel: t("confirm.wipeAll.action"),
    required: true,
  });
  if (typed === null || String(typed).trim() !== t("confirm.wipeAll.phrase")) {
    if (typed !== null) toast(t("confirm.wipeAll.mismatch"), { error: true });
    return;
  }
  const emptyState = {
    decks: [],
    cards: [],
    dataModelVersion: LANGUAGE_REGISTRY()?.DATA_MODEL_VERSION || 2,
    activeLearningLanguage: defaultLearningLanguage(),
    languageProfiles: Object.fromEntries(languageCodes().map(code => [code, emptyLanguageProfile()])),
    activeDeckId: null,
    settings: structuredClone(defaultSettings),
    history: {},
    streak: { current: 0, lastDay: null },
    sessionReviewedIds: [],
    studyCycles: {},
  };
  try {
    const committed = await commitDestructiveSnapshot({
      state: emptyState,
      reviewEvents: [],
      practiceDraft: null,
    }, "wipe-all");
    if (committed) toast(t("toast.wiped"));
  } catch (error) {
    console.error(error);
    reportSaveError(error);
  }
}

function recoveryOperationLabel(operation) {
  if (operation === "reset-progress") return t("settings.recovery.resetProgress");
  if (operation === "wipe-all") return t("settings.recovery.wipeAll");
  return t("settings.recovery.restore");
}

async function refreshRecoveryAction() {
  const block = $("#recoveryBlock");
  if (!block) return;
  window.clearTimeout(recoveryExpiryTimer);
  try {
    const recovery = await window.LCStorage.getRecoverySnapshot();
    block.hidden = !recovery;
    if (!recovery) return;
    $("#recoveryDescription").textContent = t("settings.recovery.available", {
      operation: recoveryOperationLabel(recovery.operation),
    });
    recoveryExpiryTimer = window.setTimeout(
      () => refreshRecoveryAction(),
      Math.max(0, recovery.expiresAt - Date.now()) + 50
    );
  } catch (error) {
    console.error("Recovery status failed:", error);
    block.hidden = true;
  }
}

async function restoreRecentChange() {
  const button = $("#recoveryUndoBtn");
  if (button) button.disabled = true;
  try {
    await window.LCStorage.flush();
    const committed = await window.LCStorage.restoreRecoverySnapshot({
      expectedRevision: Number(state.revision) || 0,
    });
    applyCommittedSnapshot(committed);
    await refreshRecoveryAction();
    toast(t("toast.recovered"));
  } catch (error) {
    console.error(error);
    await refreshRecoveryAction();
    if (error?.name === "RecoveryUnavailableError") {
      toast(t("toast.recoveryExpired"), { error: true });
    } else {
      reportSaveError(error);
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function backupJsonReplacer() {
  const seen = new WeakSet();
  return function (key, value) {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (value && typeof value === "object") {
      if (typeof Node !== "undefined" && value instanceof Node) return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  };
}

async function buildBackupText() {
  if (typeof commitSettingsDrafts === "function") {
    const committed = await commitSettingsDrafts("backup");
    if (committed === false) throw new Error("Invalid settings draft");
  }
  await window.LCStorage.flush();
  const snapshot = await window.LCStorage.readAppSnapshot();
  return window.LCBackup.buildFullExport(snapshot, { includeSecrets: true });
}

function backupFilename() {
  return window.LCBackup.filename(new Date().toLocaleDateString("en-CA"));
}

async function buildBackupFile() {
  const text = await buildBackupText();
  const filename = backupFilename();
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  let file;
  try {
    file = new File([blob], filename, { type: "application/json", lastModified: Date.now() });
  } catch {
    file = blob;
    try { Object.defineProperty(file, "name", { value: filename }); } catch {}
  }
  return { file, filename, text };
}

function downloadBackupFile(file, filename) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

async function recordSuccessfulBackup() {
  const timestamp = new Date().toISOString();
  await window.LCStorage.setLocalMetadata("lastSuccessfulBackupAt", timestamp);
  if (typeof renderBackupMetadata === "function") await renderBackupMetadata();
}

async function exportData() {
  try {
    const { file, filename } = await buildBackupFile();
    downloadBackupFile(file, filename);
    await recordSuccessfulBackup();
    toast(t("toast.exported"));
  } catch (error) {
    console.error("Backup export failed:", error);
    toast(t("toast.exportFailed"), { error: true });
  }
}

async function shareExportData() {
  try {
    const { file, filename, text } = await buildBackupFile();
    const shareData = { files: [file] };
    if (typeof navigator.share === "function") {
      if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          await recordSuccessfulBackup();
          toast(t("toast.shared"));
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
          console.warn("File sharing failed; trying text sharing:", error);
        }
      }
      try {
        await navigator.share({ title: filename, text });
        await recordSuccessfulBackup();
        toast(t("toast.shared"));
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Text sharing failed; downloading backup instead:", error);
      }
    }
    downloadBackupFile(file, filename);
    await recordSuccessfulBackup();
    toast(t("toast.shareUnsupported"));
  } catch (error) {
    console.error("Backup sharing failed:", error);
    toast(t("toast.shareFailed"), { error: true });
  }
}

function importErrorMessage(reason, expectedKind) {
  if (reason === "unsupported-version") return t("toast.importUnsupportedVersion");
  if (reason === "wrong-kind") {
    return expectedKind === "full"
      ? t("toast.importExpectedFull")
      : t("toast.importExpectedDeck");
  }
  return t("toast.importInvalidData");
}

function rejectImport(result, expectedKind) {
  const reason = result.reason || "invalid-data";
  console.warn("Backup import rejected:", reason, "expected:", expectedKind);
  toast(importErrorMessage(reason, expectedKind), { error: true });
}

async function importFullBackup(text) {
  let result = window.LCBackup.parse(text);
  if (result.kind === "error" && result.reason === "secret-confirmation-required") {
    const accepted = await confirmDialog({
      title: t("confirm.import.title"),
      message: t("confirm.import.legacySecret"),
      detail: t("confirm.import.detail"),
      confirmLabel: t("confirm.import.action"),
      danger: true,
    });
    if (!accepted) return;
    result = window.LCBackup.parse(text, { allowLegacySecret: true });
  }
  if (result.kind !== "full") {
    rejectImport(
      result.kind === "error" ? result : { reason: "wrong-kind" },
      "full"
    );
    return;
  }
  const confirmed = await confirmDialog({
    title: t("confirm.import.title"),
    message: t("settings.importConfirm"),
    detail: t("confirm.import.detail"),
    confirmLabel: t("confirm.import.action"),
    danger: true,
  });
  if (!confirmed) return;
  if (typeof commitSettingsDrafts === "function") {
    const committedDrafts = await commitSettingsDrafts("restore");
    if (committedDrafts === false) return;
  }
  await window.LCStorage.flush();
  const localAiKey = String(state.settings?.aiKey || "");
  const restoredState = structuredClone(result.state);
  restoredState.settings.aiKey = result.secretPresent
    ? String(result.state.settings?.aiKey || "")
    : localAiKey;
  rebuildDifficultyCachesForState(restoredState, result.reviewEvents || []);
  const committed = await window.LCStorage.replaceAppSnapshot({
    state: restoredState,
    reviewEvents: result.reviewEvents || [],
    practiceDraft: result.practiceDraft || null,
  }, {
    operation: "full-restore",
    expectedRevision: Number(state.revision) || 0,
  });
  applyCommittedSnapshot(committed);
  await refreshRecoveryAction();
  toast(t("toast.imported"));
}

async function importDeckBackup(text) {
  const result = window.LCBackup.parse(text);
  if (result.kind !== "deck") {
    rejectImport(
      result.kind === "error" ? result : { reason: "wrong-kind" },
      "deck"
    );
    return;
  }
  const importLanguage = await resolveDeckImportLanguage(result.deck.learningLanguage);
  if (!importLanguage) return;
  if (typeof commitSettingsDrafts === "function") {
    const committedDrafts = await commitSettingsDrafts("deck-import");
    if (committedDrafts === false) return;
  }
  await window.LCStorage.flush();
  const committed = await window.LCStorage.appendDeck({
    ...result.deck,
    learningLanguage: importLanguage,
  }, {
    expectedRevision: Number(state.revision) || 0,
  });
  state.decks.push(committed.deck);
  state.cards.push(...committed.cards);
  state.revision = committed.revision;
  state.updatedAt = committed.updatedAt;
  rebuildEntityIndexes();
  resetDirtyState();
  renderDecks();
  renderDeckSelector();
  if (typeof renderBackupMetadata === "function") await renderBackupMetadata();
  toast(t("toast.deckImported"));
}

async function importData(file, expectedKind = "full") {
  try {
    const text = await file.text();
    if (expectedKind === "deck") await importDeckBackup(text);
    else await importFullBackup(text);
  } catch (error) {
    console.error(error);
    if (error?.storageError) {
      reportSaveError(error);
      toast(t("toast.saveFailed"), { error: true });
    } else {
      toast(t("toast.importFailed"), { error: true });
    }
  } finally {
    for (const selector of ["#importFile", "#deckImportFile"]) {
      const input = $(selector);
      if (input) input.value = "";
    }
  }
}

