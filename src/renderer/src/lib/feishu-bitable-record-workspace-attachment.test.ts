import { describe, expect, it } from 'vitest'
import type { FeishuBitableRecordReference } from '../../../shared/feishu-bitable-task-contract'
import { findFeishuBitableRecordWorkspaceAttachment } from './feishu-bitable-record-workspace-attachment'
import type { Worktree } from '../../../shared/worktree/types'

const REFERENCE: FeishuBitableRecordReference = {
  connectionId: 'conn-1',
  appToken: 'app-token-a',
  tableId: 'tbl-alpha',
  recordId: 'rec-0001'
}

function worktreeWith(
  overrides: Partial<Pick<Worktree, 'id' | 'lastActivityAt' | 'isArchived'>> & {
    linkedItems: Worktree['linkedItems']
  }
): Worktree {
  return {
    id: overrides.id ?? 'wt-1',
    repoId: 'repo-1',
    path: '/tmp/repo-1/wt-1',
    head: 'abc123',
    branch: 'refs/heads/feature/feishu-attachment',
    isBare: false,
    isMainWorktree: false,
    displayName: 'Feishu workspace',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: overrides.isArchived ?? false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: overrides.lastActivityAt ?? 0,
    linkedItems: overrides.linkedItems
  }
}

describe('findFeishuBitableRecordWorkspaceAttachment', () => {
  it('matches a worktree whose attachment carries the same record tuple', () => {
    const attached = worktreeWith({
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'Fix login flow',
          url: 'https://open.feishu.cn/base/app-token-a?table=tbl-alpha&record=rec-0001',
          feishuRecord: REFERENCE
        }
      ]
    })
    expect(findFeishuBitableRecordWorkspaceAttachment([attached], REFERENCE)).toBe(attached)
  })

  it('ignores same-titled records from another table or connection', () => {
    const otherTable = worktreeWith({
      id: 'wt-other-table',
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'Fix login flow',

          feishuRecord: { ...REFERENCE, tableId: 'tbl-beta' }
        }
      ]
    })
    const otherConnection = worktreeWith({
      id: 'wt-other-conn',
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'Fix login flow',

          feishuRecord: { ...REFERENCE, connectionId: 'conn-2' }
        }
      ]
    })
    expect(
      findFeishuBitableRecordWorkspaceAttachment([otherTable, otherConnection], REFERENCE)
    ).toBeNull()
  })

  it('ignores attachments without a record tuple, archived worktrees, and other providers', () => {
    const noTuple = worktreeWith({
      id: 'wt-no-tuple',
      linkedItems: [
        {
          provider: 'jira',
          type: 'issue',
          number: 0,
          title: 'Fix login flow',
          jiraIdentifier: 'ORCA-1'
        }
      ]
    })
    const archived = worktreeWith({
      id: 'wt-archived',
      isArchived: true,
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'Fix',
          feishuRecord: REFERENCE
        }
      ]
    })
    expect(findFeishuBitableRecordWorkspaceAttachment([noTuple, archived], REFERENCE)).toBeNull()
  })

  it('prefers the most recently active match', () => {
    const older = worktreeWith({
      id: 'wt-old',
      lastActivityAt: 10,
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'First',
          feishuRecord: REFERENCE
        }
      ]
    })
    const newer = worktreeWith({
      id: 'wt-new',
      lastActivityAt: 20,
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: 'Second',
          feishuRecord: REFERENCE
        }
      ]
    })
    expect(findFeishuBitableRecordWorkspaceAttachment([older, newer], REFERENCE)).toBe(newer)
  })
})

it('does not reuse an attachment from another source host', () => {
  const attached = worktreeWith({
    linkedItems: [
      {
        provider: 'feishu-bitable',
        type: 'issue',
        number: 0,
        title: 'Task',
        url: 'https://example.com/record',
        feishuRecord: REFERENCE,
        taskSourceContext: {
          kind: 'task-source',
          provider: 'feishu-bitable',
          hostId: 'runtime:source-a',
          projectId: 'project',
          providerIdentity: {
            provider: 'feishu-bitable',
            connectionId: REFERENCE.connectionId,
            appToken: REFERENCE.appToken,
            tableId: REFERENCE.tableId
          }
        }
      }
    ]
  })
  expect(
    findFeishuBitableRecordWorkspaceAttachment([attached], REFERENCE, 'runtime:source-a')
  ).toBe(attached)
  expect(
    findFeishuBitableRecordWorkspaceAttachment([attached], REFERENCE, 'runtime:source-b')
  ).toBeNull()
})
