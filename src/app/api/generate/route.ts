import { NextResponse } from "next/server";

import {
  internalErrorResponse,
  isUserFacingErrorLike,
  userFacingErrorResponse,
} from "@/lib/api-errors";
import { generateImages } from "@/lib/openai-compat";
import {
  createRequestId,
  logGenerationEvent,
  summarizeDebug,
  summarizeGenerateRequest,
} from "@/lib/server-logger";
import type { GenerateRequest } from "@/lib/types";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  let body: GenerateRequest | null = null;

  try {
    body = (await request.json()) as GenerateRequest;
    await logGenerationEvent({
      event: "generate_start",
      route: "/api/generate",
      requestId,
      timestamp: new Date().toISOString(),
      request: summarizeGenerateRequest(body),
    });

    const result = await generateImages(body);
    await logGenerationEvent({
      event: "generate_success",
      route: "/api/generate",
      requestId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      request: summarizeGenerateRequest(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (isUserFacingErrorLike(error)) {
      await logGenerationEvent({
        event: "generate_error",
        route: "/api/generate",
        requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
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
      route: "/api/generate",
      requestId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      status: 500,
      code: "internal_error",
      message: error instanceof Error ? error.message : "生成请求失败。",
      request: body ? summarizeGenerateRequest(body) : undefined,
    });
    return internalErrorResponse("生成请求失败。", error);
  }
}
