import * as React from 'react'
import { Select } from '../../lib/select'
import { CopilotDefaultProviderId } from '../../../lib/ai-summary'
import type { IAISummaryConfig } from '../../../lib/ai-summary'

interface IAISummaryActiveSelectorProps {
  readonly config: IAISummaryConfig
  readonly onConfigChanged: (config: IAISummaryConfig) => void
}

/** Dropdown for picking the active AI summary provider. */
export class AISummaryActiveSelector extends React.Component<IAISummaryActiveSelectorProps> {
  public render() {
    const { config } = this.props
    if (config.providers.length === 0) {
      return null
    }

    const items = config.providers.map(p => ({
      title: `${p.displayName}${p.kind === 'copilot' ? ' (Copilot)' : ''}`,
      value: p.id,
    }))

    return (
      <div className="active-provider-row">
        <label htmlFor="ai-summary-active-provider">Active provider:</label>
        <Select
          value={config.activeProviderId ?? CopilotDefaultProviderId}
          onChange={this.handleActiveProviderChanged}
        >
          {items.map(i => (
            <option key={i.value} value={i.value}>
              {i.title}
            </option>
          ))}
        </Select>
      </div>
    )
  }

  private handleActiveProviderChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onConfigChanged({
      ...this.props.config,
      activeProviderId: event.currentTarget.value,
    })
  }
}
