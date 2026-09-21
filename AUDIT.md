# AUDIT.md — аудит реализации `TASK_PLAN.md` (ветка `feat/multiple-learning-languages`)

Аудит статический и поведенческий, без изменений кода приложения.
Базовая проверка: `npm test` — 223/223 тестов проходят; `APP_SHELL` содержит 46 ресурсов, отсутствующих нет; версии URL в `index.html` и `sw.js` совпадают (3.20.0).

Ниже перечислены только найденные проблемы.

---

## 1. Миграция языковой модели не выполняется в рантайме (критично)

**Файл и участок**
- `js/state.js:781` — `function normalizeLanguageModel(loaded)`
- `js/state.js:891` — `normalizeLoadedState(loaded)`
- `js/state.js:929`, `js/state.js:1037`, `js/state.js:1074` — точки загрузки состояния

**Описание дефекта**
Функция `normalizeLanguageModel()` — единственное место, где легаси-состояние переводится в формат `languageProfiles` / `activeLearningLanguage` / `dataModelVersion`. Поиск по репозиторию показывает, что она вызывается **только из тестов** (`tests/language-model-migration.test.js`, `tests/language-study-isolation.test.js`) и ни разу — из кода приложения. `normalizeLoadedState()` нормализует settings, decks, cards, studyCycles, но `normalizeLanguageModel(loaded)` не вызывает, хотя именно `normalizeLoadedState()` — общий вход для всех путей загрузки (`adoptLoadedState`, восстановление и `initializeAppState`).

**Последствия**
- Пользователь со старыми данными (до многоязычности) после обновления получает состояние без `languageProfiles` и без корректного `activeLearningLanguage`.
- Селекторы `decksForLanguage` / `cardsForLanguage` / `isDeckInActiveLanguage` сравнивают язык колоды с `state.activeLearningLanguage`, который может быть `undefined`, из-за чего существующие колоды и карточки могут исчезнуть из интерфейса.
- `stateMetaFrom()` в `storage.js:238-240` сохранит `dataModelVersion: 1`, `activeLearningLanguage: null`, `languageProfiles: null`, то есть некорректный формат закрепится в IndexedDB.
- Зелёные тесты миграции дают ложную уверенность: они проверяют функцию напрямую, а не реальный путь загрузки.

**Необходимые изменения**
Вызвать `normalizeLanguageModel(loaded)` внутри `normalizeLoadedState()` (после нормализации `decks`/`cards`, до `syncActiveLanguageProfile`), обеспечив идемпотентность повторных вызовов.

**Способ проверки**
Добавить тест, который подаёт легаси-снапшот в реальный путь загрузки (`normalizeLoadedState` / `initializeAppState`) и проверяет наличие `languageProfiles`, корректного `activeLearningLanguage`, `dataModelVersion` и видимость старых колод; вручную — открыть приложение с легаси-данными в IndexedDB и убедиться, что колоды остались на месте.

---

## 2. `wipeAll()` создаёт состояние без языковой модели

**Файл и участок**
- `js/import-export.js:164-173` — литерал `emptyState` в `wipeAll()`

**Описание дефекта**
`emptyState` содержит `decks`, `cards`, `activeDeckId`, `settings`, `history`, `streak`, `sessionReviewedIds`, `studyCycles`, но не содержит `activeLearningLanguage`, `languageProfiles` и `dataModelVersion`. Для сравнения, канонический пустой state в `js/state.js:1047-1048` эти поля задаёт явно.

**Последствия**
После полного удаления всех данных состояние теряет языковую модель. Так как дефект №1 оставляет миграцию невызванной, состояние может остаться без профилей и после перезагрузки: переключение языка, изоляция колод и запись в `meta` работают на `null`-значениях.

**Необходимые изменения**
Формировать `emptyState` из общего конструктора пустого состояния (того же, что используется в `js/state.js:1047-1048`), чтобы `activeLearningLanguage`, `languageProfiles` и `dataModelVersion` всегда присутствовали.

**Способ проверки**
Тест на `wipeAll()`: после вызова проверить, что состояние содержит профили всех языков из `languageCodes()`, валидный `activeLearningLanguage` и актуальный `dataModelVersion`; вручную — выполнить полное удаление, перезагрузить приложение и переключить язык.

---

## 3. Обновление карточек в `js/study.js` идёт по глобальному `state.cards`, а не по активному языку

**Файл и участок**
- `js/study.js:769` — `return state.cards.filter(card => ...)`
- `js/study.js:981` — `const cards = state.cards.filter(card => card.deckId === deckId);`
- `js/study.js:986` — `const cards = state.cards.filter(card => bulkSelected.has(card.id));`

**Описание дефекта**
В остальных местах модуля используются языковые селекторы (`activeDecks()` в `js/study.js:16`, `activeCards(deckId)` в `js/study.js:124`, `activeCards()` в `js/scheduler.js:625`). Перечисленные три выборки обходят селекторы и работают по всему массиву карточек, включая карточки неактивного языка.

**Последствия**
Массовые операции и обновление AI-примеров могут захватить карточки другого языкового профиля: генерация примеров/перевода выполняется с кодом активного языка (`activeLearningLanguageCode()`), из-за чего в карточку другого языка может быть записан контент на неверном языке. Это нарушает требование изоляции языков из `TASK_PLAN.md`.

**Необходимые изменения**
Заменить прямые обращения к `state.cards` на `activeCards()` / `activeCards(deckId)` либо добавить фильтр `isDeckInActiveLanguage(...)` перед обработкой.

**Способ проверки**
Тест изоляции: состояние с карточками двух языков, одинаковые `id`/`deckId`-сценарии, запуск массовой операции при активном `nb` — убедиться, что карточки `en` не изменены; вручную — переключить язык и выполнить массовое обновление примеров.

---

## 4. `activeLearningLanguageCode()` объявлена в модуле практики, но используется модулями, загружаемыми раньше

**Файл и участок**
- `js/ai-practice.js:18-22` — определение `activeLearningLanguageCode()`
- потребители: `js/study.js` (2 вызова), `js/selection.js:512-513` (2 вызова), `js/decks.js` (1 вызов)
- `index.html:1389-1396` — порядок подключения: `js/study.js` и `js/decks.js` загружаются **до** `js/ai-practice.js`

**Описание дефекта**
Общий языковой хелпер живёт в модуле AI-практики, а не в `js/state.js`/`languages.js`, при этом его используют модули обучения, колод и выделения. Объявление функции поднимается только в пределах своего скрипта, поэтому корректность зависит от того, что вызовы происходят лишь после полной загрузки всех скриптов.

**Последствия**
Хрупкая архитектурная зависимость: любое раннее выполнение (обработчик, сработавший до загрузки `js/ai-practice.js`, либо изменение порядка `<script>` или ленивая загрузка модуля практики) приведёт к `ReferenceError` в пути обучения и работы с колодами. Также это нарушает разделение ответственности, заявленное в `PROJECT_MAP.md`.

**Необходимые изменения**
Перенести `activeLearningLanguageCode()` в общий слой (`js/state.js` или `languages.js`, рядом с `normalizeLearningLanguage`) и оставить в `js/ai-practice.js` только использование.

**Способ проверки**
Проверить, что после переноса `grep` не находит определения хелпера в `js/ai-practice.js`; тест, импортирующий `js/study.js` без `js/ai-practice.js`, должен успешно вычислять код активного языка.

---

## Что не проверялось

- Реальные устройства iPhone/Safari и offline-режим PWA на устройстве.
- Системный голос `nb-NO` и фактическое звучание TTS.
- Touch-выделение на сенсорных экранах.
- Внешние AI, translation и dictionary API (только контракты вызовов в коде).
