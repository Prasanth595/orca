// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem, PlaneWorkItemList } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import {
  PLANE_FOCUS_REFRESH_MIN_MS,
  usePlaneProjectStates,
  usePlaneWorkItems,
  type PlaneWorkItemSource
} from './use-plane-work-items'

const mocks = vi.hoisted(() => ({ listWorkItems: vi.fn(), listStates: vi.fn() }))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeListWorkItemsForTarget: mocks.listWorkItems,
  planeListStatesForTarget: mocks.listStates,
  isPlaneRuntimeUpdateRequiredError: () => false
}))

const TARGET = { kind: 'local' } as const
const ONE: PlaneWorkItemSource[] = [{ connectionId: 'conn-1', projectId: null }]

function workItem(id: string, connectionId = 'conn-1'): PlaneWorkItem {
  return {
    connectionId,
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

const ids = (items: PlaneWorkItem[]) => items.map((entry) => entry.id)

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
    const first = deferred<ReturnType<typeof list>>()
    mocks.listWorkItems
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(list([workItem('api')]))
    const initialProps: { sources: PlaneWorkItemSource[] } = { sources: ONE }
    const { result, rerender } = renderHook(
      ({ sources }: { sources: PlaneWorkItemSource[] }) =>
        usePlaneWorkItems({ target: TARGET, sourceKey: 'source', sources }),
      { initialProps }
    )

    rerender({ sources: [{ connectionId: 'conn-1', projectId: 'api' }] })
    await act(async () => {})
    await act(async () => first.resolve(list([workItem('stale')])))

    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, {
      connectionId: 'conn-1',
      projectIds: ['api']
    })
    expect(ids(result.current.items)).toEqual(['api'])
  })

  it('refreshes on focus only after a minute has passed, and never polls', async () => {
    mocks.listWorkItems.mockResolvedValue(list([]))
    renderHook(() => usePlaneWorkItems({ target: TARGET, sourceKey: 'source', sources: ONE }))
    await act(async () => {})
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + PLANE_FOCUS_REFRESH_MIN_MS - 1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2)
    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, {
      connectionId: 'conn-1',
      refresh: true
    })

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2)
  })

  it('refreshes on demand and keeps showing the list meanwhile', async () => {
    mocks.listWorkItems.mockResolvedValueOnce(list([workItem('1')]))
    const { result } = renderHook(() =>
      usePlaneWorkItems({ target: TARGET, sourceKey: 'source', sources: ONE })
    )
    await act(async () => {})
    const pending = deferred<ReturnType<typeof list>>()
    mocks.listWorkItems.mockReturnValueOnce(pending.promise)

    act(() => result.current.refresh())
    expect(result.current.states['conn-1']).toMatchObject({ status: 'ready', refreshing: true })
    await act(async () => pending.resolve(list([workItem('2')])))
    expect(ids(result.current.items)).toEqual(['2'])
  })

  it('loads the next page of one connection and project and appends it', async () => {
    mocks.listWorkItems.mockResolvedValueOnce(
      list([workItem('1')], {
        truncatedProjectIds: ['web'],
        nextCursorByProject: { web: '100:1:0' }
      })
    )
    const { result } = renderHook(() =>
      usePlaneWorkItems({ target: TARGET, sourceKey: 'source', sources: ONE })
    )
    await act(async () => {})
    mocks.listWorkItems.mockResolvedValueOnce(list([workItem('2')]))

    await act(async () => result.current.loadMore('conn-1', 'web'))

    expect(mocks.listWorkItems).toHaveBeenLastCalledWith(TARGET, {
      connectionId: 'conn-1',
      projectIds: ['web'],
      cursorByProject: { web: '100:1:0' }
    })
    expect(ids(result.current.items)).toEqual(['1', '2'])
    expect(result.current.states['conn-1'].truncatedProjectIds).toEqual([])
  })

  it('lets load-more run again after a refresh drops a pending one', async () => {
    const page = list([workItem('1')], {
      truncatedProjectIds: ['web'],
      nextCursorByProject: { web: '100:1:0' }
    })
    mocks.listWorkItems.mockResolvedValueOnce(page)
    const { result } = renderHook(() =>
      usePlaneWorkItems({ target: TARGET, sourceKey: 'source', sources: ONE })
    )
    await act(async () => {})
    const stale = deferred<ReturnType<typeof list>>()
    mocks.listWorkItems.mockReturnValueOnce(stale.promise)
    act(() => result.current.loadMore('conn-1', 'web'))

    mocks.listWorkItems.mockResolvedValueOnce(page)
    await act(async () => result.current.refresh())
    mocks.listWorkItems.mockResolvedValueOnce(list([workItem('2')]))
    await act(async () => result.current.loadMore('conn-1', 'web'))
    await act(async () => stale.resolve(list([workItem('stale')])))

    expect(mocks.listWorkItems).toHaveBeenCalledTimes(4)
    expect(ids(result.current.items)).toEqual(['1', '2'])
  })

  it('lists several workspaces with one request each and keeps a failure to its own', async () => {
    mocks.listWorkItems.mockImplementation(async (_target, params: { connectionId: string }) =>
      params.connectionId === 'conn-2'
        ? { ok: false, error: { kind: 'forbidden', message: 'x' } }
        : list([workItem('1', params.connectionId)])
    )
    const { result } = renderHook(() =>
      usePlaneWorkItems({
        target: TARGET,
        sourceKey: 'source',
        sources: [...ONE, { connectionId: 'conn-2', projectId: null }]
      })
    )
    await act(async () => {})

    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2)
    expect(result.current.states['conn-1'].status).toBe('ready')
    expect(result.current.states['conn-2']).toMatchObject({ status: 'error', error: 'forbidden' })
    expect(result.current.items.map((item) => item.connectionId)).toEqual(['conn-1'])
  })

  it('replaces an item only in its own workspace', async () => {
    mocks.listWorkItems.mockImplementation(async (_target, params: { connectionId: string }) =>
      list([workItem('1', params.connectionId)])
    )
    const { result } = renderHook(() =>
      usePlaneWorkItems({
        target: TARGET,
        sourceKey: 'source',
        sources: [...ONE, { connectionId: 'conn-2', projectId: null }]
      })
    )
    await act(async () => {})

    act(() => result.current.replaceItem({ ...workItem('1', 'conn-2'), name: 'renamed' }))

    expect(result.current.states['conn-1'].items[0].name).toBe('1')
    expect(result.current.states['conn-2'].items[0].name).toBe('renamed')
  })
})

describe('usePlaneProjectStates', () => {
  it('fetches states again when the same connection runs on another host', async () => {
    const state = (name: string) => ({ id: name, name, group: 'started', color: '#000' })
    mocks.listStates.mockReset()
    mocks.listStates
      .mockResolvedValueOnce({ ok: true, value: [state('Local')] })
      .mockResolvedValueOnce({ ok: true, value: [state('Remote')] })
    const remote: RuntimeClientTarget = { kind: 'environment', environmentId: 'env-1' }
    const { result, rerender } = renderHook<
      ReturnType<typeof usePlaneProjectStates>,
      { target: RuntimeClientTarget }
    >(({ target }) => usePlaneProjectStates(target, 'conn-1', 'web'), {
      initialProps: { target: TARGET }
    })
    await act(async () => {})
    expect(result.current.map((entry) => entry.name)).toEqual(['Local'])

    rerender({ target: remote })
    await act(async () => {})

    expect(mocks.listStates).toHaveBeenLastCalledWith(remote, 'web', 'conn-1')
    expect(result.current.map((entry) => entry.name)).toEqual(['Remote'])
  })
})
