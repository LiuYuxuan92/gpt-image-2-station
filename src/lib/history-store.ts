import type { HistoryTask } from "@/lib/types";

const DB_NAME = "gpt-image-2-station";
const STORE_NAME = "tasks";
const DB_VERSION = 1;
const DEFAULT_HISTORY_LIMIT = 50;

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window && Boolean(window.indexedDB);
}

function openHistoryDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function closeDb(db: IDBDatabase | null) {
  db?.close();
}

function runStoreTransaction<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openHistoryDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) {
          resolve(undefined);
          return;
        }

        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
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

function sortNewestFirst(tasks: HistoryTask[]) {
  return tasks.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function sanitizeHistoryTask(task: HistoryTask): HistoryTask {
  const request = task.request;
  const sanitizedRequest: HistoryTask["request"] = {
    baseUrl: request.baseUrl,
    model: request.model,
    prompt: request.prompt,
    promptSource: request.promptSource,
    negativePrompt: request.negativePrompt,
    mode: request.mode,
    quality: request.quality,
    size: request.size,
    n: request.n,
    outputFormat: request.outputFormat,
    background: request.background,
    styleHint: request.styleHint,
    seed: request.seed,
    stream: request.stream,
    partialImages: request.partialImages,
    hasReferenceImage: request.hasReferenceImage,
  };

  if (task.status === "error") {
    return {
      id: task.id,
      createdAt: task.createdAt,
      label: task.label,
      status: "error",
      durationMs: task.durationMs,
      errorMessage: task.errorMessage || "生成失败。",
      request: sanitizedRequest,
    };
  }

  return {
    id: task.id,
    createdAt: task.createdAt,
    label: task.label,
    status: task.status ?? "success",
    durationMs: task.durationMs,
    errorMessage: task.errorMessage,
    request: sanitizedRequest,
    response: task.response,
  };
}

async function trimHistoryTasks(limit: number) {
  const tasks = await loadHistoryTasks(Number.isFinite(limit) ? limit : DEFAULT_HISTORY_LIMIT);
  const keepIds = new Set(tasks.map((task) => task.id));
  const allTasks =
    (await runStoreTransaction<HistoryTask[]>("readonly", (store) => store.getAll())) ?? [];
  const staleTasks = allTasks.filter((task) => !keepIds.has(task.id));

  await Promise.all(staleTasks.map((task) => deleteHistoryTask(task.id)));
}

export async function loadHistoryTasks(limit = DEFAULT_HISTORY_LIMIT): Promise<HistoryTask[]> {
  if (!canUseIndexedDb()) return [];

  const tasks =
    (await runStoreTransaction<HistoryTask[]>("readonly", (store) => store.getAll())) ?? [];
  const safeLimit = Math.max(0, limit);
  return sortNewestFirst(tasks).slice(0, safeLimit);
}

export async function saveHistoryTask(task: HistoryTask, limit = DEFAULT_HISTORY_LIMIT) {
  if (!canUseIndexedDb()) return;

  await runStoreTransaction<IDBValidKey>("readwrite", (store) => store.put(sanitizeHistoryTask(task)));
  await trimHistoryTasks(Math.max(0, limit));
}

export async function deleteHistoryTask(id: string) {
  if (!canUseIndexedDb()) return;

  await runStoreTransaction<undefined>("readwrite", (store) => store.delete(id));
}

export async function clearHistoryTasks() {
  if (!canUseIndexedDb()) return;

  await runStoreTransaction<undefined>("readwrite", (store) => store.clear());
}
