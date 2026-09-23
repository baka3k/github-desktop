import { invoke, send } from '../ipc-renderer'
import type { IOpenAICompatProviderConfig } from './config'
import type {
  AISummaryResult,
  IAIProviderGenerateArgs,
  IAISummaryProvider,
} from './provider'
import { toAISummaryResult } from './external-cli-provider'

/**
 * Dispatches commit message generation to an OpenAI-compatible HTTP
 * endpoint. The outbound request is performed by the main process (no
 * CORS, no credentials in the renderer) over the `ai-summary-openai-*`
 * IPC channels.
 */
export class OpenAICompatProvider implements IAISummaryProvider {
  public readonly kind = 'openai-compat' as const

  public constructor(private readonly config: IOpenAICompatProviderConfig) {}

  public async test(): Promise<AISummaryResult> {
    return toAISummaryResult(
      await invoke('ai-summary-openai-test', this.config)
    )
  }

  public async generate(
    args: IAIProviderGenerateArgs
  ): Promise<AISummaryResult> {
    if (args.signal.aborted) {
      return { kind: 'cancelled' }
    }

    const runId = crypto.randomUUID()
    const onAbort = () => send('ai-summary-openai-cancel', runId)
    args.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await invoke(
        'ai-summary-openai-run',
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
