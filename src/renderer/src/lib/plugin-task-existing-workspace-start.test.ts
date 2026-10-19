import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const store = {
    repos: [{ id: 'repo-1', connectionId: null }],
    worktrees: [{ id: 'wt-1', repoId: 'repo-1', path: 'C:\\work\\wt-1' }],
    allWorktrees: vi.fn(() => store.worktrees)
  }
  return {
    store,
    activateAndRevealWorktree: vi.fn(),
    focusTerminalTabSurface: vi.fn(),
    launchAgentInNewTab: vi.fn(),
    persistCreatedWorkspacePluginTaskLink: vi.fn(),
    resolveRepoWorktreeLaunchPlatform: vi.fn(),
    toastError: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.store
  }
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError
  }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/lib/execution-host-facts', () => ({
  resolveRepoWorktreeLaunchPlatform: mocks.resolveRepoWorktreeLaunchPlatform
}))

vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))

vi.mock('@/lib/plugin-task-workspace-link', () => ({
  persistCreatedWorkspacePluginTaskLink: mocks.persistCreatedWorkspacePluginTaskLink
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))

const { startTaskInExistingWorkspace } = await import('./plugin-task-existing-workspace-start')

const LINK = {
  pluginKey: 'dev.agent-work',
  sourceId: 'board',
  itemId: 'job:night.md',
  title: 'Night job',
  sourceTitle: 'Agent Work'
}

describe('startTaskInExistingWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.store.worktrees = [{ id: 'wt-1', repoId: 'repo-1', path: 'C:\\work\\wt-1' }]
    mocks.activateAndRevealWorktree.mockReturnValue(true)
    mocks.resolveRepoWorktreeLaunchPlatform.mockReturnValue('win32')
    mocks.launchAgentInNewTab.mockImplementation(
      (args: { beforeSurfaceOpen?: (surface: { kind: 'local-terminal' }) => boolean | void }) =>
        args.beforeSurfaceOpen?.({ kind: 'local-terminal' }) === false
          ? null
          : { surface: { kind: 'local-terminal', tabId: 'tab-1' } }
    )
  })

  it('opens the agent in the workspace with the prompt as a draft and links the task', () => {
    expect(
      startTaskInExistingWorkspace({
        agent: 'claude',
        worktreeId: 'wt-1',
        prompt: 'Resume the relay.',
        link: LINK,
        sessionOptions: { model: 'opus' }
      })
    ).toBe(true)

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        worktreeId: 'wt-1',
        prompt: 'Resume the relay.',
        promptDelivery: 'draft',
        launchPlatform: 'win32',
        launchSource: 'task_page',
        sessionOptions: { model: 'opus' }
      })
    )
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1', {
      providesInitialSurface: true
    })
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('tab-1')
    expect(mocks.persistCreatedWorkspacePluginTaskLink).toHaveBeenCalledWith('wt-1', LINK)
  })

  it('writes no link when the launch cannot be built', () => {
    mocks.launchAgentInNewTab.mockReturnValue(null)

    expect(
      startTaskInExistingWorkspace({
        agent: 'claude',
        worktreeId: 'wt-1',
        prompt: 'Go',
        link: LINK
      })
    ).toBe(false)

    expect(mocks.persistCreatedWorkspacePluginTaskLink).not.toHaveBeenCalled()
    expect(mocks.focusTerminalTabSurface).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not build the agent launch command.')
  })

  it('writes no link when the workspace cannot be revealed', () => {
    mocks.activateAndRevealWorktree.mockReturnValue(false)

    expect(
      startTaskInExistingWorkspace({
        agent: 'claude',
        worktreeId: 'wt-1',
        prompt: 'Go',
        link: LINK
      })
    ).toBe(false)

    expect(mocks.persistCreatedWorkspacePluginTaskLink).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Unable to open that workspace.')
  })

  it('does not launch when the workspace is gone', () => {
    expect(
      startTaskInExistingWorkspace({
        agent: 'claude',
        worktreeId: 'wt-gone',
        prompt: 'Go',
        link: LINK
      })
    ).toBe(false)

    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
    expect(mocks.persistCreatedWorkspacePluginTaskLink).not.toHaveBeenCalled()
  })

  it('does not launch without an agent', () => {
    expect(
      startTaskInExistingWorkspace({ agent: null, worktreeId: 'wt-1', prompt: 'Go', link: LINK })
    ).toBe(false)

    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })
})
