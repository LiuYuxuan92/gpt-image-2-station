import { NextResponse } from "next/server";

import {
  internalErrorResponse,
  isUserFacingErrorLike,
  userFacingErrorResponse,
} from "@/lib/api-errors";
import { generateImages, normalizeBaseUrl } from "@/lib/openai-compat";
import {
  createRequestId,
  logGenerationEvent,
  summarizeDebug,
  summarizeGenerateRequest,
} from "@/lib/server-logger";
import type { GenerateRequest } from "@/lib/types";

const STREAM_TIMEOUT_MS = 600_000;

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "partial"; index: number; dataUrl: string }
  | { type: "completed"; dataUrl: string; usage?: unknown; durationMs: number }
  | { type: "fallback"; reason: string }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  const requestId = createRequestId();
  const outerStartedAt = Date.now();
  let body: GenerateRequest | null = null;

  try {
    body = (await request.json()) as GenerateRequest;
    const streamBody = body;
    await logGenerationEvent({
      event: "generate_start",
      route: "/api/generate/stream",
      requestId,
      timestamp: new Date().toISOString(),
      request: summarizeGenerateRequest(body),
    });

    if (streamBody.mode === "reference" || streamBody.referenceImages?.length || streamBody.referenceImage || streamBody.maskImage) {
      const result = await generateImages(streamBody);
      await logGenerationEvent({
        event: "generate_success",
        route: "/api/generate/stream",
        requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - outerStartedAt,
        request: summarizeGenerateRequest(streamBody),
      });
      return NextResponse.json(result);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const startedAt = Date.now();

        function send(event: StreamEvent) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS);

        try {
          send({ type: "status", message: "正在请求上游流式生图接口。" });
          const normalizedBaseUrl = normalizeBaseUrl(streamBody.baseUrl);
          const upstreamPayload = {
            model: streamBody.model,
            prompt: streamBody.prompt,
            n: streamBody.n ?? 1,
            size: streamBody.size ?? "1024x1024",
            quality: streamBody.quality ?? "auto",
            background: streamBody.background ?? "auto",
            output_format: streamBody.outputFormat ?? "png",
            stream: true,
            partial_images: Math.min(Math.max(streamBody.partialImages ?? 2, 1), 3),
            ...(streamBody.styleHint ? { style: streamBody.styleHint } : {}),
            ...(streamBody.negativePrompt ? { negative_prompt: streamBody.negativePrompt } : {}),
            ...(typeof streamBody.seed === "number" ? { seed: streamBody.seed } : {}),
          };

          const response = await fetch(`${normalizedBaseUrl}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${streamBody.apiKey.trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(upstreamPayload),
            signal: abortController.signal,
            cache: "no-store",
          });

          if (!response.ok) {
            await logGenerationEvent({
              event: "generate_stream_fallback",
              route: "/api/generate/stream",
              requestId,
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - outerStartedAt,
              status: response.status,
              message: `流式接口返回 ${response.status}`,
              request: body ? summarizeGenerateRequest(body) : undefined,
            });
            send({ type: "fallback", reason: `流式接口返回 ${response.status}，已切换普通生成。` });
            return;
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (!response.body || !contentType.includes("text/event-stream")) {
            await logGenerationEvent({
              event: "generate_stream_fallback",
              route: "/api/generate/stream",
              requestId,
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - outerStartedAt,
              message: `目标接口返回 ${contentType || "empty content-type"}`,
              request: body ? summarizeGenerateRequest(body) : undefined,
            });
            send({ type: "fallback", reason: "目标接口未返回 SSE 流，已切换普通生成。" });
            return;
          }

          send({ type: "status", message: "已连接流式通道，等待 partial image。" });
          await relayUpstreamSse(response.body, send, startedAt);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            await logGenerationEvent({
              event: "generate_error",
              route: "/api/generate/stream",
              requestId,
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - outerStartedAt,
              status: 504,
              code: "upstream_timeout",
              message: "流式生图请求超时，目标接口未在 600 秒内响应。",
              request: body ? summarizeGenerateRequest(body) : undefined,
            });
            send({ type: "error", message: "流式生图请求超时，目标接口未在 600 秒内响应。" });
          } else if (isUserFacingErrorLike(error)) {
            await logGenerationEvent({
              event: "generate_error",
              route: "/api/generate/stream",
              requestId,
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - outerStartedAt,
              status: error.status,
              code: error.code,
              message: error.message,
              debugSummary: summarizeDebug(error.debug),
              request: body ? summarizeGenerateRequest(body) : undefined,
            });
            send({ type: "error", message: error.message ?? "流式生图请求失败。" });
          } else {
            await logGenerationEvent({
              event: "generate_stream_fallback",
              route: "/api/generate/stream",
              requestId,
              timestamp: new Date().toISOString(),
              durationMs: Date.now() - outerStartedAt,
              message: error instanceof Error ? error.message : "流式生图不可用",
              request: body ? summarizeGenerateRequest(body) : undefined,
            });
            send({ type: "fallback", reason: "流式生图不可用，已切换普通生成。" });
          }
        } finally {
          clearTimeout(timeout);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (isUserFacingErrorLike(error)) {
      await logGenerationEvent({
        event: "generate_error",
        route: "/api/generate/stream",
        requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - outerStartedAt,
        status: error.status,
        code: error.code,
        message: error.message,
        debugSummary: summarizeDebug(error.debug),
        request: body ? summarizeGenerateRequest(body) : undefined,
      });
      return userFacingErrorResponse(error);
    }

    await logGenerationEvent({
      event: "generate_error",
      route: "/api/generate/stream",
      requestId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - outerStartedAt,
      status: 500,
      code: "internal_error",
      message: error instanceof Error ? error.message : "流式生成请求失败。",
      request: body ? summarizeGenerateRequest(body) : undefined,
    });
    return internalErrorResponse("流式生成请求失败。", error);
  }
}

async function relayUpstreamSse(
  body: ReadableStream<Uint8Array>,
  send: (event: StreamEvent) => void,
  startedAt: number,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      if (!data || data === "[DONE]") continue;

      const event = safeParseJson(data);
      if (!event || typeof event !== "object") continue;
      const type = typeof event.type === "string" ? event.type : "";
      const b64 = typeof event.b64_json === "string" ? event.b64_json : "";

      if (type === "image_generation.partial_image" && b64) {
        const index =
          typeof event.partial_image_index === "number" ? event.partial_image_index : 0;
        send({ type: "partial", index, dataUrl: `data:image/png;base64,${b64}` });
      }

      if (type === "image_generation.completed" && b64) {
        send({
          type: "completed",
          dataUrl: `data:image/png;base64,${b64}`,
          usage: event.usage,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as { [key: string]: unknown };
  } catch {
    return null;
  }
}
