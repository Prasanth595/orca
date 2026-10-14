import type { PullRequestGenerationRecord } from './pull-request-generation'

export function markPullRequestGenerationRequiresPushBeforeCreate({
  record,
  requestId
}: {
  record: PullRequestGenerationRecord | null | undefined
  requestId: number
}): PullRequestGenerationRecord | null {
  if (!record || record.context.requestId !== requestId || record.status !== 'running') {
    return null
  }
  return {
    ...record,
    requiresPushBeforeCreate: true
  }
}

export function clearPullRequestGenerationRequiresPushBeforeCreate(
  record: PullRequestGenerationRecord | null | undefined
): PullRequestGenerationRecord | null {
  if (!record) {
    return null
  }
  if (!record.requiresPushBeforeCreate) {
    return record
  }
  return {
    ...record,
    requiresPushBeforeCreate: false
  }
}
