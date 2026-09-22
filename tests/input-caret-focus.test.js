/* Регрессия: первый ввод с экранной клавиатуры терялся.
 *
 * Симптом: тап по полю -> клавиатура открылась -> набираемый текст не
 * появляется, пока не тапнуть по полю второй раз.
 *
 * Причина: глобальные слушатели lookup-жеста в `js/selection.js`
 * (touchstart / pointerdown / click / scroll — все в capture-фазе) звали
 * `clearLookupSelection()`, который безусловно выполнял
 * `window.getSelection().removeAllRanges()`. В WebKit каретка внутри
 * <input>/<textarea> живёт в том же объекте Selection, что и выделение
 * документа, поэтому сброс диапазонов убивал каретку только что
 * сфокусированного поля. Открытие клавиатуры дополнительно генерирует
 * scroll, так что сброс происходил гарантированно.
 *
 * Тест закрепляет контракт: снимать выделение документа можно только через
 * `clearDocumentSelection()`, и он обязан пропускать ход, когда каретка
 * находится в редактируемом поле.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(root, "js/selection.js"), "utf8");

/* --- статические проверки контракта ------------------------------------ */

test("clearLookupSelection не снимает выделение напрямую", () => {
  const body = SOURCE.match(/function clearLookupSelection[\s\S]*?\n}/)?.[0];
  assert.ok(body, "функция clearLookupSelection не найдена");
  assert.ok(
    !/removeAllRanges/.test(body),
    "clearLookupSelection снова снимает выделение напрямую — используй clearDocumentSelection()",
  );
  assert.match(body, /clearDocumentSelection\(\)/);
});

test("removeAllRanges вызывается только внутри clearDocumentSelection", () => {
  // Комментарии не считаем: там имя функции упоминается как объяснение.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const calls = code.match(/removeAllRanges/g) || [];
  assert.equal(calls.length, 1, "снятие выделения должно быть в одной точке");
  const guard = code.match(/function clearDocumentSelection[\s\S]*?\n}/)?.[0];
  assert.ok(guard, "функция clearDocumentSelection не найдена");
  assert.match(guard, /removeAllRanges/);
  assert.match(guard, /selectionTouchesEditable\(\)/);
});

test("lookupZoneAt игнорирует редактируемые поля", () => {
  const body = SOURCE.match(/function lookupZoneAt[\s\S]*?\n}/)?.[0];
  assert.ok(body);
  assert.match(body, /isEditableTarget\(target\)/);
});

/* --- поведенческие проверки через VM ------------------------------------ */

function loadGuards({ activeElement, selectionNode }) {
  const removed = { count: 0 };
  const selection = {
    rangeCount: selectionNode ? 1 : 0,
    anchorNode: selectionNode || null,
    focusNode: selectionNode || null,
    removeAllRanges() { removed.count++; },
  };
  const context = {
    document: { activeElement },
    window: { getSelection: () => selection },
  };
  context.globalThis = context;
  vm.createContext(context);
  const guards = SOURCE
    .match(/const EDITABLE_SELECTOR[\s\S]*?function clearDocumentSelection[\s\S]*?\n}/)[0];
  vm.runInContext(
    `${guards}\nthis.__api = { isEditableTarget, selectionTouchesEditable, clearDocumentSelection };`,
    context,
  );
  return { api: context.__api, removed };
}

// Минимальная имитация DOM-узла с рабочим closest().
function element(selectorMatches, parent = null) {
  const node = {
    nodeType: 1,
    parent,
    matches: sel => selectorMatches.some(item => sel.includes(item)),
  };
  node.closest = sel => {
    let current = node;
    while (current) {
      if (current.matches(sel)) return current;
      current = current.parent;
    }
    return null;
  };
  return node;
}

test("каретка в input переживает сброс выделения", () => {
  const input = element(["input"]);
  const { api, removed } = loadGuards({ activeElement: input, selectionNode: input });
  assert.equal(api.isEditableTarget(input), true);
  assert.equal(api.selectionTouchesEditable(), true);
  api.clearDocumentSelection();
  assert.equal(removed.count, 0, "выделение поля ввода не должно сбрасываться");
});

test("каретка в textarea внутри модалки тоже защищена", () => {
  const textarea = element(["textarea"]);
  const textNode = { nodeType: 3, parentElement: textarea };
  const { api, removed } = loadGuards({ activeElement: textarea, selectionNode: textNode });
  api.clearDocumentSelection();
  assert.equal(removed.count, 0);
});

test("обычный текст карточки по-прежнему очищается", () => {
  const card = element([".card-front"]);
  const { api, removed } = loadGuards({ activeElement: null, selectionNode: card });
  assert.equal(api.isEditableTarget(card), false);
  api.clearDocumentSelection();
  assert.equal(removed.count, 1, "выделение вне полей ввода должно сниматься");
});
