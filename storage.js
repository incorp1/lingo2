/* Lingo Cards — durable IndexedDB persistence with retries and cross-tab recovery. */

(function (root) {
  function createLCStorage(environment = root) {
    const DB_NAME = "lingo-cards";
    const DB_VERSION = 3;
    const STORE = "kv";
    const RECOVERY_STORE = "recoverySnapshots";
    const RECOVERY_TTL_MS = 10 * 60 * 1000;
    const STATE_STORES = {
      cards: "cards",
      decks: "decks",
      settings: "settings",
      reviewEvents: "reviewEvents",
      practiceHistory: "practiceHistory",
    };
    const CHANNEL_NAME = "lingo-cards-storage-v3";
    const target = environment.window || environment;
    const idb = environment.indexedDB || target.indexedDB;
    const nav = environment.navigator || target.navigator || {};
    const Broadcast = environment.BroadcastChannel || target.BroadcastChannel;
    const CustomEventCtor = environment.CustomEvent || target.CustomEvent;
    const local = environment.localStorage || target.localStorage;
    const retryBaseMs = Math.max(10, Number(environment.retryBaseMs) || 250);
    const retryMaxMs = Math.max(retryBaseMs, Number(environment.retryMaxMs) || 30000);
    const setTimer = environment.setTimeout || target.setTimeout || globalThis.setTimeout;
    const clearTimer = environment.clearTimeout || target.clearTimeout || globalThis.clearTimeout;

    let dbPromise = null;
    const pending = new Map();
    const knownRevisions = new Map();
    const flushingKeys = new Set();
    let flushTimer = null;
    let retryTimer = null;
    let retryAttempt = 0;
    let flushing = null;
    let lastError = null;
    let status = "saved";
    let stateBaseline = null;
    let statePending = null;
    let stateFlushing = null;
    let stateKnownRevision = 0;
    let pendingReviewEvents = [];
    const channel = typeof Broadcast === "function" ? new Broadcast(CHANNEL_NAME) : null;

    class StaleWriteError extends Error {
      constructor(key, expected, actual) {
        super(`Newer data exists for ${key} (expected revision ${expected}, found ${actual})`);
        this.name = "StaleWriteError";
        this.key = key;
        this.expectedRevision = expected;
        this.actualRevision = actual;
        this.storageError = true;
      }
    }

    function clone(value) {
      if (value === undefined) return undefined;
      const cloneFn = environment.structuredClone || target.structuredClone || globalThis.structuredClone;
      if (typeof cloneFn === "function") return cloneFn(value);
      return JSON.parse(JSON.stringify(value));
    }

    function revisionOf(value) {
      const revision = Number(value && value.revision);
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    }

    async function withWriteLock(key, task) {
      if (nav.locks && typeof nav.locks.request === "function") {
        return nav.locks.request(`lingo-cards:${key}`, { mode: "exclusive" }, task);
      }
      return task();
    }

    function dispatch(name, detail) {
      if (!target || typeof target.dispatchEvent !== "function" || typeof CustomEventCtor !== "function") return;
      target.dispatchEvent(new CustomEventCtor(name, { detail }));
    }

    function emitStatus(nextStatus, detail = {}) {
      status = nextStatus;
      dispatch("lcstorage:status", { status: nextStatus, error: lastError, ...detail });
    }

    function emitSaving(detail = {}) {
      if (status === "error" && lastError) {
        dispatch("lcstorage:status", { status: "error", error: lastError, ...detail });
        return;
      }
      emitStatus("saving", detail);
    }

    function isRetryableStorageError(error) {
      const name = String(error?.name || "");
      if (["QuotaExceededError", "DataCloneError", "ConstraintError", "SecurityError", "NotSupportedError", "ReadOnlyError", "VersionError"].includes(name)) return false;
      if (["AbortError", "UnknownError", "TimeoutError", "NetworkError"].includes(name)) return true;
      const message = String(error?.message || error || "");
      return /temporar|transient|timeout|network|connection|transaction (?:aborted|failed)|database (?:closed|closing)|indexeddb blocked/i.test(message);
    }

    function getStatus() {
      return { status, error: lastError, retryAttempt };
    }

    function openDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
          const error = new Error("Закройте другие вкладки Lingo Cards и повторите обновление базы данных.");
          error.name = "BlockedUpgradeError";
          dispatch("lcstorage:upgradeblocked", { error });
          reject(error);
        };
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          if (!db.objectStoreNames.contains(STATE_STORES.cards)) {
            const cards = db.createObjectStore(STATE_STORES.cards, { keyPath: "id" });
            cards.createIndex("deckId", "deckId", { unique: false });
            cards.createIndex("state", "state", { unique: false });
            cards.createIndex("due", "due", { unique: false });
          }
          if (!db.objectStoreNames.contains(STATE_STORES.decks)) {
            db.createObjectStore(STATE_STORES.decks, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(STATE_STORES.settings)) {
            db.createObjectStore(STATE_STORES.settings, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(STATE_STORES.reviewEvents)) {
            const events = db.createObjectStore(STATE_STORES.reviewEvents, { keyPath: "id" });
            events.createIndex("cardId", "cardId", { unique: false });
            events.createIndex("deckId", "deckId", { unique: false });
            events.createIndex("at", "at", { unique: false });
          }
          if (!db.objectStoreNames.contains(STATE_STORES.practiceHistory)) {
            const practice = db.createObjectStore(STATE_STORES.practiceHistory, { keyPath: "id" });
            practice.createIndex("at", "at", { unique: false });
          }
          if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
            db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          req.result.onversionchange = () => {
            req.result.close();
            dbPromise = null;
            dispatch("lcstorage:versionchange", {});
          };
          resolve(req.result);
        };
      }).catch(error => {
        dbPromise = null;
        throw error;
      });
      return dbPromise;
    }

    async function rawGet(key) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      });
    }

    async function compareAndSet(key, value, expectedRevision) {
      if (typeof environment.__LCStorageBeforeWrite === "function") {
        await environment.__LCStorageBeforeWrite({ key, value: clone(value), expectedRevision });
      }
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const getReq = store.get(key);
        let nextValue;
        let settled = false;
        const fail = error => {
          if (settled) return;
          settled = true;
          reject(error || new Error("IndexedDB transaction failed"));
        };
        getReq.onerror = () => fail(getReq.error);
        getReq.onsuccess = () => {
          const actualRevision = revisionOf(getReq.result);
          if (actualRevision !== expectedRevision) {
            fail(new StaleWriteError(key, expectedRevision, actualRevision));
            try { tx.abort(); } catch (_) {}
            return;
          }
          try {
            nextValue = clone(value);
            nextValue.revision = actualRevision + 1;
            nextValue.updatedAt = Date.now();
            store.put(nextValue, key);
          } catch (error) {
            fail(error);
            try { tx.abort(); } catch (_) {}
          }
        };
        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(nextValue);
          }
        };
        tx.onerror = () => fail(tx.error || new Error("IndexedDB transaction failed"));
        tx.onabort = () => fail(tx.error || new Error("IndexedDB transaction aborted"));
      });
    }

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function recordSignature(value) {
      return JSON.stringify(value);
    }

    function makeRecordMap(records) {
      return new Map((records || []).map(record => [record.id, {
        value: clone(record),
        signature: recordSignature(record),
      }]));
    }

    function stateMetaFrom(appState, revision = stateKnownRevision) {
      return {
        key: "app",
        dataModelVersion: Number(appState.dataModelVersion) || 1,
        activeLearningLanguage: appState.activeLearningLanguage || null,
        languageProfiles: appState.languageProfiles ? clone(appState.languageProfiles) : null,
        activeDeckId: appState.activeDeckId || null,
        history: clone(appState.history || {}),
        streak: clone(appState.streak || { current: 0, lastDay: null }),
        sessionReviewedIds: clone(appState.sessionReviewedIds || []),
        studyCycles: clone(appState.studyCycles || {}),
        practiceDraft: appState.practiceDraft ? clone(appState.practiceDraft) : null,
        revision,
        updatedAt: Number(appState.updatedAt) || 0,
      };
    }

    function settingsRecordFrom(appState) {
      const settings = clone(appState.settings || {});
      delete settings.practiceHistory;
      return { key: "settings", value: settings };
    }

    function snapshotBaseline(appState) {
      const practice = Array.isArray(appState.settings?.practiceHistory) ? appState.settings.practiceHistory : [];
      const meta = stateMetaFrom(appState, Number(appState.revision) || 0);
      stateKnownRevision = meta.revision;
      return {
        cards: makeRecordMap(appState.cards),
        decks: makeRecordMap(appState.decks),
        practiceHistory: makeRecordMap(practice),
        settings: { value: settingsRecordFrom(appState), signature: recordSignature(settingsRecordFrom(appState)) },
        meta: { value: meta, signature: recordSignature({ ...meta, revision: 0, updatedAt: 0 }) },
      };
    }

    function diffRecords(records, baselineMap) {
      const currentIds = new Set();
      const puts = [];
      for (const record of records || []) {
        if (!record?.id) continue;
        currentIds.add(record.id);
        const signature = recordSignature(record);
        if (baselineMap?.get(record.id)?.signature !== signature) puts.push(clone(record));
      }
      const deletes = [];
      if (baselineMap) {
        for (const id of baselineMap.keys()) if (!currentIds.has(id)) deletes.push(id);
      }
      return { puts, deletes };
    }

    function buildStateDelta(appState) {
      if (!stateBaseline) stateBaseline = snapshotBaseline({ ...appState, cards: [], decks: [], settings: { ...(appState.settings || {}), practiceHistory: [] } });
      const settings = settingsRecordFrom(appState);
      const meta = stateMetaFrom(appState);
      const metaComparable = { ...meta, revision: 0, updatedAt: 0 };
      const practice = Array.isArray(appState.settings?.practiceHistory) ? appState.settings.practiceHistory : [];
      return {
        cards: diffRecords(appState.cards, stateBaseline.cards),
        decks: diffRecords(appState.decks, stateBaseline.decks),
        practiceHistory: diffRecords(practice, stateBaseline.practiceHistory),
        settings: stateBaseline.settings.signature === recordSignature(settings) ? null : settings,
        meta: stateBaseline.meta.signature === recordSignature(metaComparable) ? null : meta,
        reviewEvents: {
          puts: pendingReviewEvents.splice(0),
          deleteCardIds: [],
          deleteEventIds: [],
        },
      };
    }

    function deltaIsEmpty(delta) {
      return !delta.settings && !delta.meta && delta.reviewEvents.puts.length === 0 &&
        delta.reviewEvents.deleteCardIds.length === 0 &&
        (delta.reviewEvents.deleteEventIds || []).length === 0 &&
        [delta.cards, delta.decks, delta.practiceHistory].every(part => part.puts.length === 0 && part.deletes.length === 0);
    }

    function applyDeltaToBaseline(delta, committedMeta) {
      if (!stateBaseline) {
        stateKnownRevision = committedMeta?.revision || stateKnownRevision;
        return;
      }
      const apply = (part, map) => {
        for (const id of part.deletes) map.delete(id);
        for (const value of part.puts) map.set(value.id, { value: clone(value), signature: recordSignature(value) });
      };
      apply(delta.cards, stateBaseline.cards);
      apply(delta.decks, stateBaseline.decks);
      apply(delta.practiceHistory, stateBaseline.practiceHistory);
      if (delta.settings) stateBaseline.settings = { value: clone(delta.settings), signature: recordSignature(delta.settings) };
      if (committedMeta) {
        const comparable = { ...committedMeta, revision: 0, updatedAt: 0 };
        stateBaseline.meta = { value: clone(committedMeta), signature: recordSignature(comparable) };
        stateKnownRevision = committedMeta.revision;
      }
    }

    async function readStructuredState() {
      const db = await openDB();
      const tx = db.transaction(Object.values(STATE_STORES), "readonly");
      const cards = await requestResult(tx.objectStore(STATE_STORES.cards).getAll());
      const decks = await requestResult(tx.objectStore(STATE_STORES.decks).getAll());
      const settingsRecord = await requestResult(tx.objectStore(STATE_STORES.settings).get("settings"));
      const meta = await requestResult(tx.objectStore(STATE_STORES.settings).get("app"));
      const practiceHistory = await requestResult(tx.objectStore(STATE_STORES.practiceHistory).getAll());
      if (!meta && !settingsRecord && cards.length === 0 && decks.length === 0) return undefined;
      const settings = clone(settingsRecord?.value || {});
      settings.practiceHistory = practiceHistory.sort((a, b) => Number(b.at) - Number(a.at));
      return {
        cards,
        decks,
        settings,
        dataModelVersion: Number(meta?.dataModelVersion) || 1,
        activeLearningLanguage: meta?.activeLearningLanguage || null,
        languageProfiles: meta?.languageProfiles ? clone(meta.languageProfiles) : null,
        activeDeckId: meta?.activeDeckId || null,
        history: clone(meta?.history || {}),
        streak: clone(meta?.streak || { current: 0, lastDay: null }),
        sessionReviewedIds: clone(meta?.sessionReviewedIds || []),
        studyCycles: clone(meta?.studyCycles || {}),
        practiceDraft: meta?.practiceDraft ? clone(meta.practiceDraft) : null,
        revision: Number(meta?.revision) || 0,
        updatedAt: Number(meta?.updatedAt) || 0,
      };
    }

    async function cleanupExpiredRecoverySnapshots(now = Date.now()) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(RECOVERY_STORE, "readwrite");
        const store = tx.objectStore(RECOVERY_STORE);
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (Number(cursor.value?.expiresAt) <= now) cursor.delete();
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Recovery cleanup failed"));
        tx.onabort = () => reject(tx.error || new Error("Recovery cleanup aborted"));
      });
    }

    async function getLocalMetadata(key) {
      const record = await rawGet(`metadata:${key}`);
      return record ? clone(record.value) : undefined;
    }

    async function setLocalMetadata(key, value) {
      const storageKey = `metadata:${key}`;
      return withWriteLock(storageKey, async () => {
        const current = await rawGet(storageKey);
        const written = await compareAndSet(storageKey, { value: clone(value) }, revisionOf(current));
        return clone(written.value);
      });
    }

    function appStateFromRecords(cards, decks, settingsRecord, meta, practiceHistory) {
      const settings = clone(settingsRecord?.value || {});
      settings.practiceHistory = (practiceHistory || []).map(clone).sort((a, b) => Number(b.at) - Number(a.at));
      return {
        cards: (cards || []).map(clone),
        decks: (decks || []).map(clone),
        settings,
        dataModelVersion: Number(meta?.dataModelVersion) || 1,
        activeLearningLanguage: meta?.activeLearningLanguage || null,
        languageProfiles: meta?.languageProfiles ? clone(meta.languageProfiles) : null,
        activeDeckId: meta?.activeDeckId || null,
        history: clone(meta?.history || {}),
        streak: clone(meta?.streak || { current: 0, lastDay: null }),
        sessionReviewedIds: clone(meta?.sessionReviewedIds || []),
        studyCycles: clone(meta?.studyCycles || {}),
        revision: Number(meta?.revision) || 0,
        updatedAt: Number(meta?.updatedAt) || 0,
      };
    }

    async function readAppSnapshot() {
      return withWriteLock("app-state", async () => {
        const db = await openDB();
        const names = Object.values(STATE_STORES);
        const tx = db.transaction(names, "readonly");
        const cardsPromise = requestResult(tx.objectStore(STATE_STORES.cards).getAll());
        const decksPromise = requestResult(tx.objectStore(STATE_STORES.decks).getAll());
        const settingsPromise = requestResult(tx.objectStore(STATE_STORES.settings).get("settings"));
        const metaPromise = requestResult(tx.objectStore(STATE_STORES.settings).get("app"));
        const historyPromise = requestResult(tx.objectStore(STATE_STORES.practiceHistory).getAll());
        const eventsPromise = requestResult(tx.objectStore(STATE_STORES.reviewEvents).getAll());
        const [cards, decks, settingsRecord, meta, practiceHistory, reviewEvents] = await Promise.all([
          cardsPromise, decksPromise, settingsPromise, metaPromise, historyPromise, eventsPromise,
        ]);
        return {
          state: appStateFromRecords(cards, decks, settingsRecord, meta, practiceHistory),
          reviewEvents: reviewEvents.map(clone),
          practiceDraft: meta?.practiceDraft ? clone(meta.practiceDraft) : null,
        };
      });
    }

    function createEntityId(prefix, usedIds) {
      let id;
      do {
        const random = environment.crypto?.randomUUID?.()
          || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
        id = `${prefix}-${random}`;
      } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    }

    async function appendDeck(deckInput, options = {}) {
      if (!deckInput || typeof deckInput !== "object" || Array.isArray(deckInput)
        || !Array.isArray(deckInput.cards)) {
        throw new TypeError("Invalid deck");
      }
      const expectedRevision = Number.isSafeInteger(options.expectedRevision)
        ? options.expectedRevision
        : stateKnownRevision;
      if (statePending || stateFlushing || pendingReviewEvents.length > 0) {
        throw new Error("Pending application state must be flushed before deck append");
      }
      emitSaving({ key: "app-state", appending: true });
      try {
        if (typeof environment.__LCStorageBeforeStateWrite === "function") {
          await environment.__LCStorageBeforeStateWrite({
            appendDeck: clone(deckInput),
            expectedRevision,
          });
        }
        const committed = await withWriteLock("app-state", async () => {
          const db = await openDB();
          return new Promise((resolve, reject) => {
            const names = [STATE_STORES.cards, STATE_STORES.decks, STATE_STORES.settings];
            const tx = db.transaction(names, "readwrite");
            const cardsStore = tx.objectStore(STATE_STORES.cards);
            const decksStore = tx.objectStore(STATE_STORES.decks);
            const settingsStore = tx.objectStore(STATE_STORES.settings);
            const cardsRequest = cardsStore.getAll();
            const decksRequest = decksStore.getAll();
            const metaRequest = settingsStore.get("app");
            let result;
            let settled = false;
            const fail = error => {
              if (settled) return;
              settled = true;
              try { tx.abort(); } catch (_) {}
              reject(error || new Error("IndexedDB deck append failed"));
            };
            Promise.all([
              requestResult(cardsRequest),
              requestResult(decksRequest),
              requestResult(metaRequest),
            ]).then(([existingCards, existingDecks, meta]) => {
              const actualRevision = Number(meta?.revision) || 0;
              if (actualRevision !== expectedRevision) {
                fail(new StaleWriteError("app-state", expectedRevision, actualRevision));
                return;
              }
              const usedDeckIds = new Set(existingDecks.map(deck => deck.id));
              const usedCardIds = new Set(existingCards.map(card => card.id));
              const now = Date.now();
              const deckId = createEntityId("deck", usedDeckIds);
              const deck = {
                id: deckId,
                name: String(deckInput.name || "Imported"),
                desc: String(deckInput.desc || ""),
                direction: deckInput.direction === "reverse" ? "reverse" : "forward",
                createdAt: now,
              };
              const cards = deckInput.cards.map(cardInput => ({
                id: createEntityId("card", usedCardIds),
                deckId,
                type: cardInput.type === "cloze" ? "cloze" : "basic",
                front: String(cardInput.front || ""),
                back: String(cardInput.back || ""),
                cloze: cardInput.type === "cloze" ? String(cardInput.cloze || "") : "",
                hint: String(cardInput.hint || ""),
                example: String(cardInput.example || ""),
                exampleSentence: String(cardInput.exampleSentence || ""),
                exampleTranslation: String(cardInput.exampleTranslation || ""),
                exampleTargetTerm: String(cardInput.exampleTargetTerm || ""),
                state: "new",
                step: 0,
                ease: 250,
                interval: 0,
                due: now,
                reps: 0,
                lapses: 0,
                createdAt: now,
                updatedAt: now,
                lastReview: null,
              }));
              decksStore.put(deck);
              for (const card of cards) cardsStore.put(card);
              const nextMeta = clone(meta || { key: "app" });
              nextMeta.key = "app";
              nextMeta.revision = actualRevision + 1;
              nextMeta.updatedAt = now;
              settingsStore.put(nextMeta);
              result = { deck, cards, revision: nextMeta.revision, updatedAt: now };
            }).catch(fail);
            tx.oncomplete = () => {
              if (settled) return;
              settled = true;
              resolve(result);
            };
            tx.onerror = () => fail(tx.error || new Error("IndexedDB deck append failed"));
            tx.onabort = () => fail(tx.error || new Error("IndexedDB deck append aborted"));
          });
        });
        stateKnownRevision = committed.revision;
        if (stateBaseline) {
          stateBaseline.decks.set(committed.deck.id, {
            value: clone(committed.deck),
            signature: recordSignature(committed.deck),
          });
          for (const card of committed.cards) {
            stateBaseline.cards.set(card.id, {
              value: clone(card),
              signature: recordSignature(card),
            });
          }
          const meta = clone(stateBaseline.meta.value);
          meta.revision = committed.revision;
          meta.updatedAt = committed.updatedAt;
          stateBaseline.meta = {
            value: meta,
            signature: recordSignature({ ...meta, revision: 0, updatedAt: 0 }),
          };
        }
        retryAttempt = 0;
        lastError = null;
        emitStatus("saved", { key: "app-state", appended: true });
        dispatch("lcstorage:statecommitted", {
          revision: committed.revision,
          updatedAt: committed.updatedAt,
          appended: true,
          deckId: committed.deck.id,
        });
        channel?.postMessage({
          type: "state",
          key: "app-state",
          revision: committed.revision,
          updatedAt: committed.updatedAt,
          appended: true,
        });
        return clone(committed);
      } catch (error) {
        error.storageError = true;
        lastError = error;
        emitStatus("error", { key: "app-state", appending: true, retrying: false });
        throw error;
      }
    }

    async function replaceAppSnapshot(snapshot, options = {}) {
      if (!snapshot || !snapshot.state) throw new TypeError("Invalid application snapshot");
      clearScheduledFlushes();
      emitSaving({ key: "app-state", replacing: true });
      const expectedRevision = Number.isSafeInteger(options.expectedRevision)
        ? options.expectedRevision
        : stateKnownRevision;
      try {
        if (typeof environment.__LCStorageBeforeStateWrite === "function") {
          await environment.__LCStorageBeforeStateWrite({
            replacement: clone(snapshot),
            expectedRevision,
            operation: options.operation || "restore",
          });
        }
        const committed = await withWriteLock("app-state", async () => {
          const db = await openDB();
          const names = [...Object.values(STATE_STORES), RECOVERY_STORE];
          return new Promise((resolve, reject) => {
            const tx = db.transaction(names, "readwrite");
            const cards = tx.objectStore(STATE_STORES.cards);
            const decks = tx.objectStore(STATE_STORES.decks);
            const settings = tx.objectStore(STATE_STORES.settings);
            const history = tx.objectStore(STATE_STORES.practiceHistory);
            const events = tx.objectStore(STATE_STORES.reviewEvents);
            const recovery = tx.objectStore(RECOVERY_STORE);
            const requests = {
              cards: requestResult(cards.getAll()),
              decks: requestResult(decks.getAll()),
              settings: requestResult(settings.get("settings")),
              meta: requestResult(settings.get("app")),
              history: requestResult(history.getAll()),
              events: requestResult(events.getAll()),
            };
            let result;
            let settled = false;
            const fail = error => {
              if (settled) return;
              settled = true;
              try { tx.abort(); } catch (_) {}
              reject(error || new Error("IndexedDB replacement failed"));
            };
            Promise.all(Object.values(requests)).then(values => {
              const [oldCards, oldDecks, oldSettings, oldMeta, oldHistory, oldEvents] = values;
              const actualRevision = Number(oldMeta?.revision) || 0;
              if (actualRevision !== expectedRevision) {
                fail(new StaleWriteError("app-state", expectedRevision, actualRevision));
                return;
              }
              const now = Date.now();
              const previousState = appStateFromRecords(oldCards, oldDecks, oldSettings, oldMeta, oldHistory);
              recovery.clear();
              recovery.put({
                id: "latest",
                schemaVersion: DB_VERSION,
                operation: options.operation || "restore",
                sourceRevision: actualRevision,
                createdAt: now,
                expiresAt: now + RECOVERY_TTL_MS,
                state: previousState,
                reviewEvents: oldEvents.map(clone),
                practiceDraft: oldMeta?.practiceDraft ? clone(oldMeta.practiceDraft) : null,
                aiKey: cleanRecoverySecret(oldSettings?.value?.aiKey),
              });
              for (const name of Object.values(STATE_STORES)) tx.objectStore(name).clear();
              const nextState = clone(snapshot.state);
              for (const card of nextState.cards || []) cards.put(card);
              for (const deck of nextState.decks || []) decks.put(deck);
              settings.put(settingsRecordFrom(nextState));
              for (const item of nextState.settings?.practiceHistory || []) history.put(clone(item));
              for (const event of snapshot.reviewEvents || []) events.put(clone(event));
              const nextMeta = stateMetaFrom({
                ...nextState,
                practiceDraft: snapshot.practiceDraft || null,
              }, actualRevision + 1);
              nextMeta.updatedAt = now;
              settings.put(nextMeta);
              result = {
                state: { ...nextState, revision: nextMeta.revision, updatedAt: nextMeta.updatedAt },
                reviewEvents: (snapshot.reviewEvents || []).map(clone),
                practiceDraft: snapshot.practiceDraft ? clone(snapshot.practiceDraft) : null,
              };
            }).catch(fail);
            tx.oncomplete = () => {
              if (settled) return;
              settled = true;
              resolve(result);
            };
            tx.onerror = () => fail(tx.error || new Error("IndexedDB replacement failed"));
            tx.onabort = () => fail(tx.error || new Error("IndexedDB replacement aborted"));
          });
        });
        statePending = null;
        stateFlushing = null;
        pendingReviewEvents = [];
        pending.clear();
        retryAttempt = 0;
        lastError = null;
        stateKnownRevision = committed.state.revision;
        stateBaseline = snapshotBaseline(committed.state);
        emitStatus("saved", { key: "app-state", replaced: true });
        dispatch("lcstorage:statecommitted", {
          revision: committed.state.revision,
          updatedAt: committed.state.updatedAt,
          replaced: true,
        });
        channel?.postMessage({
          type: "state",
          key: "app-state",
          revision: committed.state.revision,
          updatedAt: committed.state.updatedAt,
          replaced: true,
        });
        return clone(committed);
      } catch (error) {
        error.storageError = true;
        lastError = error;
        emitStatus("error", { key: "app-state", replaced: true, retrying: false });
        throw error;
      }
    }

    function cleanRecoverySecret(value) {
      return typeof value === "string" ? value : "";
    }

    async function getRecoverySnapshot(now = Date.now()) {
      await cleanupExpiredRecoverySnapshots(now);
      const db = await openDB();
      const record = await requestResult(
        db.transaction(RECOVERY_STORE, "readonly").objectStore(RECOVERY_STORE).get("latest")
      );
      if (!record || Number(record.expiresAt) <= now) return null;
      return {
        operation: String(record.operation || "replace"),
        createdAt: Number(record.createdAt) || 0,
        expiresAt: Number(record.expiresAt) || 0,
      };
    }

    async function restoreRecoverySnapshot(options = {}) {
      clearScheduledFlushes();
      const expectedRevision = Number.isSafeInteger(options.expectedRevision)
        ? options.expectedRevision
        : stateKnownRevision;
      emitSaving({ key: "app-state", recovering: true });
      try {
        const committed = await withWriteLock("app-state", async () => {
          const db = await openDB();
          const names = [...Object.values(STATE_STORES), RECOVERY_STORE];
          return new Promise((resolve, reject) => {
            const tx = db.transaction(names, "readwrite");
            const cards = tx.objectStore(STATE_STORES.cards);
            const decks = tx.objectStore(STATE_STORES.decks);
            const settings = tx.objectStore(STATE_STORES.settings);
            const history = tx.objectStore(STATE_STORES.practiceHistory);
            const events = tx.objectStore(STATE_STORES.reviewEvents);
            const recovery = tx.objectStore(RECOVERY_STORE);
            const metaRequest = settings.get("app");
            const recoveryRequest = recovery.get("latest");
            let result;
            let settled = false;
            const fail = error => {
              if (settled) return;
              settled = true;
              try { tx.abort(); } catch (_) {}
              reject(error || new Error("Recovery restore failed"));
            };
            Promise.all([requestResult(metaRequest), requestResult(recoveryRequest)])
              .then(([currentMeta, record]) => {
                const actualRevision = Number(currentMeta?.revision) || 0;
                if (actualRevision !== expectedRevision) {
                  fail(new StaleWriteError("app-state", expectedRevision, actualRevision));
                  return;
                }
                if (!record || Number(record.expiresAt) <= Date.now() || !record.state) {
                  const error = new Error("Recovery snapshot is unavailable or expired");
                  error.name = "RecoveryUnavailableError";
                  fail(error);
                  return;
                }
                const recoveredState = clone(record.state);
                recoveredState.settings = clone(recoveredState.settings || {});
                recoveredState.settings.aiKey = cleanRecoverySecret(record.aiKey);
                for (const name of Object.values(STATE_STORES)) tx.objectStore(name).clear();
                for (const card of recoveredState.cards || []) cards.put(clone(card));
                for (const deck of recoveredState.decks || []) decks.put(clone(deck));
                settings.put(settingsRecordFrom(recoveredState));
                for (const item of recoveredState.settings?.practiceHistory || []) history.put(clone(item));
                for (const event of record.reviewEvents || []) events.put(clone(event));
                const nextMeta = stateMetaFrom({
                  ...recoveredState,
                  practiceDraft: record.practiceDraft || null,
                }, actualRevision + 1);
                nextMeta.updatedAt = Date.now();
                settings.put(nextMeta);
                recovery.delete("latest");
                result = {
                  state: { ...recoveredState, revision: nextMeta.revision, updatedAt: nextMeta.updatedAt },
                  reviewEvents: (record.reviewEvents || []).map(clone),
                  practiceDraft: record.practiceDraft ? clone(record.practiceDraft) : null,
                };
              }).catch(fail);
            tx.oncomplete = () => {
              if (settled) return;
              settled = true;
              resolve(result);
            };
            tx.onerror = () => fail(tx.error || new Error("Recovery restore failed"));
            tx.onabort = () => fail(tx.error || new Error("Recovery restore aborted"));
          });
        });
        statePending = null;
        stateFlushing = null;
        pendingReviewEvents = [];
        pending.clear();
        retryAttempt = 0;
        lastError = null;
        stateKnownRevision = committed.state.revision;
        stateBaseline = snapshotBaseline(committed.state);
        emitStatus("saved", { key: "app-state", recovered: true });
        dispatch("lcstorage:statecommitted", {
          revision: committed.state.revision,
          updatedAt: committed.state.updatedAt,
          recovered: true,
        });
        channel?.postMessage({
          type: "state",
          key: "app-state",
          revision: committed.state.revision,
          updatedAt: committed.state.updatedAt,
          recovered: true,
        });
        return clone(committed);
      } catch (error) {
        error.storageError = true;
        lastError = error;
        emitStatus("error", { key: "app-state", recovering: true, retrying: false });
        throw error;
      }
    }

    async function writeWholeStructuredState(appState) {
      const db = await openDB();
      return withWriteLock("app-state", () => new Promise((resolve, reject) => {
        const names = Object.values(STATE_STORES);
        const tx = db.transaction(names, "readwrite");
        for (const name of names) tx.objectStore(name).clear();
        for (const card of appState.cards || []) tx.objectStore(STATE_STORES.cards).put(clone(card));
        for (const deck of appState.decks || []) tx.objectStore(STATE_STORES.decks).put(clone(deck));
        const settings = settingsRecordFrom(appState);
        tx.objectStore(STATE_STORES.settings).put(settings);
        const meta = stateMetaFrom(appState, Math.max(1, Number(appState.revision) || 0));
        meta.updatedAt = Date.now();
        tx.objectStore(STATE_STORES.settings).put(meta);
        for (const item of appState.settings?.practiceHistory || []) tx.objectStore(STATE_STORES.practiceHistory).put(clone(item));
        tx.oncomplete = () => resolve(meta);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB state transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB state transaction aborted"));
      }));
    }

    async function replaceAppState(appState) {
      clearScheduledFlushes();
      statePending = null;
      emitSaving();
      try {
        if (typeof environment.__LCStorageBeforeStateWrite === "function") {
          await environment.__LCStorageBeforeStateWrite({ replacement: clone(appState), expectedRevision: stateKnownRevision });
        }
        const meta = await writeWholeStructuredState(appState);
        stateKnownRevision = meta.revision;
        const replaced = { ...clone(appState), revision: meta.revision, updatedAt: meta.updatedAt };
        stateBaseline = snapshotBaseline(replaced);
        retryAttempt = 0;
        lastError = null;
        emitStatus("saved", { key: "app-state", replaced: true });
        dispatch("lcstorage:statecommitted", { revision: meta.revision, updatedAt: meta.updatedAt });
        channel?.postMessage({ type: "state", key: "app-state", revision: meta.revision, updatedAt: meta.updatedAt });
        return replaced;
      } catch (error) {
        error.storageError = true;
        lastError = error;
        emitStatus("error", { key: "app-state", replaced: true, retrying: false });
        throw error;
      }
    }

    async function loadAppState(legacyKey) {
      let loaded = await readStructuredState();
      if (!loaded) {
        const legacy = await rawGet(legacyKey);
        if (!legacy) return undefined;
        const meta = await writeWholeStructuredState(legacy);
        loaded = { ...legacy, revision: meta.revision, updatedAt: meta.updatedAt };
      }
      stateBaseline = snapshotBaseline(loaded);
      return clone(loaded);
    }

    async function initializeAppState(legacyKey, appState) {
      const existing = await loadAppState(legacyKey);
      if (existing) return existing;
      const meta = await writeWholeStructuredState(appState);
      const initialized = { ...clone(appState), revision: meta.revision, updatedAt: meta.updatedAt };
      stateBaseline = snapshotBaseline(initialized);
      channel?.postMessage({ type: "state", key: legacyKey, revision: meta.revision, updatedAt: meta.updatedAt });
      return initialized;
    }

    function mergeRecordChanges(left = { puts: [], deletes: [] }, right = { puts: [], deletes: [] }) {
      const puts = new Map((left.puts || []).map(value => [value.id, value]));
      const deletes = new Set(left.deletes || []);
      for (const id of right.deletes || []) {
        puts.delete(id);
        deletes.add(id);
      }
      for (const value of right.puts || []) {
        if (!value?.id) continue;
        deletes.delete(value.id);
        puts.set(value.id, clone(value));
      }
      return { puts: [...puts.values()], deletes: [...deletes] };
    }

    function mergeReviewEventChanges(left = { puts: [], deleteCardIds: [], deleteEventIds: [] }, right = { puts: [], deleteCardIds: [], deleteEventIds: [] }) {
      const deleteCardIds = new Set([...(left.deleteCardIds || []), ...(right.deleteCardIds || [])]);
      const deleteEventIds = new Set([...(left.deleteEventIds || []), ...(right.deleteEventIds || [])]);
      const puts = new Map();
      for (const event of [...(left.puts || []), ...(right.puts || [])]) {
        if (!event?.id || deleteCardIds.has(event.cardId) || deleteEventIds.has(event.id)) continue;
        puts.set(event.id, clone(event));
      }
      return {
        puts: [...puts.values()],
        deleteCardIds: [...deleteCardIds],
        deleteEventIds: [...deleteEventIds],
      };
    }

    function mergeStateDeltas(left, right) {
      if (!left) return right;
      if (!right) return left;
      return {
        cards: mergeRecordChanges(left.cards, right.cards),
        decks: mergeRecordChanges(left.decks, right.decks),
        practiceHistory: mergeRecordChanges(left.practiceHistory, right.practiceHistory),
        settings: right.settings || left.settings,
        meta: right.meta || left.meta,
        reviewEvents: mergeReviewEventChanges(left.reviewEvents, right.reviewEvents),
      };
    }

    function buildExplicitStateDelta(appState, changes) {
      return {
        cards: {
          puts: (changes.cards?.puts || []).map(clone),
          deletes: [...(changes.cards?.deletes || [])],
        },
        decks: {
          puts: (changes.decks?.puts || []).map(clone),
          deletes: [...(changes.decks?.deletes || [])],
        },
        practiceHistory: {
          puts: (changes.practiceHistory?.puts || []).map(clone),
          deletes: [...(changes.practiceHistory?.deletes || [])],
        },
        settings: changes.settings ? settingsRecordFrom(appState) : null,
        meta: changes.meta ? stateMetaFrom(appState) : null,
        reviewEvents: {
          puts: pendingReviewEvents.splice(0),
          deleteCardIds: [...(changes.reviewEvents?.deleteCardIds || [])],
          deleteEventIds: [...(changes.reviewEvents?.deleteEventIds || [])],
        },
      };
    }

    function setAppState(appState, changes = null) {
      const delta = changes
        ? buildExplicitStateDelta(appState, changes)
        : buildStateDelta(appState);
      if (deltaIsEmpty(delta)) return;
      statePending = mergeStateDeltas(statePending, delta);
      emitSaving({ key: "app-state" });
      scheduleFlush();
    }

    function appendReviewEvent(event) {
      if (!event?.id) return;
      pendingReviewEvents.push(clone(event));
      emitSaving({ key: "review-events" });
      scheduleFlush();
    }

    function deleteReviewEventsForCards(cardIds) {
      const ids = new Set(Array.from(cardIds || []).filter(id => typeof id === "string" && id));
      if (ids.size === 0) return;
      pendingReviewEvents = pendingReviewEvents.filter(event => !ids.has(event.cardId));
      const deletion = {
        cards: { puts: [], deletes: [] },
        decks: { puts: [], deletes: [] },
        practiceHistory: { puts: [], deletes: [] },
        settings: null,
        meta: null,
        reviewEvents: { puts: [], deleteCardIds: [...ids], deleteEventIds: [] },
      };
      statePending = mergeStateDeltas(statePending, deletion);
      emitSaving({ key: "review-events" });
      scheduleFlush();
    }

    // Analysis fix #4: remove specific recorded review events (undo answer).
    function deleteReviewEventsByIds(eventIds) {
      const ids = new Set(Array.from(eventIds || []).filter(id => typeof id === "string" && id));
      if (ids.size === 0) return;
      pendingReviewEvents = pendingReviewEvents.filter(event => !ids.has(event.id));
      const deletion = {
        cards: { puts: [], deletes: [] },
        decks: { puts: [], deletes: [] },
        practiceHistory: { puts: [], deletes: [] },
        settings: null,
        meta: null,
        reviewEvents: { puts: [], deleteCardIds: [], deleteEventIds: [...ids] },
      };
      statePending = mergeStateDeltas(statePending, deletion);
      emitSaving({ key: "review-events" });
      scheduleFlush();
    }

    async function getReviewEventsForCards(cardIds) {
      const ids = [...new Set(Array.from(cardIds || []).filter(id => typeof id === "string" && id))];
      if (ids.length === 0) return [];
      await flush();
      const db = await openDB();
      const tx = db.transaction(STATE_STORES.reviewEvents, "readonly");
      const index = tx.objectStore(STATE_STORES.reviewEvents).index("cardId");
      const groups = await Promise.all(ids.map(id => requestResult(index.getAll(id))));
      return groups.flat().map(clone);
    }

    async function commitStateDelta(delta) {
      const db = await openDB();
      return withWriteLock("app-state", async () => {
        if (typeof environment.__LCStorageBeforeStateWrite === "function") {
          await environment.__LCStorageBeforeStateWrite({ delta: clone(delta), expectedRevision: stateKnownRevision });
        }
        return new Promise((resolve, reject) => {
          const names = Object.values(STATE_STORES);
          const tx = db.transaction(names, "readwrite");
          const cards = tx.objectStore(STATE_STORES.cards);
          const decks = tx.objectStore(STATE_STORES.decks);
          const settings = tx.objectStore(STATE_STORES.settings);
          const practice = tx.objectStore(STATE_STORES.practiceHistory);
          const events = tx.objectStore(STATE_STORES.reviewEvents);
          const metaReq = settings.get("app");
          let committedMeta;
          let settled = false;
          const fail = error => {
            if (settled) return;
            settled = true;
            reject(error || new Error("IndexedDB state transaction failed"));
          };
          metaReq.onerror = () => fail(metaReq.error);
          metaReq.onsuccess = () => {
            const actualRevision = Number(metaReq.result?.revision) || 0;
            if (actualRevision !== stateKnownRevision) {
              fail(new StaleWriteError("app-state", stateKnownRevision, actualRevision));
              try { tx.abort(); } catch (_) {}
              return;
            }
            for (const id of delta.cards.deletes) cards.delete(id);
            for (const value of delta.cards.puts) cards.put(clone(value));
            for (const id of delta.decks.deletes) decks.delete(id);
            for (const value of delta.decks.puts) decks.put(clone(value));
            for (const id of delta.practiceHistory.deletes) practice.delete(id);
            for (const value of delta.practiceHistory.puts) practice.put(clone(value));
            for (const cardId of delta.reviewEvents.deleteCardIds) {
              const request = events.index("cardId").openKeyCursor(cardId);
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                events.delete(cursor.primaryKey);
                cursor.continue();
              };
            }
            for (const eventId of delta.reviewEvents.deleteEventIds || []) events.delete(eventId);
            for (const event of delta.reviewEvents.puts) events.put(clone(event));
            if (delta.settings) settings.put(clone(delta.settings));
            committedMeta = clone(delta.meta || metaReq.result || { key: "app" });
            committedMeta.key = "app";
            committedMeta.revision = actualRevision + 1;
            committedMeta.updatedAt = Date.now();
            settings.put(committedMeta);
          };
          tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            resolve(committedMeta);
          };
          tx.onerror = () => fail(tx.error || new Error("IndexedDB state transaction failed"));
          tx.onabort = () => fail(tx.error || new Error("IndexedDB state transaction aborted"));
        });
      });
    }

    function flushAppState() {
      if (stateFlushing) return stateFlushing;
      if (!statePending && pendingReviewEvents.length === 0) return Promise.resolve();
      const delta = statePending || buildStateDelta({ cards: [], decks: [], settings: {}, history: {}, streak: {} });
      statePending = null;
      stateFlushing = (async () => {
        try {
          const meta = await commitStateDelta(delta);
          applyDeltaToBaseline(delta, meta);
          retryAttempt = 0;
          lastError = null;
          dispatch("lcstorage:statecommitted", { revision: meta.revision, updatedAt: meta.updatedAt });
          channel?.postMessage({ type: "state", key: "app-state", revision: meta.revision, updatedAt: meta.updatedAt });
          if (!statePending && pendingReviewEvents.length === 0 && pending.size === 0 && !flushing) {
            emitStatus("saved", { key: "app-state" });
          }
        } catch (error) {
          error.storageError = true;
          lastError = error;
          statePending = mergeStateDeltas(delta, statePending);
          const retrying = !(error instanceof StaleWriteError) && error.name !== "StaleWriteError" && isRetryableStorageError(error);
          emitStatus("error", { key: "app-state", retrying });
          if (retrying) scheduleRetry();
          throw error;
        } finally {
          stateFlushing = null;
        }
      })();
      return stateFlushing;
    }

    function discardAppState() {
      statePending = null;
      pendingReviewEvents = [];
      if (!flushing && !stateFlushing && pending.size === 0) emitStatus("saved", { discarded: true, key: "app-state" });
    }

    function hasPendingAppState() {
      return !!statePending || !!stateFlushing || pendingReviewEvents.length > 0;
    }

    function clearScheduledFlushes() {
      if (flushTimer) clearTimer(flushTimer);
      if (retryTimer) clearTimer(retryTimer);
      flushTimer = null;
      retryTimer = null;
    }

    function scheduleFlush(delay = 50) {
      if (flushTimer || flushing || stateFlushing) return;
      if (retryTimer) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      flushTimer = setTimer(() => {
        flushTimer = null;
        const task = pending.size > 0 ? doFlush() : flushAppState();
        task.catch(() => {});
      }, delay);
    }

    function scheduleRetry() {
      if (retryTimer || (pending.size === 0 && !statePending && pendingReviewEvents.length === 0)) return;
      const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.min(retryAttempt, 8)));
      retryAttempt += 1;
      retryTimer = setTimer(() => {
        retryTimer = null;
        const task = pending.size > 0 ? doFlush() : flushAppState();
        task.catch(() => {});
      }, delay);
    }

    function restoreSnapshot(entries, startIndex) {
      for (let index = startIndex; index < entries.length; index++) {
        const [key, snapshot] = entries[index];
        if (!pending.has(key)) pending.set(key, snapshot);
      }
    }

    async function acceptExternalValue(key, dirty, message = {}) {
      if (dirty) pending.delete(key);
      const value = message.type === "delete" ? undefined : await rawGet(key);
      knownRevisions.set(key, revisionOf(value));
      lastError = null;
      retryAttempt = 0;
      if (pending.size === 0 && !flushing) emitStatus("saved", { key, external: true, conflict: dirty });
      dispatch("lcstorage:externalchange", {
        key,
        dirty,
        conflict: dirty,
        value: clone(value),
      });
      return value;
    }

    async function noteExternalConflict(key, message = {}) {
      const value = message.type === "delete" ? undefined : await rawGet(key);
      knownRevisions.set(key, revisionOf(value));
      dispatch("lcstorage:externalchange", {
        key,
        dirty: true,
        conflict: true,
        value: clone(value),
      });
      return value;
    }

    function doFlush() {
      if (flushing) return flushing;
      if (pending.size === 0) return Promise.resolve();

      const entries = [...pending.entries()];
      pending.clear();
      emitSaving();

      const task = (async () => {
        for (let index = 0; index < entries.length; index++) {
          const [key, snapshot] = entries[index];
          const value = snapshot.value;
          const expectedRevision = snapshot.expectedRevision;
          flushingKeys.add(key);
          try {
            const written = await withWriteLock(key, () => compareAndSet(key, value, expectedRevision));
            knownRevisions.set(key, written.revision);
            retryAttempt = 0;
            dispatch("lcstorage:committed", { key, value: clone(written) });
            channel?.postMessage({ type: "write", key, revision: written.revision, updatedAt: written.updatedAt });
          } catch (error) {
            error.storageError = true;
            lastError = error;
            const stale = error instanceof StaleWriteError || error.name === "StaleWriteError";
            const retrying = !stale && isRetryableStorageError(error);
            if (stale) {
              restoreSnapshot(entries, index + 1);
              try { await noteExternalConflict(key, { type: "write" }); } catch (_) {}
            } else {
              restoreSnapshot(entries, index);
              if (retrying) scheduleRetry();
            }
            emitStatus("error", { key, retrying });
            throw error;
          } finally {
            flushingKeys.delete(key);
          }
        }
        lastError = null;
      })();

      flushing = task.finally(() => {
        flushing = null;
        if (lastError) return;
        if (pending.size > 0) scheduleFlush();
        else emitStatus("saved");
      });
      return flushing;
    }

    function set(key, value) {
      const baseRevision = knownRevisions.has(key)
        ? knownRevisions.get(key)
        : revisionOf(value);
      pending.set(key, { value: clone(value), expectedRevision: baseRevision });
      emitSaving({ key });
      scheduleFlush();
    }

    async function get(key) {
      if (pending.has(key)) return clone(pending.get(key).value);
      const value = await rawGet(key);
      knownRevisions.set(key, revisionOf(value));
      return clone(value);
    }

    async function reload(key) {
      discard(key);
      const value = await rawGet(key);
      knownRevisions.set(key, revisionOf(value));
      return clone(value);
    }

    function discard(key) {
      if (key === undefined) pending.clear();
      else pending.delete(key);
      if (pending.size === 0) {
        clearScheduledFlushes();
        retryAttempt = 0;
        lastError = null;
        if (!flushing) emitStatus("saved", { discarded: true, key });
      }
    }

    async function flush() {
      if (flushTimer) {
        clearTimer(flushTimer);
        flushTimer = null;
      }
      if (retryTimer) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      while (flushing || pending.size > 0 || stateFlushing || statePending || pendingReviewEvents.length > 0) {
        if (flushing) await flushing;
        else if (pending.size > 0) await doFlush();
        else if (stateFlushing) await stateFlushing;
        else await flushAppState();
      }
      if (!lastError) emitStatus("saved");
    }

    async function initialize(key, value) {
      try {
        const result = await withWriteLock(key, async () => {
          const existing = await rawGet(key);
          if (existing !== undefined) return { value: existing, created: false };
          const written = await compareAndSet(key, value, 0);
          return { value: written, created: true };
        });
        knownRevisions.set(key, revisionOf(result.value));
        if (result.created) {
          dispatch("lcstorage:committed", { key, value: clone(result.value) });
          channel?.postMessage({ type: "write", key, revision: result.value.revision, updatedAt: result.value.updatedAt });
        }
        return clone(result.value);
      } catch (error) {
        if (!(error instanceof StaleWriteError) && error.name !== "StaleWriteError") throw error;
        const winner = await rawGet(key);
        if (winner === undefined) throw error;
        knownRevisions.set(key, revisionOf(winner));
        return clone(winner);
      }
    }

    async function rawDelete(key) {
      const db = await openDB();
      await withWriteLock(key, () => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      }));
      discard(key);
      knownRevisions.set(key, 0);
      channel?.postMessage({ type: "delete", key });
    }

    async function migrateFromLocalStorage(key) {
      try {
        const existing = await rawGet(key);
        if (existing !== undefined) {
          knownRevisions.set(key, revisionOf(existing));
          return false;
        }
        const raw = local?.getItem(key);
        if (!raw) return false;
        const value = JSON.parse(raw);
        const result = await initialize(key, value);
        knownRevisions.set(key, revisionOf(result));
        local.removeItem(key);
        return true;
      } catch (error) {
        console.warn("Migration failed", error);
        return false;
      }
    }

    async function syncExternal(message) {
      if (!message) return;
      if (message.type === "state") {
        const dirty = !!statePending || !!stateFlushing || pendingReviewEvents.length > 0;
        if (dirty) {
          dispatch("lcstorage:stateexternalchange", { dirty: true, conflict: true });
          return;
        }
        try {
          const value = await readStructuredState();
          if (!value) return;
          stateBaseline = snapshotBaseline(value);
          dispatch("lcstorage:stateexternalchange", { dirty: false, conflict: false, value: clone(value) });
        } catch (error) {
          error.storageError = true;
          lastError = error;
          emitStatus("error", { key: "app-state", external: true });
        }
        return;
      }
      if (!message.key) return;
      const key = message.key;
      const dirty = pending.has(key) || flushingKeys.has(key);
      try {
        await acceptExternalValue(key, dirty, message);
      } catch (error) {
        error.storageError = true;
        lastError = error;
        emitStatus("error", { key, external: true });
      }
    }

    if (channel) channel.onmessage = event => { syncExternal(event.data); };

    async function ready() {
      await openDB();
      await cleanupExpiredRecoverySnapshots();
    }

    const api = {
      ready,
      get,
      reload,
      set,
      flush,
      discard,
      discardPending: discard,
      initialize,
      resolveConflict: reload,
      delete: rawDelete,
      migrateFromLocalStorage,
      loadAppState,
      initializeAppState,
      replaceAppState,
      setAppState,
      appendReviewEvent,
      deleteReviewEventsForCards,
      deleteReviewEventsByIds,
      getReviewEventsForCards,
      readAppSnapshot,
      replaceAppSnapshot,
      appendDeck,
      getLocalMetadata,
      setLocalMetadata,
      cleanupExpiredRecoverySnapshots,
      getRecoverySnapshot,
      restoreRecoverySnapshot,
      RECOVERY_TTL_MS,
      flushAppState,
      discardAppState,
      hasPendingAppState,
      getStatus,
      StaleWriteError,
      close() {
        clearScheduledFlushes();
        channel?.close();
      },
    };
    return api;
  }

  root.createLCStorage = createLCStorage;
  root.LCStorage = createLCStorage(root);

  const flushBeforeLeaving = () => { root.LCStorage.flush().catch(() => {}); };
  if (typeof root.addEventListener === "function") {
    root.addEventListener("beforeunload", flushBeforeLeaving);
    root.addEventListener("pagehide", flushBeforeLeaving);
  }
})(typeof window !== "undefined" ? window : globalThis);