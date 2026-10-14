import { describe, expect, it } from 'vitest'
import type { PlaneConnectionStatus } from '../../../shared/plane-types'
import { parsePlaneAttachmentInput, resolvePlaneReferenceHint } from './plane-reference-hint'

function status(webBaseUrl: string): PlaneConnectionStatus {
  return {
    connected: true,
    credentialProtection: null,
    connection: {
      id: 'abcdefghijklmnopqrstuvwx',
      hostKind: 'self-hosted',
      apiBaseUrl: webBaseUrl,
      webBaseUrl,
      workspaceSlug: 'acme',
      viewer: { id: 'v', displayName: 'Ada', email: null },
      projectScope: { mode: 'all' },
      connectedAt: 1
    }
  }
}

describe('Plane reference hints', () => {
  const connected = status('https://plane.example.test/plane')

  it('claims a /browse/ link only on the connected web base and slug', () => {
    const url = 'https://plane.example.test/plane/acme/browse/WEB-12/'
    expect(resolvePlaneReferenceHint(url, connected)).toBe('plane')
    expect(resolvePlaneReferenceHint(url, { connected: false })).toBeUndefined()
    expect(
      resolvePlaneReferenceHint('https://plane.example.test/plane/other/browse/WEB-12/', connected)
    ).toBeUndefined()
    expect(
      resolvePlaneReferenceHint('https://jira.example.test/browse/WEB-12', connected)
    ).toBeUndefined()
  })

  it('parses pasted Plane links and leaves Jira links alone', () => {
    expect(
      parsePlaneAttachmentInput('https://plane.example.test/plane/acme/browse/WEB-12/', connected)
    ).toMatchObject({ provider: 'plane', identifier: 'WEB-12' })
    expect(
      parsePlaneAttachmentInput('https://app.plane.so/acme/browse/WEB-12/', null)
    ).toMatchObject({ provider: 'plane', identifier: 'WEB-12' })
    expect(parsePlaneAttachmentInput('https://jira.example.test/browse/WEB-12', connected)).toBe(
      null
    )
  })
})
