import { describe, expect, it } from 'vitest'
import { resolveHierarchyStatusMark } from './worktree-hierarchy-status-mark'

describe('resolveHierarchyStatusMark', () => {
  it('ranks waiting-on-you above unread and working', () => {
    expect(resolveHierarchyStatusMark('permission', true)).toBe('input')
  })

  it('ranks working above unread, and shows a finished agent only while unread', () => {
    expect(resolveHierarchyStatusMark('working', true)).toBe('working')
    expect(resolveHierarchyStatusMark('monitoring', false)).toBe('working')
    expect(resolveHierarchyStatusMark('done', true)).toBe('unread')
    expect(resolveHierarchyStatusMark('done', false)).toBeNull()
  })

  it('shows nothing for a quiet worktree', () => {
    expect(resolveHierarchyStatusMark('inactive', false)).toBeNull()
    expect(resolveHierarchyStatusMark('active', false)).toBeNull()
  })
})
