# gpt-image-2-station Architecture

## Positioning

`gpt-image-2-station` is an MVP image generation workstation for self-hosted individuals or small teams. It targets OpenAI-compatible official endpoints, reverse proxies, relay services, and aggregator gateways that may only be partially compatible.

## Core assumptions

1. The target service is expected to accept bearer-token authentication and mostly OpenAI-shaped request bodies.
2. The target service may fail to expose a working `/models` endpoint even when image generation itself works.
3. `gpt-image-2` may be hidden behind a custom alias, so manual model override is a required fallback.
4. Image editing compatibility is uncertain. MVP supports a single reference image through an OpenAI-style multipart request and clearly reports incompatibility when the target rejects it.
5. Prompt optimization must always work without requiring any text model. AI rewriting is optional and only enabled when probing finds a likely text-capable model.

## Risk model

- SSRF: only `http:` and `https:` are allowed, and loopback/private hosts are rejected by default.
- Secret handling: API keys stay in browser session state and are only forwarded to route handlers; they are never logged or persisted.
- Compatibility drift: all external API responses are normalized behind a server-side compatibility layer.
- UX failure risk on mobile: the layout is designed mobile-first for the task list, image comparison, and upload panel.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Native route handlers for server proxying

Why this stack:

- Fast MVP delivery with a single deployable service
- First-party route handlers for proxy/security logic
- Strong typing for compatibility branches and error normalization
- Straightforward responsive UI composition

## Information architecture

1. Connection configuration
2. Prompt and prompt optimization
3. Parameter controls
4. Reference image upload
5. Result comparison gallery
6. Session history and task snapshots

## Server modules

- `src/lib/openai-compat.ts`
  - Base URL normalization
  - SSRF guardrails
  - Capability probing
  - OpenAI-compatible request proxying
  - Response normalization

- `src/lib/prompt-optimizer.ts`
  - Rule-based optimization
  - Optional AI rewrite prompt builder
  - Prompt diff metadata

- `src/app/api/probe/route.ts`
  - Connectivity and capability detection

- `src/app/api/prompt/optimize/route.ts`
  - Rule rewrite plus optional AI rewrite

- `src/app/api/generate/route.ts`
  - Text-to-image, multi-reference image generation, optional mask forwarding

- `src/app/api/generate/stream/route.ts`
  - SSE proxy for optional streaming image previews with graceful fallback

## Frontend modules

- `src/components/station/station-app.tsx`
  - Main client workstation
- `src/components/station/*`
  - Reusable panels for config, prompting, results, and history

## Data flow

1. User enters `baseUrl`, `apiKey`, and optional model override.
2. Client posts to `/api/probe`.
3. Server validates the URL and probes `/models`, then returns normalized capabilities plus actionable warnings.
4. User writes a prompt and optionally runs optimization.
5. Client posts optimization data to `/api/prompt/optimize`.
6. User submits generation request to `/api/generate` or optional `/api/generate/stream`.
7. Server sends either image generation, streaming image generation, or edit-style multipart request and normalizes output into a single gallery format.
8. Client stores the task snapshot in IndexedDB without API keys or uploaded image data.

## MVP scope

- Included:
  - Connection test
  - Manual model override
  - Rule-based prompt optimization
  - Optional AI rewrite through the probed endpoint
  - Text-to-image
  - Optional streaming preview for text-to-image
  - Multi-reference image flow
  - Mask upload and lightweight mask painter
  - Comparison-ready result gallery
  - IndexedDB history
  - Mobile-adaptive layout
  - User-readable error states

- Deferred:
  - Background queueing
  - Multi-user auth
  - Advanced workflow presets
  - Favorites and cloud downloads

## Acceptance stages

### Stage 1
- Project boots locally.
- Architecture is documented.
- Main page shell exists.

### Stage 2
- Probe, optimize, and generate API routes exist with typed normalization.

### Stage 3
- Full workstation UI exists and stores session history.

### Stage 4
- Lint, type, and build pass.
- Happy-path and failure-path manual checks are documented.
