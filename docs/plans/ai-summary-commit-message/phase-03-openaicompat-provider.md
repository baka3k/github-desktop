# Phase 3: OpenAI-Compatible HTTP Provider

## Goal

Cho phép user config **bất kỳ** HTTP endpoint nào theo OpenAI wire format
(Ollama, LM Studio, Groq, Together, OpenRouter, …) để summary diff. Re-use
`parseCopilotCommitMessage` cho output validation, validate `baseUrl` theo
quy tắc giống BYOK (`https://` cho remote, `http://` cho localhost).

## Files mới

```
app/src/main-process/ai-summary/
├── openai-runner.ts          # runOpenAICompatSummary
└── openai-test.ts            # runOpenAICompatTest

app/src/lib/ai-summary/
└── openai-compat-provider.ts

app/test/main-process/ai-summary/
├── openai-runner-test.ts
└── openai-test-test.ts
```

## Files sửa

- `app/src/lib/ipc-shared.ts` — thêm channels:
  ```typescript
  'ai-summary-openai-run': (
    config: IOpenAICompatProviderConfig,
    diff: string,
    rules: ReadonlyArray<IRepoRulesMetadataRule>,
    repositoryPath: string
  ) => Promise<AIProviderIPCResult>

  'ai-summary-openai-test': (
    config: IOpenAICompatProviderConfig
  ) => Promise<AIProviderIPCResult>
  ```
- `app/src/main-process/main.ts` — register handlers (mirror CLI handlers)

## Decision: Tại sao HTTP qua main-process mà không phải renderer?

Renderer có thể `fetch()` trực tiếp từ CSP-permitted origin. Nhưng:

1. **Secret storage**: API key nằm trong `TokenStore` (keychain) — chỉ main
   process đọc được an toàn qua IPC.
2. **CORS**: Nhiều local providers (Ollama chạy trên `localhost:11434`)
   không set CORS headers → renderer bị block. Main-process không bị CORS.
3. **Proxy config**: Đã có `resolve-proxy` IPC channel; main-process xài
   `Electron.net.request` tự động pick up proxy settings.
4. **Telemetry consistency**: Tất cả provider result đều đi qua cùng IPC
   `AIProviderIPCResult`, dễ trace.

## System + user prompt (re-use từ `CopilotStore`)

```typescript
// app/src/main-process/ai-summary/openai-runner.ts
import { CommitMessageSystemPrompt } from '../../lib/copilot-store'  // re-export

const OPENAI_USER_PROMPT_TEMPLATE = (diff: string, tags: Tags, rules: string[]) => `
${tags.diffOpen}
${diff}
${tags.diffClose}
${rules.length > 0 ? `\n${tags.repoRulesOpen}\nConstraints:\n${rules.map(r => `- ${r}`).join('\n')}\n${tags.repoRulesClose}` : ''}
`
```

(Cùng pattern với `buildCommitMessageSystemPrompt` / `buildCommitMessageUserPrompt`
trong `app/src/lib/stores/copilot-store.ts:364` / `:406`.)

## Request shape (chat-completions)

```typescript
interface IChatCompletionsRequest {
  model: string
  messages: Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
  >
  temperature?: number
  max_tokens?: number
  stream?: false
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh'
}

interface IChatCompletionsResponse {
  choices: Array<{
    message: { role: 'assistant'; content: string }
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls'
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}
```

## Request shape (responses API — OpenAI mới)

```typescript
interface IResponsesRequest {
  model: string
  input: Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
  >
  reasoning?: { effort: 'low' | 'medium' | 'high' | 'xhigh' }
}

interface IResponsesResponse {
  output: Array<{
    type: 'message'
    role: 'assistant'
    content: Array<{ type: 'output_text'; text: string }>
  }>
}
```

## Implementation sketch

```typescript
export async function runOpenAICompatSummary(args: IRunArgs): Promise<AIProviderIPCResult> {
  const { config, diff, signal } = args

  // 1. Validate baseUrl (https only, http chỉ cho localhost)
  if (!isValidBYOKBaseUrl(config.baseUrl)) {
    return errorResult('invalid-config', `baseUrl "${config.baseUrl}" is not allowed. Use https:// or http://localhost.`)
  }

  // 2. Resolve secret from keychain
  const secret = config.authKind !== 'none'
    ? await TokenStore.getItem(AIProviderTokenStoreKey, config.id)
    : null
  if (config.authKind !== 'none' && !secret) {
    return errorResult('missing-credential', 'API key not set. Re-enter in Preferences.')
  }

  // 3. Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  if (config.authKind === 'apiKey') {
    headers['Authorization'] = `Bearer ${secret}`
  } else if (config.authKind === 'bearer') {
    headers['Authorization'] = `Bearer ${secret}`
  }
  // authKind === 'none': no header (e.g. local Ollama)

  // 4. Build URL based on wireApi
  const url = config.wireApi === 'responses'
    ? `${config.baseUrl.replace(/\/$/, '')}/v1/responses`
    : `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`

  // 5. Build body
  const tags = generateCommitMessagePromptTags()
  const cleanedRules = getCleanedEnforcedRuleDescriptions(args.rules)
  const userPrompt = buildCommitMessageUserPrompt(diff, tags, cleanedRules)
  const systemPrompt = buildCommitMessageSystemPrompt(cleanedRules.length > 0, tags)

  const body = config.wireApi === 'responses'
    ? {
        model: config.modelId,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        reasoning: config.reasoningEffort ? { effort: config.reasoningEffort } : undefined,
      }
    : {
        model: config.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      }

  // 6. Fetch with timeout + abort
  const controller = new AbortController()
  const timeoutMs = (config.timeoutSeconds ?? 60) * 1000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeout)
    if (signal?.aborted) return { kind: 'cancelled' }
    return errorResult('network-error', e instanceof Error ? e.message : 'Network error')
  }
  clearTimeout(timeout)

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    return errorResult('http-error',
      `Provider returned ${response.status}: ${errText.slice(0, 300)}`)
  }

  // 7. Parse response
  const json: unknown = await response.json()
  const content = extractAssistantContent(json, config.wireApi)

  // 8. Parse JSON → {title, description} via existing fence parser
  try {
    const parsed = parseCopilotCommitMessage(content)
    return { kind: 'ok', title: parsed.title, description: parsed.description }
  } catch (e) {
    return errorResult('invalid-output', e instanceof Error ? e.message : 'Bad JSON')
  }
}
```

## Test connection (PONG ping)

```typescript
export async function runOpenAICompatTest(args: { config: IOpenAICompatProviderConfig }): Promise<AIProviderIPCResult> {
  // Same header / URL setup as run
  // Body: { model: config.modelId, messages: [{role:'user', content:'Reply with exactly: PONG'}] }
  // Validate response.content.includes('PONG')
}
```

## Acceptance Criteria

- [ ] Gọi được `https://api.openai.com/v1/chat/completions` với key hợp lệ
      → trả `ICopilotCommitMessage`
- [ ] Gọi được `http://localhost:11434/v1/chat/completions` (Ollama, không key)
      → trả `ICopilotCommitMessage`
- [ ] `https://evil.example.com` → reject với `invalid-config`
- [ ] HTTP 401/403 → `error: 'http-error'`, user message redact API key
- [ ] HTTP 429 → đề xuất retry (không auto-retry)
- [ ] Cancel giữa request → abort fetch, trả `cancelled`
- [ ] Test connection xanh khi key đúng, đỏ khi sai, đỏ khi mạng lỗi

## Out of Scope

- Tool calls (function calling)
- Vision input
- Streaming
- Multi-modal providers
