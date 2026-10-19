import { describe, expect, it } from 'vitest'
import { getLocalTaskSourceContext } from './local-task-source-context'

describe('getLocalTaskSourceContext', () => {
  it('builds a project-scoped local context with pinned local host', () => {
    const context = getLocalTaskSourceContext('project-1')
    expect(context).toEqual({
      kind: 'task-source',
      provider: 'local',
      projectId: 'project-1',
      hostId: 'local',
      projectHostSetupId: null,
      repoId: null,
      providerIdentity: null,
      accountLabel: null
    })
  })

  it('returns null with no active project', () => {
    expect(getLocalTaskSourceContext(null)).toBeNull()
    expect(getLocalTaskSourceContext('  ')).toBeNull()
  })
})
