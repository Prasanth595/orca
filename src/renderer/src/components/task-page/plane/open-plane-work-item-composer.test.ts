import { describe, expect, it, vi } from 'vitest'
import type { PlaneConnection, PlaneWorkItem } from '../../../../../shared/plane-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../../../../shared/workspace-linked-item-source-context'
import {
  buildPlaneWorkItemComposerData,
  openPlaneWorkItemComposer
} from './open-plane-work-item-composer'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const PROJECT = '0b5c7c4e-2f0a-4c1e-9d55-0d6c1a2b3c4d'
const ITEM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

describe.each([
  { name: 'Plane Cloud', apiBaseUrl: 'https://api.plane.so', webBaseUrl: 'https://app.plane.so' },
  {
    name: 'self-hosted',
    apiBaseUrl: 'https://plane.example.test/plane',
    webBaseUrl: 'https://plane.example.test/plane'
  }
])('Plane composer payload on $name', ({ apiBaseUrl, webBaseUrl }) => {
  const connection: PlaneConnection = {
    id: 'abcdefghijklmnopqrstuvwx',
    hostKind: 'cloud',
    apiBaseUrl,
    webBaseUrl,
    workspaceSlug: 'acme',
    viewer: { id: 'viewer', displayName: 'Ada', email: 'ada@example.test' },
    projectScope: { mode: 'all' },
    connectedAt: 1
  }
  const item: PlaneWorkItem = {
    connectionId: connection.id,
    id: ITEM,
    projectId: PROJECT,
    projectIdentifier: 'WEB',
    sequenceId: 12,
    identifier: 'WEB-12',
    name: 'Fix the login redirect',
    state: { id: 's', name: 'Todo', group: 'unstarted', color: '', sequence: 1 },
    priority: 'high',
    assignees: [],
    labels: [],
    createdAt: '',
    updatedAt: '',
    url: `${webBaseUrl}/acme/projects/${PROJECT}/issues/${ITEM}`
  }
  const pageContext: TaskSourceContext = {
    kind: 'task-source',
    provider: 'plane',
    projectId: 'orca-project',
    hostId: 'local',
    providerIdentity: { provider: 'plane', connectionId: connection.id }
  }

  it('links the work item with a matching source context and a seeded name', () => {
    const data = buildPlaneWorkItemComposerData({
      item: { ...item, descriptionText: 'Users bounce back to sign-in.' },
      connection,
      sourceContext: pageContext,
      initialRepoId: 'repo-1'
    })
    expect(data).toMatchObject({
      linkedWorkItem: {
        provider: 'plane',
        type: 'issue',
        number: 0,
        identifier: 'WEB-12',
        title: 'WEB-12 Fix the login redirect',
        url: item.url,
        linkedContext: { provider: 'plane', version: 1 }
      },
      taskSourceContext: {
        provider: 'plane',
        projectId: 'orca-project',
        providerIdentity: {
          provider: 'plane',
          connectionId: connection.id,
          webBaseUrl,
          workspaceSlug: 'acme',
          projectId: PROJECT
        }
      },
      initialRepoId: 'repo-1',
      prefilledName: 'web-12-fix-the-login-redirect',
      telemetrySource: 'sidebar'
    })
    expect(
      isWorkspaceLinkedItemSourceContextMatch(data?.linkedWorkItem, data?.taskSourceContext)
    ).toBe(true)
    expect(JSON.stringify(data)).toContain('Users bounce back to sign-in.')
  })

  it('refuses an item from another connection instead of opening an unlinked composer', () => {
    const openModal = vi.fn()
    expect(
      openPlaneWorkItemComposer({
        item: { ...item, connectionId: 'zzzzzzzzzzzzzzzzzzzzzzzz' },
        connection,
        sourceContext: pageContext,
        openModal
      })
    ).toBe(false)
    expect(openModal).not.toHaveBeenCalled()
    expect(
      openPlaneWorkItemComposer({ item, connection, sourceContext: pageContext, openModal })
    ).toBe(true)
    expect(openModal).toHaveBeenCalledWith('new-workspace-composer', expect.any(Object))
  })
})
