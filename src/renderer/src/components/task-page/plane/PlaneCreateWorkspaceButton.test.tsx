// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem } from '../../../../../shared/plane-types'
import { planeCreateWorkspaceActionSlots } from './plane-create-workspace-action-slots'

const mocks = vi.hoisted(() => ({ openComposer: vi.fn() }))
vi.mock('./open-plane-work-item-composer', () => ({
  openPlaneWorkItemComposer: mocks.openComposer
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ openModal: vi.fn(), planeStatus: { connected: false } })
}))

const ITEM: PlaneWorkItem = {
  connectionId: 'conn-1',
  id: 'item-1',
  projectId: 'project-1',
  projectIdentifier: 'WEB',
  sequenceId: 12,
  identifier: 'WEB-12',
  name: 'Fix login redirect',
  state: null,
  priority: 'none',
  assignees: [],
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://app.plane.so/acme/projects/project-1/issues/item-1'
}

afterEach(() => {
  cleanup()
  mocks.openComposer.mockReset()
})

describe('Plane create-workspace action', () => {
  const slots = planeCreateWorkspaceActionSlots(null)

  it('stays a compact named icon in list rows', () => {
    render(<>{slots.renderRowActions(ITEM)}</>)
    const button = screen.getByRole('button', { name: 'Create workspace from WEB-12' })
    expect(button.textContent).toBe('')
  })

  it('is a labelled button in the detail view', () => {
    render(<>{slots.renderDetailActions(ITEM)}</>)
    const button = screen.getByRole('button', { name: 'Create workspace' })
    fireEvent.click(button)
    expect(mocks.openComposer).toHaveBeenCalledWith(expect.objectContaining({ item: ITEM }))
  })
})
