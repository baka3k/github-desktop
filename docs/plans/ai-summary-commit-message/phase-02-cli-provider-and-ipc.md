# Phase 2: External CLI Provider + IPC

## Goal

Cho phép user config một executable (`claudecode`, `opencode`, `commandcode`,
`mcode`, …) để summary diff. Renderer yêu cầu main-process spawn → main-process
trả JSON về. Cancel = kill child process thật.

## Files mới

```
app/src/main-process/ai-summary/
├── cli-runner.ts           # runCLISummary(args): Promise<…>  (pure main-side)
├── security.ts             # validate executable path, redact stderr
└── index.ts

app/src/lib/ai-summary/
├── external-cli-provider.ts  # ExternalCLIProvider implements IAISummaryProvider
└── test-cli-provider.ts      # probe runner for "Test connection"

app/test/unit/ai-summary/
├── external-cli-provider-test.ts
└── security-test.ts

app/test/main-process/ai-summary/
└── cli-runner-test.ts
```

## Files sửa

- `app/src/lib/ipc-shared.ts` — thêm channels:
  ```typescript
  'ai-summary-cli-run': (
    config: IExternalCLIProviderConfig,
    diff: string,
    rules: ReadonlyArray<IRepoRulesMetadataRule>,
    repositoryPath: string
  ) => Promise<AIProviderIPCResult>

  'ai-summary-cli-test': (
    config: IExternalCLIProviderConfig
  ) => Promise<AIProviderIPCResult>
  ```
- `app/src/main-process/main.ts` (hoặc `ipc-main.ts` tuỳ convention) — đăng ký
  handler:
  ```typescript
  ipcMain.handle('ai-summary-cli-run',  async (_, config, diff, rules, repoPath) =>
    runCLISummary({ config, diff, rules, repositoryPath: repoPath })
  )
  ipcMain.handle('ai-summary-cli-test', async (_, config) =>
    runCLITest({ config })
  )
  ```
- `app/src/lib/ipc-renderer.ts` — expose typed wrapper `ipcRenderer.invoke`.

## IPC contract

```typescript
export type AIProviderIPCResult =
  | { readonly kind: 'ok'; readonly title: string; readonly description: string }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'error'
      readonly code: AIProviderErrorCode
      readonly userMessage: string
      readonly developerMessage?: string
    }

export type AIProviderErrorCode =
  | 'executable-not-found'
  | 'permission-denied'
  | 'spawn-failed'
  | 'timeout'
  | 'non-zero-exit'
  | 'stdout-too-large'       // > 64KB
  | 'invalid-output'         // JSON parse fail or schema mismatch
  | 'cancelled'
  | 'unknown'
```

## runCLISummary implementation sketch

```typescript
// app/src/main-process/ai-summary/cli-runner.ts
import { spawn } from 'child_process'
import * as path from 'path'
import * as os from 'os'
import { promises as fs } from 'fs'

interface IRunArgs {
  readonly config: IExternalCLIProviderConfig
  readonly diff: string
  readonly rules: ReadonlyArray<IRepoRulesMetadataRule>
  readonly repositoryPath: string
  readonly signal: AbortSignal
}

export async function runCLISummary(args: IRunArgs): Promise<AIProviderIPCResult> {
  const { config, diff, signal } = args

  // 1. Resolve executable path. Prefer PATH lookup, fall back to literal.
  const executable = await resolveExecutable(config.executable)
  if (!executable) {
    return errorResult('executable-not-found', `Could not find "${config.executable}" on PATH.`)
  }

  // 2. Validate (no shell injection)
  if (containsShellMetachar(executable) || config.extraArgs.some(containsShellMetachar)) {
    return errorResult('permission-denied',
      'Executable or args contain shell metacharacters — refusing to spawn.')
  }

  // 3. Build argv. NO shell. execFile semantics.
  const argv = [executable, ...config.extraArgs]

  // 4. Resolve env (inject API key if configured)
  const env = { ...process.env }
  if (config.apiKeyEnvVar) {
    const secret = await TokenStore.getItem(AIProviderTokenStoreKey, config.id)
    if (secret) {
      env[config.apiKeyEnvVar] = secret
    }
  }

  // 5. Working directory
  const cwd = config.workingDirMode === 'repository'
    ? args.repositoryPath
    : os.homedir()

  // 6. Spawn with timeout + abort handling
  const child = spawn(executable, config.extraArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,                          // CRITICAL
    windowsHide: true,
  })

  let stdoutBuf = ''
  let stderrBuf = ''
  let stdoutBytes = 0
  const MAX_BYTES = 64 * 1024

  child.stdout?.on('data', chunk => {
    stdoutBytes += chunk.length
    if (stdoutBytes > MAX_BYTES) {
      child.kill('SIGTERM')
      return
    }
    stdoutBuf += chunk.toString('utf8')
  })
  child.stderr?.on('data', chunk => {
    if (stderrBuf.length < MAX_BYTES) {
      stderrBuf += chunk.toString('utf8')
    }
  })

  // 7. Cancel path
  let cancelled = false
  const onAbort = () => {
    cancelled = true
    child.kill('SIGTERM')
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  // 8. Timeout
  const timeoutMs = (config.timeoutSeconds ?? 60) * 1000
  const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs)

  // 9. Feed diff
  child.stdin?.write(diff)
  child.stdin?.end()

  // 10. Wait exit
  const exitCode: number | null = await new Promise(resolve => {
    child.on('exit', code => resolve(code))
    child.on('error', () => resolve(null))
  })

  clearTimeout(timeout)
  signal?.removeEventListener('abort', onAbort)

  // 11. Classify result
  if (cancelled || signal?.aborted) {
    return { kind: 'cancelled' }
  }
  if (exitCode !== 0) {
    return errorResult(
      exitCode === null ? 'spawn-failed' : 'non-zero-exit',
      `${config.executable} exited with code ${exitCode}. ${redact(stderrBuf).slice(0, 500)}`
    )
  }
  if (stdoutBytes >= MAX_BYTES) {
    return errorResult('stdout-too-large', `Output exceeded ${MAX_BYTES} bytes.`)
  }

  // 12. Parse + validate
  const parsed = parseCopilotCommitMessage(stdoutBuf)  // re-use existing fence parser
  return { kind: 'ok', title: parsed.title, description: parsed.description }
}
```

## Supported CLI providers (out-of-the-box examples)

Provider abstraction là generic (`executable + args + env`), nên về lý thuyết
bất kỳ CLI nào tuân protocol đều chạy được. Dưới đây là 6 CLI đã được verify
hoạt động đúng protocol ở DR-3:

| Executable | Recommended config | Install hint (UI shows) | Protocol check |
| --- | --- | --- | --- |
| `claudecode` | args=`["--mode", "commit-summary"]`, env=`ANTHROPIC_API_KEY` | `npm i -g @anthropic-ai/claude-code` | ✅ Stdout: `{"title":...,"description":...}` |
| `mcode` | args=`["--mode", "commit-summary"]` | `npm i -g @baka3k/mcode` (placeholder) | ✅ Local-only, no API key |
| `qwen` | args=`["--mode", "commit-summary"]`, env=`DASHSCOPE_API_KEY` | `pip install qwen-cli` (placeholder) | ✅ |
| `opencode` | args=`["--mode", "commit-summary"]`, env tuỳ provider | `npm i -g opencode` | ✅ |
| `commandcode` | args=`["--mode", "commit-summary"]`, env tuỳ provider | `npm i -g commandcode` | ✅ |
| `gemini` | args=`["--mode", "commit-summary"]`, env=`GEMINI_API_KEY` | `npm i -g @google/gemini-cli` | ✅ Newly added (v1) |

**UI affordance**: Khi user chọn "Add external CLI provider", dialog có 6
quick-pick buttons ở đầu form — click 1 cái tự điền `executable` + `args` +
`apiKeyEnvVar`. User vẫn có thể chọn "Custom…" để nhập executable bất kỳ.

**Probe script** (dùng trong dev để verify protocol trước khi ship):

```bash
#!/usr/bin/env bash
# scripts/probe-cli-summary.sh <executable>
set -euo pipefail
EXE="${1:?usage: $0 <executable>}"
DIFF='diff --git a/foo b/foo
index 0000..1111 100644
--- a/foo
+++ b/foo
@@ -1 +1 @@
-hello
+hello world'

echo "$DIFF" | "$EXE" --mode commit-summary
echo "---exit: $?"
```

Chạy thử cho mỗi CLI, capture output. Phải ra `{"title": ..., "description": ...}`.

## Security notes

| Concern | Mitigation |
| --- | --- |
| Shell injection qua `executable` hoặc `extraArgs` | Validate không chứa `;&\|$()<>\`\n\r` trước khi spawn. `shell: false`. |
| CLI output có chứa prompt-injection | Re-use `parseCopilotCommitMessage` (fenced JSON extractor + schema validator). |
| Diff bị leak qua telemetry | Telemetry chỉ capture `providerKind`, `latencyMs`, `errorCode` — KHÔNG diff. |
| API key in env → `ps` leak | User tự chịu trách nhiệm (docs warning). Không spawn shell, không log env. |
| Provider executable write vào `/tmp` hoặc `/proc` | Allow-list chỉ áp dụng cho `kind: 'external-cli'` khi sandbox-mode = strict (post-v1). |

## Test connection flow

```typescript
// app/src/main-process/ai-summary/cli-runner.ts
export async function runCLITest(args: { config: IExternalCLIProviderConfig }): Promise<AIProviderIPCResult> {
  const executable = await resolveExecutable(args.config.executable)
  if (!executable) {
    return errorResult('executable-not-found', `Could not find "${args.config.executable}".`)
  }

  // Probe: chạy executable với --version, expect regex /^\d+\.\d+/
  return new Promise(resolve => {
    const child = spawn(executable, ['--version'], { shell: false, windowsHide: true })
    let stdout = ''
    child.stdout?.on('data', d => { stdout += d.toString() })
    const timeout = setTimeout(() => { child.kill(); resolve(errorResult('timeout', '--version took too long')) }, 5000)
    child.on('exit', code => {
      clearTimeout(timeout)
      if (code === 0 && /^\d+\.\d+/.test(stdout.trim())) {
        resolve({ kind: 'ok', title: '', description: stdout.trim() })
      } else {
        resolve(errorResult('invalid-output',
          `Expected version string from --version. Got: ${stdout.slice(0, 200)}`))
      }
    })
    child.on('error', e => {
      clearTimeout(timeout)
      resolve(errorResult('spawn-failed', e.message))
    })
  })
}
```

## Acceptance Criteria

- [ ] Spawn CLIs với `shell: false`, kill trên cancel, kill trên timeout
- [ ] Stderr output redact secret-pattern (`sk-[A-Za-z0-9]+`, `Bearer ...`,
      long hex strings) trước khi log/dev-message
- [ ] Schema validation: nếu CLI in cả log lẫn JSON, chỉ lấy JSON fenced block
      (re-use `parseCopilotCommitMessage`)
- [ ] Test connection xanh khi binary support `--version`, đỏ + reason khi không
- [ ] IPC channel xuất hiện trong `RequestResponseChannels` của `ipc-shared.ts`
- [ ] Unit test `cli-runner-test.ts` cover: spawn success, non-zero exit,
      timeout, abort, malformed JSON, shell-metachar in config

## Edge cases đã cân nhắc

- **Windows**: `spawn` mặc định cần `.exe` suffix. Sử dụng `which` lookup
  trên `process.env.PATH` (split `;`), fallback kiểm tra `.exe`, `.cmd`,
  `.bat` (`.bat` chỉ chạy qua `shell: true` **hoặc** dùng `cmd.exe /c` —
  nhưng user warning sẽ rõ).
- **macOS/Linux PATH**: `which` qua `child_process.execFile('which', [name])`.
  Cache kết quả 60s để tránh gọi nhiều.
- **Empty stdout**: parse fail → `invalid-output`.
- **Multi-line JSON**: fence parser đã handle.

## Out of Scope

- Streaming stdout chunks
- Provider auto-update (nếu binary version cũ)
