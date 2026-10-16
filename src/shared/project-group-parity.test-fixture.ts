// Project Groups over the Project grouping parity answers; the desktop and phone tests share them.
import type { MobileProjectSectionCatalog } from './mobile-project-sections-contract'
import type { ProjectGroup } from './project-group-types'
import { PROJECT_SECTION_PARITY_SERVED } from './project-section-parity.test-fixture'

/** Work, with Servers nested inside it; listed child first, as persisted order is arbitrary. */
export const PROJECT_GROUP_PARITY_GROUPS: readonly ProjectGroup[] = [
  {
    id: 'group-servers',
    name: 'Servers',
    parentPath: null,
    parentGroupId: 'group-work',
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'group-work',
    name: 'Work',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
]

/** Each grouped repo's Project Group; the other repos stay ungrouped. */
export const PROJECT_GROUP_PARITY_MEMBERSHIP: Readonly<Record<string, string>> = {
  'local-stably': 'group-work',
  'local-assets': 'group-work',
  'm4-orca': 'group-servers',
  'm4-orca-two': 'group-servers'
}

/** What main serves the phone once those repos sit in those groups. */
export const PROJECT_GROUP_PARITY_SERVED: MobileProjectSectionCatalog = {
  ...PROJECT_SECTION_PARITY_SERVED,
  repos: PROJECT_SECTION_PARITY_SERVED.repos.map((repo) =>
    PROJECT_GROUP_PARITY_MEMBERSHIP[repo.id]
      ? { ...repo, projectGroupId: PROJECT_GROUP_PARITY_MEMBERSHIP[repo.id] }
      : repo
  ),
  projectGroups: PROJECT_GROUP_PARITY_GROUPS.map(({ id, name, parentGroupId, tabOrder }) => ({
    id,
    name,
    parentGroupId,
    tabOrder
  }))
}

const WORK = { key: 'project-group:group-work', label: 'Work', depth: 0, count: 4 }
const SERVERS = { key: 'project-group:group-servers', label: 'Servers', depth: 1, count: 2 }
// Labels disambiguate within each group, as the sidebar's do: alone there, a checkout is 'orca'.
const STABLY = { key: 'project:github:stablyai/orca::setup:local-stably', label: 'orca', depth: 1 }
const ASSETS = { key: 'project:repo:local-assets', label: 'design-assets', depth: 1 }
const M4 = { key: 'project:github:stablyai/orca::setup:m4-orca', label: 'orca/orca', depth: 2 }
const M4_TWO = {
  key: 'project:github:stablyai/orca::setup:m4-orca-two',
  label: 'orca-two/orca',
  depth: 2
}
const WORKSPACE = {
  key: 'project:github:stablyai/orca::setup:local-workspace',
  label: 'workspaces/orca/orca',
  depth: 0
}
const WINDOWS = { key: 'project:github:stablyai/orca', label: 'jinwo/orca/orca', depth: 0 }

/** Groups first (Servers inside Work), each ordering its own projects; ungrouped ones follow. */
export const PROJECT_GROUP_PARITY_HEADERS = {
  recent: [WORK, STABLY, ASSETS, SERVERS, M4_TWO, M4, WINDOWS, WORKSPACE],
  manual: [WORK, STABLY, ASSETS, SERVERS, M4, M4_TWO, WORKSPACE, WINDOWS]
} as const
