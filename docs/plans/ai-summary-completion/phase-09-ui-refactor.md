# Phase 9: UI Modularization + QuickPickCLI Extract

## Goal

Refactor `app/src/ui/preferences/ai-summary.tsx` (hiện 572 dòng monolithic,
untracked) thành **9 file con** theo spec Phase 4 của plan gốc, đồng thời
tách `QuickPickCLI` constant ra `lib/ai-summary/quick-pick-cli.ts` (Phase 7
đã tạo file đó — Phase này update UI để import từ đây).

Sau phase này:
- Mỗi component có thể test / review độc lập.
- Thêm 1 CLI mới chỉ cần edit 1 array constant.
- CSS được tách riêng (`ai-summary.scss`), không inline.

## Files mới

```
app/src/ui/preferences/ai-summary/
├── index.tsx                       # Container (entry point — default export)
├── ai-summary-container.tsx        # Outer DialogContent wrapper
├── ai-summary-active-selector.tsx  # Dropdown "Active provider"
├── ai-summary-empty-state.tsx      # Empty state CTA
├── ai-summary-provider-card.tsx    # 1 card / provider
├── ai-summary-test-result.tsx      # Green/red badge
├── ai-summary-add-openai-dialog.tsx
├── ai-summary-add-cli-dialog.tsx
└── ai-summary.scss                 # Styles (move từ inline)
```

## Files xoá

```
app/src/ui/preferences/ai-summary.tsx   # Replaced bởi index.tsx
```

> **Quan trọng**: `app/src/ui/preferences/index.ts` đang export từ
> `./ai-summary`. Sau refactor, update path import nếu cần (path-based,
> không cần update `index.ts`).

## Component Boundaries

### `ai-summary-container.tsx`

Outer container. Holds the `<DialogContent>` + state for `addingProvider`
+ `testingProviderId`.

```typescript
export interface IAISummaryContainerProps {
  readonly config: IAISummaryConfig
  readonly onConfigChanged: (config: IAISummaryConfig) => void
  readonly onDeleteProvider: (id: string) => void
  readonly onTestProvider: (id: string) => Promise<AIProviderIPCResult>
}

export class AISummaryContainer extends React.Component<...> { ... }
```

### `ai-summary-active-selector.tsx`

Dropdown cho "Active provider: …". Reuse `<Select>` + items map từ
`config.providers`.

```typescript
export interface IAISummaryActiveSelectorProps {
  readonly config: IAISummaryConfig
  readonly onConfigChanged: (config: IAISummaryConfig) => void
}

export const AISummaryActiveSelector: React.FC<...> = ({ ... }) => { ... }
```

### `ai-summary-empty-state.tsx`

Render khi `config.providers.length === 0`. CTA copy + 2 nút
"Add OpenAI-compatible provider" + "Add external CLI provider".

### `ai-summary-provider-card.tsx`

Một `<li>` cho mỗi provider. Hiển thị `displayName` + `kind` badge +
`<TestResultBadge>` + buttons (Test / Remove).

```typescript
export interface IAISummaryProviderCardProps {
  readonly provider: IAISummaryProviderConfig
  readonly testing: boolean
  readonly onTest: (id: string) => void
  readonly onDelete: (id: string) => void
}

export const AISummaryProviderCard: React.FC<...> = ({ ... }) => { ... }
```

### `ai-summary-test-result.tsx`

Badge với 3 trạng thái: testing (Loading + "Testing…"), not-tested
("Not tested"), passed (✓ Passed + date), failed (⚠ Failed + date + message).

### `ai-summary-add-openai-dialog.tsx`

Dialog form cho OpenAI-compat: `displayName`, `baseUrl`, `modelId`,
`wireApi`, `authKind`, `timeoutSeconds`.

### `ai-summary-add-cli-dialog.tsx`

Dialog form cho External CLI: QuickPickCLI row + manual entry +
`displayName`, `executable`, `extraArgs`, `timeoutSeconds`,
`workingDirMode`, `apiKeyEnvVar`, `acknowledged` checkbox.

Import `QuickPickCLI` từ `../../lib/ai-summary/quick-pick-cli` (Phase 7
đã extract).

### `ai-summary.scss`

```scss
.ai-summary-prefs {
  h2 { /* ... */ }
  .description { /* ... */ }
  .active-provider-row { /* ... */ }
  .empty-state { /* ... */ }
  .provider-list { /* ... */ }
  .provider-card { /* ... */ }
  .kind-badge { /* ... */ }
  .badge { /* ... */ &.muted { /* ... */ } &.success { /* ... */ } &.error { /* ... */ } }
  .card-actions { /* ... */ }
  .add-buttons { /* ... */ }
  .error-hint { /* ... */ }
  .hint-label { /* ... */ }
  .quick-pick-row { /* ... */ }
  .install-hint { /* ... */ }
  .disclaimer-row { /* ... */ }
}
```

> Các style values copy từ inline JSX hiện tại
> (`ai-summary.tsx:107-130`) — không thay đổi visual.

### `index.tsx`

Re-export container làm default.

```typescript
export { AISummaryContainer as default } from './ai-summary-container'
```

## Acceptance Criteria

- [ ] Tất cả 9 file tồn tại, mỗi file < 250 LOC.
- [ ] `app/src/ui/preferences/ai-summary.tsx` xoá hoàn toàn.
- [ ] `preferences.tsx:46` (`import { AISummaryPreferences } from './ai-summary'`)
      update thành `from './ai-summary'` (vẫn trỏ về index.tsx mới) — không
      cần đổi path vì `./ai-summary` resolve thành `./ai-summary/index.tsx`.
- [ ] `npm run build:dev` thành công.
- [ ] Visual output **giống hệt** bản cũ — không thay đổi UX.
- [ ] `git diff app/src/ui/preferences/ai-summary.tsx` chỉ là deletion
      (không có modification).
- [ ] QuickPickCLI import từ `lib/ai-summary/quick-pick-cli`, không phải
      hard-code trong UI.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Visual regression sau khi tách file | Medium | Medium | Trước refactor: capture screenshot bằng `hi-chrome-devtools` skill; sau refactor: visual diff |
| Inline styles trong JSX cũ khó tách ra SCSS | Medium | Low | Giữ inline `style={{...}}` nếu CSS không match — chỉ extract những rule đã có className |
| State passing giữa container và dialog con không đúng | Low | Medium | Lift state lên container; dialog chỉ là controlled component |

## Open Questions

- Có cần tách `AddOpenAIDialog` / `AddCLIDialog` ra file riêng như plan
  gốc đề xuất? Recommend **yes** (matches spec, dễ test).