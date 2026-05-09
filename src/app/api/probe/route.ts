import { NextResponse } from "next/server";

import { probeOpenAICompat, UserFacingError } from "@/lib/openai-compat";

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
        message: "探测过程中出现未处理错误。",
      },
      { status: 500 },
    );
  }
}
