import { describe, expect, it } from 'vitest'
import { TASK_PROVIDERS } from './task-providers'
import { normalizeWorkspaceLinkedItem } from './workspace-linked-item'

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
})
