# Phase 5: Always-Available Gate + Rename + Dispatcher Wiring

## Goal

Đổi gate của button "Generate commit message" từ `accounts.some(enableCommitMessageGeneration)`
(cần Copilot license) sang `hasAnyUsableAIProvider(state)` (cần ít nhất 1
provider đang available). Đổi tất cả user-facing strings từ "Copilot" → "AI".
Route generation qua provider đã chọn.

## Files sửa

- `app/src/ui/changes/commit-message.tsx`:
  - Replace `import { enableCommitMessageGeneration, … } from '../../lib/feature-flag'`
    với `import { hasAnyUsableAIProvider, isAIProviderAvailable } from '../../lib/ai-summary/resolve'`
  - Đổi label `'Generate commit message with Copilot'` → `'Generate commit message with AI'`
  - Đổi aria-label tương ứng
  - Đổi menu item tương ứng
  - `isCopilotButtonEnabled` → `isAIButtonEnabled` (private getter rename)
  - `renderCopilotButton` → `renderAIGenerateButton`
  - Class name `copilot-button` GIỮ NGUYÊN (để không phá CSS / accessibility tests)
    hoặc thêm alias `.ai-button` nếu muốn consistent
- `app/src/ui/changes/sidebar.tsx`:
  - `shouldShowGenerateCommitMessageCallOut` getter đổi từ check
    `enableCopilotSdkCommitMessageGeneration` sang check
    `hasAnyUsableAIProvider(state)`
  - Aria-labels liên quan đổi tương ứng
- `app/src/ui/changes/filter-changes-list.tsx`:
  - Tương tự sidebar
- `app/src/models/commit-message.ts`:
  - Rename `generatedByCopilot` → `generatedByAi` (optional, default false)
    Backward compatible: nếu giá trị cũ vẫn còn trong localStorage, parse
    handle gracefully.
- `app/src/lib/stores/app-store.ts`:
  - `_generateCommitMessage` refactor:
    ```typescript
    // Before
    async _generateCommitMessage(repository, files) {
      const account = getAccountForCommitMessageGeneration(accounts, repository)
      if (!account) return // gated
      await this.copilotStore.generateCommitMessage(account, diff, …)
    }

    // After
    async _generateCommitMessage(repository, files) {
      const aiConfig = this.getState().aiSummaryConfig
      const provider = resolveProviderForRepository(aiConfig, repository, accounts)
      if (!provider) {
        this._showNoAIProviderDialog()
        return
      }
      const result = await this.aiSummaryService.generate(provider, {
        diff, rules, signal: …, repositoryPath: repository.path
      })
      if (result.kind === 'ok') {
        this._setCommitMessage(repository, result.value, { generatedByAi: true })
      }
      // … error handling
    }
    ```
- `app/src/lib/stores/copilot-store.ts`:
  - KHÔNG đổi public API. `CopilotSummaryProvider` mới chỉ wrap
    `this.generateCommitMessage(...)` và re-shape kết quả về
    `AISummaryResult`.
- `app/src/lib/feature-flag.ts`:
  - `enableCommitMessageGeneration` GIỮ NGUYÊN (vẫn dùng cho conflict resolution)
  - KHÔNG thêm flag mới — gate đã chuyển sang resolver-based

## Resolve priority

```typescript
// app/src/lib/ai-summary/resolve.ts

export function resolveProviderForRepository(
  config: IAISummaryConfig,
  state: { accounts: ReadonlyArray<Account> },
  repository: Repository
): IAISummaryProviderConfig | null {
  if (config.activeProviderId) {
    const explicit = config.providers.find(p => p.id === config.activeProviderId)
    if (explicit && isProviderAvailable(explicit, state)) {
      return explicit
    }
  }
  // Fallback: chọn provider available đầu tiên theo thứ tự Copilot → CLI → OpenAI
  for (const p of config.providers) {
    if (p.kind === 'copilot' && isProviderAvailable(p, state)) return p
  }
  for (const p of config.providers) {
    if (p.kind === 'external-cli' && isProviderAvailable(p, state)) return p
  }
  for (const p of config.providers) {
    if (p.kind === 'openai-compat' && isProviderAvailable(p, state)) return p
  }
  return null
}

export function hasAnyUsableAIProvider(state: {
  aiSummaryConfig: IAISummaryConfig
  accounts: ReadonlyArray<Account>
}): boolean {
  return state.aiSummaryConfig.providers.some(p => isProviderAvailable(p, state))
}

function isProviderAvailable(
  p: IAISummaryProviderConfig,
  state: { accounts: ReadonlyArray<Account> }
): boolean {
  if (!p.enabled) return false
  if (p.lastTestStatus === 'error') return false
  switch (p.kind) {
    case 'copilot':
      return state.accounts.some(a => enableCommitMessageGeneration(a))
    case 'openai-compat':
      return true // assume ok nếu không có last error
    case 'external-cli':
      return true
  }
}
```

## Empty-state dialog

Khi user bấm button mà `resolveProviderForRepository` trả `null`, hiển thị:

```
┌─ Set up AI commit messages ─────────────────────────────┐
│ You haven't configured an AI provider yet.               │
│                                                          │
│ GitHub Desktop can generate commit messages using:       │
│                                                          │
│ • GitHub Copilot (uses your existing license)            │
│ • Any OpenAI-compatible API (Ollama, LM Studio, …)       │
│ • An external CLI tool (claudecode, mcode, …)            │
│                                                          │
│ Configure one in Preferences → AI Summary.               │
│                                                          │
│                          [Open Preferences]  [Cancel]    │
└──────────────────────────────────────────────────────────┘
```

## Rename checklist

| File | Line(s) | Before | After |
| --- | --- | --- | --- |
| `commit-message.tsx` | 894-896 | `'Generate Commit Message with Copilot' / 'Generate commit message with Copilot'` | `'Generate Commit Message with AI' / 'Generate commit message with AI'` |
| `commit-message.tsx` | 1009 | `'Generate commit message with Copilot'` (aria) | `'Generate commit message with AI'` |
| `commit-message.tsx` | 1046 | `octicons.copilot` | `octicons.sparkle` (nếu có) hoặc giữ nguyên |
| `commit-message.tsx` | 1026 | `className="copilot-button"` | giữ nguyên (CSS) + thêm alias `.ai-button` |
| `commit-message.tsx` | 1211 | `isCopilotButtonEnabled` | `isAIButtonEnabled` |
| `sidebar.tsx` | ~62 | `shouldShowGenerateCommitMessageCallOut` (giữ tên, đổi impl) | — |
| `models/commit-message.ts` | 14 | `generatedByCopilot?` | `generatedByAi?` |
| `app/static/locales/en-US.json` | (regenerate) | `"copilot"` strings | `"AI"` strings |

## Localization

```bash
# Workflow
# 1. Edit source strings in *.tsx / *.ts (auto-extracted)
npm run localization:extract  # → app/static/locales/en-US.json (overwrite)
# 2. Translate other locales
# (Or rely on community translators via Pontoon / Crowdin)
```

## Acceptance Criteria

- [ ] User chưa có Copilot license nhưng config 1 CLI provider → button
      "Generate commit message with AI" hiển thị + click → generate thành công
- [ ] User không config gì → button vẫn hiện, click → dialog "Set up AI"
- [ ] User có Copilot + 1 OpenAI-compat → dropdown cho phép switch
- [ ] User đổi `activeProviderId` → request tiếp theo dùng provider mới
- [ ] Strings đổi xong, không còn "Copilot" trong flow generate (trừ "Cancel"
      vẫn hợp lệ)
- [ ] Backward compat: `generatedByCopilot?: true` ở localStorage vẫn parse OK

## Risks cụ thể cho phase này

- **Test snapshot cũ fail**: Tests check string "Copilot" → cần update.
  Workaround: search-replace + run `npm test -- -u`.
- **CSS selector**: `.copilot-button` được dùng ở nhiều chỗ. Giữ tên class,
  không rename.
- **Tooltip content**: Mỗi aria-label phải đổi tương ứng, không sót.

## Out of Scope

- Đổi sang icon khác ngoài `octicons.copilot` (chờ design)
- Phím tắt mới
