import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  scheduleRuntimeGraphSync,
  setRuntimeGraphStoreStateGetter,
  setRuntimeGraphSyncEnabled
} from './sync-runtime-graph'
import type { AppState } from '../store/types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { RuntimeSyncWindowGraph } from '../../../shared/runtime-types'

vi.mock('./sync-runtime-graph/terminal-group-grid-sizes', () => ({
  measureTerminalGroupGridSizes: () => undefined
}))

const repo: Repo = {
  id: 'repo-1',
  path: '/Users/me/orca',
  displayName: 'orca',
  badgeColor: '#737373',
  addedAt: 1,
  hookSettings: { mode: 'auto', scripts: { setup: 'secret-setup', archive: '' } },
  gitUsername: 'me',
  repoIcon: { type: 'image', src: 'data:image/png;base64,AAAA', source: 'upload' },
  projectGroupId: 'group-1',
  projectGroupOrder: 2
}

const projectGroup: ProjectGroup = {
  id: 'group-1',
  name: 'Work',
  parentPath: '/Users/me/work',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 3,
  isCollapsed: false,
  color: '#ff0000',
  createdAt: 1,
  updatedAt: 1
}

const BASE_STATE = {
  tabsByWorktree: {},
  terminalLayoutsByTabId: {},
  runtimePaneTitlesByTabId: {},
  groupsByWorktree: {},
  activeGroupIdByWorktree: {},
  layoutByWorktree: {},
  unifiedTabsByWorktree: {},
  tabBarOrderByWorktree: {},
  activeFileId: null,
  activeFileIdByWorktree: {},
  openFiles: [],
  editorDrafts: {},
  activeTabId: null,
  agentStatusByPaneKey: {},
  browserTabsByWorktree: {},
  repos: [repo],
  projects: [],
  projectHostSetups: [],
  projectOrderBy: 'recent',
  projectGroups: [projectGroup]
}

async function flushSync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20)
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  setRuntimeGraphSyncEnabled(false)
  setRuntimeGraphStoreStateGetter(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("the sidebar's Project catalog in the window graph", () => {
  it('carries it once per change, without repo hooks, credentials or uploaded icons', async () => {
    const syncWindowGraph = vi
      .fn<(graph: RuntimeSyncWindowGraph) => Promise<object>>()
      .mockResolvedValue({})
    vi.useFakeTimers()
    vi.stubGlobal('window', { api: { runtime: { syncWindowGraph } } })
    vi.stubGlobal('HTMLElement', class HTMLElement {})
    let state = BASE_STATE
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: graph sync reads only these members of the store.
    setRuntimeGraphStoreStateGetter(() => state as unknown as AppState)
    setRuntimeGraphSyncEnabled(true)
    await flushSync()

    expect(syncWindowGraph.mock.calls[0]?.[0].projectSectionCatalog).toEqual({
      repos: [
        {
          id: 'repo-1',
          displayName: 'orca',
          path: '/Users/me/orca',
          badgeColor: '#737373',
          addedAt: 1,
          projectGroupId: 'group-1',
          projectGroupOrder: 2
        }
      ],
      projects: [{ id: 'repo:repo-1', displayName: 'orca' }],
      setups: [
        {
          id: 'repo-1',
          projectId: 'repo:repo-1',
          hostId: 'local',
          repoId: 'repo-1',
          path: '/Users/me/orca',
          displayName: 'orca',
          setupMethod: 'legacy-repo'
        }
      ],
      projectOrderBy: 'recent',
      // Why no parentPath: the phone nests by group, so a folder root's path stays on the desktop.
      projectGroups: [{ id: 'group-1', name: 'Work', parentGroupId: null, tabOrder: 3 }]
    })

    scheduleRuntimeGraphSync()
    await flushSync()
    expect(syncWindowGraph).toHaveBeenCalledTimes(2)
    expect(syncWindowGraph.mock.calls[1]?.[0]).not.toHaveProperty('projectSectionCatalog')

    state = { ...BASE_STATE, projectOrderBy: 'manual' }
    scheduleRuntimeGraphSync()
    await flushSync()
    expect(syncWindowGraph.mock.calls[2]?.[0].projectSectionCatalog?.projectOrderBy).toBe('manual')

    state = { ...state, projectGroups: [{ ...projectGroup, name: 'Clients' }] }
    scheduleRuntimeGraphSync()
    await flushSync()
    expect(syncWindowGraph.mock.calls[3]?.[0].projectSectionCatalog?.projectGroups).toEqual([
      { id: 'group-1', name: 'Clients', parentGroupId: null, tabOrder: 3 }
    ])
  })
})
