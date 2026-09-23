/* Совместимость со старым WebKit: iPhone 7 обновляется максимум до iOS 15,
   где нет `structuredClone` (Safari 16) и `Array.prototype.at` (Safari 15.4).
   Шимы объявлены здесь, потому что этот файл подключается первым, до всех
   остальных скриптов приложения. */
(() => {
  if (typeof globalThis.structuredClone !== "function") {
    globalThis.structuredClone = value => (
      value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    );
  }
  if (typeof Array.prototype.at !== "function") {
    Object.defineProperty(Array.prototype, "at", {
      value(index) {
        const offset = Math.trunc(Number(index) || 0);
        return this[offset < 0 ? this.length + offset : offset];
      },
      writable: true,
      configurable: true,
    });
  }
})();

(() => {
  const valid = new Set(["light", "dark", "auto"]);
  let preference = "auto";
  try {
    const saved = localStorage.getItem("lingo-theme");
    if (valid.has(saved)) preference = saved;
  } catch (error) {}
  const resolved = preference === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#1E1D1B" : "#C96442");
})();

/* Модальность ввода: рамка фокуса только при работе с клавиатуры (Safari 15 без :focus-visible). */
(function () {
  var root = document.documentElement;
  root.classList.add("pointer-input");
  function pointer() { root.classList.add("pointer-input"); }
  function key(e) { if (e.key === "Tab" || e.key.indexOf("Arrow") === 0) root.classList.remove("pointer-input"); }
  ["pointerdown", "touchstart", "mousedown"].forEach(function (t) { document.addEventListener(t, pointer, { capture: true, passive: true }); });
  document.addEventListener("keydown", key, true);
})();
