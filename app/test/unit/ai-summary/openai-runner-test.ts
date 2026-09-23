import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import * as http from 'http'
import {
  runOpenAICompatSummary,
  runOpenAICompatTest,
} from '../../../src/main-process/ai-summary/openai-runner'
import type { IOpenAICompatProviderConfig } from '../../../src/lib/ai-summary/config'

let server: http.Server
let baseUrl: string
let lastRequestPath: string | null = null
let lastRequestBody: string | null = null

before(async () => {
  server = http.createServer((req, res) => {
    lastRequestPath = req.url ?? null
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      lastRequestBody = body
      if (req.url?.includes('/unauthorized')) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad key' }))
        return
      }
      if (req.url?.includes('/server-error')) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'boom' }))
        return
      }
      if (req.url?.includes('/garbage')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('not json')
        return
      }
      if (req.url?.includes('/hang')) {
        // Never respond; the caller is expected to abort.
        return
      }

      const parsed = JSON.parse(body)
      // The test probe asks the model to reply with exactly "PONG";
      // the summary flow receives a diff-style prompt and gets a fence.
      const content = JSON.stringify(parsed).includes('PONG')
        ? 'PONG'
        : '```json\n{"title": "Fix bug", "description": "Fixes the bug"}\n```'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content } }],
        })
      )
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('could not determine test server port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

function openAIConfig(
  path: string,
  overrides: Partial<IOpenAICompatProviderConfig> = {}
): IOpenAICompatProviderConfig {
  const now = Date.now()
  return {
    id: 'openai-test',
    kind: 'openai-compat',
    displayName: 'Test OpenAI',
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
    baseUrl: `${baseUrl}${path}`,
    modelId: 'test-model',
    wireApi: 'chat-completions',
    authKind: 'none',
    timeoutSeconds: 10,
    ...overrides,
  }
}

const summaryArgs = (
  config: IOpenAICompatProviderConfig,
  signal?: AbortSignal
) => ({
  config,
  diff: 'diff --git a/a b/a',
  rules: [],
  repositoryPath: '/repo',
  signal,
})

describe('runOpenAICompatSummary', () => {
  it('posts the diff and parses the fenced commit message', async () => {
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1/chat/completions'))
    )

    assert.deepEqual(result, {
      kind: 'ok',
      title: 'Fix bug',
      description: 'Fixes the bug',
    })
  })

  it('sends the unified commit-message system prompt with per-request diff tags', async () => {
    lastRequestBody = null
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1/chat/completions'))
    )

    assert.equal(result.kind, 'ok')
    assert.ok(lastRequestBody, 'request body should have been captured')
    // `lastRequestBody` is reassigned inside the fetch stub, so control
    // flow analysis can't narrow it past the assert above.
    const requestBody = lastRequestBody as string
    // The unified system prompt is byte-identical to the one the Copilot
    // SDK path sends — this is the contract the unification refactor
    // established.
    assert.ok(
      requestBody.includes("You're an AI assistant"),
      'unified system prompt should reach the wire'
    )
    // The diff must be wrapped in a per-request `<diff-XXX>` tag, not
    // raw text.
    assert.match(
      requestBody,
      /<diff-[0-9a-f]{16}>[\s\S]*diff --git a\/a b\/a[\s\S]*<\/diff-[0-9a-f]{16}>/
    )
    // Body shape: `system` + `user` chat-completions messages.
    const payload = JSON.parse(requestBody)
    assert.ok(Array.isArray(payload.messages))
    assert.equal(payload.messages[0].role, 'system')
    assert.equal(payload.messages[1].role, 'user')
  })

  it('does not double the /v1 segment when the baseUrl already includes it', async () => {
    lastRequestPath = null
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1'))
    )

    assert.equal(result.kind, 'ok')
    assert.equal(lastRequestPath, '/v1/chat/completions')
  })

  it('maps HTTP 4xx responses to http-error', async () => {
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1/unauthorized'))
    )

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'http-error')
  })

  it('maps HTTP 5xx responses to http-error', async () => {
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1/server-error'))
    )

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'http-error')
  })

  it('reports unparseable payloads as invalid-output', async () => {
    const result = await runOpenAICompatSummary(
      summaryArgs(openAIConfig('/v1/garbage'))
    )

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'invalid-output')
  })

  it(
    'resolves as cancelled when the signal aborts mid-flight',
    { timeout: 10000 },
    async () => {
      const controller = new AbortController()
      const promise = runOpenAICompatSummary(
        summaryArgs(openAIConfig('/v1/hang'), controller.signal)
      )
      setTimeout(() => controller.abort(), 200)

      assert.deepEqual(await promise, { kind: 'cancelled' })
    }
  )

  it('rejects non-local plaintext http base URLs', async () => {
    const result = await runOpenAICompatSummary(
      summaryArgs({
        ...openAIConfig('/v1/chat/completions'),
        baseUrl: 'http://evil.example.com/v1',
      })
    )

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'invalid-config')
  })
})

describe('runOpenAICompatTest', () => {
  it('expects the provider to answer PONG', async () => {
    const result = await runOpenAICompatTest({
      config: openAIConfig('/v1/ping'),
    })

    assert.deepEqual(result, { kind: 'ok', title: 'PONG', description: '' })
  })

  it('surfaces HTTP errors from the provider', async () => {
    const result = await runOpenAICompatTest({
      config: openAIConfig('/v1/unauthorized'),
    })

    assert.equal(result.kind, 'error')
  })
})
