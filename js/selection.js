/* Lingo Cards — Selection lookup, quick translation and compact selects */

const LOOKUP_SELECTOR = ".card-front, .card-back, .card-example, .practice-story-body, .practice-q-label, .word-info-content";
const SELECTION_HOLD_MS = 430;
const SELECTION_MOVE_TOLERANCE = 10;
/* The popover translation is a single word or short phrase, so it must answer
   quickly or report a failure instead of keeping the spinner for the long
   card-generation timeout. */
const SELECTION_TRANSLATE_TIMEOUT_MS = 12000;
const SELECTION_WORD_CHARS = /[A-Za-zÀ-ÖØ-öø-ÿ'’\-]/;
const SELECTION_WORD_SCAN = /[A-Za-zÀ-ÖØ-öø-ÿ'’\-]+/g;
/* A word is "letter bearing" when it contains at least one Latin letter.
   The old /[A-Za-z]/ probes rejected purely Norwegian words such as "å",
   "øy" or "ål", so long-press lookup silently did nothing for them. */
const SELECTION_HAS_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
const SELECTION_HIT_PADDING = 8;
const SELECTION_HIT_MAX_DX = 220;
const SELECTION_TOUCH_ID = "touch";

let selectionData = { word: "", context: "", translation: "", identity: 0 };
let selectionPopoverInteracting = false;
let selectionHoldEndedAt = 0;
let selectionTranslateRequestId = 0;
let selectionTranslateController = null;
let selectionIdentity = 0;
let lookupSelection = null;
let selectionGesture = null;
let selectionHoldTimer = 0;
let selectionHighlightLayer = null;
let wordGeometry = null;

function replaceSelectionData(word, context) {
  if (selectionData.identity) cancelAiJobsForContext(`selection:${selectionData.identity}`);
  selectionTranslateController?.abort(new DOMException("selection changed", "AbortError"));
  selectionTranslateRequestId++;
  selectionData = {
    word,
    context,
    translation: "",
    identity: ++selectionIdentity,
  };
  return selectionData.identity;
}

function lookupZoneAt(target) {
  return target?.closest?.(LOOKUP_SELECTOR) || null;
}

function selectionIsInsideLookupZone(sel) {
  if (!sel || sel.rangeCount === 0) return null;
  const node = sel.anchorNode;
  if (!node) return null;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return lookupZoneAt(el);
}

function caretRangeAtPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (!document.caretPositionFromPoint) return null;
  const pos = document.caretPositionFromPoint(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

/* ------------------------------------------------------------------------
   Word geometry index

   WebKit (iOS Safari, including the last build available for iPhone 7)
   refuses to resolve a caret position inside text painted with
   `-webkit-user-select: none`, so `caretRangeFromPoint` returns either null
   or a non-text node and the long press never finds a word. To stay
   independent from that behaviour every word of the touched lookup zone is
   measured once and the touch point is matched against those rectangles.
   The index is cached per zone and invalidated as soon as the zone text or
   its position on screen changes, so dragging stays cheap on old hardware.
   ------------------------------------------------------------------------ */

function zoneGeometrySignature(zone) {
  const rect = zone.getBoundingClientRect();
  return [
    (zone.textContent || "").length,
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join("|");
}

function buildWordGeometry(zone) {
  const words = [];
  const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent || "";
    if (text.trim()) {
      SELECTION_WORD_SCAN.lastIndex = 0;
      let match = SELECTION_WORD_SCAN.exec(text);
      while (match) {
        if (SELECTION_HAS_LETTER.test(match[0])) {
          const start = match.index;
          const end = start + match[0].length;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
          if (rects.length) words.push({ node, start, end, rects });
        }
        match = SELECTION_WORD_SCAN.exec(text);
      }
    }
    node = walker.nextNode();
  }
  return { zone, signature: zoneGeometrySignature(zone), words };
}

function wordGeometryFor(zone) {
  if (!zone?.isConnected) return null;
  const signature = zoneGeometrySignature(zone);
  if (wordGeometry?.zone === zone && wordGeometry.signature === signature) return wordGeometry;
  wordGeometry = buildWordGeometry(zone);
  return wordGeometry;
}

function invalidateWordGeometry() {
  wordGeometry = null;
}

function boundaryFromWord(word, zone) {
  const range = document.createRange();
  range.setStart(word.node, word.start);
  range.setEnd(word.node, word.end);
  return { zone, node: word.node, start: word.start, end: word.end, range };
}

function wordBoundaryByGeometry(x, y, zone) {
  const geometry = wordGeometryFor(zone);
  if (!geometry?.words?.length) return null;

  let best = null;
  geometry.words.forEach(word => {
    word.rects.forEach(rect => {
      const dx = x < rect.left ? rect.left - x : (x > rect.right ? x - rect.right : 0);
      const dy = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
      if (dx > SELECTION_HIT_MAX_DX) return;
      if (dy > rect.height * 0.75 + SELECTION_HIT_PADDING) return;
      // Vertical distance dominates so a touch never jumps to a neighbour line.
      const distance = dy * 6 + dx;
      if (!best || distance < best.distance) best = { word, distance };
    });
  });

  return best ? boundaryFromWord(best.word, zone) : null;
}

function wordBoundaryByCaret(x, y, zone) {
  const caret = caretRangeAtPoint(x, y);
  if (!caret) return null;
  const node = caret.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE || !zone.contains(node)) return null;

  const text = node.textContent || "";
  const isWord = character => SELECTION_WORD_CHARS.test(character);
  let offset = Math.min(caret.startOffset, text.length);
  if (!isWord(text[offset] || "")) {
    if (offset > 0 && isWord(text[offset - 1])) offset--;
    else return null;
  }

  let start = offset;
  let end = offset;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  if (start === end || !SELECTION_HAS_LETTER.test(text.slice(start, end))) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { zone, node, start, end, range };
}

function pointInsideZone(zone, x, y, padding = 4) {
  if (!zone?.isConnected) return false;
  const rect = zone.getBoundingClientRect();
  return x >= rect.left - padding && x <= rect.right + padding
    && y >= rect.top - padding && y <= rect.bottom + padding;
}

function wordBoundaryAtPoint(x, y, expectedZone = null) {
  const hit = document.elementFromPoint(x, y);
  let zone = lookupZoneAt(hit);
  // While dragging, the finger may hover a child element or the popover edge;
  // the zone that started the gesture stays authoritative in that case.
  if (!zone && expectedZone && pointInsideZone(expectedZone, x, y)) zone = expectedZone;
  if (!zone || (expectedZone && zone !== expectedZone)) return null;

  return wordBoundaryByGeometry(x, y, zone) || wordBoundaryByCaret(x, y, zone);
}

function compareBoundaries(a, b) {
  const range = document.createRange();
  range.setStart(a.node, a.start);
  range.collapse(true);
  const other = document.createRange();
  other.setStart(b.node, b.start);
  other.collapse(true);
  return range.compareBoundaryPoints(Range.START_TO_START, other);
}

function orderedSelection(anchor, focus) {
  if (compareBoundaries(anchor, focus) <= 0) {
    return { start: anchor, end: focus };
  }
  return { start: focus, end: anchor };
}

function rangeForSelection(selection = lookupSelection) {
  if (!selection) return null;
  const range = document.createRange();
  range.setStart(selection.start.node, selection.start.start);
  range.setEnd(selection.end.node, selection.end.end);
  return range;
}

function selectedText(selection = lookupSelection) {
  return String(rangeForSelection(selection)?.toString() || "")
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ'’\-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’\-]+$/g, "")
    .trim();
}

function ensureSelectionHighlightLayer() {
  if (selectionHighlightLayer?.isConnected) return selectionHighlightLayer;
  selectionHighlightLayer = document.createElement("div");
  selectionHighlightLayer.className = "lookup-selection-layer";
  selectionHighlightLayer.setAttribute("aria-hidden", "true");
  document.body.appendChild(selectionHighlightLayer);
  return selectionHighlightLayer;
}

function renderSelectionHighlight() {
  const layer = ensureSelectionHighlightLayer();
  layer.replaceChildren();
  const range = rangeForSelection();
  if (!range) return;

  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
  rects.forEach((rect, index) => {
    const mark = document.createElement("span");
    mark.className = "lookup-selection-mark";
    if (index === 0) mark.classList.add("is-start");
    if (index === rects.length - 1) mark.classList.add("is-end");
    mark.style.left = `${rect.left - 2}px`;
    mark.style.top = `${rect.top - 1}px`;
    mark.style.width = `${rect.width + 4}px`;
    mark.style.height = `${rect.height + 2}px`;
    layer.appendChild(mark);
  });
}

function selectionBoundingRect() {
  const rects = Array.from(rangeForSelection()?.getClientRects?.() || []);
  if (!rects.length) return null;
  return rects.reduce((box, rect) => ({
    left: Math.min(box.left, rect.left),
    top: Math.min(box.top, rect.top),
    right: Math.max(box.right, rect.right),
    bottom: Math.max(box.bottom, rect.bottom),
    width: 0,
    height: 0,
  }), {
    left: rects[0].left,
    top: rects[0].top,
    right: rects[0].right,
    bottom: rects[0].bottom,
    width: 0,
    height: 0,
  });
}

function setLookupSelection(anchor, focus, zone, activeEdge = null) {
  const ordered = orderedSelection(anchor, focus);
  lookupSelection = {
    zone,
    start: ordered.start,
    end: ordered.end,
    anchor,
    focus,
    activeEdge,
  };
  renderSelectionHighlight();
}

function commitLookupSelection(showPopover = true) {
  if (!lookupSelection?.zone?.isConnected) {
    clearLookupSelection();
    return false;
  }
  const text = selectedText();
  if (!text || !SELECTION_HAS_LETTER.test(text)) {
    clearLookupSelection();
    return false;
  }

  const context = (lookupSelection.zone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (selectionData.word !== text || selectionData.context !== context) {
    replaceSelectionData(text, context);
  }
  if (showPopover) {
    const rect = selectionBoundingRect();
    if (rect) showSelectionPopover(text, rect);
  }
  return true;
}

function activateSelectionGesture(gesture, boundary) {
  if (!gesture || gesture.cancelled) return;
  gesture.active = true;
  document.body.classList.add("lookup-selecting");
  if (!gesture.viaTouch) {
    try { gesture.captureTarget?.setPointerCapture?.(gesture.pointerId); } catch {}
  }
  setLookupSelection(boundary, boundary, gesture.zone);
  commitLookupSelection(true);
  if (navigator.vibrate) navigator.vibrate(18);
}

function resetSelectionGesture() {
  clearTimeout(selectionHoldTimer);
  selectionHoldTimer = 0;
  selectionGesture = null;
  document.body.classList.remove("lookup-selecting");
}

function cancelSelectionGesture() {
  if (selectionGesture) selectionGesture.cancelled = true;
  resetSelectionGesture();
}

function clearLookupSelection(options = {}) {
  resetSelectionGesture();
  lookupSelection = null;
  invalidateWordGeometry();
  selectionHighlightLayer?.replaceChildren();
  try { window.getSelection()?.removeAllRanges(); } catch {}
  if (!options.keepPopover) hideSelectionPopover();
}

function pointTouchesBoundary(boundary, x, y) {
  if (!boundary) return false;
  const rect = boundary.range.getBoundingClientRect();
  const padding = 14;
  return x >= rect.left - padding && x <= rect.right + padding
    && y >= rect.top - padding && y <= rect.bottom + padding;
}

function beginSelectionGesture(point, zone, pointerId, captureTarget = zone, viaTouch = false) {
  const boundary = wordBoundaryAtPoint(point.x, point.y, zone);
  if (!boundary) return false;

  let edge = null;
  if (lookupSelection?.zone === zone) {
    if (pointTouchesBoundary(lookupSelection.start, point.x, point.y)) edge = "start";
    else if (pointTouchesBoundary(lookupSelection.end, point.x, point.y)) edge = "end";
  }

  clearTimeout(selectionHoldTimer);
  selectionHoldTimer = 0;
  selectionGesture = {
    pointerId,
    captureTarget,
    zone,
    viaTouch,
    originX: point.x,
    originY: point.y,
    latestX: point.x,
    latestY: point.y,
    boundary,
    active: Boolean(edge),
    edge,
    cancelled: false,
  };

  if (edge) {
    document.body.classList.add("lookup-selecting");
    if (!viaTouch) {
      try { captureTarget?.setPointerCapture?.(pointerId); } catch {}
    }
    commitLookupSelection(true);
    return true;
  }

  selectionHoldTimer = window.setTimeout(() => {
    activateSelectionGesture(selectionGesture, boundary);
  }, SELECTION_HOLD_MS);
  return false;
}

function updateSelectionGesture(x, y) {
  const gesture = selectionGesture;
  if (!gesture || gesture.cancelled) return false;
  gesture.latestX = x;
  gesture.latestY = y;

  if (!gesture.active) {
    if (Math.hypot(x - gesture.originX, y - gesture.originY) > SELECTION_MOVE_TOLERANCE) {
      gesture.cancelled = true;
      clearTimeout(selectionHoldTimer);
      selectionHoldTimer = 0;
    }
    return false;
  }

  const boundary = wordBoundaryAtPoint(x, y, gesture.zone);
  if (!boundary) return true;

  if (gesture.edge === "start" && lookupSelection) {
    setLookupSelection(boundary, lookupSelection.end, gesture.zone, "start");
  } else if (gesture.edge === "end" && lookupSelection) {
    setLookupSelection(lookupSelection.start, boundary, gesture.zone, "end");
  } else {
    setLookupSelection(gesture.boundary, boundary, gesture.zone);
  }
  commitLookupSelection(true);
  return true;
}

function finishSelectionGesture() {
  clearTimeout(selectionHoldTimer);
  selectionHoldTimer = 0;
  const wasActive = Boolean(selectionGesture?.active);
  selectionGesture = null;
  document.body.classList.remove("lookup-selecting");
  if (wasActive) {
    commitLookupSelection(true);
    selectionHoldEndedAt = Date.now();
  }
  return wasActive;
}

function handleTextSelection() {
  if (selectionPopoverInteracting) return;
  try { window.getSelection()?.removeAllRanges(); } catch {}
}

function showSelectionPopover(word, rect) {
  const popover = $("#selectionPopover");
  if (!popover) return;
  $("#selectionPopoverWord").textContent = word;
  const translation = $("#selectionPopoverTranslation");
  translation.hidden = true;
  translation.textContent = "";
  popover.hidden = false;

  const width = popover.offsetWidth || 240;
  const height = popover.offsetHeight || 80;
  let left = rect.left + (rect.right - rect.left) / 2 - width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.top - height - 10;
  if (top < 8) top = rect.bottom + 10;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function hideSelectionPopover() {
  const popover = $("#selectionPopover");
  if (popover && !popover.hidden) popover.hidden = true;
  if (selectionData.identity) cancelAiJobsForContext(`selection:${selectionData.identity}`);
  selectionTranslateController?.abort(new DOMException("selection closed", "AbortError"));
  selectionTranslateRequestId++;
}

function pronounceSelection() {
  const word = String(selectionData.word || $("#selectionPopoverWord")?.textContent || "").trim();
  if (!word || $("#selectionPopover")?.hidden) return;
  speak(word, { lang: learningSpeechLocale() });
}

async function translateSelection() {
  if (!await prepareAiJob("selection-lookup")) return;
  const word = String($("#selectionPopoverWord").textContent || "").trim();
  if (!word) return;
  const identity = selectionData.identity;
  const contextId = `selection:${identity}`;
  const job = await startAiJob("selection-lookup", contextId);
  if (!job) return;
  const requestId = ++selectionTranslateRequestId;
  selectionTranslateController?.abort(new DOMException("replaced", "AbortError"));
  selectionTranslateController = job.controller;
  const controller = job.controller;
  const result = $("#selectionPopoverTranslation");
  const translateBtn = $("#selectionTranslateBtn");
  const addBtn = $("#selectionAddBtn");
  result.hidden = false;
  result.textContent = t("selection.loading");
  translateBtn.classList.add("loading");
  addBtn.disabled = true;
  let translated = "";
  try {
    const lang = state.settings.language || "uk";
    // The popover displays the translation only. `quickLookup` additionally
    // waits for the dictionary API and then throws its IPA/example data away,
    // so on a phone connection it added seconds of pointless waiting. Asking
    // the translator directly keeps the answer fast and still cancellable.
    translated = String(await window.LCAi.quickTranslate(word, lang, {
      signal: controller.signal,
      timeoutMs: SELECTION_TRANSLATE_TIMEOUT_MS,
      learningLanguage: activeLearningLanguageCode(),
      sourceLangCode: activeLearningLanguageCode(),
    }) || "").trim();
    if (!isCurrentAiJob(job)
      || requestId !== selectionTranslateRequestId
      || controller.signal.aborted
      || selectionData.identity !== identity
      || $("#selectionPopover")?.hidden
      || $("#selectionPopoverWord")?.textContent?.trim() !== word) return;
    result.hidden = false;
    result.textContent = translated || t("selection.notFound");
    addBtn.disabled = !translated;
    if (translated) {
      selectionData.translation = translated;
      addBtn.dataset.word = word;
      addBtn.dataset.translation = translated;
    }
  } catch (error) {
    if (!isAbortError(error) && isCurrentAiJob(job) && selectionData.identity === identity) {
      result.hidden = false;
      result.textContent = t("selection.error");
    }
  } finally {
    const owner = ownsAiJob(job);
    finishAiJob(job);
    if (owner) {
      translateBtn.classList.remove("loading");
      if (selectionTranslateController === controller) selectionTranslateController = null;
    }
  }
}

async function selectionAddCard() {
  const word = selectionData.word;
  if (!word) return;
  hideSelectionPopover();
  selectionTranslateRequestId++;
  selectionPopoverInteracting = true;
  openCardEditor(null, state.activeDeckId);
  $("#edFront").value = word;
  const context = selectionData.context || "";
  const sentence = pickSentenceWith(context, word);
  if (sentence && sentence.toLowerCase() !== word.toLowerCase()) $("#edExample").value = sentence;
  if (selectionData.translation) $("#edBack").value = selectionData.translation;
  clearLookupSelection({ keepPopover: true });

  if (state.settings.aiMode !== "off") {
    setTimeout(() => { if (typeof generateCard === "function") generateCard(); }, 60);
  } else {
    setTimeout(() => $("#edBack").focus(), 60);
  }
  setTimeout(() => { selectionPopoverInteracting = false; }, 200);
}

function pickSentenceWith(text, word) {
  if (!text) return "";
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const lowerWord = word.toLowerCase();
  const hit = parts.find(part => part.toLowerCase().includes(lowerWord));
  return (hit || "").trim();
}

function touchGesturePoint(event) {
  const touch = event.touches?.[0] || event.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function bindSelectionLookup() {
  document.addEventListener("contextmenu", event => {
    if (lookupZoneAt(event.target)) event.preventDefault();
  });
  document.addEventListener("dragstart", event => {
    if (lookupZoneAt(event.target)) event.preventDefault();
  });
  document.addEventListener("selectstart", event => {
    if (lookupZoneAt(event.target)) event.preventDefault();
  });

  /* Touch devices are driven by touch events: old WebKit builds (iOS 15 on
     iPhone 7) cancel or swallow pointer events during a long press inside
     non-selectable text, which used to make the gesture never start. */
  document.addEventListener("touchstart", event => {
    if (event.touches.length > 1) {
      cancelSelectionGesture();
      return;
    }
    if (event.target.closest?.("#selectionPopover")) return;
    const zone = lookupZoneAt(event.target);
    const point = touchGesturePoint(event);
    if (!zone || !point) {
      if (lookupSelection) clearLookupSelection();
      return;
    }
    beginSelectionGesture(point, zone, SELECTION_TOUCH_ID, zone, true);
  }, { passive: true, capture: true });

  document.addEventListener("pointerdown", event => {
    // Touch input is fully handled by the touch listeners above.
    if (event.pointerType === "touch") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("#selectionPopover")) return;
    const zone = lookupZoneAt(event.target);
    if (!zone) {
      if (lookupSelection) clearLookupSelection();
      return;
    }
    beginSelectionGesture({ x: event.clientX, y: event.clientY }, zone, event.pointerId, zone);
  });

  document.addEventListener("pointermove", event => {
    if (!selectionGesture || selectionGesture.viaTouch) return;
    if (selectionGesture.pointerId !== event.pointerId) return;
    if (updateSelectionGesture(event.clientX, event.clientY)) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("touchmove", event => {
    if (selectionGesture?.viaTouch && event.touches.length === 1) {
      const point = touchGesturePoint(event);
      if (point && updateSelectionGesture(point.x, point.y)) {
        if (event.cancelable) event.preventDefault();
        return;
      }
    }
    if (!selectionGesture?.active) return;
    if (event.cancelable) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("touchend", event => {
    if (!selectionGesture?.viaTouch) return;
    const point = touchGesturePoint(event);
    if (point && selectionGesture.active) updateSelectionGesture(point.x, point.y);
    if (finishSelectionGesture() && event.cancelable) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("touchcancel", () => {
    if (!selectionGesture?.viaTouch) return;
    const wasActive = selectionGesture.active;
    resetSelectionGesture();
    if (wasActive && lookupSelection) {
      commitLookupSelection(true);
      selectionHoldEndedAt = Date.now();
    }
  }, { capture: true });

  document.addEventListener("wheel", event => {
    if (!selectionGesture?.active) return;
    event.preventDefault();
  }, { passive: false, capture: true });

  const finishPointer = event => {
    if (!selectionGesture || selectionGesture.viaTouch) return;
    if (selectionGesture.pointerId !== event.pointerId) return;
    if (finishSelectionGesture()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener("pointerup", finishPointer, { passive: false });
  document.addEventListener("pointercancel", event => {
    if (!selectionGesture || selectionGesture.viaTouch) return;
    if (selectionGesture.pointerId !== event.pointerId) return;
    const wasActive = selectionGesture.active;
    resetSelectionGesture();
    if (wasActive && lookupSelection) {
      commitLookupSelection(true);
      selectionHoldEndedAt = Date.now();
    }
  });

  document.addEventListener("click", event => {
    if (event.target.closest("#selectionPopover")) return;
    /* A click that directly follows a finished hold gesture belongs to that
       gesture (the release of the press that opened the popover) — skip it. */
    if (Date.now() - selectionHoldEndedAt < 600) return;
    if (lookupZoneAt(event.target)) {
      event.preventDefault();
      if (lookupSelection) clearLookupSelection();
      return;
    }
    if (lookupSelection) clearLookupSelection();
  }, true);

  document.addEventListener("scroll", () => {
    invalidateWordGeometry();
    if (!selectionGesture?.active) clearLookupSelection();
  }, true);
  window.addEventListener("resize", () => {
    invalidateWordGeometry();
    if (lookupSelection) {
      renderSelectionHighlight();
      commitLookupSelection(false);
    }
  });

  const popover = $("#selectionPopover");
  if (popover) {
    const hold = () => {
      selectionPopoverInteracting = true;
      setTimeout(() => { selectionPopoverInteracting = false; }, 400);
    };
    popover.addEventListener("pointerdown", hold);
    popover.addEventListener("mousedown", hold);
    popover.addEventListener("touchstart", hold, { passive: true });
  }

  const speakBtn = $("#selectionSpeakBtn");
  const translateBtn = $("#selectionTranslateBtn");
  const addBtn = $("#selectionAddBtn");
  if (speakBtn) speakBtn.onclick = pronounceSelection;
  if (translateBtn) translateBtn.onclick = translateSelection;
  if (addBtn) addBtn.onclick = selectionAddCard;
}

function syncCompactSelectWidth(select) {
  if (!select || select.tagName !== "SELECT") return;
  const option = select.options[select.selectedIndex];
  const text = option ? option.textContent.trim() : "";
  if (!text) {
    select.style.removeProperty("--select-text-width");
    return;
  }
  const probe = syncCompactSelectWidth.probe || (syncCompactSelectWidth.probe = Object.assign(document.createElement("span"), { className: "select-width-probe" }));
  if (!probe.isConnected) document.body.appendChild(probe);
  const style = getComputedStyle(select);
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontStyle = style.fontStyle;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStretch = style.fontStretch;
  probe.style.letterSpacing = style.letterSpacing;
  probe.textContent = text;
  select.style.setProperty("--select-text-width", `${Math.ceil(probe.getBoundingClientRect().width) + 2}px`);
}

function syncCompactSelectWidths(root = document) {
  root.querySelectorAll("select").forEach(syncCompactSelectWidth);
}

function bindCompactSelectWidths() {
  document.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement) syncCompactSelectWidth(event.target);
  });
}