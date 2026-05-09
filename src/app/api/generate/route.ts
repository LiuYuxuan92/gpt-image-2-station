import { NextResponse } from "next/server";

import { generateImages, UserFacingError } from "@/lib/openai-compat";
import type { GenerateRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequest;
    const result = await generateImages(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UserFacingError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: error.message,
          debug: error.debug ?? null,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "internal_error",
        message: "生成请求失败。",
      },
      { status: 500 },
    );
  }
}
