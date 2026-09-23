import type { Account } from '../../models/account'
import type { Repository } from '../../models/repository'
import type { CopilotModelRequest, CopilotStore } from '../stores/copilot-store'
import { getAccountForCommitMessageGeneration } from '../get-account-for-repository'
import { trimDiffForSummary } from './diff-budget'
import type { IAISummaryConfig, IAISummaryProviderConfig } from './config'
import { CopilotSummaryProvider } from './copilot-provider'
import { ExternalCLIProvider } from './external-cli-provider'
import { OpenAICompatProvider } from './openai-compat-provider'
import type {
  AISummaryResult,
  IAIProviderGenerateArgs,
  IAISummaryProvider,
} from './provider'
import { resolveProviderForRepository } from './resolve'

export interface IAISummaryServiceDeps {
  readonly copilotStore: CopilotStore
  /**
   * Resolves the account's selected model into a request suitable for
   * {@link CopilotStore.generateCommitMessage}. Injected so the service
   * stays free of AppStore state.
   */
  readonly resolveCopilotModelRequest: (
    account: Account
  ) => Promise<CopilotModelRequest>
}

/**
 * Orchestrates AI commit message generation: resolves the active
 * provider for a repository, instantiates the matching implementation
 * and dispatches the generate call. Pure with regards to global state —
 * the config, accounts and abort signal are supplied on every call.
 */
export class AISummaryService {
  public constructor(private readonly deps: IAISummaryServiceDeps) {}

  /**
   * Generate a commit message using the provider configured for the
   * given repository. Never throws — any failure is reported as an
   * {@link AISummaryResult} of the `error` kind.
   */
  public async generate(
    config: IAISummaryConfig,
    repository: Repository,
    accounts: ReadonlyArray<Account>,
    args: IAIProviderGenerateArgs
  ): Promise<AISummaryResult> {
    let provider: IAISummaryProviderConfig
    try {
      const resolved = resolveProviderForRepository(
        config,
        { accounts },
        { id: repository.id }
      )
      if (resolved === null) {
        return {
          kind: 'error',
          code: 'invalid-config',
          userMessage:
            'No AI summary provider is configured. Set one up under ' +
            'Preferences → AI Summary.',
        }
      }
      provider = resolved
      const impl = await this.instantiate(provider, repository, accounts)

      // Trim oversized diffs before they reach any provider so huge
      // changesets produce a (best-effort) summary instead of a token
      // limit / request size failure.
      const { diff, truncated } = trimDiffForSummary(args.diff)
      if (truncated) {
        log.warn(
          `[ai-summary] diff trimmed for summary generation (${args.diff.length} → ${diff.length} characters)`
        )
      }

      return await impl.generate({ ...args, diff })
    } catch (e) {
      if (args.signal.aborted) {
        return { kind: 'cancelled' }
      }
      return {
        kind: 'error',
        code: 'unknown',
        userMessage: `AI summary generation failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }
    }
  }

  private async instantiate(
    config: IAISummaryProviderConfig,
    repository: Repository,
    accounts: ReadonlyArray<Account>
  ): Promise<IAISummaryProvider> {
    switch (config.kind) {
      case 'copilot': {
        const account = getAccountForCommitMessageGeneration(
          accounts,
          repository
        )
        if (account === undefined) {
          throw new Error(
            'The configured Copilot provider requires signing in to ' +
              'GitHub with a Copilot license.'
          )
        }
        const modelRequest = await this.deps.resolveCopilotModelRequest(account)
        return new CopilotSummaryProvider(
          this.deps.copilotStore,
          account,
          modelRequest
        )
      }
      case 'external-cli':
        return new ExternalCLIProvider(config)
      case 'openai-compat':
        return new OpenAICompatProvider(config)
    }
  }
}
