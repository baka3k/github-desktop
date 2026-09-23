import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ipcRenderer } from 'electron'
import { AISummaryService } from '../../../src/lib/ai-summary/service'
import {
  getDefaultAISummaryConfig,
  type IAISummaryProviderConfig,
} from '../../../src/lib/ai-summary/config'
import { MaxSummaryDiffChars } from '../../../src/lib/ai-summary/diff-budget'
import { Account } from '../../../src/models/account'
import { Repository } from '../../../src/models/repository'

const invokeMock = ipcRenderer.invoke as unknown as {
  mock: {
    calls: ReadonlyArray<{ arguments: unknown[] }>
    mockImplementation(impl: (...args: any[]) => unknown): void
    resetCalls(): void
  }
}

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
    [
      'desktop_copilot_generate_commit_message',
      'desktop_enable_copilot_sdk_commit_message_generation',
    ]
  )
}

function cliProvider(): IAISummaryProviderConfig {
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
    extraArgs: [],
    timeoutSeconds: 60,
    workingDirMode: 'home',
    apiKeyEnvVar: null,
  }
}

function openAIProvider(): IAISummaryProviderConfig {
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
  }
}

function makeService(
  overrides: {
    generateCommitMessage?: () => Promise<unknown>
  } = {}
): AISummaryService {
  const copilotStore = {
    listModels: async () => [],
    generateCommitMessage:
      overrides.generateCommitMessage ??
      (async () => ({ title: 'Copilot title', description: '' })),
  }
  return new AISummaryService({
    copilotStore: copilotStore as any,
    resolveCopilotModelRequest: async () => ({
      kind: 'copilot',
      modelId: null,
    }),
  })
}

const args = (signal = new AbortController().signal, diff = 'diff') => ({
  diff,
  rules: [],
  signal,
  repositoryPath: '/repo',
})

describe('AISummaryService', () => {
  it('returns invalid-config when no provider is usable', async () => {
    const repository = new Repository('/repo', 1, null, false)
    const result = await makeService().generate(
      getDefaultAISummaryConfig(),
      repository,
      [],
      args()
    )

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'invalid-config')
  })

  it('dispatches to the Copilot store for the default provider', async () => {
    const repository = new Repository('/repo', 1, null, false)
    const result = await makeService().generate(
      getDefaultAISummaryConfig(),
      repository,
      [licensedAccount()],
      args()
    )

    assert.deepEqual(result, {
      kind: 'ok',
      value: { title: 'Copilot title', description: '' },
    })
  })

  it('dispatches external CLI providers over IPC', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'CLI title',
      description: '',
    }))

    const repository = new Repository('/repo', 1, null, false)
    const result = await makeService().generate(
      { activeProviderId: 'cli-1', providers: [cliProvider()] },
      repository,
      [],
      args()
    )

    assert.ok(result.kind === 'ok' && result.value.title === 'CLI title')
    assert.equal(invokeMock.mock.calls[0].arguments[0], 'ai-summary-cli-run')
  })

  it('dispatches OpenAI-compatible providers over IPC', async () => {
    invokeMock.mock.resetCalls()
    invokeMock.mock.mockImplementation(async () => ({
      kind: 'ok',
      title: 'GPT title',
      description: '',
    }))

    const repository = new Repository('/repo', 1, null, false)
    const result = await makeService().generate(
      { activeProviderId: 'openai-1', providers: [openAIProvider()] },
      repository,
      [],
      args()
    )

    assert.ok(result.kind === 'ok' && result.value.title === 'GPT title')
    assert.equal(invokeMock.mock.calls[0].arguments[0], 'ai-summary-openai-run')
  })

  it('trims oversized diffs before dispatching to the provider', async () => {
    const seen: string[] = []
    const service = makeService({
      generateCommitMessage: async (...a: any[]) => {
        seen.push(a[1] as string)
        return { title: 'Copilot title', description: '' }
      },
    })

    // ~440k characters of diff, well over the 120k budget.
    const oversized = Array.from({ length: 20 }, (_, i) => {
      let fileDiff = `diff --git a/src/file-${i}.ts b/src/file-${i}.ts\n--- a/src/file-${i}.ts\n+++ b/src/file-${i}.ts\n@@ -1,1000 +1,1000 @@\n`
      for (let l = 0; l < 1000; l++) {
        fileDiff += `+line ${l} of file ${i}\n`
      }
      return fileDiff
    }).join('')

    const result = await service.generate(
      getDefaultAISummaryConfig(),
      new Repository('/repo', 1, null, false),
      [licensedAccount()],
      args(new AbortController().signal, oversized)
    )

    assert.equal(result.kind, 'ok')
    assert.equal(seen.length, 1)
    assert.ok(seen[0].length <= MaxSummaryDiffChars)
    assert.ok(seen[0].includes('[NOTE:'))
  })

  it('passes small diffs through to the provider untouched', async () => {
    const seen: string[] = []
    const service = makeService({
      generateCommitMessage: async (...a: any[]) => {
        seen.push(a[1] as string)
        return { title: '', description: '' }
      },
    })

    const result = await service.generate(
      getDefaultAISummaryConfig(),
      new Repository('/repo', 1, null, false),
      [licensedAccount()],
      args(new AbortController().signal, 'diff --git a/x b/x\n')
    )

    assert.equal(result.kind, 'ok')
    assert.deepEqual(seen, ['diff --git a/x b/x\n'])
  })

  it('never throws — internal failures become error results', async () => {
    const repository = new Repository('/repo', 1, null, false)
    const service = makeService({
      generateCommitMessage: async () => {
        throw new Error('SDK exploded')
      },
    })

    const result = await service.generate(
      getDefaultAISummaryConfig(),
      repository,
      [licensedAccount()],
      args()
    )

    assert.equal(result.kind, 'error')
    assert.ok(
      result.kind === 'error' && /SDK exploded/.test(result.userMessage)
    )
  })

  it('propagates the abort signal to the provider', async () => {
    const controller = new AbortController()
    const seen: AbortSignal[] = []
    const copilotStore = {
      listModels: async () => [],
      generateCommitMessage: async (
        _account: unknown,
        _diff: unknown,
        _path: unknown,
        _request: unknown,
        _rules: unknown,
        signal: AbortSignal
      ) => {
        seen.push(signal)
        return { title: '', description: '' }
      },
    }
    const service = new AISummaryService({
      copilotStore: copilotStore as any,
      resolveCopilotModelRequest: async () => ({
        kind: 'copilot',
        modelId: null,
      }),
    })

    const result = await service.generate(
      getDefaultAISummaryConfig(),
      new Repository('/repo', 1, null, false),
      [licensedAccount()],
      args(controller.signal)
    )

    assert.equal(result.kind, 'ok')
    assert.equal(seen.length, 1)
    assert.strictEqual(seen[0], controller.signal)
  })

  it('short-circuits to cancelled when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    const copilotStore = {
      listModels: async () => [],
      generateCommitMessage: async () => {
        called = true
        return { title: '', description: '' }
      },
    }
    const service = new AISummaryService({
      copilotStore: copilotStore as any,
      resolveCopilotModelRequest: async () => ({
        kind: 'copilot',
        modelId: null,
      }),
    })

    const result = await service.generate(
      getDefaultAISummaryConfig(),
      new Repository('/repo', 1, null, false),
      [licensedAccount()],
      args(controller.signal)
    )

    assert.deepEqual(result, { kind: 'cancelled' })
    assert.equal(called, false)
  })
})
