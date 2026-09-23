export { CopilotDefaultProviderId, getDefaultAISummaryConfig } from './config'
export type {
  AISummaryProviderKind,
  IAISummaryProviderConfig,
  IAISummaryProviderConfigBase,
  ICopilotProviderConfig,
  IOpenAICompatProviderConfig,
  IExternalCLIProviderConfig,
  IAISummaryConfig,
} from './config'
export {
  AISummaryConfigParseError,
  parseAIProviderConfig,
  parseAIProvidersConfig,
  parseAISummaryConfig,
  parseAISummaryConfigOrNull,
} from './parse'
export {
  hasAnyUsableAIProvider,
  isProviderAvailable,
  resolveProviderForRepository,
} from './resolve'
export type {
  IAISummaryRepositoryContext,
  IAISummaryResolutionState,
} from './resolve'
export type {
  AISummaryResult,
  IAISummaryProvider,
  IAIProviderGenerateArgs,
  AIProviderErrorCode,
  AIProviderIPCResult,
} from './provider'
export {
  AIProviderTokenStoreKey,
  deleteAISummaryProviderSecret,
  getAISummaryProviderSecret,
  setAISummaryProviderSecret,
} from './secrets'
export { CopilotSummaryProvider } from './copilot-provider'
export { ExternalCLIProvider, toAISummaryResult } from './external-cli-provider'
export { OpenAICompatProvider } from './openai-compat-provider'
export { AISummaryService } from './service'
export type { IAISummaryServiceDeps } from './service'
export { QuickPickCLI } from './quick-pick-cli'
export type { IQuickPickCLI } from './quick-pick-cli'
