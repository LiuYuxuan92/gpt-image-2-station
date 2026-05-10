import { NextResponse } from "next/server";

import {
  internalErrorResponse,
  isUserFacingErrorLike,
  userFacingErrorResponse,
} from "@/lib/api-errors";
import { generateImages, normalizeBaseUrl } from "@/lib/openai-compat";
import type { GenerateRequest } from "@/lib/types";

const STREAM_TIMEOUT_MS = 600_000;

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "partial"; index: number; dataUrl: string }
  | { type: "completed"; dataUrl: string; usage?: unknown; durationMs: number }
  | { type: "fallback"; reason: string }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequest;
    if (body.mode === "reference" || body.referenceImages?.length || body.referenceImage || body.maskImage) {
      const result = await generateImages(body);
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
          const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
          const upstreamPayload = {
            model: body.model,
            prompt: body.prompt,
            n: body.n ?? 1,
            size: body.size ?? "1024x1024",
            quality: body.quality ?? "auto",
            background: body.background ?? "auto",
            output_format: body.outputFormat ?? "png",
            stream: true,
            partial_images: Math.min(Math.max(body.partialImages ?? 2, 1), 3),
            ...(body.styleHint ? { style: body.styleHint } : {}),
            ...(body.negativePrompt ? { negative_prompt: body.negativePrompt } : {}),
            ...(typeof body.seed === "number" ? { seed: body.seed } : {}),
          };

          const response = await fetch(`${normalizedBaseUrl}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${body.apiKey.trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(upstreamPayload),
            signal: abortController.signal,
            cache: "no-store",
          });

          if (!response.ok) {
            send({ type: "fallback", reason: `流式接口返回 ${response.status}，已切换普通生成。` });
            return;
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (!response.body || !contentType.includes("text/event-stream")) {
            send({ type: "fallback", reason: "目标接口未返回 SSE 流，已切换普通生成。" });
            return;
          }

          send({ type: "status", message: "已连接流式通道，等待 partial image。" });
          await relayUpstreamSse(response.body, send, startedAt);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            send({ type: "error", message: "流式生图请求超时，目标接口未在 600 秒内响应。" });
          } else if (isUserFacingErrorLike(error)) {
            send({ type: "error", message: error.message ?? "流式生图请求失败。" });
          } else {
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
      return userFacingErrorResponse(error);
    }

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
