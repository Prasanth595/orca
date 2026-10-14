import type { JiraIssueUpdate } from '../../shared/jira-types'

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

/** Narrows an untrusted IPC payload to the issue-update fields the host accepts. */
export function normalizeIssueUpdate(value: unknown): JiraIssueUpdate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const input = value as JiraIssueUpdate
  if (input.title !== undefined && typeof input.title !== 'string') {
    return null
  }
  if (input.labels !== undefined && normalizeStringArray(input.labels) === undefined) {
    return null
  }
  if (
    input.assigneeAccountId !== undefined &&
    input.assigneeAccountId !== null &&
    typeof input.assigneeAccountId !== 'string'
  ) {
    return null
  }
  if (
    input.priorityId !== undefined &&
    input.priorityId !== null &&
    typeof input.priorityId !== 'string'
  ) {
    return null
  }
  if (input.transitionId !== undefined && typeof input.transitionId !== 'string') {
    return null
  }
  if (
    input.transitionFields !== undefined &&
    (input.transitionFields === null ||
      typeof input.transitionFields !== 'object' ||
      Array.isArray(input.transitionFields))
  ) {
    return null
  }
  if (input.transitionComment !== undefined && typeof input.transitionComment !== 'string') {
    return null
  }
  return input
}
