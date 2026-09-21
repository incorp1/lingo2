/* Lingo Cards — Decks, card browser, bulk operations and bulk add */

let deckActionMenuTrigger = null;
let deckActionMenuDeckId = null;

function closeDeckActionMenu({ restoreFocus = false } = {}) {
  const menu = $("#deckActionMenu");
  if (!menu) return;
  const trigger = deckActionMenuTrigger;
  if (!menu.hidden) {
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.style.removeProperty("left");
    menu.style.removeProperty("top");
  }
  trigger?.setAttribute("aria-expanded", "false");
  deckActionMenuTrigger = null;
  deckActionMenuDeckId = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function deckActionMenuHtml() {
  const actions = [
    ["add", "decks.menu.addCard", '<path d="M12 5v14M5 12h14"/>'],
    ["examples", "decks.menu.refreshExamples", '<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 9a8 8 0 0 0-13.7-3L4 10"/><path d="M4 15a8 8 0 0 0 13.7 3L20 14"/>'],
    ["rename", "decks.rename", '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'],
    ["export", "decks.export", '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'],
    ["delete", "decks.delete", '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'],
  ];
  return actions.map(([action, key, icon]) => `
    <button type="button" role="menuitem" data-deck-menu-action="${action}" class="deck-menu-action${action === "delete" ? " danger" : ""}">
      <span class="deck-menu-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${icon}</svg></span>
      <span>${escape(t(key))}</span>
    </button>`).join("");
}

function openDeckActionMenu(trigger, deckId) {
  const menu = $("#deckActionMenu");
  if (!menu) return;
  if (!menu.hidden && deckActionMenuTrigger === trigger) {
    closeDeckActionMenu({ restoreFocus: true });
    return;
  }
  closeDeckActionMenu();
  closeAddCardMenu();
  deckActionMenuTrigger = trigger;
  deckActionMenuDeckId = deckId;
  trigger.setAttribute("aria-expanded", "true");
  menu.innerHTML = deckActionMenuHtml();
  menu.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";

  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(margin, rect.right - menuRect.width),
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

function exportDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;
  const cards = getDeckCards(deckId).map(({
    type, front, back, example, exampleSentence, exampleTranslation,
    exampleTargetTerm, hint, cloze,
  }) => ({
    type, front, back, example, exampleSentence, exampleTranslation,
    exampleTargetTerm, hint, cloze,
  }));
  const text = JSON.stringify([{
    name: deck.name,
    desc: deck.desc || "",
    direction: deck.direction === "reverse" ? "reverse" : "forward",
    cards,
  }], null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = String(deck.name || "deck").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "deck";
  link.href = url;
  link.download = `lingo-${slug}-${todayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast(t("decks.exported", { name: deck.name }));
}

async function restoreDeletedDeck(snapshot) {
  if (!snapshot?.deck || getDeckById(snapshot.deck.id)) return;
  const ok = await mutateAndFlush(() => {
    const index = Math.min(snapshot.index, state.decks.length);
    state.decks.splice(index, 0, structuredClone(snapshot.deck));
    const restoredDeck = state.decks[index];
    deckById.set(restoredDeck.id, restoredDeck);
    cardsByDeck.set(restoredDeck.id, []);
    markDeckDirty(restoredDeck);
    for (const savedCard of snapshot.cards) {
      const card = structuredClone(savedCard);
      state.cards.push(card);
      cardById.set(card.id, card);
      cardsByDeck.get(restoredDeck.id).push(card);
      markCardDirty(card);
    }
    restoreReviewEvents(snapshot.reviewEvents);
    for (const card of cardsByDeck.get(restoredDeck.id)) {
      const linkedCard = card.linkedCardId ? cardById.get(card.linkedCardId) : null;
      if (card.linkedCardId && (!linkedCard || linkedCard.deckId !== restoredDeck.id)) {
        card.linkedCardId = null;
        markCardDirty(card);
      }
    }
    state.activeDeckId = snapshot.activeDeckId && getDeckById(snapshot.activeDeckId)
      ? snapshot.activeDeckId
      : restoredDeck.id;
    markMetaDirty();
  });
  if (ok) {
    renderDeckSelector();
    renderDecks();
    toast(t("decks.restored", { name: snapshot.deck.name }));
  }
}

async function deleteDeckWithUndo(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;
  const cards = getDeckCards(deckId);
  const confirmed = await confirmDialog({
    title: t("confirm.deleteDeck.title", { name: deck.name }),
    message: t("confirm.deleteDeck.message", { count: cards.length }),
    detail: t("confirm.undoAvailable"),
    confirmLabel: t("confirm.deleteDeck.action"),
    danger: true,
  });
  if (!confirmed) return;
  const reviewEvents = await window.LCStorage.getReviewEventsForCards?.(cards.map(card => card.id)) || [];
  const snapshot = {
    deck: structuredClone(deck),
    cards: structuredClone(getDeckCards(deckId)),
    reviewEvents,
    index: state.decks.findIndex(item => item.id === deckId),
    activeDeckId: state.activeDeckId,
  };
  const ok = await mutateAndFlush(() => {
    removeDeck(deckId);
    if (state.activeDeckId === deckId) {
      state.activeDeckId = firstDeckIdForLanguage() || null;
      markMetaDirty();
    }
  });
  if (!ok) return;
  renderDeckSelector();
  renderDecks();
  toast(t("decks.deleted", { name: deck.name }), {
    duration: 8000,
    actionLabel: t("topbar.undo"),
    action: () => restoreDeletedDeck(snapshot),
  });
}

function bindDeckActionMenu() {
  const menu = $("#deckActionMenu");
  if (!menu || menu.dataset.bound === "true") return;
  menu.dataset.bound = "true";
  menu.onclick = event => {
    const item = event.target.closest("[data-deck-menu-action]");
    if (!item || !deckActionMenuDeckId) return;
    event.stopPropagation();
    const action = item.dataset.deckMenuAction;
    const deckId = deckActionMenuDeckId;
    closeDeckActionMenu();
    if (action === "add") openCardEditor(null, deckId);
    else if (action === "examples") refreshDeckExamples(deckId, null);
    else if (action === "rename") openDeckEditor(deckId);
    else if (action === "export") exportDeck(deckId);
    else if (action === "delete") deleteDeckWithUndo(deckId);
  };
  menu.onkeydown = event => {
    const items = [...menu.querySelectorAll("[role='menuitem']")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeDeckActionMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    }
  };
  document.addEventListener("click", event => {
    if (!menu.hidden && !menu.contains(event.target) && !event.target.closest(".deck-menu-trigger")) closeDeckActionMenu();
  });
  window.addEventListener("resize", closeDeckActionMenu);
  window.addEventListener("scroll", closeDeckActionMenu, true);
}

/* ----- Decks view ----- */
function collectDeckAggregates(now = Date.now()) {
  const decks = activeDecks();
  const aggregates = new Map(decks.map(deck => [deck.id, {
    total: 0,
    new: 0,
    learning: 0,
    review: 0,
    nextDue: null,
  }]));
  for (const card of activeCards()) {
    let aggregate = aggregates.get(card.deckId);
    if (!aggregate) {
      aggregate = { total: 0, new: 0, learning: 0, review: 0, nextDue: null };
      aggregates.set(card.deckId, aggregate);
    }
    aggregate.total += 1;
    if (card.state === "new") {
      aggregate.new += 1;
    } else if (card.state !== "suspended") {
      if (card.due <= now) {
        if (card.state === "learning") aggregate.learning += 1;
        else if (card.state === "review") aggregate.review += 1;
      } else if (aggregate.nextDue === null || card.due < aggregate.nextDue) {
        aggregate.nextDue = card.due;
      }
    }
  }
  return aggregates;
}

function createDeckRow() {
  const row = document.createElement("div");
  row.className = "deck-row";
  row.innerHTML = `
    <div class="deck-info clickable"><div class="deck-title"></div><div class="deck-desc"></div><div class="deck-status"></div></div>
    <div class="deck-counts-wrap">
      <div class="deck-count new"><b></b><span></span></div>
      <div class="deck-count learn"><b></b><span></span></div>
      <div class="deck-count review"><b></b><span></span></div>
    </div>
    <div class="deck-actions">
      <button class="btn small primary deck-study-btn" type="button" data-action="study"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4l14 8-14 8z"/></svg><span class="deck-study-label"></span></button>
      <button class="icon-btn deck-icon-btn deck-menu-trigger" type="button" data-action="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="deckActionMenu"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>
    </div>`;
  return row;
}

function patchDeckRow(row, d, s, shownNew, statusText, statusClass) {
  row.dataset.deckId = d.id;
  const info = row.querySelector(".deck-info");
  info.title = t("decks.openHint");
  row.querySelector(".deck-title").textContent = d.name;
  row.querySelector(".deck-desc").textContent = d.desc || "";
  const status = row.querySelector(".deck-status");
  status.className = `deck-status ${statusClass}`;
  status.textContent = statusText;
  const counts = row.querySelectorAll(".deck-count");
  [[shownNew, "decks.cards.new"], [s.learning, "decks.cards.learn"], [s.review, "decks.cards.due"]].forEach(([value, key], index) => {
    counts[index].querySelector("b").textContent = value;
    counts[index].querySelector("span").textContent = t(key);
  });
  row.querySelector(".deck-study-label").textContent = t("decks.study");
  const labels = { study: "decks.study", menu: "decks.moreActions" };
  for (const [action, key] of Object.entries(labels)) {
    const button = row.querySelector(`[data-action="${action}"]`);
    button.title = t(key);
    button.setAttribute("aria-label", t(key));
  }
  info.onclick = () => openDeckBrowse(d.id);
  row.querySelector('[data-action="study"]').onclick = () => {
    state.activeDeckId = d.id;
    markMetaDirty();
    save();
    $("#deckSelect").value = d.id;
    switchView("study");
    startSession(d.id);
  };
  row.querySelector('[data-action="menu"]').onclick = event => {
    event.stopPropagation();
    openDeckActionMenu(event.currentTarget, d.id);
  };
}

function renderDecks() {
  const overview = $("#decksOverview");
  const browser = $("#deckBrowse");
  if (overview) overview.hidden = !!viewingDeckId;
  if (browser) browser.hidden = !viewingDeckId;
  if (viewingDeckId) {
    const deck = getDeckById(viewingDeckId);
    if (!deck) {
      viewingDeckId = null;
      if (overview) overview.hidden = false;
      if (browser) browser.hidden = true;
    } else {
      $("#deckBrowseTitle").textContent = deck.name;
      $("#filterDeck").value = deck.id;
      const subtitle = $("#deckBrowseSubtitle");
      if (subtitle) subtitle.textContent = t("browse.results", { n: getDeckCards(deck.id).length });
      renderBrowse();
      syncExampleRefreshBar();
      return;
    }
  }

  const list = $("#deckList");
  const visibleDecks = activeDecks();
  if (visibleDecks.length === 0) {
    if (list.dataset.mode !== "empty") {
      list.innerHTML = `<div class="empty-state empty-state-padded"><div class="emoji">📚</div><h2>${escape(t("decks.empty.title"))}</h2><p>${escape(t("decks.empty.desc"))}</p></div>`;
      list.dataset.mode = "empty";
    }
    return;
  }
  if (list.dataset.mode === "empty") list.replaceChildren();
  list.dataset.mode = "rows";
  const existing = new Map(Array.from(list.querySelectorAll(".deck-row")).map(row => [row.dataset.deckId, row]));
  const fragment = document.createDocumentFragment();
  const aggregates = collectDeckAggregates();
  for (const d of visibleDecks) {
    const s = aggregates.get(d.id) || { total: 0, new: 0, learning: 0, review: 0, nextDue: null };
    const shownNew = s.new;
    const dueNow = shownNew + s.learning + s.review;
    let statusText, statusClass = "";
    if (s.total === 0) {
      statusText = "📦 " + t("decks.status.empty");
      statusClass = "empty";
    } else if (dueNow > 0) {
      statusText = `📦 ${t("decks.total", { n: s.total })} · ${t("decks.status.due", { n: dueNow })}`;
    } else {
      const nd = s.nextDue;
      if (nd) {
        statusText = `✓ ${t("decks.status.done")} · ${friendlyWhen(nd)}`;
        statusClass = "done";
      } else {
        statusText = `✓ ${t("decks.status.doneNoNext")}`;
        statusClass = "done";
      }
    }
    let row = existing.get(d.id);
    if (!row) row = createDeckRow();
    existing.delete(d.id);
    patchDeckRow(row, d, s, shownNew, statusText, statusClass);
    fragment.appendChild(row);
  }
  for (const row of existing.values()) row.remove();
  list.appendChild(fragment);
  syncExampleRefreshBar();
}

/* ----- Deck browser (former Browse view, scoped to one deck) ----- */
let bulkSelected = new Set();
let _browseFiltered = [];
let _browseScrollBound = false;
let _browseResizeFrame = 0;
let _browseSearchTimer = 0;

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
const BROWSE_LONG_PRESS_MS = 460;
const BROWSE_LONG_PRESS_MOVE_PX = 10;
let browseLongPress = null;
let browseLongPressConsumed = false;

function browseDueText(card) {
  if (card.state === "suspended") return t("study.state.suspended");
  if (card.state === "new") return t("common.now");
  return formatDue(card.due);
}

function syncBrowseSelectionControls() {
  const visibleIds = _browseFiltered.map(card => card.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => bulkSelected.has(id));
  const someSelected = visibleIds.some(id => bulkSelected.has(id));
  const selectAll = $("#selectAllCb");
  if (selectAll) {
    selectAll.checked = allSelected;
    selectAll.indeterminate = !allSelected && someSelected;
  }
}

function toggleBrowseCardSelection(cardId, forceSelected) {
  const selected = forceSelected === undefined ? !bulkSelected.has(cardId) : forceSelected;
  if (selected) bulkSelected.add(cardId);
  else bulkSelected.delete(cardId);
  refreshBulkBar();
  syncBrowseSelectionControls();
  drawVisibleBrowseRows();
}

function cancelBrowseLongPress() {
  if (!browseLongPress) return;
  clearTimeout(browseLongPress.timer);
  browseLongPress = null;
}

function beginBrowseLongPress(event, cardId) {
  if (event.pointerType === "mouse" || event.target.closest("button, input, select, a")) return;
  cancelBrowseLongPress();
  browseLongPressConsumed = false;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const row = event.currentTarget;
  const timer = setTimeout(() => {
    browseLongPress = null;
    browseLongPressConsumed = true;
    toggleBrowseCardSelection(cardId, true);
    row.classList.add("long-press-confirmed");
    setTimeout(() => row.classList.remove("long-press-confirmed"), 180);
    if (navigator.vibrate) navigator.vibrate(18);
  }, BROWSE_LONG_PRESS_MS);
  browseLongPress = { timer, startX, startY, pointerId };
}

function moveBrowseLongPress(event) {
  if (!browseLongPress || event.pointerId !== browseLongPress.pointerId) return;
  if (Math.hypot(event.clientX - browseLongPress.startX, event.clientY - browseLongPress.startY) > BROWSE_LONG_PRESS_MOVE_PX) {
    cancelBrowseLongPress();
  }
}

function browseSearchText(card) {
  return [card.front, card.back, card.example, card.hint, card.cloze, stripCloze(card.cloze)]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function compareBrowseCards(a, b, sort) {
  if (sort === "difficulty") {
    return difficultyScore(b) - difficultyScore(a)
      || String(a.front || stripCloze(a.cloze) || "").localeCompare(String(b.front || stripCloze(b.cloze) || ""), undefined, { sensitivity: "base", numeric: true });
  }
  if (sort === "created-desc") return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) || String(a.front || "").localeCompare(String(b.front || ""));
  if (sort === "created-asc") return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.front || "").localeCompare(String(b.front || ""));
  if (sort === "lapses") return (Number(b.lapses) || 0) - (Number(a.lapses) || 0) || (Number(a.due) || 0) - (Number(b.due) || 0);
  if (sort === "alphabetical") return String(a.front || stripCloze(a.cloze) || "").localeCompare(String(b.front || stripCloze(b.cloze) || ""), undefined, { sensitivity: "base", numeric: true });
  const aDue = a.state === "new" ? Number.POSITIVE_INFINITY : (Number(a.due) || Number.POSITIVE_INFINITY);
  const bDue = b.state === "new" ? Number.POSITIVE_INFINITY : (Number(b.due) || Number.POSITIVE_INFINITY);
  return aDue - bDue || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
}

function filterBrowseCards() {
  const deck = viewingDeckId || $("#filterDeck").value;
  const stateF = $("#filterState").value;
  const query = String($("#browseSearch")?.value || "").trim().toLocaleLowerCase();
  const sort = $("#browseSort")?.value || "due";
  return activeCards().filter(c => {
    if (deck && c.deckId !== deck) return false;
    if (stateF && c.state !== stateF) return false;
    if (query && !browseSearchText(c).includes(query)) return false;
    return true;
  }).sort((a, b) => compareBrowseCards(a, b, sort));
}

function updateBrowseControls() {
  const search = $("#browseSearch");
  const clear = $("#browseSearchClear");
  const stateFilter = $("#filterState")?.value || "";
  const sort = $("#browseSort")?.value || "due";
  const advancedCount = Number(Boolean(stateFilter)) + Number(sort !== "due");
  const badge = $("#browseFilterBadge");
  const count = $("#browseResultCount");
  if (clear) clear.hidden = !search?.value;
  if (badge) {
    badge.hidden = advancedCount === 0;
    badge.textContent = String(advancedCount);
  }
  if (count) count.textContent = t("browse.results", { n: _browseFiltered.length });
}

function resetBrowseControls() {
  if ($("#browseSearch")) $("#browseSearch").value = "";
  if ($("#filterState")) $("#filterState").value = "";
  if ($("#browseSort")) $("#browseSort").value = "due";
  renderBrowse({ preserveScroll: false });
}

function captureBrowseAnchor() {
  const body = $("#tableBody");
  if (!body || !_browseFiltered.length) return null;
  const index = Math.max(0, Math.min(_browseFiltered.length - 1, Math.floor(body.scrollTop / ROW_HEIGHT)));
  return {
    cardId: _browseFiltered[index]?.id || null,
    index,
    offset: body.scrollTop - index * ROW_HEIGHT,
  };
}

function restoreBrowseAnchor(anchor) {
  const body = $("#tableBody");
  if (!body || !anchor || !_browseFiltered.length) return;
  const matched = anchor.cardId ? _browseFiltered.findIndex(card => card.id === anchor.cardId) : -1;
  const index = matched >= 0 ? matched : Math.min(anchor.index, _browseFiltered.length - 1);
  body.scrollTop = Math.max(0, index * ROW_HEIGHT + anchor.offset);
}

function ensureBrowseCanvas(body) {
  let canvas = body.querySelector(".browse-virtual-canvas");
  if (!canvas) {
    body.replaceChildren();
    canvas = document.createElement("div");
    canvas.className = "browse-virtual-canvas";
    body.appendChild(canvas);
  }
  return canvas;
}

function renderBrowse({ preserveScroll = true } = {}) {
  const body = $("#tableBody");
  const anchor = preserveScroll ? captureBrowseAnchor() : null;
  _browseFiltered = filterBrowseCards();
  updateBrowseControls();

  const selCb = $("#selectAllCb");
  const visibleIds = _browseFiltered.map(c => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => bulkSelected.has(id));
  const someSelected = visibleIds.some(id => bulkSelected.has(id));
  if (selCb) {
    selCb.checked = allSelected;
    selCb.indeterminate = !allSelected && someSelected;
  }

  if (_browseFiltered.length === 0) {
    body.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "browse-empty";
    empty.textContent = t("browse.empty");
    body.appendChild(empty);
    body.scrollTop = 0;
    refreshBulkBar();
    return;
  }

  const canvas = ensureBrowseCanvas(body);
  canvas.style.height = (_browseFiltered.length * ROW_HEIGHT) + "px";
  if (anchor) restoreBrowseAnchor(anchor);
  else if (!preserveScroll) body.scrollTop = 0;
  drawVisibleBrowseRows();

  if (!_browseScrollBound) {
    body.addEventListener("scroll", () => {
      cancelBrowseLongPress();
      drawVisibleBrowseRows();
    }, { passive: true });
    window.addEventListener("resize", handleBrowseViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleBrowseViewportChange, { passive: true });
    _browseScrollBound = true;
  }

  syncBrowseSelectionControls();
  refreshBulkBar();
}

function handleBrowseViewportChange() {
  const anchor = captureBrowseAnchor();
  if (_browseResizeFrame) cancelAnimationFrame(_browseResizeFrame);
  _browseResizeFrame = requestAnimationFrame(() => {
    _browseResizeFrame = 0;
    restoreBrowseAnchor(anchor);
    drawVisibleBrowseRows();
  });
}

function createBrowseRow() {
  const row = document.createElement("div");
  row.className = "table-row";
  row.setAttribute("role", "row");
  row.style.height = ROW_HEIGHT + "px";
  row.innerHTML = `
    <div class="cb-cell"><input type="checkbox" /></div>
    <div class="cell browse-front"><span class="browse-front-word"></span></div>
    <div class="cell browse-back"></div>
    <div class="cell browse-deck"></div>
    <div class="cell browse-state"><span class="state-pill"></span></div>
    <div class="cell browse-due"></div>
    <div class="cell actions"></div>`;
  const actions = row.querySelector(".actions");
  const makeAction = action => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn";
    button.dataset.action = action;
    actions.appendChild(button);
  };
  makeAction("edit");
  makeAction("suspend");
  makeAction("delete");
  return row;
}

function patchBrowseRow(row, card, index) {
  const deck = getDeckById(card.deckId);
  const stateName = ["new", "learning", "review", "suspended"].includes(card.state) ? card.state : "new";
  row.dataset.cardId = card.id;
  row.dataset.state = stateName;
  row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
  row.setAttribute("aria-rowindex", String(index + 2));
  const visual = difficultyStyle(card);
  row.style.setProperty("--difficulty-bg", visual.background);
  row.style.setProperty("--difficulty-border", visual.border);
  row.style.setProperty("--difficulty-fg", visual.foreground);
  row.classList.toggle("is-selected", bulkSelected.has(card.id));
  row.setAttribute("aria-selected", String(bulkSelected.has(card.id)));

  const frontWord = row.querySelector(".browse-front-word");
  frontWord.style.setProperty("--difficulty-bg", `color-mix(in srgb, ${visual.background} 82%, ${visual.border} 18%)`);
  frontWord.style.setProperty("--difficulty-border", visual.border);
  frontWord.style.setProperty("--difficulty-fg", visual.foreground);
  frontWord.dataset.difficultyScore = String(visual.score);

  const checkbox = row.querySelector('input[type="checkbox"]');
  checkbox.dataset.bulk = card.id;
  checkbox.checked = bulkSelected.has(card.id);
  checkbox.setAttribute("aria-label", card.front || stripCloze(card.cloze) || t("browse.table.front"));
  frontWord.textContent = card.front || stripCloze(card.cloze);
  row.querySelector(".browse-back").textContent = "";
  row.querySelector(".browse-deck").textContent = deck ? deck.name : "—";
  const statePill = row.querySelector(".state-pill");
  statePill.className = `state-pill ${stateName}`;
  statePill.textContent = browseDueText(card);
  row.querySelector(".browse-due").textContent = browseDueText(card);

  const edit = row.querySelector('[data-action="edit"]');
  const suspend = row.querySelector('[data-action="suspend"]');
  const remove = row.querySelector('[data-action="delete"]');
  const setAction = (button, label, text) => {
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = text;
  };
  setAction(edit, t("browse.edit"), "✎");
  setAction(suspend, card.state === "suspended" ? t("browse.unsuspend") : t("browse.suspend"), "⏸");
  setAction(remove, t("browse.delete"), "×");

  edit.onclick = () => openCardEditor(card.id);
  suspend.onclick = () => {
    if (card.state === "suspended") unsuspendCard(card);
    else suspendCard(card);
    save();
    patchBrowseCard(card.id);
  };
  remove.onclick = async () => {
    const confirmed = await confirmDialog({
      title: t("confirm.deleteCard.title"),
      message: t("confirm.deleteCard.message"),
      confirmLabel: t("confirm.deleteCard.action"),
      danger: true,
    });
    if (!confirmed) return;
    const ok = await mutateAndFlush(() => removeCard(card.id));
    if (!ok) return;
    bulkSelected.delete(card.id);
    renderBrowse();
  };
  checkbox.onchange = event => {
    toggleBrowseCardSelection(card.id, event.target.checked);
  };
  row.onpointerdown = event => beginBrowseLongPress(event, card.id);
  row.onpointermove = moveBrowseLongPress;
  row.onpointerup = cancelBrowseLongPress;
  row.onpointercancel = cancelBrowseLongPress;
  row.oncontextmenu = event => {
    if (browseLongPressConsumed || bulkSelected.size) event.preventDefault();
  };
  row.onclick = event => {
    if (event.target.closest("button, input, select, a")) return;
    if (browseLongPressConsumed) {
      browseLongPressConsumed = false;
      event.preventDefault();
      return;
    }
    if (bulkSelected.size) {
      toggleBrowseCardSelection(card.id);
      return;
    }
    openCardEditor(card.id);
  };
  row.tabIndex = 0;
  row.setAttribute("aria-label", `${card.front || stripCloze(card.cloze) || ""}. ${browseDueText(card)}`);
  row.onkeydown = event => {
    if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button, input, select, a")) {
      event.preventDefault();
      if (bulkSelected.size || event.key === " ") toggleBrowseCardSelection(card.id);
      else openCardEditor(card.id);
    }
  };
}

function drawVisibleBrowseRows() {
  const body = $("#tableBody");
  const canvas = body?.querySelector(".browse-virtual-canvas");
  if (!body || !canvas || !_browseFiltered.length) return;
  const scrollTop = body.scrollTop;
  const viewportH = body.clientHeight || ROW_HEIGHT * 12;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  let endIdx = Math.min(_browseFiltered.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  if (endIdx <= startIdx) endIdx = Math.min(_browseFiltered.length, startIdx + 30);

  const existing = new Map(Array.from(canvas.querySelectorAll(".table-row")).map(row => [row.dataset.cardId, row]));
  const fragment = document.createDocumentFragment();
  for (let index = startIdx; index < endIdx; index++) {
    const card = _browseFiltered[index];
    let row = existing.get(card.id);
    if (!row) row = createBrowseRow();
    existing.delete(card.id);
    patchBrowseRow(row, card, index);
    fragment.appendChild(row);
  }
  for (const row of existing.values()) row.remove();
  canvas.appendChild(fragment);
}

function patchBrowseCard(cardId) {
  const body = $("#tableBody");
  const row = Array.from(body?.querySelectorAll(".table-row") || []).find(item => item.dataset.cardId === cardId);
  const index = _browseFiltered.findIndex(card => card.id === cardId);
  if (!row || index < 0) return false;
  patchBrowseRow(row, _browseFiltered[index], index);
  return true;
}

function refreshBulkBar() {
  const bar = $("#bulkBar");
  const browser = $("#deckBrowse");
  if (!bar) return;
  const n = bulkSelected.size;
  browser?.classList.toggle("selection-mode", n > 0);
  if (n === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $("#bulkCount").textContent = t("browse.selected", { n });
}

function clearBulkSelection() {
  bulkSelected.clear();
  refreshBulkBar();
  drawVisibleBrowseRows();
  const cb = $("#selectAllCb");
  if (cb) { cb.checked = false; cb.indeterminate = false; }
}

function snapshotSelectedCards() {
  return [...bulkSelected]
    .map(id => getCardById(id))
    .filter(Boolean)
    .map(card => ({ id: card.id, card: structuredClone(card) }));
}

async function undoBulkCardChanges(snapshots) {
  const ok = await mutateAndFlush(() => restoreCardSnapshots(snapshots));
  if (!ok) return;
  renderBrowse();
  renderDecks();
  renderDeckSelector();
}

async function bulkMoveTo(deckId) {
  const snapshots = snapshotSelectedCards();
  if (!snapshots.length) return;
  const moved = await mutateAndFlush(() => moveCardsToDeck(new Set(snapshots.map(snapshot => snapshot.id)), deckId));
  if (!moved) return;
  clearBulkSelection();
  renderBrowse();
  renderDecks();
  renderDeckSelector();
  toast(t("browse.bulk.moved", { count: moved }), {
    actionLabel: t("topbar.undo"),
    action: () => undoBulkCardChanges(snapshots),
  });
}

async function bulkSetSuspended(shouldSuspend) {
  const snapshots = snapshotSelectedCards();
  if (!snapshots.length) return;
  try {
    const ok = await mutateAndFlush(() => {
      for (const { id } of snapshots) {
        const c = getCardById(id);
        if (!c) continue;
        if (shouldSuspend) suspendCard(c);
        else unsuspendCard(c);
      }
    });
    if (!ok) return;
    clearBulkSelection();
    renderBrowse();
    toast(t(shouldSuspend ? "browse.bulk.suspended" : "browse.bulk.unsuspended", { count: snapshots.length }), {
      actionLabel: t("topbar.undo"),
      action: () => undoBulkCardChanges(snapshots),
    });
  } catch (error) {
    reportSaveError(error);
    toast(t("toast.saveFailed"), { error: true });
  }
}

async function bulkDelete() {
  const snapshots = snapshotSelectedCards();
  if (!snapshots.length) return;
  const selected = new Set(snapshots.map(snapshot => snapshot.id));
  const confirmed = await confirmDialog({
    title: t("confirm.deleteCards.title", { count: snapshots.length }),
    message: t("confirm.deleteCards.message", { count: snapshots.length }),
    confirmLabel: t("confirm.deleteCards.action", { count: snapshots.length }),
    danger: true,
  });
  if (!confirmed) return;
  const reviewEvents = await window.LCStorage.getReviewEventsForCards?.(selected) || [];
  try {
    const ok = await mutateAndFlush(() => {
      removeCards(selected);
    });
    if (!ok) return;
    clearBulkSelection();
    renderBrowse();
    renderDecks();
    renderDeckSelector();
    toast(t("browse.bulk.deleted", { count: snapshots.length }), {
      actionLabel: t("topbar.undo"),
      action: async () => {
        let restored = [];
        const ok = await mutateAndFlush(() => {
          restored = restoreCards(snapshots.map(snapshot => snapshot.card));
          restoreReviewEvents(reviewEvents);
        });
        if (!ok || !restored.length) return;
        renderBrowse();
        renderDecks();
        renderDeckSelector();
      },
    });
  } catch (error) {
    reportSaveError(error);
    toast(t("toast.saveFailed"), { error: true });
  }
}

/* ----- Bulk add (paste list) ----- */
function openBulkAdd(deckId) {
  const sel = $("#bulkDeck");
  sel.innerHTML = "";
  for (const d of activeDecks()) {
    const o = document.createElement("option");
    o.value = d.id; o.textContent = d.name; sel.appendChild(o);
  }
  sel.value = deckId || state.activeDeckId || firstDeckIdForLanguage() || "";
  $("#bulkType").value = "basic";
  $("#bulkFillExample").checked = false;
  $("#bulkText").value = "";
  $("#bulkPreviewText").textContent = t("bulk.previewEmpty");
  updateBulkPreview();
  openDialog($("#bulkModal"), $("#bulkText"));
}

function splitBulkWords(raw) {
  const chunks = String(raw || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap(line => line.split(/\s*[;,|]\s*/))
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(chunks)];
}

function parseBulkInput() {
  const raw = $("#bulkText").value;
  const words = splitBulkWords(raw);
  return words.map(word => ({ front: word }));
}

async function enrichBulkCard(card, options = {}) {
  const targetLang = aiTargetLangName();
  const code = (state.settings.language || window.I18N_LANG || "uk");
  const learnCode = activeLearningLanguageCode();
  const lookupOptions = { ...options, learningLanguage: learnCode, sourceLangCode: learnCode };
  const lookup = window.LCAi?.quickLookup ? await window.LCAi.quickLookup(card.front, code, lookupOptions) : null;
  const enriched = {
    front: card.front,
    back: lookup?.back || "",
    hint: lookup?.ipa || "",
    example: lookup?.example || "",
    exampleSentence: "",
    exampleTranslation: "",
    exampleTargetTerm: "",
  };

  const wantExample = $("#bulkFillExample")?.checked;
  if (!wantExample) return enriched;

  const s = state.settings;
  const aiReady = s.aiMode === "ai" && s.aiKey && window.LCAi?.generate;

  if (aiReady) {
    const ai = await window.LCAi.generate(card.front, {
      mode: "ai",
      provider: s.aiProvider,
      key: s.aiKey,
      model: s.aiModel || undefined,
      targetLang,
      targetLangCode: code,
      sourceLang: learningLangName(),
      learningLanguage: learnCode,
      ...options,
    });
    if (ai?.example) {
      enriched.example = ai.exampleTranslation
        ? `${ai.example}\n${ai.exampleTranslation}`
        : ai.example;
      enriched.exampleSentence = ai.example || "";
      enriched.exampleTranslation = ai.exampleTranslation || "";
      enriched.exampleTargetTerm = ai.exampleTargetTerm || "";
    }
    if (ai?.back && !enriched.back) enriched.back = ai.back;
    if (ai?.ipa) enriched.hint = ai.ipa;
    else if (!enriched.hint) enriched.hint = "";
    return enriched;
  }

  if (enriched.example && window.LCAi?.quickTranslate) {
    const sentence = enriched.example;
    const tr = (await window.LCAi.quickTranslate(sentence, code, lookupOptions)).trim();
    if (tr) {
      enriched.example = `${sentence}\n${tr}`;
      enriched.exampleSentence = sentence;
      enriched.exampleTranslation = tr;
    }
  }

  return enriched;
}

function updateBulkPreview() {
  const cards = parseBulkInput();
  const txt = $("#bulkPreviewText");
  const btn = $("#bulkAddBtn span") || $("#bulkAddBtn");
  if (cards.length === 0) {
    txt.textContent = t("bulk.previewEmpty");
    btn.textContent = t("bulk.add", { n: 0 });
    $("#bulkAddBtn").disabled = true;
    $("#bulkAddBtn").style.opacity = "0.5";
  } else {
    const preview = cards.slice(0, 3).map(c => c.front).join(" · ");
    txt.textContent = t("bulk.preview", { n: cards.length }) + (cards.length > 3 ? "  ·  " + preview + "…" : "  ·  " + preview);
    btn.textContent = t("bulk.add", { n: cards.length });
    $("#bulkAddBtn").disabled = false;
    $("#bulkAddBtn").style.opacity = "1";
  }
}

const BULK_MUTATION_BUTTONS = ["#bulkMoveBtn", "#bulkSuspendBtn", "#bulkUnsuspendBtn", "#bulkDeleteBtn"];
let bulkMutationRunning = false;

async function runBulkMutation(operation) {
  if (bulkMutationRunning) return false;
  bulkMutationRunning = true;
  const buttons = BULK_MUTATION_BUTTONS.map(selector => $(selector)).filter(Boolean);
  buttons.forEach(button => { button.disabled = true; });
  try {
    await operation();
    return true;
  } finally {
    bulkMutationRunning = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function commitBulkAdd() {
  if (!await prepareAiJob("bulk-add")) return;
  const cards = parseBulkInput();
  if (cards.length === 0) { toast(t("bulk.empty.toast"), { error: true }); return; }
  const deckId = $("#bulkDeck").value;
  const type = $("#bulkType").value;
  const uniqueCards = [];
  const duplicates = [];
  const seenFronts = new Set();
  for (const card of cards) {
    const normalized = normalizeCardFront(card.front);
    const existing = findDuplicateCard(deckId, card.front);
    if (existing) {
      duplicates.push(existing);
      continue;
    }
    if (!normalized) continue;
    if (seenFronts.has(normalized)) {
      const first = uniqueCards.find(item => normalizeCardFront(item.front) === normalized);
      duplicates.push({ ...first, deckId });
      continue;
    }
    seenFronts.add(normalized);
    uniqueCards.push(card);
  }
  if (!uniqueCards.length) {
    closeDialog($("#bulkModal"));
    showDuplicateDialog(duplicates);
    return;
  }

  const contextId = `bulk-add:${deckId}`;
  // Bulk enrichment is long-running: pin it to the language generation that
  // started it, otherwise a switch mid-flight would write foreign cards.
  const bulkLearnCode = activeLearningLanguageCode();
  const bulkLearnGeneration = currentLanguageGeneration();
  const job = await startAiJob("bulk-add", contextId);
  if (!job) return;
  const btn = $("#bulkAddBtn");
  const preview = $("#bulkPreviewText");
  const originalLabel = btn.textContent;
  btn.setAttribute("aria-busy", "true");
  btn.classList.add("loading");
  preview.textContent = t("bulk.enriching", { n: 0, total: uniqueCards.length });

  const enriched = new Array(uniqueCards.length);
  const aiBusy = $("#bulkFillExample")?.checked && state.settings.aiMode === "ai" && state.settings.aiKey;
  const concurrency = aiBusy ? 2 : 4;
  let completed = 0;
  let added = 0;
  let stateSnapshot = null;
  let stateMutated = false;
  try {
    const pool = await runAbortableWorkerPool(
      uniqueCards.length,
      concurrency,
      (index, signal) => enrichBulkCard(uniqueCards[index], {
        signal,
        timeoutMs: AI_TIMEOUT_MS,
      }),
      {
        controller: job.controller,
        onSettled: count => {
          completed = count;
          if (ownsAiJob(job)) preview.textContent = t("bulk.enriching", { n: completed, total: uniqueCards.length });
        },
      }
    );
    for (let index = 0; index < pool.results.length; index++) enriched[index] = pool.results[index];
    if (!isCurrentAiJob(job) || $("#bulkModal").hidden || $("#bulkDeck").value !== deckId) {
      throw new DOMException("stale", "AbortError");
    }
    // The learning language must still be the one this batch was enriched for.
    if (activeLearningLanguageCode() !== bulkLearnCode
      || !isLanguageGenerationCurrent(bulkLearnGeneration)) {
      throw new DOMException("stale language", "AbortError");
    }

    stateSnapshot = structuredClone(state);
    stateMutated = true;
    for (const c of enriched) {
      if (!c) continue;
      createCard({ deckId, type: "basic", front: c.front, back: c.back || "", hint: c.hint || "", example: c.example || "" });
      added++;
      if (type === "reverse" && c.front && c.back) {
        createCard({ deckId, type: "basic", front: c.back, back: c.front, hint: c.hint || "", example: c.example || "" });
        added++;
      }
    }
    await saveAndFlush();
    stateMutated = false;
    closeDialog($("#bulkModal"));
    if (duplicates.length) showDuplicateDialog(duplicates);
    else toast(t("bulk.added.toast", { n: added }));
    renderBrowse(); renderDecks(); renderDeckSelector(); renderStudy();
  } catch (error) {
    if (stateMutated && stateSnapshot) {
      window.LCStorage.discardAppState?.();
      state = stateSnapshot;
      rebuildEntityIndexes();
      resetDirtyState();
      added = 0;
    }
    if (!isAbortError(error)) {
      reportSaveError(error);
      toast(t("toast.saveFailed"), { error: true });
    }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      btn.classList.remove("loading");
      btn.removeAttribute("aria-busy");
      btn.textContent = originalLabel;
    }
  }
}