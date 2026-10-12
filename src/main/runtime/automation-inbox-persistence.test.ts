import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTestStores, createStore, testState } from '../persistence-test-harness'
import { OrcaRuntimeService } from './orca-runtime'
import {
  changeAutomationInboxEntries,
  normalizeAutomationInboxEntries
} from '../../shared/automation-inbox'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

async function setup(notifyOnFailure = true) {
  const store = await createStore()
  store.addRepo({
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#fff',
    addedAt: 1
  })
  const automation = store.createAutomation({
    name: 'Nightly',
    prompt: 'Check',
    notifyOnFailure,
    agentId: 'claude',
    projectId: 'repo-1',
    workspaceMode: 'new_per_run',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 1
  })
  const run = store.createAutomationRun(automation, 1)
  return { store, runtime: new OrcaRuntimeService(store), automation, run }
}

describe('durable automation inbox', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-inbox-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('retains a workspace-less launch failure and a read receipt through restart without exposing the report token', async () => {
    const { store, runtime, run } = await setup()
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'Folder missing' })
    const alerts = await runtime.listAutomationInbox()
    expect(alerts).toMatchObject([
      {
        selector: { kind: 'self' },
        alert: {
          runId: run.id,
          status: 'failed',
          message: 'Folder missing',
          workspaceId: null,
          paneKey: null
        }
      }
    ])
    expect(JSON.stringify(alerts)).not.toContain(run.reportToken)
    const records = normalizeAutomationInboxEntries({
      received: {
        alert: alerts[0].alert,
        catalogKey: 'host:desktop:self',
        read: false,
        dismissed: false,
        interactionAt: 0
      }
    })
    const read = changeAutomationInboxEntries(records, Object.keys(records), 'read')
    expect(Object.values(read)).toHaveLength(1)
    store.updateUI({ automationInboxEntries: read })
    expect(store.getUI().automationInboxEntries).toEqual(read)
    await store.flushPendingOrThrowAsync()
    await closeTestStores()
    const restored = await createStore()
    expect(await new OrcaRuntimeService(restored).listAutomationInbox()).toEqual(alerts)
    expect(Object.values(restored.getUI().automationInboxEntries ?? {})[0].read).toBe(true)
  })

  it('keeps task outcomes after completion and upgrades one stored alert from attention to failure', async () => {
    const { store, runtime, run } = await setup()
    const result = { status: 'needs_attention' as const, message: 'Review findings', reportedAt: 1 }
    store.updateAutomationRun({ runId: run.id, status: 'dispatched', result })
    const attention = await runtime.listAutomationInbox()
    store.updateAutomationRun({ runId: run.id, status: 'completed' })
    expect(await runtime.listAutomationInbox()).toEqual(attention)
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'Agent crashed' })
    const failure = await runtime.listAutomationInbox()
    expect(failure).toHaveLength(1)
    expect(failure[0].alert).toMatchObject({ status: 'failed', message: 'Agent crashed' })
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'Agent crashed' })
    expect(await runtime.listAutomationInbox()).toEqual(failure)
  })

  it('merges read receipts from two clients instead of replacing a newer interaction', async () => {
    const { store } = await setup()
    const entry = {
      alert: {
        automationId: 'auto-1',
        runId: 'run-1',
        title: 'Nightly',
        message: 'Failure',
        status: 'failed' as const,
        createdAt: 1,
        workspaceId: null,
        paneKey: null
      },
      catalogKey: 'host:desktop:self',
      read: false,
      dismissed: false,
      interactionAt: 0
    }
    store.updateUI({ automationInboxEntries: normalizeAutomationInboxEntries({ entry }) })
    store.updateUI({
      automationInboxEntries: normalizeAutomationInboxEntries({
        entry: { ...entry, read: true, interactionAt: 20 }
      })
    })
    store.updateUI({
      automationInboxEntries: normalizeAutomationInboxEntries({
        entry: { ...entry, read: false, interactionAt: 10 },
        other: { ...entry, alert: { ...entry.alert, runId: 'run-2' } }
      })
    })
    const values = Object.values(store.getUI().automationInboxEntries ?? {})
    expect(values).toHaveLength(2)
    expect(values.find((value) => value.alert.runId === 'run-1')?.read).toBe(true)
  })

  it('does not create inbox alerts for muted runs, or retroactively when reminders are enabled', async () => {
    const { store, runtime, run, automation } = await setup(false)
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'Missing folder' })
    expect(await runtime.listAutomationInbox()).toEqual([])
    store.updateAutomation(automation.id, { notifyOnFailure: true })
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'Missing folder' })
    expect(await runtime.listAutomationInbox()).toEqual([])
    const enabled = store.listAutomations()[0]
    const fresh = store.createAutomationRun(enabled, 2)
    store.updateAutomationRun({
      runId: fresh.id,
      status: 'dispatch_failed',
      error: 'x'.repeat(5000)
    })
    const alerts = await runtime.listAutomationInbox()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alert?.message).toHaveLength(4000)
    store.updateAutomation(automation.id, { notifyOnFailure: false })
    expect(await runtime.listAutomationInbox()).toEqual(alerts)
  })

  it('returns only the inbox snapshot covered by its save acknowledgement', async () => {
    const { store, runtime, run, automation } = await setup()
    store.updateAutomationRun({ runId: run.id, status: 'dispatch_failed', error: 'First failure' })
    const acknowledgement = Promise.withResolvers<void>()
    vi.spyOn(store, 'flushPendingOrThrowAsync').mockReturnValueOnce(acknowledgement.promise)
    const pending = runtime.listAutomationInbox()
    const later = store.createAutomationRun(automation, 2)
    store.updateAutomationRun({
      runId: later.id,
      status: 'dispatch_failed',
      error: 'Later failure'
    })
    acknowledgement.resolve()
    expect(await pending).toHaveLength(1)
  })
})
