/* Lingo Cards — Heatmap, PWA lifecycle and statistics */

/* Canonical per-language history source. `state.history` is only a
   compatibility mirror of the active language profile, so statistics must read
   the profile to avoid showing another language's activity. */
function statsHistory() {
  if (typeof activeLanguageProfile === "function") {
    const profile = activeLanguageProfile(state);
    if (profile && profile.history) return profile.history;
  }
  return state.history || {};
}

/* ----- Heatmap (GitHub-style activity grid) ----- */
function patchElementList(container, items, keyOf, createElement, updateElement) {
  const existing = new Map(Array.from(container.children).map(node => [node.dataset.renderKey, node]));
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const key = String(keyOf(item));
    let node = existing.get(key);
    if (!node) node = createElement(item);
    node.dataset.renderKey = key;
    updateElement(node, item);
    existing.delete(key);
    fragment.appendChild(node);
  }
  for (const node of existing.values()) node.remove();
  container.appendChild(fragment);
}

function renderHeatmap() {
  const container = $("#heatmapContainer");
  if (!container) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const totalDays = 364;
  const startDay = new Date(today); startDay.setDate(today.getDate() - totalDays);
  // Align start so columns are full weeks (Mon-first)
  const dow = (startDay.getDay() + 6) % 7;        // 0..6, Mon=0
  startDay.setDate(startDay.getDate() - dow);

  const history = statsHistory();
  const cells = [];
  for (let i = 0; i <= totalDays + dow; i++) {
    const d = new Date(startDay); d.setDate(startDay.getDate() + i);
    const k = todayKey(d);
    const v = history[k]?.reviewed || 0;
    cells.push({ d, k, v, future: d > today });
  }
  const max = Math.max(1, ...cells.map(c => c.v));

  let grid = container.querySelector(".heatmap-grid");
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "heatmap-grid";
    container.appendChild(grid);
  }
  const columns = [];
  for (let col = 0; col < Math.ceil(cells.length / 7); col++) {
    columns.push({ index: col, cells: cells.slice(col * 7, col * 7 + 7) });
  }
  patchElementList(grid, columns, column => column.index,
    () => {
      const colDiv = document.createElement("div");
      colDiv.className = "heat-col";
      return colDiv;
    },
    (colDiv, column) => {
      patchElementList(colDiv, column.cells, cell => cell?.k || `future-${column.index}`,
        () => {
          const div = document.createElement("div");
          div.className = "heat-cell";
          return div;
        },
        (div, cell) => {
          div.className = "heat-cell";
          div.removeAttribute("title");
          if (!cell || cell.future) {
            div.classList.add("h-future");
            return;
          }
          let lvl = 0;
          if (cell.v > 0) {
            const pct = cell.v / max;
            if (pct <= 0.10) lvl = 1;
            else if (pct <= 0.30) lvl = 2;
            else if (pct <= 0.60) lvl = 3;
            else lvl = 4;
          }
          div.classList.add("h-" + lvl);
          div.title = t("stats.heatmap.tip", { date: cell.k, n: cell.v });
        });
    });
}

/* ----- Swap direction handler ----- */
function swapDeckDirection() {
  if (!session?.currentId) return;
  session.currentCardFront = session.currentCardFront === "local" ? "english" : "local";
  invalidateStudyStage();
  toast(t("dir.swapped.toast"));
  renderStudy();
  updateSwapBtnTitle();
}

function updateSwapBtnTitle() {
  const buttons = [$("#swapDirBtn"), $("#desktopSwapBtn")].filter(Boolean);
  const edgeLabel = $("#edgeSwapDirection");
  const front = session?.currentCardFront
    || (state.settings.studyCardFronts || ["english"])[0];
  const dir = front === "local" ? t("dir.reverse") : t("dir.forward");
  buttons.forEach(btn => {
    const label = t("topbar.swapDir.tip", { dir });
    btn.title = label;
    btn.setAttribute("aria-label", label);
  });
  if (edgeLabel) edgeLabel.textContent = t("edge.swap.direction", { dir });
}

/* ----- Service worker ----- */
const SERVICE_WORKER_URL = "sw.js?v=3.20.5";
let swRegistration = null;
let swRefreshing = false;
let swUpdateApplying = false;
let swUpdateReloadPending = false;
let swUpdateCheckInFlight = false;
let swUpdateCheckTimer = null;
let swUpdateFallbackTimer = null;
const SW_UPDATE_FALLBACK_MS = 4_000;
// Обновление применяется за доли секунды, поэтому без минимальной длительности
// blur-анимацию просто не успеваешь заметить.
const SW_UPDATE_OVERLAY_MIN_MS = 1_400;
let swUpdateOverlayShownAt = 0;

function isStandalonePwa() {
  return navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

function reloadForServiceWorkerUpdate() {
  if (!swUpdateReloadPending || swRefreshing) return;
  swRefreshing = true;
  if (swUpdateFallbackTimer !== null) {
    window.clearTimeout(swUpdateFallbackTimer);
    swUpdateFallbackTimer = null;
  }
  // Держим blur-оверлей на экране минимум SW_UPDATE_OVERLAY_MIN_MS, иначе
  // перезагрузка происходит раньше, чем пользователь успевает её заметить.
  const shown = swUpdateOverlayShownAt ? Date.now() - swUpdateOverlayShownAt : SW_UPDATE_OVERLAY_MIN_MS;
  const wait = Math.max(0, SW_UPDATE_OVERLAY_MIN_MS - shown);
  if (wait > 0) {
    window.setTimeout(() => window.location.reload(), wait);
    return;
  }
  window.location.reload();
}

function showUpdateOverlay() {
  const overlay = $("#updateOverlay");
  if (!overlay) return;
  const text = overlay.querySelector(".update-overlay-text");
  if (text) text.textContent = t("pwa.updating");
  overlay.hidden = false;
  swUpdateOverlayShownAt = Date.now();
  document.body.classList.add("is-updating");
}

function hideUpdateOverlay() {
  const overlay = $("#updateOverlay");
  if (overlay) overlay.hidden = true;
  swUpdateOverlayShownAt = 0;
  document.body.classList.remove("is-updating");
}

async function applyServiceWorkerUpdate({ button = null, automatic = false } = {}) {
  const registration = swRegistration;
  if (!registration?.waiting || swUpdateApplying) return false;
  swUpdateApplying = true;
  if (button) button.disabled = true;
  try {
    if (typeof commitSettingsDrafts === "function") {
      const draftsCommitted = commitSettingsDrafts("service-worker-update");
      if (!draftsCommitted) {
        if (button) button.disabled = false;
        updatePwaStatus("update");
        const notice = $("#updateNotice");
        if (notice) notice.hidden = false;
        return false;
      }
    }
    const storage = window.LCStorage;
    if (typeof storage?.flush === "function") await storage.flush();
    const waitingWorker = registration.waiting;
    swUpdateReloadPending = true;
    showUpdateOverlay();
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    swUpdateFallbackTimer = window.setTimeout(() => {
      swUpdateFallbackTimer = null;
      reloadForServiceWorkerUpdate();
    }, SW_UPDATE_FALLBACK_MS);
    return true;
  } catch (error) {
    console.warn(automatic ? "Automatic SW update failed" : "SW update failed", error);
    if (typeof reportSaveError === "function") reportSaveError(error);
    if (typeof toast === "function") toast(t("toast.saveFailed"), { error: true });
    swUpdateReloadPending = false;
    hideUpdateOverlay();
    if (swUpdateFallbackTimer !== null) {
      window.clearTimeout(swUpdateFallbackTimer);
      swUpdateFallbackTimer = null;
    }
    if (button) button.disabled = false;
    updatePwaStatus("update");
    const notice = $("#updateNotice");
    if (notice) notice.hidden = false;
    return false;
  } finally {
    swUpdateApplying = false;
  }
}

function maybeApplyStandaloneUpdate(registration) {
  // Раньше автоприменение работало только в установленной PWA, а в остальных
  // режимах пользователю оставалась только кнопка. Теперь обновление
  // применяется само в любом режиме, если вкладка активна и worker ждёт.
  if (!navigator.serviceWorker.controller || !registration.waiting) return;
  // В установленной PWA применяем почти мгновенно, во вкладке браузера даём
  // чуть больше времени, чтобы уведомление успело показаться.
  const delay = isStandalonePwa() ? 200 : 600;
  setTimeout(() => {
    if (document.visibilityState === "visible" && registration.waiting) {
      applyServiceWorkerUpdate({ automatic: true });
    }
  }, delay);
}

function showUpdateAvailable(registration) {
  swRegistration = registration;
  updatePwaStatus("update");
  const notice = $("#updateNotice");
  if (notice) notice.hidden = false;
  maybeApplyStandaloneUpdate(registration);
}

function watchServiceWorkerRegistration(registration) {
  swRegistration = registration;
  if (registration.waiting && navigator.serviceWorker.controller) showUpdateAvailable(registration);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateAvailable(registration);
    });
  });
}

function requestServiceWorkerUpdate() {
  if (document.visibilityState && document.visibilityState !== "visible") return;
  window.clearTimeout(swUpdateCheckTimer);
  swUpdateCheckTimer = window.setTimeout(async () => {
    if (!swRegistration || swUpdateCheckInFlight) return;
    swUpdateCheckInFlight = true;
    try {
      await swRegistration.update();
      if (swRegistration.waiting && navigator.serviceWorker.controller) showUpdateAvailable(swRegistration);
    } catch (error) {
      console.warn("SW update check failed", error);
    } finally {
      swUpdateCheckInFlight = false;
    }
  }, 250);
}

function registerSW() {
  updatePwaStatus();
  window.addEventListener("online", () => {
    updatePwaStatus(swRegistration?.waiting ? "update" : "online");
    requestServiceWorkerUpdate();
  });
  window.addEventListener("offline", () => updatePwaStatus("offline"));
  window.addEventListener("pageshow", requestServiceWorkerUpdate);
  document.addEventListener?.("visibilitychange", requestServiceWorkerUpdate);
  $("#applyUpdateBtn")?.addEventListener("click", event => {
    return applyServiceWorkerUpdate({ button: event.currentTarget });
  });
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    reloadForServiceWorkerUpdate();
  });
  navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: "none" }).then(registration => {
    watchServiceWorkerRegistration(registration);
    requestServiceWorkerUpdate();
  }).catch(err => {
    console.warn("SW register failed", err);
    updatePwaStatus(navigator.onLine ? "online" : "offline");
  });
}

function updatePwaStatus(status = navigator.onLine ? "online" : "offline") {
  const indicator = $("#pwaStatus");
  if (!indicator) return;
  const key = status === "update" ? "pwa.updateAvailable" : status === "offline" ? "pwa.offline" : "pwa.online";
  const label = t(key);
  indicator.dataset.status = status;
  indicator.textContent = "";
  indicator.setAttribute("aria-label", label);
  indicator.title = label;
}

function formatDue(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return t("common.now");
  if (diff < 60 * 60 * 1000) return `${t("common.dueIn")} ${Math.round(diff / 60000)}m`;
  if (diff < DAY_MS) return `${t("common.dueIn")} ${Math.round(diff / (60*60*1000))}h`;
  return `${t("common.dueIn")} ${Math.round(diff / DAY_MS)}d`;
}

/* ----- Friendly "next review" helpers ----- */
function localeTag() {
  return ({ uk: "uk-UA", ru: "ru-RU", en: "en-US" })[window.I18N_LANG] || "uk-UA";
}
function relWhen(ms) {
  let diff = ms - Date.now();
  if (diff < 0) diff = 0;
  const min = Math.round(diff / 60000);
  if (min < 1) return t("when.lessMin");
  if (min < 60) return t("when.min", { n: min });
  if (diff < DAY_MS) return t("when.hours", { n: Math.round(diff / 3600000) });
  return t("when.days", { n: Math.round(diff / DAY_MS) });
}
function absWhen(ms) {
  const d = new Date(ms);
  const loc = localeTag();
  const today = new Date();
  const tom = new Date(today.getTime() + DAY_MS);
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return t("when.today", { time });
  if (d.toDateString() === tom.toDateString()) return t("when.tomorrow", { time });
  return d.toLocaleDateString(loc, { day: "numeric", month: "long" });
}
// "через 2 ч · сегодня в 20:15"
function friendlyWhen(ms) {
  return `${t("common.dueIn")} ${relWhen(ms)} · ${absWhen(ms)}`;
}
// Soonest future due time among non-new, non-suspended cards (optionally in one deck)
function nextDueAt(deckId) {
  const now = Date.now();
  let min = null;
  for (const c of activeCards(deckId)) {
    if (c.state === "suspended" || c.state === "new") continue;
    if (deckId && c.deckId !== deckId) continue;
    if (c.due <= now) continue;
    if (min === null || c.due < min) min = c.due;
  }
  return min;
}
function hasNewInDeck(deckId) {
  return activeCards(deckId).some(c => c.state === "new");
}

/* ----- Stats view ----- */
function renderStats() {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const forecast = Array.from({ length: 14 }, () => 0);
  let mature = 0;
  let young = 0;
  let due = 0;
  const statsCards = activeCards();
  for (const card of statsCards) {
    if (card.state === "review") {
      if (card.interval >= 21) mature += 1;
      else young += 1;
    } else if (card.state === "learning") {
      young += 1;
    }
    if (card.state === "suspended" || card.state === "new") continue;
    if (card.due <= now) due += 1;
    const dayDiff = Math.floor((card.due - startOfDay.getTime()) / DAY_MS);
    if (dayDiff >= 0 && dayDiff < 14) forecast[dayDiff] += 1;
    else if (dayDiff < 0) forecast[0] += 1;
  }
  const total = statsCards.length;
  const history = statsHistory();
  const reviewed = (history[todayKey()]?.reviewed) || 0;

  let retNum = 0, retDen = 0;
  const cutoff = now - 30 * DAY_MS;
  Object.entries(history).forEach(([k, v]) => {
    const day = new Date(k).getTime();
    if (day >= cutoff) {
      retNum += (v.good || 0) + (v.easy || 0);
      retDen += v.reviewed || 0;
    }
  });
  const retention = retDen > 0 ? Math.round((retNum / retDen) * 100) + "%" : "—";

  $("#sTotal").textContent = total;
  $("#sMature").textContent = mature;
  $("#sYoung").textContent = young;
  $("#sDue").textContent = due;
  $("#sReviewed").textContent = reviewed;
  $("#sRetention").textContent = retention;

  const reviewBars = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    const v = history[k]?.reviewed || 0;
    reviewBars.push({ key: k, label: d.getDate(), value: v });
  }
  renderBars($("#reviewChart"), reviewBars);

  const fcBars = forecast.map((v, i) => {
    const d = new Date(startOfDay); d.setDate(d.getDate() + i);
    return { key: todayKey(d), label: d.getDate(), value: v };
  });
  renderBars($("#forecastChart"), fcBars);
  renderHeatmap();
}

function renderBars(container, data) {
  const max = Math.max(1, ...data.map(d => d.value));
  patchElementList(container, data, d => d.key,
    () => {
      const bar = document.createElement("div");
      bar.className = "bar";
      const tip = document.createElement("span");
      tip.className = "tip";
      bar.appendChild(tip);
      return bar;
    },
    (bar, d) => {
      bar.style.height = `${(d.value / max) * 100}%`;
      bar.dataset.day = d.label;
      bar.firstElementChild.textContent = `${d.value} · ${d.key}`;
    });
}

