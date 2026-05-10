import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

import type { GenerateRequest } from "@/lib/types";

const LOG_DIR = join(process.cwd(), "logs");
const GENERATION_LOG = join(LOG_DIR, "generation.log");

type GenerationLogEntry = {
  event: "generate_start" | "generate_success" | "generate_error" | "generate_stream_fallback";
  route: "/api/generate" | "/api/generate/stream";
  requestId: string;
  timestamp: string;
  durationMs?: number;
  status?: number;
  code?: string;
  message?: string;
  debugSummary?: string;
  request?: {
    baseUrlHost: string;
    model: string;
    mode: GenerateRequest["mode"];
    size?: string;
    quality?: string;
    n?: number;
    outputFormat?: string;
    hasReferenceImage: boolean;
    hasMask: boolean;
    stream?: boolean;
    partialImages?: number;
    promptChars: number;
    negativePromptChars: number;
  };
};

export function createRequestId() {
  return crypto.randomUUID();
}

export async function logGenerationEvent(entry: GenerationLogEntry) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(GENERATION_LOG, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Logging must not break generation.
  }
}

export function summarizeGenerateRequest(input: GenerateRequest): GenerationLogEntry["request"] {
  return {
    baseUrlHost: safeHost(input.baseUrl),
    model: input.model,
    mode: input.mode,
    size: input.size,
    quality: input.quality,
    n: input.n,
    outputFormat: input.outputFormat,
    hasReferenceImage: Boolean(input.referenceImages?.length || input.referenceImage),
    hasMask: Boolean(input.maskImage),
    stream: input.stream,
    partialImages: input.partialImages,
    promptChars: input.prompt.length,
    negativePromptChars: input.negativePrompt?.length ?? 0,
  };
}

export function summarizeDebug(debug: unknown) {
  if (!debug) return undefined;
  const text = typeof debug === "string" ? debug : JSON.stringify(debug);
  return redactSecrets(text).slice(0, 800);
}

function safeHost(value: string) {
  try {
    return new URL(value.trim()).host;
  } catch {
    return value.trim().replace(/^https?:\/\//, "").split("/")[0] || "invalid-url";
  }
}

function redactSecrets(value: string) {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, (match) => `${match.slice(0, 6)}***${match.slice(-4)}`);
}
