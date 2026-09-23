import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  DefaultCommitMessage,
  type ICommitMessage,
} from '../../../src/models/commit-message'

describe('ICommitMessage AI rename', () => {
  it('defaults to an empty message without the AI flag', () => {
    assert.equal(DefaultCommitMessage.generatedByAi, undefined)
    assert.equal(DefaultCommitMessage.summary, '')
  })

  it('supports marking a message as AI generated', () => {
    const message: ICommitMessage = {
      summary: 'Add feature',
      description: null,
      timestamp: 123,
      generatedByAi: true,
    }
    assert.equal(message.generatedByAi, true)
  })

  it('carries the copy-pasted-by-user reset semantics', () => {
    // When the user edits the message the UI resets the flag to false
    // rather than deleting it.
    const message: ICommitMessage = {
      summary: 'edited',
      description: '',
      timestamp: 456,
      generatedByAi: false,
    }
    assert.equal(message.generatedByAi, false)
  })
})
