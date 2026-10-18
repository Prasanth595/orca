import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_GRID_VIEW_MAX_MEMBERS,
  addWorkspaceGridViewMember,
  isWorkspaceGridViewFull,
  removeWorkspaceGridViewMember,
  resolveVisibleWorkspaceIds
} from './workspace-grid-view-membership'

const fullBoard = Array.from(
  { length: WORKSPACE_GRID_VIEW_MAX_MEMBERS },
  (_, index) => `wt-${index}`
)

describe('addWorkspaceGridViewMember', () => {
  it('seeds an empty grid view with the active workspace so the first add shows two panes', () => {
    expect(addWorkspaceGridViewMember([], 'b', 'a')).toEqual(['a', 'b'])
  })

  it('does not seed when the active workspace is the one being added', () => {
    expect(addWorkspaceGridViewMember([], 'a', 'a')).toEqual(['a'])
  })

  it('does not seed when nothing is active', () => {
    expect(addWorkspaceGridViewMember([], 'b', null)).toEqual(['b'])
  })

  it('appends to an existing grid view without reseeding the active workspace', () => {
    expect(addWorkspaceGridViewMember(['a', 'b'], 'c', 'z')).toEqual(['a', 'b', 'c'])
  })

  it('keeps the same array when the workspace is already a member', () => {
    const members = ['a', 'b']
    expect(addWorkspaceGridViewMember(members, 'b', 'a')).toBe(members)
  })

  it('refuses to grow past the member limit', () => {
    expect(addWorkspaceGridViewMember(fullBoard, 'extra', 'wt-0')).toBe(fullBoard)
    expect(isWorkspaceGridViewFull(fullBoard)).toBe(true)
  })
})

describe('removeWorkspaceGridViewMember', () => {
  it('removes one member and keeps the rest in order', () => {
    expect(removeWorkspaceGridViewMember(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('clears a grid view that would be left with a single pane', () => {
    expect(removeWorkspaceGridViewMember(['a', 'b'], 'a')).toEqual([])
  })

  it('keeps the same array when the workspace is not a member', () => {
    const members = ['a', 'b']
    expect(removeWorkspaceGridViewMember(members, 'z')).toBe(members)
  })
})

describe('resolveVisibleWorkspaceIds', () => {
  const mountable = new Set(['a', 'b', 'c'])

  it('shows every mountable member while the active workspace is on the grid view', () => {
    expect(
      resolveVisibleWorkspaceIds({
        gridViewMemberIds: ['a', 'b', 'c'],
        activeWorkspaceId: 'b',
        mountableWorkspaceIds: mountable
      })
    ).toEqual(['a', 'b', 'c'])
  })

  it('shows only the active workspace when it is not on the grid view', () => {
    expect(
      resolveVisibleWorkspaceIds({
        gridViewMemberIds: ['a', 'b'],
        activeWorkspaceId: 'c',
        mountableWorkspaceIds: mountable
      })
    ).toEqual(['c'])
  })

  it('skips members that no longer have a surface, such as removed workspaces', () => {
    expect(
      resolveVisibleWorkspaceIds({
        gridViewMemberIds: ['a', 'gone', 'c'],
        activeWorkspaceId: 'a',
        mountableWorkspaceIds: mountable
      })
    ).toEqual(['a', 'c'])
  })

  it('falls back to the active workspace when fewer than two members can mount', () => {
    expect(
      resolveVisibleWorkspaceIds({
        gridViewMemberIds: ['a', 'gone'],
        activeWorkspaceId: 'a',
        mountableWorkspaceIds: mountable
      })
    ).toEqual(['a'])
  })

  it('shows nothing when no workspace is active', () => {
    expect(
      resolveVisibleWorkspaceIds({
        gridViewMemberIds: ['a', 'b'],
        activeWorkspaceId: null,
        mountableWorkspaceIds: mountable
      })
    ).toEqual([])
  })
})
