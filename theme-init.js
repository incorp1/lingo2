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
