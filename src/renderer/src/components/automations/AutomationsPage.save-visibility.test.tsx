// @vitest-environment happy-dom

/**
 * A save must change the list the user is looking at.
 *
 * The page renders the per-host cache once any host has answered, so the legacy
 * `automations` state a save writes is no longer on screen. These pin the only
 * thing the user can observe: the row is there after the save returns, whether
 * or not the authority's `automationsChanged` event ever arrives.
 */

import { act } from 'react'
import { describe, expect, it } from 'vitest'
import type { Automation } from '../../../../shared/automations-types'
import {
  AUTOMATION_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY,
  AUTOMATION_LIST_HOST_SCOPE_RUNTIME_CAPABILITY,
  AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY
} from '../../../../shared/automation-runtime-capabilities'
import { AUTOMATIONS_CHANGED_EVENT } from '@/lib/automations-changed-window-event'
import {
  addRuntimeProject,
  api,
  installAutomationsPageHarness,
  mocks,
  renderPage,
  rows,
  runtimeHost,
  RUNTIME_ID,
  RUNTIME_REPO_ID,
  RUNTIME_SELF_FILTER,
  RUNTIME_WORKSPACE_ID,
  scopedList,
  settleHostQueries
} from './automations-page-test-harness'
import { makeAutomation, REPO_ID, WORKSPACE_ID } from './automations-page-fixtures'
import { listedRow } from './automations-page-listed-items'

installAutomationsPageHarness()

const DESKTOP_SELF_FILTER = {
  kind: 'host' as const,
  host: { authority: { kind: 'desktop' as const }, selector: { kind: 'self' as const } }
}

const CREATED = makeAutomation({ id: 'a-new', name: 'Sweep' })

/** The desktop store now holds the created row; every later read must say so. */
function desktopStoreHolds(automations: Automation[]): void {
  api.automations.list.mockResolvedValue(automations)
  scopedList(automations)
}

async function createSweep(
  notifyOnFailure?: boolean,
  projectId = REPO_ID,
  workspaceId = WORKSPACE_ID
): Promise<void> {
  await act(async () => {
    mocks.listPanel?.openCreateDialog()
  })
  await act(async () => {
    mocks.editorDialog?.onDraftChange((current) => {
      if (typeof current !== 'object' || current === null) {
        throw new Error('Expected an automation draft')
      }
      return {
        ...current,
        name: 'Sweep',
        prompt: 'Do the sweep',
        ...(notifyOnFailure !== undefined ? { notifyOnFailure } : {}),
        projectId,
        workspaceMode: 'existing',
        workspaceId
      }
    })
  })
  await act(async () => {
    await mocks.editorDialog?.onSave()
  })
  await settleHostQueries()
}

describe('AutomationsPage save visibility', () => {
  it.each([true, false])(
    'saves an explicit notification setting of %s',
    async (notifyOnFailure) => {
      desktopStoreHolds([])
      mocks.state.automationHostFilter = DESKTOP_SELF_FILTER
      api.automations.create.mockResolvedValue(CREATED)
      await renderPage()
      await settleHostQueries()
      await createSweep(notifyOnFailure)
      expect(api.automations.create).toHaveBeenCalledWith(
        expect.objectContaining({ notifyOnFailure })
      )
    }
  )

  it('creates on an older runtime when the notification switch is untouched', async () => {
    desktopStoreHolds([])
    runtimeHost([], [])
    addRuntimeProject()
    mocks.state.automationHostFilter = RUNTIME_SELF_FILTER
    const capabilities = [
      AUTOMATION_LIST_HOST_SCOPE_RUNTIME_CAPABILITY,
      AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY,
      AUTOMATION_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY
    ]
    mocks.state.runtimeStatusByEnvironmentId = new Map([[RUNTIME_ID, { status: { capabilities } }]])
    mocks.getRuntimeEnvironmentStatus.mockResolvedValue({ capabilities })
    const previous = mocks.callRuntimeRpc.getMockImplementation()
    mocks.callRuntimeRpc.mockImplementation(
      async (target: unknown, method: string, params: unknown, options: unknown) => {
        if (method === 'automation.create') {
          return { automation: CREATED }
        }
        return await previous?.(target, method, params, options)
      }
    )

    await renderPage()
    await settleHostQueries()
    await createSweep(undefined, RUNTIME_REPO_ID, RUNTIME_WORKSPACE_ID)

    const createCalls = mocks.callRuntimeRpc.mock.calls.filter(
      (call) => call[1] === 'automation.create'
    )
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.[2]).toMatchObject({
      repo: `id:${RUNTIME_REPO_ID}`,
      workspace: `id:${RUNTIME_WORKSPACE_ID}`
    })
    expect(createCalls[0]?.[2]).not.toHaveProperty('notifyOnFailure')
    expect(api.automations.create).not.toHaveBeenCalled()
    expect(mocks.editorDialog?.open).toBe(false)
  })

  it('saves an explicit opt-out when editing an opted-in automation', async () => {
    const automation = makeAutomation({ notifyOnFailure: true })
    desktopStoreHolds([automation])
    mocks.state.automationHostFilter = DESKTOP_SELF_FILTER
    await renderPage()
    await settleHostQueries()
    await act(async () => {
      await mocks.listPanel?.openEditDialog(listedRow(automation.id))
    })
    await act(async () => {
      mocks.editorDialog?.onDraftChange((current) => {
        if (typeof current !== 'object' || current === null) {
          throw new Error('Expected an automation draft')
        }
        return { ...current, notifyOnFailure: false }
      })
    })
    await act(async () => {
      await mocks.editorDialog?.onSave()
    })

    expect(api.automations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: automation.id,
        updates: expect.objectContaining({ notifyOnFailure: false })
      })
    )
  })

  it('lists a newly created automation on the host it was saved to', async () => {
    desktopStoreHolds([])
    mocks.state.automationHostFilter = DESKTOP_SELF_FILTER
    api.automations.create.mockResolvedValue(CREATED)

    const { container } = await renderPage()
    await settleHostQueries()
    expect(rows(container, 'automation-row')).toEqual([])

    desktopStoreHolds([CREATED])
    await createSweep()

    expect(api.automations.create).toHaveBeenCalledTimes(1)
    expect(api.automations.create.mock.calls[0]?.[0]).not.toHaveProperty('notifyOnFailure')
    expect(rows(container, 'automation-row')).toEqual(['Sweep'])
  })

  it('lists it when the authority publishes its scoped change event', async () => {
    desktopStoreHolds([])
    mocks.state.automationHostFilter = DESKTOP_SELF_FILTER
    api.automations.create.mockResolvedValue(CREATED)

    const { container } = await renderPage()
    await settleHostQueries()

    desktopStoreHolds([CREATED])
    await createSweep()
    // What `automations:create` publishes for a Self record, verbatim.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(AUTOMATIONS_CHANGED_EVENT, {
          detail: { reason: 'definition', selector: { kind: 'self' } }
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(rows(container, 'automation-row')).toEqual(['Sweep'])
  })

  it('lists it after the page is reopened', async () => {
    desktopStoreHolds([])
    mocks.state.automationHostFilter = DESKTOP_SELF_FILTER
    api.automations.create.mockResolvedValue(CREATED)

    await renderPage()
    await settleHostQueries()
    desktopStoreHolds([CREATED])
    await createSweep()

    const reopened = await renderPage()
    await settleHostQueries()

    expect(rows(reopened.container, 'automation-row')).toEqual(['Sweep'])
  })
})
