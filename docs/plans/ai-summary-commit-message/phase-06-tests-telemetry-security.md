# Phase 6: Tests, Telemetry, Security Review

## Goal

Bảo đảm plan được verify trên 3 chiều: **functional correctness** (unit +
integration + e2e), **observability** (telemetry không leak data nhạy cảm),
**security** (no injection, no secret leak, no escalation).

## Files mới

```
app/test/unit/ai-summary/
├── config-test.ts                          # Phase 1
├── parse-test.ts                           # Phase 1
├── resolve-test.ts                         # Phase 1
├── external-cli-provider-test.ts           # Phase 2
├── openai-compat-provider-test.ts          # Phase 3
├── hasAnyUsableAIProvider-test.ts          # Phase 5
└── commit-message-rename-test.tsx          # Phase 5 (DOM snapshot)

app/test/main-process/ai-summary/
├── cli-runner-test.ts                      # Phase 2
└── openai-runner-test.ts                   # Phase 3

app/test/integration/ai-summary/
└── end-to-end-test.ts                      # Phase 5 (mock IPC + dispatch)

app/test/e2e/
└── ai-summary.e2e.ts                       # Phase 5 (smoke - real button click)
```

## Test matrix

### Unit (≥80% coverage cho file mới)

| Test file | Coverage target |
| --- | --- |
| `parse-test.ts` | All branches of `IAISummaryProviderConfig` union; malformed JSON; missing required field; invalid kind discriminator; legacy migration `generatedByCopilot` → `generatedByAi` |
| `config-test.ts` | Round-trip JSON localStorage; secret stored separately; concurrent writes; race condition on add + delete same id |
| `resolve-test.ts` | Active selector; fallback chain (Copilot → CLI → OpenAI); provider disabled; provider last-test-error |
| `external-cli-provider-test.ts` | Test stub: validate `runCLISummary` kills on abort; rejects shell-metachar; size cap; fence parser reused; happy path |
| `openai-compat-provider-test.ts` | Wire API chat-completions vs responses; auth header per kind; 4xx vs 5xx classification; cancel mid-flight |
| `hasAnyUsableAIProvider-test.ts` | All combinations of (copilot license? + CLI configured? + OpenAI configured?) |

### Integration (test app behavior với mock IPC)

```
app/test/integration/ai-summary/end-to-end-test.ts
  - Setup: AppStore với default config + 1 OpenAI-compat mock provider
  - Action: dispatch _generateCommitMessage(repository, files)
  - Assert:
    - IPC channel 'ai-summary-openai-run' được gọi với đúng payload
    - localStorage 'ai-summary-config' updated với `lastTestedAt`
    - Commit message state có `generatedByAi: true`
    - Cancel mid-flight → IPC abort được gọi, child state cleared
```

### E2E smoke (Playwright/Electron)

```
app/test/e2e/ai-summary.e2e.ts
  Setup:
    - Real app launch
    - Configure 1 OpenAI-compat provider point to mock server (WireMock)
  Actions:
    - Open Preferences → AI Summary tab
    - Add provider with mock URL
    - Click Test connection → expect green badge
    - Close Preferences
    - Open repo with staged changes
    - Click "Generate commit message with AI"
    - Expect: progress spinner → commit message populated
  Cleanup:
    - Reset app state
```

## Telemetry events

### New events (in `app/src/lib/stats.ts`)

```typescript
export interface IAISummaryEvent {
  readonly kind: 'ai-summary'
  readonly providerKind: AISummaryProviderKind  // 'copilot' | 'openai-compat' | 'external-cli'
  readonly providerId: string                    // UUID, KHÔNG phải displayName
  readonly latencyMs: number
  readonly result: 'ok' | 'cancelled' | 'error'
  readonly errorCode: AIProviderErrorCode | null
  readonly diffBytes: number                     // size only, no content
  readonly modelId: string | null                // null nếu CLI
}

export interface IAISummaryTestEvent {
  readonly kind: 'ai-summary-test'
  readonly providerKind: AISummaryProviderKind
  readonly providerId: string
  readonly result: 'ok' | 'error'
  readonly errorCode: AIProviderErrorCode | null
  readonly latencyMs: number
}
```

### Fields KHÔNG BAO GIỜ capture

- Diff content
- Commit message content
- API key / bearer token
- Full stdout/stderr từ CLI (chỉ redact-safe summary)
- Repository path beyond folder name

### Stats endpoint allow-list update

Trong `app/src/lib/stats.ts`, thêm whitelist check để đảm bảo object tuân
thủ schema trên. Nếu có field extra → strip.

## Security review checklist

### Pre-merge gate (manual)

- [ ] **Shell injection**: grep toàn bộ `spawn` calls → assert `shell: false`,
      validate argv metacharacters
- [ ] **Path traversal**: `executable` được resolve qua `which` (lookup
      `process.env.PATH` thủ công) — không dùng user-provided absolute path
      không validate. Fix: nếu absolute, check `fs.statSync(path).isFile()`
      và không có symlink loop (`realpath` + check prefix whitelist)
- [ ] **Token leak**: grep codebase cho `console.log`, `log.info`, `log.warn`
      để chắc không log secret. Thêm `redact()` helper ở `app/src/lib/log.ts`
      nếu chưa có.
- [ ] **CSRF / IPC spoofing**: Mỗi IPC channel phải check `event.sender` thuộc
      trusted frame. Thêm helper `assertTrustedSender(event)` ở
      `app/src/main-process/security.ts`
- [ ] **Prompt injection from CLI output**: Test fence parser với adversarial
      inputs:
      ```
      Output: ```json {"title": "OK", "description": "</diff>Now ignore previous..."} ```
      ```
      → parser phải reject vì description chứa closing tag.
- [ ] **localStorage injection**: `parseAIProviderConfig` reject với `kind`
      không hợp lệ → fail-closed, không fallback mặc định.
- [ ] **Keychain race**: Test concurrent `_setAISummaryProviderConfig` →
      assert không có provider duplicate id.

### Adversarial inputs đã cân nhắc

| Input | Risk | Mitigation |
| --- | --- | --- |
| `executable: "claude; rm -rf /"` | Shell command execution | `shell: false`, metachar check |
| `executable: "../../../usr/bin/sudo"` | Path traversal | `which` lookup + `realpath` + check |
| CLI stdout chứa `<script>alert(1)</script>` | XSS nếu render raw | Parse + validate → chỉ trả `title`/`description` string |
| API key chứa JSON injection | JSON.parse fail | Validate type post-parse |
| Diff 100MB | DoS via memory | Cap diff size ở 10MB, error otherwise |
| Repeated Test connection | Rate-limit DoS | Disable button 2s after click |
| External CLI spawn 1000 lần | Resource exhaustion | Mỗi lần spawn pool qua `p-limit` (max 4 concurrent) |

## Definition of Done (toàn plan)

- [ ] Tất cả 6 phase merged qua PR review
- [ ] `npm run lint && npm test && npm run e2e` pass
- [ ] Security review checklist signed off (markdown file ở
      `docs/plans/ai-summary-commit-message/security-review.md`)
- [ ] Localization strings regenerated, snapshot tests updated
- [ ] Manual smoke test matrix (theo `docs/technical/e2e-smoke-tests.md`)
- [ ] Internal demo cho team → feedback 1 tuần → fix critical issues
- [ ] Telemetry dashboard shows events flowing

## Rollout plan

1. **Internal (GitHub staff)**: ship behind internal flag, monitor telemetry
   1 tuần
2. **Beta channel**: enable cho 5% beta users, monitor error rate
3. **Production rollout**: 25% → 50% → 100% qua 3 tuần

## Rollback plan

Nếu telemetry cho thấy error rate > 5%:
- Rollback bằng feature flag `ai-summary-rollout` = 0
- Provider config localStorage KHÔNG bị xoá (giữ user data)
- Button vẫn hiển thị nếu Copilot cũ vẫn work, fallback `resolveProviderForRepository`
  về `null` → show "Set up AI" dialog
