// The child work each session's provider reported running and has not reported over, by handle.
//
// Decisions about owed work (idle cleanup, replacing an agent, conversation commands, the teardown
// marker) read this, never the status store: the store is a bounded display projection that may
// refuse a record, and a refused child is still running. Memory only, uncapped; an entry leaves on
// the child's own end, a Stop the store settled, or its session's end.

import type { AgentChildWorkEvidence } from '../../../shared/agent-status-child-work-evidence'
import { isLiveChildWork } from '../../../shared/agent-status-child-work-liveness'

/** The run reported last, and the runs before it while the child stayed open: an ending that names
 *  one of those is late and leaves the current run open, as the store's run verdict does. An
 *  ending naming a run never seen still closes it, so a missed start cannot pin it open. */
type OpenChild = { run: string | undefined; previous: Set<string> }

export class StructuredAgentSessionOpenChildWork {
  private readonly sessions = new Map<string, Map<string, OpenChild>>()

  observe(sessionId: string, evidence: readonly AgentChildWorkEvidence[]): void {
    for (const edge of evidence) {
      if (edge.type === 'session-ended') {
        this.sessions.delete(sessionId)
      } else if (edge.type === 'live') {
        const { handle } = edge.child
        if (isLiveChildWork(edge.child)) {
          this.open(sessionId, handle.id, handle.runId)
        } else {
          this.close(sessionId, handle.id, handle.runId)
        }
      } else if (edge.type === 'ended' || edge.type === 'removed') {
        this.close(sessionId, edge.handle.id, edge.handle.runId)
      }
    }
  }

  /** A Stop settled the child's current run in the store, whose fence alone tells a late
   *  acknowledgement from a restart under the same run id. */
  stopped(sessionId: string, handleId: string): void {
    this.close(sessionId, handleId, undefined)
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  hasOpen(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  handles(sessionId: string): Iterable<string> | undefined {
    return this.sessions.get(sessionId)?.keys()
  }

  private open(sessionId: string, handleId: string, run: string | undefined): void {
    const children = this.sessions.get(sessionId) ?? new Map<string, OpenChild>()
    this.sessions.set(sessionId, children)
    const child = children.get(handleId)
    if (!child) {
      children.set(handleId, { run, previous: new Set() })
      return
    }
    if (run !== undefined && run !== child.run) {
      if (child.run !== undefined) {
        child.previous.add(child.run)
      }
      child.previous.delete(run)
      child.run = run
    }
  }

  private close(sessionId: string, handleId: string, run: string | undefined): void {
    const children = this.sessions.get(sessionId)
    if (!children || (run !== undefined && children.get(handleId)?.previous.has(run))) {
      return
    }
    children.delete(handleId)
    if (children.size === 0) {
      this.sessions.delete(sessionId)
    }
  }
}
