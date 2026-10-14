import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintFleetAgentStatusEvidence } from '../../shared/orchestration-fleet-agent-status-evidence'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  agentSessionRecordFixture,
  agentSessionLeaseFixture
} from '../../shared/agent-session-record.test-fixture'
import { projectStructuredOrchestrationDisplay } from './runtime-structured-orchestration-display'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { testOrcaSessionId } from '../../shared/orca-session-address-test-fixture'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { RuntimeAgentOrchestrationProjection } from './runtime-agent-orchestration-projection'
import { OrchestrationDb } from './orchestration/db'
import { createRootDispatch } from './orchestration/db/root-dispatch-test-fixture'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from './structured-worker-identity'

const hostStore = vi.hoisted(() => ({
  records: new Map<string, AgentSessionRecord>(),
  listRecords: vi.fn<() => AgentSessionRecord[]>()
}))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () =>
    hostStore.records.size
      ? {
          deps: {
            store: {
              getRecord: (id: string) => hostStore.records.get(id) ?? null,
              listRecords: hostStore.listRecords
            }
          }
        }
      : null
}))

const COORDINATOR = testOrcaSessionId('11111111-1111-4111-8111-111111111111')
const WORKER = testOrcaSessionId('22222222-2222-4222-8222-222222222222')
const WORKSPACE = 'folder:demo'
const displayPane = (sessionId: string) =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)

function status(sessionId: string): AgentStatusIpcPayload {
  return {
    paneKey: displayPane(sessionId),
    tabId: structuredAgentSessionTabId(sessionId),
    worktreeId: WORKSPACE,
    structuredHost: 'owned',
    state: 'working',
    prompt: 'Inspect source',
    agentType: 'codex',
    connectionId: null,
    receivedAt: Date.now(),
    stateStartedAt: Date.now()
  }
}

let db: OrchestrationDb
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  structuredWorkerIdentities.clear()
  hostStore.records.clear()
  hostStore.listRecords.mockReset().mockImplementation(() => [...hostStore.records.values()])
})
afterEach(() => {
  db.close()
  structuredWorkerIdentities.clear()
})

function worker() {
  return structuredWorkerIdentities.register({
    handle: mintStructuredWorkerHandle(),
    sessionId: WORKER,
    agent: 'codex',
    paneKey: mintStructuredWorkerPaneKey(WORKER),
    processIncarnation: structuredWorkerProcessIncarnation(WORKER),
    worktreeId: WORKSPACE,
    hostScope: { kind: 'local', hostId: 'local' }
  })
}

function projection(rows: AgentStatusIpcPayload[]) {
  return new RuntimeAgentOrchestrationProjection({
    getDb: () => db,
    getLeaves: () => [],
    getPtys: () => [],
    issueLeafHandle: () => '',
    issuePtyHandle: () => '',
    makePaneKey: () => '',
    getWorktreeId: () => null,
    getHandleForPaneKey: () => null,
    getPaneKey: () => null,
    getDispatchAuthority: () => null,
    getAgentStatusSnapshot: () =>
      rows.map((row) =>
        mintFleetAgentStatusEvidence(row, { kind: 'unresolved', reason: 'pane_not_bound' })
      ),
    getStructuredStatusSnapshot: () => rows
  })
}

function dispatchWorker() {
  const identity = worker()
  const run = db.createRun({
    objective: 'delegate from a chat',
    coordinatorHandle: null,
    coordinatorPaneKey: null,
    coordinatorOrcaSessionId: COORDINATOR
  })
  const task = db.createTask({ spec: 'Inspect source', runId: run.id })
  const dispatch = createRootDispatch(
    db,
    task.id,
    identity.handle,
    identity.paneKey,
    undefined,
    identity.processIncarnation
  )
  return { identity, run, dispatch }
}

describe('structured worker orchestration display', () => {
  it('maps a structured worker coordinating its own run without leaking its authority pane', () => {
    const parent = worker()
    const run = db.createRun({
      objective: 'Nested work',
      coordinatorHandle: parent.handle,
      coordinatorPaneKey: parent.paneKey,
      coordinatorOrcaSessionId: WORKER
    })
    const context = { taskId: 'child', dispatchId: 'dispatch', parentPaneKey: parent.paneKey }
    const projected = projectStructuredOrchestrationDisplay(
      context,
      db,
      run,
      displayPane(COORDINATOR)
    )
    expect(projected.parentPaneKey).toBe(displayPane(WORKER))
    expect(JSON.stringify(projected)).not.toContain(parent.paneKey)
    expect(
      projectStructuredOrchestrationDisplay(context, db, run, parent.paneKey).parentPaneKey
    ).toBeUndefined()
  })

  it('preserves an intermediate PTY parent in a structured-coordinated run', () => {
    const { run } = dispatchWorker()
    const context = {
      taskId: 'child',
      dispatchId: 'dispatch',
      parentTerminalHandle: 'term_creator',
      parentPaneKey: 'tab_creator:33333333-3333-4333-8333-333333333333'
    }
    for (const creatorSession of [undefined, COORDINATOR]) {
      expect(
        projectStructuredOrchestrationDisplay(context, db, run, displayPane(WORKER), creatorSession)
      ).toEqual(context)
    }
  })

  it('follows a coordinator clear and indexes retained sessions only once per snapshot', () => {
    dispatchWorker()
    const successor = testOrcaSessionId('33333333-3333-4333-8333-333333333333')
    const root = agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: COORDINATOR }))
    root.conversationCommand = {
      command: 'clear',
      state: 'completed',
      phase: 'committed',
      replacementSessionId: successor,
      operationId: 'clear-1',
      callerKey: 'test'
    }
    hostStore.records.set(COORDINATOR, root)
    hostStore.records.set(
      successor,
      agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: successor }))
    )
    const contexts = projection([
      status(COORDINATOR),
      status(successor),
      status(WORKER)
    ]).buildByPaneKey()
    expect(contexts?.[displayPane(WORKER)]?.parentPaneKey).toBe(displayPane(successor))
    expect(hostStore.listRecords).toHaveBeenCalledTimes(1)
  })

  it('keeps a cleared worker attached without publishing its authority pane', () => {
    const { identity } = dispatchWorker()
    const successor = testOrcaSessionId('33333333-3333-4333-8333-333333333333')
    const record = agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: WORKER }))
    record.conversationCommand = {
      command: 'clear',
      state: 'completed',
      phase: 'committed',
      replacementSessionId: successor,
      operationId: 'clear-worker',
      callerKey: 'test'
    }
    hostStore.records.set(WORKER, record)
    hostStore.records.set(
      successor,
      agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: successor }))
    )
    hostStore.records.set(
      COORDINATOR,
      agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: COORDINATOR }))
    )
    const contexts = projection([status(COORDINATOR), status(successor)]).buildByPaneKey()
    expect(contexts?.[displayPane(successor)]?.parentPaneKey).toBe(displayPane(COORDINATOR))
    expect(contexts?.[displayPane(WORKER)]).toBeUndefined()
    expect(JSON.stringify(contexts)).not.toContain(identity.paneKey)
  })

  it('does not attach a local child to a coordinator lineage on another host', () => {
    dispatchWorker()
    const record = agentSessionRecordFixture(agentSessionLeaseFixture({ sessionId: COORDINATOR }))
    record.location.executionHostId = 'runtime:remote-host'
    hostStore.records.set(COORDINATOR, record)
    expect(
      projection([status(WORKER)]).buildByPaneKey()?.[displayPane(WORKER)]?.parentPaneKey
    ).toBeUndefined()
  })

  it('nests a PTY-less worker under its handle-less structured coordinator', () => {
    const { identity, dispatch } = dispatchWorker()
    const contexts = projection([status(COORDINATOR), status(WORKER)]).buildByPaneKey()
    expect(contexts?.[displayPane(WORKER)]).toMatchObject({
      dispatchId: dispatch.id,
      parentPaneKey: displayPane(COORDINATOR)
    })
    expect(contexts?.[displayPane(COORDINATOR)]).toBeUndefined()
    expect(contexts?.[displayPane(WORKER)]?.attention?.categories).not.toContain('unverifiable')
    expect(JSON.stringify(contexts)).not.toContain(identity.paneKey)
  })

  it('uses the same context for IPC enrichment as for graph and worktree ps', () => {
    dispatchWorker()
    const projector = projection([status(WORKER)])
    expect(projector.getForStructuredPaneKey(displayPane(WORKER))).toEqual(
      projector.buildByPaneKey()?.[displayPane(WORKER)]
    )
  })

  it('preserves IPC attention parity when batched attention is unavailable', () => {
    const { dispatch } = dispatchWorker()
    const facts = db.getWorkerAttentionFacts(dispatch.id, Date.now())
    vi.spyOn(db, 'getWorkerAttentionFacts').mockReturnValue(facts)
    Object.defineProperty(db, 'getWorkerAttentionFactsForDispatches', { value: undefined })
    const projector = projection([status(WORKER)])
    const context = projector.buildByPaneKey()?.[displayPane(WORKER)]
    expect(context).toEqual(projector.getForStructuredPaneKey(displayPane(WORKER)))
    expect(context?.attention?.categories).not.toContain('unverifiable')
  })

  it('ignores rows from other hosts, workspaces, and non-structured producers', () => {
    dispatchWorker()
    for (const row of [
      { ...status(WORKER), connectionId: 'ssh-other' },
      { ...status(WORKER), worktreeId: 'folder:other' },
      { ...status(WORKER), structuredHost: undefined },
      { ...status(WORKER), paneKey: 'forged-pane' }
    ]) {
      expect(projection([row]).buildByPaneKey()).toBeUndefined()
    }
  })

  it('does not reuse a coordinator session id from a superseded run binding', () => {
    const { run } = dispatchWorker()
    db.bindRun({
      runId: run.id,
      coordinatorHandle: 'term_new',
      coordinatorPaneKey: 'tab-new:33333333-3333-4333-8333-333333333333'
    })
    db.db
      .prepare(
        'UPDATE runs SET coordinator_orca_session_id = ?, coordinator_orca_session_id_generation = 1 WHERE id = ?'
      )
      .run(COORDINATOR, run.id)
    expect(projection([status(WORKER)]).buildByPaneKey()?.[displayPane(WORKER)]).toMatchObject({
      parentPaneKey: 'tab-new:33333333-3333-4333-8333-333333333333'
    })
  })
})
