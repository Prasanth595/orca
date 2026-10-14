import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTestStores, createStore, testState } from '../persistence-test-harness'
import { OrcaRuntimeService } from './orca-runtime'
import { AutomationCreate, AutomationUpdate } from '../../shared/rpc-contract/automation-params'
import { normalizeAutomationSessionReuse } from '../persistence/scheduling-automations/automation-context-migration'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

const CREATE = {
  name: 'Review',
  prompt: 'Check',
  agentId: 'claude',
  repo: 'id:repo-1',
  workspaceMode: 'new_per_run',
  rrule: 'FREQ=DAILY',
  dtstart: 1
} as const

describe('automation notification setting across the runtime boundary', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-runtime-alerts-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('preserves opting in and explicitly disabling through RPC parsing, runtime and restart', async () => {
    const store = await createStore()
    store.addRepo({
      id: 'repo-1',
      path: '/repo',
      displayName: 'Repo',
      badgeColor: '#fff',
      addedAt: 1
    })
    const runtime = new OrcaRuntimeService(store)
    const created = await runtime.createAutomation(
      AutomationCreate.parse({ ...CREATE, notifyOnFailure: true })
    )
    expect(created.notifyOnFailure).toBe(true)
    await runtime.updateAutomation(
      created.id,
      AutomationUpdate.parse({ id: created.id, updates: { name: 'Renamed' } }).updates
    )
    expect(store.automationAlertsEnabled(created.id)).toBe(true)
    const update = AutomationUpdate.parse({ id: created.id, updates: { notifyOnFailure: false } })
    const disabled = await runtime.updateAutomation(update.id, update.updates)
    expect(disabled.notifyOnFailure).toBe(false)
    await closeTestStores()
    const restored = await createStore()
    expect(
      restored.listAutomations().find((entry) => entry.id === created.id)?.notifyOnFailure
    ).toBe(false)
  })

  it('keeps older client inputs and saved records opted out', async () => {
    const store = await createStore()
    store.addRepo({
      id: 'repo-1',
      path: '/repo',
      displayName: 'Repo',
      badgeColor: '#fff',
      addedAt: 1
    })
    const runtime = new OrcaRuntimeService(store)
    const created = await runtime.createAutomation(AutomationCreate.parse(CREATE))
    expect(created.notifyOnFailure).toBe(false)
    const { notifyOnFailure: ignored, ...legacy } = created
    expect(ignored).toBe(false)
    expect(normalizeAutomationSessionReuse(legacy).notifyOnFailure).toBe(false)
    expect(store.automationAlertsEnabled('deleted-automation')).toBe(false)
  })
})
