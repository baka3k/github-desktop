import { API } from '../api'
import { enableCopilotSdkCommitMessageGeneration } from '../feature-flag'
import {
  CommitMessageGenerationCancelledError,
  type CopilotModelRequest,
  type CopilotStore,
} from '../stores/copilot-store'
import type { Account } from '../../models/account'
import type {
  AISummaryResult,
  IAIProviderGenerateArgs,
  IAISummaryProvider,
} from './provider'

/**
 * Generates commit messages through GitHub Copilot. Depending on the
 * account's entitlements this either goes through the Copilot SDK (in
 * process) or falls back to the dotcom commit message endpoint.
 */
export class CopilotSummaryProvider implements IAISummaryProvider {
  public readonly kind = 'copilot' as const

  public constructor(
    private readonly copilotStore: CopilotStore,
    private readonly account: Account,
    private readonly modelRequest: CopilotModelRequest
  ) {}

  public async test(): Promise<AISummaryResult> {
    try {
      await this.copilotStore.listModels(this.account)
      return { kind: 'ok', value: { title: '', description: '' } }
    } catch (e) {
      return {
        kind: 'error',
        code: 'unknown',
        userMessage: `Copilot test failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }
    }
  }

  public async generate(
    args: IAIProviderGenerateArgs
  ): Promise<AISummaryResult> {
    if (args.signal.aborted) {
      return { kind: 'cancelled' }
    }

    try {
      const message = enableCopilotSdkCommitMessageGeneration(this.account)
        ? await this.copilotStore.generateCommitMessage(
            this.account,
            args.diff,
            args.repositoryPath,
            this.modelRequest,
            args.rules,
            args.signal
          )
        : await API.fromAccount(this.account).getDiffChangesCommitMessage(
            args.diff
          )

      return { kind: 'ok', value: message }
    } catch (e) {
      if (
        e instanceof CommitMessageGenerationCancelledError ||
        args.signal.aborted
      ) {
        return { kind: 'cancelled' }
      }
      return {
        kind: 'error',
        code: 'unknown',
        userMessage: `Copilot generation failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }
    }
  }
}
