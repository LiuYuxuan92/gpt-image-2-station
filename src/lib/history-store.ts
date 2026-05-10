import type { HistoryTask } from "@/lib/types";

import { canUseIndexedDb, HISTORY_STORE_NAME, runLocalStoreTransaction } from "@/lib/local-db";

const DEFAULT_HISTORY_LIMIT = 50;

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
    (await runLocalStoreTransaction<HistoryTask[]>(
      HISTORY_STORE_NAME,
      "readonly",
      (store) => store.getAll(),
    )) ?? [];
  const staleTasks = allTasks.filter((task) => !keepIds.has(task.id));

  await Promise.all(staleTasks.map((task) => deleteHistoryTask(task.id)));
}

export async function loadHistoryTasks(limit = DEFAULT_HISTORY_LIMIT): Promise<HistoryTask[]> {
  if (!canUseIndexedDb()) return [];

  const tasks =
    (await runLocalStoreTransaction<HistoryTask[]>(
      HISTORY_STORE_NAME,
      "readonly",
      (store) => store.getAll(),
    )) ?? [];
  const safeLimit = Math.max(0, limit);
  return sortNewestFirst(tasks).slice(0, safeLimit);
}

export async function saveHistoryTask(task: HistoryTask, limit = DEFAULT_HISTORY_LIMIT) {
  if (!canUseIndexedDb()) return;

  await runLocalStoreTransaction<IDBValidKey>(
    HISTORY_STORE_NAME,
    "readwrite",
    (store) => store.put(sanitizeHistoryTask(task)),
  );
  await trimHistoryTasks(Math.max(0, limit));
}

export async function deleteHistoryTask(id: string) {
  if (!canUseIndexedDb()) return;

  await runLocalStoreTransaction<undefined>(
    HISTORY_STORE_NAME,
    "readwrite",
    (store) => store.delete(id),
  );
}

export async function clearHistoryTasks() {
  if (!canUseIndexedDb()) return;

  await runLocalStoreTransaction<undefined>(
    HISTORY_STORE_NAME,
    "readwrite",
    (store) => store.clear(),
  );
}
