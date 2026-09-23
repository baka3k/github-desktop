import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { mkdtemp, chmod, writeFile, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  runCLISummary,
  runCLITest,
} from '../../../src/main-process/ai-summary/cli-runner'
import type { IExternalCLIProviderConfig } from '../../../src/lib/ai-summary/config'

let fixtureDir: string
let echoFenceScript: string
let slowScript: string
let failingScript: string
let versionScript: string
let gibberishScript: string
let stdinDumpScript: string

before(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'ai-summary-cli-'))
  const write = async (name: string, body: string) => {
    const p = join(fixtureDir, name)
    await writeFile(p, body)
    await chmod(p, 0o755)
    return p
  }
  echoFenceScript = await write(
    'fence.sh',
    '#!/bin/sh\ncat <<\'EOF\'\n```json\n{"title": "Add feature", "description": "Adds the feature"}\n```\nEOF\n'
  )
  slowScript = await write('slow.sh', '#!/bin/sh\nsleep 30\n')
  failingScript = await write(
    'failing.sh',
    '#!/bin/sh\necho "Authorization: Bearer supersecret123" >&2\nexit 7\n'
  )
  versionScript = await write('version.sh', '#!/bin/sh\necho "1.2.3"\n')
  gibberishScript = await write('gibberish.sh', '#!/bin/sh\necho "hello"\n')
  stdinDumpScript = await write(
    'stdin-dump.sh',
    "#!/bin/sh\ncat > \"$1\"\nprintf '```json\\n{\"title\": \"OK\", \"description\": \"\"}\\n```\\n'\n"
  )
})

after(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

function cliConfig(
  overrides: Partial<IExternalCLIProviderConfig> = {}
): IExternalCLIProviderConfig {
  const now = Date.now()
  return {
    id: 'cli-test',
    kind: 'external-cli',
    displayName: 'Test CLI',
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
    executable: echoFenceScript,
    extraArgs: [],
    timeoutSeconds: 20,
    workingDirMode: 'home',
    apiKeyEnvVar: null,
    ...overrides,
  }
}

const summaryArgs = (
  config: IExternalCLIProviderConfig,
  signal?: AbortSignal
) => ({
  config,
  diff: 'diff --git a/a b/a',
  rules: [],
  repositoryPath: '/repo',
  signal,
})

describe('runCLISummary', () => {
  it('writes the unified commit-message system prompt to stdin wrapped in per-request diff tags', async () => {
    const dumpPath = join(fixtureDir, 'stdin-dump.txt')
    const result = await runCLISummary(
      summaryArgs(
        cliConfig({ executable: stdinDumpScript, extraArgs: [dumpPath] })
      )
    )

    assert.deepEqual(result, {
      kind: 'ok',
      title: 'OK',
      description: '',
    })

    const stdin = await readFile(dumpPath, 'utf8')
    // The same unified system prompt that the Copilot SDK path sends
    // is now piped to the CLI's stdin.
    assert.ok(
      stdin.includes("You're an AI assistant"),
      'unified system prompt should reach the CLI stdin'
    )
    // The diff must be wrapped in a per-request `<diff-XXX>` tag.
    assert.match(
      stdin,
      /<diff-[0-9a-f]{16}>[\s\S]*diff --git a\/a b\/a[\s\S]*<\/diff-[0-9a-f]{16}>/,
      'diff should be wrapped in per-request diff tag'
    )
    // The system prompt precedes the user prompt on stdin.
    const systemIdx = stdin.indexOf("You're an AI assistant")
    const diffIdx = stdin.indexOf('<diff-')
    assert.ok(systemIdx >= 0 && diffIdx > systemIdx, 'system precedes diff')
  })

  it('parses the JSON fence emitted on stdout', async () => {
    const result = await runCLISummary(summaryArgs(cliConfig()))

    assert.deepEqual(result, {
      kind: 'ok',
      title: 'Add feature',
      description: 'Adds the feature',
    })
  })

  it('rejects executables containing shell metacharacters', async () => {
    const result = await runCLISummary(
      summaryArgs(cliConfig({ executable: 'claudecode; rm -rf /' }))
    )

    assert.equal(result.kind, 'error')
    assert.equal(
      result.kind === 'error' ? result.code : null,
      'permission-denied'
    )
  })

  it('reports missing executables', async () => {
    const result = await runCLISummary(
      summaryArgs(cliConfig({ executable: 'not-a-real-cli-xyz' }))
    )

    assert.equal(result.kind, 'error')
    assert.equal(
      result.kind === 'error' ? result.code : null,
      'executable-not-found'
    )
  })

  it('maps non-zero exits to errors and redacts secrets in stderr', async () => {
    const result = await runCLISummary(
      summaryArgs(cliConfig({ executable: failingScript }))
    )

    assert.equal(result.kind, 'error')
    if (result.kind === 'error') {
      assert.equal(result.code, 'non-zero-exit')
      assert.ok(!result.userMessage.includes('supersecret123'))
      assert.ok(result.userMessage.includes('***'))
    }
  })

  it(
    'resolves as cancelled when the abort signal fires',
    { timeout: 10000 },
    async () => {
      const controller = new AbortController()
      const promise = runCLISummary(
        summaryArgs(cliConfig({ executable: slowScript }), controller.signal)
      )
      setTimeout(() => controller.abort(), 200)
      const result = await promise

      assert.deepEqual(result, { kind: 'cancelled' })
    }
  )

  it(
    'kills runaway processes when the timeout elapses',
    { timeout: 20000 },
    async () => {
      const started = Date.now()
      const result = await runCLISummary(
        summaryArgs(cliConfig({ executable: slowScript, timeoutSeconds: 1 }))
      )
      const elapsed = Date.now() - started

      assert.equal(result.kind, 'error')
      assert.ok(
        elapsed < 15_000,
        `expected a timely failure, took ${elapsed}ms`
      )
    }
  )
})

describe('runCLITest', () => {
  it('accepts an executable that prints a version string', async () => {
    const result = await runCLITest({
      config: cliConfig({ executable: versionScript }),
    })

    assert.deepEqual(result, { kind: 'ok', title: '1.2.3', description: '' })
  })

  it('rejects output that is not a version string', async () => {
    const result = await runCLITest({
      config: cliConfig({ executable: gibberishScript }),
    })

    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.code : null, 'invalid-output')
  })
})
