# gpt-image-2-station

面向 **OpenAI 兼容 / 反代 / 中转站接口** 的 `gpt-image-2` 图像生成工作台。默认采用 **前后端代理架构**，适合个人或小团队自部署使用。

## What it does

- 用户自行输入 `Base URL` 与 `API Key`
- 自动探测目标站是否支持 `gpt-image-2`
- 支持手动覆盖模型名，不强依赖 `/v1/models`
- 支持提示词优化：**规则模板 + 可选 AI 重写**
- 支持文生图、单图参考生成 / 优化 / 变体尝试
- 支持多结果比较、历史记录、移动端适配
- 默认加入 Base URL 校验与基础 SSRF 防护

## MVP scope

本项目当前定位为：

- **个人 / 小团队自部署**
- **兼容 OpenAI 风格接口，但不假设所有第三方站点完全兼容**
- **优先做稳的能力探测、降级和可用性，不追求一次性覆盖全部高级图片编辑特性**

## Quick start

```bash
pnpm install
pnpm dev
```

打开：`http://localhost:3000`

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4

选择原因：

- 页面、API 代理、类型系统都能放在同一仓库快速交付
- 路由处理器适合做 Base URL 校验、SSRF 防护和兼容层归一化
- TypeScript 适合处理不同中转站常见的响应结构差异
- 响应式布局实现成本低，适合 MVP 快速迭代

## 已实现功能

- 连接配置
  - 用户输入 Base URL、API Key
  - 支持手动覆盖模型名
  - 后端连接探测与能力提示

- 模型探测与兼容性降级
  - 探测 `/v1/models`
  - 尝试识别 `gpt-image-2` 和文本模型
  - 模型列表不可用时，允许“手动模型名 + 直接尝试调用”
  - 对常见失败给出用户可读错误

- 提示词优化
  - 原始提示词输入
  - 负面约束输入
  - 规则模板优化
  - 可选 AI 重写
  - 支持优化结果再次编辑

- 图像生成
  - 文生图
  - 单图参考生成 / 优化 / 变体尝试
  - 质量、数量、尺寸、输出格式、背景、风格提示、seed 参数透传

- 结果展示
  - 多图网格展示
  - 大图预览
  - 下载
  - 查看实际使用提示词和参数
  - 历史任务对比

- 会话级历史记录
  - 存在浏览器 `sessionStorage`
  - 不落库
  - 不保存 API Key

- 移动端适配
  - 单列堆叠布局
  - 对比区支持横向滑动
  - 上传区和参数区适配手机宽度

## 目录结构

```text
src/
  app/
    api/
      probe/route.ts
      prompt/optimize/route.ts
      generate/route.ts
    globals.css
    layout.tsx
    page.tsx
  components/station/
    station-app.tsx
  lib/
    openai-compat.ts
    prompt-optimizer.ts
    types.ts
    utils.ts
docs/
  architecture.md
```

## 核心接口

### `POST /api/probe`

用途：

- 校验 Base URL
- SSRF 风险控制
- 请求模型列表
- 推断 `gpt-image-2`、文本模型、参考图能力说明

### `POST /api/prompt/optimize`

用途：

- 执行规则模板优化
- 若探测到可用文本模型且用户启用 AI 改写，则尝试调用文本模型重写
- 失败时自动回退到规则模板

### `POST /api/generate`

用途：

- 无参考图时走 `/v1/images/generations`
- 有参考图时按 OpenAI 风格走 `/v1/images/edits`
- 兼容 `b64_json` 和 `url` 两种结果结构

## 运行方式

### 1. 安装依赖

```bash
pnpm install
```

### 2. 可选环境变量

复制 `.env.example` 为 `.env.local` 并按需调整：

```bash
cp .env.example .env.local
```

可用变量：

- `ALLOW_PRIVATE_BASE_URLS=false`
  - 默认 `false`
  - 默认禁止访问 `localhost`、`127.0.0.1`、常见内网地址
  - 如果你在本机或内网自部署兼容接口，可改成 `true`

### 3. 启动开发环境

```bash
pnpm dev
```

访问 `http://localhost:3000`

### 4. 生产构建

```bash
pnpm build
pnpm start
```

## 使用说明

1. 在“连接配置”中输入 Base URL 和 API Key。
2. 如目标站使用自定义模型别名，可在“手动模型覆盖”中填写模型名。
3. 点击“测试连接”查看模型列表和能力提示。
4. 在“提示词区”输入原始提示词和避免内容。
5. 选择优化风格，点击“一键优化 / 润色”。
6. 若需要图生图，上传一张参考图。
7. 在参数区选择质量、尺寸、数量、格式等参数。
8. 点击“使用原始提示词生成”或“使用优化提示词生成”。
9. 在结果区查看图片，在历史区勾选任务做对比。

## 兼容性策略

- 不假设所有服务都完整兼容官方 OpenAI。
- Base URL 会自动标准化到 `/v1`。
- `/models` 不可用时，不阻止用户继续尝试生成。
- `gpt-image-2` 未在模型列表中出现时，支持手动模型覆盖。
- 图像编辑能力按 OpenAI 风格接口尝试，若目标服务不支持，会明确提示“当前接口仅支持文生图或不兼容编辑能力”。
- 对 `data[].b64_json` 和 `data[].url` 两种图片返回结构都做了解析。

## 安全设计

- API Key 默认只保存在浏览器会话状态，不落库存储
- 历史记录不保存 API Key
- 默认拒绝访问本机或内网地址，降低 SSRF 风险
- 上传图片限制：
  - 类型：PNG / JPEG / WEBP
  - 大小：8MB 以内

## 当前已知限制

- 没有实现蒙版编辑
- 没有持久化数据库或多用户系统
- 图像编辑兼容性取决于目标接口是否真实支持 OpenAI 风格 `/images/edits`
- 文本模型探测仅做启发式识别，不保证所有中转站都能被准确识别
- 结果对比当前为最多 2 个历史任务并排
- 图片参数是否真正生效，最终取决于目标接口实现

## 自测结果

已完成：

- `pnpm lint`
- `pnpm build`
- 本地 `pnpm dev` 页面加载验证
- API 失败路径手测
  - Base URL 非法
  - 私网地址拦截
  - 规则模板优化返回
  - 缺失提示词报错
  - 模型列表不可用时的降级返回

说明：

- 未对真实第三方中转站进行在线生图实测，因为这取决于用户自己的 Base URL 和 Key
- 未编造第三方接口行为；图像编辑和部分参数能力都按“尝试 + 明确提示”的策略实现

## 架构说明

详细拆解见 [`docs/architecture.md`](./docs/architecture.md)。
