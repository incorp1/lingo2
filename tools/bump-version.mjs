#!/usr/bin/env node
/* Единая точка версионирования PWA.
 *
 * Причина существования: файл `index.html` и регистрация `sw.js?v=...`
 * ссылались на версию `3.20.8`, которую забывали поднимать вручную. Тело
 * `sw.js` при этом не менялось байт-в-байт, браузер считал worker идентичным
 * и не запускал install/activate, поэтому установленное PWA бесконечно
 * отдавало старые CSS/JS из кэша, хотя в обычном браузере всё было свежим.
 *
 * Скрипт проставляет одну и ту же версию во все `?v=` ссылки, в имя кэша
 * `CACHE` и в `SERVICE_WORKER_URL`. Любое изменение версии гарантированно
 * меняет байты `sw.js`, а значит обновление доезжает до установленного PWA.
 *
 * Использование:
 *   node tools/bump-version.mjs            # патч-версия +1
 *   node tools/bump-version.mjs 3.21.0     # явная версия
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = path.join(ROOT, "VERSION");
// Файлы, в которых встречаются версионированные ссылки на ассеты.
const TARGETS = ["index.html", "sw.js", "js/stats.js"];
const VERSION_RE = /\d+\.\d+\.\d+/;

async function readCurrentVersion() {
  try {
    const raw = (await readFile(VERSION_FILE, "utf8")).trim();
    if (VERSION_RE.test(raw)) return raw;
  } catch {}
  // Первый запуск: берём версию из уже существующей ссылки в index.html.
  const html = await readFile(path.join(ROOT, "index.html"), "utf8");
  return html.match(/\?v=(\d+\.\d+\.\d+)/)?.[1] || "1.0.0";
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

async function main() {
  const explicit = process.argv[2];
  if (explicit && !/^\d+\.\d+\.\d+$/.test(explicit)) {
    console.error(`Некорректная версия: ${explicit}. Ожидается формат X.Y.Z.`);
    process.exit(1);
  }
  const current = await readCurrentVersion();
  const next = explicit || bumpPatch(current);

  for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    const source = await readFile(file, "utf8");
    const updated = source
      .replace(/\?v=\d+\.\d+\.\d+/g, `?v=${next}`)
      .replace(/(const CACHE = "lingo-cards-v)\d+\.\d+\.\d+(")/, `$1${next}$2`)
      // Видимый пользователю номер версии в настройках раньше оставался
      // захардкоженным (v3.20.8), поэтому по экрану было невозможно понять,
      // обновилось ли установленное PWA на самом деле.
      .replace(/(<span class="app-build-version">v)\d+\.\d+\.\d+(<\/span>)/, `$1${next}$2`);
    if (updated !== source) await writeFile(file, updated);
  }

  // package.json / package-lock.json — тоже часть релизных метаданных.
  // Раньше скрипт их не трогал, поэтому после каждого автоподъёма версия
  // ассетов уезжала вперёд, а `package.json` оставался на старой. Тесты
  // (offline-startup, p46-p60-regression, settings-redesign и др.) выводят
  // ожидаемую версию именно из `package.json`, и весь релизный набор падал.
  await bumpPackageManifests(next);

  await writeFile(VERSION_FILE, `${next}\n`);
  console.log(`Версия обновлена: ${current} -> ${next}`);
}

/* Обновляет версию в package.json и обоих местах package-lock.json,
   сохраняя форматирование файлов (отступ в 2 пробела + перевод строки). */
async function bumpPackageManifests(next) {
  const pkgFile = path.join(ROOT, "package.json");
  const pkg = JSON.parse(await readFile(pkgFile, "utf8"));
  if (pkg.version !== next) {
    pkg.version = next;
    await writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const lockFile = path.join(ROOT, "package-lock.json");
  let lockRaw;
  try {
    lockRaw = await readFile(lockFile, "utf8");
  } catch {
    return; // lock-файла может не быть — это не повод падать.
  }
  const lock = JSON.parse(lockRaw);
  let changed = false;
  if (lock.version !== next) { lock.version = next; changed = true; }
  if (lock.packages?.[""] && lock.packages[""].version !== next) {
    lock.packages[""].version = next;
    changed = true;
  }
  if (changed) await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
