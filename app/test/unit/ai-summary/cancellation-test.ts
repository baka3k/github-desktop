import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  cancelRun,
  completeRun,
  registerRun,
} from '../../../src/main-process/ai-summary/cancellation'

describe('cancellation registry', () => {
  it('aborts a registered run and reports it as found', () => {
    const controller = new AbortController()
    registerRun('run-1', controller)

    assert.equal(cancelRun('run-1'), true)
    assert.equal(controller.signal.aborted, true)
  })

  it('keeps concurrent runs independent', () => {
    const first = new AbortController()
    const second = new AbortController()
    registerRun('run-a', first)
    registerRun('run-b', second)

    assert.equal(cancelRun('run-a'), true)
    assert.equal(first.signal.aborted, true)
    assert.equal(second.signal.aborted, false)
  })

  it('returns false when nothing is in flight', () => {
    assert.equal(cancelRun('unknown'), false)
  })

  it('drops completed runs so late cancels are no-ops', () => {
    const controller = new AbortController()
    registerRun('run-2', controller)
    completeRun('run-2')

    assert.equal(cancelRun('run-2'), false)
    assert.equal(controller.signal.aborted, false)
  })

  it('replaces a stale entry when a run id repeats', () => {
    const first = new AbortController()
    const second = new AbortController()
    registerRun('run-3', first)
    registerRun('run-3', second)

    assert.equal(cancelRun('run-3'), true)
    assert.equal(second.signal.aborted, true)
  })
})
