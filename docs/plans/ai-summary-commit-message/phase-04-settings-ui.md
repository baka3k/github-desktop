# Phase 4: Preferences UI — "AI Summary" Tab

## Goal

Thêm một tab mới trong Preferences: **AI Summary**. Trong tab có:

1. **Provider list** — card cho mỗi provider đang config (Copilot, OpenAI-compat, External CLI)
2. **Per-provider actions**: Edit / Delete / **Test connection** / Set as Active
3. **Add provider** CTA cho mỗi kind (3 nút riêng)
4. **Active provider dropdown** ở top — đổi provider đang dùng
5. **Empty state** khi chưa có provider nào

## Files mới

```
app/src/ui/preferences/
├── ai-summary.tsx                        # Container tab
├── ai-summary-provider-card.tsx          # 1 card / provider
├── ai-summary-active-selector.tsx        # Dropdown "Active provider"
├── ai-summary-empty-state.tsx            # Empty state CTA
├── ai-summary-add-copilot-dialog.tsx     # (stub - re-use existing)
├── ai-summary-add-openai-dialog.tsx      # Form: baseUrl, modelId, wireApi, authKind, key
├── ai-summary-add-cli-dialog.tsx         # Form: executable, args, timeout, env var
└── ai-summary-test-result.tsx            # Green/red badge
```

## Files sửa

- `app/src/models/preferences.ts` — thêm `PreferencesTab.AISummary` vào enum
  (chèn trước `Prompts` để giữ logical ordering)
- `app/src/ui/preferences/preferences.tsx` — thêm tab nav item
- `app/src/ui/preferences/index.ts` — export tab component
- `app/src/ui/preferences/ai-summary.tsx` — new file (chứa cả tab)
- `app/src/lib/dispatcher/dispatcher.ts` — thêm methods:
  - `setAISummaryProviderConfig(config: IAISummaryConfig)`
  - `setActiveAISummaryProvider(providerId: string | null)`
  - `testAISummaryProvider(providerId: string): Promise<AIProviderIPCResult>`
  - `getAISummaryConfig(): IAISummaryConfig` (qua state)
- `app/src/lib/stores/app-store.ts` — implement store methods
- `app/static/locales/en-US.json` (và regenerate các locale khác) — strings
- `app/stylesheets/_ai-summary-prefs.less` — scoped styles

## Wire flow

```
User clicks "AI Summary" tab in Preferences
   ↓
AI Summary tab renders with current IAppState.aiSummaryConfig
   ↓
User clicks "+ Add OpenAI-compatible provider"
   ↓
Dialog opens (Dialog component)
   ↓
User fills form → clicks "Save"
   ↓
Dispatcher.setAISummaryProviderConfig(updatedConfig)
   ↓
AppStore persists to localStorage + keychain (for secret)
   ↓
UI re-renders with new card in list
   ↓
User clicks "Test connection"
   ↓
Dispatcher.testAISummaryProvider(id) → IPC → main-process → returns result
   ↓
Card updates: green badge + timestamp OR red badge + error
```

## Form fields

### OpenAI-compatible dialog

```
┌─ Add OpenAI-compatible provider ───────────────────────┐
│ Display name   [_______________________________]        │
│ Base URL       [https://api.openai.com_____________]    │ ← hint
│ Model          [gpt-4o_________________________]        │
│ Wire API       ( ) Chat completions  ( ) Responses       │
│ Auth           [apiKey ▾]   ┌──────────────────────────┐ │
│                ┌────────────┴──────────────────────────┐│
│                │ API key  [sk-•••••••••••••••••  ]    ││
│                │          [Show] [Clear]              ││
│                └───────────────────────────────────────┘│
│ Timeout        [60] seconds                             │
│ Reasoning      [None ▾]   (for o1/o3/GPT-5 only)        │
│                                                        │
│ [Test connection]  [Cancel]              [Save]         │
└────────────────────────────────────────────────────────┘
```

### External CLI dialog

```
┌─ Add external CLI provider ─────────────────────────────┐
│ Quick pick:                                              │
│ [claudecode] [mcode] [qwen] [opencode] [commandcode]    │
│ [gemini] [Custom…]                                      │
│                                                         │
│ Display name   [claudecode___________________________]  │
│ Executable     [claudecode_________________________]    │ ← hint
│                [Browse...]                              │
│ Extra args     [--mode, commit-summary_________________]│
│ Timeout        [60] seconds                             │
│ Working dir    ( ) Repository  (●) Home                  │
│ API key env    [ANTHROPIC_API_KEY___________________]   │ ← optional
│                (key stored in OS keychain)              │
│                                                         │
│ 💡 Install claudecode via `npm i -g @anthropic-ai/      │
│    claude-code`. See docs for other CLIs.               │
│                                                         │
│ ⚠ This will run "{executable}" and feed your staged     │
│ diff via stdin. Only use providers you trust.           │
│                                                         │
│ [Test connection]  [Cancel]              [Save]         │
└─────────────────────────────────────────────────────────┘
```

Khi user click 1 trong 6 quick-pick buttons:
- `claudecode` → executable=`claudecode`, args=`["--mode", "commit-summary"]`,
  env=`ANTHROPIC_API_KEY`, displayName=`Claude Code`
- `mcode` → executable=`mcode`, args=`["--mode", "commit-summary"]`,
  env=``, displayName=`Mcode (local)`
- `qwen` → executable=`qwen`, args=`["--mode", "commit-summary"]`,
  env=`DASHSCOPE_API_KEY`, displayName=`Qwen CLI`
- `opencode` → executable=`opencode`, args=`["--mode", "commit-summary"]`,
  env=``, displayName=`Opencode`
- `commandcode` → executable=`commandcode`, args=`["--mode", "commit-summary"]`,
  env=``, displayName=`Commandcode`
- `gemini` → executable=`gemini`, args=`["--mode", "commit-summary"]`,
  env=`GEMINI_API_KEY`, displayName=`Gemini CLI`
- `Custom…` → clear all, focus executable field

User chỉnh thêm sau khi pick đều OK; quick-pick chỉ là starter template.

## Test result badge

```tsx
function TestBadge({ result, testedAt }: { result: AIProviderIPCResult; testedAt: number | null }) {
  if (!testedAt) return <Badge variant="muted">Not tested</Badge>
  if (result.kind === 'ok') return (
    <Badge variant="success" icon={octicons.check}>
      Passed {formatRelative(testedAt)}
    </Badge>
  )
  return (
    <Badge variant="error" icon={octicons.alert}>
      Failed {formatRelative(testedAt)}: {result.userMessage}
    </Badge>
  )
}
```

## Acceptance Criteria

- [ ] Tab Preferences có entry "AI Summary" giữa `Copilot` và `Prompts`
- [ ] Add OpenAI-compatible provider thành công, persist, hiện trong list
- [ ] Add CLI provider thành công, persist, hiện trong list
- [ ] 6 quick-pick buttons ở Add CLI dialog (`claudecode`, `mcode`, `qwen`,
      `opencode`, `commandcode`, `gemini`) auto-fill config tương ứng
- [ ] "Test connection" cho OpenAI-compat → green khi valid, red với reason
- [ ] "Test connection" cho CLI → green khi binary trên PATH + `--version` works
- [ ] "Set as active" → dropdown reflect thay đổi ngay, persist
- [ ] Delete provider → confirm dialog → remove khỏi list + keychain
- [ ] Disclaimer dialog hiển thị **đúng 1 lần** khi user lưu provider đầu
      tiên có kind `external-cli` (lưu state `aiSummaryExternalCLIDisclaimerLastSeen`
      vào `IAppState`), checkbox "Don't show again" trong dialog
- [ ] Strings extract xong cho `en-US.json`, chạy `gulp localization`

## UX details

- **Responsive**: Tab content scroll-able nếu provider list dài
- **Keyboard**: Enter trong form save, Esc đóng dialog
- **Loading state**: Test button spinner + disable inputs
- **Validation inline**: baseUrl không hợp lệ → highlight field đỏ
- **Sensitive input masking**: API key field password-style, có "Show" toggle
- **Accessibility**: Aria labels cho mọi action, badge screen-reader-friendly
- **Empty state**: "No providers configured. Add your first provider to
  enable AI commit message generation."

## Cross-platform considerations

- Windows: file picker `Browse…` dùng `show-open-dialog` IPC channel
- macOS: dialog sheets attached to Preferences window
- Linux: GNOME / KDE native dialog tự động

## Out of Scope

- Provider templates (cho user save và re-use config)
- Bulk import/export config
- Auto-update check cho CLI binary
