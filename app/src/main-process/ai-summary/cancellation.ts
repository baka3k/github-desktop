/**
 * Registry of in-flight AI summary runs so the renderer can cancel a
 * generation that the main process is currently executing. Electron IPC
 * cannot carry an AbortSignal, so the renderer mints a unique run id per
 * generation, passes it alongside the run request, and cancels through
 * the dedicated `ai-summary-*-cancel` channels. Keying by run id (rather
 * than provider id) keeps concurrent runs — e.g. the same provider used
 * from two repositories — independently cancellable.
 */

const inFlightRuns = new Map<string, AbortController>()

/** Registers the controller for a run, replacing any stale entry. */
export function registerRun(runId: string, controller: AbortController): void {
  inFlightRuns.set(runId, controller)
}

/** Drops the registry entry once a run has settled. */
export function completeRun(runId: string): void {
  inFlightRuns.delete(runId)
}

/**
 * Aborts the in-flight run for the given run id, if any. Returns
 * whether a run was found.
 */
export function cancelRun(runId: string): boolean {
  const controller = inFlightRuns.get(runId)
  if (controller === undefined) {
    return false
  }
  inFlightRuns.delete(runId)
  controller.abort()
  return true
}
