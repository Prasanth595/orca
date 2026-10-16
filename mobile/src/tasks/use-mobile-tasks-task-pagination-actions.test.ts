import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountFixture } from '../test-support/rpc-recording/recorder-fixture-shape'
import { useMobileTasksTaskPaginationActions } from './use-mobile-tasks-task-pagination-actions'

vi.mock('./mobile-tasks-dependencies', async () => {
  const { useCallback, useMemo } = await import('react')
  return { useCallback, useMemo, CROSS_REPO_DISPLAY_LIMIT: 2, PER_REPO_FETCH_LIMIT: 2 }
})
vi.mock(
  './mobile-tasks-legacy-foundation',
  async () => import('./mobile-tasks-repository-presentation')
)
vi.mock('./mobile-task-list-operations', () => ({ linearAccountConnect: {} }))

type Model = Parameters<typeof useMobileTasksTaskPaginationActions>[0]
type PageResult = Awaited<ReturnType<Model['fetchGitHubItemsPage']>>

const mounted: ReactTestRenderer[] = []

afterEach(() => {
  act(() => {
    for (const renderer of mounted.splice(0)) {
      renderer.unmount()
    }
  })
})

function item(key: string) {
  return { key, provider: 'github' as const, updatedAt: `2026-01-0${key.length}T00:00:00Z` }
}

function mountPagination() {
  const client = { close: () => {} }
  const loadGenerationRef = { current: 1 }
  let resolvePage: (page: PageResult) => void = () => {}
  const fetchGitHubItemsPage = vi.fn(
    () =>
      new Promise<PageResult>((resolve) => {
        resolvePage = resolve
      })
  )
  const setItems = vi.fn()
  const setGithubPages = vi.fn()
  const setError = vi.fn()
  const setGithubPaginationLoading = vi.fn()
  const holder: { change?: (page: number) => Promise<void> } = {}

  function Probe() {
    holder.change = useMobileTasksTaskPaginationActions(
      mountFixture<Model>({
        client,
        clientRef: { current: client },
        loadGenerationRef,
        fetchGitHubItemsPage,
        githubCurrentPage: 0,
        githubPages: [[item('a'), item('bb')]],
        githubPaginationLoading: false,
        githubTotalCount: null,
        selectedHostedRepos: [{ id: 'repo-a', path: '/a' }],
        setError,
        setGithubCurrentPage: vi.fn(),
        setGithubLoadingTargetPage: vi.fn(),
        setGithubPages,
        setGithubPaginationLoading,
        setItems,
        taskUiReady: true,
        tasksSupported: true
      })
    ).handleGitHubPageChange
    return null
  }

  act(() => {
    mounted.push(create(createElement(Probe)))
  })
  return {
    loadGenerationRef,
    setItems,
    setGithubPages,
    setGithubPaginationLoading,
    change: (page: number) => holder.change?.(page) ?? Promise.resolve(),
    resolvePage: (page: PageResult) => resolvePage(page)
  }
}

const nextPage = mountFixture<PageResult>({ items: [item('ccc')], failedCount: 0 })

describe('GitHub task pagination', () => {
  it('shows the next page when the selection is unchanged', async () => {
    const harness = mountPagination()
    const pending = harness.change(1)
    await act(async () => {
      harness.resolvePage(nextPage)
      await pending
    })
    expect(harness.setGithubPages).toHaveBeenCalledTimes(1)
    expect(harness.setItems).toHaveBeenCalledWith(nextPage.items)
    expect(harness.setGithubPaginationLoading).toHaveBeenLastCalledWith(false)
  })

  it('drops a page that arrives after the list was reloaded for a new selection', async () => {
    const harness = mountPagination()
    const pending = harness.change(1)
    harness.loadGenerationRef.current += 1
    await act(async () => {
      harness.resolvePage(nextPage)
      await pending
    })
    expect(harness.setGithubPages).not.toHaveBeenCalled()
    expect(harness.setItems).not.toHaveBeenCalled()
    // The reloading list releases the pagination lock, so a superseded page must not.
    expect(harness.setGithubPaginationLoading).not.toHaveBeenCalledWith(false)
  })
})
