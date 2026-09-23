/* Lingo Cards — Shared UI primitives, dialogs, toasts, theme and navigation */

/* ========================================================================
   UI / Rendering
   ======================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// 45 секунд ожидания означали, что зависший запрос держал интерфейс почти
// минуту. 25 секунд достаточно для ответа любой поддерживаемой модели.
const AI_TIMEOUT_MS = 25000;
let toastTimer = 0;
let activeDialog = null;
const dialogStack = [];
let activeAiJob = null;
const dialogReturnFocus = new WeakMap();
let pendingConfirmation = null;

function isAbortError(error) {
  return error?.name === "AbortError";
}

function aiJobMessage() {
  const lang = state.settings?.language || "en";
  if (lang === "ru") return "AI-запрос уже выполняется. Отменить его и запустить новый?";
  if (lang === "uk") return "AI-запит уже виконується. Скасувати його й запустити новий?";
  return "An AI request is already running. Cancel it and start a new one?";
}

async function startAiJob(kind, contextId, retry) {
  const languageBound = !String(kind).startsWith("settings-");
  const generation = typeof currentLanguageGeneration === "function" ? currentLanguageGeneration() : null;
  const staleContext = () => languageBound && (
    (typeof isLearningLanguageSwitchBusy === "function" && isLearningLanguageSwitchBusy())
    || (generation !== null && !isLanguageGenerationCurrent(generation))
  );
  if (staleContext()) return null;
  const current = activeAiJob;
  if (current && !current.controller.signal.aborted) {
    const confirmed = await confirmDialog({
      title: t("confirm.aiReplace.title"),
      message: t("confirm.aiReplace.message"),
      confirmLabel: t("confirm.aiReplace.action"),
      danger: true,
    });
    if (!confirmed || staleContext()) return null;
    if (activeAiJob !== current) return null;
    current.controller.abort(new DOMException("replaced", "AbortError"));
  }
  const controller = new AbortController();
  const job = { id: uid(), kind, contextId: String(contextId || ""), controller, retry };
  activeAiJob = job;
  return job;
}

function hasActiveAiJob(kind) {
  return !!activeAiJob && !activeAiJob.controller.signal.aborted && (!kind || activeAiJob.kind === kind);
}

async function prepareAiJob() {
  const job = activeAiJob;
  if (!job || job.controller.signal.aborted) return true;
  const confirmed = await confirmDialog({
    title: t("confirm.aiReplace.title"),
    message: t("confirm.aiReplace.message"),
    confirmLabel: t("confirm.aiReplace.action"),
    danger: true,
  });
  if (!confirmed) return false;
  job.controller.abort(new DOMException("replaced", "AbortError"));
  return true;
}

function isCurrentAiJob(job) {
  return ownsAiJob(job) && !job.controller.signal.aborted;
}

function ownsAiJob(job) {
  return !!job && activeAiJob?.id === job.id;
}

function finishAiJob(job) {
  if (activeAiJob?.id === job?.id) activeAiJob = null;
}

function cancelAiJobsForContext(contextId) {
  const id = String(contextId || "");
  if (activeAiJob && (!id || activeAiJob.contextId === id)) {
    activeAiJob.controller.abort(new DOMException("closed", "AbortError"));
  }
}

function cancelLanguageAiJobs() {
  const job = activeAiJob;
  if (!job || String(job.kind).startsWith("settings-")) return;
  cancelAiJobsForContext(job.contextId);
}

async function runAbortableWorkerPool(total, concurrency, task, options = {}) {
  const controller = options.controller || new AbortController();
  const results = new Array(Math.max(0, total));
  let cursor = 0;
  let completed = 0;
  let fatalError = null;

  async function worker() {
    while (!controller.signal.aborted && !fatalError) {
      const index = cursor++;
      if (index >= total) return;
      try {
        results[index] = await task(index, controller.signal);
      } catch (error) {
        if (!fatalError) {
          fatalError = error;
          if (!controller.signal.aborted) controller.abort(error);
        }
        return;
      } finally {
        completed++;
        options.onSettled?.(completed, total, index);
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency || 1), Math.max(0, total));
  await Promise.allSettled(Array.from({ length: workerCount }, worker));
  if (fatalError) throw fatalError;
  if (controller.signal.aborted) {
    throw controller.signal.reason || new DOMException("aborted", "AbortError");
  }
  return { results, completed };
}

function flash(element) {
  if (!element) return;
  element.classList.remove("ai-filled-flash");
  void element.offsetWidth;
  element.classList.add("ai-filled-flash");
  element.addEventListener("animationend", () => element.classList.remove("ai-filled-flash"), { once: true });
}

function openDialog(modal, preferredFocus) {
  if (!modal) return;
  const currentIndex = dialogStack.indexOf(modal);
  if (currentIndex !== -1) dialogStack.splice(currentIndex, 1);
  dialogStack.push(modal);
  activeDialog = modal;
  dialogReturnFocus.set(modal, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modal.hidden = false;
  requestAnimationFrame(() => {
    if (modal.hidden || activeDialog !== modal) return;
    const target = preferredFocus || modal.querySelector("[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
    target?.focus({ preventScroll: true });
  });
}

function closeDialog(modal) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const index = dialogStack.indexOf(modal);
  if (index !== -1) dialogStack.splice(index, 1);
  activeDialog = dialogStack[dialogStack.length - 1] || null;
  const target = dialogReturnFocus.get(modal);
  dialogReturnFocus.delete(modal);
  requestAnimationFrame(() => {
    if (activeDialog) {
      const fallback = activeDialog.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
      (target?.isConnected && activeDialog.contains(target) ? target : fallback)?.focus({ preventScroll: true });
    } else if (target?.isConnected) {
      target.focus({ preventScroll: true });
    }
  });
}

function settleConfirmDialog(confirmed) {
  if (!pendingConfirmation) return;
  const { resolve, choice } = pendingConfirmation;
  const result = confirmed && choice ? $("#confirmChoice").value : confirmed;
  pendingConfirmation = null;
  closeDialog($("#confirmModal"));
  resolve(result);
}

function cancelConfirmDialog() {
  settleConfirmDialog(false);
}

let pendingDuplicateCards = [];
let reopenDuplicateDialogAfterEditor = false;

function duplicateWordLabel(card) {
  return String(card?.front || "").trim() || t("duplicate.untitled");
}

function closeDuplicateDialog() {
  reopenDuplicateDialogAfterEditor = false;
  closeDialog($("#duplicateModal"));
  pendingDuplicateCards = [];
}

function showDuplicateDialog(cards) {
  const uniqueCards = [];
  const seen = new Set();
  for (const candidate of cards || []) {
    const card = candidate?.id
      ? getCardById(candidate.id)
      : findDuplicateCard(candidate?.deckId || state.activeDeckId, candidate?.front);
    if (!card?.id || seen.has(card.id)) continue;
    seen.add(card.id);
    uniqueCards.push(card);
  }
  if (!uniqueCards.length) return;

  pendingDuplicateCards = uniqueCards;
  const prefix = $("#duplicatePrefix");
  const words = $("#duplicateWords");
  const suffix = $("#duplicateSuffix");
  if (prefix) prefix.textContent = t(uniqueCards.length === 1 ? "duplicate.prefix.one" : "duplicate.prefix.many");
  if (suffix) suffix.textContent = t("duplicate.suffix");
  if (words) {
    words.replaceChildren();
    uniqueCards.forEach((card, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "duplicate-word";
      button.textContent = duplicateWordLabel(card);
      button.setAttribute("aria-label", t("duplicate.edit", { word: duplicateWordLabel(card) }));
      button.onclick = () => {
        reopenDuplicateDialogAfterEditor = true;
        closeDialog($("#duplicateModal"));
        openCardEditor(card.id);
      };
      words.appendChild(button);
      if (index < uniqueCards.length - 1) words.appendChild(document.createTextNode(", "));
    });
  }
  openDialog($("#duplicateModal"), $("#duplicateOkBtn"));
}

function restoreDuplicateDialogAfterEditor() {
  if (!reopenDuplicateDialogAfterEditor || !pendingDuplicateCards.length) return false;
  reopenDuplicateDialogAfterEditor = false;
  const liveCards = pendingDuplicateCards.map(card => getCardById(card.id)).filter(Boolean);
  if (!liveCards.length) {
    closeDuplicateDialog();
    return false;
  }
  showDuplicateDialog(liveCards);
  return true;
}

function settleTextInput(result = null) {
  const modal = $("#textInputModal");
  if (modal && !modal.hidden) closeDialog(modal);
  if (typeof activeTextInputCancel === "function") activeTextInputCancel(result);
}

let activeTextInputCancel = null;

function requestTextInput({ title, message = "", value = "", placeholder = "", confirmLabel = "", required = false } = {}) {
  const modal = $("#textInputModal");
  const input = $("#textInputField");
  const form = $("#textInputForm");
  if (!modal || !input || !form) return Promise.resolve(null);
  $("#textInputTitle").textContent = title || t("confirm.defaultTitle");
  $("#textInputMessage").textContent = message;
  $("#textInputMessage").hidden = !message;
  input.value = value;
  input.placeholder = placeholder;
  input.required = required;
  $("#textInputConfirm").textContent = confirmLabel || t("confirm.continue");
  return new Promise(resolve => {
    if (activeTextInputCancel) activeTextInputCancel(null);
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (activeTextInputCancel === finish) activeTextInputCancel = null;
      cancelButton.removeEventListener("click", handleCancel);
      form.removeEventListener("submit", handleSubmit);
      resolve(result);
    };
    const handleCancel = () => {
      closeDialog(modal);
      finish(null);
    };
    const handleSubmit = event => {
      event.preventDefault();
      const result = input.value.trim();
      if (required && !result) {
        input.focus({ preventScroll: true });
        return;
      }
      closeDialog(modal);
      finish(result);
    };
    const cancelButton = $("#textInputCancel");
    activeTextInputCancel = finish;
    cancelButton.addEventListener("click", handleCancel);
    form.addEventListener("submit", handleSubmit);
    openDialog(modal, input);
  });
}

function confirmDialog({ title, message, detail = "", confirmLabel, cancelLabel, danger = false, choice = null } = {}) {
  if (pendingConfirmation) settleConfirmDialog(false);
  const modal = $("#confirmModal");
  const confirmButton = $("#confirmAcceptBtn");
  if (!modal || !confirmButton) return Promise.resolve(false);

  $("#confirmTitle").textContent = title || t("confirm.defaultTitle");
  $("#confirmMessage").textContent = message || "";
  const detailElement = $("#confirmDetail");
  detailElement.textContent = detail || "";
  detailElement.hidden = !detail;
  $("#confirmCancelBtn").textContent = cancelLabel || t("modal.cancel");
  confirmButton.textContent = confirmLabel || t("confirm.continue");
  confirmButton.classList.toggle("danger", danger);
  confirmButton.classList.toggle("primary", !danger);

  const select = $("#confirmChoice");
  if (select) {
    select.hidden = !choice;
    select.replaceChildren();
    for (const item of choice?.options || []) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.append(option);
    }
    if (choice) select.value = choice.value;
  } else if (choice) return Promise.resolve(false);
  return new Promise(resolve => {
    pendingConfirmation = { resolve, choice };
    openDialog(modal, $("#confirmCancelBtn"));
  });
}

function trapDialogFocus(event) {
  if (event.key !== "Tab" || !activeDialog || activeDialog.hidden) return;
  const focusables = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', activeDialog)
    .filter(el => !el.hidden && el.getClientRects().length);
  if (!focusables.length) { event.preventDefault(); activeDialog.focus(); return; }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function toast(msg, options = {}) {
  const el = $("#toast");
  const isError = options.error === true;
  const duration = Number(options.duration) || (options.action ? 7000 : isError ? 8000 : 3000);
  clearTimeout(toastTimer);
  el.replaceChildren();
  const message = document.createElement("span");
  message.className = "toast-message";
  message.textContent = msg;
  el.appendChild(message);
  if (typeof options.action === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-action";
    action.textContent = options.actionLabel || t("topbar.undo");
    action.onclick = async () => {
      action.disabled = true;
      const keepOpen = await options.action();
      if (keepOpen !== false) el.hidden = true;
    };
    el.appendChild(action);
  }
  el.classList.toggle("is-error", isError);
  el.setAttribute("role", isError ? "alert" : "status");
  el.setAttribute("aria-live", isError ? "assertive" : "polite");
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

const THEME_COLOR_LIGHT = "#C96442";
const THEME_COLOR_DARK = "#1E1D1B";

function applyTheme() {
  const requested = state?.settings?.theme || "auto";
  try { localStorage.setItem("lingo-theme", requested); } catch {}
  const media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  const resolved = requested === "auto"
    ? (media?.matches ? "dark" : "light")
    : requested === "dark" ? "dark" : "light";
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  return resolved;
}

/* ----- Language ----- */
function applyLanguage() {
  window.I18N_LANG = state.settings.language || "uk";
  window.applyI18N(document);
  // Update lang switcher buttons
  $$(".lang-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === window.I18N_LANG));
  // Re-render dynamic content
  renderDeckSelector();
  if ($("#view-study").classList.contains("active")) renderStudy();
  if ($("#view-decks").classList.contains("active")) renderDecks();
  if ($("#view-stats").classList.contains("active")) renderStats();
  if (typeof refreshDeckCardsModal === "function") refreshDeckCardsModal();
  if (typeof updateSwapBtnTitle === "function") updateSwapBtnTitle();
  // applyI18N() переписал бы метки языка обучения переводом интерфейса,
  // поэтому после него восстанавливаем название изучаемого языка.
  if (typeof syncLearningLanguageControl === "function") syncLearningLanguageControl();
}

const APP_VIEWS = new Set(["study", "decks", "stats", "settings"]);
const SETTINGS_ROUTES = new Set(["home", "learning", "generation", "card-sound", "appearance", "data"]);
const SETTINGS_OVERLAYS = new Set(["algorithm", "picker", "voice", "confirm"]);
const SETTINGS_SCROLL_PREFIX = "lingo-cards:settings-scroll:";
let currentAppState = { view: "study", settingsRoute: "home", overlay: null };
let applyingPopState = false;
const settingsOverlayDialogs = new Map();

function layoutMode() {
  return window.matchMedia("(min-width: 900px)").matches ? "desktop" : "mobile";
}

function normalizeAppState(candidate = {}) {
  const view = APP_VIEWS.has(candidate.view) ? candidate.view : "study";
  const settingsRoute = view === "settings" && SETTINGS_ROUTES.has(candidate.settingsRoute)
    ? candidate.settingsRoute
    : "home";
  const overlay = view === "settings" && SETTINGS_OVERLAYS.has(candidate.overlay)
    ? candidate.overlay
    : null;
  return { view, settingsRoute, overlay };
}

function appStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeAppState({
    view: params.get("view") || "study",
    settingsRoute: params.get("section") || "home",
    overlay: null,
  });
}

function appStateUrl(appState) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", appState.view);
  if (appState.view === "settings" && appState.settingsRoute !== "home") {
    url.searchParams.set("section", appState.settingsRoute);
  } else {
    url.searchParams.delete("section");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function settingsScrollKey(appState = currentAppState) {
  return `${SETTINGS_SCROLL_PREFIX}${appState.view}:${appState.settingsRoute}:${layoutMode()}`;
}

function saveCurrentScroll() {
  const container = currentAppState.view === "settings" ? $("#view-settings") : window;
  const top = container === window ? window.scrollY : container?.scrollTop || 0;
  try { sessionStorage.setItem(settingsScrollKey(), String(top)); } catch {}
  if (history.state) {
    history.replaceState({ ...history.state, scrollTop: top }, "", appStateUrl(currentAppState));
  }
}

function restoreAppScroll(appState, historyEntry = history.state) {
  let stored = Number(historyEntry?.scrollTop);
  if (!Number.isFinite(stored)) {
    try { stored = Number(sessionStorage.getItem(settingsScrollKey(appState))); } catch {}
  }
  if (!Number.isFinite(stored)) stored = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const container = appState.view === "settings" ? $("#view-settings") : window;
    if (container === window) window.scrollTo(0, stored);
    else if (container) container.scrollTop = stored;
  }));
}

function renderSettingsRoute(route) {
  const desktop = layoutMode() === "desktop";
  $$("[data-settings-route]").forEach(panel => {
    const isHome = panel.dataset.settingsRoute === "home";
    const active = panel.dataset.settingsRoute === route;
    const visible = active || (desktop && isHome);
    // Preserve the original mobile route contract, then expose the home panel
    // as the desktop master without cloning any controls or IDs.
    panel.hidden = !active;
    panel.inert = !active;
    panel.setAttribute("aria-hidden", String(!active));
    if (visible !== active) {
      panel.hidden = false;
      panel.inert = false;
      panel.setAttribute("aria-hidden", "false");
    }
    panel.classList.toggle("is-settings-detail", desktop && active && !isHome);
  });
  $("#view-settings")?.classList.toggle("settings-desktop-detail", desktop && route !== "home");
  const topBack = $("#settingsTopBackBtn");
  if (topBack) {
    topBack.dataset.settingsRouteOpen = "home";
    topBack.hidden = desktop || route === "home";
    const label = topBack.querySelector("span");
    if (label) {
      label.dataset.i18n = "settings.back";
      label.textContent = t(label.dataset.i18n);
    }
  }
  $$("[data-settings-route-open]").forEach(button => {
    const selected = desktop && route !== "home" && button.dataset.settingsRouteOpen === route;
    button.classList.toggle("is-selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const title = route === "home"
    ? $("#settings-home .settings-home-title")
    : $(`#settings-${CSS.escape(route)} .settings-panel-title`);
  const announcement = $("#settingsRouteAnnouncement");
  if (announcement) announcement.textContent = title?.textContent?.trim() || "";
}

function applyOverlayState(next, previous) {
  if (previous?.overlay && previous.overlay !== next.overlay) {
    const oldDialog = settingsOverlayDialogs.get(previous.overlay);
    if (oldDialog && !oldDialog.hidden) closeDialog(oldDialog);
  }
  if (next.overlay) {
    const dialog = settingsOverlayDialogs.get(next.overlay);
    if (dialog?.hidden) openDialog(dialog);
  }
}

function applyAppState(candidate, { restoreScroll = true } = {}) {
  const next = normalizeAppState(candidate);
  const previous = currentAppState;
  currentAppState = next;
  if (next.view !== "decks" && viewingDeckId) closeDeckBrowse();
  $$(".nav-item").forEach(item => {
    const active = item.dataset.view === next.view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${next.view}`));
  document.body.setAttribute("data-view", next.view);
  if (next.view === "study") renderStudy();
  else if (next.view === "decks") renderDecks();
  else if (next.view === "stats") renderStats();
  else {
    renderSettings();
    renderSettingsRoute(next.settingsRoute);
  }
  if (next.view === "study") scheduleNextDueRefresh?.();
  else if (nextDueTimer) { clearTimeout(nextDueTimer); nextDueTimer = null; }
  if (typeof syncStudyCardTimer === "function") syncStudyCardTimer();
  applyOverlayState(next, previous);
  updateEdgeMenuAvailability?.();
  syncCompactSelectWidths();
  if (restoreScroll) restoreAppScroll(next);
}

function navigateAppState(candidate, { replace = false, focus = null } = {}) {
  if (!applyingPopState && typeof commitSettingsDrafts === "function" &&
      !commitSettingsDrafts("navigation")) return false;
  const next = normalizeAppState({ ...currentAppState, ...candidate });
  saveCurrentScroll();
  const method = replace ? "replaceState" : "pushState";
  history[method]({ ...next, scrollTop: 0 }, "", appStateUrl(next));
  applyAppState(next);
  if (focus && layoutMode() !== "desktop") requestAnimationFrame(() => {
    const target = typeof focus === "string"
      ? document.getElementById(focus)
      : document.querySelector(`#settings-${CSS.escape(next.settingsRoute)} .settings-back-btn, #settings-${CSS.escape(next.settingsRoute)} .settings-panel-title, #settings-${CSS.escape(next.settingsRoute)} button, #settings-${CSS.escape(next.settingsRoute)} input, #settings-${CSS.escape(next.settingsRoute)} select`);
    if (target && !target.hasAttribute("tabindex") && !target.matches("button, input, select, textarea, a[href]")) {
      target.setAttribute("tabindex", "-1");
    }
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  });
  return true;
}

function navigateToSettings(settingsRoute = "home", { focus = null, replace = true } = {}) {
  // Settings owns its internal back hierarchy. Replacing the current entry
  // keeps Safari's native edge-back from reopening Settings after another tab
  // becomes active.
  return navigateAppState({ view: "settings", settingsRoute, overlay: null }, { focus, replace });
}

function openSettingsOverlay(overlay, dialog, preferredFocus) {
  if (!SETTINGS_OVERLAYS.has(overlay) || !dialog) return false;
  settingsOverlayDialogs.set(overlay, dialog);
  if (!navigateAppState({ view: "settings", overlay }, { replace: true })) return false;
  if (dialog.hidden) openDialog(dialog, preferredFocus);
  return true;
}

function closeSettingsOverlay(overlay) {
  if (currentAppState.overlay !== overlay) return false;
  return navigateAppState({ view: "settings", overlay: null }, { replace: true });
}

function switchView(name) {
  const view = name === "browse" ? "decks" : name;
  // Tabs are peers, not a navigation stack. Replacing their history entry also
  // prevents Safari's native edge-back gesture from cycling through tabs.
  return navigateAppState(
    { view, settingsRoute: "home", overlay: null },
    { replace: true },
  );
}

function animateSettingsBack(targetRoute) {
  if (currentAppState.view !== "settings" || layoutMode() !== "mobile") {
    return navigateToSettings(targetRoute, { focus: true });
  }
  const settingsView = $("#view-settings");
  if (!settingsView || settingsView.classList.contains("settings-back-transition")) return false;
  settingsView.classList.add("settings-back-transition");
  const clearTransition = () => settingsView.classList.remove("settings-back-transition");
  settingsView.addEventListener("animationend", clearTransition, { once: true });
  window.setTimeout(clearTransition, 260);
  return navigateToSettings(targetRoute, { focus: true });
}

/* Interactive swipe-back (iOS-style), universal for any "detail over parent"
   screen: the detail panel follows the finger, the parent slides in from
   underneath with parallax and a fading dim. Release decides by distance OR
   velocity, then settles with a velocity-matched duration. Touch events are
   used because only touchmove.preventDefault() reliably blocks Safari 15
   scrolling. Styles live in css/polish.css (.swipe-back-*). */
const SWIPE_BACK_LOCK_PX = 10;
const SWIPE_BACK_PARALLAX = 0.3;
const SWIPE_BACK_DIM = 0.32;
const SWIPE_BACK_NO_START = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"], [data-no-swipe-back]';

function bindSwipeBack({ container, canStart, getPanel, getUnder, getUnderScroll = () => 0, isWindowScroll = false, onCommit }) {
  if (!container) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let settling = false;
  let gesture = null;
  const currentScroll = () => (isWindowScroll ? window.scrollY : container.scrollTop);

  // Writes happen at most once per display frame: iOS delivers touchmove
  // faster than it paints, and writing styles per event causes judder.
  const apply = (g, x) => {
    const progress = Math.min(1, Math.max(0, x / g.width));
    g.panel.style.transform = `translate3d(${x}px,0,0)`;
    g.under.style.transform = `translate3d(${-g.width * SWIPE_BACK_PARALLAX * (1 - progress)}px,0,0)`;
    container.style.setProperty("--swipe-back-dim", (SWIPE_BACK_DIM * (1 - progress)).toFixed(3));
    container.style.setProperty("--swipe-back-progress", progress.toFixed(3));
  };
  const paint = (g, x) => {
    g.x = x;
    if (g.frame) return;
    g.frame = requestAnimationFrame(() => { g.frame = 0; apply(g, g.x); });
  };
  const paintNow = (g, x) => {
    if (g.frame) { cancelAnimationFrame(g.frame); g.frame = 0; }
    g.x = x;
    apply(g, x);
  };

  const begin = g => {
    g.locked = true;
    g.width = container.clientWidth || window.innerWidth;
    g.underScroll = getUnderScroll();
    const a = document.activeElement;
    if (a && g.panel.contains(a)) a.blur?.();
    // Positioning context must exist BEFORE measuring, otherwise offsets are
    // taken against the wrong ancestor and the parent lands off-screen.
    container.classList.add("swipe-back-active");
    g.panel.classList.add("swipe-back-panel");
    const cRect = container.getBoundingClientRect();
    const pRect = g.panel.getBoundingClientRect();
    const scrollInside = isWindowScroll ? 0 : container.scrollTop;
    g.under.hidden = false;
    g.under.inert = true;
    g.under.classList.add("swipe-back-under");
    g.under.style.top = `${pRect.top - cRect.top + scrollInside + currentScroll() - g.underScroll}px`;
    g.under.style.left = `${pRect.left - cRect.left}px`;
    g.under.style.width = `${pRect.width}px`;
    // The detail panel must cover everything down to the viewport bottom,
    // otherwise short sections leave the parent visible below them.
    g.panel.style.minHeight = `${Math.max(pRect.height, window.innerHeight - pRect.top)}px`;
    paintNow(g, 0);
  };

  const cleanup = (g, restoreUnderHidden) => {
    if (g.frame) { cancelAnimationFrame(g.frame); g.frame = 0; }
    container.classList.remove("swipe-back-active", "swipe-back-settling");
    container.style.removeProperty("--swipe-back-dim");
    container.style.removeProperty("--swipe-back-ms");
    container.style.removeProperty("--swipe-back-progress");
    g.panel.classList.remove("swipe-back-panel");
    g.under.classList.remove("swipe-back-under");
    for (const el of [g.panel, g.under]) el.style.transform = el.style.top = el.style.left = el.style.width = el.style.minHeight = "";
    // inert is ALWAYS restored: leaving it set made the parent screen
    // permanently non-interactive after a committed swipe.
    g.under.inert = g.underWasInert;
    if (restoreUnderHidden) g.under.hidden = g.underWasHidden;
    settling = false;
  };

  const settle = (g, toX, velocity, done) => {
    const distance = Math.abs(toX - g.x);
    const speed = Math.max(Math.abs(velocity), 0.9); // px/ms
    const ms = reducedMotion.matches ? 0 : Math.round(Math.min(320, Math.max(160, distance / speed)));
    settling = true;
    container.style.setProperty("--swipe-back-ms", `${ms}ms`);
    container.classList.add("swipe-back-settling");
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    if (ms === 0 || distance < 1) { paintNow(g, toX); finish(); return; }
    g.panel.addEventListener("transitionend", event => { if (event.target === g.panel) finish(); }, { once: true });
    window.setTimeout(finish, ms + 80);
    // Flush the last finger position, then start the transition next frame.
    paintNow(g, g.x);
    requestAnimationFrame(() => paintNow(g, toX));
  };

  const cancel = (g, velocity = 0) => settle(g, 0, velocity, () => cleanup(g, true));
  const commit = (g, velocity) => settle(g, g.width, velocity, () => {
    cleanup(g, false);
    if (onCommit() === false) { g.under.hidden = g.underWasHidden; return; }
    if (isWindowScroll) window.scrollTo(0, g.underScroll); else container.scrollTop = g.underScroll;
  });

  container.addEventListener("touchstart", event => {
    gesture = null;
    if (settling || event.touches.length !== 1 || !canStart() || event.target?.closest?.(SWIPE_BACK_NO_START)) return;
    const panel = getPanel();
    const under = getUnder();
    if (!panel || !under || panel.hidden) return;
    const t = event.touches[0];
    gesture = { startX: t.clientX, startY: t.clientY, x: 0, locked: false, panel, under,
      underWasHidden: under.hidden, underWasInert: under.inert, samples: [{ x: 0, t: event.timeStamp }] };
  }, { passive: true });

  container.addEventListener("touchmove", event => {
    const g = gesture;
    if (!g) return;
    if (event.touches.length !== 1) { if (g.locked) cancel(g); gesture = null; return; }
    const t = event.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;
    if (!g.locked) {
      if (Math.abs(dx) < SWIPE_BACK_LOCK_PX && Math.abs(dy) < SWIPE_BACK_LOCK_PX) return;
      if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2 || window.getSelection?.()?.toString()) { gesture = null; return; }
      begin(g);
    }
    event.preventDefault();
    const x = Math.max(0, dx);
    paint(g, x);
    g.samples.push({ x, t: event.timeStamp });
    if (g.samples.length > 6) g.samples.shift();
  }, { passive: false });

  const end = event => {
    const g = gesture;
    gesture = null;
    if (!g?.locked) return;
    const recent = g.samples.filter(s => event.timeStamp - s.t < 100);
    const first = recent[0] || g.samples[0];
    const last = g.samples[g.samples.length - 1];
    const velocity = (last.x - first.x) / Math.max(1, last.t - first.t);
    const shouldCommit = event.type !== "touchcancel" && velocity > -0.2 &&
      (g.x > g.width * 0.45 || (velocity > 0.35 && g.x > 24));
    if (shouldCommit) commit(g, velocity); else cancel(g, velocity);
  };
  container.addEventListener("touchend", end, { passive: true });
  container.addEventListener("touchcancel", end, { passive: true });
}

function initializeSettingsEdgeSwipe() {
  const settingsView = $("#view-settings");
  bindSwipeBack({
    container: settingsView,
    canStart: () => currentAppState.view === "settings" &&
      settingsView.classList.contains("active") &&
      layoutMode() === "mobile" &&
      currentAppState.settingsRoute !== "home" &&
      !currentAppState.overlay,
    getPanel: () => $(`#settings-${CSS.escape(currentAppState.settingsRoute)}`),
    getUnder: () => $("#settings-home"),
    getUnderScroll: () => {
      try { return Number(sessionStorage.getItem(settingsScrollKey({ ...currentAppState, settingsRoute: "home" }))) || 0; } catch { return 0; }
    },
    onCommit: () => navigateToSettings("home", { focus: true }),
  });
}

function initializeDeckBrowseSwipe() {
  const decksView = $("#view-decks");
  bindSwipeBack({
    container: decksView,
    isWindowScroll: true,
    canStart: () => currentAppState.view === "decks" &&
      decksView.classList.contains("active") &&
      layoutMode() !== "desktop" &&
      !!viewingDeckId &&
      !document.querySelector(".modal:not([hidden])"),
    getPanel: () => $("#deckBrowse"),
    getUnder: () => $("#decksOverview"),
    onCommit: () => { closeDeckBrowse({ instant: true }); },
  });
}

function initializeAppNavigation() {
  history.scrollRestoration = "manual";
  initializeSettingsEdgeSwipe();
  initializeDeckBrowseSwipe();
  const settingsLayoutQuery = window.matchMedia("(min-width: 900px)");
  const syncSettingsLayout = () => {
    if (currentAppState.view !== "settings") return;
    renderSettingsRoute(currentAppState.settingsRoute);
    restoreAppScroll(currentAppState);
  };
  if (typeof settingsLayoutQuery.addEventListener === "function") {
    settingsLayoutQuery.addEventListener("change", syncSettingsLayout);
  } else {
    settingsLayoutQuery.addListener?.(syncSettingsLayout);
  }
  const initial = appStateFromUrl();
  currentAppState = initial;
  history.replaceState({ ...initial, scrollTop: 0 }, "", appStateUrl(initial));
  applyAppState(initial);
  window.addEventListener("popstate", event => {
    applyingPopState = true;
    const next = normalizeAppState(event.state || appStateFromUrl());
    history.replaceState({ ...next, scrollTop: Number(event.state?.scrollTop) || 0 }, "", appStateUrl(next));
    applyAppState(next);
    applyingPopState = false;
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    const next = normalizeAppState(history.state || appStateFromUrl());
    history.replaceState({ ...next, scrollTop: Number(history.state?.scrollTop) || 0 }, "", appStateUrl(next));
    applyAppState(next);
  });
}


/* ----- Bottom-sheet drag (touch): pull up to expand, pull down to dismiss -----
   The sheet follows the finger; it closes only when its visible height has
   been pulled down to 20% of the screen height or less. A shorter downward
   pull snaps the sheet back to its own height, so it never stays parked
   mid-screen. */
(function bindSheetDrag() {
  const SHEET_MODALS = ["#editorModal", "#deckModal", "#bulkModal", "#wordInfoModal", "#practiceModal"];

  function closeSheetModal(modal) {
    if (modal && modal.id === "wordInfoModal") {
      /* Word info can be stacked above the card editor — close only itself. */
      closeDialog(modal);
      if (typeof clearKeyboardFlag === "function") clearKeyboardFlag();
      return;
    }
    if (typeof closeModal === "function") closeModal();
    else closeDialog(modal);
  }

  /* Dragging can leave a stale "keyboard open" flag behind on iPhones whose
     visualViewport never fires the matching resize — that hides the bottom
     tab bar for good. Clear it once the sheet is gone and nothing text-y
     has focus. */
  /* Drag-close must never leave the "keyboard open" flag behind: a sheet may
     restore focus to an input/select it was opened from, which would keep the
     bottom tab bar hidden. Blur such a restored field and clear the flag on
     the next frames (double pass wins the focusout race on old iOS). */
  function clearKeyboardFlag() {
    const sweep = () => {
      /* Only text-entry fields keep the keyboard (and thus the flag) alive;
         a <select> shows a native picker without a keyboard. */
      const opensKeyboard = window.__opensKeyboard || ((el) =>
        !!(el && el.matches && el.matches("input, textarea")));
      const a = document.activeElement;
      if (opensKeyboard(a) && !a.closest(".modal:not([hidden])")) {
        a.blur();
      }
      if (!opensKeyboard(document.activeElement)) {
        document.body.classList.remove("kb-open");
      }
    };
    requestAnimationFrame(sweep);
    setTimeout(sweep, 150);
  }

  for (const selector of SHEET_MODALS) {
    const modal = $(selector);
    if (!modal) continue;
    const panel = modal.querySelector(".modal-panel");
    if (!panel) continue;
    const zones = [panel.querySelector(".sheet-grabber"), panel.querySelector(".modal-head")].filter(Boolean);
    if (!zones.length) continue;
    let drag = null;

    function onStart(e) {
      if (modal.hidden || e.touches.length !== 1) return;
      if (e.target.closest("button, input, select, textarea, a, .btn")) return;
      drag = {
        y: e.touches[0].clientY,
        startH: Math.round(panel.getBoundingClientRect().height),
        active: false,
        lastDy: 0,
      };
    }

    function onMove(e) {
      if (!drag) return;
      const dy = e.touches[0].clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) < 10) return;
        drag.active = true;
        panel.classList.add("sheet-dragging");
      }
      e.preventDefault();
      const maxH = Math.round(window.innerHeight * 0.96);
      const h = Math.max(1, Math.min(maxH, Math.round(drag.startH - dy)));
      panel.style.height = `${h}px`;
      drag.lastDy = dy;
    }

    function onEnd() {
      if (!drag) return;
      const { active, lastDy } = drag;
      drag = null;
      panel.classList.remove("sheet-dragging");
      if (!active) return;
      // Close once the sheet has been pulled down by 20% of the screen
      // height or more; a shorter pull snaps back. The same rule applies
      // to every sheet modal, tall or short.
      if (lastDy >= 0 && lastDy >= Math.round(window.innerHeight * 0.2)) {
        panel.style.height = "";
        const focused = document.activeElement;
        if (focused && modal.contains(focused) && focused.matches && focused.matches("input, textarea, select")) {
          focused.blur();
        }
        closeSheetModal(modal);
        clearKeyboardFlag();
        return;
      }
      if (lastDy >= 0) panel.style.height = "";
      // Upward drag keeps the expanded height chosen by the finger.
    }

    for (const el of zones) {
      el.addEventListener("touchstart", onStart, { passive: true });
      el.addEventListener("touchmove", onMove, { passive: false });
      el.addEventListener("touchend", onEnd);
      el.addEventListener("touchcancel", onEnd);
    }
  }
})();
