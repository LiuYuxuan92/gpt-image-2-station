"use client";

import { useEffect, useRef, useState } from "react";

import {
  clearHistoryTasks,
  loadHistoryTasks,
  saveHistoryTask,
} from "@/lib/history-store";
import type {
  GenerateRequest,
  GenerateResponse,
  HistoryTask,
  OutputFormat,
  ProbeResult,
  ProbeStatus,
  PromptOptimizeResponse,
  PromptStyle,
  ReferenceImageInput,
  SessionTask,
} from "@/lib/types";
import { cn, formatBytes, makeTaskLabel } from "@/lib/utils";

const HISTORY_LIMIT = 50;
const MAX_REFERENCE_IMAGES = 4;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const STYLE_OPTIONS: Array<{ value: PromptStyle; label: string; description: string }> = [
  { value: "balanced", label: "平衡增强", description: "通用结构化优化" },
  { value: "photoreal", label: "更写实", description: "增强相机感、材质和自然光" },
  { value: "poster", label: "商业海报", description: "更强视觉冲击与主视觉感" },
  { value: "product", label: "产品渲染", description: "适合品牌物料与硬表面产品" },
  { value: "illustration", label: "插画风", description: "强化风格化与造型语言" },
  { value: "cinematic", label: "电影感", description: "强调情绪、镜头和叙事" },
  { value: "ecommerce", label: "电商主图", description: "突出卖点、干净背景、清晰展示" },
];

const QUALITY_OPTIONS = ["auto", "low", "medium", "high"];
const SIZE_OPTIONS = [
  { value: "1024x1024", label: "1K 方图", description: "1024 x 1024" },
  { value: "1536x1024", label: "横向 1.5K", description: "1536 x 1024" },
  { value: "1024x1536", label: "竖向 1.5K", description: "1024 x 1536" },
  { value: "2048x2048", label: "2K 方图", description: "2048 x 2048" },
  { value: "3840x2160", label: "4K 横向", description: "3840 x 2160" },
  { value: "2160x3840", label: "4K 竖向", description: "2160 x 3840" },
  { value: "custom", label: "自定义", description: "手动输入宽高" },
  { value: "auto", label: "自动", description: "交给目标接口" },
];
const FORMAT_OPTIONS: OutputFormat[] = ["png", "jpeg", "webp"];
const BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"];
const GENERATION_STAGES = [
  "准备请求",
  "发送到目标接口",
  "等待上游生成",
  "拉取/归一化图片",
  "写入历史",
];

type ApiError = {
  message?: string;
  code?: string;
  debug?: unknown;
};

type GenerationStage = (typeof GENERATION_STAGES)[number] | "空闲";

export function StationApp() {
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("idle");
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string>("");

  const [sourcePrompt, setSourcePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [promptStyle, setPromptStyle] = useState<PromptStyle>("balanced");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizeSummary, setOptimizeSummary] = useState("");
  const [optimizeWarnings, setOptimizeWarnings] = useState<string[]>([]);
  const [optimizeMode, setOptimizeMode] = useState<"rules" | "ai">("rules");
  const [useAiRewrite, setUseAiRewrite] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const [quality, setQuality] = useState("auto");
  const [size, setSize] = useState("1024x1024");
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("2048");
  const [count, setCount] = useState(1);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [background, setBackground] = useState("auto");
  const [styleHint, setStyleHint] = useState("");
  const [seed, setSeed] = useState("");
  const [useStreaming, setUseStreaming] = useState(false);
  const [partialImages, setPartialImages] = useState(2);

  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([]);
  const [maskImage, setMaskImage] = useState<ReferenceImageInput | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [streamPreviewImage, setStreamPreviewImage] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<GenerateResponse | null>(null);
  const [history, setHistory] = useState<HistoryTask[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage>("空闲");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    loadHistoryTasks(HISTORY_LIMIT)
      .then((tasks) => {
        if (active) setHistory(tasks);
      })
      .finally(() => {
        if (active) setHistoryReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isGenerating || !generationStartedAt) return;
    const timer = window.setInterval(() => {
      setGenerationElapsedMs(Date.now() - generationStartedAt);
    }, 500);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, isGenerating]);

  async function handleProbe() {
    setProbeStatus("testing");
    setProbeError("");
    setProbeResult(null);

    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ baseUrl, apiKey, manualModel }),
      });

      const payload = (await response.json()) as ProbeResult & ApiError;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "连接探测失败。");
      }

      setProbeResult(payload);
      setManualModel((current) => current || payload.recommendedModel);
      setProbeStatus("success");
      setProbeError("");
    } catch (error) {
      setProbeStatus("error");
      setProbeError(error instanceof Error ? error.message : "连接探测失败。");
    }
  }

  async function handleOptimize() {
    if (!sourcePrompt.trim()) {
      setOptimizeWarnings(["请先输入原始提示词。"]);
      return;
    }

    setIsOptimizing(true);
    setOptimizeWarnings([]);
    setGenerationError("");

    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          sourcePrompt,
          negativePrompt,
          style: promptStyle,
          aiRewrite: useAiRewrite,
          probe: probeResult,
        }),
      });

      const payload = (await response.json()) as PromptOptimizeResponse & ApiError;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "提示词优化失败。");
      }

      setOptimizedPrompt(payload.optimizedPrompt);
      setOptimizeSummary(payload.summary);
      setOptimizeWarnings(payload.warnings);
      setOptimizeMode(payload.mode);
    } catch (error) {
      setOptimizeWarnings([error instanceof Error ? error.message : "提示词优化失败。"]);
    } finally {
      setIsOptimizing(false);
    }
  }

  async function handleReferenceUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setUploadError("");

    if (!files.length) return;
    const remainingSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remainingSlots <= 0) {
      setUploadError(`最多支持 ${MAX_REFERENCE_IMAGES} 张参考图。`);
      event.target.value = "";
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots);
    const invalid = acceptedFiles.find((file) => !ACCEPTED_IMAGE_TYPES.includes(file.type));
    if (invalid) {
      setUploadError("仅支持 PNG、JPEG、WEBP 图片。");
      event.target.value = "";
      return;
    }
    const oversized = acceptedFiles.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      setUploadError("图片过大，单张限制为 8MB。");
      event.target.value = "";
      return;
    }

    const images = await Promise.all(
      acceptedFiles.map(async (file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
      })),
    );
    setReferenceImages((current) => [...current, ...images].slice(0, MAX_REFERENCE_IMAGES));
    if (files.length > remainingSlots) {
      setUploadError(`已加入前 ${remainingSlots} 张，最多支持 ${MAX_REFERENCE_IMAGES} 张参考图。`);
    }
    event.target.value = "";
  }

  async function handleMaskUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setUploadError("");

    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("遮罩仅支持 PNG、JPEG、WEBP 图片。");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("遮罩图片过大，单张限制为 8MB。");
      event.target.value = "";
      return;
    }

    setMaskImage({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await readFileAsDataUrl(file),
    });
    event.target.value = "";
  }

  async function handleGenerate(promptVariant: "original" | "optimized") {
    const finalPrompt = promptVariant === "optimized" ? optimizedPrompt.trim() : sourcePrompt.trim();
    if (!finalPrompt) {
      setGenerationError("当前没有可提交的提示词。");
      return;
    }

    const finalSize = resolveSelectedSize();
    if (!finalSize) {
      setGenerationError("自定义尺寸需要填写有效宽高。");
      return;
    }

    const model = manualModel.trim() || probeResult?.recommendedModel || "gpt-image-2";
    const promptSource =
      promptVariant === "original"
        ? "original"
        : optimizedPrompt.trim() === sourcePrompt.trim()
          ? "optimized"
          : "manual-edited-optimized";
    const payload: GenerateRequest = {
      baseUrl,
      apiKey,
      model,
      prompt: finalPrompt,
      promptSource,
      negativePrompt,
      mode: referenceImages.length ? "reference" : "text",
      quality,
      size: finalSize,
      n: count,
      outputFormat,
      background,
      styleHint,
      seed: seed.trim() ? Number(seed) : null,
      referenceImage: referenceImages[0] ?? null,
      referenceImages,
      maskImage,
      stream: useStreaming && referenceImages.length === 0,
      partialImages,
    };

    setIsGenerating(true);
    const startedAt = currentTimeMs();
    setGenerationStartedAt(startedAt);
    setGenerationElapsedMs(0);
    setGenerationStage("准备请求");
    setGenerationError("");
    setGenerationWarnings([]);
    setStreamPreviewImage(null);

    try {
      setGenerationStage(useStreaming && !referenceImages.length ? "等待上游生成" : "发送到目标接口");
      const result = await requestGeneration(payload);
      setGenerationStage("拉取/归一化图片");
      if (!result.ok) {
        throw new Error(result.message ?? "生成失败。");
      }

      setLastResult(result);
      setGenerationWarnings(result.warnings);
      setGenerationStage("写入历史");

      const durationMs = result.durationMs ?? currentTimeMs() - startedAt;
      const task: HistoryTask = {
        id: result.taskId,
        createdAt: new Date().toISOString(),
        label: makeTaskLabel(finalPrompt),
        status: "success",
        durationMs,
        request: {
          baseUrl: payload.baseUrl,
          model: payload.model,
          prompt: payload.prompt,
          promptSource: payload.promptSource,
          negativePrompt: payload.negativePrompt,
          mode: payload.mode,
          quality: payload.quality,
          size: payload.size,
          n: payload.n,
          outputFormat: payload.outputFormat,
          background: payload.background,
          styleHint: payload.styleHint,
          seed: payload.seed,
          stream: payload.stream,
          partialImages: payload.partialImages,
          hasReferenceImage: referenceImages.length > 0,
        },
        response: result,
      };

      await persistHistoryTask(task);
      setCompareSelection((current) =>
        [result.taskId, ...current].filter((value, index, array) => array.indexOf(value) === index).slice(0, 2),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败。";
      setGenerationError(message);
      const failedTask: HistoryTask = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        label: makeTaskLabel(finalPrompt),
        status: "error",
        durationMs: currentTimeMs() - startedAt,
        errorMessage: message,
        request: {
          baseUrl: payload.baseUrl,
          model: payload.model,
          prompt: payload.prompt,
          promptSource: payload.promptSource,
          negativePrompt: payload.negativePrompt,
          mode: payload.mode,
          quality: payload.quality,
          size: payload.size,
          n: payload.n,
          outputFormat: payload.outputFormat,
          background: payload.background,
          styleHint: payload.styleHint,
          seed: payload.seed,
          stream: payload.stream,
          partialImages: payload.partialImages,
          hasReferenceImage: referenceImages.length > 0,
        },
      };
      await persistHistoryTask(failedTask);
    } finally {
      setIsGenerating(false);
      setGenerationStartedAt(null);
      setGenerationStage("空闲");
    }
  }

  async function requestGeneration(payload: GenerateRequest): Promise<GenerateResponse & ApiError> {
    if (payload.stream && payload.mode === "text") {
      const streamed = await requestStreamingGeneration(payload);
      if (streamed) return streamed;
    }

    const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    return (await response.json()) as GenerateResponse & ApiError;
  }

  async function requestStreamingGeneration(payload: GenerateRequest): Promise<(GenerateResponse & ApiError) | null> {
    const response = await fetch("/api/generate/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completedImage: string | null = null;
    let durationMs: number | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const data = block
          .split(/\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const event = safeParseJson(data);
        if (!event) continue;
        if (event.type === "partial" && event.dataUrl) {
          setStreamPreviewImage(event.dataUrl);
        }
        if (event.type === "completed" && event.dataUrl) {
          completedImage = event.dataUrl;
          durationMs = event.durationMs;
        }
        if (event.type === "fallback") {
          setGenerationWarnings((current) => [...current, event.reason ?? "流式不可用，已回退普通生成。"]);
          return null;
        }
        if (event.type === "error") {
          throw new Error(event.message ?? "流式生成失败。");
        }
      }
    }

    if (!completedImage) return null;
    return {
      ok: true,
      taskId: crypto.randomUUID(),
      model: payload.model,
      mode: payload.mode,
      prompt: payload.prompt,
      promptSource: payload.promptSource,
      negativePrompt: payload.negativePrompt ?? "",
      parameters: {
        quality: payload.quality ?? "auto",
        size: payload.size ?? "1024x1024",
        n: 1,
        outputFormat: payload.outputFormat ?? "png",
        background: payload.background ?? "auto",
        styleHint: payload.styleHint ?? "none",
        seed: payload.seed ?? null,
      },
      warnings: ["已使用流式预览通道；中转站不支持时会自动回退普通生成。"],
      images: [
        {
          id: crypto.randomUUID(),
          mimeType: "image/png",
          source: "b64_json",
          dataUrl: completedImage,
        },
      ],
      rawResponseShape: "stream",
      durationMs,
    };
  }

  function safeParseJson(data: string): { type?: string; dataUrl?: string; reason?: string; message?: string; durationMs?: number } | null {
    try {
      return JSON.parse(data) as { type?: string; dataUrl?: string; reason?: string; message?: string; durationMs?: number };
    } catch {
      return null;
    }
  }

  function removeReferenceImage(index: number) {
    setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearReferenceImages() {
    setReferenceImages([]);
    setMaskImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (maskInputRef.current) maskInputRef.current.value = "";
  }

  function sendImageToEdit(image: ReferenceImageInput) {
    setReferenceImages((current) => [image, ...current].slice(0, MAX_REFERENCE_IMAGES));
    setLastResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function createReferenceFromResult(imageUrl: string, title: string): ReferenceImageInput {
    const mimeType = imageUrl.match(/^data:(.+?);/)?.[1] ?? "image/png";
    return {
      name: `${title}.png`,
      type: mimeType,
      size: estimateDataUrlBytes(imageUrl),
      dataUrl: imageUrl,
    };
  }

  async function clearHistory() {
    await clearHistoryTasks();
    setHistory([]);
    setCompareSelection([]);
  }

  async function persistHistoryTask(task: HistoryTask) {
    setHistory((current) => [task, ...current].slice(0, HISTORY_LIMIT));
    await saveHistoryTask(task, HISTORY_LIMIT);
  }

  function resolveSelectedSize() {
    if (size !== "custom") return size;
    const width = Number(customWidth);
    const height = Number(customHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    return `${width}x${height}`;
  }

  const activeGenerationElapsed = isGenerating ? generationElapsedMs : 0;
  const currentSize = resolveSelectedSize() ?? "无效尺寸";
  const selectedTasks = history.filter(
    (task): task is SessionTask => compareSelection.includes(task.id) && isSuccessfulTask(task),
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(61,122,102,0.18),_transparent_24%),linear-gradient(180deg,_#f3f5ef_0%,_#e5ebdf_100%)] text-stone-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-[28px] border border-white/70 bg-white/75 px-5 py-5 shadow-[0_20px_80px_rgba(40,55,40,0.08)] backdrop-blur xl:px-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-900/60">
                gpt-image-2-station
              </p>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                面向 OpenAI 兼容 / 反代 / 中转站的图像生成工作台
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-stone-700 sm:text-base">
                默认采用后端代理。连接探测、提示词优化、多图参考、遮罩编辑、流式预览、结果对比和本地历史都在同一界面完成。
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatusBadge
                label="连接状态"
                value={
                  probeStatus === "success"
                    ? "已探测"
                    : probeStatus === "testing"
                      ? "检测中"
                      : probeStatus === "error"
                        ? "失败"
                        : "未检测"
                }
              />
              <StatusBadge
                label="生图模型"
                value={probeResult?.recommendedModel || manualModel || "gpt-image-2"}
              />
              <StatusBadge
                label="参考图能力"
                value={
                  probeResult?.capabilities.imageEditing.supported
                    ? "可尝试"
                    : "需兼容 /images/edits"
                }
              />
            </div>
          </div>
        </header>

        <main className="mt-4 grid flex-1 gap-4 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-4">
            <Panel
              title="连接配置"
              subtitle="Base URL 和 API Key 只保存在当前浏览器会话。"
              aside={
                <button
                  type="button"
                  onClick={handleProbe}
                  disabled={probeStatus === "testing"}
                  className="rounded-full bg-emerald-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700/50"
                >
                  {probeStatus === "testing" ? "检测中..." : "测试连接"}
                </button>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Base URL">
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    className={inputClassName}
                  />
                </Field>
                <Field label="API Key">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-..."
                    className={inputClassName}
                  />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="手动模型覆盖">
                  <input
                    value={manualModel}
                    onChange={(event) => setManualModel(event.target.value)}
                    placeholder="gpt-image-2 或你的中转站别名"
                    className={inputClassName}
                  />
                </Field>
                <Field label="探测结果">
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    {probeResult ? (
                      <div className="space-y-1">
                        <p>标准化地址：{probeResult.normalizedBaseUrl}</p>
                        <p>模型列表：{probeResult.modelsEndpointWorking ? "可用" : "不可用"}</p>
                        <p>文本模型：{probeResult.detectedTextModels[0] || "未探测到"}</p>
                      </div>
                    ) : (
                      <p>尚未探测。若模型列表接口不可用，仍可通过手动模型名继续生成测试。</p>
                    )}
                  </div>
                </Field>
              </div>
              {probeError ? <ErrorNotice message={probeError} /> : null}
              {probeResult?.warnings?.length ? (
                <NoticeList title="兼容性提示" items={probeResult.warnings} tone="amber" />
              ) : null}
            </Panel>

            <Panel
              title="提示词区"
              subtitle="支持原始提示词、负面约束和优化后编辑。"
            >
              <div className="space-y-3">
                <Field label="原始提示词">
                  <textarea
                    value={sourcePrompt}
                    onChange={(event) => setSourcePrompt(event.target.value)}
                    placeholder="描述你想生成的画面、主体、场景、风格、镜头和重点细节。"
                    className={textareaClassName}
                    rows={6}
                  />
                </Field>
                <Field label="避免内容 / 负面约束">
                  <textarea
                    value={negativePrompt}
                    onChange={(event) => setNegativePrompt(event.target.value)}
                    placeholder="如：模糊、解剖错误、低分辨率、脏污文字、过曝"
                    className={textareaClassName}
                    rows={3}
                  />
                </Field>
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <Field label="优化风格">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {STYLE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPromptStyle(option.value)}
                          className={cn(
                            "rounded-2xl border px-3 py-3 text-left transition",
                            promptStyle === option.value
                              ? "border-emerald-700 bg-emerald-50"
                              : "border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white",
                          )}
                        >
                          <p className="text-sm font-medium">{option.label}</p>
                          <p className="mt-1 text-xs leading-5 text-stone-600">{option.description}</p>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                      <input
                        type="checkbox"
                        checked={useAiRewrite}
                        onChange={(event) => setUseAiRewrite(event.target.checked)}
                        className="size-4 rounded border-stone-400"
                      />
                      启用 AI 改写
                    </label>
                    <button
                      type="button"
                      onClick={handleOptimize}
                      disabled={isOptimizing}
                      className="w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-700/60"
                    >
                      {isOptimizing ? "优化中..." : "一键优化 / 润色"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOptimizedPrompt(sourcePrompt)}
                      className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:bg-white"
                    >
                      原始提示词直接带入下方编辑区
                    </button>
                  </div>
                </div>
                <Field
                  label={`优化结果 ${optimizeMode === "ai" ? "AI 重写" : "规则模板"}`}
                  hint={optimizeSummary}
                >
                  <textarea
                    value={optimizedPrompt}
                    onChange={(event) => setOptimizedPrompt(event.target.value)}
                    placeholder="优化结果会显示在这里，用户可继续手动编辑。"
                    className={textareaClassName}
                    rows={8}
                  />
                </Field>
                {optimizeWarnings.length ? (
                  <NoticeList title="优化提示" items={optimizeWarnings} tone="sky" />
                ) : null}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="参数与上传" subtitle="参数会尽量透传，但是否生效取决于目标接口。">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="质量">
                  <select value={quality} onChange={(event) => setQuality(event.target.value)} className={inputClassName}>
                    {QUALITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="尺寸">
                  <select value={size} onChange={(event) => setSize(event.target.value)} className={inputClassName}>
                    {SIZE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} · {option.description}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="数量">
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value))}
                    className={inputClassName}
                  />
                </Field>
                <Field label="输出格式">
                  <select
                    value={outputFormat}
                    onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
                    className={inputClassName}
                  >
                    {FORMAT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="背景">
                  <select
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                    className={inputClassName}
                  >
                    {BACKGROUND_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Seed">
                  <input
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="可选，取决于接口是否支持"
                    className={inputClassName}
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="风格 / 保真度提示">
                  <input
                    value={styleHint}
                    onChange={(event) => setStyleHint(event.target.value)}
                    placeholder="如 vivid / natural / faithful / studio"
                    className={inputClassName}
                  />
                </Field>
              </div>

              {size === "custom" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="自定义宽度">
                    <input
                      type="number"
                      min={1}
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                      className={inputClassName}
                    />
                  </Field>
                  <Field label="自定义高度">
                    <input
                      type="number"
                      min={1}
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                      className={inputClassName}
                    />
                  </Field>
                </div>
              ) : null}
              <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                当前提交尺寸：<span className="font-medium text-stone-900">{currentSize}</span>
              </div>

              <div className="mt-3 grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[1fr_160px]">
                <label className="flex items-start gap-3 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={useStreaming}
                    disabled={referenceImages.length > 0}
                    onChange={(event) => setUseStreaming(event.target.checked)}
                    className="mt-1 size-4 rounded border-stone-400"
                  />
                  <span>
                    <span className="block font-medium text-stone-900">尝试流式预览</span>
                    <span className="mt-1 block leading-5">
                      仅文生图启用。目标接口不支持 SSE 或 partial images 时自动回退普通生成。
                    </span>
                  </span>
                </label>
                <Field label="预览张数">
                  <select
                    value={partialImages}
                    disabled={!useStreaming || referenceImages.length > 0}
                    onChange={(event) => setPartialImages(Number(event.target.value))}
                    className={inputClassName}
                  >
                    {[1, 2, 3].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-4 rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium">多图参考 / 遮罩编辑</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      最多 {MAX_REFERENCE_IMAGES} 张参考图，可附加一张遮罩。目标接口不兼容 `/images/edits` 时会明确报错。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400"
                    >
                      上传参考图
                    </button>
                    <button
                      type="button"
                      onClick={() => maskInputRef.current?.click()}
                      disabled={!referenceImages.length}
                      className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:text-stone-400"
                    >
                      上传遮罩
                    </button>
                    {referenceImages.length || maskImage ? (
                      <button
                        type="button"
                        onClick={clearReferenceImages}
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700"
                      >
                        清空
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    className="hidden"
                    onChange={handleReferenceUpload}
                  />
                  <input
                    ref={maskInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    className="hidden"
                    onChange={handleMaskUpload}
                  />
                </div>

                {referenceImages.length ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {referenceImages.map((image, index) => (
                        <ImageInputCard
                          key={`${image.name}-${index}`}
                          image={image}
                          badge={`参考 ${index + 1}`}
                          onPreview={() => setPreviewImage(image.dataUrl)}
                          onRemove={() => removeReferenceImage(index)}
                        />
                      ))}
                      {maskImage ? (
                        <ImageInputCard
                          image={maskImage}
                          badge="遮罩"
                          onPreview={() => setPreviewImage(maskImage.dataUrl)}
                          onRemove={() => setMaskImage(null)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm leading-6 text-stone-600">
                          遮罩可选。上传后会作为 multipart 的 <span className="font-medium">mask</span> 字段发送，尺寸是否需要完全一致取决于目标接口。
                        </div>
                      )}
                    </div>
                    <MaskPainter
                      baseImage={referenceImages[0]}
                      onApplyMask={(dataUrl) =>
                        setMaskImage({
                          name: "mask.png",
                          type: "image/png",
                          size: estimateDataUrlBytes(dataUrl),
                          dataUrl,
                        })
                      }
                    />
                  </>
                ) : (
                  <div className="mt-4 rounded-2xl bg-white px-4 py-5 text-sm text-stone-600">
                    未上传参考图时，将走文生图流程。上传后默认切换为“参考图生成 / 优化”模式。
                  </div>
                )}

                {uploadError ? <ErrorNotice message={uploadError} /> : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleGenerate("original")}
                  disabled={isGenerating}
                  className="rounded-[22px] bg-emerald-900 px-4 py-4 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-900/60"
                >
                  {isGenerating ? "生成中..." : "使用原始提示词生成"}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerate("optimized")}
                  disabled={isGenerating}
                  className="rounded-[22px] bg-stone-900 px-4 py-4 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-900/60"
                >
                  {isGenerating ? "生成中..." : "使用优化提示词生成"}
                </button>
              </div>

              {generationError ? <ErrorNotice message={generationError} /> : null}
              {isGenerating ? (
                <GenerationProgress
                  stage={generationStage}
                  elapsedMs={activeGenerationElapsed}
                  previewImage={streamPreviewImage}
                />
              ) : null}
              {generationWarnings.length ? (
                <NoticeList title="生成提示" items={generationWarnings} tone="sky" />
              ) : null}
            </Panel>

            <Panel title="结果区" subtitle="支持同批次对比、原始 vs 优化对比和单图放大。">
              {lastResult ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Pill label={`模型 ${lastResult.model}`} />
                    <Pill label={lastResult.mode === "reference" ? "参考图模式" : "文生图模式"} />
                    <Pill label={`数量 ${lastResult.parameters.n}`} />
                    <Pill label={`尺寸 ${lastResult.parameters.size}`} />
                    <Pill label={`质量 ${lastResult.parameters.quality}`} />
                    {lastResult.durationMs ? <Pill label={`耗时 ${formatDuration(lastResult.durationMs)}`} /> : null}
                    {lastResult.usage?.totalTokens ? <Pill label={`Tokens ${lastResult.usage.totalTokens}`} /> : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {lastResult.images.map((image, index) => (
                      <ResultCard
                        key={image.id}
                        title={`结果 ${index + 1}`}
                        subtitle={lastResult.promptSource}
                        imageUrl={image.dataUrl}
                        onPreview={() => setPreviewImage(image.dataUrl)}
                        onSendToEdit={() =>
                          sendImageToEdit(createReferenceFromResult(image.dataUrl, `结果 ${index + 1}`))
                        }
                      />
                    ))}
                  </div>
                  {lastResult.usage || typeof lastResult.estimatedCostUsd === "number" ? (
                    <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700 sm:grid-cols-4">
                      <Metric label="输入 Tokens" value={lastResult.usage?.promptTokens ?? "-"} />
                      <Metric label="输出 Tokens" value={lastResult.usage?.outputTokens ?? "-"} />
                      <Metric label="总 Tokens" value={lastResult.usage?.totalTokens ?? "-"} />
                      <Metric
                        label="费用估算"
                        value={
                          typeof lastResult.estimatedCostUsd === "number"
                            ? `$${lastResult.estimatedCostUsd.toFixed(4)}`
                            : "上游未返回"
                        }
                      />
                    </div>
                  ) : null}
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700">
                    <p className="font-medium text-stone-800">实际使用提示词</p>
                    <p className="mt-2 whitespace-pre-wrap leading-6">{lastResult.prompt}</p>
                    {lastResult.negativePrompt ? (
                      <>
                        <p className="mt-4 font-medium text-stone-800">避免内容</p>
                        <p className="mt-2 whitespace-pre-wrap leading-6">{lastResult.negativePrompt}</p>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="还没有生成结果"
                  description="先完成连接探测，再提交原始或优化提示词。生成成功后会自动进入会话历史，并支持对比。"
                />
              )}
            </Panel>
          </div>
        </main>

        <section className="mt-4 grid gap-4 xl:grid-cols-[0.84fr_1.16fr]">
          <Panel
            title="历史 / 任务区"
            subtitle={`IndexedDB 保存最近 ${HISTORY_LIMIT} 个成功或失败任务，不保存 API Key。`}
            aside={
              history.length ? (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-white"
                >
                  清空历史
                </button>
              ) : null
            }
          >
            {history.length ? (
              <div className="space-y-3">
                {history.map((task) => {
                  const checked = compareSelection.includes(task.id);
                  const isError = task.status === "error";
                  return (
                    <label
                      key={task.id}
                      className={cn(
                        "flex gap-3 rounded-2xl border px-4 py-4 transition",
                        isError
                          ? "border-rose-200 bg-rose-50"
                          : "cursor-pointer border-stone-200 bg-stone-50 hover:bg-white",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isError}
                        onChange={(event) => {
                          setCompareSelection((current) => {
                            if (event.target.checked) return [task.id, ...current].slice(0, 2);
                            return current.filter((value) => value !== task.id);
                          });
                        }}
                        className="mt-1 size-4"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-stone-900">{task.label}</p>
                          <Pill label={isError ? "失败" : "成功"} />
                          <Pill label={task.request.mode === "reference" ? "图生图" : "文生图"} />
                          <Pill label={task.request.promptSource} />
                          {task.durationMs ? <Pill label={formatDuration(task.durationMs)} /> : null}
                        </div>
                        <p className="mt-1 text-xs text-stone-500">
                          {new Date(task.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-stone-700">
                          {isError ? task.errorMessage : task.response.prompt}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : !historyReady ? (
              <EmptyState title="正在读取历史" description="正在从浏览器 IndexedDB 加载最近任务。" />
            ) : (
              <EmptyState
                title="暂无历史任务"
                description="生成成功或失败后，会把任务快照保存在浏览器 IndexedDB 中，不会保存 API Key。"
              />
            )}
          </Panel>

          <Panel title="结果对比" subtitle="适合对比原始 vs 优化、不同参数版本或不同批次结果。">
            {selectedTasks.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {selectedTasks.map((task) => (
                  <div key={task.id} className="rounded-[26px] border border-stone-200 bg-stone-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-medium">{task.label}</h3>
                      <Pill label={task.request.promptSource} />
                      <Pill label={task.request.model} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">{task.response.prompt}</p>
                    <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-1">
                      {task.response.images.map((image, index) => (
                        <div
                          key={image.id}
                          className="min-w-[220px] snap-start overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
                        >
                          <button type="button" onClick={() => setPreviewImage(image.dataUrl)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.dataUrl}
                              alt={`${task.label}-${index + 1}`}
                              className="aspect-square w-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              sendImageToEdit(createReferenceFromResult(image.dataUrl, `${task.label}-${index + 1}`))
                            }
                            className="w-full border-t border-stone-200 px-3 py-2 text-xs font-medium text-stone-700"
                          >
                            发送到编辑
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="选择要对比的任务"
                description="在左侧历史任务区勾选最多两个任务，即可进行横向对比。手机端可横向滑动查看。"
              />
            )}
          </Panel>
        </section>
      </div>

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 px-4 py-8"
          onClick={() => setPreviewImage(null)}
        >
          <div className="max-h-full max-w-5xl overflow-hidden rounded-[28px] bg-white p-3 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage} alt="preview" className="max-h-[82vh] w-full rounded-[20px] object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-stone-900">{value}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  aside,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/70 bg-white/78 p-4 shadow-[0_20px_60px_rgba(40,55,40,0.07)] backdrop-blur sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">{subtitle}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-stone-800">{label}</span>
        {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
      {message}
    </div>
  );
}

function NoticeList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "amber" | "sky";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <div className={cn("mt-3 rounded-2xl border px-4 py-3", toneClass)}>
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center">
      <p className="text-base font-medium text-stone-900">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function GenerationProgress({
  stage,
  elapsedMs,
  previewImage,
}: {
  stage: GenerationStage;
  elapsedMs: number;
  previewImage: string | null;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">生成状态：{stage}</p>
        <p>{formatDuration(elapsedMs)}</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {GENERATION_STAGES.map((item) => (
          <div
            key={item}
            className={cn(
              "h-2 rounded-full",
              item === stage ? "bg-emerald-800" : "bg-emerald-200",
            )}
          />
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-emerald-900/75">
        图片生成和远程 URL 拉取最长等待 10 分钟；页面保持打开即可等待结果。
      </p>
      {previewImage ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-200 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewImage} alt="stream preview" className="max-h-[280px] w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}

function ImageInputCard({
  image,
  badge,
  onPreview,
  onRemove,
}: {
  image: ReferenceImageInput;
  badge: string;
  onPreview: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 rounded-2xl border border-stone-200 bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt={image.name} className="aspect-square rounded-xl object-cover" />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={badge} />
          <p className="truncate text-sm font-medium text-stone-800">{image.name}</p>
        </div>
        <p className="text-xs text-stone-600">
          {image.type} · {formatBytes(image.size)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPreview}
            className="rounded-full bg-stone-900 px-3 py-2 text-xs font-medium text-white"
          >
            查看
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function MaskPainter({
  baseImage,
  onApplyMask,
}: {
  baseImage: ReferenceImageInput;
  onApplyMask: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [brushSize, setBrushSize] = useState(42);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, [baseImage.dataUrl]);

  function drawAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = mode === "paint" ? "white" : "black";
    context.beginPath();
    context.arc(x, y, brushSize, 0, Math.PI * 2);
    context.fill();
  }

  function clearMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  function applyMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onApplyMask(canvas.toDataURL("image/png"));
  }

  return (
    <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-medium text-stone-900">遮罩画笔</h4>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            白色区域表示要编辑的位置，黑色区域保留。基于第一张参考图尺寸导出 PNG。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("paint")}
            className={cn(
              "rounded-full px-3 py-2 text-xs font-medium",
              mode === "paint" ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700",
            )}
          >
            画白
          </button>
          <button
            type="button"
            onClick={() => setMode("erase")}
            className={cn(
              "rounded-full px-3 py-2 text-xs font-medium",
              mode === "erase" ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700",
            )}
          >
            擦黑
          </button>
          <button
            type="button"
            onClick={clearMask}
            className="rounded-full border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700"
          >
            清空
          </button>
          <button
            type="button"
            onClick={applyMask}
            className="rounded-full bg-emerald-900 px-3 py-2 text-xs font-medium text-white"
          >
            应用遮罩
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_160px]">
        <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={baseImage.dataUrl}
            alt={baseImage.name}
            className="absolute inset-0 size-full object-contain opacity-45"
          />
          <canvas
            ref={canvasRef}
            width={1024}
            height={1024}
            className="relative z-10 aspect-square w-full touch-none mix-blend-screen"
            onPointerDown={(event) => {
              setIsDrawing(true);
              event.currentTarget.setPointerCapture(event.pointerId);
              drawAt(event);
            }}
            onPointerMove={(event) => {
              if (isDrawing) drawAt(event);
            }}
            onPointerUp={() => setIsDrawing(false)}
            onPointerCancel={() => setIsDrawing(false)}
          />
        </div>
        <Field label={`画笔 ${brushSize}px`}>
          <input
            type="range"
            min={8}
            max={120}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="w-full accent-emerald-900"
          />
        </Field>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-1 font-medium text-stone-900">{value}</p>
    </div>
  );
}

function ResultCard({
  title,
  subtitle,
  imageUrl,
  onPreview,
  onSendToEdit,
}: {
  title: string;
  subtitle: string;
  imageUrl: string;
  onPreview: () => void;
  onSendToEdit: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-stone-200 bg-stone-50 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={title} className="aspect-square w-full object-cover" />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-stone-900">{title}</p>
          <p className="mt-1 text-xs text-stone-500">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPreview}
            className="rounded-full border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700"
          >
            放大
          </button>
          <button
            type="button"
            onClick={onSendToEdit}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
          >
            编辑
          </button>
          <a
            href={imageUrl}
            download={`${title}.png`}
            className="rounded-full bg-stone-900 px-3 py-2 text-xs font-medium text-white"
          >
            下载
          </a>
        </div>
      </div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-700 shadow-sm ring-1 ring-stone-200">
      {label}
    </span>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

function currentTimeMs() {
  return new Date().getTime();
}

function isSuccessfulTask(task: HistoryTask): task is SessionTask {
  return task.status !== "error";
}

const inputClassName =
  "w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100";

const textareaClassName =
  "w-full rounded-[22px] border border-stone-300 bg-white px-4 py-3 text-sm leading-6 text-stone-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100";
