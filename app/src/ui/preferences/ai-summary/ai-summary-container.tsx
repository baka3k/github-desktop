import * as React from 'react'
import { DialogContent } from '../../dialog'
import { Button } from '../../lib/button'
import type {
  AIProviderIPCResult,
  IAISummaryConfig,
  IAISummaryProviderConfig,
  IExternalCLIProviderConfig,
  IOpenAICompatProviderConfig,
} from '../../../lib/ai-summary'
import { setAISummaryProviderSecret } from '../../../lib/ai-summary/secrets'
import { AISummaryActiveSelector } from './ai-summary-active-selector'
import { AISummaryEmptyState } from './ai-summary-empty-state'
import { AISummaryProviderCard } from './ai-summary-provider-card'
import { AddOpenAIDialog } from './ai-summary-add-openai-dialog'
import { AddCLIDialog } from './ai-summary-add-cli-dialog'

interface IAISummaryContainerProps {
  readonly config: IAISummaryConfig
  readonly onConfigChanged: (config: IAISummaryConfig) => void
  readonly onDeleteProvider: (id: string) => void
  readonly onTestProvider: (id: string) => Promise<AIProviderIPCResult>
}

interface IAISummaryContainerState {
  readonly addingProvider: IAddProviderKind | null
  readonly testingProviderId: string | null
}

type IAddProviderKind = 'openai-compat' | 'external-cli'

/**
 * Root component of the AI Summary preferences tab. Hosts the active
 * provider selector, the list of configured providers and the dialogs
 * for adding new ones.
 */
export class AISummaryContainer extends React.Component<
  IAISummaryContainerProps,
  IAISummaryContainerState
> {
  public constructor(props: IAISummaryContainerProps) {
    super(props)
    this.state = { addingProvider: null, testingProviderId: null }
  }

  public render() {
    const { config } = this.props
    return (
      <DialogContent>
        <div className="ai-summary-prefs">
          <h2>AI Summary</h2>
          <p className="description">
            Configure how GitHub Desktop generates commit messages. The active
            provider will be used whenever you click{' '}
            <strong>Generate commit message with AI</strong>.
          </p>
          <AISummaryActiveSelector
            config={config}
            onConfigChanged={this.props.onConfigChanged}
          />
          {this.renderProviderList(config)}
          {this.renderAddButtons()}
          {this.state.addingProvider === 'openai-compat' && (
            <AddOpenAIDialog
              onCancel={this.dismissAddDialog}
              onSave={this.handleAddOpenAI}
            />
          )}
          {this.state.addingProvider === 'external-cli' && (
            <AddCLIDialog
              onCancel={this.dismissAddDialog}
              onSave={this.handleAddCLI}
            />
          )}
        </div>
      </DialogContent>
    )
  }

  private renderProviderList(config: IAISummaryConfig) {
    if (config.providers.length === 0) {
      return <AISummaryEmptyState />
    }
    return (
      <ul className="provider-list">
        {config.providers.map(p => (
          <AISummaryProviderCard
            key={p.id}
            provider={p}
            testing={this.state.testingProviderId === p.id}
            testDisabled={this.state.testingProviderId !== null}
            onTest={this.handleTest}
            onDelete={this.handleDelete}
          />
        ))}
      </ul>
    )
  }

  private renderAddButtons() {
    return (
      <div className="add-buttons">
        <Button onClick={this.showAddOpenAI}>
          + Add OpenAI-compatible provider
        </Button>
        <Button onClick={this.showAddCLI}>+ Add external CLI provider</Button>
      </div>
    )
  }

  private showAddOpenAI = () => {
    this.setState({ addingProvider: 'openai-compat' })
  }

  private showAddCLI = () => {
    this.setState({ addingProvider: 'external-cli' })
  }

  private dismissAddDialog = () => {
    this.setState({ addingProvider: null })
  }

  private handleAddOpenAI = (
    provider: IOpenAICompatProviderConfig,
    secret: string | null
  ): void => {
    this.handleAddProvider(provider, secret)
  }

  private handleAddCLI = (
    provider: IExternalCLIProviderConfig,
    secret: string | null
  ): void => {
    this.handleAddProvider(provider, secret)
  }

  private handleAddProvider(
    provider: IAISummaryProviderConfig,
    secret: string | null
  ): void {
    this.props.onConfigChanged({
      ...this.props.config,
      providers: [...this.props.config.providers, provider],
      activeProviderId: provider.id,
    })
    this.setState({ addingProvider: null })
    if (secret !== null && secret.length > 0) {
      void this.persistSecret(provider.id, secret)
    }
  }

  private async persistSecret(id: string, secret: string) {
    try {
      await setAISummaryProviderSecret(id, secret)
    } catch {
      // Will surface on next "Test connection".
    }
  }

  private handleTest = (id: string) => {
    void this.testProvider(id)
  }

  private handleDelete = (id: string) => {
    this.props.onDeleteProvider(id)
  }

  private async testProvider(id: string) {
    this.setState({ testingProviderId: id })
    try {
      await this.props.onTestProvider(id)
    } finally {
      this.setState({ testingProviderId: null })
    }
  }
}
