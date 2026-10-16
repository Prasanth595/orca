import { describe, expect, it } from 'vitest'
import { buildProjectSectionCatalog } from './project-section-catalog'
import type { ServedProjectSections } from './project-sections-operations'

const uploaded = { type: 'image', src: 'data:image/png;base64,AAAA' }

type ServedRepo = ServedProjectSections['repos'][number]

function repo(
  id: string,
  executionHostId?: ServedRepo['executionHostId'],
  repoIcon?: unknown
): ServedRepo {
  return {
    id,
    displayName: 'orca',
    path: `/repos/${id}`,
    badgeColor: undefined,
    addedAt: undefined,
    connectionId: undefined,
    executionHostId,
    projectGroupId: undefined,
    projectGroupOrder: undefined,
    ...(repoIcon ? { repoIcon } : {})
  }
}

describe('buildProjectSectionCatalog', () => {
  it("restores an uploaded icon from the desktop's repo.list only for the same host's repo", () => {
    const served: ServedProjectSections = {
      repos: [repo('r1'), repo('r1', 'runtime:m4air')],
      projects: [],
      setups: [],
      projectOrderBy: 'manual',
      projectGroups: undefined
    }
    const catalog = buildProjectSectionCatalog(
      served,
      [repo('r1', undefined, uploaded)],
      null,
      'manual'
    )
    expect(catalog.repos.map((entry) => entry.repoIcon)).toEqual([uploaded, undefined])
  })

  it("heads sections only with the shown hosts' Project Groups", () => {
    const group = (id: string, executionHostId: ServedRepo['executionHostId']) => ({
      id,
      name: id,
      parentGroupId: null,
      tabOrder: 0,
      connectionId: undefined,
      executionHostId
    })
    const served: ServedProjectSections = {
      repos: [],
      projects: [],
      setups: [],
      projectOrderBy: 'manual',
      projectGroups: [group('local-group', undefined), group('server-group', 'runtime:m4air')]
    }

    expect(
      buildProjectSectionCatalog(served, [], ['local'], null).projectGroups.map((entry) => entry.id)
    ).toEqual(['local-group'])
    expect(
      buildProjectSectionCatalog(served, [], null, null).projectGroups.map((entry) => entry.id)
    ).toEqual(['local-group', 'server-group'])
  })
})
