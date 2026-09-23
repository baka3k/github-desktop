/**
 * Structure-aware diff trimming for the AI Summary feature.
 *
 * Every provider (Copilot SDK, dotcom endpoint, OpenAI-compat HTTP,
 * external CLI) receives the raw `git diff` text, and all of them fail
 * one way or another when the changeset is huge: the Copilot endpoint
 * and SDK reject prompts over the model's token limit, OpenAI-compat
 * APIs return 400/413, and CLI tools run out of context. Rather than
 * letting those surface as errors, the diff is trimmed here once, before
 * it reaches any provider.
 *
 * The strategy keeps the summary useful even when trimmed:
 * - Every file's header (`diff --git …`, mode changes, renames, `+++`/`---`)
 *   is always kept so the model sees the complete list of touched files.
 * - Per-file diff bodies are capped and cut at line boundaries with an
 *   explicit truncation marker.
 * - Lockfile bodies are dropped entirely (the system prompt already asks
 *   the model not to describe them).
 * - Files whose bodies no longer fit are recorded as omitted (per-file
 *   markers, then a count in the final note) instead of silently
 *   disappearing.
 */

/**
 * Character budget for the diff embedded in the commit-message prompt.
 * ~120k characters is roughly 30k tokens: comfortably below the context
 * of the smallest OpenAI-compatible models users are likely to configure
 * while leaving room for the system prompt and the response.
 */
export const MaxSummaryDiffChars = 120_000

/**
 * Upper bound for any single file's diff body so one huge generated or
 * vendored file can't consume the whole budget and starve every other
 * file out of the prompt.
 */
const MaxFileDiffChars = 20_000

/**
 * Below this allowance a file body is omitted outright instead of keeping
 * a uselessly thin sliver of it.
 */
const MinFileDiffChars = 200

/** Reserve for the overall truncation note appended to the prompt. */
const FinalNoteReserve = 300

/** Cap for the total characters spent on per-file omission markers. */
const MaxOmissionMarkerChars = 4_000

/** Marker appended when the output has to be cut without structure. */
const HardCutMarker = '[diff truncated]'

/**
 * Dependency-manager lockfiles whose diff bodies carry no useful signal
 * for a commit summary.
 */
const LockFilePathPattern =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|gradle\.lockfile|packages\.lock\.json|paket\.lock|Podfile\.lock|Cartfile\.resolved|flake\.lock)$/i

/** A per-file slice of a git diff. */
interface IDiffSection {
  /** Everything before the first hunk: `diff --git`, index, `+++`/`---`, etc. */
  readonly header: string
  /** The hunks. Empty for binary files and header-only outputs. */
  readonly body: string
  /** Best-effort path of the changed file, or null when it can't be parsed. */
  readonly path: string | null
}

/** The result of {@link trimDiffForSummary}. */
export interface ITrimmedDiff {
  /** The diff text to embed in the prompt. */
  readonly diff: string
  /** Whether any content was dropped relative to the input. */
  readonly truncated: boolean
}

/**
 * Splits a raw `git diff` output into its per-file sections. Content
 * before the first `diff --git` line (unified headers of merge diffs,
 * mode-summary lines) is returned as the preamble.
 */
function splitDiffIntoSections(diff: string): {
  preamble: string
  sections: ReadonlyArray<IDiffSection>
} {
  const lines = diff.split('\n')

  const sections = new Array<IDiffSection>()
  let preambleLines = new Array<string>()
  let currentLines: string[] | null = null

  const flush = () => {
    if (currentLines === null) {
      return
    }
    sections.push(toSection(currentLines))
    currentLines = null
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      currentLines = []
    }

    if (currentLines === null) {
      preambleLines.push(line)
    } else {
      currentLines.push(line)
    }
  }
  flush()

  // The split preserved the input's trailing newline as an empty last
  // element; drop it so joining doesn't grow the text.
  preambleLines = trimTrailingEmptyLines(preambleLines)

  return { preamble: preambleLines.join('\n'), sections }
}

/** Converts the raw lines of one `diff --git` block into an {@link IDiffSection}. */
function toSection(lines: ReadonlyArray<string>): IDiffSection {
  const hunkStart = lines.findIndex(line => line.startsWith('@@'))
  const isBinary = lines.some(
    line =>
      line.startsWith('Binary files ') || line.startsWith('GIT binary patch')
  )

  const headerLines =
    hunkStart === -1 || isBinary ? lines : lines.slice(0, hunkStart)
  const bodyLines = hunkStart === -1 || isBinary ? [] : lines.slice(hunkStart)

  return {
    header: trimTrailingEmptyLines(headerLines).join('\n'),
    body: trimTrailingEmptyLines(bodyLines).join('\n'),
    path: extractSectionPath(headerLines),
  }
}

/** Removes empty lines at the end of a line array (artifacts of splitting). */
function trimTrailingEmptyLines(lines: ReadonlyArray<string>): string[] {
  const copy = [...lines]
  while (copy.length > 0 && copy[copy.length - 1] === '') {
    copy.pop()
  }
  return copy
}

/** Extracts the changed file's path from a section header, best effort. */
function extractSectionPath(headerLines: ReadonlyArray<string>): string | null {
  const plusLine = headerLines.find(line => line.startsWith('+++ '))
  if (plusLine !== undefined) {
    const path = plusLine.slice(4).trim()
    if (path !== '/dev/null' && path.length > 0) {
      return path.replace(/^b\//, '')
    }
  }

  const diffLine = headerLines.find(line => line.startsWith('diff --git '))
  if (diffLine !== undefined) {
    const match = / b\/(.+)$/.exec(diffLine)
    if (match) {
      return match[1]
    }
  }

  return null
}

/** Cuts a string at the last newline within `maxChars`, if any. */
function cutAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  const cut = text.lastIndexOf('\n', maxChars)
  return cut <= 0 ? '' : text.slice(0, cut)
}

/** Counts the lines dropped by {@link cutAtLineBoundary}. */
function countDroppedLines(body: string, kept: string): number {
  return body.slice(kept.length).split('\n').length - 1
}

/** Joins diff parts back together with single newlines between them. */
function joinParts(parts: ReadonlyArray<string>): string {
  return parts.filter(p => p.length > 0).join('\n')
}

/**
 * Trims a raw git diff so it fits into {@link MaxSummaryDiffChars} (or a
 * caller-supplied budget) while keeping the overall shape of the
 * changeset visible to the model. Small diffs pass through unchanged.
 *
 * Exported for testing.
 */
export function trimDiffForSummary(
  diff: string,
  maxChars: number = MaxSummaryDiffChars
): ITrimmedDiff {
  if (diff.length <= maxChars) {
    return { diff, truncated: false }
  }

  const { preamble, sections } = splitDiffIntoSections(diff)

  const headersText = joinParts([preamble, ...sections.map(s => s.header)])

  // Headers alone don't fit: keep as many whole headers as the budget
  // allows so the model still sees (most of) the file list.
  if (headersText.length + FinalNoteReserve >= maxChars) {
    const output =
      cutAtLineBoundary(headersText, maxChars - HardCutMarker.length - 1) +
      '\n' +
      HardCutMarker
    return { diff: output, truncated: true }
  }

  // Reserve a slice of the remaining budget for per-file omission markers
  // so "this file was dropped" information survives the trim.
  const omissionReserve = Math.min(
    MaxOmissionMarkerChars,
    Math.floor((maxChars - headersText.length - FinalNoteReserve) * 0.1)
  )
  const bodyBudget =
    maxChars - headersText.length - omissionReserve - FinalNoteReserve

  const parts = new Array<string>()
  let bodyLeft = bodyBudget
  let markerLeft = omissionReserve
  let omittedBeyondMarkers = 0
  let truncated = false

  for (const section of sections) {
    parts.push(section.header)

    if (section.body.length === 0) {
      // Binary files (and anything without hunks) are header-only already.
      continue
    }

    const isLockFile =
      section.path !== null && LockFilePathPattern.test(section.path)
    const allowance = Math.min(MaxFileDiffChars, bodyLeft)

    if (isLockFile || allowance < MinFileDiffChars) {
      truncated = true
      const marker = `[diff for "${section.path ?? 'unknown'}" omitted]`
      if (marker.length + 1 <= markerLeft) {
        parts.push(marker)
        markerLeft -= marker.length + 1
      } else {
        omittedBeyondMarkers++
      }
      continue
    }

    if (section.body.length <= allowance) {
      parts.push(section.body)
      bodyLeft -= section.body.length + 1
      continue
    }

    const keptBody = cutAtLineBoundary(section.body, allowance)
    const dropped = countDroppedLines(section.body, keptBody)
    parts.push(
      `${keptBody}\n[... ${dropped} more lines truncated for "${
        section.path ?? 'unknown'
      }" ...]`
    )
    bodyLeft -= keptBody.length + 1
    truncated = true
  }

  if (truncated || omittedBeyondMarkers > 0) {
    let note = `[NOTE: The original diff was ${diff.length} characters and exceeded the context budget, so it was truncated. Files may be shown partially or omitted entirely; summarize from what is visible.]`
    if (omittedBeyondMarkers > 0) {
      note += ` The diffs of ${omittedBeyondMarkers} more files were omitted.`
    }
    parts.push(note)
  }

  let output = joinParts(parts)

  // Per-file cut markers ride along with their bodies and aren't counted
  // against the budget; this safety net guarantees the final size.
  if (output.length > maxChars) {
    output =
      cutAtLineBoundary(output, maxChars - HardCutMarker.length - 1) +
      '\n' +
      HardCutMarker
  }

  return { diff: output, truncated: true }
}
