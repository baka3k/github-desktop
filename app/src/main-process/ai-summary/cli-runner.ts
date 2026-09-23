import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as os from 'os'
import type { IRepoRulesMetadataRule } from '../../models/repo-rules'
import type { IExternalCLIProviderConfig } from '../../lib/ai-summary/config'
import {
  buildCommitMessageSystemPrompt,
  buildCommitMessageUserPrompt,
  generateCommitMessagePromptTags,
  getCleanedEnforcedRuleDescriptions,
} from '../../lib/ai-summary/commit-message-prompt'
import { parseCopilotCommitMessage } from '../../lib/copilot-commit-message'
import {
  redactSecrets,
  resolveExecutable,
  validateShellSafeArgv,
} from './security'
import type { AIProviderIPCResult } from '../../lib/ai-summary/provider'
import { getAISummaryProviderSecret } from '../../lib/ai-summary/secrets'

const MAX_STDOUT_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const TEST_PROBE_TIMEOUT_MS = 5_000

interface IRunSummaryArgs {
  readonly config: IExternalCLIProviderConfig
  readonly diff: string
  readonly rules: ReadonlyArray<IRepoRulesMetadataRule>
  readonly repositoryPath: string
  readonly signal: AbortSignal | undefined
}

interface IRunTestArgs {
  readonly config: IExternalCLIProviderConfig
}

export async function runCLISummary(
  args: IRunSummaryArgs
): Promise<AIProviderIPCResult> {
  // Build the same unified commit-message prompt the Copilot SDK and
  // OpenAI-compat paths send: a per-request token-wrapped system +
  // user message. The CLI receives them as a single stdin payload
  // joined by a blank line so naive `cat` / `tee` pipelines capture
  // the entire content faithfully.
  const tags = generateCommitMessagePromptTags()
  const cleanedRules = getCleanedEnforcedRuleDescriptions(args.rules)
  const systemPrompt = buildCommitMessageSystemPrompt(
    cleanedRules.length > 0,
    tags
  )
  const userPrompt = buildCommitMessageUserPrompt(
    args.diff,
    tags,
    cleanedRules
  )
  const stdinPayload = `${systemPrompt}\n\n${userPrompt}`

  return runCLIProcess(
    args.config,
    args.diff,
    stdinPayload,
    args.repositoryPath,
    args.signal
  )
}

export async function runCLITest(
  args: IRunTestArgs
): Promise<AIProviderIPCResult> {
  const executable = await resolveExecutable(args.config.executable)
  if (!executable) {
    return {
      kind: 'error',
      code: 'executable-not-found',
      userMessage: `Could not find "${args.config.executable}" on PATH.`,
    }
  }
  if (!validateShellSafeArgv(executable, ['--version'])) {
    return {
      kind: 'error',
      code: 'permission-denied',
      userMessage: 'Executable contains shell metacharacters.',
    }
  }
  return new Promise<AIProviderIPCResult>(resolve => {
    const child = spawn(executable, ['--version'], {
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stdoutBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolve({
        kind: 'error',
        code: 'timeout',
        userMessage: 'Test probe did not complete in time.',
      })
    }, TEST_PROBE_TIMEOUT_MS)
    child.stdout?.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.on('error', e => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        kind: 'error',
        code: 'spawn-failed',
        userMessage: `Could not start "${args.config.executable}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      })
    })
    child.on('exit', code => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (code === 0 && /^\d+\.\d+/.test(stdout.trim())) {
        resolve({ kind: 'ok', title: stdout.trim(), description: '' })
      } else {
        resolve({
          kind: 'error',
          code: 'invalid-output',
          userMessage: `Expected a version string from ${
            args.config.executable
          }. Got: ${redactSecrets(stdout.slice(0, 200))}`,
        })
      }
    })
  })
}

async function runCLIProcess(
  config: IExternalCLIProviderConfig,
  diff: string,
  stdinPayload: string,
  repositoryPath: string,
  signal: AbortSignal | undefined
): Promise<AIProviderIPCResult> {
  if (!validateShellSafeArgv(config.executable, config.extraArgs)) {
    return {
      kind: 'error',
      code: 'permission-denied',
      userMessage: 'Executable contains shell metacharacters.',
    }
  }
  const executable = await resolveExecutable(config.executable)
  if (!executable) {
    return {
      kind: 'error',
      code: 'executable-not-found',
      userMessage: `Could not find "${config.executable}" on PATH.`,
    }
  }
  const cwd =
    config.workingDirMode === 'repository' ? repositoryPath : os.homedir()
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (config.apiKeyEnvVar) {
    const secret = await getAISummaryProviderSecret(config.id)
    if (secret) {
      env[config.apiKeyEnvVar] = secret
    }
  }

  const child: ChildProcessWithoutNullStreams = spawn(
    executable,
    config.extraArgs,
    {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    }
  )

  let stdoutBuf = ''
  let stderrBuf = ''
  let stdoutBytes = 0
  let stdoutOverflow = false
  let cancelled = false
  let settleResolve: ((value: AIProviderIPCResult) => void) | null = null
  const completionPromise = new Promise<AIProviderIPCResult>(resolve => {
    settleResolve = resolve
  })
  const onAbort = () => {
    cancelled = true
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, 2000)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const timeoutMs = (config.timeoutSeconds ?? 60) * 1000
  const timer = setTimeout(() => {
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, 2000)
  }, timeoutMs)

  child.stdout?.on('data', chunk => {
    stdoutBytes += chunk.length
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      stdoutOverflow = true
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      return
    }
    stdoutBuf += chunk.toString('utf8')
  })
  child.stderr?.on('data', chunk => {
    if (stderrBuf.length < MAX_STDERR_BYTES) {
      stderrBuf += chunk.toString('utf8')
    }
  })
  child.on('error', () => {
    if (settleResolve) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      settleResolve({
        kind: 'error',
        code: 'spawn-failed',
        userMessage: `Could not start "${config.executable}".`,
      })
      settleResolve = null
    }
  })
  child.on('exit', code => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (!settleResolve) {
      return
    }
    const resolve = settleResolve
    settleResolve = null
    if (cancelled || signal?.aborted) {
      resolve({ kind: 'cancelled' })
      return
    }
    if (stdoutOverflow) {
      resolve({
        kind: 'error',
        code: 'stdout-too-large',
        userMessage: `Output exceeded ${MAX_STDOUT_BYTES} bytes.`,
      })
      return
    }
    if (code !== 0) {
      resolve({
        kind: 'error',
        code: code === null ? 'spawn-failed' : 'non-zero-exit',
        userMessage: `${
          config.executable
        } exited with code ${code}. ${redactSecrets(stderrBuf).slice(0, 500)}`,
      })
      return
    }
    try {
      const parsed = parseCopilotCommitMessage(stdoutBuf)
      resolve({
        kind: 'ok',
        title: parsed.title,
        description: parsed.description,
      })
    } catch (e) {
      resolve({
        kind: 'error',
        code: 'invalid-output',
        userMessage:
          e instanceof Error ? e.message : 'Could not parse CLI response.',
      })
    }
  })

  try {
    child.stdin.on('error', () => {
      // Swallow EPIPE
    })
    child.stdin.write(stdinPayload, 'utf8', () => {
      // No-op
    })
    child.stdin.end()
  } catch {
    // ignore
  }

  return completionPromise
}
