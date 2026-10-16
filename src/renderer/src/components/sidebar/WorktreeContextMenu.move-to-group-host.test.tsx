/**
 * @vitest-environment happy-dom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import WorktreeContextMenu from './WorktreeContextMenu'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repoHost = vi.hoisted(() => ({ executionHostId: 'runtime:linux-env' }))

const state = {
  updateWorktreeMeta: vi.fn(),
  setWorktreesPinnedAndReveal: vi.fn(),
  workspaceStatuses: [],
  openModal: vi.fn(),
  projectGroups: [
    { id: 'mac-group', name: 'Mac projects', connectionId: null, executionHostId: 'local' },
    {
      id: 'linux-group',
      name: 'Linux projects',
      connectionId: null,
      executionHostId: 'runtime:linux-env'
    }
  ],
  createProjectGroup: vi.fn(),
  moveProjectToGroup: vi.fn(),
  deleteStateByWorktreeId: {},
  worktreeLineageById: {},
  workspaceLineageByChildKey: {},
  updateWorktreeLineage: vi.fn(),
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  browserTabsByWorktree: {},
  keybindings: {},
  settings: { activeRuntimeEnvironmentId: null, openInApplications: [] },
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))

vi.mock('@/store/selectors', () => ({
  useAllWorktrees: () => [],
  useRepoById: (repoId?: string) =>
    repoId
      ? {
          id: repoId,
          name: repoId,
          displayName: repoId,
          projectGroupId: null,
          connectionId: null,
          executionHostId: repoHost.executionHostId
        }
      : undefined,
  useRepoMap: () => new Map(),
  useWorktreeMap: () => new Map()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  i18n: { language: 'en', on: () => {}, off: () => {} }
}))

vi.mock('./ProjectGroupNameDialog', () => ({ ProjectGroupNameDialog: () => null }))
vi.mock('./WorktreeParentPickerPopover', () => ({ WorktreeParentPickerPopover: () => null }))
vi.mock('./WorktreeOpenInMenu', () => ({ WorktreeOpenInSubMenu: () => null }))

const mounted: { container: HTMLDivElement; root: Root }[] = []

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => root.unmount())
    container.remove()
  }
  mounted.length = 0
  state.moveProjectToGroup.mockReset()
})

function worktreeFixture(overrides: Partial<Worktree> = {}): Worktree {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the menu reads only the fields set here.
  return {
    id: 'linux-repo::/home/me/app',
    repoId: 'linux-repo',
    displayName: 'app',
    branch: 'refs/heads/main',
    path: '/home/me/app',
    isMainWorktree: true,
    ...overrides
  } as Worktree
}

function openMoveToGroupSubmenu(): string[] {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  act(() => {
    root.render(
      <TooltipProvider>
        <WorktreeContextMenu worktree={worktreeFixture({ hostId: 'runtime:linux-env' })}>
          <div>Card</div>
        </WorktreeContextMenu>
      </TooltipProvider>
    )
  })
  act(() => {
    container
      .querySelector('[data-worktree-context-menu-scope]')
      ?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      )
  })
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent === 'Move to group'
  )
  if (!trigger) {
    return []
  }
  act(() => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  const submenu = document.querySelector('[role="menu"][data-side]:not(:first-of-type)')
  const items = Array.from(
    (submenu ?? document).querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).map((element) => element.textContent ?? '')
  return items.filter((label) => label === 'Mac projects' || label === 'Linux projects')
}

describe('WorktreeContextMenu Move to group across hosts', () => {
  it("offers only groups the project's own host can hold", () => {
    expect(openMoveToGroupSubmenu()).toEqual(['Linux projects'])
  })

  it('hides the submenu when no group lives on the project host', () => {
    repoHost.executionHostId = 'runtime:other-env'
    try {
      expect(openMoveToGroupSubmenu()).toEqual([])
      expect(
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some(
          (element) => element.textContent === 'Move to group'
        )
      ).toBe(false)
    } finally {
      repoHost.executionHostId = 'runtime:linux-env'
    }
  })
})
