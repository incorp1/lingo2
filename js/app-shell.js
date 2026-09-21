/* Lingo Cards — TTS, utilities, application wiring and mobile viewport */

/* ----- TTS ----- */

// Становится true после первой попытки дождаться voiceschanged: не даём
// бесконечно откладывать озвучку, если голоса языка в системе нет вообще.
let speechSynthesisVoicesSettled = false;

/* Locale of the language being learned: the front side of a card, a cloze
   sentence, an example and a looked-up word are all spoken with it. */
function learningSpeechLocale(code) {
  const registry = window.LCLanguages;
  const normalized = typeof normalizeLearningLanguage === "function"
    ? normalizeLearningLanguage(code ?? state?.activeLearningLanguage)
    : (code ?? state?.activeLearningLanguage);
  return registry?.getLanguage(normalized)?.locale || "en-US";
}

/* Озвучивание всегда идёт на языке обучения. Локаль интерфейса (ru/uk)
   намеренно не используется для TTS: приложение произносит только изучаемый
   язык, а перевод остаётся текстовым. */
function translationSpeechLocale() {
  return learningSpeechLocale();
}

function baseLocaleCode(locale) {
  return String(locale || "").toLowerCase().split(/[-_]/)[0];
}

/* Systems label Norwegian voices inconsistently: "nb-NO" (Android/Google),
   "no-NO" (Windows/Chrome desktop) and "nn-NO" (Nynorsk). Our registry locale
   is "nb-NO", so a plain base-code match ("nb" !== "no") found nothing and the
   platform silently fell back to its default English voice — exactly the bug
   where Norwegian words were read with an English pronunciation. */
const SPEECH_LOCALE_ALIASES = { nb: ["nb", "no", "nn"], no: ["nb", "no", "nn"], nn: ["nb", "no", "nn"] };

function localeAliasList(locale) {
  const base = baseLocaleCode(locale);
  return SPEECH_LOCALE_ALIASES[base] || [base];
}

function normalizeVoiceLang(lang) {
  return String(lang || "").toLowerCase().replace(/_/g, "-");
}

/* Pick a voice for the requested locale. When the device truly has no matching
   voice we return null and let the platform decide: forcing an English voice
   would read Norwegian words with an English pronunciation. */
function pickSpeechVoice(locale) {
  let voices = [];
  try { voices = speechSynthesis.getVoices() || []; } catch (e) { return null; }
  if (!voices.length) return null;
  const wanted = normalizeVoiceLang(locale);
  const aliases = localeAliasList(locale);
  const matches = voices.filter(v => aliases.includes(baseLocaleCode(v.lang)));
  if (!matches.length) return null;
  return matches.find(v => normalizeVoiceLang(v.lang) === wanted)
    // Prefer the exact base code (nb) over a related one (no/nn).
    || matches.find(v => baseLocaleCode(v.lang) === baseLocaleCode(locale))
    // Local voices sound better and work offline in the PWA.
    || matches.find(v => v.localService)
    || matches[0];
}

function speakUtterance(u) {
  const voice = pickSpeechVoice(u.lang);
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

function speak(text, { rate, lang } = {}) {
  if (!text || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || detectLang(text);
    const configuredRate = Number(rate ?? state?.settings?.ttsRate ?? 0.95);
    u.rate = Math.min(1.5, Math.max(0.3, Number.isFinite(configuredRate) ? configuredRate : 0.95));
    let voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch (e) {}
    // Safari/Chrome fill the voice list asynchronously: wait for voiceschanged
    // once instead of speaking with whatever default is active at this moment.
    // We also wait when the list exists but holds no voice for the requested
    // locale yet — otherwise the very first Norwegian card is read in English.
    const needsVoiceWait = !voices.length || (!pickSpeechVoice(u.lang) && !speechSynthesisVoicesSettled);
    if (needsVoiceWait && typeof speechSynthesis.addEventListener === "function") {
      speechSynthesisVoicesSettled = true;
      let spoken = false;
      const fire = () => {
        if (spoken) return;
        spoken = true;
        try { speakUtterance(u); } catch (e) {}
      };
      speechSynthesis.addEventListener("voiceschanged", fire, { once: true });
      // Never stay silent if the event never arrives on this platform.
      setTimeout(fire, 250);
      return;
    }
    speakUtterance(u);
  } catch (e) {}
}

function detectLang(text) {
  const s = String(text || "");
  if (/[іїєґІЇЄҐ]/.test(s)) return "uk-UA";
  if (/[\u0400-\u04FF]/.test(s)) return "ru-RU";
  return learningSpeechLocale();
}

/* ----- Utilities ----- */
function escape(str) {
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ----- Initial wiring ----- */
function renderActiveView({ includeSelectors = false } = {}) {
  const name = document.body.getAttribute("data-view") || "study";
  if (includeSelectors) renderDeckSelector();
  if (name === "study") renderStudy();
  else if (name === "decks") {
    if (viewingDeckId && !$("#deckBrowse")?.hidden) renderBrowse();
    else renderDecks();
  } else if (name === "stats") renderStats();
  else if (name === "settings") renderSettings();
  $("#streakDays").textContent = state.streak.current || 0;
  syncCompactSelectWidths();
}

function renderAll() {
  renderActiveView({ includeSelectors: true });
}

function bindEvents() {
  // Robust modal close — works for all modals via event delegation
  document.addEventListener("click", e => {
    if (!e.target.closest) return;
    if (e.target.closest("[data-confirm-cancel]")) {
      cancelConfirmDialog();
      return;
    }
    if (e.target.closest("[data-duplicate-close]")) {
      closeDuplicateDialog();
      return;
    }
    const settingsSheetClose = e.target.closest("[data-settings-sheet-close]");
    if (settingsSheetClose) {
      closeSettingsOverlay(settingsSheetClose.closest("[data-settings-overlay]")?.dataset.settingsOverlay);
      return;
    }
    const closeTrigger = e.target.closest("[data-close]");
    if (!closeTrigger) return;
    const modal = closeTrigger.closest(".modal");
    if (modal?.id === "practiceModal") closePractice();
    else if (modal?.id === "textInputModal") settleTextInput(null);
    else if (modal?.id === "wordInfoModal") closeDialog(modal);
    else closeModal();
  });
  $("#confirmCancelBtn").onclick = cancelConfirmDialog;
  $("#confirmAcceptBtn").onclick = () => settleConfirmDialog(true);
  $("#duplicateOkBtn").onclick = closeDuplicateDialog;

  // Top-level tabs are peers, not browser-history steps. Keeping this wiring
  // behind switchView() prevents iOS edge-back from returning to a tab or a
  // Settings subsection that was active before the current tab.
  $$(".nav-item").forEach(button => {
    button.onclick = () => switchView(button.dataset.view);
  });

  $("#revealBtn").onclick = reveal;
  $$(".grade-btn").forEach(b => b.onclick = () => grade(parseInt(b.dataset.grade)));

  $("#newDeckBtn").onclick = () => openDeckEditor(null);
  $("#deckBrowseBack").onclick = () => {
    viewingDeckId = null;
    clearBulkSelection();
    renderDecks();
  };
  $("#filterDeck").oninput = () => renderBrowse({ preserveScroll: false });
  $("#filterState").oninput = () => renderBrowse({ preserveScroll: false });
  $("#browseSort").oninput = () => renderBrowse({ preserveScroll: false });
  $("#browseSearch").oninput = () => {
    updateBrowseControls();
    clearTimeout(_browseSearchTimer);
    _browseSearchTimer = setTimeout(() => renderBrowse({ preserveScroll: false }), 120);
  };
  $("#browseSearchClear").onclick = () => {
    $("#browseSearch").value = "";
    $("#browseSearch").focus();
    renderBrowse({ preserveScroll: false });
  };
  $("#browseFilterToggle").onclick = event => {
    const panel = $("#browseAdvancedFilters");
    const open = panel.hidden;
    panel.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
  };
  $("#browseResetFilters").onclick = () => {
    resetBrowseControls();
    renderBrowse({ preserveScroll: false });
  };
  bindAddCardMenu();
  const deckBrowseAdd = $("#deckBrowseAddBtn");
  if (deckBrowseAdd) {
    deckBrowseAdd.onclick = event => {
      event.stopPropagation();
      openAddCardMenu(deckBrowseAdd);
    };
  }
  bindDeckActionMenu();

  // Bulk modal
  $("#bulkAddBtn").onclick = commitBulkAdd;
  ["#bulkText", "#bulkType"].forEach(s => {
    const el = $(s);
    if (el) el.addEventListener("input", updateBulkPreview);
    if (el && el.tagName === "SELECT") el.addEventListener("change", updateBulkPreview);
  });

  // Study queue filters (New / Learning / Review) — the stat chips double as
  // toggle buttons. Tapping a chip turns that card category on/off.
  const studyFilterMap = {
    new: "#studyFilterNew",
    learning: "#studyFilterLearning",
    review: "#studyFilterReview",
  };
  Object.entries(studyFilterMap).forEach(([key, sel]) => {
    const el = $(sel);
    if (!el) return;
    el.onclick = () => {
      if (!state.settings.studyQueue) state.settings.studyQueue = { new: true, learning: true, review: true };
      const current = state.settings.studyQueue[key] !== false;
      const enabledCount = Object.values(state.settings.studyQueue).filter(value => value !== false).length;
      if (current && enabledCount === 1) {
        renderStudyQueueControls(state.activeDeckId);
        toast(t("study.filters.keepOne"));
        return;
      }
      state.settings.studyQueue[key] = !current;
      markSettingsDirty();
      save();
      startSession(state.activeDeckId, { preserveCurrent: true });
    };
  });

  $("#exportBtn").onclick = exportData;
  $("#shareExportBtn").onclick = shareExportData;
  $("#quickBackupBtn").onclick = shareExportData;
  $("#importFile").onchange = e => {
    const file = e.target.files[0];
    if (file) importData(file, "full");
  };
  $("#recoveryUndoBtn").onclick = restoreRecentChange;

  // Bulk-ops in Browse
  $("#selectAllCb").onchange = e => {
    if (e.target.checked) _browseFiltered.forEach(c => bulkSelected.add(c.id));
    else _browseFiltered.forEach(c => bulkSelected.delete(c.id));
    drawVisibleBrowseRows();
    refreshBulkBar();
  };
  $("#bulkMoveBtn").onclick = async () => {
    if (bulkMutationRunning || bulkSelected.size === 0) return;
    const movableDecks = activeDecks();
    const options = movableDecks.map((deck, index) => `${index + 1}. ${deck.name}`).join("\n");
    const answer = await requestTextInput({
      title: t("browse.bulk.moveTitle"),
      message: `${t("browse.bulk.movePrompt")}\n${options}`,
      placeholder: t("browse.bulk.movePlaceholder"),
      confirmLabel: t("browse.bulk.moveAction"),
      required: true,
    });
    if (answer === null) return;
    const normalized = answer.trim().toLowerCase();
    const numericIndex = /^\d+$/.test(normalized) ? Number(normalized) - 1 : -1;
    const deck = movableDecks[numericIndex] || movableDecks.find(item => item.name.toLowerCase() === normalized);
    if (!deck) {
      toast(t("browse.bulk.deckNotFound"), { error: true });
      return;
    }
    await runBulkMutation(() => bulkMoveTo(deck.id));
  };
  $("#bulkRefreshExamplesBtn").onclick = refreshSelectedExamples;
  $("#bulkSuspendBtn").onclick = async () => {
    const count = bulkSelected.size;
    if (!count) return;
    const confirmed = await confirmDialog({
      title: t("confirm.suspendCards.title", { count }),
      message: t("confirm.suspendCards.message", { count }),
      confirmLabel: t("confirm.suspendCards.action", { count }),
    });
    if (confirmed) await runBulkMutation(() => bulkSetSuspended(true));
  };
  $("#bulkUnsuspendBtn").onclick = () => runBulkMutation(() => bulkSetSuspended(false));
  $("#bulkDeleteBtn").onclick = () => runBulkMutation(bulkDelete);
  $("#bulkCancelBtn").onclick = clearBulkSelection;

  // Swap direction + Undo

  $("#saveCardBtn").onclick = () => saveCardFromEditor(false);
  $("#saveAddAnotherBtn").onclick = () => saveCardFromEditor(true);
  $("#aiGenBtn").onclick = generateCard;
  $("#edType").onchange = toggleClozeFields;
  $("#edDeck").addEventListener("change", updateEditorDeckName);

  // Reading practice
  $("#practiceStartBtn").onclick = practiceGenerate;
  $("#practiceCheckBtn").onclick = practiceCheck;
  $("#practiceAgainBtn").onclick = () => { practiceShowStep("setup"); updatePracticeCounts(); };
  $("#practiceBackBtn").onclick = practiceBack;
  $$("#practicePeriod .period-opt").forEach(b => b.onclick = () => {
    practiceState.period = b.dataset.period;
    practiceState.selectedIds = null;
    persistPracticeDraft();
    updatePracticeCounts();
  });
  const practiceDaysEl = $("#practiceDays");
  if (practiceDaysEl) practiceDaysEl.addEventListener("input", () => {
    state.settings.practiceDays = Math.min(180, Math.max(1, parseInt(practiceDaysEl.value) || 7));
    markSettingsDirty();
    practiceState.period = "days";
    practiceState.selectedIds = null;
    save();
    persistPracticeDraft();
    updatePracticeCounts();
  });
  const practiceClearBtn = $("#practiceClearSelectionBtn");
  if (practiceClearBtn) practiceClearBtn.onclick = () => {
    practiceState.selectedIds = null;
    persistPracticeDraft();
    updatePracticeCounts();
  };
  const practiceHistBtn = $("#practiceHistoryBtn");
  if (practiceHistBtn) practiceHistBtn.onclick = togglePracticeHistory;
  $("#practiceDeck").addEventListener("change", () => {
    practiceState.deckId = $("#practiceDeck").value || "";
    practiceState.selectedIds = null;
    persistPracticeDraft();
    updatePracticeCounts();
  });
  $("#practiceCount").addEventListener("change", () => {
    practiceState.count = $("#practiceCount").value || "8";
    persistPracticeDraft();
    updatePracticeCounts();
  });
  const practiceLevelEl = $("#practiceLevel");
  if (practiceLevelEl) practiceLevelEl.addEventListener("change", () => {
    practiceState.level = practiceLevelEl.value;
    persistPracticeDraft();
  });
  const practiceFormatEl = $("#practiceFormat");
  if (practiceFormatEl) practiceFormatEl.addEventListener("change", () => {
    practiceState.format = practiceFormatEl.value;
    persistPracticeDraft();
  });

  // Language switcher
  $$(".lang-btn").forEach(b => b.onclick = () => {
    state.settings.language = b.dataset.lang;
    markSettingsDirty();
    save();
    applyLanguage();
    renderSettings();
  });

  $("#saveDeckBtn").onclick = saveDeckFromEditor;

  bindSettings();
  bindCompactSelectWidths();
  bindSelectionLookup();
  setupCollapsibleBlocks();
  updateSwapBtnTitle();
  updateUndoBtn();

  document.addEventListener("keydown", e => {
    trapDialogFocus(e);
    if (e.defaultPrevented) return;
    if (e.key === "Escape" && activeDialog && !activeDialog.hidden) {
      e.preventDefault();
      const settingsOverlay = activeDialog.dataset.settingsOverlay;
      if (settingsOverlay && currentAppState.overlay === settingsOverlay) {
        closeSettingsOverlay(settingsOverlay);
      } else if (activeDialog.id === "confirmModal") cancelConfirmDialog();
      else if (activeDialog.id === "duplicateModal") closeDuplicateDialog();
      else if (activeDialog.id === "textInputModal") settleTextInput(null);
      else if (activeDialog.id === "practiceModal") closePractice();
      else if (activeDialog.id === "wordInfoModal") closeDialog(activeDialog);
      else closeModal();
      return;
    }
    // Global Ctrl/Cmd+Z = undo last review
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" &&
        !e.shiftKey && !e.target.matches("input, textarea")) {
      e.preventDefault();
      undo();
      return;
    }
    // Inside bulk modal: Esc closes
    if (!$("#bulkModal").hidden) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); commitBulkAdd(); return; }
      return;
    }
    if (!$("#editorModal").hidden) {
      if (e.key === "Escape") { closeModal(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveCardFromEditor(true); return; }
      if (e.key === "Enter" && !e.shiftKey && e.target.matches("input")) {
        e.preventDefault(); saveCardFromEditor(false);
      }
      return;
    }
    if (!$("#deckModal").hidden) {
      if (e.key === "Escape") closeModal();
      if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); saveDeckFromEditor(); }
      return;
    }
    if (viewingDeckId && $("#view-decks").classList.contains("active")) {
      if (e.key === "Escape") closeDeckBrowse();
      return;
    }
    if (e.target.matches("input, textarea, select")) return;
    if (!$("#view-study").classList.contains("active")) return;
    if (e.code === "Space") { e.preventDefault(); if (!session?.revealed) reveal(); }
    else if (e.key === "1") grade(0);
    else if (e.key === "2") grade(1);
    else if (e.key === "3") grade(2);
    else if (e.key === "4") grade(3);
    else if (e.key.toLowerCase() === "e" && session?.currentId) openCardEditor(session.currentId);
    else if (e.key.toLowerCase() === "s" && session?.currentId) {
      const c = getCard(session.currentId);
      if (c) { suspendCard(c); save(); next(); toast(t("toast.suspended")); }
    }
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings.theme === "auto") applyTheme();
  });
}

let addCardMenuTrigger = null;

function closeAddCardMenu() {
  const menu = $("#addCardMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menu.style.removeProperty("left");
  menu.style.removeProperty("top");
  if (addCardMenuTrigger) addCardMenuTrigger.setAttribute("aria-expanded", "false");
  addCardMenuTrigger = null;
}

function openAddCardMenu(trigger) {
  const menu = $("#addCardMenu");
  if (!menu) return;
  if (!menu.hidden && addCardMenuTrigger === trigger) {
    closeAddCardMenu();
    return;
  }
  closeAddCardMenu();
  addCardMenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";

  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(margin, rect.left),
    Math.max(margin, window.innerWidth - menuRect.width - margin)
  );
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuRect.height - 6);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = "";
  menu.querySelector("[role='menuitem']")?.focus({ preventScroll: true });
}

function bindAddCardMenu() {
  const triggers = [$("#topbarAddBtn"), $("#addCardBtn2"), $("#deckBrowseAddBtn")].filter(Boolean);
  for (const trigger of triggers) {
    trigger.onclick = e => {
      e.stopPropagation();
      openAddCardMenu(trigger);
    };
  }

  const menu = $("#addCardMenu");
  if (!menu) return;
  menu.onclick = e => {
    const action = e.target.closest("[data-add-mode]");
    if (!action) return;
    e.stopPropagation();
    const mode = action.dataset.addMode;
    closeAddCardMenu();
    const targetDeckId = viewingDeckId || state.activeDeckId;
    if (mode === "bulk") openBulkAdd(targetDeckId);
    else openCardEditor(null, targetDeckId);
  };
  menu.onkeydown = e => {
    const items = [...menu.querySelectorAll("[role='menuitem']")];
    const index = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      const trigger = addCardMenuTrigger;
      closeAddCardMenu();
      trigger?.focus({ preventScroll: true });
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    }
  };
  document.addEventListener("click", e => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".add-card-trigger")) closeAddCardMenu();
  });
  window.addEventListener("resize", closeAddCardMenu);
  window.addEventListener("scroll", closeAddCardMenu, true);
}

/* Real viewport height — fixes mobile Safari 100vh including iPhone 7.
   Sets --app-vh to 1% of the actual visible viewport height so the study
   view can size itself to the screen without the address bar overflow.

   IMPORTANT: when the on-screen keyboard opens, visualViewport.height shrinks.
   If we tracked that, the layout would collapse and leave blank gaps. So we
   only ever GROW --app-vh (real screen height) and ignore the shrink caused
   by the keyboard. A `kb-open` body class lets CSS hide the fixed bottom tab
   bar while a field is focused. */
let _maxViewportH = 0;
function updateAppViewportHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  // Treat a noticeable shrink (>150px) as the keyboard opening, not a real
  // viewport change — keep the last full height so the layout stays put.
  const keyboardOpen = _maxViewportH && (_maxViewportH - h > 150);
  if (!keyboardOpen) {
    _maxViewportH = Math.max(_maxViewportH, h);
    document.documentElement.style.setProperty("--app-vh", (_maxViewportH * 0.01) + "px");
  }
  document.body.classList.toggle("kb-open", !!keyboardOpen);
}
updateAppViewportHeight();
window.addEventListener("resize", updateAppViewportHeight);
window.addEventListener("orientationchange", () => {
  // A real rotation resets the reference height.
  _maxViewportH = 0;
  setTimeout(updateAppViewportHeight, 250);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateAppViewportHeight);
}

/* Settings tracks the keyboard viewport independently from Study. Unlike
   --app-vh, these values may shrink while the keyboard is open so the active
   Settings field and bottom sheets remain inside the visible iOS viewport. */
let _settingsViewportFrame = 0;
function updateSettingsViewport() {
  const vv = window.visualViewport;
  const height = vv?.height || window.innerHeight;
  const offsetTop = vv?.offsetTop || 0;
  document.documentElement.style.setProperty("--settings-vvh", `${height}px`);
  document.documentElement.style.setProperty("--settings-vv-offset-top", `${offsetTop}px`);
  cancelAnimationFrame(_settingsViewportFrame);
  _settingsViewportFrame = requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.body.getAttribute("data-view") !== "settings") return;
    const active = document.activeElement;
    if (active?.matches?.("#view-settings input, #view-settings textarea, #view-settings select")) {
      active.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }));
}
updateSettingsViewport();
window.addEventListener("resize", updateSettingsViewport);
window.addEventListener("orientationchange", () => setTimeout(updateSettingsViewport, 250));
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateSettingsViewport);
  window.visualViewport.addEventListener("scroll", updateSettingsViewport);
}
// Belt-and-suspenders: also flag focus/blur of text fields directly, so the
// tab bar hides even on browsers that don't fire visualViewport resizes.
/* Only text-entry fields open the on-screen keyboard. A <select> shows a
   native picker instead, so flagging it would hide the bottom tab bar for no
   reason (and the bar would flicker back when the list closes). Checkboxes,
   radios, buttons and similar inputs never open a keyboard either. */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset", "range", "file", "color", "image",
]);
function opensKeyboard(el) {
  if (!el || !el.matches) return false;
  if (el.matches("textarea")) return true;
  if (el.matches("input")) return !NON_TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
  return false;
}
window.__opensKeyboard = opensKeyboard;
document.addEventListener("focusin", (e) => {
  if (opensKeyboard(e.target)) {
    document.body.classList.add("kb-open");
  }
});
document.addEventListener("focusout", (e) => {
  if (opensKeyboard(e.target)) {
    setTimeout(() => {
      if (!opensKeyboard(document.activeElement)) {
        document.body.classList.remove("kb-open");
      }
    }, 100);
  }
});

/* Boot */
/* Fallback for browsers without CSS :has() (iOS Safari < 15.4).
   Mirrors `label:has(input:checked)` by toggling an .is-checked class. */
function setupHasFallback() {
  try {
    if (typeof CSS !== "undefined" && CSS.supports && CSS.supports("selector(:has(*))")) return;
  } catch {}
  const sync = () => {
    document.querySelectorAll(".algo-option, .bulk-check").forEach(label => {
      const input = label.querySelector("input");
      label.classList.toggle("is-checked", !!(input && input.checked));
    });
  };
  document.addEventListener("change", e => {
    if (e.target && e.target.matches && e.target.matches('.algo-option input, .bulk-check input')) sync();
  });
  sync();
  window.__syncHasFallback = sync;
}

function setupScreenWakeLock() {
  if (!("wakeLock" in navigator)) return;
  let sentinel = null;
  let requestPending = false;

  const request = async () => {
    if (document.visibilityState !== "visible" || sentinel || requestPending) return;
    requestPending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (document.visibilityState !== "visible") {
        try { await lock.release(); } catch {}
        return;
      }
      sentinel = lock;
      lock.addEventListener("release", () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (document.visibilityState === "visible") window.setTimeout(request, 250);
      }, { once: true });
    } catch (error) {
      console.warn("Screen wake lock unavailable:", error);
    } finally {
      requestPending = false;
    }
  };

  const release = async () => {
    const current = sentinel;
    sentinel = null;
    if (current) {
      try { await current.release(); } catch {}
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") request();
    else release();
  });
  window.addEventListener("pageshow", request);
  request();
}

(async () => {
  try {
    await initState();
    document.body.setAttribute("data-view", "study");
    applyTheme();
    applyLanguage();
    bindStorageEvents();
    bindEvents();
    bindLearningLanguageControl();
    await refreshRecoveryAction();
    bindStudyEdgeMenu();
    initializeAppNavigation();
    setupHasFallback();
    startRealtimeStudyRefresh();
    setupScreenWakeLock();
    registerSW();
  } catch (e) {
    console.error("Boot failed:", e);
    document.body.innerHTML = '<div class="boot-error">Failed to load. Check console.</div>';
  }
})();

