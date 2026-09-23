import assert from 'node:assert'
import { describe, it } from 'node:test'
import { parseCopilotCommitMessage } from '../../src/lib/copilot-commit-message'

describe('parseCopilotCommitMessage', () => {
  it('parses a plain JSON object', () => {
    const result = parseCopilotCommitMessage(
      '{"title": "Fix bug", "description": "Fixes the bug"}'
    )

    assert.deepEqual(result, {
      title: 'Fix bug',
      description: 'Fixes the bug',
    })
  })

  it('parses a fenced json block', () => {
    const result = parseCopilotCommitMessage(
      'Here is your commit message:\n```json\n{"title": "Fix bug"}\n```\nHope this helps!'
    )

    assert.deepEqual(result, { title: 'Fix bug', description: '' })
  })

  it('parses a fenced block with an uppercase language tag', () => {
    const result = parseCopilotCommitMessage(
      '```JSON\n{"title": "Fix bug", "description": "d"}\n```'
    )

    assert.deepEqual(result, { title: 'Fix bug', description: 'd' })
  })

  it('recovers JSON embedded in prose without fences', () => {
    const result = parseCopilotCommitMessage(
      'Sure! Here is the commit message: {"title": "Add feature", "description": "Adds a feature"} Let me know if you need changes.'
    )

    assert.deepEqual(result, {
      title: 'Add feature',
      description: 'Adds a feature',
    })
  })

  it('strips reasoning blocks emitted by thinking models', () => {
    const result = parseCopilotCommitMessage(
      '<think>\nThe diff touches a login form, so the title should mention auth.\n</think>\n{"title": "Fix login form", "description": "Adds missing name attribute"}'
    )

    assert.deepEqual(result, {
      title: 'Fix login form',
      description: 'Adds missing name attribute',
    })
  })

  it('treats a null description as empty', () => {
    const result = parseCopilotCommitMessage(
      '{"title": "Fix bug", "description": null}'
    )

    assert.deepEqual(result, { title: 'Fix bug', description: '' })
  })

  it('rejects an empty title', () => {
    assert.throws(
      () => parseCopilotCommitMessage('{"title": "", "description": "d"}'),
      /"title" must be a non-empty string/
    )
  })

  it('rejects a non-object payload', () => {
    assert.throws(
      () => parseCopilotCommitMessage('"just a string"'),
      /expected an object/
    )
  })

  it('includes a response snippet when nothing parses', () => {
    const garbage = 'I could not generate a message for this diff, sorry!'

    assert.throws(
      () => parseCopilotCommitMessage(garbage),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.match(e.message, /invalid JSON/)
        assert.match(e.message, /could not generate a message/)
        return true
      }
    )
  })

  it('truncates the snippet for very long responses', () => {
    const garbage = `I am a very verbose model. ${'x'.repeat(500)}`

    assert.throws(
      () => parseCopilotCommitMessage(garbage),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.ok(e.message.length < 400)
        return true
      }
    )
  })
})
