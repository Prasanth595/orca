import type {
  AgentSessionExecutionLocation,
  AgentSessionRecord
} from '../../../shared/agent-session-record'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session-wire'
import type { AgentChildWorkEvidence } from '../../../shared/agent-status-child-work-evidence'
import type { AgentChildWorkReconcileOutcome } from '../../../shared/agent-status-child-work-evidence-admission'
import type { AgentChildWorkRecord } from '../../../shared/agent-status-child-work'
import type { AgentChildWorkView } from '../../../shared/agent-status-child-work-view'
import {
  parseAgentStatusSubject,
  serializeAgentStatusSubject,
  type AgentStatusStructuredSessionSubject
} from '../../../shared/agent-status-subject'
import { StructuredAgentSessionOpenChildWork } from './structured-agent-session-open-child-work'

export type StructuredAgentSessionStatusSink = {
  publish: (
    summary: AgentSessionStatusSummary,
    subject: AgentStatusStructuredSessionSubject
  ) => void
  forget: (subject: AgentStatusStructuredSessionSubject) => void
  /** The session's child-work evidence, addressed by the subject its parent row landed under. */
  publishChildWork?: (
    subject: AgentStatusStructuredSessionSubject,
    evidence: AgentChildWorkEvidence[],
    provider: AgentSessionRecord['provider']
  ) => AgentChildWorkReconcileOutcome | null | void
  /** The child records the sink holds for that subject, as the views every surface reads. */
  readChildWork?: (subject: AgentStatusStructuredSessionSubject) => AgentChildWorkView[]
  /** The records those views project, with the host-only facts no view carries. */
  readChildWorkRecords?: (subject: AgentStatusStructuredSessionSubject) => AgentChildWorkRecord[]
  /** Every provider handle a live record of the subject answers to for its current run. */
  readChildWorkHandles?: (subject: AgentStatusStructuredSessionSubject) => ReadonlySet<string>
}

/** Retain the owner address because record removal may precede the final status callback. */
export class StructuredAgentSessionStatusOwnership {
  private readonly subjects = new Map<string, AgentStatusStructuredSessionSubject>()
  // Why separate from `subjects`: the address must survive a throwing publish so teardown can still
  // forget a row that did land, but "we hold an address" is not evidence the row is there. Only a
  // publish that returned proves that, and only that proof may suppress the re-offer below.
  private readonly landed = new Set<string>()
  private readonly open = new StructuredAgentSessionOpenChildWork()

  constructor(private readonly sink: () => StructuredAgentSessionStatusSink | undefined) {}

  matchesLocation(sessionId: string, location: AgentSessionExecutionLocation): boolean {
    const subject = this.subjects.get(sessionId)
    return (
      this.landed.has(sessionId) &&
      subject?.executionHostId === location.executionHostId &&
      subject.wslDistro === location.wslDistro &&
      subject.workspaceId === location.workspaceId &&
      subject.workspaceKind === location.workspaceKind
    )
  }

  publish(summary: AgentSessionStatusSummary, location?: AgentSessionExecutionLocation): void {
    const sink = this.sink()
    if (!sink || (!location && !this.subjects.has(summary.sessionId))) {
      return
    }
    const subject = location
      ? parseAgentStatusSubject({
          ...location,
          kind: 'structured-session',
          sessionId: summary.sessionId
        })
      : this.subjects.get(summary.sessionId)
    if (!subject || subject.kind !== 'structured-session') {
      throw new Error('Structured status requires its full trusted execution location')
    }
    const previous = this.subjects.get(summary.sessionId)
    if (
      previous &&
      serializeAgentStatusSubject(previous) !== serializeAgentStatusSubject(subject)
    ) {
      sink.forget(previous)
    }
    this.subjects.set(summary.sessionId, subject)
    this.landed.delete(summary.sessionId)
    sink.publish(summary, subject)
    this.landed.add(summary.sessionId)
  }

  /** Children ride the address the parent landed under: without that proof the store would
   *  refuse them anyway, and offering them earlier would race the parent row. The open set takes
   *  every edge regardless, since that gate is the store's, not the provider's. */
  publishChildWork(
    sessionId: string,
    evidence: AgentChildWorkEvidence[],
    provider: AgentSessionRecord['provider']
  ): void {
    const lifetimes = evidence.map((edge) => {
      this.open.observe(sessionId, [edge])
      return edge.type === 'live'
        ? this.open.capture(sessionId, edge.child.handle.id)
        : undefined
    })
    const subject = this.subjects.get(sessionId)
    if (!subject || !this.landed.has(sessionId)) {
      return
    }
    const outcome = this.sink()?.publishChildWork?.(subject, evidence, provider)
    if (outcome) {
      for (const index of outcome.admittedLiveIndices) {
        const edge = evidence[index]
        const token = lifetimes[index]
        if (edge?.type === 'live' && token) {
          this.open.recorded(sessionId, edge.child.handle.id, token)
        }
      }
    }
  }

  /** A Stop's callback closes only lifetimes captured before the provider call can await. */
  captureChildWorkStops(
    sessionId: string,
    handleIds: readonly string[]
  ): (evidence: readonly AgentChildWorkEvidence[]) => void {
    const captured = new Map<string, object>()
    for (const handleId of handleIds) {
      const token = this.open.capture(sessionId, handleId)
      if (token) {
        captured.set(handleId, token)
      }
    }
    return (evidence) => {
      for (const edge of evidence) {
        if (edge.type === 'stop-acknowledged') {
          const token = captured.get(edge.handleId)
          if (token) {
            this.open.stopped(sessionId, edge.handleId, token)
          }
        }
      }
    }
  }

  /** Whether the session's provider reported child work running that has not ended. */
  childWorkOpen(sessionId: string): boolean {
    return this.open.hasOpen(sessionId)
  }

  /** Whether some of that work has no record, whatever kept it out of the store. */
  childWorkIncomplete(sessionId: string): boolean {
    const open = this.open.handles(sessionId)
    if (!open) {
      return false
    }
    if (this.open.hasUnrecorded(sessionId)) {
      return true
    }
    const read = this.sink()?.readChildWorkHandles
    if (!read) {
      return false
    }
    const subject = this.subjects.get(sessionId)
    const recorded = subject && this.landed.has(sessionId) ? read(subject) : new Set<string>()
    return [...open].some((handleId) => !recorded.has(handleId))
  }

  /** Undefined until the parent row has landed: a sink holds no children for a parent it lacks. */
  readChildWork(sessionId: string): AgentChildWorkView[] | undefined {
    const subject = this.subjects.get(sessionId)
    return subject && this.landed.has(sessionId) ? this.sink()?.readChildWork?.(subject) : undefined
  }

  readChildWorkRecords(sessionId: string): AgentChildWorkRecord[] | undefined {
    const subject = this.subjects.get(sessionId)
    return subject && this.landed.has(sessionId)
      ? this.sink()?.readChildWorkRecords?.(subject)
      : undefined
  }

  forget(sessionId: string): void {
    this.open.forget(sessionId)
    const subject = this.subjects.get(sessionId)
    if (!subject) {
      return
    }
    this.landed.delete(sessionId)
    this.sink()?.forget(subject)
    this.subjects.delete(sessionId)
  }
}
