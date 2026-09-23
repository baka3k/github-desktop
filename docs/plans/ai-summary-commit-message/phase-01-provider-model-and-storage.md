# Phase 1: Provider Model & Storage

## Goal

Định nghĩa abstraction `IAISummaryProvider` + persisted config schema +
resolver. Phase này **chưa gắn** provider nào vào UI commit box; chỉ thiết
lập data layer.

## Files mới

```
app/src/lib/ai-summary/
├── provider.ts            # IAISummaryProvider interface
├── config.ts              # IAISummaryConfig, IAISummaryProviderConfig
├── parse.ts               # parseAIProviderConfig (validate JSON load)
├── resolve.ts             # resolveProviderForRepository(state)
├── copilot-provider.ts    # CopilotSummaryProvider (wraps CopilotStore)
└── index.ts               # public exports

app/test/unit/ai-summary/
├── config-test.ts
├── parse-test.ts
└── resolve-test.ts
```

## Files sửa

- `app/src/lib/app-state.ts` — thêm `readonly aiSummaryConfig: IAISummaryConfig`
- `app/src/lib/set-state.ts` — không đổi (chỉ re-export)
- `app/src/lib/stores/app-store.ts` — thêm `_aiSummaryConfig` field + setter
  `setAISummaryProviderConfig(config)`
- `app/src/models/preferences.ts` — KHÔNG đổi (tab mới thêm ở phase 4)

## IAISummaryConfig schema

```typescript
/** Discriminator cho từng provider kind. */
export type AISummaryProviderKind =
  | 'copilot'           // GitHub Copilot (license-gated)
  | 'openai-compat'     // Bất kỳ HTTP endpoint nào theo OpenAI wire format
  | 'external-cli'      // Spawn binary, đọc JSON {title, description} từ stdout

/** Common shape cho mọi provider config. */
export interface IAISummaryProviderConfigBase {
  readonly id: string                  // UUID v4
  readonly displayName: string          // "My GPT-4o", "Local claudecode"
  readonly kind: AISummaryProviderKind
  readonly enabled: boolean             // có dùng được không (toggle off giữ config)
  readonly lastTestedAt: number | null  // epoch ms
  readonly lastTestStatus: 'ok' | 'error' | null
  readonly lastTestError: string | null // user-safe error message
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ICopilotProviderConfig extends IAISummaryProviderConfigBase {
  readonly kind: 'copilot'
  readonly modelId: string | null       // null = default rẻ nhất
}

export interface IOpenAICompatProviderConfig extends IAISummaryProviderConfigBase {
  readonly kind: 'openai-compat'
  readonly baseUrl: string              // validated: https://, hoặc http://localhost
  readonly modelId: string              // "gpt-4o", "llama3", ...
  readonly wireApi: 'chat-completions' | 'responses'
  readonly authKind: 'apiKey' | 'bearer' | 'none'
  readonly timeoutSeconds: number       // default 60
  readonly reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  /** Secret KHÔNG persist ở đây. Lưu trong TokenStore. */
}

export interface IExternalCLIProviderConfig extends IAISummaryProviderConfigBase {
  readonly kind: 'external-cli'
  /** Absolute path hoặc tên trên PATH. Không dùng shell. */
  readonly executable: string
  /** Args trước diff (vd ["--mode", "commit-summary"]). Diff đi qua stdin. */
  readonly extraArgs: ReadonlyArray<string>
  /** Timeout để kill child process. Default 60s. */
  readonly timeoutSeconds: number
  /** Optional custom working directory, default = repository path. */
  readonly workingDirMode: 'repository' | 'home'
  /**
   * Optional: nếu CLI cần API key khác (vd BYOLLM), set ở env name. Không lưu value,
   * chỉ lưu tên biến env. Secret lấy từ TokenStore.
   */
  readonly apiKeyEnvVar: string | null
}

export type IAISummaryProviderConfig =
  | ICopilotProviderConfig
  | IOpenAICompatProviderConfig
  | IExternalCLIProviderConfig

/** Provider user chọn làm active. */
export interface IAISummaryConfig {
  readonly activeProviderId: string | null
  readonly providers: ReadonlyArray<IAISummaryProviderConfig>
}
```

## IAISummaryProvider interface

```typescript
import type { ICopilotCommitMessage } from '../copilot-commit-message'
import type { IRepoRulesMetadataRule } from '../copilot/conflict-resolution-model'

export interface IAIProviderGenerateArgs {
  readonly diff: string
  readonly rules: ReadonlyArray<IRepoRulesMetadataRule>
  readonly signal: AbortSignal
  readonly repositoryPath: string
}

export type AISummaryResult =
  | { readonly kind: 'ok'; readonly value: ICopilotCommitMessage }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly code: string; readonly userMessage: string }

export interface IAISummaryProvider {
  readonly kind: AISummaryProviderKind
  /** Lightweight probe — used by "Test connection" button. */
  test(): Promise<AISummaryResult>
  /** Full generate. Provider phải tôn trọng signal. */
  generate(args: IAIProviderGenerateArgs): Promise<AISummaryResult>
}
```

## Storage rules

- `IAISummaryConfig` (full metadata, no secrets) → JSON trong **localStorage**
  key `ai-summary-config`.
- Mỗi provider có thể có 1 secret riêng → **OS keychain** qua
  `app/src/lib/stores/token-store.ts`:
  - Service: `GitHub Desktop - AI Summary Provider`
  - Account: provider UUID
- Migration từ BYOK: **không tự động**. Nếu user đã có BYOK provider trong
  `copilot-byok-providers`, đề xuất trong UI: "Import existing OpenAI key
  into AI Summary providers?". Phase 1 chỉ build migration hook, Phase 4
  build UI.

## Default config (khi user lần đầu mở app)

```typescript
const initialConfig: IAISummaryConfig = {
  activeProviderId: null,
  providers: [
    {
      id: 'copilot-default',
      kind: 'copilot',
      displayName: 'GitHub Copilot',
      enabled: true,
      modelId: null,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
}
```

## Acceptance Criteria

- [ ] `app/src/lib/ai-summary/parse.ts` validate được mọi field, reject config
      malformed với error code cụ thể
- [ ] `app/src/lib/ai-summary/resolve.ts` chọn được provider theo
      `activeProviderId`, fallback theo default rule ở DR-1
- [ ] `app/src/lib/stores/app-store.ts` có `_aiSummaryConfig: IAISummaryConfig`
      và `_setAISummaryConfig(config)` exposed qua Dispatcher
- [ ] `app/test/unit/ai-summary/parse-test.ts` cover happy path + malformed
      JSON + missing required field + invalid kind discriminator
- [ ] No-op cho UI commit box: button vẫn gate bởi Copilot như cũ, behavior
      không thay đổi

## Testing Strategy

| Test | Type | Coverage |
| --- | --- | --- |
| `parse-test.ts` | Unit | All branches of `IAISummaryProviderConfig` |
| `config-test.ts` | Unit | Quy tắc storage (round-trip JSON, secret tách rời) |
| `resolve-test.ts` | Unit | Provider selection, fallback chain, missing provider |
| `setState` smoke | Manual | Preferences → reload → state restored |

## Out of Scope

- UI Preferences tab — Phase 4
- Provider implementations (chỉ Copilot stub đủ để resolve test pass) — Phase 2 & 3
- Wire vào button "Generate commit message" — Phase 5
