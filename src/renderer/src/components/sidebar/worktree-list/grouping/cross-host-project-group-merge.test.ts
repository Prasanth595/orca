import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import {
  findProjectGroupMemberById,
  findProjectGroupMemberForHost,
  getProjectGroupMembersForDisplayId,
  mergeProjectGroupsAcrossHosts,
  resolveDisplayProjectGroupId
} from './cross-host-project-group-merge'

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
const remoteAi = makeGroup({
  id: 'remote-ai',
  parentPath: '/home/me/code/ai',
  executionHostId: RUNTIME_HOST,
  tabOrder: 1
})

describe('mergeProjectGroupsAcrossHosts', () => {
  it("folds same-named groups from different hosts under this computer's group", () => {
    const merge = mergeProjectGroupsAcrossHosts([remoteAi, localAi], 'local')

    expect(merge.displayGroups).toEqual([localAi])
    expect(merge.displayGroupIdById.get('remote-ai')).toBe('local-ai')
    expect(merge.displayGroupIdById.get('local-ai')).toBe('local-ai')
    expect(merge.membersByDisplayId.get('local-ai')).toEqual([remoteAi, localAi])
  })

  it('prefers the focused host when it holds a copy', () => {
    const merge = mergeProjectGroupsAcrossHosts([localAi, remoteAi], RUNTIME_HOST)

    expect(merge.displayGroups.map((group) => group.id)).toEqual(['remote-ai'])
    expect(resolveDisplayProjectGroupId('local-ai', merge)).toBe('remote-ai')
  })

  it('ignores case and surrounding whitespace in names', () => {
    const merge = mergeProjectGroupsAcrossHosts([localAi, { ...remoteAi, name: ' AI ' }], 'local')

    expect(merge.displayGroups.map((group) => group.id)).toEqual(['local-ai'])
  })

  it('keeps same-named groups on one host apart', () => {
    const secondLocal = makeGroup({ id: 'local-ai-2', executionHostId: 'local', tabOrder: 2 })
    const merge = mergeProjectGroupsAcrossHosts([localAi, secondLocal, remoteAi], 'local')

    expect(merge.displayGroups.map((group) => group.id)).toEqual(['local-ai', 'local-ai-2'])
    expect(merge.displayGroupIdById.get('remote-ai')).toBe('local-ai')
    expect(merge.displayGroupIdById.has('local-ai-2')).toBe(false)
  })

  it('merges child groups under the merged parent and re-parents remote-only children', () => {
    const localTools = makeGroup({
      id: 'local-tools',
      name: 'tools',
      parentGroupId: 'local-ai',
      executionHostId: 'local'
    })
    const remoteTools = makeGroup({
      id: 'remote-tools',
      name: 'tools',
      parentGroupId: 'remote-ai',
      executionHostId: RUNTIME_HOST
    })
    const remoteOnly = makeGroup({
      id: 'remote-skills',
      name: 'skills',
      parentGroupId: 'remote-ai',
      executionHostId: RUNTIME_HOST
    })
    const merge = mergeProjectGroupsAcrossHosts(
      [remoteTools, remoteOnly, localAi, remoteAi, localTools],
      'local'
    )

    expect(merge.displayGroups.map((group) => [group.id, group.parentGroupId])).toEqual([
      ['local-ai', null],
      ['local-tools', 'local-ai'],
      ['remote-skills', 'local-ai']
    ])
    expect(merge.displayGroupIdById.get('remote-tools')).toBe('local-tools')
    expect(merge.displayGroupIdById.has('remote-skills')).toBe(false)
    // Why: the re-parented child keeps its own identity; only its parent pointer moved.
    expect(merge.displayGroups[2]).not.toBe(remoteOnly)
    expect(merge.displayGroups[2]?.executionHostId).toBe(RUNTIME_HOST)
  })

  it('returns the input list untouched when no host shares a name', () => {
    const tomoro = makeGroup({ id: 'local-tomoro', name: 'tomoro', executionHostId: 'local' })
    const groups = [tomoro, remoteAi]
    const merge = mergeProjectGroupsAcrossHosts(groups, 'local')

    expect(merge.displayGroups).toBe(groups)
    expect(merge.displayGroupIdById.size).toBe(0)
    expect(merge.membersByDisplayId.size).toBe(0)
    expect(resolveDisplayProjectGroupId('remote-ai', merge)).toBe('remote-ai')
    expect(getProjectGroupMembersForDisplayId(merge, 'remote-ai', remoteAi)).toEqual([remoteAi])
  })

  it('resolves members by host and by their own id', () => {
    const merge = mergeProjectGroupsAcrossHosts([localAi, remoteAi], 'local')

    expect(findProjectGroupMemberForHost(merge, 'local-ai', RUNTIME_HOST)).toBe(remoteAi)
    expect(findProjectGroupMemberForHost(merge, 'local-ai', 'ssh:other')).toBeUndefined()
    expect(findProjectGroupMemberById(merge, 'remote-ai')).toBe(remoteAi)
    expect(findProjectGroupMemberById(merge, 'missing')).toBeUndefined()
  })
})
