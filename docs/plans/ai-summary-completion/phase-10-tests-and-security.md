# Phase 10: Tests + Telemetry + Security Review

## Goal

Bảo đảm plan completion được verify trên 3 chiều:

1. **Functional correctness** — Unit tests cho mọi file mới ở Phase 7–9,
   integration test cho end-to-end flow.
2. **Observability** — Telemetry capture đúng field, không leak
   diff content / apiKey.
3. **Security** — Stderr redaction, executable validation, output
   sanitization, secret handling.

## Files mới

```
app/test/unit/ai-summary/
├── provider-test.ts                     # IAISummaryProvider interface contracts
├── external-cli-provider-test.ts         # Mock IPC, test happy + error path
├── openai-compat-provider-test.ts        # Mock IPC, test happy + error path
├── copilot-provider-test.ts              # Mock CopilotStore
├── service-test.ts                      # AISummaryService resolve + dispatch
├── resolve-test.ts                      # resolveProviderForRepository priority
├── quick-pick-cli-test.ts                # Constant integrity (regression)
└── migration-test.ts                     # generatedByCopilot → generatedByAi

app/test/main-process/ai-summary/
├── cli-runner-test.ts                    # Spawn + cancel + stderr redaction
└── openai-runner-test.ts                 # HTTP request + abort + timeout

app/test/integration/ai-summary/
└── end-to-end-test.ts                    # config → resolve → service → IPC → result

app/test/security/ai-summary/
├── stderr-redaction-test.ts              # Authorization, Bearer, x-api-key patterns
└── executable-validation-test.ts         # Path traversal, shell injection
```

## Files sửa

- `app/src/lib/stats.ts` — thêm whitelist fields cho `AISummary` event
- `app/test/unit/ipc-contract-test.ts` — verify `ai-summary-*` channels match
  schema (Phase 2/3 đã có channels, giờ chỉ assert shape).

## Test Matrix

### Phase 7 (Renderer Providers)

| File | Tests |
| --- | --- |
| `external-cli-provider-test.ts` | (1) happy: IPC invoke với payload đúng, return ok. (2) test: invoke `cli-test`, return ok. (3) apiKey lookup: `apiKeyEnvVar !== null` → fetch from keychain. (4) apiKey lookup: `apiKeyEnvVar === null` → skip lookup. (5) IPC error → return `kind: 'error'`. (6) timeout → return `kind: 'error', code: 'timeout'` |
| `openai-compat-provider-test.ts` | (1) happy. (2) authKind='apiKey' → fetch apiKey. (3) authKind='bearer' → fetch apiKey. (4) authKind='none' → no apiKey. (5) HTTP 401 → error 'http-error'. (6) AbortSignal mid-flight → 'cancelled' |
| `copilot-provider-test.ts` | (1) happy. (2) `getCachedModels` throws → 'error'. (3) `CommitMessageGenerationCancelledError` → 'cancelled' |
| `service-test.ts` | (1) resolve returns null → 'invalid-config'. (2) resolve returns copilot → dispatch to CopilotSummaryProvider. (3) resolve returns openai-compat → dispatch to OpenAICompatProvider. (4) resolve returns external-cli → dispatch to ExternalCLIProvider. (5) signal propagated to provider |

### Phase 8 (Wire commit-message)

| File | Tests |
| --- | --- |
| `migration-test.ts` | (1) localStorage có `generatedByCopilot: true` → sau load: `generatedByAi: true`, field cũ xoá. (2) localStorage trống → no-op. (3) localStorage có cả 2 field → prefer `generatedByAi` |
| `gate-test.tsx` | (1) `hasAnyUsableAIProvider` false → button ẩn. (2) `hasAnyUsableAIProvider` true (copilot license) → button hiện. (3) `hasAnyUsableAIProvider` true (openai-compat enabled, test passed) → button hiện. (4) `hasAnyUsableAIProvider` true (external-cli enabled, test passed) → button hiện |

### Phase 9 (UI Refactor)

| File | Tests |
| --- | --- |
| `quick-pick-cli-test.ts` | (1) constant có đúng 6 entries. (2) mỗi entry có đủ 5 fields. (3) executable uniqueness. (4) regression: content match nguyên xi `ai-summary.tsx:36-92` cũ |

### Main-process (giày Phase 2/3 + security)

| File | Tests |
| --- | --- |
| `cli-runner-test.ts` | (1) happy: spawn binary, parse JSON fence stdout. (2) cancel: signal → SIGTERM, fallback SIGKILL sau 2s. (3) timeout: timeoutSeconds exceeded → 'timeout'. (4) executable not on PATH → 'executable-not-found'. (5) stderr redaction: line chứa "Authorization: Bearer xxx" → "[REDACTED]" |
| `openai-runner-test.ts` | (1) happy: POST + parse response. (2) HTTP 4xx → 'http-error'. (3) HTTP 5xx → 'http-error'. (4) abort → cancel. (5) timeout → 'timeout'. (6) baseUrl validation: 'http://evil.com' rejected. (7) baseUrl: 'https://api.openai.com/v1' OK |

### Security (Phase 10 mới)

| File | Tests |
| --- | --- |
| `stderr-redaction-test.ts` | (1) `Bearer abc123` → `[REDACTED]`. (2) `Authorization: Basic xyz` → `[REDACTED]`. (3) `x-api-key: secret` → `[REDACTED]`. (4) `ANTHROPIC_API_KEY=sk-xxx` → `[REDACTED]`. (5) Plain text → không redact. (6) Multi-line stderr → mỗi line redact riêng |
| `executable-validation-test.ts` | (1) `claudecode` → OK. (2) `/usr/local/bin/claudecode` → OK. (3) `../../etc/passwd` → reject. (4) `claudecode; rm -rf /` → reject. (5) `claudecode && curl evil.com` → reject. (6) empty string → reject |

### Integration

| File | Tests |
| --- | --- |
| `end-to-end-test.ts` | (1) Config OpenAI-compat, click button → service.generate → mock main-side return → commit message rendered. (2) Config External CLI, click button → service.generate → IPC → mock main-side spawn → commit message rendered. (3) Cancel mid-flight → child killed, no commit message |

## Telemetry (Phase 10)

`app/src/lib/stats.ts` — thêm:

```typescript
// AISummary event
type AISummaryEvent = {
  readonly providerKind: 'copilot' | 'openai-compat' | 'external-cli'
  readonly latencyMs: number
  readonly errorCode?: AIProviderErrorCode
  readonly outcome: 'ok' | 'cancelled' | 'error'
}

// Whitelist — capture chỉ những field này
stats.log('AISummary', {
  providerKind: result.kind === 'ok' ? provider.kind : undefined,
  latencyMs: Date.now() - startTime,
  errorCode: result.kind === 'error' ? result.code : undefined,
  outcome: result.kind,
})
```

> **Verify**: KHÔNG capture `diff`, `commitMessage`, `apiKey`,
> `secretEnvVar`. Thêm unit test assert payload shape.

## Acceptance Criteria

- [ ] `app/test/unit/ai-summary/`, `app/test/main-process/ai-summary/`,
      `app/test/integration/ai-summary/`, `app/test/security/ai-summary/`
      đều tồn tại và non-empty.
- [ ] Coverage ≥ 80% cho: `provider.ts`, `service.ts`, `quick-pick-cli.ts`,
      `external-cli-provider.ts`, `openai-compat-provider.ts`,
      `copilot-provider.ts`, `cli-runner.ts`, `openai-runner.ts`,
      `security.ts`.
- [ ] Mỗi `AIProviderErrorCode` có ít nhất 1 test case.
- [ ] Telemetry payload assertion: không có `diff`, `apiKey`, hoặc
      secret-bearing fields.
- [ ] `npm run test:unit` pass 100%.
- [ ] `npm run lint` không có warning.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mock IPC không khớp implementation thật | Medium | High | Pin contract từ `ipc-shared.ts`; integration test với real channel |
| Coverage không đạt 80% do test phụ thuộc DOM nặng | Medium | Low | Tách logic thuần (resolve, parse) khỏi UI; chỉ test UI snapshot |
| Telemetry leak do dev quên whitelist | Low | High | Test assertion payload chỉ chứa whitelisted keys |

## Open Questions

- Có cần thêm `app/test/e2e/ai-summary.e2e.ts` (Playwright) không?
  Plan gốc yêu cầu. Recommend **yes**, defer tới post-merge nếu thiếu
  thời gian.