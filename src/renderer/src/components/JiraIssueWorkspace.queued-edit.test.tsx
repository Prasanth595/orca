// @vitest-environment happy-dom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraIssue, JiraTransition } from '../../../shared/jira-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import type { JiraPatchOptions } from '../store/slices/jira-slice-contract'
import type { AppState } from '../store/types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type * as I18n from '@/i18n/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import JiraIssueWorkspace from './JiraIssueWorkspace'
import {
  deferred,
  flushPromises,
  initialSource,
  initialSourceContextKey,
  jiraIssue,
  otherIssue,
  pendingRequests,
  saveTitle
} from './JiraIssueWorkspace.optimistic-edit.test-fixture'

const runtimeMocks = vi.hoisted(() => ({
  jiraAddIssueCommentForTarget: vi.fn(),
  jiraGetIssueForTarget: vi.fn(),
  jiraIssueCommentsForTarget: vi.fn(),
  jiraListAssignableUsersForTarget: vi.fn(),
  jiraListPrioritiesForTarget: vi.fn(),
  jiraListTransitionsForTarget: vi.fn(),
  jiraUpdateIssueForTarget: vi.fn()
}))

const store = vi.hoisted(() => ({
  patchJiraIssue:
    vi.fn<(key: string, patch: Partial<JiraIssue>, options?: JiraPatchOptions) => void>()
}))
let currentSettings: GlobalSettings | null = null

vi.mock('@/runtime/runtime-jira-client', () => runtimeMocks)
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Pick<AppState, 'settings' | 'patchJiraIssue'>) => unknown) =>
    selector({
      settings: currentSettings,
      patchJiraIssue: (key: string, patch: Partial<JiraIssue>, options?: JiraPatchOptions) =>
        store.patchJiraIssue(key, patch, options)
    })
}))
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string, options?: Parameters<typeof I18n.translate>[2]) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(options?.[key] ?? match))
}))
vi.mock('@/components/sidebar/CommentMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

let selectIssue = (_issue: JiraIssue | null): void => undefined
let selectSource = (_source: TaskSourceContext): void => undefined

// Why: the task page reads the open issue back out of the Jira store, so an
// optimistic patch hands the workspace a new object for the same issue.
function StoreBackedWorkspace({ initial }: { initial: JiraIssue }): React.JSX.Element {
  const [issue, setIssue] = useState<JiraIssue | null>(initial)
  const [source, setSource] = useState(initialSource)
  store.patchJiraIssue.mockImplementation((key, patch, options) =>
    setIssue((current) =>
      current?.key === key &&
      (options?.siteId == null || current.siteId === options.siteId) &&
      (!options?.sourceContext ||
        getTaskSourceCacheScope(options.sourceContext) === getTaskSourceCacheScope(source))
        ? { ...current, ...patch }
        : current
    )
  )
  selectIssue = setIssue
  selectSource = setSource
  return (
    <TooltipProvider>
      <JiraIssueWorkspace issue={issue} sourceContext={source} onUse={vi.fn()} onClose={vi.fn()} />
    </TooltipProvider>
  )
}

let serverTitle = 'Old title'

beforeEach(() => {
  currentSettings = null
  serverTitle = 'Old title'
  store.patchJiraIssue.mockReset()
  for (const mock of Object.values(runtimeMocks)) {
    mock.mockReset()
  }
  runtimeMocks.jiraGetIssueForTarget.mockImplementation(async () => jiraIssue(serverTitle))
  runtimeMocks.jiraIssueCommentsForTarget.mockResolvedValue([])
  runtimeMocks.jiraListTransitionsForTarget.mockResolvedValue([])
  runtimeMocks.jiraListPrioritiesForTarget.mockResolvedValue([])
  runtimeMocks.jiraListAssignableUsersForTarget.mockResolvedValue([])
})

afterEach(async () => {
  cleanup()
  await act(async () => {
    for (const reject of pendingRequests) {
      reject(new Error('Test cleanup'))
    }
    await new Promise((done) => setTimeout(done, 0))
  })
})

describe('JiraIssueWorkspace queued edits across reopens', () => {
  it('keeps a newer reopened-issue edit when an earlier save fails', async () => {
    const oldSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValue(deferred<{ ok: true }>().promise)
    runtimeMocks.jiraGetIssueForTarget.mockImplementation(
      async (_settings: unknown, key: string) =>
        key === 'ENG-2' ? otherIssue : jiraIssue('Old title')
    )
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('Old title')))
    await flushPromises()
    saveTitle('First edit', 'Latest edit')
    await flushPromises()
    await act(async () => oldSave.resolve({ ok: false, error: 'First save rejected' }))
    await flushPromises()
    expect(store.patchJiraIssue).toHaveBeenLastCalledWith(
      'ENG-1',
      expect.objectContaining({ title: 'Latest edit' }),
      { sourceContext: initialSource, siteId: 'site-1', contextKey: initialSourceContextKey }
    )
    expect(screen.getByDisplayValue('Latest edit')).toBeDefined()
  })

  it('keeps a newer reopened-issue edit when an earlier refresh returns late', async () => {
    const oldSave = deferred<{ ok: true }>()
    const oldRefresh = deferred<JiraIssue>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValue(deferred<{ ok: true }>().promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockReturnValueOnce(oldRefresh.promise)
      .mockImplementation(async (_settings: unknown, key: string) =>
        key === 'ENG-2' ? otherIssue : jiraIssue('Old title')
      )
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => oldSave.resolve({ ok: true }))
    await flushPromises()
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('Old title')))
    await flushPromises()
    saveTitle('First edit', 'Latest edit')
    await flushPromises()
    await act(async () => oldRefresh.resolve(jiraIssue('First edit')))
    await flushPromises()
    expect(store.patchJiraIssue).toHaveBeenLastCalledWith(
      'ENG-1',
      expect.objectContaining({ title: 'Latest edit' }),
      { sourceContext: initialSource, siteId: 'site-1', contextKey: initialSourceContextKey }
    )
    expect(screen.getByDisplayValue('Latest edit')).toBeDefined()
  })

  it('restores confirmed values when both reopened title saves fail', async () => {
    const oldSave = deferred<{ ok: false; error: string }>()
    const newerSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValueOnce(otherIssue)
      .mockReturnValue(deferred<JiraIssue>().promise)
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('First edit')))
    await flushPromises()
    saveTitle('First edit', 'Latest edit')
    await flushPromises()
    expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenCalledTimes(1)
    await act(async () => oldSave.resolve({ ok: false, error: 'First save rejected' }))
    await flushPromises()
    expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenCalledTimes(2)
    expect(screen.getByDisplayValue('Latest edit')).toBeDefined()
    await act(async () => newerSave.resolve({ ok: false, error: 'Second save rejected' }))
    await flushPromises()
    expect(screen.getByDisplayValue('Old title')).toBeDefined()
    expect(store.patchJiraIssue).toHaveBeenLastCalledWith(
      'ENG-1',
      { title: 'Old title' },
      { sourceContext: initialSource, siteId: 'site-1', contextKey: initialSourceContextKey }
    )
  })

  it('rolls back a failed title while preserving a newer edit to another field', async () => {
    const oldSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValue(deferred<{ ok: true }>().promise)
    const high = { id: '1', name: 'High' }
    const low = { id: '2', name: 'Low' }
    runtimeMocks.jiraListPrioritiesForTarget.mockResolvedValue([high, low])
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title', { priority: high }))
      .mockResolvedValueOnce(otherIssue)
      .mockReturnValue(deferred<JiraIssue>().promise)
    render(<StoreBackedWorkspace initial={jiraIssue('Old title', { priority: high })} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('First edit', { priority: high })))
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'High' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Low' }))
    await flushPromises()
    await act(async () => oldSave.resolve({ ok: false, error: 'Title rejected' }))
    await flushPromises()
    expect(screen.getByDisplayValue('Old title')).toBeDefined()
    expect(
      screen
        .getAllByRole('button', { name: 'Low' })
        .some((button) => button.hasAttribute('disabled'))
    ).toBe(true)
    expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenLastCalledWith(
      { kind: 'local' },
      'ENG-1',
      { priorityId: '2' },
      'site-1'
    )
  })

  it('preserves mutation order when the workspace unmounts and remounts', async () => {
    const oldSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValue(deferred<{ ok: true }>().promise)
    const mounted = render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    mounted.unmount()
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('First edit', 'Latest edit')
    await flushPromises()
    expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenCalledTimes(1)
    await act(async () => oldSave.resolve({ ok: false, error: 'First save rejected' }))
    await flushPromises()
    expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenCalledTimes(2)
    expect(screen.getByDisplayValue('Latest edit')).toBeDefined()
    expect(store.patchJiraIssue).toHaveBeenLastCalledWith(
      'ENG-1',
      { title: 'Latest edit' },
      { sourceContext: initialSource, siteId: 'site-1', contextKey: initialSourceContextKey }
    )
  })

  it.each(['account', 'host', 'site'] as const)(
    'keeps saves independent when the same issue key moves to another %s',
    async (kind) => {
      runtimeMocks.jiraGetIssueForTarget.mockImplementation(
        async (_owner: RuntimeClientTarget, _key: string, siteId: string) =>
          jiraIssue('Old title', { siteId })
      )
      const oldSave = deferred<{ ok: false; error: string }>()
      runtimeMocks.jiraUpdateIssueForTarget
        .mockReturnValueOnce(oldSave.promise)
        .mockReturnValue(deferred<{ ok: true }>().promise)
      render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
      await flushPromises()
      saveTitle('Old title', 'First edit')
      await act(async () => {
        if (kind === 'site') {
          selectIssue(jiraIssue('Old title', { siteId: 'site-2' }))
        } else {
          selectSource({
            ...initialSource,
            ...(kind === 'account'
              ? { accountLabel: 'other-account' }
              : { hostId: 'runtime:other-host' })
          })
        }
      })
      await flushPromises()
      saveTitle('Old title', 'Latest edit')
      await flushPromises()
      expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenCalledTimes(2)
      expect(runtimeMocks.jiraUpdateIssueForTarget).toHaveBeenLastCalledWith(
        kind === 'host' ? { kind: 'environment', environmentId: 'other-host' } : { kind: 'local' },
        'ENG-1',
        { title: 'Latest edit' },
        kind === 'site' ? 'site-2' : 'site-1'
      )
      await act(async () => oldSave.resolve({ ok: false, error: 'First save rejected' }))
      await flushPromises()
      expect(screen.getByDisplayValue('Latest edit')).toBeDefined()
      expect(store.patchJiraIssue).toHaveBeenLastCalledWith(
        'ENG-1',
        { title: 'Old title' },
        { sourceContext: initialSource, siteId: 'site-1', contextKey: initialSourceContextKey }
      )
    }
  )

  it('preserves a replayed save across reopened hydration and synchronizes the title draft', async () => {
    const oldSave = deferred<{ ok: true }>()
    const reopenedLoad = deferred<JiraIssue>()
    runtimeMocks.jiraUpdateIssueForTarget.mockReturnValue(oldSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValueOnce(otherIssue)
      .mockReturnValueOnce(reopenedLoad.promise)
      .mockResolvedValue(jiraIssue('First edit'))
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('Old title')))
    await flushPromises()
    expect(screen.getByDisplayValue('First edit')).toBeDefined()
    await act(async () => oldSave.resolve({ ok: true }))
    await flushPromises()
    await act(async () => reopenedLoad.resolve(jiraIssue('Old title')))
    await flushPromises()
    expect(screen.getByDisplayValue('First edit')).toBeDefined()
    expect(screen.queryByDisplayValue('Old title')).toBeNull()
  })

  it.each([
    ['succeeds', { ok: true }],
    ['fails', { ok: false, error: 'Title rejected' }]
  ] as const)(
    'preserves an unsaved title draft when an older reopened save %s',
    async (_, outcome) => {
      const oldSave = deferred<typeof outcome>()
      runtimeMocks.jiraUpdateIssueForTarget.mockReturnValue(oldSave.promise)
      runtimeMocks.jiraGetIssueForTarget
        .mockResolvedValueOnce(jiraIssue('Old title'))
        .mockResolvedValueOnce(otherIssue)
        .mockResolvedValueOnce(jiraIssue('Old title'))
        .mockResolvedValue(jiraIssue('First edit'))
      render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
      await flushPromises()
      saveTitle('Old title', 'First edit')
      await act(async () => selectIssue(otherIssue))
      await flushPromises()
      await act(async () => selectIssue(jiraIssue('Old title')))
      await flushPromises()
      fireEvent.change(screen.getByDisplayValue('First edit'), {
        target: { value: 'Unsubmitted draft' }
      })
      await act(async () => oldSave.resolve(outcome))
      await flushPromises()
      expect(screen.getByDisplayValue('Unsubmitted draft')).toBeDefined()
      expect(
        screen.getAllByRole('heading', { name: outcome.ok ? 'First edit' : 'Old title' }).length
      ).toBeGreaterThan(0)
    }
  )

  it('uses newly hydrated values as the rollback baseline for a different field', async () => {
    const oldSave = deferred<{ ok: false; error: string }>()
    const newerSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValueOnce(otherIssue)
      .mockResolvedValue(jiraIssue('Old title', { labels: ['backend'] }))
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('First edit')))
    await flushPromises()
    const labels = screen.getByDisplayValue('backend')
    fireEvent.change(labels, { target: { value: 'new' } })
    const save = labels.parentElement?.querySelector('button')
    if (!(save instanceof HTMLButtonElement)) {
      throw new Error('Missing labels save button')
    }
    fireEvent.click(save)
    await flushPromises()
    await act(async () => oldSave.resolve({ ok: false, error: 'Title rejected' }))
    await flushPromises()
    expect(screen.getByDisplayValue('new')).toBeDefined()
    await act(async () => newerSave.resolve({ ok: false, error: 'Labels rejected' }))
    await flushPromises()
    expect(screen.getByDisplayValue('Old title')).toBeDefined()
    expect(screen.getByDisplayValue('backend')).toBeDefined()
  })

  it('reloads transitions on a reopened issue when its earlier status save completes', async () => {
    const oldSave = deferred<{ ok: true }>()
    const reopenedTransitions = deferred<JiraTransition[]>()
    const inProgress = {
      id: '3',
      name: 'In Progress',
      categoryKey: 'indeterminate',
      categoryName: 'In Progress'
    }
    const start = { id: '11', name: 'Start progress', to: inProgress }
    const done = { id: '4', name: 'Done', categoryKey: 'done', categoryName: 'Done' }
    runtimeMocks.jiraListTransitionsForTarget
      .mockResolvedValueOnce([start])
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(reopenedTransitions.promise)
      .mockResolvedValue([{ id: '21', name: 'Finish', to: done }])
    runtimeMocks.jiraUpdateIssueForTarget.mockReturnValue(oldSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValueOnce(otherIssue)
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValue(jiraIssue('Old title', { status: inProgress }))
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'Change status: To Do' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start progress' }))
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('Old title')))
    await flushPromises()
    await act(async () => oldSave.resolve({ ok: true }))
    await flushPromises()
    expect(runtimeMocks.jiraListTransitionsForTarget).toHaveBeenCalledTimes(4)
    await act(async () => reopenedTransitions.resolve([start]))
    await flushPromises()
    if (!screen.queryByRole('button', { name: 'Finish' })) {
      fireEvent.click(screen.getByRole('button', { name: 'Change status: In Progress' }))
    }
    expect(await screen.findByRole('button', { name: 'Finish' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Start progress' })).toBeNull()
  })

  it('keeps a newer hydrated rollback baseline when an older refresh returns stale fields', async () => {
    const oldSave = deferred<{ ok: true }>()
    const oldRefresh = deferred<JiraIssue>()
    const newerSave = deferred<{ ok: false; error: string }>()
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockReturnValueOnce(oldRefresh.promise)
      .mockResolvedValueOnce(otherIssue)
      .mockResolvedValue(jiraIssue('First edit', { labels: ['backend'] }))
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    saveTitle('Old title', 'First edit')
    await act(async () => oldSave.resolve({ ok: true }))
    await flushPromises()
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('First edit')))
    await flushPromises()
    const labels = screen.getByDisplayValue('backend')
    fireEvent.change(labels, { target: { value: 'new' } })
    const save = labels.parentElement?.querySelector('button')
    if (!(save instanceof HTMLButtonElement)) {
      throw new Error('Missing labels save button')
    }
    fireEvent.click(save)
    await flushPromises()
    await act(async () => oldRefresh.resolve(jiraIssue('First edit')))
    await flushPromises()
    await act(async () => newerSave.resolve({ ok: false, error: 'Labels rejected' }))
    await flushPromises()
    expect(screen.getByDisplayValue('backend')).toBeDefined()
  })

  it('reloads transitions when the last queued status save fails after an earlier success', async () => {
    const oldSave = deferred<{ ok: true }>()
    const newerSave = deferred<{ ok: false; error: string }>()
    const inProgress = {
      id: '3',
      name: 'In Progress',
      categoryKey: 'indeterminate',
      categoryName: 'In Progress'
    }
    const done = { id: '4', name: 'Done', categoryKey: 'done', categoryName: 'Done' }
    const start = { id: '11', name: 'Start progress', to: inProgress }
    const finish = { id: '21', name: 'Finish', to: done }
    runtimeMocks.jiraListTransitionsForTarget
      .mockResolvedValueOnce([start])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([start, finish])
      .mockResolvedValue([finish])
    runtimeMocks.jiraUpdateIssueForTarget
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    runtimeMocks.jiraGetIssueForTarget
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValueOnce(otherIssue)
      .mockResolvedValueOnce(jiraIssue('Old title'))
      .mockResolvedValue(jiraIssue('Old title', { status: inProgress }))
    render(<StoreBackedWorkspace initial={jiraIssue('Old title')} />)
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'Change status: To Do' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start progress' }))
    await act(async () => selectIssue(otherIssue))
    await flushPromises()
    await act(async () => selectIssue(jiraIssue('Old title')))
    await flushPromises()
    if (!screen.queryByRole('button', { name: 'Finish' })) {
      fireEvent.click(screen.getByRole('button', { name: 'Change status: In Progress' }))
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }))
    await act(async () => oldSave.resolve({ ok: true }))
    await flushPromises()
    await act(async () => newerSave.resolve({ ok: false, error: 'Status rejected' }))
    await flushPromises()
    expect(runtimeMocks.jiraListTransitionsForTarget).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('button', { name: 'Start progress' })).toBeNull()
  })
})
