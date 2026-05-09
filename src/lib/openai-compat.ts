import type {
  GenerateRequest,
  GenerateResponse,
  GeneratedImage,
  ProbeResult,
  ReferenceImageInput,
} from "@/lib/types";

const REQUEST_TIMEOUT_MS = 25_000;
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
];
const ALLOW_PRIVATE_BASE_URLS = process.env.ALLOW_PRIVATE_BASE_URLS === "true";

const KNOWN_IMAGE_MODEL_HINTS = ["gpt-image-2", "image", "flux", "sdxl"];
const KNOWN_TEXT_MODEL_HINTS = ["gpt-4", "gpt-5", "claude", "gemini", "qwen", "deepseek"];

export class UserFacingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly debug?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; debug?: unknown }) {
    super(message);
    this.name = "UserFacingError";
    this.code = options?.code ?? "bad_request";
    this.status = options?.status ?? 400;
    this.debug = options?.debug;
  }
}

export function normalizeBaseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserFacingError("Base URL 格式无效，请输入完整的 http 或 https 地址。", {
      code: "invalid_base_url",
    });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UserFacingError("仅支持 http 或 https 协议。", {
      code: "invalid_protocol",
    });
  }

  const hostname = url.hostname.trim();
  if (!ALLOW_PRIVATE_BASE_URLS && PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new UserFacingError(
      "当前版本默认拒绝访问本机或内网地址，以降低 SSRF 风险。若为自部署内网调试，可在服务端设置 ALLOW_PRIVATE_BASE_URLS=true 后重试。",
      {
        code: "private_host_blocked",
        status: 403,
      },
    );
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/v1") ? normalizedPath : `${normalizedPath || ""}/v1`;

  return url.toString().replace(/\/$/, "");
}

function createAbortController() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

async function compatFetch(
  url: string,
  apiKey: string,
  init?: RequestInit & { skipJsonContentType?: boolean },
) {
  const { signal, cleanup } = createAbortController();
  try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    if (!init?.skipJsonContentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return await fetch(url, {
      ...init,
      headers,
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new UserFacingError("请求超时，目标接口未在限定时间内响应。", {
        code: "upstream_timeout",
        status: 504,
      });
    }
    throw new UserFacingError("无法连接目标接口，请检查 Base URL、网络连通性或代理站状态。", {
      code: "network_error",
      status: 502,
      debug: error,
    });
  } finally {
    cleanup();
  }
}

function pickModelsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) return payload;
  const maybeData = (payload as { data?: unknown }).data;
  return Array.isArray(maybeData) ? maybeData : [];
}

function modelIdOf(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const raw = (value as { id?: unknown; model?: unknown }).id ?? (value as { model?: unknown }).model;
  return typeof raw === "string" ? raw : null;
}

function looksLikeImageModel(modelId: string) {
  const value = modelId.toLowerCase();
  return KNOWN_IMAGE_MODEL_HINTS.some((hint) => value.includes(hint));
}

function looksLikeTextModel(modelId: string) {
  const value = modelId.toLowerCase();
  return KNOWN_TEXT_MODEL_HINTS.some((hint) => value.includes(hint));
}

export async function probeOpenAICompat(input: {
  baseUrl: string;
  apiKey: string;
  manualModel?: string;
}): Promise<ProbeResult> {
  if (!input.apiKey.trim()) {
    throw new UserFacingError("API Key 不能为空。", {
      code: "missing_api_key",
    });
  }

  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const probeStrategy: string[] = [];
  const warnings: string[] = [];

  let modelsEndpointWorking = false;
  let authLikelyValid = false;
  let reachable = false;
  let modelIds: string[] = [];

  try {
    probeStrategy.push("GET /models");
    const response = await compatFetch(`${normalizedBaseUrl}/models`, input.apiKey);
    reachable = true;

    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError("API Key 无效，或目标接口拒绝了认证请求。", {
        code: "auth_failed",
        status: response.status,
      });
    }

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    const models = pickModelsPayload(payload);
    modelIds = models.map(modelIdOf).filter((value): value is string => Boolean(value));
    modelsEndpointWorking = response.ok && modelIds.length >= 0;
    authLikelyValid = response.ok;
  } catch (error) {
    if (error instanceof UserFacingError) {
      if (error.code === "auth_failed") throw error;
      warnings.push(error.message);
    } else {
      warnings.push("模型列表探测失败，后续将依赖手动模型名或直接尝试调用。");
    }
  }

  const dedupedModelIds = [...new Set(modelIds)];
  const detectedImageModels = dedupedModelIds.filter(looksLikeImageModel);
  const detectedTextModels = dedupedModelIds.filter(looksLikeTextModel);
  const manualModel = input.manualModel?.trim();

  const recommendedModel =
    manualModel || detectedImageModels.find((id) => id.includes("gpt-image-2")) || detectedImageModels[0] || "gpt-image-2";

  const imageModelDetected = detectedImageModels.some((id) => id.includes("gpt-image-2"));

  if (!modelsEndpointWorking) {
    warnings.push("模型列表不可用；如目标站实际支持生图，可通过手动模型名继续测试。");
  }

  if (!imageModelDetected && !manualModel) {
    warnings.push("未在模型列表中明确发现 gpt-image-2；如果你的服务使用别名，请手动覆盖模型名。");
  }

  return {
    ok: true,
    normalizedBaseUrl,
    reachable: reachable || modelsEndpointWorking,
    authLikelyValid: authLikelyValid || Boolean(manualModel),
    modelsEndpointWorking,
    imageModelDetected,
    recommendedModel,
    detectedImageModels,
    detectedTextModels,
    capabilities: {
      imageGeneration: {
        supported: true,
        note: modelsEndpointWorking
          ? "已完成基础探测，可直接尝试文生图。"
          : "模型列表不可用，但可继续用手动模型名直接调用。",
      },
      imageEditing: {
        supported: Boolean(manualModel || detectedImageModels.length),
        note: "MVP 按 OpenAI 风格 multipart 编辑接口尝试；是否成功取决于目标站兼容程度。",
      },
      textRewrite: {
        supported: detectedTextModels.length > 0,
        note: detectedTextModels.length
          ? `可优先尝试 ${detectedTextModels[0]} 进行 AI 提示词改写。`
          : "未探测到明确文本模型，将回退到规则模板优化。",
      },
    },
    warnings,
    debug: {
      modelCount: dedupedModelIds.length,
      probeStrategy,
      rawModelIdsSample: dedupedModelIds.slice(0, 12),
    },
  };
}

export async function rewritePromptWithTextModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  instruction: string;
}) {
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const endpoints = [
    `${normalizedBaseUrl}/responses`,
    `${normalizedBaseUrl}/chat/completions`,
  ];
  const warnings: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const body =
        endpoint.endsWith("/responses")
          ? {
              model: input.model,
              input: input.instruction,
            }
          : {
              model: input.model,
              messages: [{ role: "user", content: input.instruction }],
            };

      const response = await compatFetch(endpoint, input.apiKey, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        warnings.push(`${endpoint.split("/").slice(-1)[0]} returned ${response.status}`);
        continue;
      }

      const payload = (await response.json()) as unknown;
      const text = extractTextFromTextResponse(payload);
      if (text) {
        return { text, warnings };
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Unknown AI rewrite error");
    }
  }

  throw new UserFacingError("AI 提示词改写不可用，已回退到规则模板优化。", {
    code: "rewrite_unavailable",
    status: 422,
    debug: warnings,
  });
}

function extractTextFromTextResponse(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as
      | { message?: { content?: unknown }; text?: unknown }
      | undefined;
    const messageContent = first?.message?.content;
    if (typeof messageContent === "string" && messageContent.trim()) return messageContent.trim();
    if (Array.isArray(messageContent)) {
      const firstText = messageContent.find(
        (item) =>
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof (item as { text?: unknown }).text === "string",
      ) as { text?: string } | undefined;
      if (firstText?.text?.trim()) return firstText.text.trim();
    }
    if (typeof first?.text === "string" && first.text.trim()) return first.text.trim();
  }

  const output = (payload as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item && typeof item === "object" ? (item as { content?: unknown }).content : null;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
            const text = (part as { text: string }).text.trim();
            if (text) return text;
          }
        }
      }
    }
  }

  return null;
}

function decodeDataUrl(input: ReferenceImageInput) {
  const match = input.dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new UserFacingError("上传图片编码无效，请重新选择图片。", {
      code: "invalid_image_data",
    });
  }
  return Buffer.from(match[2], "base64");
}

async function fetchRemoteImageAsDataUrl(url: string) {
  const { signal, cleanup } = createAbortController();
  try {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new UserFacingError("图片结果返回了 URL，但服务端拉取该图片失败。", {
        code: "image_fetch_failed",
        status: 502,
      });
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("图片结果返回了 URL，但服务端无法抓取该图片内容。", {
      code: "image_fetch_failed",
      status: 502,
      debug: error,
    });
  } finally {
    cleanup();
  }
}

async function normalizeImageList(payload: unknown): Promise<{ images: GeneratedImage[]; rawResponseShape: string }> {
  if (!payload || typeof payload !== "object") {
    throw new UserFacingError("目标接口返回了无法识别的响应结构。", {
      code: "unexpected_response",
      status: 502,
    });
  }

  const data = (payload as { data?: unknown }).data;
  const images: GeneratedImage[] = [];
  const shapeCandidates: string[] = [];

  if (Array.isArray(data)) {
    shapeCandidates.push("data[]");
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const b64 = (item as { b64_json?: unknown }).b64_json;
      const url = (item as { url?: unknown }).url;
      if (typeof b64 === "string" && b64) {
        images.push({
          id: crypto.randomUUID(),
          mimeType: "image/png",
          source: "b64_json",
          dataUrl: `data:image/png;base64,${b64}`,
        });
      } else if (typeof url === "string" && url) {
        images.push({
          id: crypto.randomUUID(),
          mimeType: "image/png",
          source: "url",
          dataUrl: await fetchRemoteImageAsDataUrl(url),
        });
      }
    }
  }

  const singleB64 = (payload as { b64_json?: unknown }).b64_json;
  if (typeof singleB64 === "string" && singleB64) {
    shapeCandidates.push("b64_json");
    images.push({
      id: crypto.randomUUID(),
      mimeType: "image/png",
      source: "b64_json",
      dataUrl: `data:image/png;base64,${singleB64}`,
    });
  }

  if (images.length === 0) {
    throw new UserFacingError("目标接口已响应，但没有返回可展示的图片数据。", {
      code: "empty_image_result",
      status: 502,
      debug: payload,
    });
  }

  return {
    images,
    rawResponseShape: shapeCandidates.join(", ") || "unknown",
  };
}

export async function generateImages(input: GenerateRequest): Promise<GenerateResponse> {
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  if (!input.apiKey.trim()) {
    throw new UserFacingError("API Key 不能为空。", {
      code: "missing_api_key",
    });
  }
  if (!input.model.trim()) {
    throw new UserFacingError("模型名不能为空。", {
      code: "missing_model",
    });
  }
  if (!input.prompt.trim()) {
    throw new UserFacingError("提示词不能为空。", {
      code: "missing_prompt",
    });
  }

  const warnings: string[] = [];
  let response: Response;

  if (input.mode === "reference" && input.referenceImage) {
    const formData = new FormData();
    formData.set("model", input.model);
    formData.set("prompt", input.prompt);
    formData.set("n", String(input.n ?? 1));
    formData.set("size", input.size ?? "1024x1024");
    formData.set("quality", input.quality ?? "auto");
    formData.set("background", input.background ?? "auto");
    formData.set("output_format", input.outputFormat ?? "png");
    if (input.styleHint) formData.set("style", input.styleHint);
    if (input.negativePrompt) formData.set("negative_prompt", input.negativePrompt);
    if (typeof input.seed === "number") formData.set("seed", String(input.seed));

    const imageBuffer = decodeDataUrl(input.referenceImage);
    formData.set(
      "image",
      new Blob([imageBuffer], { type: input.referenceImage.type }),
      input.referenceImage.name,
    );

    response = await compatFetch(`${normalizedBaseUrl}/images/edits`, input.apiKey, {
      method: "POST",
      body: formData,
      headers: {},
      skipJsonContentType: true,
    });

    if (!response.ok) {
      if ([404, 405, 415, 422].includes(response.status)) {
        throw new UserFacingError(
          "当前接口未兼容图像编辑/参考图生成，建议切换为文生图或更换支持编辑的目标站。",
          {
            code: "image_edit_unsupported",
            status: 422,
          },
        );
      }
      throw await toUpstreamError(response, "图像编辑请求失败。");
    }
  } else {
    const payload = {
      model: input.model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size: input.size ?? "1024x1024",
      quality: input.quality ?? "auto",
      background: input.background ?? "auto",
      output_format: input.outputFormat ?? "png",
      ...(input.styleHint ? { style: input.styleHint } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };

    response = await compatFetch(`${normalizedBaseUrl}/images/generations`, input.apiKey, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw await toUpstreamError(response, "图像生成请求失败。");
    }
  }

  const payload = (await response.json()) as unknown;
  const normalized = await normalizeImageList(payload);

  if (input.mode === "reference") {
    warnings.push("参考图模式按 OpenAI 风格编辑接口发送，实际效果取决于目标服务兼容性。");
  }

  if (typeof input.seed === "number") {
    warnings.push("已发送 seed 参数，但是否真正支持复现取决于目标接口。");
  }

  return {
    ok: true,
    taskId: crypto.randomUUID(),
    model: input.model,
    mode: input.mode,
    prompt: input.prompt,
    promptSource: input.promptSource,
    negativePrompt: input.negativePrompt ?? "",
    parameters: {
      quality: input.quality ?? "auto",
      size: input.size ?? "1024x1024",
      n: input.n ?? 1,
      outputFormat: input.outputFormat ?? "png",
      background: input.background ?? "auto",
      styleHint: input.styleHint ?? "none",
      seed: input.seed ?? null,
    },
    warnings,
    images: normalized.images,
    rawResponseShape: normalized.rawResponseShape,
  };
}

async function toUpstreamError(response: Response, fallback: string) {
  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    try {
      payload = await response.text();
    } catch {
      payload = null;
    }
  }

  const message = extractErrorMessage(payload) || fallback;

  if (response.status === 401 || response.status === 403) {
    return new UserFacingError("认证失败，请检查 API Key 是否有效。", {
      code: "auth_failed",
      status: response.status,
      debug: payload,
    });
  }

  if (response.status === 404) {
    return new UserFacingError("目标接口未找到对应能力，请检查 Base URL、模型名或接口兼容性。", {
      code: "not_found",
      status: 404,
      debug: payload,
    });
  }

  return new UserFacingError(message, {
    code: "upstream_error",
    status: response.status,
    debug: payload,
  });
}

function extractErrorMessage(payload: unknown) {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return null;

  const errorField = (payload as { error?: unknown }).error;
  if (typeof errorField === "string") return errorField;
  if (errorField && typeof errorField === "object") {
    const nested = (errorField as { message?: unknown }).message;
    if (typeof nested === "string") return nested;
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message === "string") return message;
  return null;
}
