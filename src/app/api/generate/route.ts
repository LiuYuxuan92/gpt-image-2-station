import { NextResponse } from "next/server";

import {
  internalErrorResponse,
  isUserFacingErrorLike,
  userFacingErrorResponse,
} from "@/lib/api-errors";
import { generateImages } from "@/lib/openai-compat";
import type { GenerateRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequest;
    const result = await generateImages(body);
    return NextResponse.json(result);
  } catch (error) {
    if (isUserFacingErrorLike(error)) {
      return userFacingErrorResponse(error);
    }

    return internalErrorResponse("生成请求失败。", error);
  }
}
