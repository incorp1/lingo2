/* Lingo Cards — translation runtime */
window.I18N = window.I18N || {};

/* Active language and lookup. Default: uk. */
window.I18N_LANG = "uk";

window.t = function (key, vars) {
  const dict = window.I18N[window.I18N_LANG] || window.I18N.en;
  let s = dict[key];
  if (s == null) s = (window.I18N.en[key] != null ? window.I18N.en[key] : key);
  if (vars) for (const k in vars) s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
  return s;
};

/* Apply translations to all elements with data-i18n / data-i18n-ph / data-i18n-title. */
window.applyI18N = function (root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = window.t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = window.t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.setAttribute("placeholder", window.t(el.getAttribute("data-i18n-ph")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.setAttribute("title", window.t(el.getAttribute("data-i18n-title")));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", window.t(el.getAttribute("data-i18n-aria-label")));
  });
  document.documentElement.setAttribute("lang", window.I18N_LANG);
  // Re-attach mobile info-tip icons: rewriting [data-i18n] textContent above
  // removes any icon injected inside translated <h3>/<label> elements.
  if (typeof window.initTooltips === "function") {
    window.initTooltips(document.getElementById("view-settings") || document);
  }
};
