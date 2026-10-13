import { describe, expect, it } from 'vitest'
import type { TaskSourceContext } from './task-source-context'
import type { WorkspaceLinkedItem } from './worktree/types'
import { isWorkspaceLinkedItemSourceContextMatch } from './workspace-linked-item-source-context'

const JIRA_ITEM: WorkspaceLinkedItem = {
  provider: 'jira',
  type: 'issue',
  number: 0,
  title: 'ORCA-123 Link Jira',
  url: 'https://company.atlassian.net/jira/browse/ORCA-123',
  jiraIdentifier: 'ORCA-123'
}

const JIRA_CONTEXT: TaskSourceContext = {
  kind: 'task-source',
  provider: 'jira',
  projectId: 'project-1',
  hostId: 'local',
  providerIdentity: {
    provider: 'jira',
    siteId: 'site-1',
    siteUrl: 'https://company.atlassian.net/jira',
    projectKey: 'ORCA'
  }
}

describe('workspace linked-item source context', () => {
  it('requires Jira key, site URL, site account, and project identity to agree', () => {
    expect(isWorkspaceLinkedItemSourceContextMatch(JIRA_ITEM, JIRA_CONTEXT)).toBe(true)
    expect(
      isWorkspaceLinkedItemSourceContextMatch(JIRA_ITEM, {
        ...JIRA_CONTEXT,
        providerIdentity: {
          ...JIRA_CONTEXT.providerIdentity!,
          provider: 'jira',
          siteUrl: 'https://other.atlassian.net'
        }
      })
    ).toBe(false)
    expect(
      isWorkspaceLinkedItemSourceContextMatch(JIRA_ITEM, {
        ...JIRA_CONTEXT,
        providerIdentity: {
          ...JIRA_CONTEXT.providerIdentity!,
          provider: 'jira',
          projectKey: 'OTHER'
        }
      })
    ).toBe(false)
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        { ...JIRA_ITEM, jiraIdentifier: 'ORCA-999' },
        JIRA_CONTEXT
      )
    ).toBe(false)
  })

  it('keeps provider matching sufficient for non-Jira items', () => {
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        {
          provider: 'linear',
          type: 'issue',
          number: 0,
          title: 'Linear item',
          url: 'https://linear.app/acme/issue/ENG-1/item'
        },
        {
          kind: 'task-source',
          provider: 'linear',
          projectId: 'project-1',
          hostId: 'local'
        }
      )
    ).toBe(true)
  })

  it('infers GitHub/GitLab provider when TaskPage seeds omit provider', () => {
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        {
          type: 'issue',
          number: 42,
          title: 'GitHub issue',
          url: 'https://github.com/acme/repo/issues/42'
        },
        {
          kind: 'task-source',
          provider: 'github',
          projectId: 'project-1',
          hostId: 'local'
        }
      )
    ).toBe(true)
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        {
          type: 'mr',
          number: 7,
          title: 'GitLab MR',
          url: 'https://gitlab.com/acme/repo/-/merge_requests/7'
        },
        {
          kind: 'task-source',
          provider: 'gitlab',
          projectId: 'project-1',
          hostId: 'local'
        }
      )
    ).toBe(true)
  })
})

describe('Feishu linked-item source context', () => {
  const record = {
    connectionId: 'connection',
    appToken: 'app',
    tableId: 'table',
    recordId: 'record'
  }
  const item: WorkspaceLinkedItem = {
    provider: 'feishu-bitable',
    type: 'issue',
    number: 0,
    title: 'Task',
    url: 'https://example.com/record',
    feishuRecord: record
  }
  const context: TaskSourceContext = {
    kind: 'task-source',
    provider: 'feishu-bitable',
    projectId: 'project',
    hostId: 'local',
    providerIdentity: {
      provider: 'feishu-bitable',
      connectionId: 'connection',
      appToken: 'app',
      tableId: 'table'
    }
  }
  it('requires the connection, app and table to agree', () => {
    expect(isWorkspaceLinkedItemSourceContextMatch(item, context)).toBe(true)
    for (const field of ['connectionId', 'appToken', 'tableId'] as const) {
      expect(
        isWorkspaceLinkedItemSourceContextMatch(
          { ...item, feishuRecord: { ...record, [field]: 'other' } },
          context
        )
      ).toBe(false)
    }
    expect(
      isWorkspaceLinkedItemSourceContextMatch({ ...item, feishuRecord: undefined }, context)
    ).toBe(false)
  })
})
