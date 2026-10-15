import { describe, expect, it } from 'vitest'
import {
  isPlaneConnectionId,
  isPlaneCursor,
  isPlaneProjectIdentifier,
  isPlaneUuid,
  normalizePlaneWorkspaceSlug,
  parsePlaneWorkItemIdentifier
} from './plane-ids'

describe('Plane ids', () => {
  it('accepts UUIDs in either case and nothing path-like', () => {
    expect(isPlaneUuid('0B5C7C4E-2F0A-4C1E-9D55-0D6C1A2B3C4D')).toBe(true)
    expect(isPlaneUuid('0b5c7c4e-2f0a-4c1e-9d55-0d6c1a2b3c4d/..')).toBe(false)
    expect(isPlaneUuid(42)).toBe(false)
  })

  it('normalizes workspace slugs', () => {
    expect(normalizePlaneWorkspaceSlug('  Acme_Team-2 ')).toBe('acme_team-2')
    expect(normalizePlaneWorkspaceSlug('_acme')).toBeNull()
    expect(normalizePlaneWorkspaceSlug('a'.repeat(49))).toBeNull()
  })

  it('parses work item identifiers', () => {
    expect(parsePlaneWorkItemIdentifier(' web-007 ')).toEqual({
      identifier: 'WEB-7',
      projectIdentifier: 'WEB',
      sequenceId: 7
    })
    expect(parsePlaneWorkItemIdentifier('WEB-0')).toBeNull()
    expect(parsePlaneWorkItemIdentifier('WEB 12')).toBeNull()
    expect(isPlaneProjectIdentifier('WEB')).toBe(true)
    expect(isPlaneProjectIdentifier('web')).toBe(false)
  })

  it('validates cursors and connection ids', () => {
    expect(isPlaneCursor('100:2:0')).toBe(true)
    expect(isPlaneCursor('100:2')).toBe(false)
    expect(isPlaneConnectionId('abcdefghijklmnopqrstuv-_')).toBe(true)
    expect(isPlaneConnectionId('short')).toBe(false)
  })
})

describe('non-ASCII project identifiers', () => {
  it('accepts uppercase letters Plane allows beyond ASCII', () => {
    expect(isPlaneProjectIdentifier('ÇAĞ1')).toBe(true)
    expect(parsePlaneWorkItemIdentifier('çağ-3')?.identifier).toBe('ÇAĞ-3')
  })
})
