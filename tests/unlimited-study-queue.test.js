const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("study has no daily quotas and uses a 50-card rolling queue", () => {
  const state = read("js/state.js");
  const scheduler = read("js/scheduler.js");
  const settings = read("js/settings.js");
  const html = read("index.html");

  assert.doesNotMatch(state, /\b(?:newPerDay|reviewsPerDay)\b/);
  assert.doesNotMatch(settings, /set(?:New|Reviews)PerDay/);
  assert.doesNotMatch(html, /settings\.learning\.dailyTitle|setNewPerDay|setReviewsPerDay/);
  assert.match(scheduler, /const STUDY_QUEUE_BATCH_SIZE = 50;/);
  assert.match(scheduler, /const availableSlots = STUDY_QUEUE_BATCH_SIZE - studyQueueLength\(\);/);
  assert.match(scheduler, /refillStudyQueue\(now\);\s*renderStudy\(\);/);
  assert.doesNotMatch(scheduler, /\b(?:newPerDay|reviewsPerDay|introducedNewToday)\b/);
});

test("every study session shuffles new, learning, and review cards together", () => {
  const scheduler = read("js/scheduler.js");

  assert.match(scheduler, /function shuffleStudyCards\(cards\)/);
  assert.match(scheduler, /Math\.floor\(Math\.random\(\) \* \(index \+ 1\)\)/);
  assert.match(scheduler, /const eligibleCards = \[\];/);
  assert.match(scheduler, /isDueLearning \|\| isDueReview \|\| isNew/);
  assert.match(scheduler, /shuffleStudyCards\(eligibleCards\)\.slice\(0, availableSlots\)/);
  assert.doesNotMatch(scheduler, /dueLearning\.sort|dueReview\.sort|fresh\.sort/);
  assert.match(scheduler, /function startSession\([\s\S]*?refillStudyQueue\(Date\.now\(\)\)/);
});

test("deck counts expose all new and due cards without a daily-limit state", () => {
  const decks = read("js/decks.js");
  const study = read("js/study.js");

  assert.match(decks, /const shownNew = s\.new;/);
  assert.doesNotMatch(decks, /availableNewCards|decks\.status\.limit/);
  assert.doesNotMatch(study, /study\.empty\.limit/);
});

test("example refresh uses persisted enabled study categories", () => {
  const study = read("js/study.js");

  assert.match(
    study,
    /const queueSettings = state\.settings\.studyQueue \|\| \{[\s\S]*?\["new", "learning", "review"\]\.filter\(category => queueSettings\[category\] !== false\)/
  );
  assert.doesNotMatch(study, /#view-study > div\.study-stats/);
  assert.match(study, /enabledCategories\.has\(card\.state\)/);
});
