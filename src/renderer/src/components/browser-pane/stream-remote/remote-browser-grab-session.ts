import { clampGrabPayload } from '../../../../../shared/browser-grab/browser-grab-payload'
import {
  RemoteGrabProtocolError,
  type RemoteGrabPoint,
  type RemoteGrabQueryResult
} from '../../../../../shared/browser-grab/remote-grab-point-script'
import { nextRemoteGrabPreviewStart, RemoteGrabLatencyEstimate } from './remote-browser-grab-pacing'
import {
  RemoteGrabNavigatedError,
  type RemoteGrabPreview,
  type RemoteGrabSelectOutcome,
  type RemoteGrabSessionDeps,
  type RemoteGrabTimer
} from './remote-browser-grab-session-types'

const MAX_GEOMETRY_RETRIES = 2

/**
 * One armed picker on one remote page. Hover work is single-flight and latest-wins: pointer moves
 * only overwrite one pending position, and at most one preview query is outstanding. A click is
 * resolved independently at its own coordinates, so a late or missing hover never decides what
 * gets selected.
 */
export class RemoteBrowserGrabSession {
  readonly estimate = new RemoteGrabLatencyEstimate()
  private document: string | null = null
  private ended = false
  private paused = false
  private pending: RemoteGrabPoint | null = null
  private pointerSeq = 0
  private geometryEpoch = 0
  private previewInFlight = false
  private previewGeneration = 0
  private previewFailure: Error | null = null
  private selecting = false
  private timer: RemoteGrabTimer | null = null
  private lastStartedAt: number | null = null
  private lastSettledAt: number | null = null
  private lastMovedAt = 0
  private geometryRetries = 0
  private shown: RemoteGrabPreview | null = null
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, ms: number) => RemoteGrabTimer
  private readonly clearTimer: (timer: RemoteGrabTimer) => void

  constructor(private readonly deps: RemoteGrabSessionDeps) {
    this.now = deps.now ?? (() => performance.now())
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  get isEnded(): boolean {
    return this.ended
  }

  get isReady(): boolean {
    return this.document !== null && !this.ended && !this.previewFailure
  }

  get requiresExplicitRearm(): boolean {
    return this.previewFailure !== null
  }

  /** Learns the document identity the picker is bound to. False when cancelled meanwhile. */
  async start(): Promise<boolean> {
    const startedAt = this.now()
    const result = await this.deps.run({ kind: 'probe' })
    if (this.ended) {
      return false
    }
    this.estimate.record(this.now() - startedAt)
    this.document = result.document
    this.reportViewport(result)
    if (this.pending) {
      this.schedule()
    }
    return true
  }

  hover(client: RemoteGrabPoint): void {
    if (this.ended) {
      return
    }
    this.pointerSeq += 1
    this.pending = client
    this.lastMovedAt = this.now()
    // Why: an outline is only ever the host's answer for the pointer's current position.
    this.show(null)
    this.schedule()
  }

  leave(): void {
    this.pointerSeq += 1
    this.pending = null
    this.cancelTimer()
    this.show(null)
  }

  /** Scroll, resize, zoom or a new frame geometry: retire in-flight previews and requery. */
  invalidateGeometry(lastClient: RemoteGrabPoint | null): void {
    if (this.ended) {
      return
    }
    this.geometryEpoch += 1
    this.show(null)
    if (lastClient) {
      this.pending = lastClient
      this.pointerSeq += 1
      this.schedule()
    }
  }

  /** While a selection is being confirmed, hover must not repaint over it. */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      this.cancelTimer()
      this.show(null)
    } else {
      this.schedule()
    }
  }

  async select(client: RemoteGrabPoint): Promise<RemoteGrabSelectOutcome> {
    const document = this.document
    if (!this.isReady || this.selecting || document === null) {
      return { kind: 'ignored' }
    }
    const mapped = this.deps.map(client)
    if (!mapped) {
      return { kind: 'empty' }
    }
    this.selecting = true
    this.previewGeneration += 1
    const epoch = this.geometryEpoch
    // Why: the click decides the target; nothing queued for hover may run ahead of it.
    this.pointerSeq += 1
    this.pending = null
    this.cancelTimer()
    this.show(null)
    try {
      const result = await this.deps.run({
        kind: 'select',
        point: mapped.point,
        document,
        viewport: mapped.viewport,
        scroll: mapped.scroll
      })
      if (this.ended) {
        return { kind: 'ignored' }
      }
      this.reportViewport(result)
      if (result.status === 'stale') {
        if (result.reason === 'document') {
          this.end(new RemoteGrabNavigatedError('The page changed.'))
          return { kind: 'ignored' }
        }
        return this.finishUnselected('moved')
      }
      // Why: a scroll/resize/zoom during the round trip means the frame no longer shows this answer.
      if (epoch !== this.geometryEpoch) {
        return this.finishUnselected('moved')
      }
      if (result.status !== 'selected') {
        return this.finishUnselected('empty')
      }
      const payload = clampGrabPayload(result.payload)
      if (!payload) {
        throw new RemoteGrabProtocolError('Could not read the selected element.')
      }
      this.setPaused(true)
      return { kind: 'selected', payload }
    } finally {
      this.selecting = false
    }
  }

  cancel(): void {
    if (this.ended) {
      return
    }
    this.ended = true
    this.pending = null
    this.cancelTimer()
    this.show(null)
  }

  private end(error: Error): void {
    if (this.ended) {
      return
    }
    this.cancel()
    this.deps.onEnded(error)
  }

  private finishUnselected(kind: 'empty' | 'moved'): RemoteGrabSelectOutcome {
    if (this.previewFailure) {
      this.end(this.previewFailure)
    }
    return { kind }
  }

  private reportViewport(result: RemoteGrabQueryResult): void {
    this.deps.onViewport(result.viewport)
  }

  private show(preview: RemoteGrabPreview | null): void {
    if (preview === null && this.shown === null) {
      return
    }
    this.shown = preview
    this.deps.onPreview(preview)
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private schedule(): void {
    if (!this.canPreview || !this.pending) {
      return
    }
    const now = this.now()
    const startAt = nextRemoteGrabPreviewStart({
      now,
      lastStartedAt: this.lastStartedAt,
      lastSettledAt: this.lastSettledAt,
      lastMovedAt: this.lastMovedAt,
      estimate: this.estimate
    })
    this.cancelTimer()
    if (startAt <= now) {
      this.dispatch()
      return
    }
    this.timer = this.setTimer(() => {
      this.timer = null
      this.schedule()
    }, startAt - now)
  }

  private get canPreview(): boolean {
    return this.isReady && !this.paused && !this.selecting && !this.previewInFlight
  }

  private dispatch(): void {
    const client = this.pending
    const document = this.document
    if (!this.canPreview || !client || document === null) {
      return
    }
    const mapped = this.deps.map(client)
    this.pending = null
    if (!mapped) {
      this.show(null)
      return
    }
    const seq = this.pointerSeq
    const generation = this.previewGeneration
    const epoch = this.geometryEpoch
    const startedAt = this.now()
    this.previewInFlight = true
    this.lastStartedAt = startedAt
    void this.deps
      .run({ kind: 'preview', point: mapped.point, document, viewport: mapped.viewport })
      .then(
        (result) => {
          if (this.ended || generation !== this.previewGeneration) {
            return
          }
          this.estimate.record(this.now() - startedAt)
          this.reportViewport(result)
          if (result.status === 'stale') {
            if (result.reason === 'document') {
              this.end(new RemoteGrabNavigatedError('The page changed.'))
              return
            }
            // Why: bounded, so a mapping that never agrees with the host cannot spin.
            if (epoch === this.geometryEpoch && this.geometryRetries < MAX_GEOMETRY_RETRIES) {
              this.geometryRetries += 1
              this.geometryEpoch += 1
              this.pending ??= client
            }
            return
          }
          this.geometryRetries = 0
          if (epoch !== this.geometryEpoch || this.paused || this.selecting) {
            return
          }
          if (result.status !== 'preview') {
            if (seq === this.pointerSeq) {
              this.show(null)
            }
            return
          }
          if (seq === this.pointerSeq) {
            this.show({ target: result.target, viewport: mapped.viewport, scroll: result.scroll })
          }
        },
        (error: unknown) => {
          if (this.ended) {
            return
          }
          const failure = error instanceof Error ? error : new Error(String(error))
          if (generation !== this.previewGeneration) {
            // Why: host completion is unknown; keep the click, but require an explicit new session.
            this.previewFailure = failure
            this.pending = null
            this.cancelTimer()
            this.show(null)
            if (!this.selecting && !this.paused) {
              this.end(failure)
            }
            return
          }
          this.end(failure)
        }
      )
      .finally(() => {
        this.previewInFlight = false
        this.lastSettledAt = this.now()
        this.schedule()
      })
  }
}
