#!/usr/bin/env node
// Wraps every CSS rule with a :hover selector into @media (hover: hover), so
// touch devices (iOS Safari keeps :hover "stuck" after a tap) never paint hover
// backgrounds. Mixed selector lists are split: non-hover selectors stay as is.
// Idempotent. Usage: node tools/fix-hover.mjs  (guard: tests/hover-guard.test.js)
import fs from "node:fs";
import path from "node:path";

const GUARD = "@media (hover: hover)";
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../css");

function splitSelectors(sel) {
  const out = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

export function transform(css) {
  let out = "", i = 0;
  const guardStack = [];
  // Simple tokenizer: walk rules, track at-rule blocks.
  const stack = []; // each: {guard:boolean}
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); const end = e < 0 ? css.length : e + 2; out += css.slice(i, end); i = end; continue; }
    const ch = css[i];
    if (ch === "}") { stack.pop(); out += ch; i++; continue; }
    if (/\s/.test(ch)) { out += ch; i++; continue; }
    // read prelude up to { or ; (skipping comments/strings)
    let j = i, prelude = "";
    while (j < css.length && css[j] !== "{" && css[j] !== ";" && css[j] !== "}") {
      if (css.startsWith("/*", j)) { const e = css.indexOf("*/", j + 2); j = e < 0 ? css.length : e + 2; continue; }
      prelude += css[j]; j++;
    }
    if (css[j] !== "{") { out += css.slice(i, j + (css[j] === ";" ? 1 : 0)); i = j + (css[j] === ";" ? 1 : 0); continue; }
    const pre = prelude.trim();
    if (pre.startsWith("@")) {
      const isGuard = /^@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(pre);
      const isKeyframes = /^@(-webkit-)?keyframes/.test(pre);
      stack.push({ guard: isGuard, raw: isKeyframes });
      out += css.slice(i, j + 1); i = j + 1;
      if (isKeyframes) { // copy verbatim
        let d = 1, k = i;
        while (k < css.length && d) { if (css[k] === "{") d++; else if (css[k] === "}") d--; k++; }
        out += css.slice(i, k - 1); i = k - 1;
      }
      continue;
    }
    // style rule: find matching }
    let d = 1, k = j + 1;
    while (k < css.length && d) {
      if (css.startsWith("/*", k)) { const e = css.indexOf("*/", k + 2); k = e < 0 ? css.length : e + 2; continue; }
      if (css[k] === "{") d++; else if (css[k] === "}") d--; k++;
    }
    const body = css.slice(j, k); // "{...}"
    const guarded = stack.some(s => s.guard);
    // Reset rules (background none/transparent) are harmless on touch: keep them.
    const isReset = /background(-color)?:\s*(none|transparent)/.test(body);
    if (!guarded && !isReset && /:hover\b/.test(pre)) {
      const sels = splitSelectors(pre);
      const hover = sels.filter(s => /:hover\b/.test(s));
      const rest = sels.filter(s => !/:hover\b/.test(s));
      const lead = css.slice(i, i + prelude.search(/\S/)); // leading ws (none)
      let rep = "";
      if (rest.length) rep += rest.join(",\n") + " " + body + "\n";
      rep += `${GUARD} {\n${hover.join(",\n")} ${body}\n}`;
      out += lead + rep;
    } else out += css.slice(i, k);
    i = k;
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".css"))) {
    const p = path.join(dir, f), src = fs.readFileSync(p, "utf8"), res = transform(src);
    if (res !== src) { fs.writeFileSync(p, res); console.log("fixed", f); }
  }
}
