import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import {
  getConcealedRepoIdsFromState,
  getShownReposFromState,
  omitConcealedRepoKeys,
  withoutConcealedOnlyProjectGroups
} from './concealed-repo-selector'

const repo = (id: string, extra: Partial<Repo> = {}): Repo => ({
  id,
  path: `/tmp/${id}`,
  displayName: id,
  badgeColor: '#000000',
  addedAt: 0,
  ...extra
})

const group = (id: string, parentGroupId: string | null = null): ProjectGroup => ({
  id,
  name: id,
  parentPath: null,
  parentGroupId,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
})

describe('concealed repo selectors', () => {
  const repos = [repo('open'), repo('secret', { incognito: true })]

  it('keeps identity when nothing is concealed', () => {
    const plain = [repo('open')]
    expect(getShownReposFromState({ repos: plain, incognitoProjectsUnlocked: false })).toBe(plain)
    expect(getShownReposFromState({ repos, incognitoProjectsUnlocked: true })).toBe(repos)
  })

  it('drops locked incognito repos with a stable result', () => {
    const state = { repos, incognitoProjectsUnlocked: false }
    const shown = getShownReposFromState(state)
    expect(shown.map((r) => r.id)).toEqual(['open'])
    expect(getShownReposFromState(state)).toBe(shown)
    expect(getConcealedRepoIdsFromState(state)).toBe(getConcealedRepoIdsFromState(state))
  })

  it('hides a project group whose only members are concealed repos', () => {
    const groups = [group('secret-only'), group('mixed'), group('with-folder')]
    const members = [
      repo('s1', { incognito: true, projectGroupId: 'secret-only' }),
      repo('s2', { incognito: true, projectGroupId: 'mixed' }),
      repo('o1', { projectGroupId: 'mixed' }),
      repo('s3', { incognito: true, projectGroupId: 'with-folder' })
    ]
    const concealed = new Set(['s1', 's2', 's3'])
    const visible = withoutConcealedOnlyProjectGroups(
      groups,
      members,
      [{ projectGroupId: 'with-folder' }],
      concealed
    )
    expect(visible.map((g) => g.id)).toEqual(['mixed', 'with-folder'])
  })

  it('omits concealed repo keys only when present', () => {
    const byRepo = { open: [1], secret: [2] }
    expect(omitConcealedRepoKeys(byRepo, new Set(['missing']))).toBe(byRepo)
    expect(omitConcealedRepoKeys(byRepo, new Set(['secret']))).toEqual({ open: [1] })
  })
})
