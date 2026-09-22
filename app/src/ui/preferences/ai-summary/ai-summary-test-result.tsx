import * as React from 'react'
import { Loading } from '../../lib/loading'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { formatDate } from '../../../lib/format-date'

interface IAISummaryTestResultProps {
  readonly status: 'ok' | 'error' | null
  readonly error: string | null
  readonly testedAt: number | null
  readonly testing: boolean
}

/**
 * Badge reflecting the outcome of the latest provider connection test:
 * testing, not tested, passed, or failed (with the error and date).
 */
export const AISummaryTestResult: React.FC<IAISummaryTestResultProps> = ({
  status,
  error,
  testedAt,
  testing,
}) => {
  if (testing) {
    return (
      <span className="badge muted">
        <Loading />
        Testing…
      </span>
    )
  }
  if (status === null || testedAt === null) {
    return <span className="badge muted">Not tested</span>
  }
  if (status === 'ok') {
    return (
      <span className="badge success">
        <Octicon symbol={octicons.check} /> Passed{' '}
        {formatDate(new Date(testedAt))}
      </span>
    )
  }
  return (
    <span className="badge error">
      <Octicon symbol={octicons.alert} /> Failed{' '}
      {formatDate(new Date(testedAt))}: {error}
    </span>
  )
}
