import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ipcRenderer } from 'electron'
import { OpenAICompatProvider } from '../../../src/lib/ai-summary/openai-compat-provider'
import type { IOpenAICompatProviderConfig } from '../../../src/lib/ai-summary/config'

const invokeMock = ipcRenderer.invoke as unknown as {
  mock: {
    calls: ReadonlyArray<{ arguments: unknown[] }>
    mockImplementation(impl: (...args: any[]) => unknown): void
    resetCalls(): void
  }
}

function openAIConfig(
  overrides: Partial<IOpenAICompatProviderConfig> = {}
): IOpenAICompatProviderConfig {
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
    authKind: 'none',
    timeoutSeconds: 60,
    ...overrides,
  }
}

describe('OpenAICompatProvider', () => {
  it('invokes the openai-run channel with the provider config', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'T',
      description: 'D',
    }))

    const config = openAIConfig()
    const result = await new OpenAICompatProvider(config).generate({
      diff: 'the diff',
      rules: [],
      signal: new AbortController().signal,
      repositoryPath: '/repo',
    })

    assert.equal(result.kind, 'ok')
    assert.equal(result.kind === 'ok' ? result.value.title : null, 'T')
    assert.equal(invokeMock.mock.calls[0].arguments[0], 'ai-summary-openai-run')
    assert.strictEqual(invokeMock.mock.calls[0].arguments[1], config)
  })

  it('does not pass any secret over IPC', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'T',
      description: '',
    }))

    // Secrets live in the OS keychain and are read by the main process;
    // the renderer payload only carries the non-sensitive config.
    await new OpenAICompatProvider(
      openAIConfig({ authKind: 'apiKey' })
    ).generate({
      diff: 'd',
      rules: [],
      signal: new AbortController().signal,
      repositoryPath: '/repo',
    })

    const payload = invokeMock.mock.calls[0].arguments[1] as Record<
      string,
      unknown
    >
    assert.ok(!('apiKey' in payload))
    assert.ok(!('secret' in payload))
  })

  it('maps HTTP errors reported by main to error results', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'error',
      code: 'http-error',
      userMessage: 'Provider returned 401.',
    }))

    const result = await new OpenAICompatProvider(openAIConfig()).generate({
      diff: 'd',
      rules: [],
      signal: new AbortController().signal,
      repositoryPath: '/repo',
    })

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'http-error')
  })

  it('short-circuits to cancelled when the signal is already aborted', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'T',
      description: '',
    }))

    const controller = new AbortController()
    controller.abort()
    const result = await new OpenAICompatProvider(openAIConfig()).generate({
      diff: 'd',
      rules: [],
      signal: controller.signal,
      repositoryPath: '/repo',
    })

    assert.deepEqual(result, { kind: 'cancelled' })
    assert.equal(invokeMock.mock.calls.length, 0)
  })

  it('invokes the openai-test channel', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'PONG',
      description: '',
    }))

    const result = await new OpenAICompatProvider(openAIConfig()).test()

    assert.equal(result.kind, 'ok')
    assert.equal(
      invokeMock.mock.calls[0].arguments[0],
      'ai-summary-openai-test'
    )
  })
})
