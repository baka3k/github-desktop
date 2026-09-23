# Plan: AI Summary — Pluggable Providers cho Generate Commit Message

## TL;DR

Tách tính năng "AI summary → commit message" ra khỏi chỉ-một-Copilot. Cho phép
user chọn một trong các provider:

1. **GitHub Copilot** (hiện tại, gate theo license + `isCopilotDesktopEnabled`)
2. **OpenAI-compatible HTTP** (re-use BYOK infrastructure, có sẵn) — call LLM
   endpoint theo chuẩn OpenAI (Ollama, LM Studio, Groq, Together, OpenRouter,
   self-hosted…)
3. **External CLI** (mới) — spawn bất kỳ binary nào user chỉ định trên PATH,
   nhận diff qua stdin, nhận `{title, description}` qua stdout. Supported /
   tested CLIs (xem [DR-3](#dr-3-external-cli--protocol-là-gì) cho invocation):
   - **`claudecode`** — Anthropic Claude Code CLI
   - **`mcode`** — local Mavis-based CLI
   - **`qwen`** — Alibaba Qwen CLI
   - **`opencode`** — opencode CLI
   - **`commandcode`** — generic command-code CLI
   - **`gemini`** — Google Gemini CLI (newly added)

Provider được config trong một tab Preferences mới với nút **Test connection**
cho từ nguồn (xanh = pass, đỏ = error). Button trên UI commit box đổi từ
"Generate commit message with Copilot" → "Generate commit message with AI" và
hiển thị cho mọi user miễn là có ít nhất một provider đang `available`.

## Goals & Non-Goals

### Goals

- ✅ Pluggable provider model: mỗi provider là một unit độc lập với cùng
  contract `generateCommitMessage(diff, rules, signal): Promise<ICopilotCommitMessage>`
- ✅ 3 provider kind out of the box: `copilot`, `openai-compat`, `external-cli`
- ✅ UI Settings: thêm/sửa/xoá/test provider, persist config, secret trong
  OS keychain
- ✅ Test connection per-provider với feedback rõ ràng (xanh/đỏ + message)
- ✅ Luôn hiện button "Generate commit message with AI"; nếu chưa có provider
  → bấm mở dialog hướng dẫn cấu hình
- ✅ Đổi tên button + tooltip + aria-label + menu item
- ✅ Backward compatible: tất cả hiện trạng flow Copilot vẫn hoạt động nếu
  user không đổi gì

### Non-Goals (lùi lại cho v1)

- ❌ Streaming partial commit message (giữ request/response đơn giản)
- ❌ Provider chaining / fallback chain (chỉ 1 provider active tại 1 thời điểm)
- ❌ Plugin runtime động (provider list là static enum, mỗi kind có UI form riêng)
- ❌ Rewrite Copilot conflict resolution — chỉ apply cho commit message
- ❌ Auto-discovery CLI trên PATH lúc startup (test on-demand + lazy resolve)

## Stakeholders

| Role | Concern |
| --- | --- |
| End user | Luôn có nút AI summary, không bị gated bởi Copilot license |
| Power user | Config được OpenAI key/CLI của riêng mình |
| Privacy-conscious user | Dùng local CLI (claudecode/mcode) thay vì cloud |
| Maintainer | Không tăng attack surface; mỗi CLI output phải được validate |
| Localizer | Đổi chuỗi → chạy `gulp localization` để cập nhật `app/static/locales/*.json` |

## Constraint Matrix

| # | Constraint | Source | Phản ứng |
| - | --- | --- | --- |
| C1 | Renderer process không spawn được child process trực tiếp | Electron sandbox | Mọi CLI spawn phải qua IPC → main process |
| C2 | Diff có thể chứa byte nhạy cảm (credentials, secret) | Git diff content | CLI provider phải timeout + size cap + redact stderr khi log |
| C3 | Provider output có thể chứa prompt-injection | Untrusted CLI output | Re-use `parseCopilotCommitMessage` pattern: extract JSON fenced block, validate schema, reject nếu có field ngoài `title`/`description` |
| C4 | API key / bearer token không bao giờ được persist ra localStorage | Hiện tại BYOK dùng `TokenStore` (keychain) | Provider mới phải follow same pattern: secret riêng, metadata riêng |
| C5 | Telemetry không được capture secret/diff content | `app/src/lib/stats.ts` | Sanitize payload, chỉ ghi provider kind + latency + error code |
| C6 | User phải thấy được error message rõ ràng | `docs/technical/error-reporting.md` | Mỗi error có `userMessage` + `code`, render trong dialog |
| C7 | Tính năng luôn khả dụng cho mọi user | Yêu cầu | Gate chuyển từ `accounts.some(enableCommitMessageGeneration)` sang `hasAnyUsableAIProvider(state)` |
| C8 | Cancel phải thực sự tear-down | Hiện `AbortSignal` + `CommitMessageGenerationCancelledError` | Provider mới phải implement cancel đúng cách (kill child process) |

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Renderer                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ UI: Preferences → "AI Summary" tab                           │  │
│  │   - Provider list (Copilot / OpenAI-compat / External CLI)   │  │
│  │   - Per-provider card: edit / delete / Test connection       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │ persist via setState                  │
│                            ▼                                       │
│  AppStore._aiSummaryConfig (read-only, exposed via getState)        │
│                            │                                       │
│  ┌─────────────────────────┼────────────────────────────────────┐  │
│  │ Dispatcher.generateCommitMessage(repository, files)         │  │
│  │   → resolve active provider                                │  │
│  │   → if none → show "Configure AI Summary" dialog            │  │
│  │   → AISummaryService.generate(diff, rules, signal)          │  │
│  └─────────────────────────┼────────────────────────────────────┘  │
│                            ▼                                       │
│  AISummaryService (new)                                            │
│   ├─ CopilotSummaryProvider     → CopilotStore.generateCommit…     │
│   ├─ OpenAICompatSummaryProvider → IPC 'ai-summary-openai'         │
│   └─ ExternalCLIProvider        → IPC 'ai-summary-cli'             │
└────────────────────────────────────────────────────────────────────┘
              │ IPC (RequestResponseChannels)                       │
              ▼
┌────────────────────────────────────────────────────────────────────┐
│ Main process                                                       │
│  ipcMain.handle('ai-summary-openai', (config, diff) => fetch)      │
│  ipcMain.handle('ai-summary-cli',   (config, diff) => execFile)    │
│  ipcMain.handle('ai-summary-cli-test', (config)       => execFile) │
└────────────────────────────────────────────────────────────────────┘
```

## Decision Records

### DR-1: Provider resolution ưu tiên thế nào?

**Quyết định**: User chọn **a single `activeProviderId`** trong settings.
Default nếu chưa có: provider `copilot` nếu license hợp lệ, nếu không thì
provider `external-cli` đầu tiên đang pass test, nếu không thì provider
`openai-compat` đầu tiên đang pass test. UI hiển thị dropdown ngay cạnh
button.

**Rationale**: Tránh auto-routing ẩn (user mất kiểm soát), nhưng vẫn có
sensible default cho first-run.

**Alternative đã cân nhắc**:
- *Round-robin*: phức tạp, không giải quyết pain point chính
- *Cost-based routing*: overkill cho desktop app

### DR-2: OpenAI-compat — re-use BYOK hay song song?

**Quyết định**: **Song song** — tạo `IAISummaryProvider` của riêng feature,
NHƯNG cho phép chọn `byok:<id>` làm provider kind, tận dụng config đã lưu.
Tránh coupling chéo: BYOK có UI riêng cho Copilot conflict resolution;
AI summary có provider riêng. User có thể dùng chung OpenAI key bằng cách
nhập hai lần, hoặc copy-paste.

**Rationale**: Tách concerns, BYOK vẫn do Copilot SDK quản lý (license
vẫn áp dụng), AI summary provider là thin wrapper gọi HTTP trực tiếp.

### DR-3: External CLI — protocol là gì?

**Quyết định**: 
- **stdio contract** (giống `git`): CLI nhận diff qua stdin, in ra một JSON
  block duy nhất:
  ```json
  {"title": "...", "description": "..."}
  ```
- CLI exit 0 = success, non-zero = error, stderr được pass-through cho user.
- Nếu CLI in ra markdown fence với json → cũng OK, parser đã handle.
- Optional: flag `--mode commit-summary` để CLI biết context, nếu CLI
  hỗ trợ nhiều mode.

**Tested / recommended CLIs** (cùng protocol, khác `executable` value):

| Executable | Recommended args | API key env | Notes |
| --- | --- | --- | --- |
| `claudecode` | `--mode commit-summary` | `ANTHROPIC_API_KEY` | Anthropic Claude Code |
| `mcode` | `--mode commit-summary` | (không cần) | Local Mavis-based CLI |
| `qwen` | `--mode commit-summary` | `DASHSCOPE_API_KEY` | Alibaba Qwen CLI |
| `opencode` | `--mode commit-summary` | tuỳ provider | Opencode CLI |
| `commandcode` | `--mode commit-summary` | tuỳ provider | Generic command-code CLI |
| `gemini` | `--mode commit-summary` | `GEMINI_API_KEY` | Google Gemini CLI (newly added) |

Plan KHÔNG bundle các binary này; user tự cài qua npm/pip/curl. UI Settings
sẽ hiển thị hint "Not found on PATH — install via `npm i -g @anthropic-ai/claude-code`"
tương ứng (link tới docs).

**Rationale**: Stdio là pattern phổ biến nhất, dễ test bằng shell script
echo. Parser JSON fence đã có sẵn trong `parseCopilotCommitMessage`.

**Alternative đã cân nhắc**:
- *CLI args thay vì stdin*: dễ nhưng giới hạn size, phải escape shell
- *HTTP wrapper*: phức tạp, yêu cầu user chạy daemon
- *Per-CLI adapter class*: scale tốt nhưng over-engineer cho v1; nếu thực tế
  protocol khác nhau quá nhiều → tách `IExternalCLIAdapter` interface ở v2

### DR-4: Test connection

**Quyết định**:
- `openai-compat`: POST `{baseUrl}/chat/completions` với prompt 1-token
  ping ("Return exactly: PONG"). Verify response chứa chuỗi "PONG".
- `external-cli`: spawn binary với `['--version']`. Verify exit 0 + non-empty
  stdout trong `^[0-9]+\.[0-9]+`. (Heuristic — CLI nào không support `--version`
  sẽ fail, user phải đổi test command.)
- `copilot`: dùng lại pattern `CopilotStore.getCachedModels` — nếu models
  fetch thành công thì pass.

**Rationale**: Lightweight, không tốn quota, nhưng đủ xác nhận network/auth.

### DR-5: Cancel

**Quyết định**:
- `AbortSignal` được pass xuống provider implementation.
- `external-cli`: kill child process với SIGTERM, fallback SIGKILL sau 2s.
- `openai-compat`: AbortController.abort() trên fetch.
- `copilot`: đã có sẵn trong `CopilotStore.generateCommitMessage`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| CLI provider gửi diff nhạy cảm cho binary không rõ nguồn gốc (claudecode, qwen, gemini, opencode, commandcode, mcode, …) | High | High | UI disclaimer + opt-in; lint khuyến cáo dùng local-only CLIs (mcode); docs rõ ràng cho mỗi CLI |
| CLI stdout chứa prompt-injection | Medium | Medium | Re-use `parseCopilotCommitMessage` fence parser; reject payload > 8KB hoặc có field ngoài schema |
| Latency từ CLI / BYOK | Medium | Low | Progress spinner + cancel button đã có sẵn |
| Diff size > OS arg limit (Windows 32KB) | Low | Medium | Dùng stdin, không phải argv |
| Provider "always available" làm user quên config | Medium | Low | Inline empty-state trong settings + dialog khi bấm button |
| Token leak qua telemetry | Low | High | Whitelist fields trong `app/src/lib/stats.ts` |
| CLI binary không tồn tại trên PATH sau khi user upgrade OS | Medium | Low | Phase 2: `executable-not-found` error code; UI gợi ý install command (`npm i -g …`) |
| Một CLI upstream (vd gemini) đổi protocol → provider fail im lặng | Medium | Medium | Test connection probe (`--version`); fail-closed, không fallback provider khác |

## Phases

| # | File | Title | Est. complexity |
| - | --- | --- | --- |
| 1 | phase-01-provider-model-and-storage.md | Provider model + storage | M |
| 2 | phase-02-cli-provider-and-ipc.md | External CLI provider + IPC | L |
| 3 | phase-03-openaicompat-provider.md | OpenAI-compatible HTTP provider | M |
| 4 | phase-04-settings-ui.md | Preferences tab "AI Summary" + Test | L |
| 5 | phase-05-always-available-gate-and-rename.md | Gate + rename + dispatch | S |
| 6 | phase-06-tests-telemetry-security.md | Tests + telemetry + security review | M |

## Cross-Plan Dependencies

- **Blocks**: Không — plan này tự đứng.
- **Bị block bởi**: Không — không phụ thuộc plan khác đang active.
- **Touches (không block)**:
  - `app/src/lib/copilot-store.ts` (giữ nguyên, re-use)
  - `app/src/lib/copilot/byok.ts` (giữ nguyên, không phụ thuộc)
  - `app/src/ui/changes/commit-message.tsx` (rename button + đổi gate)

## Validation Checklist (Definition of Done)

- [ ] User mới (chưa từng dùng Copilot) mở app → Preferences → thấy tab
      "AI Summary", có CTA "Add OpenAI-compatible provider" và "Add external CLI"
- [ ] Test connection xanh cho OpenAI-compat khi nhập key hợp lệ
- [ ] Test connection xanh cho CLI khi binary trên PATH
- [ ] Button "Generate commit message with AI" hiển thị cho mọi user (kể cả
      không có Copilot license)
- [ ] Bấm button khi chưa config → mở dialog hướng dẫn
- [ ] Bấm button sau khi config → tạo commit message đúng schema `{title, description}`
- [ ] Cancel mid-flight thực sự huỷ child process
- [ ] Telemetry chỉ capture provider kind + latency + error code (không có diff content)
- [ ] Unit tests coverage ≥ 80% cho file mới
- [ ] E2E smoke test cho ít nhất 1 OpenAI-compat provider
- [ ] `npm run lint && npm run test` pass

## Resolved Decisions (đã chốt với stakeholder)

| # | Question | Decision |
| - | --- | --- |
| Q1 | Tab Preferences tên | **"AI Summary"** ✅ |
| Q2 | Disclaimer cho external CLI | **Có** — hiển thị 1 lần khi user lưu provider đầu tiên có kind `external-cli`, checkbox "Don't show again" ✅ |
| Q3 | Icon | **Giữ `octicons.copilot`** (không có `sparkle` native; consistent với main app branding) ✅ |
| Q4 | CLI list (final) | `claudecode`, `mcode`, `qwen`, `opencode`, `commandcode`, `gemini` (mới) ✅ |

## Open Questions

> Trả lời trước khi bắt đầu Phase 4 implementation.

1. Localized strings: cần update bao nhiêu locale? (Hiện `app/static/locales/`
   có nhiều file — auto-gen qua `gulp localization`. Plan: regenerate tất cả
   sau khi strings ổn định, đẩy community translators xử lý.)

## References

- Codebase entry points:
  - `app/src/lib/copilot-commit-message.ts` — schema + parser (re-use)
  - `app/src/lib/copilot/byok.ts` — BYOK infrastructure (re-use pattern)
  - `app/src/lib/copilot-store.ts:1016` — `CopilotStore::generateCommitMessage` (re-use)
  - `app/src/lib/feature-flag.ts:91` — current gate (replace)
  - `app/src/ui/changes/commit-message.tsx:1214` — current `isCopilotButtonEnabled` (replace)
  - `app/src/ui/dispatcher/dispatcher.ts:1191` — `Dispatcher::generateCommitMessage` (extend)
  - `app/src/lib/ipc-shared.ts:100` — IPC channel registry (extend)
  - `app/src/main-process/main.ts` — main-process IPC handlers (extend)
- Existing docs:
  - `docs/technical/error-reporting.md` — error UX
  - `docs/technical/adding-tests.md` — test pattern
  - `docs/process/usage-data.md` — telemetry rules
