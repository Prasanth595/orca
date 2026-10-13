import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'

type ReadyToast = {
  id: number
  title: string
  duration?: number
  label: ReactNode
  onClick: () => void
  onDismiss: () => void
  onAutoClose: () => void
}

const { toasts, store } = await vi.hoisted(async () => {
  const { createStore } = await import('zustand/vanilla')
  const toasts: ReadyToast[] = []
  const store = createStore<{
    repos: Pick<Repo, 'id' | 'kind'>[]
    activeView: 'terminal' | 'tasks'
    activeWorktreeId: string | null
    activePendingCreationId: string | null
  }>(() => ({
    repos: [],
    activeView: 'terminal',
    activeWorktreeId: null,
    activePendingCreationId: null
  }))
  return { toasts, store }
})

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    success: (
      title: string,
      options: {
        duration?: number
        action: { label: ReactNode; onClick: () => void }
        onDismiss: () => void
        onAutoClose: () => void
      }
    ) => {
      const id = toasts.length + 1
      toasts.push({
        id,
        title,
        duration: options.duration,
        ...options.action,
        onDismiss: options.onDismiss,
        onAutoClose: options.onAutoClose
      })
      return id
    }
  }
}))

vi.mock('@/store', () => ({
  useAppStore: store
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))

import { toast } from 'sonner'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { showWorktreeCreationReadyToast } from './worktree-creation-ready-toast'

const worktree = {
  id: 'repo-1::/workspace/feature',
  repoId: 'repo-1',
  displayName: 'Feature',
  branch: 'refs/heads/feature',
  path: '/workspace/feature'
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const entry of toasts) {
    entry.onDismiss()
  }
  toasts.length = 0
  store.setState({
    repos: [],
    activeView: 'terminal',
    activeWorktreeId: null,
    activePendingCreationId: null
  })
})

describe('showWorktreeCreationReadyToast', () => {
  it('names a git worktree and offers to go to it', () => {
    store.setState({ repos: [{ id: 'repo-1', kind: 'git' }] })

    showWorktreeCreationReadyToast(worktree)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.title).toBe('Worktree Feature is ready')
    expect(toasts[0]?.duration).toBe(Infinity)
    const label = renderToStaticMarkup(<>{toasts[0]?.label}</>)
    expect(label).toContain('lucide-external-link')
    expect(label).toContain('Go to worktree')

    toasts[0]?.onClick()
    expect(activateAndRevealWorktree).toHaveBeenCalledWith(worktree.id, {
      sidebarRevealBehavior: 'auto',
      navigationIntent: 'user-open'
    })
  })

  it('calls a folder repo workspace a workspace, not a worktree', () => {
    store.setState({ repos: [{ id: 'repo-1', kind: 'folder' }] })

    showWorktreeCreationReadyToast(worktree)

    expect(toasts[0]?.title).toBe('Workspace Feature is ready')
    const label = renderToStaticMarkup(<>{toasts[0]?.label}</>)
    expect(label).toContain('lucide-external-link')
    expect(label).toContain('Go to workspace')
    expect(label).not.toContain('Go to worktree')
  })

  it('keeps the worktree wording when the repo is unknown', () => {
    store.setState({ repos: [] })

    showWorktreeCreationReadyToast(worktree)

    expect(toasts[0]?.title).toBe('Worktree Feature is ready')
    expect(renderToStaticMarkup(<>{toasts[0]?.label}</>)).toContain('Go to worktree')
  })

  it('dismisses only the opened worktree notification and releases its subscription', () => {
    showWorktreeCreationReadyToast(worktree)
    showWorktreeCreationReadyToast({ ...worktree, id: 'repo-1::/workspace/other' })

    store.setState({ activeWorktreeId: 'repo-1::/workspace/unrelated' })
    expect(toast.dismiss).not.toHaveBeenCalled()
    store.setState({ activeWorktreeId: worktree.id })
    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(toasts[0]?.id)

    store.setState({ activeWorktreeId: null })
    store.setState({ activeWorktreeId: worktree.id })
    expect(toast.dismiss).toHaveBeenCalledTimes(1)
    store.setState({ activeWorktreeId: 'repo-1::/workspace/other' })
    expect(toast.dismiss).toHaveBeenLastCalledWith(toasts[1]?.id)
  })

  it('waits until the worktree is shown instead of another view or creation panel', () => {
    store.setState({ activeView: 'tasks', activeWorktreeId: worktree.id })
    showWorktreeCreationReadyToast(worktree)
    store.setState({ activeView: 'terminal', activePendingCreationId: 'creation-2' })
    expect(toast.dismiss).not.toHaveBeenCalled()

    store.setState({ activePendingCreationId: null })
    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(toasts[0]?.id)
  })

  it('does not show a late notification for a worktree already being viewed', () => {
    store.setState({ activeWorktreeId: worktree.id })
    showWorktreeCreationReadyToast(worktree)
    expect(toasts).toHaveLength(0)
  })

  it('also dismisses when a folder workspace is opened', () => {
    store.setState({ repos: [{ id: 'repo-1', kind: 'folder' }] })
    showWorktreeCreationReadyToast(worktree)
    store.setState({ activeWorktreeId: worktree.id })
    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(toasts[0]?.id)
  })

  it('matches equivalent remote workspace paths', () => {
    const remote = { ...worktree, id: 'ssh-repo::C:\\workspace\\feature' }
    showWorktreeCreationReadyToast(remote)
    store.setState({ activeWorktreeId: 'ssh-repo::c:/workspace/feature' })
    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(toasts[0]?.id)
  })

  it.each(['onDismiss', 'onAutoClose', 'onClick'] as const)(
    'releases the navigation subscription on %s',
    (callback) => {
      showWorktreeCreationReadyToast(worktree)
      toasts[0]?.[callback]()
      store.setState({ activeWorktreeId: worktree.id })
      expect(toast.dismiss).not.toHaveBeenCalled()
    }
  )
})
