# Plan: AI Summary — Completion (CLI Configs + UI)

## TL;DR

Hoàn thiện tính năng **AI Summary → commit message** đã được khởi tạo trong
[plan gốc](../ai-summary-commit-message/plan.md). Plan gốc đã làm xong data
layer + main-process runners (Phase 1–3), nhưng còn thiếu:

1. **Renderer-side provider implementations** — `external-cli-provider.ts`,
   `openai-compat-provider.ts`, `copilot-provider.ts` chưa có, nên main-process
   IPC channels không ai gọi.
2. **AISummaryService** orchestrator — chưa có, nên `app-store._generateCommitMessage`
   vẫn gọi thẳng `copilotStore.generateCommitMessage` (chỉ support Copilot).
3. **Phase 5 wiring** — `commit-message.tsx` vẫn gắn cứng chuỗi
   "Generate commit message with Copilot" và gate bằng `enableCopilotSdkCommitMessageGeneration`
   (license check). User không có Copilot license không thấy button, kể cả
   khi đã config OpenAI-compat hoặc External CLI.
4. **UI modularization** — Phase 4 dự kiến 9 file con, hiện chỉ có 1 file
   monolithic `ai-summary.tsx` (572 dòng, untracked). Khó maintain, khó test.
5. **Tests** — `app/test/unit/ai-summary/`, `app/test/main-process/ai-summary/`,
   `app/test/integration/ai-summary/` đều rỗng. Plan gốc yêu cầu ≥ 80% coverage.

## Goals & Non-Goals

### Goals (P0 — block release)

- ✅ Renderer-side provider cho cả 3 kind: `copilot`, `openai-compat`,
  `external-cli`. Mỗi provider implement `IAISummaryProvider` (đã có ở
  Phase 1).
- ✅ `AISummaryService` orchestrator: nhận `IAISummaryConfig + state`,
  resolve provider, dispatch đúng implementation, propagate `AbortSignal`.
- ✅ Wire `_generateCommitMessage` qua `AISummaryService`. Remove direct
  call `copilotStore.generateCommitMessage`.
- ✅ Refactor `commit-message.tsx`: gate = `hasAnyUsableAIProvider`,
  text = "Generate commit message with AI", aria-label tương ứng.
- ✅ Refactor `app/src/ui/preferences/ai-summary.tsx` thành 9 file con
  theo spec Phase 4 (giữ nguyên behavior).
- ✅ QuickPickCLI hiện đang hard-code trong `ai-summary.tsx:36-92`. Tách
  ra `app/src/lib/ai-summary/quick-pick-cli.ts` để dễ test + dễ thêm CLI mới.

### Goals (P1 — quality)

- ✅ Unit tests: config, parse, resolve, providers, service.
- ✅ Security review: stderr redaction, executable validation, secret
  handling, output sanitization.
- ✅ Telemetry: chỉ capture provider kind + latency + error code.

### Non-Goals

- ❌ Streaming partial commit message (defer to v2)
- ❌ Provider chaining / fallback chain (giữ 1 active provider)
- ❌ Plugin runtime động (provider list vẫn là static enum)
- ❌ Auto-update QuickPickCLI list từ npm registry (user tự edit constant)

## Current State (verified Sep 2026)

| Phase | Spec | Status | Notes |
| --- | --- | --- | --- |
| 1 | Provider model + storage | ✅ Done | `config.ts`, `parse.ts`, `resolve.ts`, `secrets.ts`, `provider.ts` đầy đủ |
| 2 | External CLI + IPC | ⚠️ Half | main-side `cli-runner.ts` + IPC channels done. **Missing**: renderer `external-cli-provider.ts` |
| 3 | OpenAI-compat + IPC | ⚠️ Half | main-side `openai-runner.ts` + IPC channels done. **Missing**: renderer `openai-compat-provider.ts` |
| 4 | Preferences UI | ⚠️ Half | 1 file monolithic (572 LOC) thay vì 9 modular files. Preferences tab wired nhưng chưa có CSS module |
| 5 | Gate + rename + dispatch | ❌ Not started | `commit-message.tsx` vẫn dùng `enableCopilotSdkCommitMessageGeneration`; `_generateCommitMessage` gọi thẳng `copilotStore` |
| 6 | Tests + telemetry + security | ❌ Not started | 0 test files |

## High-Level Architecture (after completion)

```
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ UI: Preferences → "AI Summary" tab (modular)                 │  │
│  │   - 9 files: container, provider-card, active-selector,      │  │
│  │     empty-state, add-openai-dialog, add-cli-dialog,           │  │
│  │     add-copilot-stub, test-result, copy                       │  │
│  │   - QuickPickCLI extracted to lib/ai-summary/quick-pick-cli  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│                            ▼                                       │
│  AISummaryService (new — orchestrator)                             │
│   ├─ CopilotSummaryProvider       (wraps CopilotStore)             │
│   ├─ OpenAICompatSummaryProvider  → IPC 'ai-summary-openai'         │
│   └─ ExternalCLIProvider          → IPC 'ai-summary-cli'           │
│                            │                                       │
│                            ▼                                       │
│  AppStore._generateCommitMessage (rewrite)                          │
│    → AISummaryService.generate(diff, rules, signal)                │
│                            │                                       │
│                            ▼                                       │
│  commit-message.tsx (rewritten gate + label)                        │
│    → gate = hasAnyUsableAIProvider(state)                          │
│    → text = "Generate commit message with AI"                      │
└────────────────────────────────────────────────────────────────────┘
```

## Constraint Matrix (inherits from plan gốc)

Tất cả constraint C1–C8 từ plan gốc vẫn áp dụng. Bổ sung:

| # | Constraint | Source | Phản ứng |
| - | --- | --- | --- |
| C9 | Renderer provider không được phép spawn child process | Electron sandbox | Renderer chỉ gọi IPC, main-side runner mới spawn |
| C10 | AISummaryService phải là pure function (no global state) | Testability | Inject `config` + `state` + `signal` mỗi call |
| C11 | Test phải cover cả happy path + mỗi `AIProviderErrorCode` | Plan gốc C6 | Unit tests matrix provider × errorcode |

## Phases

| # | File | Title | Est. complexity | Pinned to |
| - | --- | --- | --- | --- |
| 7 | [phase-07-renderer-providers.md](./phase-07-renderer-providers.md) | Renderer providers + AISummaryService | M | P0 |
| 8 | [phase-08-wire-commit-message.md](./phase-08-wire-commit-message.md) | Wire commit-message + gate + rename | M | P0 |
| 9 | [phase-09-ui-refactor.md](./phase-09-ui-refactor.md) | UI modularization + QuickPickCLI extract | M | P0 |
| 10 | [phase-10-tests-and-security.md](./phase-10-tests-and-security.md) | Tests + telemetry + security review | L | P1 |

## Cross-Plan Dependencies

- **Blocks**: Không.
- **Bị block bởi**:
  - `ai-summary-commit-message` (plan gốc, Phases 1–3) — đã có data layer + main-process runners, **completion plan này implement renderer-side dựa trên các IPC channels đã có**.
- **Touches (không block)**:
  - `app/src/ui/changes/commit-message.tsx` (Phase 8)
  - `app/src/ui/changes/sidebar.tsx` (Phase 8)
  - `app/src/ui/changes/filter-changes-list.tsx` (Phase 8)
  - `app/src/models/commit-message.ts` (Phase 8 — rename field)
  - `app/src/lib/stores/app-store.ts:6379` — `_generateCommitMessage` (Phase 8)
  - `app/src/ui/preferences/ai-summary.tsx` (Phase 9 — refactor)
  - `app/src/lib/stats.ts` (Phase 10 — telemetry whitelist)

## Validation Checklist (Definition of Done)

- [ ] **End-to-end**: User mới (no Copilot license) mở app → bấm "Generate
      commit message with AI" → mở Preferences → config OpenAI-compat →
      quay lại commit box → bấm button → nhận commit message đúng schema.
- [ ] **External CLI**: User config `claudecode` → bấm button → main-process
      spawn binary → nhận stdout → parse JSON fence → render.
- [ ] **Cancel**: Mid-flight cancel → child process killed (SIGTERM, fallback
      SIGKILL sau 2s) cho external-cli; AbortController cho openai-compat.
- [ ] **Gate**: Button ẩn khi `hasAnyUsableAIProvider` false; hiện cho
      mọi account có ít nhất 1 provider enabled + passed test.
- [ ] **Rename**: Tất cả user-facing strings "Copilot" → "AI". Class name
      `copilot-button` giữ nguyên (CSS / a11y compatibility).
- [ ] **Tests**: Unit ≥ 80% coverage cho files mới (`provider.ts`,
      `service.ts`, `quick-pick-cli.ts`, `external-cli-provider.ts`,
      `openai-compat-provider.ts`, `copilot-provider.ts`).
- [ ] **Security**: stderr redaction passes test với mẫu chứa `Authorization`,
      `Bearer`, `x-api-key`. `isValidBYOKBaseUrl` còn được dùng cho cả
      OpenAI-compat provider (không bypass).
- [ ] **Telemetry**: `stats.log('AISummary', { kind, latencyMs, errorCode })`
      — không có `diff` content, không có `apiKey`.
- [ ] `npm run lint && npm run test && yarn build:dev` đều pass.

## Open Questions

> Trả lời trước khi bắt đầu Phase 7.

1. **Renderer-side `IAISummaryProvider` interface** — `app/src/lib/ai-summary/provider.ts:21`
   đã có interface. Có giữ nguyên hay mở rộng để có thêm
   `displayName` cho UI? (Recommend: giữ nguyên, displayName từ config.)
2. **AISummaryService location** — đặt ở `app/src/lib/ai-summary/service.ts`
   hay `app/src/lib/stores/ai-summary-service.ts`? (Recommend: `lib/ai-summary/`
   để giữ cùng module với provider implementations.)
3. **`generatedByCopilot` rename** — Đổi sang `generatedByAi` có breaking
   change với localStorage migration không? (Recommend: rename + migration
   script trong `app-store.ts._setAISummaryConfig` đọc field cũ nếu có.)

## References

- Plan gốc: [docs/plans/ai-summary-commit-message/](../ai-summary-commit-message/plan.md)
- Codebase entry points (verified Sep 2026):
  - `app/src/lib/ai-summary/config.ts:42` — `IAISummaryProviderConfig` union
  - `app/src/lib/ai-summary/provider.ts:21` — `IAISummaryProvider` interface
  - `app/src/lib/ai-summary/resolve.ts:33` — `resolveProviderForRepository`
  - `app/src/lib/stores/app-store.ts:6379` — `_generateCommitMessage` (Phase 8 target)
  - `app/src/ui/changes/commit-message.tsx:895` — "Generate commit message with Copilot" string (Phase 8 target)
  - `app/src/ui/preferences/preferences.tsx:611` — already wires `AISummaryPreferences`
  - `app/src/main-process/ai-summary/cli-runner.ts` — done (Phase 2)
  - `app/src/main-process/ai-summary/openai-runner.ts` — done (Phase 3)
  - `app/src/lib/ipc-shared.ts:146-167` — IPC channels already defined
- Existing docs:
  - `docs/technical/error-reporting.md` — error UX (still applies)
  - `docs/technical/adding-tests.md` — test pattern (still applies)
  - `docs/process/usage-data.md` — telemetry rules (still applies)