import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { TextBox } from '../../lib/text-box'
import { Select } from '../../lib/select'
import { isValidBYOKBaseUrl } from '../../../lib/copilot/byok'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import type { IOpenAICompatProviderConfig } from '../../../lib/ai-summary'

interface IAddOpenAIDialogProps {
  readonly onCancel: () => void
  readonly onSave: (
    provider: IOpenAICompatProviderConfig,
    secret: string | null
  ) => void
}

interface IAddOpenAIDialogState {
  readonly displayName: string
  readonly baseUrl: string
  readonly modelId: string
  readonly wireApi: 'chat-completions' | 'responses'
  readonly authKind: 'apiKey' | 'bearer' | 'none'
  readonly timeoutSeconds: string
  readonly apiKey: string
}

/** Clamp user-entered timeouts into a safe 1–600s range. */
function clampTimeoutSeconds(raw: string): number {
  return Math.max(1, Math.min(600, Math.round(Number(raw) || 60)))
}

/** Dialog for adding an OpenAI-compatible (BYOK-style) provider. */
export class AddOpenAIDialog extends React.Component<
  IAddOpenAIDialogProps,
  IAddOpenAIDialogState
> {
  public constructor(props: IAddOpenAIDialogProps) {
    super(props)
    this.state = {
      displayName: '',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o',
      wireApi: 'chat-completions',
      authKind: 'apiKey',
      timeoutSeconds: '60',
      apiKey: '',
    }
  }

  public render() {
    const {
      displayName,
      baseUrl,
      modelId,
      wireApi,
      authKind,
      timeoutSeconds,
      apiKey,
    } = this.state
    const baseUrlValid = isValidBYOKBaseUrl(baseUrl)
    const canSave = this.canSave()

    return (
      <Dialog
        id="add-openai-provider"
        title="Add OpenAI-compatible provider"
        onSubmit={this.handleSave}
        onDismissed={this.props.onCancel}
        backdropDismissable={true}
      >
        <DialogContent>
          <TextBox
            label="Display name"
            value={displayName}
            onValueChanged={this.handleDisplayNameChanged}
            placeholder="My GPT-4o"
          />
          <TextBox
            label="Base URL"
            value={baseUrl}
            onValueChanged={this.handleBaseUrlChanged}
            placeholder="https://api.openai.com/v1"
          />
          {!baseUrlValid && (
            <p className="error-hint">Must be https:// or http://localhost</p>
          )}
          <TextBox
            label="Model"
            value={modelId}
            onValueChanged={this.handleModelIdChanged}
            placeholder="gpt-4o"
          />
          <p className="hint-label">Wire API:</p>
          <Select value={wireApi} onChange={this.handleWireAPIChanged}>
            <option value="chat-completions">Chat completions</option>
            <option value="responses">Responses</option>
          </Select>
          <p className="hint-label">Auth:</p>
          <Select value={authKind} onChange={this.handleAuthKindChanged}>
            <option value="apiKey">API key</option>
            <option value="bearer">Bearer token</option>
            <option value="none">None (local)</option>
          </Select>
          {authKind !== 'none' && (
            <TextBox
              label="API key"
              value={apiKey}
              onValueChanged={this.handleApiKeyChanged}
              type="password"
            />
          )}
          <TextBox
            label="Timeout (seconds)"
            value={timeoutSeconds}
            onValueChanged={this.handleTimeoutChanged}
          />
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={!canSave}
            onCancelButtonClick={this.props.onCancel}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private canSave(): boolean {
    const { displayName, baseUrl, modelId } = this.state
    return (
      displayName.trim().length > 0 &&
      isValidBYOKBaseUrl(baseUrl) &&
      modelId.trim().length > 0
    )
  }

  private handleDisplayNameChanged = (displayName: string) => {
    this.setState({ displayName })
  }

  private handleBaseUrlChanged = (baseUrl: string) => {
    this.setState({ baseUrl })
  }

  private handleModelIdChanged = (modelId: string) => {
    this.setState({ modelId })
  }

  private handleApiKeyChanged = (apiKey: string) => {
    this.setState({ apiKey })
  }

  private handleWireAPIChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({
      wireApi: e.currentTarget.value as IAddOpenAIDialogState['wireApi'],
    })
  }

  private handleAuthKindChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({
      authKind: e.currentTarget.value as IAddOpenAIDialogState['authKind'],
    })
  }

  private handleTimeoutChanged = (timeoutSeconds: string) => {
    this.setState({ timeoutSeconds })
  }

  private handleSave = () => {
    if (!this.canSave()) {
      return
    }

    const {
      displayName,
      baseUrl,
      modelId,
      wireApi,
      authKind,
      timeoutSeconds,
      apiKey,
    } = this.state
    this.props.onSave(
      {
        id: crypto.randomUUID(),
        kind: 'openai-compat',
        displayName: displayName.trim(),
        enabled: true,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        wireApi,
        authKind,
        timeoutSeconds: clampTimeoutSeconds(timeoutSeconds),
      },
      authKind !== 'none' && apiKey.length > 0 ? apiKey : null
    )
  }
}
