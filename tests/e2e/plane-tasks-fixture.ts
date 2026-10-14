import type { ElectronApplication } from '@stablyai/playwright-test'
import type {
  PlaneComment,
  PlaneConnection,
  PlaneConnectionStatus,
  PlaneProject,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemDetail
} from '../../src/shared/plane-types'

// Two Plane workspaces with equal weight: one on Plane Cloud, one on a self-hosted server.
// The main process answers `plane:*` from this data, so the renderer and IPC are real while
// no request leaves the machine (the Plane HTTP layer has its own unit tests).

const VIEWER = {
  id: '5d6b6c1e-7c3f-4f8e-9a51-1c2d3e4f5a6b',
  displayName: 'Ada',
  email: 'ada@example.test'
}
const OTHER = { id: '6e7c7d2f-8d40-4a9f-8b62-2d3e4f5a6b7c', displayName: 'Grace' }

export const CLOUD: PlaneConnection = {
  id: 'CloudAcmeConnection00001',
  hostKind: 'cloud',
  apiBaseUrl: 'https://api.plane.so',
  webBaseUrl: 'https://app.plane.so',
  workspaceSlug: 'acme',
  viewer: VIEWER,
  projectScope: { mode: 'all' },
  connectedAt: 1
}

const OPS_PROJECT = '7a2b3c4d-1111-4abc-8def-000000000003'

export const SELF_HOSTED: PlaneConnection = {
  id: 'SelfHostedOpsConnection1',
  hostKind: 'self-hosted',
  apiBaseUrl: 'https://plane.example.test/plane',
  webBaseUrl: 'https://plane.example.test/plane',
  workspaceSlug: 'ops',
  viewer: VIEWER,
  projectScope: { mode: 'selected', projectIds: [OPS_PROJECT] },
  connectedAt: 2
}

export const WEB: PlaneProject = {
  id: '7a2b3c4d-1111-4abc-8def-000000000001',
  name: 'Website',
  identifier: 'WEB'
}
export const API: PlaneProject = {
  id: '7a2b3c4d-1111-4abc-8def-000000000002',
  name: 'Backend',
  identifier: 'API'
}

function state(n: number, name: string, group: PlaneState['group']): PlaneState {
  return { id: `8b3c4d5e-2222-4bcd-9ef0-00000000000${n}`, name, group, color: '', sequence: n }
}

export const STATES: PlaneState[] = [
  state(1, 'Backlog', 'backlog'),
  state(2, 'Todo', 'unstarted'),
  state(3, 'In Progress', 'started'),
  state(4, 'Done', 'completed'),
  state(5, 'Cancelled', 'cancelled')
]

const ITEM_ID_BASE: Record<string, number> = { WEB: 100, API: 200, OPS: 300 }

function item(
  project: PlaneProject,
  sequenceId: number,
  name: string,
  stateIndex: number,
  assignees: PlaneWorkItem['assignees'],
  updatedAt: string,
  connection: PlaneConnection = CLOUD
): PlaneWorkItem {
  const id = `9c4d5e6f-3333-4cde-8f01-${String(ITEM_ID_BASE[project.identifier] + sequenceId).padStart(12, '0')}`
  return {
    connectionId: connection.id,
    id,
    projectId: project.id,
    projectIdentifier: project.identifier,
    sequenceId,
    identifier: `${project.identifier}-${sequenceId}`,
    name,
    state: STATES[stateIndex],
    priority: 'high',
    assignees,
    labels: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt,
    url: `${connection.webBaseUrl}/${connection.workspaceSlug}/projects/${project.id}/issues/${id}`
  }
}

export const WEB_12 = item(
  WEB,
  12,
  'Fix the login redirect loop',
  2,
  [VIEWER],
  '2026-10-14T10:00:00Z'
)
export const WEB_14 = item(WEB, 14, 'Polish the pricing page', 1, [], '2026-10-13T10:00:00Z')
export const API_7 = item(
  API,
  7,
  'Rate limit the export endpoint',
  0,
  [OTHER],
  '2026-10-12T10:00:00Z'
)
export const WEB_3 = item(WEB, 3, 'Launch the new homepage', 3, [VIEWER], '2026-10-11T10:00:00Z')
/** Not in the list: only reachable through the identifier lookup. */
export const WEB_2 = item(WEB, 2, 'Write the release notes', 1, [], '2026-09-01T10:00:00Z')

export const OPS: PlaneProject = { id: OPS_PROJECT, name: 'Operations', identifier: 'OPS' }
/** The self-hosted workspace's only item; newest overall, so it leads the merged list. */
export const OPS_5 = item(
  OPS,
  5,
  'Rotate the staging certificates',
  1,
  [VIEWER],
  '2026-10-14T11:00:00Z',
  SELF_HOSTED
)

export const DESCRIPTION = 'Users who sign in from an invite land back on the sign-in page.'

export type PlaneE2eFixture = {
  status: PlaneConnectionStatus
  /** The workspace a call without a connectionId reaches, as on a real host. */
  activeConnectionId: string
  projectsByConnection: Record<string, PlaneProject[]>
  items: PlaneWorkItem[]
  lookup: PlaneWorkItem
  states: PlaneState[]
  description: string
  comments: PlaneComment[]
}

export function planeFixture(): PlaneE2eFixture {
  return {
    status: {
      connected: true,
      connection: CLOUD,
      credentialProtection: 'sealed',
      connections: [
        { connection: CLOUD, credentialProtection: 'sealed' },
        { connection: SELF_HOSTED, credentialProtection: 'sealed' }
      ]
    },
    activeConnectionId: CLOUD.id,
    projectsByConnection: { [CLOUD.id]: [WEB, API], [SELF_HOSTED.id]: [OPS] },
    items: [WEB_12, WEB_14, API_7, WEB_3, OPS_5],
    lookup: WEB_2,
    states: STATES,
    description: DESCRIPTION,
    comments: [
      {
        id: 'c1',
        authorName: 'Grace',
        text: 'Reproduced with a fresh invite.',
        createdAt: '2026-10-14T09:00:00Z'
      }
    ]
  }
}

/** Replaces main's `plane:*` handlers with answers built from `fixture`, kept in main's memory. */
export async function installPlaneIpcFixture(
  electronApp: ElectronApplication,
  fixture: PlaneE2eFixture
): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, data) => {
    const items = data.items.map((entry) => ({ ...entry }))
    const connectionOf = (args: Record<string, unknown> | undefined): string =>
      typeof args?.connectionId === 'string' ? args.connectionId : data.activeConnectionId
    const comments = [...data.comments]
    const detail = (entry: PlaneWorkItem): PlaneWorkItemDetail => ({
      ...entry,
      descriptionText: data.description,
      truncated: false
    })
    const answers: Record<string, (args: Record<string, unknown> | undefined) => unknown> = {
      'plane:status': () => data.status,
      'plane:listProjects': (args) => ({
        ok: true,
        value: data.projectsByConnection[connectionOf(args)] ?? []
      }),
      'plane:listWorkItems': (args) => ({
        ok: true,
        value: {
          items: items.filter((entry) => entry.connectionId === connectionOf(args)),
          errors: [],
          missingProjectIds: [],
          truncatedProjectIds: [],
          totalCapped: false
        }
      }),
      'plane:getWorkItem': (args) => {
        const found = items.find((entry) => entry.id === args?.workItemId)
        return found
          ? { ok: true, value: detail(found) }
          : { ok: false, error: { kind: 'not_found', message: 'Not found' } }
      },
      'plane:lookupWorkItem': (args) =>
        args?.identifier === data.lookup.identifier &&
        connectionOf(args) === data.lookup.connectionId
          ? { ok: true, value: detail(data.lookup) }
          : { ok: false, error: { kind: 'not_found', message: 'Not found' } },
      'plane:listComments': () => ({ ok: true, value: comments }),
      'plane:listStates': () => ({ ok: true, value: data.states }),
      'plane:listMembers': () => ({ ok: true, value: [] }),
      'plane:updateState': (args) => {
        const found = items.find((entry) => entry.id === args?.workItemId)
        const next = data.states.find((entry) => entry.id === args?.stateId)
        if (!found || !next) {
          return { ok: false, error: { kind: 'not_found', message: 'Not found' } }
        }
        found.state = next
        return { ok: true, value: { ...found } }
      },
      'plane:addComment': (args) => {
        const comment = {
          id: `c${comments.length + 1}`,
          authorName: 'Ada',
          text: String(args?.text ?? ''),
          createdAt: '2026-10-14T12:00:00Z'
        }
        comments.push(comment)
        return { ok: true, value: comment }
      }
    }
    for (const [channel, answer] of Object.entries(answers)) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, args?: Record<string, unknown>) => answer(args))
    }
  }, fixture)
}
