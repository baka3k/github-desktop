import * as path from 'path'

const ShellMetachars = /[;&|`$()<>\n\r\\]/

export function containsShellMetachar(value: string): boolean {
  return ShellMetachars.test(value)
}

export function validateShellSafeArgv(
  executable: string,
  extraArgs: ReadonlyArray<string>
): boolean {
  if (containsShellMetachar(executable)) {
    return false
  }
  for (const arg of extraArgs) {
    if (containsShellMetachar(arg)) {
      return false
    }
  }
  return true
}

export function redactSecrets(input: string): string {
  if (!input) {
    return input
  }
  return (
    input
      .replace(/(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***')
      .replace(/(sk_live_[A-Za-z0-9_-]{8,})/g, 'sk_live_***')
      // Credential-bearing headers and assignments ("Authorization: Basic
      // xyz", "x-api-key: secret", "ANTHROPIC_API_KEY=sk-…") — must run
      // before the generic Bearer rule so the whole value is covered.
      .replace(/((?:proxy-)?authorization\s*[:=]\s*)[^\n\r]*/gi, '$1***')
      .replace(/((?:x-)?api[-_]?key\s*[:=]\s*)[^\n\r]*/gi, '$1***')
      .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, '$1***')
      .replace(/([A-Fa-f0-9]{64,})/g, '***')
  )
}

const ResolveCache = new Map<string, { path: string | null; expires: number }>()
const ResolveTtlMs = 60_000

export async function resolveExecutable(
  name: string,
  lookupPath: string = process.env.PATH || ''
): Promise<string | null> {
  if (!name || name.includes('..')) {
    return null
  }
  if (path.isAbsolute(name)) {
    return name
  }
  const cached = ResolveCache.get(name)
  if (cached && cached.expires > Date.now()) {
    return cached.path
  }
  const resolved = await lookupOnPath(name, lookupPath)
  ResolveCache.set(name, {
    path: resolved,
    expires: Date.now() + ResolveTtlMs,
  })
  return resolved
}

async function lookupOnPath(
  name: string,
  lookupPath: string
): Promise<string | null> {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']
  const dirs = lookupPath.split(process.platform === 'win32' ? ';' : ':')
  for (const dir of dirs) {
    if (!dir) {
      continue
    }
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        const fs = await import('fs/promises')
        const stat = await fs.stat(candidate).catch(() => null)
        if (stat && stat.isFile()) {
          return candidate
        }
      } catch {
        // Continue.
      }
    }
  }
  return null
}

export function _clearResolveExecutableCache(): void {
  ResolveCache.clear()
}
