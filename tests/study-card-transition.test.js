const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("смена карточки запускается только после подтверждённого сохранения", () => {
  const study = read("js/study.js");

  const completedFlow = [
    "await saveAndFlush();",
    "await window.LCMotion?.transitionStudyCardOut();",
    '$(\"#streakDays\").textContent = state.streak.current || 0;',
    "next();",
    "window.LCMotion?.transitionStudyCardIn();",
  ];

  let cursor = 0;
  for (const step of completedFlow) {
    const index = study.indexOf(step, cursor);
    assert.notEqual(index, -1, `Не найден шаг перехода: ${step}`);
    cursor = index + step.length;
  }

  assert.match(
    study,
    /saveCurrentStudyCycle\(\);\s*await saveAndFlush\(\);\s*await window\.LCMotion\?\.transitionStudyCardOut\(\);\s*deferCurrentStudyCardVariant\(\);\s*next\(\);\s*window\.LCMotion\?\.transitionStudyCardIn\(\);/,
  );
});

test("motion-координатор предоставляет безопасный двухфазный API", () => {
  const motion = read("js/motion.js");

  assert.match(motion, /async function transitionStudyCardOut\(\)/);
  assert.match(motion, /function transitionStudyCardIn\(\)/);
  assert.match(motion, /stage\.setAttribute\("aria-busy", "true"\)/);
  assert.match(motion, /stage\.removeAttribute\("aria-busy"\)/);
  assert.match(motion, /window\.setTimeout\(finish, duration \+ 80\)/);
  assert.match(motion, /window\.LCMotion = Object\.freeze\(\{/);
  assert.match(motion, /if \(!stage \|\| !stage\.firstElementChild \|\| !motionAllowed\(\)\) return;/);
});

test("CSS создаёт проваливание на месте и вход с правой стороны", () => {
  const css = read("css/motion.css");

  assert.match(css, /\.card-stage\.motion-study-card-exit\s*\{/);
  assert.match(css, /@keyframes motion-study-card-exit[\s\S]*translate3d\(0, 11px, 0\) scale\(\.935\)/);
  assert.match(css, /\.card-stage\.motion-study-card-enter\s*\{/);
  assert.match(css, /@keyframes motion-study-card-enter[\s\S]*translate3d\(46px, 0, 0\) scale\(\.97\)/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*translate3d\(88px, 0, 0\) scale\(\.97\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("переход карточки не опирается на возможности новее Safari 15 (iPhone 7)", () => {
  const css = read("css/motion.css");
  const motion = read("js/motion.js");
  const exitFrames = css.match(/@keyframes motion-study-card-exit[\s\S]*?\n\}/)[0];
  const enterFrames = css.match(/@keyframes motion-study-card-enter[\s\S]*?\n\}/)[0];

  // `clamp()` внутри `translate3d()` и анимация `filter` вместе с трансформацией
  // заставляли старый WebKit отбрасывать кадры, и карточка менялась без движения.
  assert.doesNotMatch(enterFrames, /clamp\(/);
  assert.doesNotMatch(exitFrames, /filter:/);

  // Асинхронная прокрутка карточки на iOS перебивала анимацию слоя.
  assert.match(css, /\.card-stage\.motion-study-card-exit,\s*\n\.card-stage\.motion-study-card-enter \{\s*\n\s*-webkit-overflow-scrolling: auto;/);

  // Кольцо нажатия оценки исчезало целиком из-за неизвестного `color-mix()`.
  assert.match(css, /--motion-pulse-ring: rgba\(201, 100, 66, \.28\);/);
  assert.match(css, /@keyframes motion-grade-pulse\s*\{\s*\n\s*0% \{ box-shadow: 0 0 0 0 var\(--motion-pulse-ring\); \}/);

  // Старый WebKit присылает только префиксное событие завершения анимации.
  assert.match(motion, /element\.addEventListener\("webkitAnimationEnd", onAnimationEnd\)/);
  assert.match(motion, /element\.removeEventListener\("webkitAnimationEnd", onAnimationEnd\)/);
  // Без принудительного reflow снятие и установка класса сливаются в один пересчёт.
  assert.match(motion, /void stage\.offsetWidth;\s*\n\s*stage\.classList\.add\("motion-study-card-exit"\)/);
  assert.match(motion, /void stage\.offsetWidth;\s*\n\s*stage\.classList\.add\("motion-study-card-enter"\)/);
});

test("прогресс обновления примеров анимируется без @property и color-mix", () => {
  const css = read("css/polish.css");
  const study = read("js/study.js");

  // `transition: --example-progress` требует `@property` (Safari 16.4+),
  // поэтому кольцо интерполируется покадрово из JS.
  assert.doesNotMatch(css, /transition: --example-progress/);
  assert.match(study, /const EXAMPLE_RING_TWEEN_MS = 650;/);
  assert.match(study, /function tweenExampleRefreshRing\(button, fraction\)/);
  assert.match(study, /requestAnimationFrame\(step\)/);
  assert.match(study, /function cancelExampleRefreshRing\(\)/);
  assert.match(study, /tweenExampleRefreshRing\(sourceButton, updated \/ unique\.length\)/);
  assert.doesNotMatch(study, /style\.setProperty\("--example-progress", `\$\{\(updated/);
  // Пользовательская настройка «меньше движения» остаётся приоритетной.
  assert.match(study, /if \(prefersReducedMotion\(\)/);

  // Дорожка полосы пропадала без фолбэка к `color-mix()`, а внутри
  // прокручиваемой карточки iOS не перерисовывал её без своего слоя.
  const bar = css.match(/\.example-refresh-bar \{[\s\S]*?\n\}/)[0];
  assert.match(bar, /background: rgba\(47, 125, 91, \.18\);/);
  assert.match(bar, /transform: translateZ\(0\);/);
  // `--surface` в проекте не определён, счётчик оставался прозрачным.
  assert.match(css, /\.example-refresh-count \{[\s\S]*?background: var\(--panel\);/);
  assert.doesNotMatch(css, /background: var\(--surface\)/);
});

test("шимы старого WebKit загружаются раньше кода приложения", () => {
  const themeInit = read("theme-init.js");
  const html = read("index.html");

  assert.match(themeInit, /if \(typeof globalThis\.structuredClone !== "function"\)/);
  assert.match(themeInit, /if \(typeof Array\.prototype\.at !== "function"\)/);
  // Порядок важен: state.js и ui.js используют эти API на старте.
  assert.ok(html.indexOf("theme-init.js") < html.indexOf("js/state.js"));
});