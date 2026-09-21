const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");

async function createStorageHarness(indexedDB = new IDBFactory()) {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "https://lingo.test/" });
  const connections = new Set();
  const environment = {
    window,
    indexedDB: {
      open(...args) {
        const request = indexedDB.open(...args);
        request.addEventListener("success", () => connections.add(request.result));
        return request;
      },
    },
    navigator: {}, localStorage: window.localStorage, CustomEvent: window.CustomEvent,
    structuredClone, setTimeout, clearTimeout, retryBaseMs: 10,
  };
  const context = vm.createContext({ window: environment, console, structuredClone, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "storage.js"), "utf8"), context, { filename: "storage.js" });
  const storage = environment.LCStorage;
  await storage.ready();
  return {
    storage, environment, window, indexedDB,
    async close() {
      storage.discardAppState();
      storage.discard();
      storage.close();
      for (const connection of connections) connection.close();
      await window.happyDOM.close();
    },
  };
}

module.exports = { createStorageHarness };
