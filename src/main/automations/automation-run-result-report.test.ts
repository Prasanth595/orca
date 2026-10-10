import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTestStores, createStore, testState } from '../persistence-test-harness'
import { AutomationService } from './service'
import type { AutomationRun } from '../../shared/automations-types'
import { getAutomationRunDisplayStatus } from '../../shared/automation-run-result'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import { folderWorkspaceKey } from '../../shared/workspace-scope'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

function tokenFor(run: AutomationRun): string {
  if (!run.reportToken) {
    throw new Error('The run has no report token')
  }
  return run.reportToken
}

async function setupRun() {
  const store = await createStore()
  store.addRepo({
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#fff',
    addedAt: 1
  })
  const automation = store.createAutomation({
    name: 'Daily check',
    prompt: 'Check changes',
    agentId: 'claude',
    projectId: 'repo-1',
    workspaceMode: 'existing',
    workspaceId: 'wt-1',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 1
  })
  const publish = vi.fn()
  const dispatcher = vi.fn<HeadlessAutomationDispatcher>(async () => ({
    workspaceId: 'wt-1',
    terminalSessionId: 'tab-1',
    terminalPaneKey: 'tab-1:leaf-1',
    terminalPtyId: 'pty-1'
  }))
  const service = new AutomationService(store, {
    onAutomationsChanged: publish,
    headlessDispatcher: dispatcher
  })
  const run = await service.runNow(automation.id)
  return { store, service, run, publish, dispatcher }
}

describe('agent-reported automation results', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-run-result-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('injects this run’s reporting command without modifying the saved task', async () => {
    const { store, service, run, dispatcher } = await setupRun()
    expect(dispatcher.mock.calls[0]?.[0].automation.prompt).toContain(
      `--run-id ${run.id} --run-token ${tokenFor(run)}`
    )
    expect(store.listAutomations()[0]?.prompt).toBe('Check changes')
    service.stop()
  })

  it('captures the SSH folder pin even for a local project, and keeps it after retargeting', async () => {
    const { store, service, run } = await setupRun()
    store.addSshTarget({ id: 'box-1', label: 'Box', host: 'box', port: 22, username: 'agent' })
    const group = store.createProjectGroup({
      name: 'SSH folders',
      createdFrom: 'manual',
      parentPath: '/remote',
      connectionId: 'box-1'
    })
    const folder = store.createFolderWorkspace({ projectGroupId: group.id, folderPath: '/remote' })
    const automation = store.updateAutomation(run.automationId, {
      workspaceId: folderWorkspaceKey(folder.id)
    })
    expect(automation.executionTargetType).toBe('local')
    const pinnedRun = store.createAutomationRun(automation, run.scheduledFor + 1)
    expect(pinnedRun.reportHostId).toBe('ssh:box-1')
    store.updateAutomation(run.automationId, { workspaceId: 'wt-1' })
    expect(
      store.listAutomationRuns().find((entry) => entry.id === pinnedRun.id)?.reportHostId
    ).toBe('ssh:box-1')
    service.stop()
  })

  it('records failure without ending the live run, and preserves it through late completion and restart', async () => {
    const { service, run, publish } = await setupRun()
    const reported = await service.reportResult({
      runId: run.id,
      token: tokenFor(run),
      status: 'failed',
      message: 'Login expired'
    })
    expect(reported.status).toBe('dispatched')
    expect(reported.result).toMatchObject({ status: 'failed', message: 'Login expired' })
    const completed = await service.markDispatchResult({
      runId: run.id,
      status: 'completed',
      error: null
    })
    expect(getAutomationRunDisplayStatus(completed.status, completed.result?.status)).toBe('failed')
    expect(publish.mock.calls.filter(([payload]) => payload.alert)).toHaveLength(1)
    service.stop()
    await closeTestStores()
    const restored = await createStore()
    expect(
      restored.listAutomationRuns().find((entry) => entry.id === run.id)?.result
    ).toMatchObject({ status: 'failed', message: 'Login expired' })
  })

  it('reports attention once and makes exact retries idempotent', async () => {
    const { service, run, publish } = await setupRun()
    const input = {
      runId: run.id,
      token: tokenFor(run),
      status: 'needs_attention' as const,
      message: 'Review the changed policy'
    }
    await service.reportResult(input)
    await service.reportResult(input)
    expect(publish.mock.calls.filter(([payload]) => payload.alert)).toHaveLength(1)
    await expect(service.reportResult({ ...input, status: 'failed' })).rejects.toThrow(
      'already reported'
    )
    service.stop()
  })

  it('refuses a token belonging to a different run and empty messages', async () => {
    const { service, run } = await setupRun()
    await expect(
      service.reportResult({
        runId: run.id,
        token: 'wrong-run',
        status: 'failed',
        message: 'Failed'
      })
    ).rejects.toThrow('token')
    await expect(
      service.reportResult({ runId: run.id, token: tokenFor(run), status: 'failed', message: '  ' })
    ).rejects.toThrow('message')
    service.stop()
  })
})
