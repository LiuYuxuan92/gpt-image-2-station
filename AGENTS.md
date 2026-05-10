# AGENTS.md

本文件是 `gpt-image-2-station` 仓库的协作说明。后续 agent 在本仓库工作时，应优先阅读并遵守这里的项目约定，同时以当前代码和 `README.md`、`docs/architecture.md` 为事实来源。

## 项目定位

- 这是一个面向 OpenAI 兼容接口、反代接口和中转站接口的 `gpt-image-2` 图像生成工作台。
- 当前目标是个人或小团队自部署的 MVP，不追求覆盖所有图像编辑高级能力。
- 兼容性策略是“探测、降级、可读错误提示”，不要假设第三方站点完全兼容官方 OpenAI API。
- 默认架构是 Next.js 前端页面 + 服务端 Route Handler 代理外部接口。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- 包管理器：pnpm

常用命令：

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
pnpm start
```

## 目录边界

- `src/app/page.tsx`：页面入口，当前挂载主工作台组件。
- `src/components/station/station-app.tsx`：主客户端工作台，包含连接配置、提示词区、参数上传、结果展示、历史对比等 UI。
- `src/app/api/probe/route.ts`：连接探测 API。
- `src/app/api/prompt/optimize/route.ts`：提示词优化 API。
- `src/app/api/generate/route.ts`：图像生成 API。
- `src/lib/openai-compat.ts`：OpenAI 兼容层、Base URL 归一化、SSRF 防护、请求代理、响应归一化。
- `src/lib/prompt-optimizer.ts`：规则提示词优化与 AI 改写指令构建。
- `src/lib/types.ts`：前后端共享类型。
- `src/lib/utils.ts`：通用工具函数。
- `docs/architecture.md`：架构说明和 MVP 边界。

改动时保持职责集中：兼容/代理逻辑优先放在 `src/lib/openai-compat.ts`，类型变更同步更新 `src/lib/types.ts`，页面状态和交互集中在 `StationApp` 或拆出的 station 子组件中。

## API 兼容规则

- Base URL 必须通过 `normalizeBaseUrl` 归一化到 `/v1`。
- 探测优先请求 `GET /models`，但 `/models` 失败不能阻断手动模型名继续生成。
- 默认模型回退为 `gpt-image-2`，同时允许用户手动覆盖中转站别名。
- 文生图使用 `/images/generations`。
- 参考图生成按 OpenAI 风格 multipart 请求 `/images/edits`，支持多参考图 `image` 字段和可选 `mask` 字段；目标站不兼容时应返回明确、用户可理解的错误。
- 可选流式预览按 `stream=true` 与 `partial_images` 尝试；目标站不支持 SSE 时必须可回退普通生成。
- 图片响应需要兼容 `data[].b64_json`、`data[].url` 和顶层 `b64_json`。
- 不要编造第三方站点能力；参数是否生效取决于目标接口实现，应通过提示或 warning 表达不确定性。

## 安全和隐私约定

- API Key 只能保存在浏览器会话状态中，不落库、不写日志、不进入历史记录。
- 生成历史保存在浏览器 IndexedDB，且 `HistoryTask` 不包含 API Key、原始参考图数据或遮罩 dataUrl。
- 默认禁止访问 localhost、loopback 和常见内网地址，除非服务端显式设置 `ALLOW_PRIVATE_BASE_URLS=true`。
- 只允许 `http:` 和 `https:` Base URL。
- 上传图片限制应保持清晰：PNG / JPEG / WEBP，单图 8MB 以内。
- 新增调试信息时，不要把密钥、完整请求头、用户上传图片原文或敏感响应直接暴露到前端。

## UI 和交互约定

- 当前产品是工作台，不是营销落地页。首屏应优先服务实际生图流程。
- 保持中文界面文案，错误提示要面向用户可操作。
- 移动端必须可用：连接区、提示词区、上传区、结果区和历史对比都要在窄屏下自然堆叠或横向滚动。
- 结果展示要支持多图网格、大图预览、下载、发送到编辑、实际提示词查看和历史对比。
- 视觉风格当前是浅色、克制、工作台式界面。新增 UI 应延续现有圆角、边框、柔和背景和信息密度，不要改成营销页或重装饰风格。

## 提示词优化约定

- 规则模板优化必须始终可用，不依赖文本模型。
- AI 改写是可选增强，只有在探测到可能可用的文本模型时优先尝试。
- AI 改写失败时应回退到规则模板，并把原因作为 warning 返回，而不是让整个优化流程失败。
- 中文原始提示词默认输出中文优化结果；英文提示词默认输出英文优化结果。
- 不改变用户核心意图，只补充结构、构图、光线、材质、背景和避免内容。

## 验证要求

代码改动后至少运行：

```bash
pnpm lint
pnpm build
```

涉及页面交互、布局、上传或生成流程时，还应启动本地服务验证：

```bash
pnpm dev
```

重点手测路径：

- 非法 Base URL。
- 私网地址默认拦截。
- 空 API Key。
- `/models` 不可用时的手动模型名降级。
- 规则提示词优化。
- AI 改写失败后的规则回退。
- 缺失提示词提交。
- 文生图失败路径。
- 参考图上传类型和大小限制。
- 参考图接口不兼容时的用户可读错误。
- 流式预览不兼容时的普通生成回退。
- 遮罩画笔导出后作为 mask 参与参考图请求。
- 成功结果进入会话历史，历史不包含 API Key。

## 开发注意事项

- 保持 TypeScript 类型与 API 返回结构同步。
- 用户可读错误优先使用 `UserFacingError`。
- 外部请求应使用已有超时和错误归一化逻辑，不要绕开兼容层直接散落 `fetch`。
- 不要把实际第三方接口能力写死为“必然支持”；以探测结果、手动覆盖和明确 warning 驱动体验。
- 避免无关重构。小改动保持局部，跨模块行为变化要同步更新 README 或架构文档。
