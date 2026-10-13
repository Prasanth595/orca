import { describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { createProjectGroup } from '../../../shared/project-groups'
import { ProjectGroupPersistenceOperations } from './project-group-operations'

function fixture() {
  const state = getDefaultPersistedState('/home/test')
  state.projectGroups = [
    { ...createProjectGroup({ name: 'Group', createdFrom: 'manual', tabOrder: 0 }), id: 'group' }
  ]
  const operations = new ProjectGroupPersistenceOperations({
    state,
    scheduleSave: vi.fn(),
    removeWorkspaceLineageForFolderParent: vi.fn(),
    pruneMobileClientTabSelections: vi.fn()
  })
  return { state, operations }
}

describe('ProjectGroupPersistenceOperations.updateProjectGroup icon', () => {
  it('stores a valid icon and clears it with null', () => {
    const { state, operations } = fixture()
    operations.updateProjectGroup('group', { icon: { type: 'emoji', emoji: '🌱' } })
    expect(state.projectGroups?.[0]?.icon).toEqual({ type: 'emoji', emoji: '🌱' })

    operations.updateProjectGroup('group', { icon: null })
    expect(state.projectGroups?.[0]).not.toHaveProperty('icon')
  })

  it('ignores an invalid icon instead of clearing the current one', () => {
    const { state, operations } = fixture()
    operations.updateProjectGroup('group', { icon: { type: 'emoji', emoji: '🌱' } })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates an untyped IPC payload the schema would pass through.
    operations.updateProjectGroup('group', { icon: { type: 'lucide', name: '' } as never })
    expect(state.projectGroups?.[0]?.icon).toEqual({ type: 'emoji', emoji: '🌱' })
  })
})
