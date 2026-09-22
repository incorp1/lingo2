const EDGE_OPEN_START_RATIO = 0.6;
const EDGE_OPEN_DISTANCE = 40;
const EDGE_HORIZONTAL_BIAS = 1.15;
const EDGE_MENU_GAP = 8;
const EDGE_TAB_DRAG_THRESHOLD = 8;
// Палец на телефоне всегда немного «плывёт» при тапе, поэтому у самого язычка
// порог перетаскивания заметно выше: иначе обычный тап превращался в drag,
// язычок прыгал к пальцу, а клик подавлялся и меню не открывалось.
const EDGE_TAB_DRAG_START = 18;
const EDGE_ANCHOR_STORAGE_KEY = "lingo-cards-edge-anchor";
let edgeGesture = null;
let edgeTabGesture = null;
let edgeMenuOpen = false;
let edgeMenuAnimatingOpen = false;
let edgeRestoreFocus = null;
let edgeAnchorY = window.innerHeight / 2;
let edgeCloseSequence = 0;
let edgeClickGuardUntil = 0;
let edgeOpeningGuardTimer = null;

function guardSyntheticEdgeClick() {
  edgeClickGuardUntil = performance.now() + 500;
}

function consumeSyntheticEdgeClick(event) {
  if (performance.now() > edgeClickGuardUntil) {
    edgeClickGuardUntil = 0;
    return false;
  }
  edgeClickGuardUntil = 0;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function setEdgeGestureSwiping(active) {
  document.body.classList.toggle("edge-menu-swiping", active);
  // Снимаем hover/active-подсветку с пункта, под которым проехал палец:
  // iOS оставляет её до следующего касания, из-за чего после свайпа открытое
  // меню выглядело так, будто пункт уже выбран.
  if (active && document.activeElement instanceof HTMLElement) {
    if ($("#studyEdgeMenu")?.contains(document.activeElement)) document.activeElement.blur();
  }
}

function captureEdgeGesturePointer(gesture) {
  if (gesture.captureTarget) return;
  const target = gesture.pointerTarget;
  if (!target?.setPointerCapture) return;
  try {
    target.setPointerCapture(gesture.pointerId);
    gesture.captureTarget = target;
  } catch {}
}

function releaseEdgeGesturePointer(gesture) {
  const target = gesture?.captureTarget;
  if (!target) return;
  try {
    if (target.hasPointerCapture(gesture.pointerId)) target.releasePointerCapture(gesture.pointerId);
  } catch {}
  gesture.captureTarget = null;
}

function clearEdgeGesture(gesture) {
  releaseEdgeGesturePointer(gesture);
  setEdgeGestureSwiping(false);
  edgeGesture = null;
}

function isEdgeMenuAvailable() {
  return window.matchMedia("(max-width: 860px)").matches && document.body.getAttribute("data-view") === "study";
}

function clampEdgeAnchorY(y) {
  const tab = $("#studyEdgeTab");
  const halfHeight = Math.max(16, (tab?.offsetHeight || 32) / 2);
  const topInset = Math.max(EDGE_MENU_GAP, halfHeight);
  const bottomInset = Math.max(EDGE_MENU_GAP + 62, halfHeight);
  return Math.max(topInset, Math.min(Number(y) || window.innerHeight / 2, window.innerHeight - bottomInset));
}

function positionStudyEdgeTab() {
  const tab = $("#studyEdgeTab");
  if (!tab) return;
  tab.style.setProperty("--edge-tab-y", `${Math.round(edgeAnchorY)}px`);
}

function setEdgeAnchorY(clientY, { persist = false } = {}) {
  edgeAnchorY = clampEdgeAnchorY(clientY);
  positionStudyEdgeTab();
  if (persist) {
    try { localStorage.setItem(EDGE_ANCHOR_STORAGE_KEY, String(edgeAnchorY / window.innerHeight)); } catch {}
  }
}

function restoreEdgeAnchorY() {
  let ratio = NaN;
  try { ratio = Number(localStorage.getItem(EDGE_ANCHOR_STORAGE_KEY)); } catch {}
  setEdgeAnchorY(Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio * window.innerHeight : window.innerHeight / 2);
}

function updateStudyEdgeTabState() {
  const tab = $("#studyEdgeTab");
  if (!tab) return;
  const expanded = edgeMenuOpen || edgeMenuAnimatingOpen;
  const fallback = expanded ? "Закрыть меню" : "Открыть меню";
  const key = expanded ? "edge.tab.close" : "edge.tab.open";
  const translated = typeof t === "function" ? t(key) : fallback;
  const label = translated === key ? fallback : translated;
  tab.classList.toggle("is-open", expanded);
  tab.setAttribute("aria-expanded", String(expanded));
  tab.setAttribute("aria-label", label);
  tab.setAttribute("title", label);
}

function updateEdgeMenuAvailability() {
  const available = isEdgeMenuAvailable();
  const tab = $("#studyEdgeTab");
  tab?.classList.toggle("is-visible", available);
  if (tab) tab.hidden = !available;
  if (!available) closeStudyEdgeMenu({ restoreFocus: false });
  else {
    setEdgeAnchorY(edgeAnchorY);
    updateStudyEdgeTabState();
  }
}

function positionStudyEdgeMenu(anchorY = edgeAnchorY) {
  const menu = $("#studyEdgeMenu");
  if (!menu) return;
  setEdgeAnchorY(anchorY);
  const height = menu.offsetHeight || 196;
  const maxTop = Math.max(EDGE_MENU_GAP, window.innerHeight - height - EDGE_MENU_GAP);
  const top = Math.max(EDGE_MENU_GAP, Math.min(edgeAnchorY - 28, maxTop));
  menu.style.setProperty("--edge-menu-top", `${Math.round(top)}px`);
}

function openStudyEdgeMenu(anchorY = edgeAnchorY, { focus = false, persistAnchor = true } = {}) {
  if (!isEdgeMenuAvailable()) return;
  const menu = $("#studyEdgeMenu");
  const scrim = $("#studyEdgeScrim");
  if (!menu || !scrim) return;
  setEdgeAnchorY(anchorY, { persist: persistAnchor });
  positionStudyEdgeMenu(edgeAnchorY);
  if (edgeMenuOpen || edgeMenuAnimatingOpen) return;
  edgeCloseSequence++;
  edgeMenuAnimatingOpen = true;
  if (!edgeRestoreFocus) edgeRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  menu.hidden = false;
  scrim.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  updateStudyEdgeTabState();
  // Пока меню выезжает, палец ещё находится над ним. Блокируем приём указателя
  // и подсветку, иначе пункт под пальцем остаётся «выбранным» после свайпа.
  document.body.classList.add("edge-menu-opening");
  window.clearTimeout(edgeOpeningGuardTimer);
  edgeOpeningGuardTimer = window.setTimeout(() => {
    document.body.classList.remove("edge-menu-opening");
  }, 380);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!edgeMenuAnimatingOpen) return;
    menu.classList.add("is-open");
    scrim.classList.add("is-open");
    document.body.classList.add("edge-menu-open");
    edgeMenuOpen = true;
    edgeMenuAnimatingOpen = false;
    updateStudyEdgeTabState();
    if (focus) menu.querySelector("button")?.focus();
  }));
}

function closeStudyEdgeMenu({ restoreFocus = false } = {}) {
  const menu = $("#studyEdgeMenu");
  const scrim = $("#studyEdgeScrim");
  if (!menu || !scrim) return;
  edgeMenuAnimatingOpen = false;
  window.clearTimeout(edgeOpeningGuardTimer);
  edgeOpeningGuardTimer = null;
  document.body.classList.remove("edge-menu-opening");
  const sequence = ++edgeCloseSequence;
  menu.classList.remove("is-open");
  scrim.classList.remove("is-open");
  document.body.classList.remove("edge-menu-open");
  setStudyEdgeModeExpanded(false);
  menu.setAttribute("aria-hidden", "true");
  edgeMenuOpen = false;
  updateStudyEdgeTabState();
  const finish = () => {
    if (sequence !== edgeCloseSequence || edgeMenuOpen || edgeMenuAnimatingOpen) return;
    menu.hidden = true;
    scrim.hidden = true;
  };
  menu.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, 320);
  if (restoreFocus && edgeRestoreFocus?.isConnected) edgeRestoreFocus.focus();
  edgeRestoreFocus = null;
}

function runStudyEdgeAction(action) {
  closeStudyEdgeMenu();
  action();
}

function openStudySettings() {
  navigateToSettings("learning", { focus: true });
}

function renderStudyEdgeModePicker() {
  const modes = state.settings.studyCardModes || ["word"];
  const fronts = state.settings.studyCardFronts || ["english"];
  const panel = $("#edgeModePanel");
  const summary = $("#edgeModeSummary");
  if (!panel || !summary) return;
  panel.querySelectorAll('input[name="edgeStudyMode"]').forEach(input => {
    input.checked = modes.includes(input.value);
  });
  panel.querySelectorAll('input[name="edgeStudyFront"]').forEach(input => {
    input.checked = fronts.includes(input.value);
  });
  summary.textContent = `${modes.map(studyModeLabel).join(" + ")} · ${fronts.map(studyFrontLabel).join(" + ")}`;
}

function setStudyEdgeModeExpanded(expanded, { focus = false } = {}) {
  const trigger = $("#edgeModeBtn");
  const panel = $("#edgeModePanel");
  if (!trigger || !panel) return;
  panel.hidden = !expanded;
  trigger.setAttribute("aria-expanded", String(expanded));
  if (expanded) {
    renderStudyEdgeModePicker();
    positionStudyEdgeMenu(edgeAnchorY);
    if (focus) panel.querySelector('input[type="checkbox"]')?.focus({ preventScroll: true });
  } else {
    positionStudyEdgeMenu(edgeAnchorY);
  }
}

function commitStudyEdgeSelection(groupName, commit) {
  const inputs = [...document.querySelectorAll(`input[name="${groupName}"]`)];
  const selected = inputs.filter(input => input.checked).map(input => input.value);
  if (!selected.length) {
    const changed = document.activeElement;
    if (changed instanceof HTMLInputElement) changed.checked = true;
    return;
  }
  commit(selected);
  renderStudyEdgeModePicker();
}

function bindStudyEdgeMenu() {
  const menu = $("#studyEdgeMenu");
  const scrim = $("#studyEdgeScrim");
  const tab = $("#studyEdgeTab");
  if (!menu || !scrim || !tab) return;

  tab.setAttribute("role", "button");
  tab.setAttribute("tabindex", "0");
  tab.setAttribute("aria-controls", "studyEdgeMenu");
  restoreEdgeAnchorY();
  updateStudyEdgeTabState();

  $("#edgePracticeBtn").onclick = () => runStudyEdgeAction(openPractice);
  $("#edgeRefreshBtn").onclick = event => {
    const button = event.currentTarget;
    closeStudyEdgeMenu();
    refreshStudyExamples(button);
  };
  const edgeModeBtn = $("#edgeModeBtn");
  const edgeModePanel = $("#edgeModePanel");
  renderStudyEdgeModePicker();
  edgeModeBtn.onclick = event => {
    event.stopPropagation();
    setStudyEdgeModeExpanded(edgeModePanel.hidden, { focus: false });
  };
  edgeModePanel.addEventListener("change", event => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    if (input.name === "edgeStudyMode") commitStudyEdgeSelection(input.name, commitStudyCardModes);
    if (input.name === "edgeStudyFront") commitStudyEdgeSelection(input.name, commitStudyCardFronts);
  });
  const desktopPracticeBtn = $("#desktopPracticeBtn");
  const desktopRefreshBtn = $("#desktopRefreshBtn");
  const desktopSwapBtn = $("#desktopSwapBtn");
  const desktopSettingsBtn = $("#desktopSettingsBtn");
  if (desktopPracticeBtn) desktopPracticeBtn.onclick = openPractice;
  if (desktopRefreshBtn) desktopRefreshBtn.onclick = event => refreshStudyExamples(event.currentTarget);
  if (desktopSwapBtn) desktopSwapBtn.onclick = swapDeckDirection;
  if (desktopSettingsBtn) desktopSettingsBtn.onclick = openStudySettings;

  const toggleFromTab = () => {
    if (edgeMenuOpen || edgeMenuAnimatingOpen) closeStudyEdgeMenu();
    else openStudyEdgeMenu(edgeAnchorY, { focus: false, persistAnchor: true });
  };

  tab.addEventListener("click", event => {
    if (consumeSyntheticEdgeClick(event)) return;
    toggleFromTab();
  });

  tab.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleFromTab();
    }
  });

  tab.addEventListener("pointerdown", event => {
    if (!isEdgeMenuAvailable() || event.pointerType === "mouse") return;
    // Касание язычка не должно одновременно запускать общий свайп-жест по
    // документу: раньше оба обработчика боролись за один и тот же pointer,
    // свайп «закрытия» подавлял клик и тап срабатывал через раз.
    event.stopPropagation();
    edgeGesture = null;
    edgeTabGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
    try { tab.setPointerCapture(event.pointerId); } catch {}
  }, { passive: true });

  tab.addEventListener("pointermove", event => {
    if (!edgeTabGesture || event.pointerId !== edgeTabGesture.pointerId) return;
    const dx = event.clientX - edgeTabGesture.startX;
    const dy = event.clientY - edgeTabGesture.startY;
    if (!edgeTabGesture.dragging && Math.hypot(dx, dy) >= EDGE_TAB_DRAG_START) {
      if (Math.abs(dx) > Math.abs(dy) * EDGE_HORIZONTAL_BIAS) return;
      edgeTabGesture.dragging = true;
      tab.classList.add("is-dragging");
    }
    if (edgeTabGesture.dragging) {
      event.preventDefault();
      setEdgeAnchorY(event.clientY);
      if (edgeMenuOpen) positionStudyEdgeMenu(edgeAnchorY);
    }
  }, { passive: false });

  const finishTabGesture = event => {
    if (!edgeTabGesture || event.pointerId !== edgeTabGesture.pointerId) return;
    if (edgeTabGesture.dragging) {
      event.preventDefault();
      guardSyntheticEdgeClick();
      setEdgeAnchorY(event.clientY, { persist: true });
      if (edgeMenuOpen) positionStudyEdgeMenu(edgeAnchorY);
    } else {
      // Тап обрабатываем сами на pointerup, а не ждём синтетический click:
      // на iOS он приходит с задержкой, иногда теряется после смещения пальца
      // или подавляется соседними обработчиками — отсюда «срабатывает не всегда».
      event.preventDefault();
      guardSyntheticEdgeClick();
      toggleFromTab();
    }
    tab.classList.remove("is-dragging");
    edgeTabGesture = null;
  };
  tab.addEventListener("pointerup", finishTabGesture, { passive: false });
  tab.addEventListener("pointercancel", event => {
    if (edgeTabGesture?.pointerId !== event.pointerId) return;
    tab.classList.remove("is-dragging");
    edgeTabGesture = null;
  }, { passive: true });

  document.addEventListener("pointerdown", event => {
    if (document.body.getAttribute("data-view") !== "study") return;
    if (!isEdgeMenuAvailable() || event.pointerType === "mouse" || edgeTabGesture) return;
    // Язычок обрабатывает свой жест сам. Этот слушатель висит в capture-фазе и
    // раньше стартовал свайп прямо поверх тапа по язычку: небольшое смещение
    // пальца засчитывалось как свайп, клик подавлялся guardSyntheticEdgeClick,
    // и меню открывалось через раз.
    if (event.target instanceof Node && tab.contains(event.target)) return;
    const menuExpanded = edgeMenuOpen || edgeMenuAnimatingOpen;
    if (!menuExpanded && event.clientX < window.innerWidth * EDGE_OPEN_START_RATIO) return;
    edgeGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      mode: menuExpanded ? "close" : "open",
      tracking: true,
      dragging: false,
      completed: false,
      pointerTarget: event.target,
      captureTarget: null
    };
  }, { passive: true, capture: true });

  document.addEventListener("pointermove", event => {
    if (!edgeGesture || event.pointerId !== edgeGesture.pointerId || !edgeGesture.tracking) return;
    const signedDx = edgeGesture.mode === "open"
      ? edgeGesture.startX - event.clientX
      : event.clientX - edgeGesture.startX;
    const dx = Math.abs(event.clientX - edgeGesture.startX);
    const dy = Math.abs(event.clientY - edgeGesture.startY);
    if (!edgeGesture.dragging && dy >= EDGE_TAB_DRAG_THRESHOLD && dy > dx * EDGE_HORIZONTAL_BIAS) {
      edgeGesture.tracking = false;
      const gesture = edgeGesture;
      clearEdgeGesture(gesture);
      return;
    }
    if (!edgeGesture.dragging && signedDx >= EDGE_TAB_DRAG_THRESHOLD && signedDx > dy * EDGE_HORIZONTAL_BIAS) {
      edgeGesture.dragging = true;
      setEdgeGestureSwiping(true);
      captureEdgeGesturePointer(edgeGesture);
      if ($("#studyEdgeMenu")?.contains(document.activeElement)) document.activeElement.blur();
    }
    if (edgeGesture.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (signedDx >= EDGE_OPEN_DISTANCE && signedDx > dy * EDGE_HORIZONTAL_BIAS) {
      edgeGesture.completed = true;
      if (edgeGesture.mode === "open") {
        // Якорь двигаем только при открытии: свайп закрытия не должен
        // переставлять язычок туда, где палец случайно начал жест.
        setEdgeAnchorY(edgeGesture.startY, { persist: true });
        openStudyEdgeMenu(edgeAnchorY, { persistAnchor: false });
      } else {
        closeStudyEdgeMenu();
      }
      edgeGesture.tracking = false;
    }
  }, { passive: false, capture: true });

  const finishEdgeGesture = event => {
    if (!edgeGesture || event.pointerId !== edgeGesture.pointerId) return;
    const gesture = edgeGesture;
    if (gesture.completed) {
      event.preventDefault();
      event.stopPropagation();
      guardSyntheticEdgeClick();
    }
    clearEdgeGesture(gesture);
  };
  document.addEventListener("pointerup", finishEdgeGesture, { passive: false, capture: true });
  document.addEventListener("pointercancel", event => {
    if (edgeGesture?.pointerId !== event.pointerId) return;
    clearEdgeGesture(edgeGesture);
  }, { passive: true, capture: true });

  scrim.addEventListener("pointerup", event => {
    if (event.pointerType !== "mouse") closeStudyEdgeMenu();
  }, { passive: true });

  scrim.addEventListener("click", event => {
    if (consumeSyntheticEdgeClick(event)) return;
    closeStudyEdgeMenu();
  });

  menu.addEventListener("click", event => {
    consumeSyntheticEdgeClick(event);
  }, true);

  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll('button:not(:disabled), input[type="checkbox"]:not(:disabled)')].filter(item => !item.closest("[hidden]"));
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeStudyEdgeMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    }
  });

  window.addEventListener("resize", () => {
    setEdgeAnchorY(edgeAnchorY);
    updateEdgeMenuAvailability();
    if (edgeMenuOpen) positionStudyEdgeMenu(edgeAnchorY);
  }, { passive: true });
  updateEdgeMenuAvailability();
}
