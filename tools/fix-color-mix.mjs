#!/usr/bin/env node
/*
 * Приводит все color-mix() в css/*.css к схеме, безопасной для Safari 15 (iPhone 7):
 *   правило {  prop: <фолбэк без color-mix>;  }
 *   @supports (color: color-mix(in srgb, red 50%, blue)) { правило { prop: color-mix(...); } }
 * Каскадный фолбэк «prop: a; prop: color-mix(var(--x) ...)» в Safari 15 НЕ работает:
 * значение с var() принимается при разборе и становится unset при вычислении.
 * Скрипт идемпотентен: правила внутри @supports с color-mix не трогаются.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SUPPORTS = "@supports (color: color-mix(in srgb, red 50%, blue))";
const SOFT = { "--accent": "--accent-soft", "--bad": "--bad-soft", "--good": "--good-soft", "--warn": "--warn-soft", "--new": "--new-soft" };

function splitArgs(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseStop(s) {
  const m = s.match(/^(.*?)\s+(\d+(?:\.\d+)?)%$/);
  return m ? { color: m[1].trim(), pct: +m[2] } : { color: s.trim(), pct: null };
}

/** Подбор цвета без color-mix для одного вызова. */
function fallbackOf(args, prop) {
  const [, a, b] = args;
  const A = parseStop(a), B = parseStop(b);
  const pa = A.pct ?? (B.pct != null ? 100 - B.pct : 50);
  const isTransparent = B.color === "transparent";
  if (isTransparent) {
    if (pa >= 50) return A.color;
    const v = A.color.match(/^var\((--[\w-]+)\)$/);
    if (v && SOFT[v[1]]) return `var(${SOFT[v[1]]})`;
    if (/^border/.test(prop)) return "var(--border)";
    return "transparent";
  }
  return pa >= 50 ? A.color : B.color;
}

export function replaceMixes(value, prop) {
  let out = "", i = 0;
  while (true) {
    const k = value.indexOf("color-mix(", i);
    if (k < 0) return out + value.slice(i);
    let depth = 0, j = k + "color-mix".length;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    const inner = value.slice(k + "color-mix(".length, j);
    out += value.slice(i, k) + replaceMixes(fallbackOf(splitArgs(inner), prop), prop);
    i = j + 1;
  }
}

function splitDecls(body) {
  const out = []; let depth = 0, cur = "", inComment = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (!inComment && ch === "/" && body[i + 1] === "*") inComment = true;
    if (inComment) { cur += ch; if (ch === "/" && body[i - 1] === "*" && cur.trimEnd().length > 2) inComment = false; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    cur += ch;
    if (ch === ";" && depth === 0) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function declOf(raw) {
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = text.match(/^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*;?\s*$/);
  return m ? { prop: m[1], value: m[2] } : null;
}

/** Обрабатывает тело блока (список правил). */
function processBlock(src, insideSupportsMix) {
  let out = "", i = 0;
  while (i < src.length) {
    if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2) + 2; out += src.slice(i, e); i = e; continue; }
    const open = src.indexOf("{", i);
    if (open < 0) { out += src.slice(i); break; }
    const commentBefore = src.indexOf("/*", i);
    if (commentBefore >= 0 && commentBefore < open) { out += src.slice(i, commentBefore); i = commentBefore; continue; }
    let depth = 0, close = open;
    for (; close < src.length; close++) {
      if (src.startsWith("/*", close)) { close = src.indexOf("*/", close + 2) + 1; continue; }
      if (src[close] === "{") depth++;
      else if (src[close] === "}" && --depth === 0) break;
    }
    const head = src.slice(i, open), body = src.slice(open + 1, close);
    const selector = head.trim();
    if (selector.startsWith("@")) {
      const isMixSupports = /^@supports\s*\(\s*[\w-]+\s*:\s*color-mix/.test(selector);
      const isNot = /^@supports\s+not/.test(selector);
      const nested = /^@(media|supports|layer|container)/.test(selector)
        ? processBlock(body, insideSupportsMix || isMixSupports || isNot) : body;
      out += head + "{" + nested + "}";
    } else if (insideSupportsMix || !body.replace(/\/\*[\s\S]*?\*\//g, "").includes("color-mix(")) {
      out += head + "{" + body + "}";
    } else {
      const decls = splitDecls(body), keep = [], moved = [];
      decls.forEach((raw, idx) => {
        const d = declOf(raw);
        if (!d || !d.value.includes("color-mix(")) { keep.push(raw); return; }
        moved.push(`${d.prop}: ${d.value};`);
        const prev = keep.length ? declOf(keep[keep.length - 1]) : null;
        const hasFallback = prev && prev.prop === d.prop && !prev.value.includes("color-mix(");
        const lead = raw.match(/^\s*/)[0];
        if (!hasFallback && !d.prop.startsWith("--")) keep.push(`${lead}${d.prop}: ${replaceMixes(d.value, d.prop)};`);
        else if (!hasFallback) keep.push(`${lead}${d.prop}: ${replaceMixes(d.value, d.prop)};`);
        else if (/\n/.test(lead)) keep.push(lead.replace(/[ \t]+$/, "") ? "" : "");
      });
      const indent = (head.match(/\n([ \t]*)[^\n]*$/) || head.match(/^([ \t]*)/) || ["", ""])[1];
      out += head + "{" + keep.join("") + (body.match(/\s*$/)[0]) + "}";
      if (moved.length) out += `\n${indent}${SUPPORTS} {\n${indent}  ${selector.replace(/\s*\n\s*/g, " ")} { ${moved.join(" ")} }\n${indent}}`;
    }
    i = close + 1;
  }
  return out;
}

export function fixCss(css) { return processBlock(css, false); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.resolve("css");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const p = path.join(dir, f), src = readFileSync(p, "utf8"), next = fixCss(src);
    if (next !== src) { writeFileSync(p, next); console.log("fixed", f); }
  }
}
