import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import {
  checkBoundMailbox,
  createDatabase,
  createRuntime,
  driveToLiveIdle,
  PANE_KEY,
  LAUNCH_TOKEN,
  pointerCount,
  temporaryDirectories,
  TERMINAL_HANDLE
} from './orchestration-mailbox-notification-test-harness'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('queues a fenced reconciliation pass through the existing owning hub mailbox', async () => {
  vi.useFakeTimers()
  const db = createDatabase('orca-coordinator-pass-')
  const harness = createRuntime(db)
  const creation = {
    objective: 'Reconciliation hub',
    coordinatorHandle: TERMINAL_HANDLE,
    coordinatorPaneKey: PANE_KEY,
    notificationPolicy: 'coordination' as const
  }
  const run = db.createRun(creation)
  try {
    await driveToLiveIdle(harness.runtime)
    const response = await new RpcDispatcher({
      runtime: harness.runtime,
      methods: ORCHESTRATION_METHODS
    }).dispatch({
      id: 'request-pass',
      authToken: 'test-auth-token',
      method: 'orchestration.send',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationCompatibilityEvidence: {
        terminalHandle: TERMINAL_HANDLE,
        paneKey: PANE_KEY,
        launchToken: LAUNCH_TOKEN
      },
      params: {
        from: TERMINAL_HANDLE,
        to: `run:${run.id}`,
        run: run.id,
        type: 'status',
        subject: 'Request one bounded reconciliation pass',
        coordinatorPass: {
          handle: TERMINAL_HANDLE,
          consumerGeneration: run.consumer_generation,
          processIncarnation: harness.runtime.getTerminalProcessIncarnation(TERMINAL_HANDLE)
        }
      }
    })
    expect(response.ok).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pointerCount(harness.write)).toBe(1)
    expect(db.getRun(run.id)?.consumer_generation).toBe(run.consumer_generation)
  } finally {
    db.close()
  }
})

it('keeps routine coordination reports readable without starting an idle hub turn', async () => {
  vi.useFakeTimers()
  const db = createDatabase('orca-coordinator-attention-')
  const harness = createRuntime(db)
  const creation = {
    objective: 'Quiet owning hub',
    coordinatorHandle: TERMINAL_HANDLE,
    coordinatorPaneKey: PANE_KEY,
    notificationPolicy: 'coordination' as const
  }
  const run = db.createRun(creation)
  try {
    db.insertMessages(
      ['heartbeat', 'status'].map((type) => ({
        runId: run.id,
        from: 'term_worker',
        to: `run:${run.id}`,
        subject: 'Routine progress',
        type: type === 'heartbeat' ? ('heartbeat' as const) : ('status' as const)
      }))
    )
    await driveToLiveIdle(harness.runtime)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pointerCount(harness.write)).toBe(0)
    expect((await checkBoundMailbox(harness.runtime)).count).toBe(2)
  } finally {
    db.close()
  }
})
