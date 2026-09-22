# AI Summary Completion (Phases 7–10) — 2026-09-23

[inline:log-writer]

## Context

Executed `docs/plans/ai-summary-completion/plan.md` (full mode). The base plan
(`../ai-summary-commit-message`) had delivered the data layer and main-process
runners, but the renderer had no provider implementations, `_generateCommitMessage`
still went straight to Copilot, the commit box was hard-wired to Copilot
entitlements, the preferences UI was a 571-line untracked monolith, and there
were zero tests.

## Change

- **Renderer providers + service**: `app/src/lib/ai-summary/copilot-provider.ts`,
  `external-cli-provider.ts`, `openai-compat-provider.ts`, `service.ts`.
  Providers use the typed `invoke` helper (not the plan-sketch `send`/`once`),
  mint a per-run `runId` (`crypto.randomUUID()`) forwarded on the
  `ai-summary-*-run` channels so cancellation is keyed per run, and never pass
  secrets over IPC (main reads the keychain itself).
- **Main-process cancellation**: `app/src/main-process/ai-summary/cancellation.ts`
  registry; `main.ts` run handlers create an AbortController, register/complete
  by runId, and re-validate renderer configs via `parseAIProviderConfig` with
  `timeoutSeconds` clamped to 1–600 and `apiKeyEnvVar` pattern-checked.
- **Wire-up**: `AppStore._generateCommitMessage` routes through
  `AISummaryService.generate` (app-store.ts ~6390), guards `signal.aborted`
  before overwriting the draft, logs 6 new daily counters
  (`aiSummary*GenerateCount` family in `stats/stats-database.ts`). A Copilot
  "Test connection" result is deliberately NOT recorded — a failed test must not
  latch `lastTestStatus: 'error'`, which would make the provider unresolvable.
- **Rename**: `generatedByCopilot` → `generatedByAi`
  (`models/commit-message.ts`), `messageGeneratedByCopilot` → `messageGeneratedByAi`
  (`models/commit.ts`); button/labels now "AI" while the `copilot-button` CSS
  class is kept. Cancel no longer gated on Copilot SDK entitlements.
- **UI modularization**: `app/src/ui/preferences/ai-summary/` — 8 class
  components (repo convention; `react/jsx-no-bind` is strict here) + 
  `app/styles/ui/_ai-summary.scss` registered in `_ui.scss`. Enter submits the
  add-provider dialogs (in-repo `onSubmit=handleSave` pattern); OpenAI dialog
  gained the previously missing API-key field; timeouts clamped at save.
- **Runner hardening**: `openai-runner.ts` — `/v1` de-duplication on baseUrl
  (the dialog default previously produced `/v1/v1/...` 404s), internal timeout
  reported as `timeout` (was `network-error`), 1 MiB body cap, deadline armed
  through body read, provider error bodies redacted; `security.ts` `redactSecrets`
  now covers `Authorization`/`x-api-key`/`api-key` header forms; `resolveExecutable`
  rejects `..` (path-traversal names normalized into real binaries before).

## Impact

- Users can now generate commit messages from an OpenAI-compatible endpoint or
  external CLI without any Copilot license; cancel works for every provider.
- Risk: medium — IPC surface grew by 2 cancel channels and 2 modified run
  channels (contract-tested); telemetry only gains boolean counters (no diff,
  message, or key fields).
- Verification: `tsc --noEmit` clean, webpack `compile:dev` succeeds, full unit
  suite 1914/1917 (only pre-existing `parse-files-to-be-overwritten` failures,
  confirmed failing at clean HEAD, environment/git-version related). Tests must
  run under Node 24 (`.nvmrc`); under Node 26 the module-mock machinery drops
  jsdom globals and unrelated suites fail.

## Decision

- `invoke` over `send`/`once` (plan's own open question): typed, promise-based,
  no listener leaks; matches the existing `ipcMain.handle` registration.
- Secrets never cross IPC (deviation from the plan sketch, which passed an
  `apiKey` payload): the main-side runners already read the keychain themselves.
- Tests live under `app/test/unit/ai-summary/` instead of the plan's
  `main-process/`/`integration/`/`security/` dirs because `script/test.mjs` only
  scans `app/test/unit` by default.
- Commit messages are held in memory only in this fork (no localStorage), so the
  plan's `generatedByCopilot` localStorage migration is moot and was skipped.

## References

- plan: ./docs/plans/ai-summary-completion/plan.md
- commit: d4e6934622
