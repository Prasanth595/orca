import './orca-runtime-test-lifecycle.spec'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OrcaRuntimeService,
  OrchestrationDb,
  createRootDispatch
} from './orca-runtime-test-mocks.spec'
import { TEST_WORKTREE_ID, store, syncSinglePty } from './orca-runtime-test-fixtures.spec'
import { testOrcaSessionId } from '../../shared/orca-session-address-test-fixture'
import { makeStructuredAgentStatusSubject } from '../../shared/agent-status-subject'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { AgentHookServer } from '../agent-hooks/server'
import { enrichAgentStatusIpcPayload } from '../ipc/agent-status-ipc-boundary'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from './structured-worker-identity'

const COORDINATOR = testOrcaSessionId('11111111-1111-4111-8111-111111111111')
const WORKER = testOrcaSessionId('22222222-2222-4222-8222-222222222222')

afterEach(() => structuredWorkerIdentities.clear())

describe('structured worker sidebar and worktree ps lineage', () => {
  it('resolves terminal-backed worker context through its terminal handle', () => {
    const runtime = new OrcaRuntimeService(store)
    syncSinglePty(runtime)
    const paneKey = 'tab-1:1'
    const handle = runtime.getTerminalHandleForPaneKey(paneKey)
    if (!handle) {
      throw new Error('Missing terminal worker handle')
    }
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    try {
      const parentPaneKey = 'coordinator-tab:11111111-1111-4111-8111-111111111111'
      const run = db.createRun({
        objective: 'Inspect source',
        coordinatorHandle: null,
        coordinatorPaneKey: parentPaneKey
      })
      const task = db.createTask({ runId: run.id, spec: 'Inspect source' })
      const dispatch = createRootDispatch(db, task.id, handle)

      expect(dispatch.assignee_pane_key).toBeNull()
      expect(structuredWorkerIdentities.get(handle)).toBeNull()
      expect(runtime.getAgentStatusOrchestrationContextForPaneKey(paneKey)).toMatchObject({
        dispatchId: dispatch.id,
        taskId: task.id,
        orchestrationRunId: run.id,
        parentPaneKey
      })
    } finally {
      db.close()
    }
  })

  it('publishes the same display parent through the real runtime and IPC boundary', async () => {
    const statuses = new AgentHookServer()
    for (const sessionId of [COORDINATOR, WORKER]) {
      statuses.ingestStructuredStatus(
        {
          sessionId,
          workspaceId: TEST_WORKTREE_ID,
          agent: 'codex',
          status: 'working',
          hostExecutionOwned: true,
          latestPrompt: 'Inspect source',
          updatedAt: Date.now()
        },
        makeStructuredAgentStatusSubject(
          {
            executionHostId: 'local',
            wslDistro: null,
            workspaceId: TEST_WORKTREE_ID,
            workspaceKind: 'git-worktree'
          },
          sessionId
        )
      )
    }
    const identity = structuredWorkerIdentities.register({
      handle: mintStructuredWorkerHandle(),
      sessionId: WORKER,
      agent: 'codex',
      paneKey: mintStructuredWorkerPaneKey(WORKER),
      processIncarnation: structuredWorkerProcessIncarnation(WORKER),
      worktreeId: TEST_WORKTREE_ID,
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService(store, undefined, {
      getAgentStatusSnapshot: () => statuses.getStatusSnapshot()
    })
    runtime.setOrchestrationDb(db)
    try {
      const run = db.createRun({
        objective: 'Inspect source',
        coordinatorHandle: null,
        coordinatorPaneKey: null,
        coordinatorOrcaSessionId: COORDINATOR
      })
      const task = db.createTask({ runId: run.id, spec: 'Inspect source' })
      createRootDispatch(
        db,
        task.id,
        identity.handle,
        identity.paneKey,
        undefined,
        identity.processIncarnation
      )
      const pane = (sessionId: string) =>
        structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)
      const { worktrees } = await runtime.getWorktreePs()
      const rows = worktrees.find((entry) => entry.worktreeId === TEST_WORKTREE_ID)?.agents
      expect(rows?.find((row) => row.paneKey === pane(WORKER))?.parentPaneKey).toBe(
        pane(COORDINATOR)
      )
      expect(rows?.find((row) => row.paneKey === pane(COORDINATOR))?.parentPaneKey).toBeNull()
      const row = statuses.getStatusSnapshot().find((row) => row.paneKey === pane(WORKER))
      if (!row) {
        throw new Error('Missing worker status')
      }
      expect(enrichAgentStatusIpcPayload(row, runtime).orchestration?.parentPaneKey).toBe(
        pane(COORDINATOR)
      )
      expect(runtime.getAgentStatusTerminalHandleForPaneKey(pane(WORKER))).toBeUndefined()
      expect(runtime.getTerminalHandleForPaneKey(pane(WORKER))).toBeNull()
    } finally {
      db.close()
    }
  })
})
