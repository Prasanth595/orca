import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { getFolderWorkspaceRevealGroupKeys } from './folder-reveal'
import { getProjectGroupHeaderKey } from '../grouping/group-keys'
import { mergeProjectGroupsAcrossHosts } from '../grouping/cross-host-project-group-merge'

const RUNTIME_HOST = 'runtime:env-1' as const

function makeGroup(overrides: Partial<ProjectGroup> & Pick<ProjectGroup, 'id'>): ProjectGroup {
  return {
    name: 'ai',
    parentPath: '/Users/me/code/ai',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const localAi = makeGroup({ id: 'local-ai', executionHostId: 'local' })
const remoteAi = makeGroup({ id: 'remote-ai', executionHostId: RUNTIME_HOST, tabOrder: 1 })
const remoteSkills = makeGroup({
  id: 'remote-skills',
  name: 'skills',
  parentGroupId: 'remote-ai',
  executionHostId: RUNTIME_HOST,
  tabOrder: 2
})

const remoteFolderWorkspace: FolderWorkspace = {
  id: 'folder-remote',
  projectGroupId: remoteSkills.id,
  executionHostId: RUNTIME_HOST,
  name: 'Remote scratch',
  folderPath: '/home/me/code/ai/skills/scratch',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

describe('folder workspace reveal through a header merged across hosts', () => {
  it("names the merged headers the sidebar drew, not the workspace's own group chain", () => {
    const merge = mergeProjectGroupsAcrossHosts([localAi, remoteAi, remoteSkills], 'local')

    const keys = getFolderWorkspaceRevealGroupKeys(
      folderWorkspaceKey(remoteFolderWorkspace.id),
      [remoteFolderWorkspace],
      merge.displayGroups,
      {
        groupBy: 'repo',
        defaultHostId: 'local',
        executionHostId: RUNTIME_HOST,
        projectGroupMerge: merge
      }
    )

    expect(keys).toEqual([
      getProjectGroupHeaderKey(localAi.id),
      getProjectGroupHeaderKey(remoteSkills.id),
      `host:${RUNTIME_HOST}`
    ])
  })
})
