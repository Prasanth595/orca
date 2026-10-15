import { describe, expect, it } from 'vitest'
import type { PlaneStateGroup, PlaneWorkItem } from '../../../../../shared/plane-types'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS } from '@/store/slices/plane-slice-contract'
import {
  filterPlaneWorkItems,
  getPlaneAssigneeOptions,
  getPlaneIdentifierQuery,
  getScopedPlaneProjects,
  hasActivePlaneFilters,
  isOpenPlaneStateSelection,
  mergePlaneWorkItems
} from './plane-work-item-filters'

const ADA = { id: 'ada', displayName: 'Ada Lovelace' }
const BOB = { id: 'bob', displayName: 'Bob' }

function item(
  id: string,
  overrides: Partial<PlaneWorkItem> & { group?: PlaneStateGroup | null } = {}
): PlaneWorkItem {
  const { group = 'started', ...rest } = overrides
  return {
    connectionId: 'conn-1',
    id,
    projectId: 'web',
    projectIdentifier: 'WEB',
    sequenceId: 1,
    identifier: `WEB-${id}`,
    name: `Item ${id}`,
    state: group ? { id: `state-${group}`, name: group, group, color: '', sequence: 1 } : null,
    priority: 'none',
    assignees: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    url: `https://plane.example/${id}`,
    ...rest
  }
}

const filters = DEFAULT_PLANE_WORK_ITEM_FILTERS
const ids = (items: PlaneWorkItem[]) => items.map((entry) => entry.id)

describe('plane work item filters', () => {
  it('defaults to open work: backlog, unstarted, started and stateless items', () => {
    const items = [
      item('1', { group: 'backlog' }),
      item('2', { group: 'unstarted' }),
      item('3', { group: 'started' }),
      item('4', { group: 'completed' }),
      item('5', { group: 'cancelled' }),
      item('6', { group: 'triage' }),
      item('7', { group: null })
    ]
    expect(ids(filterPlaneWorkItems(items, filters, 'ada')).sort()).toEqual(['1', '2', '3', '7'])
    expect(isOpenPlaneStateSelection(filters.stateGroups)).toBe(true)
    expect(ids(filterPlaneWorkItems(items, { ...filters, stateGroups: [] }, 'ada'))).toHaveLength(7)
  })

  it('uses the exact state only while one project is chosen', () => {
    const items = [item('1', { group: 'completed' }), item('2', { group: 'started' })]
    const exact = { ...filters, stateId: 'state-completed' }
    expect(ids(filterPlaneWorkItems(items, exact, 'ada'))).toEqual(['2'])
    expect(ids(filterPlaneWorkItems(items, { ...exact, projectId: 'web' }, 'ada'))).toEqual(['1'])
  })

  it('filters by project, assignee, priority and text', () => {
    const items = [
      item('1', { assignees: [ADA], priority: 'high', name: 'Fix login' }),
      item('2', { assignees: [BOB], projectId: 'api' }),
      item('3')
    ]
    expect(ids(filterPlaneWorkItems(items, { ...filters, projectId: 'api' }, 'ada'))).toEqual(['2'])
    expect(ids(filterPlaneWorkItems(items, { ...filters, assignee: 'me' }, 'ada'))).toEqual(['1'])
    expect(ids(filterPlaneWorkItems(items, { ...filters, assignee: 'unassigned' }, 'ada'))).toEqual(
      ['3']
    )
    expect(ids(filterPlaneWorkItems(items, { ...filters, assignee: 'bob' }, 'ada'))).toEqual(['2'])
    expect(ids(filterPlaneWorkItems(items, { ...filters, priority: 'high' }, 'ada'))).toEqual(['1'])
    expect(ids(filterPlaneWorkItems(items, { ...filters, text: 'LOGIN' }, 'ada'))).toEqual(['1'])
    expect(ids(filterPlaneWorkItems(items, { ...filters, text: 'web-3' }, 'ada'))).toEqual(['3'])
  })

  it('lists newest first', () => {
    const items = [
      item('old', { updatedAt: '2026-01-01T00:00:00Z' }),
      item('new', { updatedAt: '2026-02-01T00:00:00Z' })
    ]
    expect(ids(filterPlaneWorkItems(items, filters, 'ada'))).toEqual(['new', 'old'])
  })

  it('derives assignee options from loaded items without duplicates', () => {
    const items = [item('1', { assignees: [BOB, ADA] }), item('2', { assignees: [ADA] })]
    expect(getPlaneAssigneeOptions(items)).toEqual([ADA, BOB])
  })

  it('recognizes an identifier query', () => {
    expect(getPlaneIdentifierQuery(' web-12 ')).toBe('WEB-12')
    expect(getPlaneIdentifierQuery('login bug')).toBeNull()
  })

  it('keeps only scoped projects', () => {
    const projects = [
      { id: 'web', name: 'Web', identifier: 'WEB' },
      { id: 'api', name: 'API', identifier: 'API' }
    ]
    expect(getScopedPlaneProjects(projects, { mode: 'all' })).toEqual(projects)
    expect(getScopedPlaneProjects(projects, { mode: 'selected', projectIds: ['api'] })).toEqual([
      projects[1]
    ])
    expect(getScopedPlaneProjects(projects, null)).toEqual([])
  })

  it('reports whether any filter moved from the default', () => {
    expect(hasActivePlaneFilters(filters)).toBe(false)
    expect(hasActivePlaneFilters({ ...filters, text: 'x' })).toBe(true)
    expect(hasActivePlaneFilters({ ...filters, stateGroups: ['completed'] })).toBe(true)
  })

  it('keys items by connection so equal ids from two workspaces stay apart', () => {
    const other = { ...item('1'), connectionId: 'conn-2' }
    expect(ids(mergePlaneWorkItems([item('1')], [other, item('1')]))).toEqual(['1', '1'])
  })

  it('appends a loaded page without duplicates', () => {
    expect(ids(mergePlaneWorkItems([item('1'), item('2')], [item('2'), item('3')]))).toEqual([
      '1',
      '2',
      '3'
    ])
  })
})
