import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

it.each(['ptyId', 'processIncarnation', 'generation'] as const)(
  'fails closed when %s changes during the receiver probe',
  async (field) => {
    const db = createDatabase('orca-coordinator-probe-race-')
    const { runtime, write } = createRuntime(db)
    try {
      await runtime.listTerminals()
      const binding = runtime.getTerminalPromptRequestBinding(TERMINAL_HANDLE)
      const changed = { ...binding }
      if (field === 'generation') {
        changed.generation++
      } else {
        changed[field] += ':changed'
      }
      vi.spyOn(runtime, 'getTerminalPromptRequestBinding')
        .mockReturnValueOnce(binding)
        .mockReturnValueOnce(changed)
      await expect(runtime.verifyCoordinatorDeliveryOwner(TERMINAL_HANDLE)).rejects.toMatchObject({
        code: 'coordinator_unverifiable'
      })
      expect(write).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  }
)

describe.each(['runCreate', 'runUse'] as const)('%s supported coordinator owner', (method) => {
  it.each([
    {
      agent: 'claude' as const,
      foreground: undefined,
      policy: 'coordination' as const,
      supported: false
    },
    {
      agent: 'codex' as const,
      foreground: undefined,
      policy: 'coordination' as const,
      supported: true
    },
    { agent: 'claude' as const, foreground: undefined, policy: 'all' as const, supported: true },
    {
      agent: 'codex' as const,
      foreground: 'claude',
      policy: 'coordination' as const,
      supported: false
    },
    {
      agent: 'codex' as const,
      foreground: null,
      policy: 'coordination' as const,
      supported: false
    }
  ])(
    'agent=$agent foreground=$foreground policy=$policy preserves the supported-owner contract',
    async ({ agent, foreground, policy, supported }) => {
      const db = createDatabase('orca-coordinator-binding-')
      const { runtime } = createRuntime(db, { launchAgent: agent, foregroundProcess: foreground })
      const prior = createBoundRun(db, 'Caller prior Run')
      const target = db.createRun({
        objective: 'Target Run',
        coordinatorHandle: 'term_prior',
        coordinatorPaneKey: 'prior-pane',
        notificationPolicy: policy
      })
      try {
        await runtime.listTerminals()
        const response = await new RpcDispatcher({
          runtime,
          methods: ORCHESTRATION_METHODS
        }).dispatch({
          id: 'bind-owner',
          authToken: 'test-auth-token',
          method: `orchestration.${method}`,
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
          orchestrationCompatibilityEvidence: {
            terminalHandle: TERMINAL_HANDLE,
            paneKey: PANE_KEY,
            launchToken: LAUNCH_TOKEN
          },
          params:
            method === 'runUse'
              ? { id: target.id, from: TERMINAL_HANDLE }
              : { objective: 'New hub', notificationPolicy: policy, from: TERMINAL_HANDLE }
        })
        expect(response.ok).toBe(supported)
        if (supported) {
          const current = db.getCurrentRunForPane(PANE_KEY)
          expect(current?.coordinator_handle).toBe(TERMINAL_HANDLE)
          expect(current?.notification_policy).toBe(policy)
          if (method === 'runUse') {
            expect(current?.id).toBe(target.id)
          } else {
            expect(current?.objective).toBe('New hub')
            expect(db.getRun(target.id)?.coordinator_handle).toBe('term_prior')
          }
        } else {
          if (response.ok) {
            throw new Error('Unsupported owner was accepted')
          }
          expect(response.error.code).toBe(
            foreground === null ? 'coordinator_unverifiable' : 'coordinator_delivery_unsupported'
          )
          expect(db.getCurrentRunForPane(PANE_KEY)?.id).toBe(prior.id)
          expect(db.getRun(target.id)?.consumer_generation).toBe(target.consumer_generation)
          expect(db.getRun(target.id)?.coordinator_handle).toBe('term_prior')
        }
      } finally {
        db.close()
      }
    }
  )
})
