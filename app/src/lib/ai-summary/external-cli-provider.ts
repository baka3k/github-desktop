import { invoke, send } from '../ipc-renderer'
import type { IExternalCLIProviderConfig } from './config'
import type {
  AIProviderIPCResult,
  AISummaryResult,
  IAIProviderGenerateArgs,
  IAISummaryProvider,
} from './provider'

/**
 * Dispatches commit message generation to an external CLI tool. The
 * renderer never spawns the process itself — it asks the main process
 * over IPC so that credentials, stdio and cancellation are handled
 * outside of the sandboxed renderer.
 */
export class ExternalCLIProvider implements IAISummaryProvider {
  public readonly kind = 'external-cli' as const

  public constructor(private readonly config: IExternalCLIProviderConfig) {}

  public async test(): Promise<AISummaryResult> {
    return toAISummaryResult(await invoke('ai-summary-cli-test', this.config))
  }

  public async generate(
    args: IAIProviderGenerateArgs
  ): Promise<AISummaryResult> {
    // The main process reads the API key from the OS keychain itself, so
    // no secret ever crosses the IPC boundary. It doesn't observe the
    // renderer's AbortSignal either, so a mid-flight cancel is forwarded
    // as an explicit notification keyed by this run's id — concurrent
    // runs (same provider, different repositories) stay independent.
    if (args.signal.aborted) {
      return { kind: 'cancelled' }
    }

    const runId = crypto.randomUUID()
    const onAbort = () => send('ai-summary-cli-cancel', runId)
    args.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await invoke(
        'ai-summary-cli-run',
        this.config,
        args.diff,
        args.rules,
        args.repositoryPath,
        runId
      )
      return toAISummaryResult(result)
    } finally {
      args.signal.removeEventListener('abort', onAbort)
    }
  }
}

/** Map an IPC result onto the in-process result shape. */
export function toAISummaryResult(
  result: AIProviderIPCResult
): AISummaryResult {
  switch (result.kind) {
    case 'ok':
      return {
        kind: 'ok',
        value: { title: result.title, description: result.description },
      }
    case 'cancelled':
      return { kind: 'cancelled' }
    case 'error':
      return {
        kind: 'error',
        code: result.code,
        userMessage: result.userMessage,
      }
  }
}
