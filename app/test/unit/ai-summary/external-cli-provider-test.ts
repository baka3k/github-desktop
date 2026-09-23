import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ipcRenderer } from 'electron'
import { ExternalCLIProvider } from '../../../src/lib/ai-summary/external-cli-provider'
import type { IExternalCLIProviderConfig } from '../../../src/lib/ai-summary/config'

const invokeMock = ipcRenderer.invoke as unknown as {
  mock: {
    calls: ReadonlyArray<{ arguments: unknown[] }>
    mockImplementation(impl: (...args: any[]) => unknown): void
    resetCalls(): void
  }
}

function cliConfig(
  overrides: Partial<IExternalCLIProviderConfig> = {}
): IExternalCLIProviderConfig {
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

const args = (signal: AbortSignal = new AbortController().signal) => ({
  diff: 'diff --git a/a b/a',
  rules: [],
  signal,
  repositoryPath: '/repo',
})

describe('ExternalCLIProvider', () => {
  it('invokes the cli-run channel with the provider config and payload', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'Hello',
      description: 'World',
    }))

    const config = cliConfig()
    const result = await new ExternalCLIProvider(config).generate(args())

    assert.equal(result.kind, 'ok')
    assert.deepEqual(result.kind === 'ok' ? result.value : null, {
      title: 'Hello',
      description: 'World',
    })
    assert.ok(invokeMock.mock.calls.length > 0)
    const [channel, passedConfig, diff, , repositoryPath] = invokeMock.mock
      .calls[0].arguments as [string, unknown, string, unknown, string]
    assert.equal(channel, 'ai-summary-cli-run')
    assert.strictEqual(passedConfig, config)
    assert.equal(diff, 'diff --git a/a b/a')
    assert.equal(repositoryPath, '/repo')
  })

  it('invokes the cli-test channel', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: '1.2.3',
      description: '',
    }))

    const result = await new ExternalCLIProvider(cliConfig()).test()

    assert.equal(result.kind, 'ok')
    assert.equal(invokeMock.mock.calls[0].arguments[0], 'ai-summary-cli-test')
  })

  it('short-circuits to cancelled when the signal is already aborted', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'should never happen',
      description: '',
    }))

    const controller = new AbortController()
    controller.abort()
    const result = await new ExternalCLIProvider(cliConfig()).generate(
      args(controller.signal)
    )

    assert.deepEqual(result, { kind: 'cancelled' })
    assert.equal(invokeMock.mock.calls.length, 0)
  })

  it('maps IPC errors to error results', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'error',
      code: 'executable-not-found',
      userMessage: 'Could not find "claudecode" on PATH.',
    }))

    const result = await new ExternalCLIProvider(cliConfig()).generate(args())

    assert.equal(result.kind, 'error')
    assert.equal(
      result.kind === 'error' ? result.code : null,
      'executable-not-found'
    )
  })
})
