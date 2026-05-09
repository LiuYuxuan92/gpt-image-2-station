import type { PromptStyle } from "@/lib/types";

const STYLE_GUIDES: Record<
  PromptStyle,
  {
    label: string;
    focus: string[];
    framing: string;
  }
> = {
  balanced: {
    label: "Balanced",
    focus: ["clear subject", "scene context", "lighting", "composition"],
    framing: "professional, controlled, concise",
  },
  photoreal: {
    label: "Photoreal",
    focus: ["realistic texture", "natural lighting", "camera lens cues", "fine detail"],
    framing: "photorealistic, natural, grounded",
  },
  poster: {
    label: "Commercial Poster",
    focus: ["bold focal point", "graphic hierarchy", "hero composition", "dramatic light"],
    framing: "commercial key visual, high impact, polished",
  },
  product: {
    label: "Product Render",
    focus: ["materials", "controlled reflections", "studio background", "product hero shot"],
    framing: "clean commercial product rendering, premium finish",
  },
  illustration: {
    label: "Illustration",
    focus: ["shape language", "palette", "stylized details", "illustrative depth"],
    framing: "illustrative, intentional, expressive",
  },
  cinematic: {
    label: "Cinematic",
    focus: ["mood", "camera framing", "depth", "story beat"],
    framing: "cinematic still, atmospheric, narrative",
  },
  ecommerce: {
    label: "E-commerce Hero",
    focus: ["marketable clarity", "clean backdrop", "selling point emphasis", "catalog readiness"],
    framing: "high-conversion e-commerce image, polished and clear",
  },
};

export function buildRuleOptimizedPrompt(input: {
  sourcePrompt: string;
  negativePrompt?: string;
  style: PromptStyle;
  language?: "auto" | "zh" | "en";
}) {
  const sourcePrompt = input.sourcePrompt.trim();
  const negativePrompt = input.negativePrompt?.trim() ?? "";
  const guide = STYLE_GUIDES[input.style];
  const isChinese =
    input.language === "zh" ||
    (input.language !== "en" && /[\u3400-\u9fff]/.test(sourcePrompt));

  const sections = isChinese
    ? [
        `主题与意图：${sourcePrompt}`,
        `风格目标：${guide.label}，整体语气 ${guide.framing}`,
        `重点补强：${guide.focus.join("、")}`,
        "构图建议：明确主体、镜头距离、主体与背景关系、画面层次",
        "画质建议：高细节、干净边缘、准确材质、稳定光线",
        negativePrompt
          ? `避免内容：${negativePrompt}`
          : "避免内容：低清晰度、解剖错误、文字脏乱、构图失衡",
      ]
    : [
        `Subject and intent: ${sourcePrompt}`,
        `Style goal: ${guide.label}; tone: ${guide.framing}`,
        `Priority details: ${guide.focus.join(", ")}`,
        "Composition: define subject placement, camera distance, background relationship, and visual hierarchy",
        "Quality bar: high detail, clean edges, coherent materials, stable lighting",
        negativePrompt
          ? `Avoid: ${negativePrompt}`
          : "Avoid: low clarity, anatomy mistakes, messy text artifacts, unstable composition",
      ];

  const optimizedPrompt = sections.join(isChinese ? "\n" : "\n");

  const diffHints = isChinese
    ? ["补足了风格目标", "加入构图与画质约束", "补充避免内容字段"]
    : [
        "Added explicit style goal",
        "Added composition and quality constraints",
        "Added avoid-content guidance",
      ];

  return {
    optimizedPrompt,
    negativePrompt,
    summary: isChinese
      ? `已按 ${guide.label} 方向补充结构化描述与约束。`
      : `Expanded the prompt toward the ${guide.label} direction with clearer structure.`,
    diffHints,
  };
}

export function buildAiRewriteInstruction(input: {
  sourcePrompt: string;
  negativePrompt?: string;
  style: PromptStyle;
  language?: "auto" | "zh" | "en";
}) {
  const guide = STYLE_GUIDES[input.style];
  const wantsChinese =
    input.language === "zh" ||
    (input.language !== "en" && /[\u3400-\u9fff]/.test(input.sourcePrompt));

  if (wantsChinese) {
    return [
      "你是图像生成提示词优化助手。",
      "任务：在不改变用户核心意图的前提下，重写为更适合 gpt-image-2 类模型的高质量提示词。",
      `目标风格：${guide.label}。`,
      `重点：${guide.focus.join("、")}。`,
      "输出要求：",
      "1. 只输出最终优化后的提示词正文，不要解释。",
      "2. 保留用户主题，补充构图、镜头、光线、材质、背景和细节层次。",
      "3. 若用户提供避免内容，也将其融入正文中的约束表达。",
      `原始提示词：${input.sourcePrompt}`,
      input.negativePrompt ? `避免内容：${input.negativePrompt}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are a prompt optimizer for image generation.",
    "Rewrite the user prompt for a gpt-image-2 style image model without changing the core intent.",
    `Target style: ${guide.label}.`,
    `Focus on: ${guide.focus.join(", ")}.`,
    "Output only the final optimized prompt, with no explanation.",
    "Preserve the user's subject while improving composition, camera cues, lighting, materials, background, and detail structure.",
    input.negativePrompt
      ? `Incorporate these avoid constraints naturally: ${input.negativePrompt}`
      : "",
    `User prompt: ${input.sourcePrompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}
