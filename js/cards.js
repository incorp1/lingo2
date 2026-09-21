/* Lingo Cards — Card/deck editors and deck cards modal */

const CARD_RENDER_SURFACES = Object.freeze({
  study: 1,
  browserRow: 2,
  browserList: 4,
  deckCounts: 8,
  selectors: 16,
});

function cardRenderInvalidation({ wasEditing, cardId, previous, current }) {
  if (!wasEditing) {
    return CARD_RENDER_SURFACES.browserList | CARD_RENDER_SURFACES.deckCounts | CARD_RENDER_SURFACES.selectors | CARD_RENDER_SURFACES.study;
  }
  let invalidation = CARD_RENDER_SURFACES.browserRow;
  if (session?.currentId === cardId) invalidation |= CARD_RENDER_SURFACES.study;
  if (previous.deckId !== current.deckId || previous.state !== current.state || previous.due !== current.due) {
    invalidation |= CARD_RENDER_SURFACES.browserList | CARD_RENDER_SURFACES.deckCounts | CARD_RENDER_SURFACES.selectors;
    const currentStudyCard = session?.currentId ? getCardById(session.currentId) : null;
    if (currentStudyCard && (currentStudyCard.deckId === previous.deckId || currentStudyCard.deckId === current.deckId)) {
      invalidation |= CARD_RENDER_SURFACES.study;
    }
  }
  return invalidation;
}

function applyCardRenderInvalidation(invalidation, cardId) {
  if (invalidation & CARD_RENDER_SURFACES.study) {
    invalidateStudyStage();
    renderStudy();
  }
  if (invalidation & CARD_RENDER_SURFACES.browserList) {
    if (viewingDeckId && !$("#deckBrowse")?.hidden) renderBrowse({ preserveScroll: true });
  } else if (invalidation & CARD_RENDER_SURFACES.browserRow) {
    patchBrowseCard(cardId);
  }
  if (invalidation & CARD_RENDER_SURFACES.deckCounts) {
    const decksViewActive = document.body.getAttribute("data-view") === "decks";
    if (decksViewActive && !viewingDeckId) renderDecks();
  }
  if (invalidation & CARD_RENDER_SURFACES.selectors) renderDeckSelector();
}

/* ----- Card editor ----- */
let editingCardId = null;
let editorGeneratedExample = null;
const EDITOR_TEXTAREA_IDS = ["edFront", "edBack", "edExample", "edHint"];

function resizeEditorTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function syncEditorTextareaHeights() {
  EDITOR_TEXTAREA_IDS.forEach(id => resizeEditorTextarea($(`#${id}`)));
}

function bindEditorTextareaAutosize() {
  EDITOR_TEXTAREA_IDS.forEach(id => {
    const textarea = $(`#${id}`);
    if (!textarea || textarea.dataset.autosizeBound) return;
    textarea.dataset.autosizeBound = "true";
    textarea.addEventListener("input", () => resizeEditorTextarea(textarea));
  });
}

function openCardEditor(cardId, preselectDeckId) {
  editingCardId = cardId;
  editorGeneratedExample = null;
  if (typeof updateEditorInfoBtn === "function") updateEditorInfoBtn();
  const isEdit = !!cardId;
  $("#editorTitle").textContent = isEdit ? t("modal.editCard") : t("modal.newCard");
  $("#saveCardBtn").textContent = t("modal.save");
  hideSelectionPopover();
  selectionTranslateRequestId++;

  const edDeck = $("#edDeck");
  edDeck.innerHTML = "";
  for (const d of activeDecks()) {
    const o = document.createElement("option");
    o.value = d.id; o.textContent = d.name; edDeck.appendChild(o);
  }

  if (isEdit) {
    const c = getCardById(cardId);
    const savedExamples = normalizedExampleFields(c);
    $("#edType").value = c.type;
    $("#edDeck").value = c.deckId;
    $("#edFront").value = c.front || "";
    $("#edBack").value = c.back || "";
    $("#edCloze").value = c.cloze || "";
    $("#edExample").value = [savedExamples.sentence, savedExamples.translation].filter(Boolean).join("\n");
    editorGeneratedExample = savedExamples.sentence || savedExamples.translation
      ? {
          sentence: savedExamples.sentence,
          translation: savedExamples.translation,
          targetTerm: c.exampleTargetTerm || "",
          displayValue: [savedExamples.sentence, savedExamples.translation].filter(Boolean).join("\n"),
        }
      : null;
    $("#edHint").value = c.hint || "";
  } else {
    $("#edType").value = "basic";
    $("#edDeck").value = preselectDeckId || state.activeDeckId || firstDeckIdForLanguage() || "";
    $("#edFront").value = ""; $("#edBack").value = "";
    $("#edCloze").value = ""; $("#edExample").value = "";
    $("#edHint").value = "";
  }
  syncCompactSelectWidth($("#edType"));
  syncCompactSelectWidth(edDeck);
  updateEditorDeckName();
  toggleClozeFields();
  bindEditorTextareaAutosize();
  // If the editor is opened on top of another modal (e.g. reading practice),
  // elevate it so it appears above that modal instead of behind it.
  const editorModal = $("#editorModal");
  const practiceOpen = !$("#practiceModal").hidden;
  const duplicateOpen = !$("#duplicateModal").hidden;
  editorModal.classList.toggle("modal-elevated", practiceOpen || duplicateOpen);
  openDialog(editorModal, $("#edType").value === "cloze" ? $("#edCloze") : $("#edFront"));
  requestAnimationFrame(syncEditorTextareaHeights);
}
function updateEditorDeckName() {
  const deckSelect = $("#edDeck");
  const deckName = deckSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  const subtitle = $("#editorDeckName");
  if (subtitle) subtitle.textContent = deckName;
}

function toggleClozeFields() {
  const isCloze = $("#edType").value === "cloze";
  $("#edFrontRow").hidden = isCloze;
  $("#edBackRow").hidden = isCloze;
  $("#edClozeRow").hidden = !isCloze;
}

async function saveCardFromEditor(stayOpen) {
  const type = $("#edType").value;
  const deckId = $("#edDeck").value;
  if (!deckId) { toast(t("toast.pickDeck"), { error: true }); return; }
  const editorExample = $("#edExample").value.trim();
  const generatedExample = editorGeneratedExample
    && editorExample === editorGeneratedExample.displayValue
    ? editorGeneratedExample
    : null;
  const data = {
    deckId, type,
    front: $("#edFront").value.trim(),
    back: $("#edBack").value.trim(),
    cloze: $("#edCloze").value.trim(),
    example: generatedExample
      ? [generatedExample.sentence, generatedExample.translation].filter(Boolean).join("\n")
      : editorExample,
    exampleSentence: generatedExample?.sentence || "",
    exampleTranslation: generatedExample?.translation || "",
    exampleTargetTerm: generatedExample?.targetTerm || "",
    hint: $("#edHint").value.trim(),
  };
  if (type === "cloze" && !data.cloze) { toast(t("toast.clozeRequired"), { error: true }); return; }
  if (type !== "cloze" && !data.front) { toast(t("toast.frontRequired"), { error: true }); return; }

  if (!editingCardId && type !== "cloze") {
    const duplicate = findDuplicateCard(deckId, data.front);
    if (duplicate) {
      closeDialog($("#editorModal"));
      showDuplicateDialog([duplicate]);
      return;
    }
  }

  const wasEditing = Boolean(editingCardId);
  const savedCardId = editingCardId;
  const previousCard = wasEditing ? { ...getCardById(savedCardId) } : null;
  const createdIds = [];
  const ok = await mutateAndFlush(() => {
    if (editingCardId) {
      const c = getCardById(editingCardId);
      if (c.deckId !== data.deckId) moveCardToDeck(c, data.deckId);
      c.updatedAt = Date.now();
      Object.assign(c, data);
      markCardDirty(c);
    } else {
      createdIds.push(createCard(data).id);
      if (type === "reverse" && data.front && data.back) {
        createdIds.push(createCard({ ...data, type: "basic", front: data.back, back: data.front }).id);
      }
    }
  });
  if (!ok) return;
  if (stayOpen) {
    // Clear inputs for the next card, keep deck + type
    $("#edFront").value = ""; $("#edBack").value = "";
    $("#edCloze").value = ""; $("#edExample").value = "";
    editorGeneratedExample = null;
    $("#edHint").value = "";
    syncEditorTextareaHeights();
    editingCardId = null;
    $("#editorTitle").textContent = t("modal.newCard");
    setTimeout(() => ($("#edType").value === "cloze" ? $("#edCloze") : $("#edFront")).focus(), 30);
    toast(t("toast.cardAdded"));
  } else {
    closeModal();
    toast(wasEditing ? t("toast.cardUpdated") : t("toast.cardAdded"));
  }
  const currentCard = wasEditing ? getCardById(savedCardId) : getCardById(createdIds[0]);
  const invalidation = cardRenderInvalidation({
    wasEditing,
    cardId: savedCardId || createdIds[0],
    previous: previousCard,
    current: currentCard,
  });
  applyCardRenderInvalidation(invalidation, savedCardId || createdIds[0]);
}

/* ----- Deck editor ----- */
let editingDeckId = null;
function openDeckEditor(deckId) {
  editingDeckId = deckId;
  if (deckId) {
    const d = getDeckById(deckId);
    $("#deckModalTitle").textContent = t("modal.editDeck");
    $("#deckName").value = d.name; $("#deckDesc").value = d.desc || "";
  } else {
    $("#deckModalTitle").textContent = t("modal.newDeck");
    $("#deckName").value = ""; $("#deckDesc").value = "";
  }
  openDialog($("#deckModal"), $("#deckName"));
}
async function saveDeckFromEditor() {
  const name = $("#deckName").value.trim();
  const desc = $("#deckDesc").value.trim();
  if (!name) { toast(t("toast.nameRequired"), { error: true }); return; }
  const ok = await mutateAndFlush(() => {
    if (editingDeckId) {
      const d = getDeckById(editingDeckId);
      d.name = name; d.desc = desc;
      markDeckDirty(d);
    } else {
      const d = createDeck(name, desc);
      state.activeDeckId = d.id;
      markMetaDirty();
    }
  });
  if (!ok) return;
  closeModal();
  renderDecks(); renderDeckSelector();
  toast(t("toast.deckSaved"));
}
function closeModal() {
  const editorModal = $("#editorModal");
  const closedEditor = editorModal && !editorModal.hidden;
  if (closedEditor) {
    cancelAiJobsForContext(`editor:${editingCardId || "new"}`);
    closeDialog(editorModal);
  }
  [$("#deckModal"), $("#bulkModal"), $("#wordInfoModal")].forEach(closeDialog);
  if (!$("#practiceModal")?.hidden) closePractice();
  editingCardId = null;
  editingDeckId = null;
  if (closedEditor) restoreDuplicateDialogAfterEditor();
}

/* ----- Deck cards modal (view / edit cards inside one deck) ----- */
let viewingDeckId = null;
function openDeckBrowse(deckId) {
  const deck = getDeckById(deckId);
  if (!deck || !isDeckInActiveLanguage(deck)) return;
  viewingDeckId = deckId;
  clearBulkSelection();
  $("#filterState").value = "";
  $("#filterDeck").value = deckId;
  $("#decksOverview").hidden = true;
  $("#deckBrowse").hidden = false;
  $("#deckBrowseTitle").textContent = deck.name;
  renderBrowse();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function closeDeckBrowse() {
  viewingDeckId = null;
  clearBulkSelection();
  const overview = $("#decksOverview");
  const browser = $("#deckBrowse");
  if (overview) overview.hidden = false;
  if (browser) browser.hidden = true;
  renderDecks();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function refreshDeckCardsModal() {
  if (viewingDeckId && !$("#deckBrowse")?.hidden) renderBrowse();
}

