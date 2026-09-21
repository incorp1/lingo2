


# Карта проекта Lingo Cards


Проверена по исходникам **v3.18.34** из пользовательского архива. Код приложения при подготовке документации не изменялся. Карта — указатель, а не замена чтению изменяемой функции. Ищи по **именам функций, DOM-id и заголовкам**, а не по номерам строк: строки смещаются после правок.


**Порядок:** `AGENTS.md` → таблица ниже → только нужный раздел → выбранная функция и ближайшие зависимости. Всю карту при каждой задаче читать не нужно.


## 1. Куда идти по задаче


Столбец «Дальше» — условные зависимости: открывай их только если действительно затронуты.


| Задача / симптом | Начать здесь: файл → символ | Дальше при необходимости |
|---|---|---|
| Карточка на экране «Учёба», показ ответа | `js/study.js` → `renderStudy`, `reveal` | `index.html` → `view-study`; `css/study.css`, `css/mobile.css`, `css/polish.css` |
| Оценка, следующая карточка, повторный тап | `js/study.js` → `grade` | `js/scheduler.js` → `advanceStudyCardVariant`, `scheduleAnswer`, `next` |
| Интервалы / шаги / Again–Easy | `js/scheduler.js` → `scheduleAnswerSM2`, `scheduleAnswer`, `previewIntervals` | `fsrs.js`; схема настроек в `js/state.js` |
| Очередь, перемешивание, возобновление цикла | `js/scheduler.js` → `startSession`, `refillStudyQueue`, `saveCurrentStudyCycle` | `js/state.js` → `normalizeStudyCycles`; `js/study.js` → `grade` |
| Undo ответа | `js/scheduler.js` → `pushUndo`, `undo`, `undoReview` | сохранение и reviewEvents в `js/state.js` / `storage.js` |
| Колоды и меню колоды | `js/decks.js` → `renderDecks`, `openDeckActionMenu` | `css/decks.css`, `css/polish.css` |
| Список карточек, поиск, фильтры, сортировка | `js/decks.js` → `filterBrowseCards`, `renderBrowse`, `drawVisibleBrowseRows` | `css/deck-browser-vA.css`; `js/app-shell.js` → `bindEvents` |
| Выделение строк и массовые операции | `js/decks.js` → `beginBrowseLongPress`, `bulkMoveTo`, `bulkDelete` | `bulkSetSuspended`, `css/deck-browser-vA.css` |
| Создание/редактирование карточки | `js/cards.js` → `openCardEditor`, `saveCardFromEditor` | `index.html` → `editorModal`; `css/card-editor.css`; `js/state.js` → `createCard` |
| Создание/редактирование колоды | `js/cards.js` → `openDeckEditor`, `saveDeckFromEditor` | `index.html` → `deckModal`; `js/state.js` → `createDeck` |
| Добавить список слов | `js/decks.js` → `openBulkAdd`, `parseBulkInput`, `commitBulkAdd` | `enrichBulkCard`; `index.html` → `bulkModal`; `ai.js` |
| Цвет сложности слова | `js/state.js` → `calculateDifficultyCache`, `difficultyStyle` | `js/decks.js` → `patchBrowseRow`; `js/ai-practice.js` → `renderPracticeWordPreview` |
| Настройка не сохраняется / новое поле | `js/settings.js` → `bindSettings`, `commitSimpleSetting`, `commitSettingsDrafts` | `js/state.js` → `defaultSettings`, `SETTINGS_SCHEMA`; `backup.js` → `sanitizeSettings` |
| Настройки: разделы, «Назад», история Safari | `js/ui.js` → `navigateAppState`, `switchView`, `settingsEdgeSwipeBack` | `js/settings.js` → `mountSettingsRoutePanels`; `css/settings-responsive.css`, `css/settings-polish.css` |
| Тема и первый кадр до загрузки | `js/ui.js` → `applyTheme`; `theme-init.js` | `css/base.css`; `js/settings.js` |
| Надпись / перевод / подсказка | ключ в `i18n/ru.js`, затем тот же ключ в `uk.js` / `en.js` | `i18n/runtime.js`; `tooltips.js` → `initTooltips` |
| AI-заполнение карточки | `js/ai-practice.js` → `generateCard` | `ai.js` → `generate`, `userPrompt`; `js/ui.js` → `startAiJob` |
| AI-провайдер, модель, проверка ключа | `js/ai-practice.js` → `refreshAiModels`, `testAiKey` | `ai.js` → `PROVIDER_DEFAULTS`, `fetchModelCatalog`, `chatJson`; `_headers` |
| Обновление примеров, очередь и лимиты | `js/study.js` → `refreshExamplesForCards` | `ai.js` → `generateExamplesBatch`, `batchExamplesPrompt`; `css/polish.css` |
| Практика чтения: текст, вопросы, проверка | `js/ai-practice.js` → `openPractice`, `practiceGenerate`, `practiceCheck` | `index.html` → `practiceModal`; `css/features.css`; `ai.js` |
| Перевод/добавление слова долгим нажатием | `js/selection.js` → `bindSelectionLookup`, `translateSelection`, `selectionAddCard` | `ai.js` → `quickTranslate`; `css/features.css` |
| Произношение / скорость голоса | `js/app-shell.js` → `speak`, `detectLang` | `js/settings.js` → `commitTtsRate`; `js/study.js` → `autoSpeakRevealedCard` |
| Боковой язычок и меню «Учёба» | `js/edge-menu.js` → `bindStudyEdgeMenu`, `openStudyEdgeMenu` | `css/edge-menu.css`; `js/settings.js` → `commitStudyCardModes`, `commitStudyCardFronts` |
| Анимация появления/смены карточки | `js/motion.js` → `transitionStudyCardOut`, `transitionStudyCardIn` | `css/motion.css`; `js/study.js` → `grade` |
| Статистика | `js/stats.js` → `renderStats`, `renderHeatmap` | `css/stats-settings.css`; `state.history` |
| Экспорт, Share Sheet, полный импорт | `js/import-export.js` → `exportData`, `shareExportData`, `importFullBackup` | `backup.js` → `buildFullExport`, `parse`; `storage.js` → snapshot API |
| Экспорт одной колоды | `js/decks.js` → `exportDeck` | `backup.js` → `buildDeckExport` |
| Сброс, удаление всех данных, восстановление | `js/import-export.js` → `resetProgress`, `wipeAll`, `restoreRecentChange` | `commitDestructiveSnapshot`; `storage.js` → recovery API |
| После перезапуска пропадают правки | место изменения → dirty-флаг → `js/state.js` → `saveAndFlush` | `storage.js` читать только после проверки этой цепочки |
| Пустой экран при старте | `js/app-shell.js` → завершающий async-блок, сообщение `Boot failed` | `js/state.js` → `initState`; порядок `<script>` в `index.html`; ошибка консоли |
| Не приходит обновление / не работает офлайн | `js/stats.js` → `registerSW`, `applyServiceWorkerUpdate` | `sw.js`, `_headers`, раздел 6 этой карты |
| Клавиатура перекрывает элементы iPhone | `js/app-shell.js` → `updateAppViewportHeight`, `updateSettingsViewport` | `css/mobile.css`, профильный CSS; события `focusin` / `focusout` |


## 2. Файлы и границы ответственности


```text
/
├── AGENTS.md                   Правила модели: читать в начале задачи
├── PROJECT_MAP.md              Эта карта: читать выборочно
├── index.html                  Единственная рабочая HTML-страница, экраны и модальные окна
├── app-original.html           Отдельный HTML; рабочая страница/SW на него не ссылаются
├── theme-init.js               Ранняя тема и полифиллы старого WebKit
├── storage.js                  IndexedDB, транзакции, ревизии, retries, snapshots/recovery
├── fsrs.js                     Математика FSRS-4.5
├── ai.js                       Словарь, перевод, LLM-запросы, промпты, retry/timeout
├── backup.js                   Формат копий, валидация/санитайзеры; без DOM
├── seed.js                     Начальные колоды для нового локального состояния
├── tooltips.js                 Общие всплывающие подсказки
├── sw.js                       Кэш оболочки и офлайн-ответы Service Worker
├── manifest.webmanifest        Установка PWA, scope/start_url, иконки
├── _headers                    Заголовки Cloudflare: CSP и HTTP-кэширование
├── icon-192.png / icon-512.png  Иконки PWA
├── select-arrow.png            Графика select
├── package.json                Версия и команда test; runtime-зависимостей нет
├── package-lock.json           Зафиксированные npm dev-зависимости и версия пакета
├── pnpm-lock.yaml              Имеющийся альтернативный lock-файл; не переписывать попутно
├── i18n/
│   ├── ru.js / uk.js / en.js   Словари интерфейса
│   └── runtime.js              t(), applyI18N(), запасной перевод en
├── js/
│   ├── state.js               Модель, настройки, нормализация, dirty-флаги, индексы
│   ├── scheduler.js           SM-2/выбор FSRS, очередь, циклы вариантов, undo, streak
│   ├── ui.js                  Диалоги, темы, языки, навигация, управление AI-job
│   ├── study.js               Экран учёбы, grade/reveal, очередь обновления примеров
│   ├── decks.js               Колоды, виртуальный список, фильтры и массовые действия
│   ├── stats.js               Статистика И регистрация/обновление Service Worker
│   ├── settings.js            Отрисовка/commit настроек и сборка их панелей
│   ├── ai-practice.js         UI AI-настроек, заполнение карточки, практика чтения
│   ├── cards.js               Редакторы карточки/колоды, адресное обновление UI
│   ├── import-export.js       Действия пользователя над копиями и опасные операции
│   ├── selection.js           Выделение текста по удержанию, lookup, ширина select
│   ├── edge-menu.js           Жесты и действия бокового меню учёбы
│   ├── motion.js              Координатор анимаций, window.LCMotion
│   └── app-shell.js           Общий TTS, bindEvents, viewport, финальный запуск
├── css/                       Каскад: см. раздел 5
└── tests/                     node:test; подбор по задаче — раздел 7
```


Не путать пары: `storage.js` — механизм хранения, `js/state.js` — модель приложения; `backup.js` — формат, `js/import-export.js` — пользовательские действия; `ai.js` — API, `js/ai-practice.js` — UI; `js/cards.js` — редактор, `js/decks.js` — список карточек.


## 3. Запуск и связи


### Реальный порядок JavaScript в index.html


В `<head>`: `theme-init.js`. В конце `<body>`:


```text
storage.js → fsrs.js → ai.js → seed.js
→ i18n/uk.js → i18n/ru.js → i18n/en.js → i18n/runtime.js
→ tooltips.js → backup.js
→ js/state.js → js/scheduler.js → js/ui.js → js/study.js
→ js/decks.js → js/stats.js → js/settings.js → js/ai-practice.js
→ js/cards.js → js/import-export.js → js/selection.js
→ js/edge-menu.js → js/motion.js → js/app-shell.js
```


Это не ES-import-граф. Скрипты разделяют глобальную среду; некоторые функции вызывают функции из более поздних файлов уже после загрузки страницы. Нельзя механически сортировать подключения по алфавиту. Порядок URL внутри `sw.js / APP_SHELL` не определяет порядок исполнения скриптов.


`js/app-shell.js` запускает: `initState()` → тема/язык → storage events → `bindEvents()` → recovery action → edge menu → навигация → fallback `:has` → обновление очереди по времени → wake lock → `registerSW()`.


### Экран — не отдельная HTML-страница


`index.html` содержит `view-study`, `view-decks`, `view-stats`, `view-settings`. Переключение — `switchView()` в `js/ui.js`, активный экран отражается в `body[data-view]`.


Навигация использует query-параметры `view` и `section`, а не `/settings/...`. Разделы настроек: `home`, `learning`, `generation`, `card-sound`, `appearance`, `data`. `mountSettingsRoutePanels()` перемещает существующие DOM-блоки: не создавать параллельную мобильную копию формы.


Общие API библиотечных файлов: `window.LCStorage`, `window.FSRS`, `window.LCAi`, `window.LCBackup`, `window.LCMotion`, `window.I18N`, `window.t`.


## 4. Данные и важные контракты


### Где что хранится


- IndexedDB: БД `lingo-cards`, версия схемы **3**. Хранилища: `kv`, `cards`, `decks`, `settings`, `reviewEvents`, `practiceHistory`, `recoverySnapshots`.
- `STORAGE_KEY = "lingo-cards-v1"` — логический/исторический ключ; это **не версия релиза**. Есть миграция из localStorage.
- localStorage также используется для отдельных UI-предпочтений, например темы `lingo-theme` и положения меню `lingo-cards-edge-anchor`. Это не основное хранилище карточек.
- `state`: `decks`, `cards`, `activeDeckId`, `settings`, `history`, `streak`, `sessionReviewedIds`, `studyCycles`; механизм хранения поддерживает `revision` / `updatedAt`.
- `session` и `undoStack` — временные структуры. Не предполагать, что перезагрузка восстанавливает их целиком.
- Карточка: идентификаторы `id`/`deckId`; контент `front`, `back`, `example`, `exampleSentence`, `exampleTranslation`, `exampleTargetTerm`, `hint`, `cloze`; учебные поля `state`, `step`, `ease`, `interval`, `due`, `reps`, `lapses`, `lastReview`; дополнительно `fsrs`, `difficultyCache` и другие поддерживаемые поля. Полный контракт — в `createCard`, нормализации и `sanitizeCard`, а не в этом сокращённом списке.
- `cardById`, `deckById`, `cardsByDeck` — индексы памяти. При замене состояния нужен `rebuildEntityIndexes()`; при обычной операции используй существующие помощники.


### Изменение и запись


```text
действие → изменение state + соответствующий mark...Dirty
→ save() → LCStorage.setAppState(...) → flush() → IndexedDB
→ успешный UI; при ошибке — существующий rollback/сообщение
```


`mutateAndFlush()` возвращает `true`/`false`; не игнорировать результат. `saveAndFlush()` не помечает сущности грязными автоматически. История практики имеет отдельные `markPracticeHistoryDirty` / `markPracticeHistoryDeleted`. Review events добавляются через `recordReviewEvent` / `LCStorage.appendReviewEvent`.


### Учёба


UI-оценка: `0=Again`, `1=Hard`, `2=Good`, `3=Easy`; `FSRS.schedule` получает **1–4** через `grade + 1`. Новые и learning-карточки проходят `scheduleAnswerSM2` даже при выбранном FSRS; FSRS применяется в другой ветке `scheduleAnswer`.


Цикл вариантов word/sentence × english/local сохраняется в `studyCycles`. До окончания вариантов не выполняется полноценное планирование ответа; итог — худшая оценка `Math.min(...grades)`. Смена карточки в `grade()` происходит после `saveAndFlush()`.


Очередь пополняется порциями по 50 (`STUDY_QUEUE_BATCH_SIZE`); это **не дневной лимит**. Цвет сложности вычисляется отдельным `difficultyCache` по reviewEvents и не равен параметру `D` в FSRS.


### Копии и опасные операции


Актуальный формат `backup.js / CONFIG.format` — **2**. `buildFullExport` сохраняет состояние, reviewEvents и practiceDraft; рабочий экспорт вызывает его с `{ includeSecrets: true }`. Копия может содержать AI-ключ.


`buildDeckExport` экспортирует содержимое одной колоды без её учебного прогресса, идентичности и настроек. Не заменять им полную резервную копию.


`parse()` возвращает различаемые результаты `full`, `deck`, `decks`, `error`; есть поддержка старых форматов и подтверждение старого секрета. Комментарий API в начале `backup.js` неполон относительно текущей реализации — проверяй сам `parse()`.


`replaceAppSnapshot` / `appendDeck` используют ревизии; recovery snapshots имеют TTL 10 минут. Не обходить эти функции прямой очисткой stores. Новое поле обязательно провести через санитайзеры и round-trip копии.


### AI


Реально объявленные провайдеры: `openai`, `google`, `xai`; расширенный список доменов в CSP не доказывает поддержку остальных в UI. Ключ — пользовательский, запросы выполняются непосредственно браузером. Внешние API для подготовки этой карты не вызывались.


Отмена и устаревшие ответы контролируются AI-job / snapshot-проверками; сетевые таймауты и retry находятся в `ai.js`. Массовое обновление примеров живёт в `js/study.js`, а не в редакторе: пакеты по 20, ограничение темпа Gemini, повтор пропусков и сохранение успешных результатов.


## 5. Карта CSS


**Порядок подключения в index.html** — сверху вниз; поздние файлы могут переопределять ранние при соответствующей специфичности:


| № | Файл в css/ | Основная область |
|---|---|---|
| 1 | `base.css` | Переменные тем, базовые стили и оболочка |
| 2 | `study.css` | Учебная карточка, reveal, оценки, общие кнопки |
| 3 | `decks.css` | Колоды, список карточек, базовые стили связанных модалок |
| 4 | `stats-settings.css` | Статистика, настройки, базовые диалоги/toast |
| 5 | `mobile.css` | Мобильная раскладка, учебная область, навигация |
| 6 | `features.css` | Массовые действия, AI, практика, выделение, подсказки |
| 7 | `polish.css` | Поздние компактные переопределения и прогресс обновления примеров |
| 8 | `edge-menu.css` | Мобильное боковое меню |
| 9 | `settings-responsive.css` | Адаптивная раскладка настроек |
| 10 | `settings-polish.css` | Поздние компактные стили настроек |
| 11 | `deck-browser-vA.css` | Рабочий актуальный слой списка карточек, несмотря на vA в имени |
| 12 | `card-editor.css` | Рабочий актуальный слой редактора карточки |
| 13 | `motion.css` | Анимации и reduced-motion |


Алгоритм CSS-правки: найти DOM-класс → все его определения → определить применимые media/supports и победителя каскада → изменить правило-владелец → проверить соседние состояния. Не переносить `mobile.css` в конец: это изменит существующий каскад.


Порог настроек — 900 px; в других компонентах используются другие breakpoints. Не «унифицировать» их в рамках локальной правки. Для виртуального списка высота строки в CSS должна согласовываться с `ROW_HEIGHT = 44` в `js/decks.js`; иначе ломаются расчёты прокрутки.


## 6. Выпуск PWA


**Только при выпуске изменений приложения, не для правки Markdown.**


1. Выбери одну новую версию; не смешивай её с версиями формата БД/копии.
2. Согласуй:
   - `package.json` → `version`;
   - `package-lock.json` → верхний `version` и `packages[""].version`;
   - `index.html` → версии `?v=` подключаемых JS/CSS и видимые метки сборки;
   - `sw.js` → `CACHE` и все versioned URL в `APP_SHELL`;
   - `js/stats.js` → `SERVICE_WORKER_URL`;
   - `js/settings.js` → `settingsFooterVersion` и другие действительно найденные метки.
3. Найди остатки прежней версии в рабочих файлах и тестах. Не делай слепую замену по всему архиву: исторический HTML и описание основания документации не обязаны менять версию.
4. В `tests/card-editor-variant-c.test.js` и `tests/difficulty-cache.test.js` есть жёсткие ожидания **3.18.34**, включая regex с экранированными точками. При новом релизе обнови именно ожидания версии, не удаляя проверки. Общую согласованность также проверяет `tests/p46-p60-regression.test.js`.
5. Каждый новый локальный JS/CSS, подключённый в HTML, добавь с **точно таким же URL** в `APP_SHELL`. Сам файл должен существовать. `cache.addAll()` может сорвать установку SW из-за отсутствующего ресурса.
6. Не ослабляй `_headers`: CSP разрешает внешние скрипты только с собственного origin; встроенные `<script>` и HTML `onclick` не являются допустимым способом добавить обработчик. Новому сетевому домену требуется осознанное изменение `connect-src`.
7. Сохрани порядок обновления: commit черновиков → flush хранилища → активация/перезагрузка. Он реализован в `js/stats.js`, не только в `sw.js`.
8. Для публикации исходного статического приложения сборка не предусмотрена: в корне публикуемых файлов должен быть `index.html` рядом с JS/CSS, manifest, иконками, `_headers` и `sw.js`. Не добавляй лишнюю вложенную папку вокруг них.
9. Проверка на устройстве: онлайн загрузить новую версию → дождаться обновления → убедиться, что данные сохранились → закрыть и открыть PWA → повторить запуск без сети. Офлайн-тест касается оболочки и локального обучения, не внешних AI/переводческих API.


SW обслуживает навигацию из кэша с фоновым обновлением; поэтому простая замена файла на хостинге не гарантирует немедленное появление изменений в уже установленной PWA. Не предлагай пользователю удаление данных/переустановку как обычный способ обновления.


## 7. Какие тесты читать и запускать


Все пути ниже относительно `tests/`. Запуск одного: `node --test tests/quick-backup.test.js`. Несколько — перечислить через пробел. Полный набор: `npm test`. Для установки имеющихся dev-зависимостей — `npm ci`; `fake-indexeddb` / `happy-dom` не являются runtime-зависимостями сайта.


| Область | Профильные файлы тестов |
|---|---|
| Шаги и интервалы SM-2 | `scheduler-anki-alignment.test.js` |
| Очередь, отсутствие дневной квоты | `unlimited-study-queue.test.js` |
| Незавершённый цикл и копия | `study-cycle-persistence.test.js` |
| Смена карточки, анимации, WebKit | `study-card-transition.test.js` |
| Цвет сложности | `difficulty-cache.test.js` |
| Редактор карточки и включение в SW | `card-editor-variant-c.test.js` |
| Список/фильтры/выбор строк | `deck-browser-variant-a.test.js`, `deck-browser-selection.test.js` |
| Настройки, копии, storage-контракты | `settings-redesign.test.js`, `p46-p60-regression.test.js` |
| Подсказки, заголовки, навигация настроек | `settings-tooltips-header.test.js` |
| Быстрая копия / Share Sheet | `quick-backup.test.js` |
| Офлайн-оболочка | `offline-startup.test.js` |
| Обновление примеров | `example-refresh-queue.test.js` |
| Выделение по удержанию | `selection-long-press.test.js`, `ios-selection-compat.test.js` |
| iPhone zoom / поля | `ios-no-zoom.test.js` |
| Стиль вопросов практики | `practice-question-editor-style.test.js` |
| Скорость озвучивания | `tts-speed.test.js` |
| Режимы бокового меню | `edge-mode-picker.test.js` |


Многие тесты — статические проверки исходников; часть выполняет выбранную логику через VM. Наличие теста не доказывает реальную работу touch-жеста, IndexedDB на iPhone, API-провайдера или обновления установленной PWA. Эти сценарии проверяются отдельно. В рамках подготовки документации приложение и его тесты не запускались: проверены структура, символы и контракты по коду.


## 8. Три примера минимального маршрута


**Изменить подпись быстрой копии:** ключ `settings.backup...` найти по текущей подписи в `i18n/ru.js` → тот же ключ в `uk.js` / `en.js` → `quick-backup.test.js`. Не читать планировщик или IndexedDB.


**Изменить отступ поля редактора:** `index.html / editorModal` → класс поля → совпадения в CSS → правило в `css/card-editor.css` с учётом каскада → тест редактора и ручная проверка мобильного поля. Не менять `saveCardFromEditor`, если поведение не затронуто.


**Исправить потерю изменения карточки:** `saveCardFromEditor` → `markCardDirty` и `mutateAndFlush` → поддержка индексов при переносе → `saveAndFlush`. Только если цепочка исправна, идти в конкретный метод `LCStorage`. Проверить изменение → перезагрузка → полный экспорт/импорт, не переписывая всю систему хранения.

