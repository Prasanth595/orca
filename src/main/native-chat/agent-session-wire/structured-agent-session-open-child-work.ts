// The host's account of provider-reported child work, independent of display admission.

import type { AgentChildWorkEvidence } from '../../../shared/agent-status-child-work-evidence'
import { isLiveChildWork } from '../../../shared/agent-status-child-work-liveness'

type ChildLifetime = {
  run: string | undefined
  previous: Set<string>
  token: object
  recorded: object | undefined
  closed: 'idle' | 'terminal' | 'stopped' | null
}

type SessionWork = {
  history: Map<string, ChildLifetime>
  open: Set<string>
}

export class StructuredAgentSessionOpenChildWork {
  private readonly sessions = new Map<string, SessionWork>()

  observe(sessionId: string, evidence: readonly AgentChildWorkEvidence[]): void {
    for (const edge of evidence) {
      if (edge.type === 'session-ended') {
        this.sessions.delete(sessionId)
      } else if (edge.type === 'live') {
        this.live(
          sessionId,
          edge.child.handle.id,
          edge.child.handle.runId,
          edge.restart === true,
          isLiveChildWork(edge.child)
        )
      } else if (edge.type === 'ended' || edge.type === 'removed') {
        this.end(sessionId, edge.handle.id, edge.handle.runId)
      }
    }
  }

  /** Capture before asking the provider to Stop: a reused run string still gets a new token. */
  capture(sessionId: string, handleId: string): object | undefined {
    const session = this.sessions.get(sessionId)
    return session?.open.has(handleId) ? session.history.get(handleId)?.token : undefined
  }

  /** Display admission names a runtime lifetime, not merely its reusable handle. */
  recorded(sessionId: string, handleId: string, token: object): void {
    const child = this.sessions.get(sessionId)?.history.get(handleId)
    if (child?.token === token) {
      child.recorded = token
    }
  }

  hasUnrecorded(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return session
      ? [...session.open].some((handleId) => {
          const child = session.history.get(handleId)
          return child?.recorded !== child?.token
        })
      : false
  }

  stopped(sessionId: string, handleId: string, token: object): void {
    const session = this.sessions.get(sessionId)
    const child = session?.history.get(handleId)
    if (!session?.open.has(handleId) || child?.token !== token) {
      return
    }
    child.closed = 'stopped'
    session.open.delete(handleId)
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  hasOpen(sessionId: string): boolean {
    return (this.sessions.get(sessionId)?.open.size ?? 0) > 0
  }

  handles(sessionId: string): Iterable<string> | undefined {
    const open = this.sessions.get(sessionId)?.open
    return open && open.size > 0 ? open.keys() : undefined
  }

  private live(
    sessionId: string,
    handleId: string,
    run: string | undefined,
    restart: boolean,
    active: boolean
  ): void {
    const session = this.sessions.get(sessionId) ?? {
      history: new Map<string, ChildLifetime>(),
      open: new Set<string>()
    }
    this.sessions.set(sessionId, session)
    let child = session.history.get(handleId)
    if (!child) {
      child = { run, previous: new Set(), token: {}, recorded: undefined, closed: null }
      session.history.set(handleId, child)
    } else {
      // A late start must not promote a run this session already superseded.
      if (run !== undefined && child.previous.has(run)) {
        return
      }
      if (child.run === undefined && run !== undefined) {
        child.run = run
        if (child.closed === 'terminal') {
          child.token = {}
        }
      } else if (run !== undefined && run !== child.run) {
        if (child.run !== undefined) {
          child.previous.add(child.run)
        }
        child.run = run
        child.token = {}
      } else if (restart || (active && child.closed === 'stopped')) {
        child.token = {}
      } else if (child.closed === 'terminal' && child.run !== undefined) {
        return
      } else if (child.closed === 'terminal') {
        // Runless producers cannot distinguish a fresh start from an earlier one.
        child.token = {}
      }
    }
    child.closed = active ? null : 'idle'
    if (active) {
      session.open.add(handleId)
    } else {
      session.open.delete(handleId)
    }
  }

  private end(sessionId: string, handleId: string, run: string | undefined): void {
    const session = this.sessions.get(sessionId)
    const child = session?.history.get(handleId)
    if (!session || !child || (run !== undefined && child.previous.has(run))) {
      return
    }
    // An unseen ending may be the first evidence of a run whose start was missed.
    child.closed = 'terminal'
    session.open.delete(handleId)
  }
}
