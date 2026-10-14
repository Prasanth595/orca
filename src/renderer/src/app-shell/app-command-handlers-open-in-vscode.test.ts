import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  detectedListingFixture,
  repoFixture,
  worktreeFixture
} from '../components/native-chat/native-chat-workspace-test-fixtures'
import { makeFolderWorkspace } from '../store/slices/worktrees-slice-test-fixtures'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type { ShellOpenExternalEditorResult } from '../../../shared/shell-open-types'
import { PLUGIN_COMMAND_ALIAS_ACTION_IDS } from '../../../shared/plugins/plugin-command-actions'
import type { AppShortcutState, ShortcutDispatchInput } from './app-command-handlers'

const mocks = vi.hoisted(() => {
  const store: Pick<
    AppState,
    | 'activeWorktreeId'
    | 'activeWorkspaceExecutionHostId'
    | 'worktreesByRepo'
    | 'detectedWorktreesByRepo'
    | 'folderWorkspaces'
    | 'floatingWorkspacePath'
    | 'repos'
    | 'projectGroups'
    | 'runtimeEnvironments'
    | 'runtimeEnvironmentCatalogHydrated'
  > = {
    activeWorktreeId: 'repo::/workspace',
    activeWorkspaceExecutionHostId: 'local',
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    floatingWorkspacePath: null,
    repos: [],
    projectGroups: [],
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: true
  }
  return {
    store,
    floatingFocused: false,
    notifyTerminalCapture: vi.fn(),
    openInExternalEditor: vi.fn<() => Promise<ShellOpenExternalEditorResult>>(),
    toastError: vi.fn()
  }
})

vi.mock('../store', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: () => mocks.store })
}))
vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  isFloatingWorkspacePanelFocused: () => mocks.floatingFocused
}))
vi.mock('@/lib/terminal-shortcut-capture-notification', () => ({
  showTerminalShortcutCaptureNotification: mocks.notifyTerminalCapture
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { createAppCommandHandlers } from './app-command-handlers'

function shortcutState(overrides: Partial<AppShortcutState> = {}): AppShortcutState {
  return {
    activeView: 'terminal',
    activeWorktreeId: mocks.store.activeWorktreeId,
    actions: {
      toggleSidebar: vi.fn(),
      toggleRightSidebar: vi.fn(),
      setRightSidebarOpen: vi.fn(),
      setRightSidebarTab: vi.fn(),
      showRightSidebarFiles: vi.fn(),
      showRightSidebarSearch: vi.fn(),
      openDiffNotesSendMenuForActiveWorktree: vi.fn()
    },
    creationLayoutActive: false,
    floatingTerminalEnabled: false,
    floatingTerminalOpen: false,
    floatingVisibleTabCount: 0,
    keybindings: { 'workspace.openInVSCode': ['Mod+Alt+V'] },
    openFloatingWorkspaceMaximized: vi.fn(),
    pluginCommands: [],
    setFloatingTerminalOpen: vi.fn(),
    terminalShortcutPolicy: 'orca-first',
    workspaceChromeActive: true,
    ...overrides
  }
}

function shortcutInput(): ShortcutDispatchInput {
  return { target: null, defaultPrevented: false, preventDefault: vi.fn() }
}

function runOpen(
  input: ShortcutDispatchInput = shortcutInput(),
  state: AppShortcutState = shortcutState()
): boolean | undefined {
  const actionId = PLUGIN_COMMAND_ALIAS_ACTION_IDS.find((id) => id === 'workspace.openInVSCode')
  return actionId && createAppCommandHandlers(state, input, 'terminal').get(actionId)?.()
}

describe('open workspace in VS Code command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.floatingFocused = false
    mocks.store.activeWorktreeId = 'repo::/workspace'
    mocks.store.activeWorkspaceExecutionHostId = 'local'
    mocks.store.repos = [repoFixture()]
    mocks.store.worktreesByRepo = {
      repo: [worktreeFixture('repo::/workspace', '/workspace', { hostId: 'local' })]
    }
    mocks.store.detectedWorktreesByRepo = {}
    mocks.store.folderWorkspaces = []
    mocks.openInExternalEditor.mockResolvedValue({ ok: true })
    vi.stubGlobal('window', {
      api: { shell: { openInExternalEditor: mocks.openInExternalEditor } }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('opens the active worktree with the VS Code command', () => {
    const input = shortcutInput()

    expect(runOpen(input)).toBe(true)

    expect(input.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.openInExternalEditor).toHaveBeenCalledExactlyOnceWith({
      path: '/workspace',
      command: 'code',
      connectionId: null,
      ownerHostId: 'local'
    })
    expect(mocks.notifyTerminalCapture).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'workspace.openInVSCode' })
    )
  })

  it('opens the selected SSH host instead of a local row with the same workspace id', () => {
    mocks.store.activeWorkspaceExecutionHostId = 'ssh:box'
    mocks.store.worktreesByRepo = {
      repo: [
        worktreeFixture('repo::/workspace', '/local/workspace', { hostId: 'local' }),
        worktreeFixture('repo::/workspace', '/remote/workspace', { hostId: 'ssh:box' })
      ]
    }

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).toHaveBeenCalledExactlyOnceWith({
      path: '/remote/workspace',
      command: 'code',
      connectionId: 'box',
      ownerHostId: 'ssh:box'
    })
  })

  it('opens a legacy local workspace without host stamps', () => {
    mocks.store.activeWorkspaceExecutionHostId = null
    mocks.store.worktreesByRepo = {
      repo: [worktreeFixture('repo::/workspace', '/legacy')]
    }

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/legacy', ownerHostId: 'local' })
    )
  })

  it('refuses ambiguous workspace ownership without a selected host', () => {
    mocks.store.activeWorkspaceExecutionHostId = null
    mocks.store.worktreesByRepo = {
      repo: [
        worktreeFixture('repo::/workspace', '/local/workspace', { hostId: 'local' }),
        worktreeFixture('repo::/workspace', '/remote/workspace', { hostId: 'ssh:box' })
      ]
    }
    const input = shortcutInput()

    expect(runOpen(input)).toBe(false)

    expect(input.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openInExternalEditor).not.toHaveBeenCalled()
  })

  it('opens a folder workspace without a git worktree row', () => {
    mocks.store.activeWorktreeId = folderWorkspaceKey('folder-1')
    mocks.store.folderWorkspaces = [makeFolderWorkspace({ folderPath: '/plain-folder' })]

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/plain-folder', command: 'code', ownerHostId: 'local' })
    )
  })

  it('opens an SSH folder workspace through its SSH host', () => {
    mocks.store.activeWorktreeId = folderWorkspaceKey('folder-1')
    mocks.store.activeWorkspaceExecutionHostId = 'ssh:box'
    mocks.store.folderWorkspaces = [
      makeFolderWorkspace({ folderPath: '/remote/folder', connectionId: 'box' })
    ]

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).toHaveBeenCalledWith({
      path: '/remote/folder',
      command: 'code',
      connectionId: 'box',
      ownerHostId: 'ssh:box'
    })
  })

  it('opens a detected workspace that has no visible catalog row', () => {
    mocks.store.worktreesByRepo = {}
    mocks.store.detectedWorktreesByRepo = {
      repo: detectedListingFixture([
        worktreeFixture('repo::/workspace', '/detected', { hostId: 'local' })
      ])
    }

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/detected', ownerHostId: 'local' })
    )
  })

  it('preserves the existing refusal for a workspace on a paired runtime', () => {
    mocks.store.activeWorkspaceExecutionHostId = 'runtime:server'
    mocks.store.worktreesByRepo = {
      repo: [
        worktreeFixture('repo::/workspace', '/remote/workspace', {
          hostId: 'runtime:server',
          runtimeOwnerEnvironmentId: 'server'
        })
      ]
    }

    expect(runOpen()).toBe(true)

    expect(mocks.openInExternalEditor).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Opening this path in a local app is not available.',
      expect.any(Object)
    )
  })

  it('does not open a local path for an unresolved selected host', () => {
    mocks.store.activeWorkspaceExecutionHostId = 'ssh:missing'
    const input = shortcutInput()

    expect(runOpen(input)).toBe(false)

    expect(input.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openInExternalEditor).not.toHaveBeenCalled()
  })

  it.each([
    { activeWorktreeId: null },
    { activeView: 'settings' as const, workspaceChromeActive: false },
    { creationLayoutActive: true, workspaceChromeActive: false }
  ])('does not claim the shortcut outside the active workspace: %j', (overrides) => {
    const input = shortcutInput()

    expect(runOpen(input, shortcutState(overrides))).toBe(false)

    expect(input.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openInExternalEditor).not.toHaveBeenCalled()
  })

  it('does not target the background worktree when the floating workspace has focus', () => {
    mocks.floatingFocused = true
    const input = shortcutInput()

    expect(runOpen(input)).toBe(false)

    expect(input.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openInExternalEditor).not.toHaveBeenCalled()
  })

  it('shows the existing error when VS Code cannot open the workspace', async () => {
    mocks.openInExternalEditor.mockResolvedValue({ ok: false, reason: 'launch-failed' })

    expect(runOpen()).toBe(true)
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not open workspace folder.',
        expect.any(Object)
      )
    })
  })
})
