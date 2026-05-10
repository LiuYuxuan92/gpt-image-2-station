export type ProbeStatus = "idle" | "testing" | "success" | "error";

export type PromptStyle =
  | "balanced"
  | "photoreal"
  | "poster"
  | "product"
  | "illustration"
  | "cinematic"
  | "ecommerce";

export type GenerateMode = "text" | "reference";

export type OutputFormat = "png" | "jpeg" | "webp";

export type CapabilityFlag = {
  supported: boolean;
  note?: string;
};

export type ProbeResult = {
  ok: boolean;
  normalizedBaseUrl: string;
  reachable: boolean;
  authLikelyValid: boolean;
  modelsEndpointWorking: boolean;
  imageModelDetected: boolean;
  recommendedModel: string;
  availableModels: string[];
  detectedImageModels: string[];
  detectedTextModels: string[];
  capabilities: {
    imageGeneration: CapabilityFlag;
    imageEditing: CapabilityFlag;
    textRewrite: CapabilityFlag;
  };
  warnings: string[];
  debug: {
    modelCount: number;
    probeStrategy: string[];
    rawModelIdsSample: string[];
  };
};

export type PromptOptimizeRequest = {
  baseUrl: string;
  apiKey: string;
  sourcePrompt: string;
  negativePrompt?: string;
  style: PromptStyle;
  language?: "auto" | "zh" | "en";
  aiRewrite: boolean;
  textModel?: string;
  probe?: ProbeResult | null;
};

export type PromptOptimizeResponse = {
  ok: boolean;
  mode: "rules" | "ai";
  sourcePrompt: string;
  optimizedPrompt: string;
  negativePrompt: string;
  summary: string;
  diffHints: string[];
  textModelUsed?: string;
  warnings: string[];
};

export type ReferenceImageInput = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

export type GenerateRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  promptSource: "original" | "optimized" | "manual-edited-optimized";
  negativePrompt?: string;
  mode: GenerateMode;
  quality?: string;
  size?: string;
  n?: number;
  outputFormat?: OutputFormat;
  background?: string;
  styleHint?: string;
  seed?: number | null;
  referenceImages?: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput | null;
  maskImage?: ReferenceImageInput | null;
  stream?: boolean;
  partialImages?: number;
};

export type GeneratedImage = {
  id: string;
  mimeType: string;
  source: "b64_json" | "url";
  dataUrl: string;
};

export type GenerateUsage = {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type GenerateResponse = {
  ok: boolean;
  taskId: string;
  model: string;
  mode: GenerateMode;
  prompt: string;
  promptSource: GenerateRequest["promptSource"];
  negativePrompt: string;
  parameters: {
    quality: string;
    size: string;
    n: number;
    outputFormat: OutputFormat;
    background: string;
    styleHint: string;
    seed?: number | null;
  };
  warnings: string[];
  images: GeneratedImage[];
  rawResponseShape: string;
  durationMs?: number;
  usage?: GenerateUsage;
  estimatedCostUsd?: number;
};

export type SessionTaskStatus = "success" | "error";

export type SessionTask = {
  id: string;
  createdAt: string;
  label: string;
  status?: SessionTaskStatus;
  durationMs?: number;
  errorMessage?: string;
  request: Omit<GenerateRequest, "apiKey" | "referenceImage" | "referenceImages" | "maskImage"> & {
    hasReferenceImage: boolean;
  };
  response: GenerateResponse;
};

export type FailedSessionTask = Omit<SessionTask, "response" | "status"> & {
  status: "error";
  errorMessage: string;
  response?: never;
};

export type HistoryTask = SessionTask | FailedSessionTask;

export type SavedStationConfig = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  textRewriteModel: string;
  quality: string;
  size: string;
  customWidth: string;
  customHeight: string;
  n: number;
  outputFormat: OutputFormat;
  background: string;
  styleHint: string;
  seed: string;
  useStreaming: boolean;
  partialImages: number;
  promptStyle: PromptStyle;
  useAiRewrite: boolean;
};
