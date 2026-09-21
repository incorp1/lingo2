/* Lingo Cards — Settings rendering and event binding */

/* ----- Settings view ----- */
let settingsHasRendered = false;
let settingsPanelsMounted = false;

function studyModeLabel(mode) {
  return t(mode === "sentence" ? "settings.cardMode.sentenceShort" : "settings.cardMode.word");
}

function closeStudyModeMenu({ restoreFocus = false } = {}) {
  const trigger = $("#setStudyCardMode");
  const menu = $("#studyModeMenu");
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus({ preventScroll: true });
}

function renderStudyModePicker() {
  const modes = state.settings.studyCardModes || ["word"];
  const trigger = $("#setStudyCardMode");
  const summary = $("#studyModeSummary");
  const menu = $("#studyModeMenu");
  if (!trigger || !summary || !menu) return;
  summary.textContent = modes.map(studyModeLabel).join(" + ");
  menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
    const selected = modes.includes(input.value);
    input.checked = selected;
    input.closest('[role="menuitemcheckbox"]')?.setAttribute("aria-checked", String(selected));
  });
}

function commitStudyCardModes(nextModes) {
  const rule = SETTINGS_SCHEMA.studyCardModes;
  const current = state.settings.studyCardModes || ["word"];
  const normalized = normalizeSettingValue(nextModes, rule, current, "ui");
  if (normalized.length === current.length && normalized.every((mode, index) => mode === current[index])) return false;
  state.settings.studyCardModes = normalized;
  if (session?.currentId) {
    clearStudyCycle(session.currentId);
    beginStudyCardVariants();
    session.revealed = false;
  }
  invalidateStudyStage();
  persistSettingsCommit();
  renderStudyModePicker();
  if (document.body.getAttribute("data-view") === "study") renderStudy();
  return true;
}

function studyFrontLabel(front) {
  // The "term side" label must name the language actually being learned,
  // otherwise Norwegian decks would still be labelled "English".
  if (front === "local") return t("settings.cardFrontLanguage.local");
  return typeof learningLanguageLabel === "function"
    ? learningLanguageLabel(state?.activeLearningLanguage)
    : t("settings.cardFrontLanguage.english");
}

function renderStudyFrontPicker() {
  const fronts = state.settings.studyCardFronts || ["english"];
  const summary = $("#studyFrontSummary");
  const menu = $("#studyFrontMenu");
  if (!summary || !menu) return;
  summary.textContent = fronts.map(studyFrontLabel).join(" + ");
  menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
    const selected = fronts.includes(input.value);
    input.checked = selected;
    input.closest('[role="menuitemcheckbox"]')?.setAttribute("aria-checked", String(selected));
  });
}

function commitStudyCardFronts(nextFronts) {
  const rule = SETTINGS_SCHEMA.studyCardFronts;
  const current = state.settings.studyCardFronts || ["english"];
  const normalized = normalizeSettingValue(nextFronts, rule, current, "ui");
  if (normalized.length === current.length && normalized.every((front, index) => front === current[index])) return false;
  state.settings.studyCardFronts = normalized;
  if (session?.currentId) {
    clearStudyCycle(session.currentId);
    beginStudyCardVariants();
    session.revealed = false;
  }
  invalidateStudyStage();
  persistSettingsCommit();
  renderStudyFrontPicker();
  if (document.body.getAttribute("data-view") === "study") renderStudy();
  return true;
}

function resetCheckboxMenuPosition(menu) {
  menu.classList.remove("is-viewport-menu");
  menu.style.removeProperty("left");
  menu.style.removeProperty("top");
  menu.style.removeProperty("bottom");
  menu.style.removeProperty("width");
  menu.style.removeProperty("--study-menu-max-height");
}

function positionCheckboxMenu(trigger, menu) {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || document.documentElement.clientWidth;
  const viewportHeight = viewport?.height || document.documentElement.clientHeight;
  const gap = 5;
  const edge = 8;
  const triggerRect = trigger.getBoundingClientRect();

  menu.classList.add("is-viewport-menu");
  menu.style.width = `${Math.max(180, triggerRect.width)}px`;
  menu.style.left = `${Math.min(
    viewportLeft + viewportWidth - edge - Math.max(180, triggerRect.width),
    Math.max(viewportLeft + edge, triggerRect.left)
  )}px`;

  const measuredHeight = menu.getBoundingClientRect().height;
  const roomBelow = viewportTop + viewportHeight - triggerRect.bottom - edge;
  const roomAbove = triggerRect.top - viewportTop - edge;
  const openAbove = roomBelow < measuredHeight + gap && roomAbove > roomBelow;
  const available = Math.max(42, (openAbove ? roomAbove : roomBelow) - gap);

  menu.style.setProperty("--study-menu-max-height", `${available}px`);
  menu.style.top = openAbove
    ? `${Math.max(viewportTop + edge, triggerRect.top - Math.min(measuredHeight, available) - gap)}px`
    : `${Math.min(viewportTop + viewportHeight - edge, triggerRect.bottom + gap)}px`;
}

function bindCheckboxMenu(trigger, menu, commit) {
  if (!trigger || !menu) return;
  const reposition = () => {
    if (!menu.hidden) positionCheckboxMenu(trigger, menu);
  };
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    const opening = menu.hidden;
    $$(".study-mode-menu").forEach(other => {
      if (other !== menu) {
        other.hidden = true;
        resetCheckboxMenuPosition(other);
      }
    });
    $$(".study-mode-trigger").forEach(other => {
      if (other !== trigger) other.setAttribute("aria-expanded", "false");
    });
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      positionCheckboxMenu(trigger, menu);
      menu.querySelector('input[type="checkbox"]')?.focus({ preventScroll: true });
    } else {
      resetCheckboxMenuPosition(menu);
    }
  });
  window.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("scroll", reposition);
  menu.addEventListener("change", event => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    const selected = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map(item => item.value);
    if (!selected.length) {
      input.checked = true;
      return;
    }
    commit(selected);
  });
  menu.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    menu.hidden = true;
    resetCheckboxMenuPosition(menu);
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus({ preventScroll: true });
  });
}

function mountSettingsRoutePanels() {
  if (settingsPanelsMounted) return;
  const legacy = $("#settingsLegacyControls");
  if (!legacy) return;
  const panels = Object.fromEntries($$("[data-settings-route]").map(panel => [panel.dataset.settingsRoute, panel]));

  // The learning panel has dedicated controls for algorithm and leech threshold.

  const languageTitle = $("#settingsLanguageTitle", legacy);
  const languageBlock = languageTitle?.closest(".settings-block");
  if (languageBlock) {
    languageBlock.classList.add("appearance-settings-block");
    panels.appearance.appendChild(languageBlock);
  }

  const blocks = $$(".settings-block", legacy);
  blocks.forEach(block => {
    if (block.classList.contains("algo-block")) {
      // Algorithm selection lives exclusively in Learning → Scheduling.
      block.remove();
    } else if (block.classList.contains("ai-block")) {
      panels.generation.appendChild(block);
    } else if (block.classList.contains("learning-block") ||
               block.classList.contains("again-block") ||
               block.classList.contains("hard-block") ||
               block.classList.contains("good-block") ||
               block.classList.contains("easy-block") ||
               block.classList.contains("leech-block")) {
      panels.learning.appendChild(block);
    } else if (block.classList.contains("danger") || block.querySelector("#exportBtn")) {
      panels.data.appendChild(block);
    } else if (block.querySelector("#setAutoTTS")) {
      const themeRow = block.querySelector("#setTheme")?.closest(".settings-row");
      if (themeRow && languageBlock) {
        themeRow.classList.add("appearance-theme-row");
        languageBlock.appendChild(themeRow);
      }
      panels["card-sound"].appendChild(block);
    } else if (block.classList.contains("smart-block")) {
      panels.learning.appendChild(block);
    } else {
      panels.learning.appendChild(block);
    }
  });

  // Remove the review-advanced wrappers and move their content
  for (const wrapperId of ["reviewAdvanced", "reviewAdvanced2"]) {
    const wrapper = $(`#${wrapperId}`, legacy);
    if (!wrapper) continue;
    const wrapperBlocks = $$(".settings-block", wrapper);
    wrapperBlocks.forEach(block => {
      if (block.classList.contains("ai-block")) {
        panels.generation.appendChild(block);
      } else {
        panels.learning.appendChild(block);
      }
    });
    wrapper.remove();
  }

  // Remove the legacy advanced toggle row (no longer needed with panel navigation)
  const advToggleRow = $("#reviewAdvancedToggle")?.closest(".settings-row");
  if (advToggleRow) advToggleRow.remove();

  legacy.remove();
  settingsPanelsMounted = true;
}

/* P21: Dynamic summaries for settings home route buttons */
function renderSettingsSummaries() {
  const s = state.settings;
  const summaryLearning = $("#summaryLearning");
  if (summaryLearning) {
    const algoLabel = s.algorithm === "fsrs" ? "FSRS" : "SM-2";
    summaryLearning.textContent = algoLabel;
  }
  const summaryGeneration = $("#summaryGeneration");
  if (summaryGeneration) {
    const modeKey = s.aiMode === "ai" ? "settings.summary.ai" : s.aiMode === "dictionary" ? "settings.summary.dictionary" : "settings.summary.off";
    summaryGeneration.textContent = t(modeKey) || (s.aiMode === "ai" ? "AI" : s.aiMode === "dictionary" ? t("settings.aiMode.dictionary") || "Словарь" : t("settings.aiMode.off") || "Выкл.");
  }
  const summaryCardSound = $("#summaryCardSound");
  if (summaryCardSound) {
    summaryCardSound.textContent = s.autoTTS ? (t("settings.summary.ttsOn") || "TTS вкл.") : "";
  }
  const summaryAppearance = $("#summaryAppearance");
  if (summaryAppearance) {
    const langName = t("lang.name") || s.language;
    const themeLabel = s.theme === "auto" ? (t("settings.theme.auto") || "Авто") : s.theme === "dark" ? (t("settings.theme.dark") || "Тёмная") : (t("settings.theme.light") || "Светлая");
    summaryAppearance.textContent = `${langName} · ${themeLabel}`;
  }
  const summaryData = $("#summaryData");
  if (summaryData) {
    const deckCount = state.decks ? state.decks.length : 0;
    const cardCount = state.cards ? state.cards.length : 0;
    summaryData.textContent = `${deckCount} ${t("settings.summary.decks") || "колод"} · ${cardCount} ${t("settings.summary.cards") || "карточек"}`;
  }
  // Footer version/storage
  const footerVersion = $("#settingsFooterVersion");
  if (footerVersion) footerVersion.textContent = "v3.20.3";
  const footerStorage = $("#settingsFooterStorage");
  if (footerStorage && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      if (est.usage) {
        const mb = (est.usage / 1024 / 1024).toFixed(1);
        footerStorage.textContent = `${mb} MB`;
      }
    }).catch(() => {});
  }
}

function formatBackupSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function renderBackupMetadata() {
  const counts = $("#backupCounts");
  if (counts) {
    const decks = state.decks?.length || 0;
    const cards = state.cards?.length || 0;
    counts.textContent = t("settings.backup.counts", { decks, cards });
  }
  const size = $("#backupSize");
  if (size) {
    try {
      await window.LCStorage.flush();
      const snapshot = await window.LCStorage.readAppSnapshot();
      const text = window.LCBackup.buildFullExport(snapshot, { includeSecrets: true });
      size.textContent = t("settings.backup.size", { size: formatBackupSize(new Blob([text]).size) });
    } catch {
      size.textContent = t("settings.backup.sizeUnavailable");
    }
  }
  const last = $("#backupLastSuccessful");
  if (last) {
    const value = await window.LCStorage.getLocalMetadata("lastSuccessfulBackupAt");
    const date = typeof value === "string" ? new Date(value) : null;
    last.textContent = date && Number.isFinite(date.getTime())
      ? t("settings.backup.last", { date: date.toLocaleString(state.settings.language) })
      : t("settings.backup.never");
  }
}

function renderSettings() {
  mountSettingsRoutePanels();
  settingsHasRendered = true;
  const s = state.settings;
  $("#setLang").value = s.language;
  $("#setLearnSteps").value = s.learnSteps.join(" ");
  $("#setGraduatingInterval").value = s.graduatingInterval;
  $("#setEasyInterval").value = s.easyInterval;
  $("#setEaseStart").value = s.startingEase;
  $("#setLapseNewInterval").value = s.lapseNewInterval;
  $("#setLapseEasePenalty").value = s.lapseEasePenalty;
  $("#setHardFactor").value = s.hardFactor;
  $("#setHardEasePenalty").value = s.hardEasePenalty;
  $("#setEasyBonus").value = s.easyBonus;
  $("#setEasyEaseBoost").value = s.easyEaseBoost;
  $("#setIntervalMod").value = s.intervalModifier;
  $("#setAutoTTS").checked = !!s.autoTTS;
  const ttsRateInput = $("#setTtsRate");
  if (ttsRateInput) ttsRateInput.value = s.ttsRate;
  updateTtsRateDisplay(s.ttsRate);
  renderStudyModePicker();
  renderStudyFrontPicker();
  $("#setTheme").value = s.theme;
  // Algorithm + FSRS + leech
  $$('input[name="setAlgorithm"]').forEach(r => r.checked = (r.value === s.algorithm));
  const fsrsExtra = $("#fsrsExtra");
  if (fsrsExtra) fsrsExtra.hidden = s.algorithm !== "fsrs";
  const fsrsRetentionInput = $("#setFsrsRetention");
  if (fsrsRetentionInput) fsrsRetentionInput.value = s.fsrsRetention;
  const fsrsMaxIntervalInput = $("#setFsrsMaxInterval");
  if (fsrsMaxIntervalInput) fsrsMaxIntervalInput.value = s.fsrsMaxInterval;
  $("#setLeechThreshold").value = s.leechThreshold;
  // Sync the secondary leech threshold control
  const leechExpertInput = $("#setLeechThresholdExpert");
  if (leechExpertInput) leechExpertInput.value = s.leechThreshold;

  // P23: Learning panel algorithm selector buttons
  $$("[data-algo-value]").forEach(button => {
    const selected = button.dataset.algoValue === s.algorithm;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  // P23: FSRS retention slider
  const retSlider = $("#setFsrsRetentionSlider");
  if (retSlider) {
    retSlider.value = s.fsrsRetention;
    const retDisplay = $("#fsrsRetentionDisplay");
    if (retDisplay) retDisplay.textContent = `${s.fsrsRetention}%`;
  }
  // P23: Learning panel algorithm visibility
  const learningFsrsRow = $("#learningFsrsRetentionRow");
  if (learningFsrsRow) learningFsrsRow.hidden = s.algorithm !== "fsrs";
  // P26: SM-2 only controls visibility
  $$(".sm2-only").forEach(el => { el.hidden = s.algorithm !== "sm2"; });

  // AI generation settings
  $("#setAiMode").value = s.aiMode;
  syncAiModeControl(s.aiMode);
  $("#setAiProvider").value = s.aiProvider;
  $("#setAiKey").value = s.aiKey || "";
  $("#setExampleTopics").value = s.exampleTopics;
  $("#setExampleSituations").value = s.exampleSituations;
  $("#setExampleStyles").value = s.exampleStyles;
  $("#setExampleTemperature").value = s.exampleTemperature;
  const aiNote = $("#aiLangNote");
  if (aiNote) aiNote.textContent = t("settings.ai.langNote", { lang: t("lang.name") });
  populateAiModels(s.aiProvider, s.aiModel);
  renderAiRateInfo();
  $("#aiExtra").hidden = false;

  updatePreviewExamples();
  updateFsrsPreview();
  renderSettingsSummaries();
  renderBackupMetadata().catch(() => {});
  setupCollapsibleBlocks();
  applyAdvancedReviewState();
  if (window.initTooltips) window.initTooltips($("#view-settings"));
  syncCompactSelectWidths($("#view-settings"));
}

function parseLearningStepsInput(value) {
  const tokens = String(value || "").trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return null;
  const steps = tokens.map(Number);
  if (steps.some(step => !Number.isFinite(step) || step <= 0 || step > 525600)) return null;
  return steps.slice(0, 20);
}

function commitLearningStepsDraft({ silent = false } = {}) {
  const input = $("#setLearnSteps");
  if (!input) return true;
  const steps = parseLearningStepsInput(input.value);
  if (!steps) {
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  input.removeAttribute("aria-invalid");
  input.value = steps.join(" ");
  if (JSON.stringify(steps) === JSON.stringify(state.settings.learnSteps)) return true;
  state.settings.learnSteps = steps;
  if (!silent) persistSettingsCommit();
  else {
    markSettingsDirty();
    save();
  }
  return true;
}

function updatePreviewExamples() {
  const s = state.settings;
  // Sample: card last seen 10 days ago, default ease
  const sampleInterval = 10;
  const sampleEase = s.startingEase;
  const mod = s.intervalModifier / 100;
  const fmt = (d) => {
    if (d < 1) return `<1 ${t("preview.day")}`;
    if (d < 30) return `${d} ${d === 1 ? t("preview.day") : t("preview.days")}`;
    if (d < 365) return `${Math.round(d / 30)} ${t("preview.months")}`;
    return `${(d / 365).toFixed(1)} ${t("preview.years")}`;
  };

  // Again on a review card
  let againDays;
  if (s.lapseNewInterval > 0) {
    againDays = Math.max(1, Math.round(sampleInterval * (s.lapseNewInterval / 100)));
  } else {
    againDays = null; // restart learning, ~1 minute
  }
  const newEaseAgain = Math.max(130, sampleEase - s.lapseEasePenalty);
  const againText = againDays === null
    ? t("settings.again.exampleRestart")
        .replace("{ease}", (sampleEase / 100).toFixed(2))
        .replace("{newEase}", (newEaseAgain / 100).toFixed(2))
    : t("settings.again.example")
        .replace("{days}", sampleInterval)
        .replace("{newDays}", fmt(againDays))
        .replace("{ease}", (sampleEase / 100).toFixed(2))
        .replace("{newEase}", (newEaseAgain / 100).toFixed(2));
  $("#setAgainPreview").textContent = againText;

  // Hard
  const hardDays = Math.max(1, Math.round(sampleInterval * (s.hardFactor / 100) * mod));
  const newEaseHard = Math.max(130, sampleEase - s.hardEasePenalty);
  $("#setHardPreview").textContent = t("settings.hard.example")
    .replace("{days}", sampleInterval)
    .replace("{newDays}", fmt(hardDays))
    .replace("{ease}", (sampleEase / 100).toFixed(2))
    .replace("{newEase}", (newEaseHard / 100).toFixed(2));

  // Good
  const goodDays = Math.max(sampleInterval + 1, Math.round(sampleInterval * (sampleEase / 100) * mod));
  $("#setGoodPreview").textContent = t("settings.good.example")
    .replace("{days}", sampleInterval)
    .replace("{newDays}", fmt(goodDays))
    .replace("{ease}", (sampleEase / 100).toFixed(2));

  // Easy
  const easyDays = Math.max(sampleInterval + 1, Math.round(sampleInterval * (sampleEase / 100) * (s.easyBonus / 100) * mod));
  const newEaseEasy = sampleEase + s.easyEaseBoost;
  $("#setEasyPreview").textContent = t("settings.easy.example")
    .replace("{days}", sampleInterval)
    .replace("{newDays}", fmt(easyDays))
    .replace("{ease}", (sampleEase / 100).toFixed(2))
    .replace("{newEase}", (newEaseEasy / 100).toFixed(2));
}

function formatTtsRate(rate) {
  return `${Number(rate).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}×`;
}

function updateTtsRateDisplay(rate) {
  const output = $("#ttsRateDisplay");
  if (output) output.textContent = formatTtsRate(rate);
}

function commitTtsRate(rawValue, { announce = false } = {}) {
  const rule = SETTINGS_SCHEMA.ttsRate;
  const next = normalizeSettingValue(Number(rawValue), rule, state.settings.ttsRate, "ui");
  updateTtsRateDisplay(next);
  if (Object.is(next, state.settings.ttsRate)) return false;
  state.settings.ttsRate = next;
  markSettingsDirty();
  save();
  renderSettingsSummaries();
  if (announce) toast(t("settings.saved"));
  return true;
}

function persistSettingsCommit() {
  markSettingsDirty();
  save();
  renderSettingsSummaries();
  toast(t("settings.saved"));
}

let aiKeyDraft = null;

function commitAiKeyDraft() {
  const input = $("#setAiKey");
  if (!input) return false;
  const next = String(aiKeyDraft === null ? input.value : aiKeyDraft).trim();
  aiKeyDraft = null;
  input.value = next;
  if (next === state.settings.aiKey) return true;
  clearAiSettingsBusyState();
  state.settings.aiKey = next;
  persistSettingsCommit();
  return true;
}

const PROMPT_LIST_CONTROLS = Object.freeze({
  setExampleTopics: "exampleTopics",
  setExampleSituations: "exampleSituations",
  setExampleStyles: "exampleStyles",
});

function normalizePromptList(value) {
  return String(value || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .join("; ");
}

function commitPromptListDraft(input, { silent = false } = {}) {
  const key = PROMPT_LIST_CONTROLS[input?.id];
  if (!key) return false;
  const normalized = normalizePromptList(input.value);
  if (!normalized) {
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  input.removeAttribute("aria-invalid");
  input.value = normalized;
  if (normalized === state.settings[key]) return true;
  state.settings[key] = normalized;
  if (!silent) persistSettingsCommit();
  else {
    markSettingsDirty();
    save();
  }
  return true;
}

function settingsDraftErrorMessage() {
  const language = state?.settings?.language || "en";
  if (language === "ru") return "Исправьте выделенное значение перед переходом.";
  if (language === "uk") return "Виправте виділене значення перед переходом.";
  return "Fix the highlighted value before leaving this screen.";
}

function commitSettingsDrafts(reason = "navigation") {
  if (!settingsHasRendered) return true;
  const invalid = [];
  for (const id of Object.keys(NUMERIC_SETTING_CONTROLS)) {
    const input = $(`#${id}`);
    if (input && !commitNumericDraft(input, { silent: true })) invalid.push(input);
  }
  const learnStepsInput = $("#setLearnSteps");
  if (learnStepsInput && !commitLearningStepsDraft({ silent: true })) invalid.push(learnStepsInput);
  for (const id of Object.keys(PROMPT_LIST_CONTROLS)) {
    const input = $(`#${id}`);
    if (input && !commitPromptListDraft(input, { silent: true })) invalid.push(input);
  }
  if (invalid.length) {
    const first = invalid[0];
    first.setAttribute("aria-invalid", "true");
    if (reason !== "pagehide") {
      toast(settingsDraftErrorMessage(), { error: true });
      first.focus({ preventScroll: true });
      first.scrollIntoView?.({ block: "center" });
    }
    return false;
  }
  return commitAiKeyDraft();
}

function runWithCommittedAiKey(action) {
  if (!commitSettingsDrafts("ai-action")) return undefined;
  return action();
}

function clearAiSettingsBusyState() {
  cancelAiSettingsRequests();
  for (const selector of ["#refreshAiModelsBtn", "#aiTestBtn"]) {
    const button = $(selector);
    if (button) {
      button.removeAttribute("aria-busy");
      button.classList.remove("loading");
    }
  }
}

function commitSimpleSetting(key, rawValue) {
  const rule = SETTINGS_SCHEMA[key];
  if (!rule) return false;
  const current = state.settings[key];
  const next = normalizeSettingValue(rawValue, rule, current, "ui");
  if (Object.is(next, current)) return false;
  state.settings[key] = next;

  if (["language", "aiMode", "aiProvider", "aiModel"].includes(key)) {
    clearAiSettingsBusyState();
  }
  if (key === "language") applyLanguage();
  if (key === "theme") {
    applyTheme();
  }
  if (key === "aiMode") {
    $("#aiExtra").hidden = false;
    syncAiModeControl(next);
  }
  if (key === "algorithm") {
    $("#fsrsExtra").hidden = next !== "fsrs";
    const learningFsrsRow = $("#learningFsrsRetentionRow");
    if (learningFsrsRow) learningFsrsRow.hidden = next !== "fsrs";
    $$(".sm2-only").forEach(el => { el.hidden = next !== "sm2"; });
    updatePreviewExamples();
    updateFsrsPreview();
  }
  persistSettingsCommit();
  return true;
}

const NUMERIC_SETTING_CONTROLS = Object.freeze({
  setGraduatingInterval: "graduatingInterval",
  setEasyInterval: "easyInterval",
  setEaseStart: "startingEase",
  setLapseNewInterval: "lapseNewInterval",
  setLapseEasePenalty: "lapseEasePenalty",
  setHardFactor: "hardFactor",
  setHardEasePenalty: "hardEasePenalty",
  setEasyBonus: "easyBonus",
  setEasyEaseBoost: "easyEaseBoost",
  setIntervalMod: "intervalModifier",
  setFsrsRetention: "fsrsRetention",
  setFsrsMaxInterval: "fsrsMaxInterval",
  setLeechThreshold: "leechThreshold",
  setLeechThresholdExpert: "leechThreshold",
  setExampleTemperature: "exampleTemperature",
});

function commitNumericDraft(input) {
  const { silent = false } = arguments[1] || {};
  const key = NUMERIC_SETTING_CONTROLS[input.id];
  if (!key) return false;
  const value = Number(input.value);
  const rule = SETTINGS_SCHEMA[key];
  const normalized = normalizeSettingValue(value, rule, undefined, "ui");
  if (normalized === undefined) {
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  input.removeAttribute("aria-invalid");
  if (Object.is(state.settings[key], normalized)) return true;
  state.settings[key] = normalized;
  if (key === "leechThreshold") {
    for (const peerId of ["setLeechThreshold", "setLeechThresholdExpert"]) {
      const peer = $(`#${peerId}`);
      if (peer && peer !== input) peer.value = normalized;
    }
  }
  if (!silent) persistSettingsCommit();
  else {
    markSettingsDirty();
    save();
  }
  updatePreviewExamples();
  if (key === "fsrsRetention" || key === "fsrsMaxInterval") updateFsrsPreview();
  return true;
}

function syncAiModeControl(mode) {
  $$(".ai-mode-option").forEach(button => {
    const selected = button.dataset.aiMode === mode;
    button.setAttribute("aria-checked", String(selected));
    button.classList.toggle("active", selected);
  });
}

function updateFsrsPreview() {
  if (!window.FSRS || !state?.settings) return;
  const now = Date.now();
  const sample = {
    id: "settings-fsrs-preview",
    state: "review",
    interval: 10,
    ease: 250,
    reps: 5,
    lapses: 1,
    lastReview: now - 10 * DAY_MS,
    due: now,
  };
  const preview = window.FSRS.previewIntervals(sample, state.settings);
  for (const rating of ["Again", "Hard", "Good", "Easy"]) {
    const output = $(`#fsrsPreview${rating}`);
    if (output) output.textContent = preview[rating.toLowerCase()] || "—";
  }
}

async function requestAlgorithmChange(next) {
  const rule = SETTINGS_SCHEMA.algorithm;
  const normalized = normalizeSettingValue(next, rule, state.settings.algorithm, "ui");
  const changesAlgorithm = normalized !== state.settings.algorithm;
  if (changesAlgorithm) {
    const confirmed = await confirmDialog({
      title: t("confirm.algorithm.title"),
      message: t("confirm.algorithm.message", { algorithm: normalized === "fsrs" ? "FSRS" : "SM-2" }),
      confirmLabel: t("confirm.algorithm.action"),
    });
    if (!confirmed) {
      renderSettings();
      return false;
    }
  }
  state.settings.algorithm = normalized;
  markSettingsDirty();
  save();
  renderSettings();
  return true;
}

function bindSettings() {
  const simpleControls = {
    setLang: ["language", element => element.value],
    setTheme: ["theme", element => element.value],
    setAutoTTS: ["autoTTS", element => element.checked],
    setAiMode: ["aiMode", element => element.value],
  };
  for (const [id, [key, read]] of Object.entries(simpleControls)) {
    const element = $(`#${id}`);
    if (element) element.addEventListener("change", () => commitSimpleSetting(key, read(element)));
  }

  const ttsRateInput = $("#setTtsRate");
  if (ttsRateInput) {
    ttsRateInput.addEventListener("input", () => commitTtsRate(ttsRateInput.value));
    ttsRateInput.addEventListener("change", () => commitTtsRate(ttsRateInput.value, { announce: true }));
  }
  const ttsPreviewButton = $("#ttsPreviewBtn");
  if (ttsPreviewButton) {
    ttsPreviewButton.addEventListener("click", () => {
      const rate = normalizeSettingValue(
        Number(ttsRateInput?.value),
        SETTINGS_SCHEMA.ttsRate,
        state.settings.ttsRate,
        "ui"
      );
      commitTtsRate(rate);
      speak(t("settings.ttsRate.sample"), { rate });
    });
  }

  bindCheckboxMenu($("#setStudyCardMode"), $("#studyModeMenu"), commitStudyCardModes);
  bindCheckboxMenu($("#setStudyCardFront"), $("#studyFrontMenu"), commitStudyCardFronts);
  document.addEventListener("click", event => {
    if (event.target.closest(".study-mode-picker")) return;
    $$(".study-mode-menu").forEach(menu => {
      menu.hidden = true;
      resetCheckboxMenuPosition(menu);
    });
    $$(".study-mode-trigger").forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
  });

  const provider = $("#setAiProvider");
  if (provider) provider.addEventListener("change", () => {
    if (!commitSimpleSetting("aiProvider", provider.value)) return;
    const defaultModel = window.LCAi?.PROVIDER_DEFAULTS?.[state.settings.aiProvider]?.model || "";
    populateAiModels(state.settings.aiProvider, defaultModel);
    commitSimpleSetting("aiModel", defaultModel);
  });
  const model = $("#setAiModel");
  if (model) model.addEventListener("change", () => commitSimpleSetting("aiModel", model.value.trim()));

  for (const id of Object.keys(PROMPT_LIST_CONTROLS)) {
    const input = $(`#${id}`);
    if (!input) continue;
    input.addEventListener("blur", () => commitPromptListDraft(input));
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      commitPromptListDraft(input);
      input.blur();
    });
  }

  $$('input[name="setAlgorithm"]').forEach(element => {
    element.addEventListener("change", () => {
      if (element.checked) requestAlgorithmChange(element.value);
    });
  });

  for (const id of Object.keys(NUMERIC_SETTING_CONTROLS)) {
    const input = $(`#${id}`);
    if (!input) continue;
    input.addEventListener("blur", () => commitNumericDraft(input));
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitNumericDraft(input);
    });
  }

  const learnStepsInput = $("#setLearnSteps");
  if (learnStepsInput) {
    learnStepsInput.addEventListener("blur", () => commitLearningStepsDraft());
    learnStepsInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitLearningStepsDraft();
    });
  }

  const aiKeyInput = $("#setAiKey");
  aiKeyInput.addEventListener("input", () => {
    aiKeyDraft = aiKeyInput.value;
  });
  aiKeyInput.addEventListener("blur", commitAiKeyDraft);
  aiKeyInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitAiKeyDraft();
  });

  // Mobile: tapping a setting's label (title) should not move focus into its
  // associated text/number/select field — only the field itself opens the
  // keyboard. Checkbox/toggle rows keep the native tap-to-toggle behavior.
  const settingsView = $("#view-settings");
  if (settingsView) {
    settingsView.addEventListener("click", (e) => {
      if (!window.matchMedia("(max-width: 640px)").matches) return;
      const label = e.target.closest("label[for]");
      if (!label) return;
      const ctrl = document.getElementById(label.getAttribute("for"));
      if (!ctrl) return;
      const isTextual =
        (ctrl.tagName === "INPUT" && /^(text|number|search|email|url|tel|password)$/i.test(ctrl.type)) ||
        ctrl.tagName === "SELECT" ||
        ctrl.tagName === "TEXTAREA";
      if (isTextual) e.preventDefault();
    });
  }
  $("#aiTestBtn").onclick = () => runWithCommittedAiKey(testAiKey);
  const refreshModelsBtn = $("#refreshAiModelsBtn");
  if (refreshModelsBtn) refreshModelsBtn.onclick = () => runWithCommittedAiKey(refreshAiModels);
  const advToggle = $("#reviewAdvancedToggle");
  if (advToggle) advToggle.onclick = () => {
    state.settings.showAdvancedReview = !state.settings.showAdvancedReview;
    markSettingsDirty();
    save();
    applyAdvancedReviewState();
  };


  $$("[data-settings-route-open]").forEach(button => {
    button.onclick = () => {
      const target = button.dataset.settingsRouteOpen;
      const isBackControl = button.classList.contains("settings-back-btn");
      return isBackControl
        ? animateSettingsBack(target)
        : navigateToSettings(target, { focus: true });
    };
  });

  // P22: Stepper buttons for learning panel
  $$("[data-stepper-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.stepperTarget;
      const dir = parseInt(btn.dataset.stepperDir, 10);
      const input = $(`#${targetId}`);
      if (!input) return;
      const step = 1;
      const min = parseInt(input.min) || 0;
      const max = parseInt(input.max) || 9999;
      const current = parseInt(input.value) || 0;
      const next = Math.max(min, Math.min(max, current + dir * step));
      if (next === current) return;
      input.value = next;
      commitNumericDraft(input);
    });
  });

  // P24: Both algorithm controls use one confirmation path.
  $$(".algo-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.algoValue;
      if (value) requestAlgorithmChange(value);
    });
  });

  // P30: Keep the persisted select and the accessible segmented control in sync.
  $$(".ai-mode-option").forEach(button => {
    button.addEventListener("click", () => {
      const mode = button.dataset.aiMode;
      const select = $("#setAiMode");
      if (!select || !SETTINGS_SCHEMA.aiMode.values.includes(mode)) return;
      select.value = mode;
      commitSimpleSetting("aiMode", mode);
    });
  });

  // P23: FSRS retention slider in learning panel
  const retentionSlider = $("#setFsrsRetentionSlider");
  if (retentionSlider) {
    retentionSlider.addEventListener("input", () => {
      const val = parseInt(retentionSlider.value);
      const display = $("#fsrsRetentionDisplay");
      if (display) display.textContent = `${val}%`;
      // Sync with the secondary numeric input
      const expertInput = $("#setFsrsRetention");
      if (expertInput) expertInput.value = val;
    });
    retentionSlider.addEventListener("change", () => {
      const val = parseInt(retentionSlider.value);
      state.settings.fsrsRetention = val;
      persistSettingsCommit();
      updateFsrsPreview();
    });
  }

  // Both leech inputs use the shared schema-backed numeric draft lifecycle.

  // Data management
  const resetBtn = $("#resetProgressBtn");
  if (resetBtn) resetBtn.onclick = resetProgress;
  const wipeBtn = $("#wipeBtn");
  if (wipeBtn) wipeBtn.onclick = wipeAll;
}

