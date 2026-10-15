import { describe, expect, it } from 'vitest'
import {
  AddComment,
  Connect,
  ListWorkItems,
  LookupIdentifier,
  PLANE_COMMENT_MAX_LENGTH,
  SetProjectScope,
  UpdateState,
  WorkItemRef
} from './plane-params'

const PROJECT_ID = '0b5c7c4e-2f0a-4c1e-9d55-0d6c1a2b3c4d'
const ITEM_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const STATE_ID = '11111111-2222-4333-8444-555555555555'

describe.each([
  { name: 'cloud', host: { hostKind: 'cloud' } },
  {
    name: 'self-hosted',
    host: { hostKind: 'self-hosted', serverUrl: ' https://plane.example.test/plane ' }
  }
])('Connect on $name', ({ host }) => {
  const valid = { ...host, workspaceSlug: ' Acme ', apiToken: ' plane_api_abc123 ' }

  it('normalizes the slug and token', () => {
    expect(Connect.parse(valid)).toMatchObject({
      workspaceSlug: 'acme',
      apiToken: 'plane_api_abc123'
    })
  })

  it.each(['', 'has space', '-leading', 'a/b', 'x'.repeat(49), 42])(
    'rejects the slug %j',
    (workspaceSlug) => {
      expect(Connect.safeParse({ ...valid, workspaceSlug }).success).toBe(false)
    }
  )

  it('rejects a missing or spaced token', () => {
    expect(Connect.safeParse({ ...valid, apiToken: '   ' }).success).toBe(false)
    expect(Connect.safeParse({ ...valid, apiToken: 'a b' }).success).toBe(false)
  })
})

describe('Connect', () => {
  it('requires a server URL for self-hosted', () => {
    const result = Connect.safeParse({
      hostKind: 'self-hosted',
      workspaceSlug: 'acme',
      apiToken: 'token'
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown host kind', () => {
    expect(
      Connect.safeParse({ hostKind: 'saas', workspaceSlug: 'acme', apiToken: 'token' }).success
    ).toBe(false)
  })
})

describe('Plane id params', () => {
  it('accepts UUIDs and lowercases them', () => {
    expect(
      UpdateState.parse({
        projectId: PROJECT_ID.toUpperCase(),
        workItemId: ITEM_ID,
        stateId: STATE_ID
      })
    ).toEqual({ projectId: PROJECT_ID, workItemId: ITEM_ID, stateId: STATE_ID })
  })

  it.each(['', 'WEB-12', '../../users/me', `${PROJECT_ID}/x`, 7])('rejects the id %j', (id) => {
    expect(WorkItemRef.safeParse({ projectId: id, workItemId: ITEM_ID }).success).toBe(false)
    expect(WorkItemRef.safeParse({ projectId: PROJECT_ID, workItemId: id }).success).toBe(false)
  })

  it('validates the project scope', () => {
    expect(SetProjectScope.parse({ scope: { mode: 'all' } })).toEqual({ scope: { mode: 'all' } })
    expect(SetProjectScope.safeParse({ scope: { mode: 'selected', projectIds: [] } }).success).toBe(
      false
    )
    expect(
      SetProjectScope.safeParse({
        scope: { mode: 'selected', projectIds: [PROJECT_ID, PROJECT_ID] }
      }).success
    ).toBe(false)
    expect(
      SetProjectScope.safeParse({ scope: { mode: 'selected', projectIds: ['nope'] } }).success
    ).toBe(false)
  })

  it('validates list cursors by project', () => {
    expect(ListWorkItems.parse(undefined)).toBeUndefined()
    expect(ListWorkItems.parse({ cursorByProject: { [PROJECT_ID]: '100:1:0' } })).toEqual({
      cursorByProject: { [PROJECT_ID]: '100:1:0' }
    })
    expect(ListWorkItems.safeParse({ cursorByProject: { [PROJECT_ID]: 'x' } }).success).toBe(false)
    expect(ListWorkItems.safeParse({ cursorByProject: { nope: '100:1:0' } }).success).toBe(false)
  })
})

describe('AddComment', () => {
  const ref = { projectId: PROJECT_ID, workItemId: ITEM_ID }

  it('trims and bounds the text', () => {
    expect(AddComment.parse({ ...ref, text: '  hi  ' }).text).toBe('hi')
    expect(AddComment.safeParse({ ...ref, text: '   ' }).success).toBe(false)
    expect(
      AddComment.safeParse({ ...ref, text: 'x'.repeat(PLANE_COMMENT_MAX_LENGTH + 1) }).success
    ).toBe(false)
  })
})

describe('LookupIdentifier', () => {
  it('normalizes identifiers', () => {
    expect(LookupIdentifier.parse({ identifier: ' web-012 ' })).toEqual({ identifier: 'WEB-12' })
  })

  it.each(['WEB', 'WEB-0', '-12', 'WEB-12/../x', 'TOOLONGPROJECT1-1'])(
    'rejects %j',
    (identifier) => {
      expect(LookupIdentifier.safeParse({ identifier }).success).toBe(false)
    }
  )
})
