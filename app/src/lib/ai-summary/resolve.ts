import { Account } from '../../models/account'
import { enableCommitMessageGeneration } from '../feature-flag'
import type { IAISummaryConfig, IAISummaryProviderConfig } from './config'

export interface IAISummaryRepositoryContext {
  readonly id: number
}

export interface IAISummaryResolutionState {
  readonly accounts: ReadonlyArray<Account>
  readonly aiSummaryConfig: IAISummaryConfig
}

export function isProviderAvailable(
  provider: IAISummaryProviderConfig,
  state: { readonly accounts: ReadonlyArray<Account> }
): boolean {
  if (!provider.enabled) {
    return false
  }
  if (provider.lastTestStatus === 'error') {
    return false
  }
  switch (provider.kind) {
    case 'copilot':
      return state.accounts.some(a => enableCommitMessageGeneration(a))
    case 'openai-compat':
    case 'external-cli':
      return true
  }
}

export function resolveProviderForRepository(
  config: IAISummaryConfig,
  state: { readonly accounts: ReadonlyArray<Account> },
  _repository: IAISummaryRepositoryContext
): IAISummaryProviderConfig | null {
  if (config.activeProviderId) {
    const explicit = config.providers.find(
      p => p.id === config.activeProviderId
    )
    if (explicit && isProviderAvailable(explicit, state)) {
      return explicit
    }
  }

  const priority: ReadonlyArray<IAISummaryProviderConfig['kind']> = [
    'copilot',
    'external-cli',
    'openai-compat',
  ]
  for (const kind of priority) {
    const match = config.providers.find(
      p => p.kind === kind && isProviderAvailable(p, state)
    )
    if (match) {
      return match
    }
  }
  return null
}

export function hasAnyUsableAIProvider(
  state: IAISummaryResolutionState
): boolean {
  return state.aiSummaryConfig.providers.some(p =>
    isProviderAvailable(p, state)
  )
}
