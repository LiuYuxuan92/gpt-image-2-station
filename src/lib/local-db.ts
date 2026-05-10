export const LOCAL_DB_NAME = "gpt-image-2-station";
export const LOCAL_DB_VERSION = 2;
export const HISTORY_STORE_NAME = "tasks";
export const CONFIG_STORE_NAME = "saved-configs";

export function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window && Boolean(window.indexedDB);
}

function ensureStores(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
    const store = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: "id" });
    store.createIndex("createdAt", "createdAt");
  }

  if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
    const store = db.createObjectStore(CONFIG_STORE_NAME, { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt");
    store.createIndex("createdAt", "createdAt");
  }
}

export function openLocalDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);

    request.onupgradeneeded = () => {
      ensureStores(request.result);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function closeDb(db: IDBDatabase | null) {
  db?.close();
}

export function runLocalStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openLocalDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) {
          resolve(undefined);
          return;
        }

        if (!db.objectStoreNames.contains(storeName)) {
          closeDb(db);
          reject(new Error(`IndexedDB store not found: ${storeName}`));
          return;
        }

        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = callback(store);
        let result: T | undefined;

        if (request) {
          request.onsuccess = () => {
            result = request.result;
          };
          request.onerror = () => {
            reject(request.error);
          };
        }

        transaction.oncomplete = () => {
          closeDb(db);
          resolve(result);
        };
        transaction.onerror = () => {
          closeDb(db);
          reject(transaction.error);
        };
        transaction.onabort = () => {
          closeDb(db);
          reject(transaction.error);
        };
      }),
  );
}
