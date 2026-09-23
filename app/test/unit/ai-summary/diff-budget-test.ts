import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  MaxSummaryDiffChars,
  trimDiffForSummary,
} from '../../../src/lib/ai-summary/diff-budget'

/** Builds a synthetic per-file diff section for a text file. */
function fileDiff(path: string, lineCount: number): string {
  const header =
    `diff --git a/${path} b/${path}\n` +
    `index 0000000..1111111 100644\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n`
  const hunk = [`@@ -1,${lineCount} +1,${lineCount} @@`]
  for (let i = 0; i < lineCount; i++) {
    hunk.push(`+line ${i} of ${path}`)
  }
  return header + hunk.join('\n') + '\n'
}

function manyFileDiff(fileCount: number, linesPerFile: number): string {
  let diff = ''
  for (let i = 0; i < fileCount; i++) {
    diff += fileDiff(`src/file-${i}.ts`, linesPerFile)
  }
  return diff
}

describe('trimDiffForSummary', () => {
  it('passes small diffs through unchanged', () => {
    const diff = fileDiff('src/a.ts', 5)
    const result = trimDiffForSummary(diff)

    assert.equal(result.truncated, false)
    assert.equal(result.diff, diff)
  })

  it('keeps every file header and fits the budget', () => {
    const diff = manyFileDiff(20, 500)
    const result = trimDiffForSummary(diff, 4_000)

    assert.equal(result.truncated, true)
    assert.ok(result.diff.length <= 4_000)

    for (let i = 0; i < 20; i++) {
      assert.ok(
        result.diff.includes(
          `diff --git a/src/file-${i}.ts b/src/file-${i}.ts`
        ),
        `header for file-${i}.ts must survive trimming`
      )
      assert.ok(result.diff.includes(`+++ b/src/file-${i}.ts`))
    }

    assert.ok(result.diff.includes('[NOTE:'))
  })

  it('cuts a single huge file at a line boundary', () => {
    const diff = fileDiff('src/huge.ts', 5_000)
    const result = trimDiffForSummary(diff, 2_000)

    assert.equal(result.truncated, true)
    assert.ok(result.diff.length <= 2_000)
    assert.ok(result.diff.includes('+++ b/src/huge.ts'))
    assert.ok(result.diff.includes('more lines truncated for "src/huge.ts"'))
    // The kept body must not end mid-line.
    const kept = result.diff.split('\n[... ')[0]
    const lastLine = kept.split('\n').pop() ?? ''
    assert.ok(
      lastLine.startsWith('+') || lastLine.startsWith('@@'),
      `unexpected partial line: ${lastLine}`
    )
  })

  it('drops lockfile bodies but keeps their headers', () => {
    const diff = fileDiff('package-lock.json', 2_000) + fileDiff('src/a.ts', 5)
    const result = trimDiffForSummary(diff, 2_000)

    assert.ok(result.diff.includes('+++ b/package-lock.json'))
    assert.ok(result.diff.includes('[diff for "package-lock.json" omitted]'))
    assert.ok(result.diff.includes('+++ b/src/a.ts'))
    assert.ok(!result.diff.includes('+line 10 of package-lock.json'))
  })

  it('marks files omitted entirely once the budget is spent', () => {
    // Headers fit comfortably in the budget, the bodies do not.
    const diff = manyFileDiff(10, 500)
    const result = trimDiffForSummary(diff, 3_000)

    assert.ok(result.diff.includes('[diff for '))
    assert.ok(result.diff.includes('omitted]'))
    assert.ok(result.diff.length <= 3_000)
  })

  it('enforces a hard cap when headers alone exceed the budget', () => {
    const diff = manyFileDiff(5_000, 1)
    const result = trimDiffForSummary(diff, 10_000)

    assert.ok(result.diff.length <= 10_000)
    assert.ok(result.diff.includes('[diff truncated]'))
  })

  it('uses the default budget of MaxSummaryDiffChars', () => {
    const diff = manyFileDiff(20, 1_000)
    const result = trimDiffForSummary(diff)

    assert.ok(diff.length > MaxSummaryDiffChars)
    assert.ok(result.diff.length <= MaxSummaryDiffChars)
  })
})
