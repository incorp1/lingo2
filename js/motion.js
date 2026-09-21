/* Lingo Cards — unobtrusive motion coordinator.
   Observes existing renders instead of changing application state or scheduling. */

(() => {
  "use strict";

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const VIEW_ORDER = ["study", "decks", "stats", "settings"];
  const CLEANUP_MS = 420;
  const STUDY_EXIT_MS = 210;
  const STUDY_ENTER_MS = 310;
  let previousView = document.body.dataset.view || "study";
  let previousStudyFront = "";
  let previousStudyHadAnswer = false;
  let suppressAutomaticStudyMotion = false;
  let studyTransitionToken = 0;

  function motionAllowed() {
    return !reducedMotion?.matches;
  }

  function replayClass(element, className, cleanupMs = CLEANUP_MS) {
    if (!element || !motionAllowed()) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), cleanupMs);
  }

  function animateActiveView(nextView) {
    if (!motionAllowed() || !nextView || nextView === previousView) return;
    const view = document.getElementById(`view-${nextView}`);
    if (!view) return;
    const previousIndex = VIEW_ORDER.indexOf(previousView);
    const nextIndex = VIEW_ORDER.indexOf(nextView);
    view.classList.toggle("motion-from-left", previousIndex > nextIndex);
    replayClass(view, "motion-view-enter");
    document.querySelectorAll(`.nav-item[data-view="${nextView}"]`).forEach(item => {
      replayClass(item, "motion-nav-select");
    });
    window.setTimeout(() => view.classList.remove("motion-from-left"), CLEANUP_MS);
    previousView = nextView;
  }

  function studyState(stage) {
    return {
      front: stage.querySelector(".card-front")?.textContent?.trim() || "",
      hasAnswer: Boolean(stage.querySelector(".card-back")),
    };
  }

  function animateStudyStage(stage) {
    if (!stage || !motionAllowed() || suppressAutomaticStudyMotion) return;
    const current = studyState(stage);
    if (current.front && current.front !== previousStudyFront) {
      previousStudyFront = current.front;
      previousStudyHadAnswer = current.hasAnswer;
      replayClass(stage, "motion-card-enter");
      return;
    }
    if (current.hasAnswer && !previousStudyHadAnswer) {
      replayClass(stage, "motion-answer-reveal");
    }
    previousStudyHadAnswer = current.hasAnswer;
  }

  function animateAddedRows(nodes) {
    if (!motionAllowed()) return;
    let index = 0;
    for (const root of nodes) {
      if (!(root instanceof Element)) continue;
      const candidates = root.matches(".deck-row, .card-row, .browse-row")
        ? [root]
        : root.querySelectorAll(".deck-row, .card-row, .browse-row");
      for (const row of candidates) {
        if (row.dataset.motionSeen === "true") continue;
        row.dataset.motionSeen = "true";
        row.style.setProperty("--motion-index", String(index++));
        replayClass(row, "motion-list-item-enter");
      }
    }
  }

  function animateStats(view) {
    if (!view || !motionAllowed()) return;
    const items = view.querySelectorAll(".stat-card, .chart-card, .heat-cell");
    items.forEach((item, index) => {
      item.style.setProperty("--motion-index", String(index));
      replayClass(item, "motion-stat-enter", 560);
    });
  }

  function animateDialog(modal) {
    if (!modal || modal.hidden || !motionAllowed()) return;
    replayClass(modal, "motion-modal-enter");
  }

  function handleMutations(mutations) {
    const added = [];
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target === document.body && mutation.attributeName === "data-view") {
          const nextView = document.body.dataset.view || "study";
          animateActiveView(nextView);
          if (nextView === "stats") {
            requestAnimationFrame(() => animateStats(document.querySelector("#view-stats")));
          }
        } else if (
          mutation.target instanceof Element &&
          mutation.target.classList.contains("modal") &&
          mutation.attributeName === "hidden"
        ) {
          animateDialog(mutation.target);
        }
      } else if (mutation.type === "childList") {
        added.push(...mutation.addedNodes);
        if (
          mutation.target instanceof Element &&
          (mutation.target.id === "cardStage" || mutation.target.closest?.("#cardStage"))
        ) {
          requestAnimationFrame(() => animateStudyStage(document.querySelector("#cardStage")));
        }
      }
    }
    if (added.length) requestAnimationFrame(() => animateAddedRows(added));
  }

  function bindPressFeedback() {
    document.addEventListener("click", event => {
      const grade = event.target.closest?.(".grade-btn");
      if (grade) replayClass(grade, "motion-grade-pulse");
    }, { passive: true });
  }

  function waitForAnimation(element, className, duration, token) {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        element.removeEventListener("animationend", onAnimationEnd);
        element.removeEventListener("webkitAnimationEnd", onAnimationEnd);
        if (token === studyTransitionToken) element.classList.remove(className);
        resolve();
      };
      const onAnimationEnd = event => {
        if (event.target !== element) return;
        if (String(event.animationName || "").startsWith("motion-study-card-")) finish();
      };
      element.addEventListener("animationend", onAnimationEnd);
      // Старый WebKit на iOS может прислать только префиксное событие.
      element.addEventListener("webkitAnimationEnd", onAnimationEnd);
      window.setTimeout(finish, duration + 80);
    });
  }

  async function transitionStudyCardOut() {
    const stage = document.querySelector("#cardStage");
    if (!stage || !stage.firstElementChild || !motionAllowed()) return;
    const token = ++studyTransitionToken;
    suppressAutomaticStudyMotion = true;
    stage.classList.remove("motion-study-card-enter", "motion-card-enter", "motion-answer-reveal");
    stage.setAttribute("aria-busy", "true");
    // Принудительный reflow: без него iOS склеивает снятие и установку класса
    // в один стилевой пересчёт, и анимация просто не запускается.
    void stage.offsetWidth;
    stage.classList.add("motion-study-card-exit");
    await waitForAnimation(stage, "motion-study-card-exit", STUDY_EXIT_MS, token);
  }

  function transitionStudyCardIn() {
    const stage = document.querySelector("#cardStage");
    if (!stage) {
      suppressAutomaticStudyMotion = false;
      return;
    }
    const token = ++studyTransitionToken;
    const current = studyState(stage);
    previousStudyFront = current.front;
    previousStudyHadAnswer = current.hasAnswer;
    stage.classList.remove("motion-study-card-exit", "motion-study-card-enter");
    stage.removeAttribute("aria-busy");

    if (!motionAllowed()) {
      suppressAutomaticStudyMotion = false;
      return;
    }

    requestAnimationFrame(() => {
      if (token !== studyTransitionToken) return;
      void stage.offsetWidth;
      stage.classList.add("motion-study-card-enter");
      void waitForAnimation(stage, "motion-study-card-enter", STUDY_ENTER_MS, token)
        .finally(() => {
          if (token === studyTransitionToken) suppressAutomaticStudyMotion = false;
        });
    });
  }

  window.LCMotion = Object.freeze({
    transitionStudyCardOut,
    transitionStudyCardIn,
  });

  function initialise() {
    const stage = document.querySelector("#cardStage");
    if (stage) {
      const initialStudyState = studyState(stage);
      previousStudyFront = initialStudyState.front;
      previousStudyHadAnswer = initialStudyState.hasAnswer;
    }

    document.querySelectorAll(".deck-row, .card-row, .browse-row").forEach(row => {
      row.dataset.motionSeen = "true";
    });

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-view", "hidden"],
    });

    bindPressFeedback();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();