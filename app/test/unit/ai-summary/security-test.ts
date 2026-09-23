import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  containsShellMetachar,
  redactSecrets,
  resolveExecutable,
  validateShellSafeArgv,
  _clearResolveExecutableCache,
} from '../../../src/main-process/ai-summary/security'

describe('redactSecrets', () => {
  it('redacts bare Bearer tokens', () => {
    const output = redactSecrets('error from http://x: Bearer abc123def456')
    assert.ok(!output.includes('abc123def456'))
    assert.ok(output.includes('Bearer ***'))
  })

  it('redacts Authorization headers including Basic auth', () => {
    const output = redactSecrets('Authorization: Basic dXNlcjpwYXNz')
    assert.ok(!output.includes('dXNlcjpwYXNz'))
    assert.ok(output.includes('Authorization: ***'))
  })

  it('redacts x-api-key headers with opaque values', () => {
    const output = redactSecrets('x-api-key: tok_9f8e7d6c5b')
    assert.ok(!output.includes('tok_9f8e7d6c5b'))
    assert.ok(output.includes('x-api-key: ***'))
  })

  it('redacts env-var style assignments for known key variables', () => {
    const output = redactSecrets('ANTHROPIC_API_KEY=sk-abc123def456ghi789')
    assert.ok(!output.includes('abc123def456ghi789'))
  })

  it('redacts OpenAI-style sk- keys', () => {
    const output = redactSecrets('failed with key sk-abc123def456ghi789')
    assert.ok(!output.includes('abc123def456ghi789'))
    assert.ok(output.includes('sk-***'))
  })

  it('redacts long hex blobs', () => {
    const hex = 'a'.repeat(64)
    const output = redactSecrets(`token ${hex} end`)
    assert.ok(!output.includes(hex))
  })

  it('leaves plain text untouched', () => {
    const input = 'the CLI exited with an error'
    assert.equal(redactSecrets(input), input)
  })

  it('redacts each secret in multi-line output', () => {
    const output = redactSecrets(
      'Authorization: Basic firstsecret1\nx-api-key: secondsecret2'
    )
    assert.ok(!output.includes('firstsecret1'))
    assert.ok(!output.includes('secondsecret2'))
  })
})

describe('validateShellSafeArgv', () => {
  it('accepts plain executables and arguments', () => {
    assert.equal(validateShellSafeArgv('claudecode', ['--version']), true)
    assert.equal(
      validateShellSafeArgv('/usr/local/bin/claudecode', ['--mode', 'x']),
      true
    )
  })

  it('defers traversal-style names to executable resolution', async () => {
    // validateShellSafeArgv only checks for shell metacharacters; the
    // path traversal case is caught later when resolveExecutable fails
    // to find the binary on PATH.
    assert.equal(validateShellSafeArgv('../../etc/passwd', []), true)
    assert.equal(await resolveExecutable('../../etc/passwd', '/bin'), null)
  })

  it('rejects shell metacharacters anywhere in the argv', () => {
    assert.equal(validateShellSafeArgv('claudecode; rm -rf /', []), false)
    assert.equal(
      validateShellSafeArgv('claudecode', ['&&', 'curl', 'evil.com']),
      false
    )
    assert.equal(validateShellSafeArgv('a|b', []), false)
    assert.equal(validateShellSafeArgv('a`b`', []), false)
  })

  it('lets empty executables fail at resolution time', async () => {
    // No metacharacters to reject, but nothing can be spawned either —
    // resolveExecutable returns null for empty names.
    assert.equal(validateShellSafeArgv('', []), true)
    assert.equal(await resolveExecutable(''), null)
  })
})

describe('containsShellMetachar', () => {
  it('detects metacharacters', () => {
    assert.equal(containsShellMetachar('a;b'), true)
    assert.equal(containsShellMetachar('a\nb'), true)
    assert.equal(containsShellMetachar('$HOME'), true)
  })

  it('accepts safe values', () => {
    assert.equal(containsShellMetachar('--mode=commit-summary'), false)
    assert.equal(containsShellMetachar('/usr/local/bin/tool'), false)
  })
})

describe('resolveExecutable', () => {
  it('returns absolute paths as-is', async () => {
    assert.equal(await resolveExecutable('/bin/sh'), '/bin/sh')
  })

  it('returns null for empty names', async () => {
    assert.equal(await resolveExecutable(''), null)
  })

  it('resolves well-known binaries on PATH', async () => {
    _clearResolveExecutableCache()
    const resolved = await resolveExecutable(
      'sh',
      '/usr/bin:/bin:/usr/sbin:/sbin'
    )
    assert.ok(resolved !== null && resolved.endsWith('/sh'))
  })

  it('returns null for binaries that do not exist', async () => {
    _clearResolveExecutableCache()
    assert.equal(
      await resolveExecutable('no-such-binary-xyz', '/usr/bin:/bin'),
      null
    )
  })
})
