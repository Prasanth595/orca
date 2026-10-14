// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem, PlaneWorkItemList } from '../../../../../shared/plane-types'
import { PLANE_FOCUS_REFRESH_MIN_MS, usePlaneWorkItems } from './use-plane-work-items'

const mocks = vi.hoisted(() => ({ listWorkItems: vi.fn(), listStates: vi.fn() }))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeListWorkItemsForTarget: mocks.listWorkItems,
  planeListStatesForTarget: mocks.listStates,
  isPlaneRuntimeUpdateRequiredError: () => false
}))

const TARGET = { kind: 'local' } as const

function workItem(id: string): PlaneWorkItem {
  return {
    connectionId: 'conn-1',
    id,
    projectId: 'web',
    projectIdentifier: 'WEB',
    sequenceId: 1,
    identifier: `WEB-${id}`,
    name: id,
    state: null,
    priority: 'none',
    assignees: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    url: 'https://plane.example'
  }
}

function list(items: PlaneWorkItem[], extra: Partial<PlaneWorkItemList> = {}) {
  return {
    ok: true,
    value: {
      items,
      errors: [],
      missingProjectIds: [],
      truncatedProjectIds: [],
      totalCapped: false,
      ...extra
    }
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
  mocks.listWorkItems.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePlaneWorkItems', () => {
  it('drops the answer of a request superseded by a project change', async () => {
    const initialProps: { projectId: string | null } = { projectId: null }
    const first = deferred<ReturnType<typeof list>>()
    mocks.listWorkItems
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(list([workItem('api')]))
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) =>
        usePlaneWorkItems({ target: TARGET, sourceKey: 'source', projectId }),
      { initialProps }
    )

    rerender({ projectId: 'api' })
    await act(async () => {})
    await act(async () => first.resolve(list([workItem('stale')])))

    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, { projectIds: ['api'] })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['api'])
  })

  it('refreshes on focus only after a minute has passed, and never polls', async () => {
    mocks.listWorkItems.mockResolvedValue(list([]))
    renderHook(() => usePlaneWorkItems({ target: TARGET, sourceKey: 'source', projectId: null }))
    await act(async () => {})
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + PLANE_FOCUS_REFRESH_MIN_MS - 1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2)
    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, { refresh: true })

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2)
  })

  it('refreshes on demand and keeps showing the list meanwhile', async () => {
    mocks.listWorkItems.mockResolvedValueOnce(list([workItem('1')]))
    const { result } = renderHook(() =>
      usePlaneWorkItems({ target: TARGET, sourceKey: 'source', projectId: null })
    )
    await act(async () => {})
    const pending = deferred<ReturnType<typeof list>>()
    mocks.listWorkItems.mockReturnValueOnce(pending.promise)

    act(() => result.current.refresh())
    expect(result.current.state).toMatchObject({ status: 'ready', refreshing: true })
    await act(async () => pending.resolve(list([workItem('2')])))
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['2'])
  })

  it('loads the next page of one project and appends it', async () => {
    mocks.listWorkItems.mockResolvedValueOnce(
      list([workItem('1')], {
        truncatedProjectIds: ['web'],
        nextCursorByProject: { web: '100:1:0' }
      })
    )
    const { result } = renderHook(() =>
      usePlaneWorkItems({ target: TARGET, sourceKey: 'source', projectId: null })
    )
    await act(async () => {})
    mocks.listWorkItems.mockResolvedValueOnce(list([workItem('2')]))

    await act(async () => result.current.loadMore('web'))

    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, {
      projectIds: ['web'],
      cursorByProject: { web: '100:1:0' }
    })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['1', '2'])
    expect(result.current.state.truncatedProjectIds).toEqual([])
  })
})
