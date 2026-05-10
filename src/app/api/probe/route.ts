import { NextResponse } from "next/server";

import {
  internalErrorResponse,
  isUserFacingErrorLike,
  userFacingErrorResponse,
} from "@/lib/api-errors";
import { probeOpenAICompat } from "@/lib/openai-compat";

type ProbePayload = {
  baseUrl?: string;
  apiKey?: string;
  manualModel?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProbePayload;
    const result = await probeOpenAICompat({
      baseUrl: body.baseUrl ?? "",
      apiKey: body.apiKey ?? "",
      manualModel: body.manualModel ?? "",
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isUserFacingErrorLike(error)) {
      return userFacingErrorResponse(error);
    }

    return internalErrorResponse("探测过程中出现未处理错误。", error);
  }
}
