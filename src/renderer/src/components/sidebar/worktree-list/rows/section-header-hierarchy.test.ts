import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { GroupHeaderRow } from '../grouping/row-types'
import { getSectionHeaderLayout } from './section-header-hierarchy'

const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 0
}
const group: ProjectGroup = {
  id: 'group',
  executionHostId: 'runtime:env-1',
  name: 'Group',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  icon: { type: 'emoji', emoji: '🌱' },
  createdAt: 0,
  updatedAt: 0
}

function header(overrides: Partial<GroupHeaderRow>): GroupHeaderRow {
  return { type: 'header', key: 'k', label: 'label', count: 0, tone: '', ...overrides }
}

describe('getSectionHeaderLayout', () => {
  it('leaves Classic project headers on the existing indent', () => {
    const layout = getSectionHeaderLayout({
      row: header({ repo, projectGroupDepth: 1 }),
      hierarchyStyle: false,
      isRepoHeader: true,
      isProjectGroupHeader: false
    })
    expect(layout).toMatchObject({ isNestedRepoHeader: false, paddingLeft: 20 })
    expect(layout.activeViewGroupKey).toBeUndefined()
  })

  it('aligns a grouped project with its group label and drops its icon in hierarchy', () => {
    const layout = getSectionHeaderLayout({
      row: header({ repo, projectGroupDepth: 1 }),
      hierarchyStyle: true,
      isRepoHeader: true,
      isProjectGroupHeader: false
    })
    // Group label column: 10px padding + 16px icon + 6px gap.
    expect(layout).toMatchObject({ isNestedRepoHeader: true, paddingLeft: 32 })
  })

  it('keeps ungrouped projects at the top-level indent in hierarchy', () => {
    const layout = getSectionHeaderLayout({
      row: header({ repo, projectGroupDepth: 0 }),
      hierarchyStyle: true,
      isRepoHeader: true,
      isProjectGroupHeader: false
    })
    expect(layout).toMatchObject({ isNestedRepoHeader: false, paddingLeft: 10 })
  })

  it('exposes the group icon in both styles and the opt-out key only in hierarchy', () => {
    const args = {
      row: header({ projectGroup: group }),
      isRepoHeader: false,
      isProjectGroupHeader: true
    }
    expect(getSectionHeaderLayout({ ...args, hierarchyStyle: false })).toMatchObject({
      projectGroupIcon: group.icon,
      activeViewGroupKey: undefined
    })
    expect(getSectionHeaderLayout({ ...args, hierarchyStyle: true }).activeViewGroupKey).toBe(
      'runtime:env-1::group'
    )
  })

  it('treats the synthetic Ungrouped header as having no group', () => {
    const layout = getSectionHeaderLayout({
      row: header({ projectGroup: { id: null, name: 'Ungrouped', tabOrder: 0 } }),
      hierarchyStyle: true,
      isRepoHeader: false,
      isProjectGroupHeader: true
    })
    expect(layout).toMatchObject({ projectGroupIcon: null, activeViewGroupKey: undefined })
  })
})
