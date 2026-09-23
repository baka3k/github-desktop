import type { ICopilotCommitMessage } from '../copilot-commit-message'
import type { AISummaryProviderKind } from './config'
import type { IRepoRulesMetadataRule } from '../../models/repo-rules'

export interface IAIProviderGenerateArgs {
  readonly diff: string
  readonly rules: ReadonlyArray<IRepoRulesMetadataRule>
  readonly signal: AbortSignal
  readonly repositoryPath: string
}

export type AISummaryResult =
  | { readonly kind: 'ok'; readonly value: ICopilotCommitMessage }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'error'
      readonly code: string
      readonly userMessage: string
    }

export interface IAISummaryProvider {
  readonly kind: AISummaryProviderKind
  test(): Promise<AISummaryResult>
  generate(args: IAIProviderGenerateArgs): Promise<AISummaryResult>
}

export type AIProviderErrorCode =
  | 'executable-not-found'
  | 'permission-denied'
  | 'spawn-failed'
  | 'timeout'
  | 'non-zero-exit'
  | 'stdout-too-large'
  | 'invalid-output'
  | 'cancelled'
  | 'invalid-config'
  | 'missing-credential'
  | 'network-error'
  | 'http-error'
  | 'unknown'

export type AIProviderIPCResult =
  | {
      readonly kind: 'ok'
      readonly title: string
      readonly description: string
    }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'error'
      readonly code: AIProviderErrorCode
      readonly userMessage: string
      readonly developerMessage?: string
    }
