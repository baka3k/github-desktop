import { isValidBYOKBaseUrl } from '../copilot/byok'
import type { IAISummaryProviderConfig, IAISummaryConfig } from './config'

export class AISummaryConfigParseError extends Error {
  public readonly field: string
  public constructor(field: string, message: string) {
    super(message)
    this.name = 'AISummaryConfigParseError'
    this.field = field
  }
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new AISummaryConfigParseError(
      field,
      `Expected non-empty string for "${field}"`
    )
  }
  return v
}

function parseNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AISummaryConfigParseError(
      field,
      `Expected finite number for "${field}"`
    )
  }
  return v
}

function parseNullableNumber(v: unknown, field: string): number | null {
  return v === null ? null : parseNumber(v, field)
}

function parseBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') {
    throw new AISummaryConfigParseError(
      field,
      `Expected boolean for "${field}"`
    )
  }
  return v
}

function parseNullableString(v: unknown, field: string): string | null {
  return v === null ? null : parseString(v, field)
}

function parseLastTestStatus(v: unknown, field: string): 'ok' | 'error' | null {
  if (v === null) {
    return null
  }
  if (v !== 'ok' && v !== 'error') {
    throw new AISummaryConfigParseError(
      field,
      `Expected 'ok' | 'error' | null for "${field}"`
    )
  }
  return v
}

function parseStringArray(v: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(v)) {
    throw new AISummaryConfigParseError(
      field,
      `Expected array of strings for "${field}"`
    )
  }
  return v.map((entry, idx) => parseString(entry, `${field}[${idx}]`))
}

function parseBase(record: Readonly<Record<string, unknown>>) {
  const id = parseString(record.id, 'id')
  const displayName = parseString(record.displayName, 'displayName')
  const kind = record.kind
  if (
    kind !== 'copilot' &&
    kind !== 'openai-compat' &&
    kind !== 'external-cli'
  ) {
    throw new AISummaryConfigParseError(
      'kind',
      `Unsupported kind: ${String(kind)}`
    )
  }
  return {
    id,
    displayName,
    kind,
    enabled: parseBoolean(record.enabled, 'enabled'),
    lastTestedAt: parseNullableNumber(record.lastTestedAt, 'lastTestedAt'),
    lastTestStatus: parseLastTestStatus(
      record.lastTestStatus,
      'lastTestStatus'
    ),
    lastTestError: parseNullableString(record.lastTestError, 'lastTestError'),
    createdAt: parseNumber(record.createdAt, 'createdAt'),
    updatedAt: parseNumber(record.updatedAt, 'updatedAt'),
  }
}

function parseCopilot(
  record: Readonly<Record<string, unknown>>
): IAISummaryProviderConfig {
  const base = parseBase(record)
  if (base.kind !== 'copilot') {
    throw new AISummaryConfigParseError('kind', `Expected 'copilot'`)
  }
  return {
    ...base,
    kind: 'copilot',
    modelId: parseNullableString(record.modelId, 'modelId'),
  }
}

function parseOpenAICompat(
  record: Readonly<Record<string, unknown>>
): IAISummaryProviderConfig {
  const base = parseBase(record)
  if (base.kind !== 'openai-compat') {
    throw new AISummaryConfigParseError('kind', `Expected 'openai-compat'`)
  }
  const baseUrl = parseString(record.baseUrl, 'baseUrl')
  if (!isValidBYOKBaseUrl(baseUrl)) {
    throw new AISummaryConfigParseError(
      'baseUrl',
      `baseUrl "${baseUrl}" is not allowed`
    )
  }
  const wireApi = record.wireApi
  if (wireApi !== 'chat-completions' && wireApi !== 'responses') {
    throw new AISummaryConfigParseError(
      'wireApi',
      `Expected 'chat-completions' | 'responses'`
    )
  }
  const authKind = record.authKind
  if (authKind !== 'apiKey' && authKind !== 'bearer' && authKind !== 'none') {
    throw new AISummaryConfigParseError(
      'authKind',
      `Expected 'apiKey' | 'bearer' | 'none'`
    )
  }
  const timeoutSeconds = parseNumber(record.timeoutSeconds, 'timeoutSeconds')
  if (timeoutSeconds <= 0) {
    throw new AISummaryConfigParseError(
      'timeoutSeconds',
      `timeoutSeconds must be > 0`
    )
  }
  return {
    ...base,
    kind: 'openai-compat',
    baseUrl,
    modelId: parseString(record.modelId, 'modelId'),
    wireApi,
    authKind,
    timeoutSeconds,
  }
}

function parseExternalCLI(
  record: Readonly<Record<string, unknown>>
): IAISummaryProviderConfig {
  const base = parseBase(record)
  if (base.kind !== 'external-cli') {
    throw new AISummaryConfigParseError('kind', `Expected 'external-cli'`)
  }
  const executable = parseString(record.executable, 'executable')
  const extraArgs = parseStringArray(record.extraArgs ?? [], 'extraArgs')
  const timeoutSeconds = parseNumber(record.timeoutSeconds, 'timeoutSeconds')
  if (timeoutSeconds <= 0) {
    throw new AISummaryConfigParseError(
      'timeoutSeconds',
      `timeoutSeconds must be > 0`
    )
  }
  const workingDirMode = record.workingDirMode
  if (workingDirMode !== 'repository' && workingDirMode !== 'home') {
    throw new AISummaryConfigParseError(
      'workingDirMode',
      `Expected 'repository' | 'home'`
    )
  }
  return {
    ...base,
    kind: 'external-cli',
    executable,
    extraArgs,
    timeoutSeconds,
    workingDirMode,
    apiKeyEnvVar: parseNullableString(record.apiKeyEnvVar, 'apiKeyEnvVar'),
  }
}

export function parseAIProviderConfig(
  value: unknown
): IAISummaryProviderConfig {
  if (!isRecord(value)) {
    throw new AISummaryConfigParseError(
      'root',
      `Provider config must be an object`
    )
  }
  switch (value.kind) {
    case 'copilot':
      return parseCopilot(value)
    case 'openai-compat':
      return parseOpenAICompat(value)
    case 'external-cli':
      return parseExternalCLI(value)
    default:
      throw new AISummaryConfigParseError(
        'kind',
        `Unsupported kind: ${String(value.kind)}`
      )
  }
}

export function parseAIProvidersConfig(
  value: unknown
): ReadonlyArray<IAISummaryProviderConfig> {
  if (!Array.isArray(value)) {
    throw new AISummaryConfigParseError('providers', `Expected array`)
  }
  const seen = new Set<string>()
  const out: IAISummaryProviderConfig[] = []
  for (const [idx, entry] of value.entries()) {
    const parsed = parseAIProviderConfig(entry)
    if (seen.has(parsed.id)) {
      throw new AISummaryConfigParseError(
        `providers[${idx}].id`,
        `Duplicate id "${parsed.id}"`
      )
    }
    seen.add(parsed.id)
    out.push(parsed)
  }
  return out
}

export function parseAISummaryConfig(value: unknown): IAISummaryConfig {
  if (!isRecord(value)) {
    throw new AISummaryConfigParseError('root', `Config must be an object`)
  }
  return {
    activeProviderId: parseNullableString(
      value.activeProviderId,
      'activeProviderId'
    ),
    providers: parseAIProvidersConfig(value.providers ?? []),
  }
}

export function parseAISummaryConfigOrNull(
  raw: string | null
): IAISummaryConfig | null {
  if (raw === null) {
    return null
  }
  try {
    return parseAISummaryConfig(JSON.parse(raw))
  } catch {
    return null
  }
}
