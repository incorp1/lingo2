/* ========================================================================
   tooltips.js — Mobile info-tip system
   ------------------------------------------------------------------------
   On small screens, long descriptions (.block-desc and .row-hint) eat a lot
   of vertical space and make the Settings screen hard to scan. This module
   collapses each description into a small "i" icon next to its title; tapping
   the icon shows the text in a floating bubble.

   Design goals (kept deliberately self-contained / plug-in style):
   - Zero dependencies, no framework. One public function: window.initTooltips.
   - Pure progressive enhancement: on desktop nothing changes (CSS keeps the
     descriptions visible and hides the icons).
   - Idempotent: safe to call repeatedly (e.g. after each settings re-render).
   - Single floating bubble reused for every tip; closes on outside tap / scroll
     / Escape, and repositions itself to stay inside the viewport.
   ======================================================================== */
(function () {
  "use strict";

  var BUBBLE_ID = "infoTipBubble";
  var ICON_FLAG = "data-tip-bound";

  /* Inline SVG for the round "i" icon. */
  var ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>' +
    '<path d="M12 8h.01"/></svg>';

  function getBubble() {
    var b = document.getElementById(BUBBLE_ID);
    if (!b) {
      b = document.createElement("div");
      b.id = BUBBLE_ID;
      b.className = "info-tip-bubble";
      b.setAttribute("role", "tooltip");
      b.hidden = true;
      document.body.appendChild(b);
    }
    return b;
  }

  var activeIcon = null;

  function labelIcon(icon) {
    icon.setAttribute("aria-label", typeof window.t === "function"
      ? window.t("a11y.moreInformation")
      : "More information");
  }

  function hideBubble(options) {
    var icon = activeIcon;
    var b = document.getElementById(BUBBLE_ID);
    if (b) b.hidden = true;
    if (icon) {
      icon.classList.remove("info-tip-icon--open");
      icon.setAttribute("aria-expanded", "false");
    }
    activeIcon = null;
    if (options && options.restoreFocus && icon && icon.isConnected) {
      icon.focus({ preventScroll: true });
    }
  }

  function showBubble(icon, text) {
    var b = getBubble();
    b.textContent = "";
    text.split(/\n{2,}/).forEach(function (paragraph) {
      var p = document.createElement("p");
      p.textContent = paragraph.trim();
      b.appendChild(p);
    });
    b.hidden = false;
    var pad = 10;
    var r = icon.getBoundingClientRect();
    var bw = Math.min(b.offsetWidth || 260, window.innerWidth - pad * 2);
    b.style.maxWidth = bw + "px";
    var bh = b.offsetHeight || 60;

    var left = r.left + r.width / 2 - bw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - bw - pad));

    var top = r.bottom + 8;
    if (top + bh > window.innerHeight - pad) {
      var above = r.top - bh - 8;
      if (above >= pad) top = above;
    }
    b.style.left = left + "px";
    b.style.top = top + "px";

    if (activeIcon && activeIcon !== icon) {
      activeIcon.classList.remove("info-tip-icon--open");
      activeIcon.setAttribute("aria-expanded", "false");
    }
    activeIcon = icon;
    icon.classList.add("info-tip-icon--open");
    icon.setAttribute("aria-expanded", "true");
  }

  function toggle(icon, text) {
    if (activeIcon === icon) { hideBubble({ restoreFocus: true }); return; }
    showBubble(icon, text);
  }

  function makeIcon(sourceEl) {
    var icon = document.createElement("button");
    icon.type = "button";
    icon.className = "info-tip-icon";
    icon.setAttribute("data-i18n-aria-label", "a11y.moreInformation");
    labelIcon(icon);
    icon.setAttribute("aria-expanded", "false");
    icon.setAttribute("aria-controls", BUBBLE_ID);
    icon.innerHTML = ICON_SVG;
    icon.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var text = (sourceEl.textContent || "").trim();
      if (text) toggle(icon, text);
    });
    return icon;
  }

  function bindBlockDesc(desc) {
    var heading = desc.closest(".block-heading");
    var title = heading && heading.querySelector("h3");
    var anchor = title || desc.parentElement;
    if (!anchor) return;
    if (anchor.querySelector(":scope > .info-tip-wrap")) return;
    var wrap = document.createElement("span");
    wrap.className = "info-tip-wrap";
    var lastText = Array.prototype.slice.call(anchor.childNodes).reverse().find(function (node) {
      return node.nodeType === 3 && (node.textContent || "").trim();
    });
    if (lastText) {
      var words = (lastText.textContent || "").trim().split(/\s+/);
      var lastWord = words.pop();
      lastText.textContent = words.length ? words.join(" ") + " " : "";
      var word = document.createElement("span");
      word.textContent = lastWord;
      wrap.appendChild(word);
    }
    var icon = makeIcon(desc);
    icon.classList.add("info-tip-icon--inline");
    wrap.appendChild(icon);
    anchor.insertBefore(wrap, anchor.querySelector(":scope > .chevron"));
    desc.setAttribute(ICON_FLAG, "1");
  }

  function findTextAnchor(sourceEl) {
    var container = sourceEl && sourceEl.parentElement;
    if (!container) return null;
    return container.querySelector(":scope > label, :scope > .stepper-label, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > .row-title, :scope > .setting-label") ||
      Array.prototype.find.call(container.children, function (child) {
        return child !== sourceEl && !child.matches("input, select, textarea, button, .row-hint, .block-desc");
      }) ||
      container;
  }

  function bindRowHint(hint) {
    var anchor = findTextAnchor(hint);
    if (!anchor) return;
    if (anchor.querySelector(":scope > .info-tip-wrap")) return;
    var wrap = document.createElement("span");
    wrap.className = "info-tip-wrap";
    var lastText = Array.prototype.slice.call(anchor.childNodes).reverse().find(function (node) {
      return node.nodeType === 3 && (node.textContent || "").trim();
    });
    if (lastText) {
      var words = (lastText.textContent || "").trim().split(/\s+/);
      var lastWord = words.pop();
      lastText.textContent = words.length ? words.join(" ") + " " : "";
      var word = document.createElement("span");
      word.textContent = lastWord;
      wrap.appendChild(word);
    }
    var icon = makeIcon(hint);
    icon.classList.add("info-tip-icon--inline");
    wrap.appendChild(icon);
    anchor.appendChild(wrap);
    hint.setAttribute(ICON_FLAG, "1");
  }

  function initTooltips(root) {
    root = root || document;
    getBubble();
    var descs = root.querySelectorAll(".block-desc.js-tooltip, #settings-learning .block-desc");
    for (var i = 0; i < descs.length; i++) bindBlockDesc(descs[i]);
    var hints = root.querySelectorAll(".row-hint.js-tooltip, #settings-learning .row-hint");
    for (var j = 0; j < hints.length; j++) bindRowHint(hints[j]);
    var icons = root.querySelectorAll(".info-tip-icon");
    for (var k = 0; k < icons.length; k++) labelIcon(icons[k]);
  }

  document.addEventListener("click", function (e) {
    if (!activeIcon) return;
    var b = document.getElementById(BUBBLE_ID);
    if (e.target.closest(".info-tip-icon") || (b && b.contains(e.target))) return;
    hideBubble({ restoreFocus: true });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && activeIcon) {
      e.preventDefault();
      hideBubble({ restoreFocus: true });
    }
  });
  window.addEventListener("scroll", function () { hideBubble(); }, true);
  window.addEventListener("resize", function () { hideBubble(); });

  window.initTooltips = initTooltips;
})();
