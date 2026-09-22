import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { Button } from '../../lib/button'
import { TextBox } from '../../lib/text-box'
import { Select } from '../../lib/select'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { QuickPickCLI } from '../../../lib/ai-summary/quick-pick-cli'
import type {
  IExternalCLIProviderConfig,
  IQuickPickCLI,
} from '../../../lib/ai-summary'

interface IAddCLIDialogProps {
  readonly onCancel: () => void
  readonly onSave: (
    provider: IExternalCLIProviderConfig,
    secret: string | null
  ) => void
}

interface IAddCLIDialogState {
  readonly displayName: string
  readonly executable: string
  readonly extraArgsStr: string
  readonly timeoutSeconds: string
  readonly workingDirMode: 'repository' | 'home'
  readonly apiKeyEnvVar: string
  readonly apiKey: string
  readonly acknowledged: boolean
  readonly installHint: string | null
}

/** Clamp user-entered timeouts into a safe 1–600s range. */
function clampTimeoutSeconds(raw: string): number {
  return Math.max(1, Math.min(600, Math.round(Number(raw) || 60)))
}

/** Dialog for adding an external CLI provider (quick picks or manual). */
export class AddCLIDialog extends React.Component<
  IAddCLIDialogProps,
  IAddCLIDialogState
> {
  public constructor(props: IAddCLIDialogProps) {
    super(props)
    this.state = {
      displayName: '',
      executable: '',
      extraArgsStr: '--mode commit-summary',
      timeoutSeconds: '60',
      workingDirMode: 'home',
      apiKeyEnvVar: '',
      apiKey: '',
      acknowledged: false,
      installHint: null,
    }
  }

  public render() {
    const {
      displayName,
      executable,
      extraArgsStr,
      timeoutSeconds,
      workingDirMode,
      apiKeyEnvVar,
      apiKey,
      acknowledged,
      installHint,
    } = this.state
    const canSave = this.canSave()

    return (
      <Dialog
        id="add-cli-provider"
        title="Add external CLI provider"
        onSubmit={this.handleSave}
        onDismissed={this.props.onCancel}
        backdropDismissable={true}
      >
        <DialogContent>
          <p className="quick-pick-label">Quick pick:</p>
          <div className="quick-pick-row">
            {QuickPickCLI.map(q => (
              <Button key={q.id} onClick={this.makeQuickPickHandler(q)}>
                {q.displayName}
              </Button>
            ))}
            <Button onClick={this.handleCustom}>Custom…</Button>
          </div>
          <TextBox
            label="Display name"
            value={displayName}
            onValueChanged={this.handleDisplayNameChanged}
            placeholder="claudecode"
          />
          <TextBox
            label="Executable"
            value={executable}
            onValueChanged={this.handleExecutableChanged}
            placeholder="claudecode"
          />
          <TextBox
            label="Extra args"
            value={extraArgsStr}
            onValueChanged={this.handleExtraArgsChanged}
          />
          <TextBox
            label="Timeout (seconds)"
            value={timeoutSeconds}
            onValueChanged={this.handleTimeoutChanged}
          />
          <p className="hint-label">Working directory:</p>
          <Select
            value={workingDirMode}
            onChange={this.handleWorkingDirChanged}
          >
            <option value="repository">Repository</option>
            <option value="home">Home</option>
          </Select>
          <TextBox
            label="API key env variable (optional)"
            value={apiKeyEnvVar}
            onValueChanged={this.handleApiKeyEnvVarChanged}
            placeholder="ANTHROPIC_API_KEY"
          />
          {apiKeyEnvVar.length > 0 && (
            <TextBox
              label={`API key for ${apiKeyEnvVar}`}
              value={apiKey}
              onValueChanged={this.handleApiKeyChanged}
              type="password"
            />
          )}
          {installHint !== null && (
            <p className="install-hint">
              💡 Install via <code>{installHint}</code>
            </p>
          )}
          <div className="disclaimer-row">
            <Checkbox
              label="I understand that this CLI will receive my staged diff and may send it to a remote service. I trust this provider."
              value={acknowledged ? CheckboxValue.On : CheckboxValue.Off}
              onChange={this.handleAcknowledgedChanged}
            />
          </div>
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
    const { displayName, executable, acknowledged } = this.state
    return (
      acknowledged &&
      displayName.trim().length > 0 &&
      executable.trim().length > 0
    )
  }

  private makeQuickPickHandler = (q: IQuickPickCLI) => {
    return () => {
      this.setState({
        displayName: q.displayName,
        executable: q.executable,
        extraArgsStr: q.extraArgs.join(' '),
        apiKeyEnvVar: q.apiKeyEnvVar ?? '',
        installHint: q.installHint,
      })
    }
  }

  private handleCustom = () => {
    this.setState({
      displayName: '',
      executable: '',
      extraArgsStr: '',
      apiKeyEnvVar: '',
      installHint: null,
    })
  }

  private handleDisplayNameChanged = (displayName: string) => {
    this.setState({ displayName })
  }

  private handleExecutableChanged = (executable: string) => {
    this.setState({ executable })
  }

  private handleExtraArgsChanged = (extraArgsStr: string) => {
    this.setState({ extraArgsStr })
  }

  private handleTimeoutChanged = (timeoutSeconds: string) => {
    this.setState({ timeoutSeconds })
  }

  private handleWorkingDirChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({
      workingDirMode: e.currentTarget
        .value as IAddCLIDialogState['workingDirMode'],
    })
  }

  private handleApiKeyEnvVarChanged = (apiKeyEnvVar: string) => {
    this.setState({ apiKeyEnvVar })
  }

  private handleApiKeyChanged = (apiKey: string) => {
    this.setState({ apiKey })
  }

  private handleAcknowledgedChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({ acknowledged: (e.target as HTMLInputElement).checked })
  }

  private handleSave = () => {
    if (!this.canSave()) {
      return
    }

    const {
      displayName,
      executable,
      extraArgsStr,
      timeoutSeconds,
      workingDirMode,
      apiKeyEnvVar,
      apiKey,
    } = this.state
    this.props.onSave(
      {
        id: crypto.randomUUID(),
        kind: 'external-cli',
        displayName: displayName.trim(),
        enabled: true,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        executable: executable.trim(),
        extraArgs: extraArgsStr.split(/\s+/).filter(a => a.length > 0),
        timeoutSeconds: clampTimeoutSeconds(timeoutSeconds),
        workingDirMode,
        apiKeyEnvVar:
          apiKeyEnvVar.trim().length > 0 ? apiKeyEnvVar.trim() : null,
      },
      apiKey.length > 0 ? apiKey : null
    )
  }
}
