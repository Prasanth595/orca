import { describe, expect, it } from 'vitest'
import {
  displayPathInsideWorktree,
  folderPathIsInsideWorktree,
  selectDefaultNestedRepo
} from './nested-folder-paths'

describe('nested folder paths', () => {
  it('accepts the worktree root and descendants', () => {
    expect(folderPathIsInsideWorktree('/repo', '/repo')).toBe(true)
    expect(folderPathIsInsideWorktree('/repo', '/repo/.worktrees/001/theme-a')).toBe(true)
    expect(folderPathIsInsideWorktree('/repo', '/other')).toBe(false)
  })

  it('renders a compact relative path', () => {
    expect(displayPathInsideWorktree('/repo', '/repo')).toBe('.')
    expect(displayPathInsideWorktree('/repo', '/repo/.worktrees/001')).toBe('.worktrees/001')
  })

  it('prefers the first dirty nested repo', () => {
    const repos = [
      { path: '/repo/.worktrees/001/clean', displayName: 'clean', depth: 1 },
      { path: '/repo/.worktrees/001/dirty', displayName: 'dirty', depth: 1 }
    ]
    expect(selectDefaultNestedRepo(repos, new Map([[repos[1].path, 3]]))).toBe(repos[1].path)
    expect(selectDefaultNestedRepo(repos, new Map())).toBe(repos[0].path)
    expect(selectDefaultNestedRepo([], new Map())).toBeNull()
  })
})
