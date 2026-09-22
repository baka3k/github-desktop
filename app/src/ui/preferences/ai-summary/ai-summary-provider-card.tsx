import * as React from 'react'
import { Button } from '../../lib/button'
import { CopilotDefaultProviderId } from '../../../lib/ai-summary'
import type { IAISummaryProviderConfig } from '../../../lib/ai-summary'
import { AISummaryTestResult } from './ai-summary-test-result'

interface IAISummaryProviderCardProps {
  readonly provider: IAISummaryProviderConfig
  /** Whether a connection test is in flight for this provider. */
  readonly testing: boolean
  /** Whether the Test button should be disabled (any test in flight). */
  readonly testDisabled: boolean
  readonly onTest: (id: string) => void
  readonly onDelete: (id: string) => void
}

/**
 * A single list entry for a configured AI summary provider: display
 * name, kind badge, connection test result and the Test/Remove actions.
 */
export class AISummaryProviderCard extends React.Component<IAISummaryProviderCardProps> {
  public render() {
    const { provider, testing, testDisabled } = this.props

    return (
      <li className="provider-card">
        <header>
          <strong>{provider.displayName}</strong>
          <span className="kind-badge">{provider.kind}</span>
        </header>
        <AISummaryTestResult
          status={provider.lastTestStatus}
          error={provider.lastTestError}
          testedAt={provider.lastTestedAt}
          testing={testing}
        />
        <div className="card-actions">
          <Button onClick={this.handleTest} disabled={testDisabled}>
            Test connection
          </Button>
          {provider.id !== CopilotDefaultProviderId && (
            <Button className="remove-button" onClick={this.handleDelete}>
              Remove
            </Button>
          )}
        </div>
      </li>
    )
  }

  private handleTest = () => {
    this.props.onTest(this.props.provider.id)
  }

  private handleDelete = () => {
    this.props.onDelete(this.props.provider.id)
  }
}
