import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  AISummaryConfigParseError,
  parseAIProviderConfig,
  parseAISummaryConfig,
  parseAISummaryConfigOrNull,
} from '../../../src/lib/ai-summary/parse'
import { getDefaultAISummaryConfig } from '../../../src/lib/ai-summary/config'

describe('parseAIProviderConfig', () => {
  it('round-trips the default Copilot provider', () => {
    const provider = getDefaultAISummaryConfig().providers[0]
    const parsed = parseAIProviderConfig(JSON.parse(JSON.stringify(provider)))
    assert.deepEqual(parsed, provider)
  })

  it('parses an external CLI provider', () => {
    const parsed = parseAIProviderConfig({
      id: 'cli-1',
      kind: 'external-cli',
      displayName: 'Claude Code',
      enabled: true,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      createdAt: 1,
      updatedAt: 2,
      executable: 'claudecode',
      extraArgs: ['--mode', 'commit-summary'],
      timeoutSeconds: 30,
      workingDirMode: 'home',
      apiKeyEnvVar: null,
    })
    assert.equal(parsed.kind, 'external-cli')
  })

  it('rejects unsupported kinds', () => {
    assert.throws(
      () => parseAIProviderConfig({ kind: 'nope' }),
      AISummaryConfigParseError
    )
  })

  it('rejects non-local plaintext http baseUrls', () => {
    assert.throws(
      () =>
        parseAIProviderConfig({
          id: 'x',
          kind: 'openai-compat',
          displayName: 'Evil',
          enabled: true,
          lastTestedAt: null,
          lastTestStatus: null,
          lastTestError: null,
          createdAt: 1,
          updatedAt: 1,
          baseUrl: 'http://evil.example.com',
          modelId: 'm',
          wireApi: 'chat-completions',
          authKind: 'none',
          timeoutSeconds: 30,
        }),
      (e: unknown) =>
        e instanceof AISummaryConfigParseError && e.field === 'baseUrl'
    )
  })

  it('rejects non-positive timeouts and bad working directories', () => {
    const base = {
      id: 'cli-1',
      kind: 'external-cli',
      displayName: 'CLI',
      enabled: true,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      createdAt: 1,
      updatedAt: 1,
      executable: 'x',
      extraArgs: [],
      timeoutSeconds: 0,
      workingDirMode: 'home',
      apiKeyEnvVar: null,
    }
    assert.throws(() => parseAIProviderConfig(base), AISummaryConfigParseError)
    assert.throws(
      () =>
        parseAIProviderConfig({
          ...base,
          timeoutSeconds: 5,
          workingDirMode: '/',
        }),
      AISummaryConfigParseError
    )
  })
})

describe('parseAISummaryConfig', () => {
  it('rejects duplicate provider ids', () => {
    const provider = {
      id: 'dup',
      kind: 'external-cli',
      displayName: 'A',
      enabled: true,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      createdAt: 1,
      updatedAt: 1,
      executable: 'x',
      extraArgs: [],
      timeoutSeconds: 5,
      workingDirMode: 'home',
      apiKeyEnvVar: null,
    }
    assert.throws(
      () =>
        parseAISummaryConfig({
          activeProviderId: 'dup',
          providers: [provider, provider],
        }),
      (e: unknown) =>
        e instanceof AISummaryConfigParseError && e.field.includes('id')
    )
  })

  it('parses a full config payload', () => {
    const config = getDefaultAISummaryConfig()
    const parsed = parseAISummaryConfig(JSON.parse(JSON.stringify(config)))
    assert.deepEqual(parsed, config)
  })
})

describe('parseAISummaryConfigOrNull', () => {
  it('returns null for null input', () => {
    assert.equal(parseAISummaryConfigOrNull(null), null)
  })

  it('returns null for malformed JSON', () => {
    assert.equal(parseAISummaryConfigOrNull('{nope'), null)
  })

  it('returns null for structurally invalid payloads', () => {
    assert.equal(
      parseAISummaryConfigOrNull(JSON.stringify({ providers: 'nope' })),
      null
    )
  })
})
