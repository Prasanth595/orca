import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import {
  createDatabase,
  createRuntime,
  createBoundRun,
  PANE_KEY,
  LAUNCH_TOKEN,
  TERMINAL_HANDLE,
  temporaryDirectories
} from './orchestration-mailbox-notification-test-harness'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each([
  { agent: 'claude' as const, policy: 'coordination' as const, supported: false },
  { agent: 'codex' as const, policy: 'coordination' as const, supported: true },
  { agent: 'claude' as const, policy: 'all' as const, supported: true }
])(
  'run-use agent=$agent policy=$policy preserves the supported-owner contract',
  async ({ agent, policy, supported }) => {
    const db = createDatabase('orca-coordinator-binding-')
    const { runtime } = createRuntime(db, { launchAgent: agent })
    const prior = createBoundRun(db, 'Caller prior Run')
    const target = db.createRun({
      objective: 'Target Run',
      coordinatorHandle: 'term_prior',
      coordinatorPaneKey: 'prior-pane',
      notificationPolicy: policy
    })
    try {
      await runtime.listTerminals()
      expect(runtime.supportsCoordinatorDelivery(TERMINAL_HANDLE)).toBe(agent === 'codex')
      const response = await new RpcDispatcher({
        runtime,
        methods: ORCHESTRATION_METHODS
      }).dispatch({
        id: 'bind-owner',
        authToken: 'test-auth-token',
        method: 'orchestration.runUse',
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationCompatibilityEvidence: {
          terminalHandle: TERMINAL_HANDLE,
          paneKey: PANE_KEY,
          launchToken: LAUNCH_TOKEN
        },
        params: { id: target.id, from: TERMINAL_HANDLE }
      })
      expect(response.ok).toBe(supported)
      if (supported) {
        expect(db.getCurrentRunForPane(PANE_KEY)?.id).toBe(target.id)
        expect(db.getRun(target.id)?.coordinator_handle).toBe(TERMINAL_HANDLE)
      } else {
        if (response.ok) {
          throw new Error('Unsupported owner was accepted')
        }
        expect(response.error.code).toBe('coordinator_delivery_unsupported')
        expect(db.getCurrentRunForPane(PANE_KEY)?.id).toBe(prior.id)
        expect(db.getRun(target.id)?.consumer_generation).toBe(target.consumer_generation)
        expect(db.getRun(target.id)?.coordinator_handle).toBe('term_prior')
      }
    } finally {
      db.close()
    }
  }
)
