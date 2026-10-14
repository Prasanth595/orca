import { describe, expect, it } from 'vitest'
import type {
  PlaneConnection,
  PlaneConnectionEntry,
  PlaneConnectionStatus
} from '../../../../../shared/plane-types'
import { PLANE_ALL_WORKSPACES } from '@/store/slices/plane-slice-contract'
import { getTaskSourceContextSummary } from '@/components/task-source-context-summary'
import {
  getPlaneTasksSourceLabel,
  getPlaneWorkspaceLabel,
  partitionPlaneWorkspaces,
  resolvePlaneTasksWorkspace
} from './plane-workspace-selection'

function connection(id: string, overrides: Partial<PlaneConnection> = {}): PlaneConnection {
  return {
    id,
    hostKind: 'self-hosted',
    apiBaseUrl: 'https://plane.grupoms.net',
    webBaseUrl: 'https://plane.grupoms.net',
    workspaceSlug: id,
    viewer: { id: 'viewer', displayName: 'Ada', email: null },
    projectScope: { mode: 'all' },
    connectedAt: 1,
    ...overrides
  }
}

const entry = (value: PlaneConnection, credentialError?: string): PlaneConnectionEntry => ({
  connection: value,
  credentialProtection: 'sealed',
  ...(credentialError ? { credentialError } : {})
})

describe('plane workspace selection', () => {
  it('labels Cloud and self-hosted workspaces the same way', () => {
    expect(getPlaneWorkspaceLabel(connection('acme'))).toBe('acme · plane.grupoms.net')
    expect(
      getPlaneWorkspaceLabel(
        connection('acme', { hostKind: 'cloud', webBaseUrl: 'https://app.plane.so' })
      )
    ).toBe('acme · Plane Cloud')
  })

  it('keeps a remembered workspace or All while it applies, else the active one', () => {
    const entries = [entry(connection('a')), entry(connection('b'))]
    expect(resolvePlaneTasksWorkspace('b', entries, 'a')).toBe('b')
    expect(resolvePlaneTasksWorkspace(PLANE_ALL_WORKSPACES, entries, 'a')).toBe(
      PLANE_ALL_WORKSPACES
    )
    expect(resolvePlaneTasksWorkspace('gone', entries, 'a')).toBe('a')
    expect(resolvePlaneTasksWorkspace(null, entries, 'a')).toBe('a')
  })

  it('never offers All with a single workspace', () => {
    expect(resolvePlaneTasksWorkspace(PLANE_ALL_WORKSPACES, [entry(connection('a'))], 'a')).toBe(
      'a'
    )
  })

  it('separates workspaces the merged view can list from those needing the user', () => {
    const { listable, blocked } = partitionPlaneWorkspaces([
      entry(connection('a')),
      entry(connection('b'), 'unreadable'),
      entry(connection('c', { projectScope: null }))
    ])
    expect(listable.map((value) => value.id)).toEqual(['a'])
    expect(blocked.map(({ connection: value, reason }) => [value.id, reason])).toEqual([
      ['b', 'credential'],
      ['c', 'needs-scope']
    ])
  })

  describe('Tasks source chip', () => {
    const acme = connection('acme')
    const beta = connection('beta')
    const status: PlaneConnectionStatus = {
      connected: true,
      connection: acme,
      credentialProtection: 'sealed',
      connections: [entry(acme), entry(beta)]
    }
    const chip = (choice: string | null) =>
      getTaskSourceContextSummary({
        provider: 'plane',
        providerLabel: 'Plane',
        accountHostId: 'local',
        planeWorkspaceSlug: getPlaneTasksSourceLabel(status, choice)
      }).label

    it('names the chosen workspace, not the active one', () => {
      expect(getPlaneTasksSourceLabel(status, 'beta')).toBe('beta')
      expect(chip('beta')).toMatch(/^Plane · .+ · beta$/)
    })

    it('says All workspaces while the merged view is shown', () => {
      expect(getPlaneTasksSourceLabel(status, PLANE_ALL_WORKSPACES)).toBe('All workspaces')
      expect(chip(PLANE_ALL_WORKSPACES)).toMatch(/^Plane · .+ · All workspaces$/)
    })

    it('falls back to the active workspace, and to nothing when disconnected', () => {
      expect(getPlaneTasksSourceLabel(status, null)).toBe('acme')
      expect(getPlaneTasksSourceLabel(status, 'gone')).toBe('acme')
      expect(getPlaneTasksSourceLabel({ connected: false }, PLANE_ALL_WORKSPACES)).toBeNull()
    })
  })
})
