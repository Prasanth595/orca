// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem } from '../../../../../shared/plane-types'
import { PlaneWorkItemDetail } from './PlaneWorkItemDetail'

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  listComments: vi.fn(),
  openUrl: vi.fn()
}))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeGetWorkItemForTarget: mocks.getWorkItem,
  planeListCommentsForTarget: mocks.listComments,
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('@/components/plane/use-plane-host-label', () => ({
  usePlaneHostLabel: () => 'Local Mac'
}))

const TARGET = { kind: 'local' } as const
const HTML = '<img src=x onerror="alert(1)"><b>bold</b>'
const ITEM: PlaneWorkItem = {
  connectionId: 'conn-1',
  id: 'item-1',
  projectId: 'project-1',
  projectIdentifier: 'WEB',
  sequenceId: 12,
  identifier: 'WEB-12',
  name: 'Fix login redirect',
  state: { id: 'state-1', name: 'In Progress', group: 'started', color: '', sequence: 1 },
  priority: 'high',
  assignees: [{ id: 'ada', displayName: 'Ada Lovelace' }],
  labels: [{ id: 'bug', name: 'bug', color: '' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://app.plane.so/acme/projects/project-1/issues/item-1'
}

beforeEach(() => {
  mocks.getWorkItem.mockReset().mockResolvedValue({
    ok: true,
    value: { ...ITEM, descriptionText: HTML, truncated: true }
  })
  mocks.listComments.mockReset().mockResolvedValue({
    ok: true,
    value: [{ id: 'c1', authorName: 'Bob', text: `See ${HTML}`, createdAt: '2026-01-03T00:00:00Z' }]
  })
  vi.stubGlobal('window', Object.assign(window, { api: { shell: { openUrl: mocks.openUrl } } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PlaneWorkItemDetail', () => {
  it('renders the description and comments as literal text, never as HTML', async () => {
    render(<PlaneWorkItemDetail item={ITEM} target={TARGET} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(HTML)).toBeTruthy())
    expect(screen.getByText(`See ${HTML}`)).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
    expect(
      screen.getByText('The description was shortened. Open in Plane to read all of it.')
    ).toBeTruthy()
  })

  it('shows metadata and opens the item in Plane', async () => {
    render(<PlaneWorkItemDetail item={ITEM} target={TARGET} onClose={vi.fn()} />)

    expect(screen.getByText('WEB-12')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('bug')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Plane' }))
    expect(mocks.openUrl).toHaveBeenCalledWith(ITEM.url)
    await waitFor(() => expect(mocks.listComments).toHaveBeenCalledOnce())
  })

  it('skips the detail request when the item already carries its description', async () => {
    render(
      <PlaneWorkItemDetail
        item={{ ...ITEM, descriptionText: 'Already here', truncated: false }}
        target={TARGET}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Already here')).toBeTruthy()
    await waitFor(() => expect(mocks.listComments).toHaveBeenCalledOnce())
    expect(mocks.getWorkItem).not.toHaveBeenCalled()
  })

  it('renders slots for later actions without adding its own', () => {
    render(
      <PlaneWorkItemDetail
        item={ITEM}
        target={TARGET}
        onClose={vi.fn()}
        actions={<button type="button">Slot action</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Slot action' })).toBeTruthy()
  })

  it('names the failure by kind', async () => {
    mocks.getWorkItem.mockResolvedValue({ ok: false, error: { kind: 'not_found', message: 'x' } })
    render(<PlaneWorkItemDetail item={ITEM} target={TARGET} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Plane could not find that item. It may have been moved or deleted.'
      )
    )
  })
})
