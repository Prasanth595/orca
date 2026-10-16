import { describe, expect, it } from 'vitest'
import { findLongestRegisteredAncestor } from './registered-worktree-nested-git'

describe('findLongestRegisteredAncestor', () => {
  it('picks the longest matching registered root', () => {
    expect(findLongestRegisteredAncestor('/ws/.worktrees/001/theme-a', ['/ws', '/other'])).toBe(
      '/ws'
    )
    expect(
      findLongestRegisteredAncestor('/ws/.worktrees/001/theme-a', ['/ws', '/ws/.worktrees/001'])
    ).toBe('/ws/.worktrees/001')
    expect(findLongestRegisteredAncestor('/tmp/x', ['/ws'])).toBeNull()
  })
})
