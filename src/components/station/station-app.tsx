"use client";

import { useEffect, useRef, useState } from "react";

import type {
  GenerateRequest,
  GenerateResponse,
  OutputFormat,
  ProbeResult,
  ProbeStatus,
  PromptOptimizeResponse,
  PromptStyle,
  ReferenceImageInput,
  SessionTask,
} from "@/lib/types";
import { cn, formatBytes, makeTaskLabel, safeJsonParse } from "@/lib/utils";

const HISTORY_KEY = "gpt-image-2-station-history";
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
const SIZE_OPTIONS = ["1024x1024", "1536x1024", "1024x1536", "auto"];
const FORMAT_OPTIONS: OutputFormat[] = ["png", "jpeg", "webp"];
const BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"];

type ApiError = {
  message?: string;
  code?: string;
  debug?: unknown;
};

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
  const [count, setCount] = useState(1);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [background, setBackground] = useState("auto");
  const [styleHint, setStyleHint] = useState("");
  const [seed, setSeed] = useState("");

  const [referenceImage, setReferenceImage] = useState<ReferenceImageInput | null>(null);
  const [uploadError, setUploadError] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<GenerateResponse | null>(null);
  const [history, setHistory] = useState<SessionTask[]>(() => {
    if (typeof window === "undefined") return [];
    return safeJsonParse<SessionTask[]>(window.sessionStorage.getItem(HISTORY_KEY) ?? "[]", []);
  });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

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
    const file = event.target.files?.[0];
    setUploadError("");

    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("仅支持 PNG、JPEG、WEBP 图片。");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("图片过大，MVP 限制为 8MB。");
      event.target.value = "";
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setReferenceImage({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl,
    });
  }

  async function handleGenerate(promptVariant: "original" | "optimized") {
    const finalPrompt = promptVariant === "optimized" ? optimizedPrompt.trim() : sourcePrompt.trim();
    if (!finalPrompt) {
      setGenerationError("当前没有可提交的提示词。");
      return;
    }

    const model = manualModel.trim() || probeResult?.recommendedModel || "gpt-image-2";
    const payload: GenerateRequest = {
      baseUrl,
      apiKey,
      model,
      prompt: finalPrompt,
      promptSource:
        promptVariant === "original"
          ? "original"
          : optimizedPrompt.trim() === sourcePrompt.trim()
            ? "optimized"
            : "manual-edited-optimized",
      negativePrompt,
      mode: referenceImage ? "reference" : "text",
      quality,
      size,
      n: count,
      outputFormat,
      background,
      styleHint,
      seed: seed.trim() ? Number(seed) : null,
      referenceImage,
    };

    setIsGenerating(true);
    setGenerationError("");
    setGenerationWarnings([]);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as GenerateResponse & ApiError;
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "生成失败。");
      }

      setLastResult(result);
      setGenerationWarnings(result.warnings);

      const task: SessionTask = {
        id: result.taskId,
        createdAt: new Date().toISOString(),
        label: makeTaskLabel(finalPrompt),
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
          hasReferenceImage: Boolean(referenceImage),
        },
        response: result,
      };

      setHistory((current) => [task, ...current].slice(0, 12));
      setCompareSelection((current) =>
        [result.taskId, ...current].filter((value, index, array) => array.indexOf(value) === index).slice(0, 2),
      );
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "生成失败。");
    } finally {
      setIsGenerating(false);
    }
  }

  function removeReferenceImage() {
    setReferenceImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const selectedTasks = history.filter((task) => compareSelection.includes(task.id));

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
                默认采用后端代理。连接探测、提示词优化、单图参考生成、结果对比和会话级历史都在同一界面完成。
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
                      <option key={option} value={option}>
                        {option}
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

              <div className="mt-4 rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium">单图参考生成 / 优化</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      MVP 仅支持单图上传，不支持蒙版编辑。若目标接口不兼容 `/images/edits`，会明确报错。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400"
                  >
                    {referenceImage ? "替换图片" : "上传参考图"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    className="hidden"
                    onChange={handleReferenceUpload}
                  />
                </div>

                {referenceImage ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={referenceImage.dataUrl}
                      alt={referenceImage.name}
                      className="aspect-square w-full rounded-2xl object-cover shadow-sm"
                    />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-stone-800">{referenceImage.name}</p>
                      <p className="text-sm text-stone-600">
                        {referenceImage.type} · {formatBytes(referenceImage.size)}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(referenceImage.dataUrl)}
                          className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                        >
                          查看大图
                        </button>
                        <button
                          type="button"
                          onClick={removeReferenceImage}
                          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
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
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {lastResult.images.map((image, index) => (
                      <ResultCard
                        key={image.id}
                        title={`结果 ${index + 1}`}
                        subtitle={lastResult.promptSource}
                        imageUrl={image.dataUrl}
                        onPreview={() => setPreviewImage(image.dataUrl)}
                      />
                    ))}
                  </div>
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
          <Panel title="会话历史 / 任务区" subtitle="当前浏览器会话内保留最近 12 个任务。">
            {history.length ? (
              <div className="space-y-3">
                {history.map((task) => {
                  const checked = compareSelection.includes(task.id);
                  return (
                    <label
                      key={task.id}
                      className="flex cursor-pointer gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 transition hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
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
                          <Pill label={task.request.mode === "reference" ? "图生图" : "文生图"} />
                          <Pill label={task.request.promptSource} />
                        </div>
                        <p className="mt-1 text-xs text-stone-500">
                          {new Date(task.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-stone-700">{task.response.prompt}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="暂无历史任务"
                description="成功生成后，会把任务快照保存在浏览器会话中，不会落库。"
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
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => setPreviewImage(image.dataUrl)}
                          className="min-w-[220px] snap-start overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.dataUrl}
                            alt={`${task.label}-${index + 1}`}
                            className="aspect-square w-full object-cover"
                          />
                        </button>
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

function ResultCard({
  title,
  subtitle,
  imageUrl,
  onPreview,
}: {
  title: string;
  subtitle: string;
  imageUrl: string;
  onPreview: () => void;
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

const inputClassName =
  "w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100";

const textareaClassName =
  "w-full rounded-[22px] border border-stone-300 bg-white px-4 py-3 text-sm leading-6 text-stone-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100";
