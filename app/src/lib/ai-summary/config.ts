/** AI Summary provider configuration model + defaults. */

export type AISummaryProviderKind = 'copilot' | 'openai-compat' | 'external-cli'

export interface IAISummaryProviderConfigBase {
  readonly id: string
  readonly displayName: string
  readonly kind: AISummaryProviderKind
  readonly enabled: boolean
  readonly lastTestedAt: number | null
  readonly lastTestStatus: 'ok' | 'error' | null
  readonly lastTestError: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ICopilotProviderConfig extends IAISummaryProviderConfigBase {
  readonly kind: 'copilot'
  readonly modelId: string | null
}

export interface IOpenAICompatProviderConfig
  extends IAISummaryProviderConfigBase {
  readonly kind: 'openai-compat'
  readonly baseUrl: string
  readonly modelId: string
  readonly wireApi: 'chat-completions' | 'responses'
  readonly authKind: 'apiKey' | 'bearer' | 'none'
  readonly timeoutSeconds: number
}

export interface IExternalCLIProviderConfig
  extends IAISummaryProviderConfigBase {
  readonly kind: 'external-cli'
  readonly executable: string
  readonly extraArgs: ReadonlyArray<string>
  readonly timeoutSeconds: number
  readonly workingDirMode: 'repository' | 'home'
  readonly apiKeyEnvVar: string | null
}

export type IAISummaryProviderConfig =
  | ICopilotProviderConfig
  | IOpenAICompatProviderConfig
  | IExternalCLIProviderConfig

export interface IAISummaryConfig {
  readonly activeProviderId: string | null
  readonly providers: ReadonlyArray<IAISummaryProviderConfig>
}

export const CopilotDefaultProviderId = 'copilot-default'

export function getDefaultAISummaryConfig(): IAISummaryConfig {
  const now = Date.now()
  return {
    activeProviderId: CopilotDefaultProviderId,
    providers: [
      {
        id: CopilotDefaultProviderId,
        kind: 'copilot',
        displayName: 'GitHub Copilot',
        enabled: true,
        modelId: null,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}
