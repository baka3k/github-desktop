# Phase 8: Wire commit-message + Gate + Rename

## Goal

Sửa tất cả chỗ vẫn gắn cứng "Copilot" trong flow generate commit message:

1. **Gate** đổi từ `enableCopilotSdkCommitMessageGeneration(accounts)` →
   `hasAnyUsableAIProvider({ accounts, aiSummaryConfig })`.
2. **Button text** "Generate commit message with Copilot" → "Generate commit
   message with AI" (khớp spec plan gốc Phase 5).
3. **`app-store._generateCommitMessage`** đổi từ gọi thẳng
   `copilotStore.generateCommitMessage` → qua `AISummaryService.generate`.
4. **`models/commit-message.ts`**: rename `generatedByCopilot` →
   `generatedByAi`. Migration: nếu localStorage có field cũ → map sang
   field mới (1 lần).
5. **Sidebar / filter-changes-list**: helper `shouldShowGenerateCommitMessageCallOut`
   dùng `hasAnyUsableAIProvider` thay vì check Copilot feature flag.

Sau phase này, **end-to-end flow hoạt động**: user mở app → bấm button →
nhận commit message từ provider đang active (Copilot nếu có license,
hoặc OpenAI-compat / External CLI).

## Files sửa

```
app/src/ui/changes/commit-message.tsx
app/src/ui/changes/sidebar.tsx
app/src/ui/changes/filter-changes-list.tsx
app/src/models/commit-message.ts
app/src/lib/stores/app-store.ts
app/src/lib/app-state.ts                          # readonly aiSummaryConfig (đã có)
app/src/lib/feature-flag.ts                       # không xoá — giữ cho Copilot-only flows khác
app/src/lib/copilot/copilot-message-preview.tsx   # review refs tới generatedByCopilot
```

## Detailed Changes

### 1. `commit-message.tsx`

| Line | Before | After |
| --- | --- | --- |
| 67 | `import { enableCopilotSdkCommitMessageGeneration, … }` | `import { hasAnyUsableAIProvider, isAIProviderAvailable } from '../../lib/ai-summary/resolve'` |
| 474–475 | `messageGeneratedByCopilot: this.state.commitMessage.generatedByCopilot ?? false` | `messageGeneratedByAi: this.state.commitMessage.generatedByAi ?? false` |
| 553–554 | `generatedByCopilot: false` | `generatedByAi: false` |
| 566–567 | `generatedByCopilot: false` | `generatedByAi: false` |
| 624–625 | `messageGeneratedByCopilot: this.state.commitMessage.generatedByCopilot ?? false` | `messageGeneratedByAi: this.state.commitMessage.generatedByAi ?? false` |
| 895–896 | `'Generate Commit Message with Copilot'` / `'Generate commit message with Copilot'` | `'Generate Commit Message with AI'` / `'Generate commit message with AI'` |
| 965 | `private onCopilotButtonClick` | `private onAIButtonClick` (alias giữ cho test) |
| 993 | `private renderCopilotButton()` | `private renderAIButton()` |
| 994 | `if (!this.isCopilotButtonEnabled)` | `if (!this.isAIButtonEnabled)` |
| 1009 | `let ariaLabel = 'Generate commit message with Copilot'` | `let ariaLabel = 'Generate commit message with AI'` |
| 1026 | `className="copilot-button"` | **GIỮ NGUYÊN** (CSS / a11y) |
| 1062 | `(this.isCoAuthorInputEnabled || this.isCopilotButtonEnabled)` | `(this.isCoAuthorInputEnabled || this.isAIButtonEnabled)` |
| 1209–1212 | `isCopilotButtonEnabled` private getter | `isAIButtonEnabled` (logic đổi sang `hasAnyUsableAIProvider`) |

> **Quy ước rename nội bộ**: đổi tên method/getter/field nhưng **giữ nguyên**
> class name `copilot-button` để không phá CSS / accessibility tests.
> Thêm alias `ai-button` trong CSS nếu cần (post-merge cleanup).

### 2. `app-store.ts:6379` — `_generateCommitMessage`

```typescript
// Before
public async _generateCommitMessage(
  repository: Repository,
  filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
): Promise<void> {
  // ... diff + rules ...
  const commitMessage = await this.copilotStore.generateCommitMessage(
    diff,
    rules,
    signal
  )
  // ... commitMessage.setState ...
}

// After
public async _generateCommitMessage(
  repository: Repository,
  filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
): Promise<void> {
  // ... diff + rules ...
  const result = await this.aiSummaryService.generate(
    this.aiSummaryConfig,
    repository,
    this.getState().accounts,
    { diff, rules, signal, repositoryPath: repository.path }
  )
  if (result.kind === 'cancelled') return
  if (result.kind === 'error') {
    this._showPopup({
      type: PopupType.AISummaryError,
      message: result.userMessage,
      code: result.code,
    })
    return
  }
  // ... commitMessage.setState with value.title + value.description ...
}
```

> Inject `AISummaryService` qua `AppStore` constructor (Phase 7 đã tạo).

### 3. `models/commit-message.ts` — rename field

```typescript
// Before
export interface ICommitMessage {
  readonly summary: string
  readonly description: string | null
  readonly generatedByCopilot?: boolean  // ← rename
}

// After
export interface ICommitMessage {
  readonly summary: string
  readonly description: string | null
  readonly generatedByAi?: boolean  // ← new
}
```

**Migration** trong `app-store._loadCommitMessageForWorkingDirectory` (nếu
đang đọc từ localStorage):

```typescript
const raw = localStorage.getItem(commitMessageStorageKey)
if (raw !== null) {
  const parsed = JSON.parse(raw)
  if ('generatedByCopilot' in parsed) {
    parsed.generatedByAi = parsed.generatedByCopilot
    delete parsed.generatedByCopilot
    localStorage.setItem(commitMessageStorageKey, JSON.stringify(parsed))
  }
}
```

### 4. `sidebar.tsx` — `shouldShowGenerateCommitMessageCallOut`

```typescript
// Before
private get shouldShowGenerateCommitMessageCallOut(): boolean {
  return this.props.state.enableCopilotSdkCommitMessageGeneration
}

// After
private get shouldShowGenerateCommitMessageCallOut(): boolean {
  return hasAnyUsableAIProvider({
    accounts: this.props.state.accounts,
    aiSummaryConfig: this.props.state.aiSummaryConfig,
  })
}
```

### 5. `filter-changes-list.tsx`

Tương tự sidebar — check imports, đổi gate.

## Acceptance Criteria

- [ ] `npm run lint` không có warning về unused imports
      (`enableCopilotSdkCommitMessageGeneration` chỉ còn dùng ở
      Copilot-only flows khác nếu có).
- [ ] `grep -rn "generatedByCopilot" app/src` trả về **0** kết quả
      (sau khi xoá alias / migration).
- [ ] User chưa từng dùng Copilot mở app → thấy button "Generate commit
      message with AI" (gate dựa trên `hasAnyUsableAIProvider`).
- [ ] User config OpenAI-compat provider, click button → app-store gọi
      `AISummaryService.generate` → IPC tới main → nhận commit message.
- [ ] Cancel mid-flight → `AISummaryService.generate` trả `{kind: 'cancelled'}`
      → app-store không update commit message state.
- [ ] localStorage cũ có field `generatedByCopilot` → sau lần load đầu
      tiên, field đổi thành `generatedByAi`, không xoá data.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Rename `generatedByCopilot` → `generatedByAi` gây regression cho user cũ | Medium | Low | Migration 1 lần trong app-store load |
| `enableCopilotSdkCommitMessageGeneration` còn dùng cho Copilot-only flow khác (vd conflict resolution) | High | Medium | Grep toàn repo trước khi xoá; chỉ xoá reference ở commit-message.tsx, sidebar.tsx, filter-changes-list.tsx |
| `_generateCommitMessage` đổi signature, callers khác (test, e2e) bể | Medium | Medium | Snapshot test trước/sau; update unit test nếu cần |

## Open Questions

- Có cần thêm `PopupType.AISummaryError` cho error case không? Hiện có
  `PopupType.GenericError` hay tương tự chưa? Verify khi triển khai.