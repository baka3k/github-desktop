import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Account } from '../../../src/models/account'
import {
  CopilotDefaultProviderId,
  getDefaultAISummaryConfig,
  type IAISummaryProviderConfig,
} from '../../../src/lib/ai-summary/config'
import {
  hasAnyUsableAIProvider,
  isProviderAvailable,
  resolveProviderForRepository,
} from '../../../src/lib/ai-summary/resolve'
import type {
  IExternalCLIProviderConfig,
  IOpenAICompatProviderConfig,
} from '../../../src/lib/ai-summary/config'

function licensedAccount(): Account {
  return new Account(
    'mona',
    'https://api.github.com',
    'token',
    [],
    'avatar',
    1,
    'Mona',
    undefined,
    undefined,
    true,
    ['desktop_copilot_generate_commit_message']
  )
}

function openAICompatProvider(
  overrides: Partial<IOpenAICompatProviderConfig> = {}
): IAISummaryProviderConfig {
  const now = Date.now()
  return {
    id: 'openai-1',
    kind: 'openai-compat',
    displayName: 'OpenAI',
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
    wireApi: 'chat-completions',
    authKind: 'apiKey',
    timeoutSeconds: 60,
    ...overrides,
  }
}

function cliProvider(
  overrides: Partial<IExternalCLIProviderConfig> = {}
): IAISummaryProviderConfig {
  const now = Date.now()
  return {
    id: 'cli-1',
    kind: 'external-cli',
    displayName: 'Claude Code',
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
    executable: 'claudecode',
    extraArgs: ['--mode', 'commit-summary'],
    timeoutSeconds: 60,
    workingDirMode: 'home',
    apiKeyEnvVar: null,
    ...overrides,
  }
}

describe('isProviderAvailable', () => {
  it('requires a Copilot license for the built-in Copilot provider', () => {
    const provider = getDefaultAISummaryConfig().providers[0]
    assert.equal(isProviderAvailable(provider, { accounts: [] }), false)
    assert.equal(
      isProviderAvailable(provider, { accounts: [licensedAccount()] }),
      true
    )
  })

  it('rejects disabled providers and providers with failed tests', () => {
    const provider = cliProvider({ enabled: false })
    assert.equal(isProviderAvailable(provider, { accounts: [] }), false)

    const failed = cliProvider({
      lastTestStatus: 'error',
      lastTestError: 'boom',
    })
    assert.equal(isProviderAvailable(failed, { accounts: [] }), false)
  })

  it('accepts external CLI providers without any account', () => {
    assert.equal(isProviderAvailable(cliProvider(), { accounts: [] }), true)
  })
})

describe('resolveProviderForRepository', () => {
  it('prefers the explicitly active provider', () => {
    const cli = cliProvider()
    const openai = openAICompatProvider()
    const config = {
      activeProviderId: openai.id,
      providers: [cli, openai],
    }
    const resolved = resolveProviderForRepository(
      config,
      { accounts: [] },
      { id: 1 }
    )
    assert.strictEqual(resolved?.id, openai.id)
  })

  it('falls back by priority copilot > external-cli > openai-compat', () => {
    const openai = openAICompatProvider()
    const cli = cliProvider()
    const config = {
      activeProviderId: null,
      providers: [openai, cli],
    }
    assert.strictEqual(
      resolveProviderForRepository(config, { accounts: [] }, { id: 1 })?.id,
      cli.id
    )
    assert.strictEqual(
      resolveProviderForRepository(
        { activeProviderId: null, providers: [openai] },
        { accounts: [] },
        { id: 1 }
      )?.id,
      openai.id
    )
  })

  it('returns the default Copilot provider for licensed accounts', () => {
    const resolved = resolveProviderForRepository(
      getDefaultAISummaryConfig(),
      { accounts: [licensedAccount()] },
      { id: 1 }
    )
    assert.strictEqual(resolved?.id, CopilotDefaultProviderId)
  })

  it('returns null when nothing is usable', () => {
    const resolved = resolveProviderForRepository(
      getDefaultAISummaryConfig(),
      { accounts: [] },
      { id: 1 }
    )
    assert.strictEqual(resolved, null)
  })
})

describe('hasAnyUsableAIProvider', () => {
  it('is false for the default config without a licensed account', () => {
    assert.equal(
      hasAnyUsableAIProvider({
        accounts: [],
        aiSummaryConfig: getDefaultAISummaryConfig(),
      }),
      false
    )
  })

  it('is true once an external CLI or OpenAI provider is configured', () => {
    assert.equal(
      hasAnyUsableAIProvider({
        accounts: [],
        aiSummaryConfig: {
          activeProviderId: 'cli-1',
          providers: [cliProvider()],
        },
      }),
      true
    )
  })
})
