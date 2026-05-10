import type { SavedStationConfig } from "@/lib/types";

import { canUseIndexedDb, CONFIG_STORE_NAME, runLocalStoreTransaction } from "@/lib/local-db";

const CONFIG_LIMIT = 30;

function sortRecentFirst(configs: SavedStationConfig[]) {
  return configs.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function sanitizeConfig(config: SavedStationConfig): SavedStationConfig {
  return {
    id: config.id,
    name: config.name.trim() || "未命名配置",
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey?.trim() || undefined,
    model: config.model.trim(),
    textRewriteModel: config.textRewriteModel.trim(),
    quality: config.quality,
    size: config.size,
    customWidth: config.customWidth,
    customHeight: config.customHeight,
    n: config.n,
    outputFormat: config.outputFormat,
    background: config.background,
    styleHint: config.styleHint.trim(),
    seed: config.seed.trim(),
    useStreaming: config.useStreaming,
    partialImages: config.partialImages,
    promptStyle: config.promptStyle,
    useAiRewrite: config.useAiRewrite,
  };
}

async function trimConfigs(limit: number) {
  const configs = await loadSavedConfigs();
  const keepIds = new Set(configs.slice(0, limit).map((config) => config.id));
  const staleConfigs = configs.filter((config) => !keepIds.has(config.id));
  await Promise.all(staleConfigs.map((config) => deleteSavedConfig(config.id)));
}

export async function loadSavedConfigs(): Promise<SavedStationConfig[]> {
  if (!canUseIndexedDb()) return [];

  const configs =
    (await runLocalStoreTransaction<SavedStationConfig[]>(
      CONFIG_STORE_NAME,
      "readonly",
      (store) => store.getAll(),
    )) ?? [];

  return sortRecentFirst(configs);
}

export async function saveStationConfig(config: SavedStationConfig) {
  if (!canUseIndexedDb()) return;

  await runLocalStoreTransaction<IDBValidKey>(
    CONFIG_STORE_NAME,
    "readwrite",
    (store) => store.put(sanitizeConfig(config)),
  );
  await trimConfigs(CONFIG_LIMIT);
}

export async function deleteSavedConfig(id: string) {
  if (!canUseIndexedDb()) return;

  await runLocalStoreTransaction<undefined>(
    CONFIG_STORE_NAME,
    "readwrite",
    (store) => store.delete(id),
  );
}
