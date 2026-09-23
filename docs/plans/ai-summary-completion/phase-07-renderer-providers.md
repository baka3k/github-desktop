# Phase 7: Renderer Providers + AISummaryService

## Goal

Triển khai phía **renderer** của 3 provider kind (`copilot`, `openai-compat`,
`external-cli`) + orchestrator `AISummaryService`. Phase này *biến* các IPC
channel đã có (Phase 2, 3) thành implementation `IAISummaryProvider`
thực sự, để `app-store._generateCommitMessage` có thể switch sang.

Sau phase này, `resolveProviderForRepository` trả về 1 provider config →
service instantiate implementation tương ứng → provider dispatch qua IPC
(main-process) hoặc wrap `CopilotStore` (in-process).

## Files mới

```
app/src/lib/ai-summary/
├── copilot-provider.ts           # wraps CopilotStore (no IPC, in-process)
├── external-cli-provider.ts      # IPC → main-process cli-runner
├── openai-compat-provider.ts     # IPC → main-process openai-runner
├── service.ts                    # AISummaryService (orchestrator)
└── quick-pick-cli.ts             # QuickPickCLI constant (extract từ UI)
```

## Files sửa

- `app/src/lib/ai-summary/index.ts` — export các file mới
- `app/src/lib/ai-summary/config.ts` — không đổi (đã đủ)

## Implementation Sketch

### `copilot-provider.ts`

```typescript
import type { IAIProviderGenerateArgs, AISummaryResult } from './provider'
import type { ICopilotProviderConfig } from './config'
import type { CopilotStore } from '../stores/copilot-store'

export class CopilotSummaryProvider {
  public readonly kind = 'copilot' as const

  public constructor(private readonly copilotStore: CopilotStore) {}

  public async test(): Promise<AISummaryResult> {
    try {
      await this.copilotStore.getCachedModels()
      return { kind: 'ok', value: { title: '', description: '' } }
    } catch (e) {
      return {
        kind: 'error',
        code: 'unknown',
        userMessage: `Copilot test failed: ${(e as Error).message}`,
      }
    }
  }

  public async generate(args: IAIProviderGenerateArgs): Promise<AISummaryResult> {
    const { diff, rules, signal } = args
    try {
      const msg = await this.copilotStore.generateCommitMessage(
        diff,
        rules,
        signal
      )
      return { kind: 'ok', value: msg }
    } catch (e) {
      if ((e as Error).name === 'CommitMessageGenerationCancelledError') {
        return { kind: 'cancelled' }
      }
      return {
        kind: 'error',
        code: 'unknown',
        userMessage: `Copilot generation failed: ${(e as Error).message}`,
      }
    }
  }
}
```

### `external-cli-provider.ts`

```typescript
import { ipcRenderer } from 'electron'
import type { IAIProviderGenerateArgs, AIProviderIPCResult } from './provider'
import type { IExternalCLIProviderConfig } from './config'
import {
  getAISummaryProviderSecret,
} from './secrets'

export class ExternalCLIProvider {
  public readonly kind = 'external-cli' as const

  public constructor(private readonly config: IExternalCLIProviderConfig) {}

  public async test(): Promise<AIProviderIPCResult> {
    return invokeAIProviderIPC('ai-summary-cli-test', this.config)
  }

  public async generate(args: IAIProviderGenerateArgs): Promise<AIProviderIPCResult> {
    const apiKey =
      this.config.apiKeyEnvVar !== null
        ? await getAISummaryProviderSecret(this.config.id)
        : null

    return invokeAIProviderIPC('ai-summary-cli-run', {
      config: this.config,
      diff: args.diff,
      rules: args.rules,
      signal: args.signal,
      apiKey,
    })
  }
}

function invokeAIProviderIPC(
  channel: 'ai-summary-cli-run' | 'ai-summary-cli-test',
  payload: unknown
): Promise<AIProviderIPCResult> {
  return new Promise((resolve, reject) => {
    const handler = (_: unknown, result: AIProviderIPCResult) => resolve(result)
    ipcRenderer.once(channel + '-reply', handler)
    ipcRenderer.send(channel, payload)
    // Timeout fallback (defensive — runner should self-cancel)
    setTimeout(() => {
      ipcRenderer.removeListener(channel + '-reply', handler)
      resolve({
        kind: 'error',
        code: 'timeout',
        userMessage: 'CLI provider did not respond in time',
      })
    }, this.config.timeoutSeconds * 1000 + 5000)
  })
}
```

> **Note**: cần review lại — `this.config.timeoutSeconds` không accessible trong
> helper function. Refactor: bind config vào closure của `invokeAIProviderIPC`.

### `openai-compat-provider.ts`

```typescript
import type { IAIProviderGenerateArgs, AIProviderIPCResult } from './provider'
import type { IOpenAICompatProviderConfig } from './config'
import {
  getAISummaryProviderSecret,
} from './secrets'

export class OpenAICompatProvider {
  public readonly kind = 'openai-compat' as const

  public constructor(private readonly config: IOpenAICompatProviderConfig) {}

  public async test(): Promise<AIProviderIPCResult> {
    return invokeOpenAIIPC('ai-summary-openai-test', this.config)
  }

  public async generate(args: IAIProviderGenerateArgs): Promise<AIProviderIPCResult> {
    const apiKey =
      this.config.authKind === 'apiKey' || this.config.authKind === 'bearer'
        ? await getAISummaryProviderSecret(this.config.id)
        : null

    return invokeOpenAIIPC('ai-summary-openai-run', {
      config: this.config,
      diff: args.diff,
      rules: args.rules,
      signal: args.signal,
      apiKey,
    })
  }
}
```

### `service.ts` — AISummaryService

```typescript
import type {
  IAISummaryConfig,
  IAISummaryProviderConfig,
} from './config'
import type {
  IAISummaryProvider,
  IAIProviderGenerateArgs,
  AISummaryResult,
} from './provider'
import { resolveProviderForRepository } from './resolve'
import type { CopilotStore } from '../stores/copilot-store'
import type { Repository } from '../../models/repository'
import { CopilotSummaryProvider } from './copilot-provider'
import { ExternalCLIProvider } from './external-cli-provider'
import { OpenAICompatProvider } from './openai-compat-provider'

export interface IAISummaryServiceDeps {
  readonly copilotStore: CopilotStore
}

export class AISummaryService {
  public constructor(private readonly deps: IAISummaryServiceDeps) {}

  /**
   * Resolve active provider for repository, instantiate implementation,
   * and run generate(). Pure function — no global state.
   */
  public async generate(
    config: IAISummaryConfig,
    repository: Repository,
    accounts: ReadonlyArray<Account>,
    args: IAIProviderGenerateArgs
  ): Promise<AISummaryResult> {
    const provider = resolveProviderForRepository(
      config,
      { accounts },
      { id: repository.id }
    )
    if (provider === null) {
      return {
        kind: 'error',
        code: 'invalid-config',
        userMessage: 'No AI summary provider configured',
      }
    }
    const impl = this.instantiate(provider)
    return impl.generate(args)
  }

  private instantiate(
    config: IAISummaryProviderConfig
  ): IAISummaryProvider {
    switch (config.kind) {
      case 'copilot':
        return new CopilotSummaryProvider(this.deps.copilotStore)
      case 'external-cli':
        return new ExternalCLIProvider(config)
      case 'openai-compat':
        return new OpenAICompatProvider(config)
    }
  }
}
```

### `quick-pick-cli.ts`

```typescript
export interface IQuickPickCLI {
  readonly id: string
  readonly displayName: string
  readonly executable: string
  readonly extraArgs: ReadonlyArray<string>
  readonly apiKeyEnvVar: string | null
  readonly installHint: string
}

export const QuickPickCLI: ReadonlyArray<IQuickPickCLI> = [
  { id: 'claudecode', displayName: 'Claude Code',
    executable: 'claudecode', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    installHint: 'npm i -g @anthropic-ai/claude-code' },
  { id: 'mcode', displayName: 'Mcode (local)',
    executable: 'mcode', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g @baka3k/mcode' },
  { id: 'qwen', displayName: 'Qwen CLI',
    executable: 'qwen', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    installHint: 'pip install qwen-cli' },
  { id: 'opencode', displayName: 'Opencode',
    executable: 'opencode', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g opencode' },
  { id: 'commandcode', displayName: 'Commandcode',
    executable: 'commandcode', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g commandcode' },
  { id: 'gemini', displayName: 'Gemini CLI',
    executable: 'gemini', extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'GEMINI_API_KEY',
    installHint: 'npm i -g @google/gemini-cli' },
]
```

> Extract nguyên xi từ `app/src/ui/preferences/ai-summary.tsx:36-92`. Move
> sang `lib/ai-summary/quick-pick-cli.ts` để UI chỉ import.

## Acceptance Criteria

- [ ] `CopilotSummaryProvider` re-uses `CopilotStore.generateCommitMessage`,
      propagate `AbortSignal`, return `cancelled` on
      `CommitMessageGenerationCancelledError`.
- [ ] `ExternalCLIProvider` gọi đúng IPC channel `ai-summary-cli-run` /
      `ai-summary-cli-test`, kèm `apiKey` lookup từ keychain.
- [ ] `OpenAICompatProvider` gọi đúng IPC channel `ai-summary-openai-run`
      / `ai-summary-openai-test`, kèm `apiKey` lookup (chỉ khi
      `authKind !== 'none'`).
- [ ] `AISummaryService.generate` trả về `invalid-config` nếu resolve
      ra `null`.
- [ ] `AISummaryService` không throw ra ngoài — luôn trả `AISummaryResult`.
- [ ] `QuickPickCLI` constant match nguyên xi nội dung cũ (regression test).

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `ipcRenderer.send` không có reply → leak listener | Medium | Medium | Dùng `invoke()` (request/response) thay vì `send`/`once` |
| `CopilotStore.getCachedModels()` không tồn tại | Low | High | Verify signature từ `copilot-store.ts` trước khi viết test |
| Provider implementation gọi IPC khi user cancel | Medium | Low | Tôn trọng `signal` đã pass — main-side runner đã handle |

## Open Questions

- Có nên dùng `ipcRenderer.invoke` (request/response style) thay vì
  `send`/`once` không? Recommend **yes** — ít boilerplate, có built-in
  Promise, không leak listener. Cần verify main-process handler đã wrap
  với `requestResponse` helper chưa.