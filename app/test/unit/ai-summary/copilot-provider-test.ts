import assert from 'node:assert'
import { describe, it } from 'node:test'
import { CopilotSummaryProvider } from '../../../src/lib/ai-summary/copilot-provider'
import { CommitMessageGenerationCancelledError } from '../../../src/lib/stores/copilot-store'
import { Account } from '../../../src/models/account'

function account(): Account {
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
    // The SDK entitlement routes the provider through the fake store
    // instead of the dotcom fallback HTTP call.
    ['desktop_enable_copilot_sdk_commit_message_generation']
  )
}

function fakeStore(
  behavior: () => Promise<{ title: string; description: string }>
) {
  return {
    listModels: async () => [],
    generateCommitMessage: behavior,
  }
}

const args = () => ({
  diff: 'diff',
  rules: [],
  signal: new AbortController().signal,
  repositoryPath: '/repo',
})

describe('CopilotSummaryProvider', () => {
  it('returns the generated message from the Copilot store', async () => {
    const store = fakeStore(async () => ({
      title: 'Add feature',
      description: 'Adds the feature',
    }))
    const provider = new CopilotSummaryProvider(store as any, account(), {
      kind: 'copilot',
      modelId: null,
    })

    const result = await provider.generate(args())

    assert.deepEqual(result, {
      kind: 'ok',
      value: { title: 'Add feature', description: 'Adds the feature' },
    })
  })

  it('maps cancellation to the cancelled result', async () => {
    const store = fakeStore(async () => {
      throw new CommitMessageGenerationCancelledError()
    })
    const provider = new CopilotSummaryProvider(store as any, account(), {
      kind: 'copilot',
      modelId: null,
    })

    const result = await provider.generate(args())

    assert.deepEqual(result, { kind: 'cancelled' })
  })

  it('treats an already aborted signal as cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const store = fakeStore(async () => ({
      title: 'should not matter',
      description: '',
    }))
    const provider = new CopilotSummaryProvider(store as any, account(), {
      kind: 'copilot',
      modelId: null,
    })

    const result = await provider.generate({
      diff: 'diff',
      rules: [],
      signal: controller.signal,
      repositoryPath: '/repo',
    })

    assert.deepEqual(result, { kind: 'cancelled' })
  })

  it('reports failures as errors with a user message', async () => {
    const store = fakeStore(async () => {
      throw new Error('quota exceeded')
    })
    const provider = new CopilotSummaryProvider(store as any, account(), {
      kind: 'copilot',
      modelId: null,
    })

    const result = await provider.generate(args())

    assert.equal(result.kind, 'error')
    assert.ok(
      result.kind === 'error' && /quota exceeded/.test(result.userMessage)
    )
  })

  it('tests connectivity through listModels', async () => {
    const store = fakeStore(async () => ({
      title: '',
      description: '',
    }))
    const provider = new CopilotSummaryProvider(store as any, account(), {
      kind: 'copilot',
      modelId: null,
    })

    assert.equal((await provider.test()).kind, 'ok')

    const failing = {
      listModels: async () => {
        throw new Error('offline')
      },
      generateCommitMessage: async () => ({
        title: '',
        description: '',
      }),
    }
    const failingResult = await new CopilotSummaryProvider(
      failing as any,
      account(),
      { kind: 'copilot', modelId: null }
    ).test()

    assert.equal(failingResult.kind, 'error')
  })
})
