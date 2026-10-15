import { describe, expect, it } from 'vitest'
import { TASK_PROVIDERS } from './task-providers'
import { normalizeWorkspaceLinkedItem } from './workspace-linked-item'
import { WorkspaceLinkedItemSchema } from './workspace-linked-item-schema'

describe('normalizeWorkspaceLinkedItem', () => {
  it.each(TASK_PROVIDERS)('round-trips a %s linked item', (provider) => {
    const item = {
      provider,
      type: 'issue' as const,
      number: 12,
      title: 'Fix the thing',
      url: 'https://example.com/items/12'
    }
    expect(normalizeWorkspaceLinkedItem(item)).toEqual(item)
  })

  it.each(['bitbucket', 'azure-devops', 'unknown', '', null])(
    'rejects unsupported provider %j',
    (provider) => {
      expect(
        normalizeWorkspaceLinkedItem({
          provider,
          type: 'issue',
          number: 12,
          title: 'Fix the thing',
          url: 'https://example.com/items/12'
        })
      ).toBeNull()
    }
  )

  it('keeps a trimmed provider-neutral identifier and drops blank or non-string ones', () => {
    const item = {
      provider: 'jira' as const,
      type: 'issue' as const,
      number: 0,
      title: 'Fix the thing',
      url: 'https://example.atlassian.net/browse/ENG-12'
    }
    expect(normalizeWorkspaceLinkedItem({ ...item, identifier: ' ENG-12 ' })).toEqual({
      ...item,
      identifier: 'ENG-12'
    })
    expect(normalizeWorkspaceLinkedItem({ ...item, identifier: '  ' })).toEqual(item)
    expect(normalizeWorkspaceLinkedItem({ ...item, identifier: 12 })).toEqual(item)
  })

  it('carries the identifier through the RPC schema', () => {
    const item = {
      provider: 'linear' as const,
      type: 'issue' as const,
      number: 0,
      title: 'Fix the thing',
      url: 'https://linear.app/acme/issue/ENG-12',
      identifier: 'ENG-12',
      linearIdentifier: 'ENG-12'
    }
    expect(WorkspaceLinkedItemSchema.parse(item)).toEqual(item)
  })
})
