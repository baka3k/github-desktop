import type { IRepoRulesMetadataRule } from '../../models/repo-rules'
import type { IOpenAICompatProviderConfig } from '../../lib/ai-summary/config'
import {
  buildCommitMessageSystemPrompt,
  buildCommitMessageUserPrompt,
  generateCommitMessagePromptTags,
  getCleanedEnforcedRuleDescriptions,
} from '../../lib/ai-summary/commit-message-prompt'
import { parseCopilotCommitMessage } from '../../lib/copilot-commit-message'
import { getAISummaryProviderSecret } from '../../lib/ai-summary/secrets'
import { isValidBYOKBaseUrl } from '../../lib/copilot/byok'
import { redactSecrets } from './security'
import type { AIProviderIPCResult } from '../../lib/ai-summary/provider'

/** Upper bound for how much of a provider response body we are willing to read. */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * Accepts both `https://host` and `https://host/v1` style base URLs —
 * a trailing `/v1` is stripped so the versioned request path below is
 * never doubled.
 */
function providerUrl(baseUrl: string, path: 'responses' | 'chat/completions') {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${base}/v1/${path}`
}

/**
 * Reads the response body with a hard size cap so a hostile endpoint
 * cannot stream unbounded bytes into the main process.
 */
async function readBodyWithCap(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    return ''
  }
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    text += decoder.decode(value, { stream: true })
    if (text.length > MAX_BODY_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      break
    }
  }
  return text
}

interface IRunOpenAIArgs {
  readonly config: IOpenAICompatProviderConfig
  readonly diff: string
  readonly rules: ReadonlyArray<IRepoRulesMetadataRule>
  readonly repositoryPath: string
  readonly signal: AbortSignal | undefined
}

interface IRunOpenAITestArgs {
  readonly config: IOpenAICompatProviderConfig
}

export async function runOpenAICompatSummary(
  args: IRunOpenAIArgs
): Promise<AIProviderIPCResult> {
  const { config, diff, signal } = args
  if (!isValidBYOKBaseUrl(config.baseUrl)) {
    return {
      kind: 'error',
      code: 'invalid-config',
      userMessage: `baseUrl "${config.baseUrl}" is not allowed.`,
    }
  }
  let secret: string | null = null
  if (config.authKind !== 'none') {
    secret = await getAISummaryProviderSecret(config.id)
    if (!secret) {
      return {
        kind: 'error',
        code: 'missing-credential',
        userMessage: 'API key not set.',
      }
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (config.authKind === 'apiKey' || config.authKind === 'bearer') {
    headers.Authorization = `Bearer ${secret}`
  }
  const url = providerUrl(
    config.baseUrl,
    config.wireApi === 'responses' ? 'responses' : 'chat/completions'
  )

  const tags = generateCommitMessagePromptTags()
  const cleanedRules = getCleanedEnforcedRuleDescriptions(args.rules)
  const systemPrompt = buildCommitMessageSystemPrompt(
    cleanedRules.length > 0,
    tags
  )
  const userPrompt = buildCommitMessageUserPrompt(diff, tags, cleanedRules)

  const body =
    config.wireApi === 'responses'
      ? {
          model: config.modelId,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }
      : {
          model: config.modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 512,
        }

  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = (config.timeoutSeconds ?? 60) * 1000
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    let response: Response
    let bodyText = ''
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      // Keep the deadline armed until the body has been consumed so a
      // stalling endpoint cannot hang the run past the timeout.
      bodyText = await readBodyWithCap(response)
    } catch (e) {
      if (timedOut) {
        return {
          kind: 'error',
          code: 'timeout',
          userMessage: 'Provider did not respond in time.',
        }
      }
      if (signal?.aborted) {
        return { kind: 'cancelled' }
      }
      return {
        kind: 'error',
        code: 'network-error',
        userMessage: redactSecrets(
          e instanceof Error ? e.message : 'Network error contacting provider.'
        ),
      }
    }

    if (!response.ok) {
      return {
        kind: 'error',
        code: 'http-error',
        userMessage: `Provider returned ${response.status}: ${redactSecrets(
          bodyText
        ).slice(0, 300)}`,
      }
    }

    let json: unknown
    try {
      json = JSON.parse(bodyText)
    } catch (e) {
      return {
        kind: 'error',
        code: 'invalid-output',
        userMessage:
          e instanceof Error ? e.message : 'Could not parse JSON response.',
      }
    }

    const content = extractAssistantContent(json, config.wireApi)
    if (content === null) {
      return {
        kind: 'error',
        code: 'invalid-output',
        userMessage: 'Provider response did not include any assistant content.',
      }
    }

    try {
      const parsed = parseCopilotCommitMessage(content)
      return {
        kind: 'ok',
        title: parsed.title,
        description: parsed.description,
      }
    } catch (e) {
      return {
        kind: 'error',
        code: 'invalid-output',
        userMessage:
          e instanceof Error ? e.message : 'Could not parse commit message.',
      }
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

export async function runOpenAICompatTest(
  args: IRunOpenAITestArgs
): Promise<AIProviderIPCResult> {
  const { config } = args
  if (!isValidBYOKBaseUrl(config.baseUrl)) {
    return {
      kind: 'error',
      code: 'invalid-config',
      userMessage: `baseUrl "${config.baseUrl}" is not allowed.`,
    }
  }
  let secret: string | null = null
  if (config.authKind !== 'none') {
    secret = await getAISummaryProviderSecret(config.id)
    if (!secret) {
      return {
        kind: 'error',
        code: 'missing-credential',
        userMessage: 'API key not set.',
      }
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (config.authKind === 'apiKey' || config.authKind === 'bearer') {
    headers.Authorization = `Bearer ${secret}`
  }
  const url = providerUrl(
    config.baseUrl,
    config.wireApi === 'responses' ? 'responses' : 'chat/completions'
  )

  const body =
    config.wireApi === 'responses'
      ? {
          model: config.modelId,
          input: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        }
      : {
          model: config.modelId,
          messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
          temperature: 0,
          max_tokens: 8,
        }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    let responseObj: Response
    let bodyText = ''
    try {
      responseObj = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      bodyText = await readBodyWithCap(responseObj)
    } catch (e) {
      return {
        kind: 'error',
        code: 'network-error',
        userMessage: redactSecrets(
          e instanceof Error ? e.message : 'Network error contacting provider.'
        ),
      }
    }

    if (!responseObj.ok) {
      return {
        kind: 'error',
        code: 'http-error',
        userMessage: `Provider returned ${responseObj.status}.`,
      }
    }

    let json: unknown
    try {
      json = JSON.parse(bodyText)
    } catch {
      return {
        kind: 'error',
        code: 'invalid-output',
        userMessage: 'Could not parse JSON response.',
      }
    }

    const content = extractAssistantContent(json, config.wireApi)
    if (content === null || !content.includes('PONG')) {
      return {
        kind: 'error',
        code: 'invalid-output',
        userMessage: `Expected the provider to respond with "PONG".`,
      }
    }
    return { kind: 'ok', title: 'PONG', description: '' }
  } finally {
    clearTimeout(timer)
  }
}

function extractAssistantContent(
  json: unknown,
  wireApi: 'chat-completions' | 'responses'
): string | null {
  if (!json || typeof json !== 'object') {
    return null
  }
  const obj = json as Record<string, unknown>
  if (wireApi === 'chat-completions') {
    const choices = obj.choices
    if (!Array.isArray(choices) || choices.length === 0) {
      return null
    }
    const first = choices[0]
    if (!first || typeof first !== 'object') {
      return null
    }
    const message = (first as Record<string, unknown>).message
    if (!message || typeof message !== 'object') {
      return null
    }
    const content = (message as Record<string, unknown>).content
    return typeof content === 'string' ? content : null
  }
  const output = obj.output
  if (!Array.isArray(output)) {
    return null
  }
  for (const entry of output) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const e = entry as Record<string, unknown>
    if (e.type !== 'message') {
      continue
    }
    const content = e.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as Record<string, unknown>).type === 'output_text'
      ) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string') {
          return text
        }
      }
    }
  }
  return null
}
