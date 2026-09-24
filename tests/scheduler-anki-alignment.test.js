const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const schedulerSource = fs.readFileSync(path.join(root, "js/scheduler.js"), "utf8");

function loadScheduler(settings = {}) {
  const context = {
    console,
    structuredClone: global.structuredClone,
    Date,
    Math: Object.create(Math),
    Number,
    Object,
    Array,
    Set,
    Map,
    JSON,
    isFinite,
    state: {
      settings: {
        learnSteps: [1, 10],
        graduatingInterval: 1,
        easyInterval: 4,
        startingEase: 250,
        easyBonus: 130,
        hardFactor: 120,
        intervalModifier: 100,
        lapseNewInterval: 0,
        lapseEasePenalty: 20,
        hardEasePenalty: 15,
        easyEaseBoost: 15,
        ...settings,
      },
      history: {},
      streak: {},
    },
    DAY_MS: 86400000,
    window: {},
    document: {},
  };
  vm.createContext(context);
  vm.runInContext(schedulerSource, context, { filename: "scheduler.js" });
  return context;
}

function card(overrides = {}) {
  return {
    id: "card-1",
    state: "new",
    step: 0,
    ease: 250,
    interval: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    ...overrides,
  };
}

test("Good последовательно проходит все learning steps и затем выпускает карточку", () => {
  const runtime = loadScheduler({ learnSteps: [1, 10, 30], graduatingInterval: 2 });
  const value = card();

  runtime.scheduleAnswerSM2(value, 2);
  assert.equal(value.state, "learning");
  assert.equal(value.step, 1);
  assert.ok(value.due - Date.now() > 9 * 60000);

  runtime.scheduleAnswerSM2(value, 2);
  assert.equal(value.state, "learning");
  assert.equal(value.step, 2);
  assert.ok(value.due - Date.now() > 29 * 60000);

  runtime.scheduleAnswerSM2(value, 2);
  assert.equal(value.state, "review");
  assert.equal(value.interval, 2);
});

test("Again возвращает на первый шаг, Hard повторяет текущий шаг, а на первом шаге усредняет первые два", () => {
  const runtime = loadScheduler({ learnSteps: [1, 10, 30] });
  const value = card({ state: "learning", step: 1 });

  runtime.scheduleAnswerSM2(value, 1);
  assert.equal(value.step, 1);
  const hardMinutes = (value.due - Date.now()) / 60000;
  assert.ok(hardMinutes > 9.9 && hardMinutes <= 10);

  runtime.scheduleAnswerSM2(value, 0);
  assert.equal(value.step, 0);
  const againMinutes = (value.due - Date.now()) / 60000;
  assert.ok(againMinutes > 0.9 && againMinutes <= 1);

  const fresh = card({ state: "new" });
  runtime.scheduleAnswerSM2(fresh, 1);
  const firstHardMinutes = (fresh.due - Date.now()) / 60000;
  assert.ok(firstHardMinutes > 5.4 && firstHardMinutes <= 5.5);
});

test("hardLearningDelayMs: first-step average, later-step repeat, single step at 1.5×", () => {
  const runtime = loadScheduler();

  assert.equal(runtime.hardLearningDelayMs([1, 10, 30], 0), 5.5 * 60000);
  assert.equal(runtime.hardLearningDelayMs([1, 10, 30], 1), 10 * 60000);
  assert.equal(runtime.hardLearningDelayMs([1, 10, 30], 2), 30 * 60000);
  assert.equal(runtime.hardLearningDelayMs([10], 0), 15 * 60000);
  const value = card({ state: "learning" });
  const oneStep = loadScheduler({ learnSteps: [10] });
  oneStep.scheduleAnswerSM2(value, 1);
  assert.ok((value.due - Date.now()) / 60000 > 14.9);
  assert.equal(oneStep.previewIntervals(value).hard, "15m");
});

test("Easy review рассчитывает интервал по прежнему Ease и лишь затем повышает Ease", () => {
  const runtime = loadScheduler();
  runtime.Math.random = () => 0.5;
  const value = card({ state: "review", interval: 10, ease: 250 });

  runtime.scheduleAnswerSM2(value, 3);

  assert.equal(value.interval, 33);
  assert.equal(value.ease, 265);
});

test("Easy на learning-карточке сразу выпускает её на Easy Interval", () => {
  const runtime = loadScheduler({ easyInterval: 4 });
  const value = card({ state: "learning", step: 0 });

  runtime.scheduleAnswerSM2(value, 3);

  assert.equal(value.state, "review");
  assert.equal(value.interval, 4);
  assert.equal(value.ease, 265);
});

test("fuzz не меняет интервалы до двух дней и остаётся в допустимом диапазоне", () => {
  const runtime = loadScheduler();

  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.sm2FuzzRange(2))),
    { min: 2, max: 2 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.sm2FuzzRange(10))),
    { min: 8, max: 12 },
  );
  assert.equal(runtime.fuzzSm2Interval(10, () => 0), 8);
  assert.equal(runtime.fuzzSm2Interval(10, () => 0.999999), 12);
});

test("preview learning-карточки отражает последовательные шаги и Easy Interval", () => {
  const runtime = loadScheduler({ learnSteps: [1, 10], graduatingInterval: 1, easyInterval: 4 });
  const value = card({ state: "learning", step: 0 });

  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.previewIntervals(value))),
    { again: "1m", hard: "6m", good: "10m", easy: "4d" },
  );

  value.step = 1;
  assert.equal(runtime.previewIntervals(value).good, "1d");
});

test("forgotten SM-2 review card relearns before retaining its reduced interval", () => {
  for (const retainedPercent of [0, 25]) {
    const runtime = loadScheduler({ relearnSteps: [10, 30], lapseNewInterval: retainedPercent });
    runtime.Math.random = () => 0.5;
    const value = card({ state: "review", interval: 20, ease: 250 });
    runtime.scheduleAnswerSM2(value, 0);
    assert.equal(value.state, "learning");
    assert.equal(value.step, 0);
    assert.equal(value.lapses, 1);
    assert.equal(value.ease, 230);
    assert.equal(value.relearnInterval, retainedPercent ? 5 : 1);
    assert.ok((value.due - Date.now()) / 60000 > 9.9);
    assert.equal(runtime.previewIntervals(value).good, "30m");
    runtime.scheduleAnswerSM2(value, 1);
    assert.equal(value.step, 0);
    assert.ok((value.due - Date.now()) / 60000 > 19.9);
    runtime.scheduleAnswerSM2(value, 2);
    assert.equal(value.step, 1);
    assert.ok((value.due - Date.now()) / 60000 > 29.9);
    assert.equal(runtime.previewIntervals(value).good, `${retainedPercent ? 5 : 1}d`);
    runtime.scheduleAnswerSM2(value, 2);
    assert.equal(value.state, "review");
    assert.equal(value.interval, retainedPercent ? 5 : 1);
    assert.equal(value.relearnInterval, undefined);
  }
});

test("Hard remains strictly shorter than Good across fuzz and the interval cap", () => {
  for (const interval of [1, 2, 5, 10, 30, 100, 1824, 1825, 3000]) {
    for (const intervalModifier of [10, 100, 300]) {
      for (const hardFactor of [120, 500]) {
        const runtime = loadScheduler({ intervalModifier, hardFactor });
        const base = card({ state: "review", interval, ease: 130 });
        const good = [];
        const hard = [];
        for (const random of [0, 0.999999]) {
          runtime.Math.random = () => random;
          const goodCard = { ...base };
          const hardCard = { ...base };
          runtime.scheduleAnswerSM2(goodCard, 2);
          runtime.scheduleAnswerSM2(hardCard, 1);
          good.push(goodCard.interval);
          hard.push(hardCard.interval);
        }
        assert.ok(Math.max(...hard) < Math.min(...good),
          `Hard must precede Good for interval=${interval}, modifier=${intervalModifier}, factor=${hardFactor}`);
      }
    }
  }
});

test("старые per-button настройки мигрируют в последовательность без часового Easy", () => {
  const runtime = loadScheduler();
  const settings = {
    studyQueue: {},
    learnSteps: [1, 10],
    easyInterval: 4,
    newCardSteps: {
      again: { v: 2, u: "m" },
      hard: { v: 7, u: "m" },
      good: { v: 15, u: "m" },
      easy: { v: 4, u: "h" },
    },
  };

  runtime.migrateSchedulingSettings(settings);

  assert.deepEqual(Array.from(settings.learnSteps), [2, 15]);
  assert.equal(settings.easyInterval, 4);
  assert.equal(settings.newCardSteps, undefined);
});