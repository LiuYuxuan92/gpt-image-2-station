import { NextResponse } from "next/server";

import { buildAiRewriteInstruction, buildRuleOptimizedPrompt } from "@/lib/prompt-optimizer";
import { rewritePromptWithTextModel, UserFacingError } from "@/lib/openai-compat";
import type { PromptOptimizeRequest, PromptOptimizeResponse } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromptOptimizeRequest;
    const base = buildRuleOptimizedPrompt({
      sourcePrompt: body.sourcePrompt,
      negativePrompt: body.negativePrompt,
      style: body.style,
      language: body.language ?? "auto",
    });

    const response: PromptOptimizeResponse = {
      ok: true,
      mode: "rules",
      sourcePrompt: body.sourcePrompt,
      optimizedPrompt: base.optimizedPrompt,
      negativePrompt: base.negativePrompt,
      summary: base.summary,
      diffHints: base.diffHints,
      warnings: [],
    };

    const textModel =
      body.textModel?.trim() ||
      body.probe?.detectedTextModels?.[0] ||
      body.probe?.availableModels?.[0] ||
      "";

    if (!body.aiRewrite || !textModel) {
      if (body.aiRewrite && !textModel) {
        response.warnings.push("未选择可用 AI 改写模型，已自动回退到规则模板优化。");
      }
      return NextResponse.json(response);
    }

    try {
      const aiInstruction = buildAiRewriteInstruction({
        sourcePrompt: body.sourcePrompt,
        negativePrompt: body.negativePrompt,
        style: body.style,
        language: body.language ?? "auto",
      });
      const aiResult = await rewritePromptWithTextModel({
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: textModel,
        instruction: aiInstruction,
      });

      return NextResponse.json({
        ...response,
        mode: "ai",
        optimizedPrompt: aiResult.text,
        textModelUsed: textModel,
        warnings: aiResult.warnings,
      } satisfies PromptOptimizeResponse);
    } catch (error) {
      if (error instanceof UserFacingError) {
        response.warnings.push(error.message);
        return NextResponse.json(response);
      }
      response.warnings.push("AI 改写失败，已回退到规则模板优化。");
      return NextResponse.json(response);
    }
  } catch (error) {
    if (error instanceof UserFacingError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "internal_error",
        message: "提示词优化失败。",
      },
      { status: 500 },
    );
  }
}
