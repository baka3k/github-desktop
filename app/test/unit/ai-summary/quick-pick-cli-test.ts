import assert from 'node:assert'
import { describe, it } from 'node:test'
import { QuickPickCLI } from '../../../src/lib/ai-summary/quick-pick-cli'

describe('QuickPickCLI', () => {
  it('contains exactly the six curated CLI entries', () => {
    assert.deepEqual(
      QuickPickCLI.map(q => q.id),
      ['claudecode', 'mcode', 'qwen', 'opencode', 'commandcode', 'gemini']
    )
  })

  it('defines every field on every entry', () => {
    for (const q of QuickPickCLI) {
      assert.strictEqual(typeof q.id, 'string')
      assert.ok(q.id.length > 0, `${q.id}: id must not be empty`)
      assert.ok(
        q.displayName.length > 0,
        `${q.id}: displayName must not be empty`
      )
      assert.ok(
        q.executable.length > 0,
        `${q.id}: executable must not be empty`
      )
      assert.ok(Array.isArray(q.extraArgs))
      assert.ok(
        q.apiKeyEnvVar === null || typeof q.apiKeyEnvVar === 'string',
        `${q.id}: apiKeyEnvVar must be a string or null`
      )
      assert.ok(
        q.installHint.length > 0,
        `${q.id}: installHint must not be empty`
      )
    }
  })

  it('uses unique executables across entries', () => {
    const executables = QuickPickCLI.map(q => q.executable)
    assert.strictEqual(new Set(executables).size, executables.length)
  })

  it('keeps the claudecode entry intact (regression)', () => {
    const claude = QuickPickCLI.find(q => q.id === 'claudecode')
    assert.ok(claude !== undefined)
    assert.strictEqual(claude.displayName, 'Claude Code')
    assert.strictEqual(claude.executable, 'claudecode')
    assert.deepEqual(claude.extraArgs, ['--mode', 'commit-summary'])
    assert.strictEqual(claude.apiKeyEnvVar, 'ANTHROPIC_API_KEY')
    assert.strictEqual(claude.installHint, 'npm i -g @anthropic-ai/claude-code')
  })
})
