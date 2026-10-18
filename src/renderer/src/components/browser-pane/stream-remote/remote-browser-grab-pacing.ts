// Hover preview pacing for remote element selection. The estimate is measured request latency
// (network plus host evaluation), not pure network RTT.

/** Start-to-start floor: caps previews at 20/s however fast the link is. */
export const REMOTE_GRAB_MIN_START_INTERVAL_MS = 50
/** A pointer that has not moved for this long is aiming, so the quiet period is skipped. */
export const REMOTE_GRAB_DWELL_MS = 24
const MIN_QUIET_MS = 16
const MAX_QUIET_MS = 250
const MAX_SAMPLE_MS = 2000
const SMOOTHING = 0.2
const VARIANCE_SMOOTHING = 0.25

export class RemoteGrabLatencyEstimate {
  private smoothed: number | null = null
  private variance = 0

  /** Smoothed latency, seeded at 100 ms until the first sample. */
  get latencyMs(): number {
    return this.smoothed ?? 100
  }

  get jitterMs(): number {
    return this.variance
  }

  record(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) {
      return
    }
    // Why: one retransmit spike must not freeze pacing for the next dozen requests.
    const sample = Math.min(sampleMs, MAX_SAMPLE_MS)
    if (this.smoothed === null) {
      this.smoothed = sample
      this.variance = sample / 2
      return
    }
    this.variance =
      (1 - VARIANCE_SMOOTHING) * this.variance +
      VARIANCE_SMOOTHING * Math.abs(sample - this.smoothed)
    this.smoothed = (1 - SMOOTHING) * this.smoothed + SMOOTHING * sample
  }

  /** Idle time after a preview settles before the next one may start. */
  quietPeriodMs(): number {
    const quiet = 0.25 * this.latencyMs + 0.5 * this.jitterMs
    return Math.round(Math.min(MAX_QUIET_MS, Math.max(MIN_QUIET_MS, quiet)))
  }
}

export function nextRemoteGrabPreviewStart({
  now,
  lastStartedAt,
  lastSettledAt,
  lastMovedAt,
  estimate
}: {
  now: number
  lastStartedAt: number | null
  lastSettledAt: number | null
  lastMovedAt: number
  estimate: RemoteGrabLatencyEstimate
}): number {
  const floor = lastStartedAt === null ? now : lastStartedAt + REMOTE_GRAB_MIN_START_INTERVAL_MS
  const settledQuiet = lastSettledAt === null ? now : lastSettledAt + estimate.quietPeriodMs()
  // Dwell: once the pointer rests, only the floor applies.
  const quiet = Math.min(settledQuiet, Math.max(now, lastMovedAt + REMOTE_GRAB_DWELL_MS))
  return Math.max(now, floor, quiet)
}
