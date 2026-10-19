import { describe, expect, it } from 'vitest'
import { getWorktreeCardLocalTaskDisplay } from './worktree-card-local-task-display'

describe('getWorktreeCardLocalTaskDisplay', () => {
  it('returns the local task title for local linked items', () => {
    expect(
      getWorktreeCardLocalTaskDisplay({
        linkedWorkItem: {
          provider: 'local',
          type: 'issue',
          number: 7,
          title: 'Ship local board',
          url: 'orca://local-task/v1/p/7'
        }
      })
    ).toEqual({ identifier: '7', title: 'Ship local board', url: 'orca://local-task/v1/p/7' })
  })

  it('returns null for non-local providers', () => {
    expect(
      getWorktreeCardLocalTaskDisplay({
        linkedWorkItem: {
          provider: 'github',
          type: 'issue',
          number: 1,
          title: 'GH',
          url: 'https://github.com/a/b/issues/1'
        }
      })
    ).toBeNull()
    expect(getWorktreeCardLocalTaskDisplay({ linkedWorkItem: null })).toBeNull()
  })
})
