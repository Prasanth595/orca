import { normalizeFeishuBitableRecordReference } from './feishu-bitable-types'
import type { WorkspaceLinkedItem } from './worktree/types'

export function areWorkspaceLinkedItemsEqual(
  a: WorkspaceLinkedItem | null | undefined,
  b: WorkspaceLinkedItem | null | undefined
): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return !a && !b
  }
  if (a.provider !== b.provider) {
    return false
  }
  // Why: a Feishu record's identity is the connection/app/table/record tuple;
  // number/url/title drift must not split or merge records.
  if (a.provider === 'feishu-bitable' || b.provider === 'feishu-bitable') {
    return (
      a.provider === 'feishu-bitable' &&
      b.provider === 'feishu-bitable' &&
      normalizeFeishuBitableRecordReference(a.feishuRecord) !== null &&
      feishuRecordKey(a.feishuRecord) === feishuRecordKey(b.feishuRecord)
    )
  }
  return (
    a.type === b.type &&
    a.number === b.number &&
    a.title === b.title &&
    a.url === b.url &&
    (a.linearIdentifier ?? null) === (b.linearIdentifier ?? null) &&
    (a.jiraIdentifier ?? null) === (b.jiraIdentifier ?? null) &&
    (a.repoId ?? null) === (b.repoId ?? null)
  )
}

export function normalizeWorkspaceLinkedItem(value: unknown): WorkspaceLinkedItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<WorkspaceLinkedItem>
  if (
    raw.provider !== 'github' &&
    raw.provider !== 'gitlab' &&
    raw.provider !== 'linear' &&
    raw.provider !== 'jira' &&
    raw.provider !== 'feishu-bitable'
  ) {
    return null
  }
  if (raw.type !== 'issue' && raw.type !== 'pr' && raw.type !== 'mr') {
    return null
  }
  if (
    typeof raw.number !== 'number' ||
    !Number.isFinite(raw.number) ||
    typeof raw.title !== 'string' ||
    raw.title.trim().length === 0 ||
    typeof raw.url !== 'string' ||
    raw.url.trim().length === 0
  ) {
    return null
  }
  // Why: without the full record tuple the link cannot be de-duplicated or
  // reopened, so a Feishu item missing it is not a valid linked item.
  const feishuRecord =
    raw.provider === 'feishu-bitable'
      ? normalizeFeishuBitableRecordReference(raw.feishuRecord)
      : null
  if (raw.provider === 'feishu-bitable' && !feishuRecord) {
    return null
  }
  return {
    provider: raw.provider,
    type: raw.type,
    number: raw.number,
    title: raw.title.trim(),
    url: raw.url.trim(),
    ...(typeof raw.linearIdentifier === 'string' && raw.linearIdentifier.trim().length > 0
      ? { linearIdentifier: raw.linearIdentifier.trim() }
      : {}),
    ...(typeof raw.jiraIdentifier === 'string' && raw.jiraIdentifier.trim().length > 0
      ? { jiraIdentifier: raw.jiraIdentifier.trim() }
      : {}),
    ...(feishuRecord ? { feishuRecord } : {}),
    ...(typeof raw.repoId === 'string' && raw.repoId.trim().length > 0
      ? { repoId: raw.repoId.trim() }
      : {})
  }
}

function feishuRecordKey(reference: WorkspaceLinkedItem['feishuRecord']): string {
  if (!reference) {
    return ''
  }
  return JSON.stringify([
    reference.connectionId,
    reference.appToken,
    reference.tableId,
    reference.recordId
  ])
}
