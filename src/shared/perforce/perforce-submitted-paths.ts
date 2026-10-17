import type { PerforceFileAction } from './perforce-types'

// Submitted CL diffs travel through the generic git:diff channel as a special relative path.
// Format: __p4sub{CL}/{depotPathWithoutLeadingSlashes}#subact{action}
// Designed to survive path.resolve() normalization on all platforms (no leading //, no special chars).
const SUBMITTED_RE = /^__p4sub(\d+)[/\\](.+)#subact([^#]+)$/

export type SubmittedDiffTarget = {
  changelist: number
  depotPath: string
  action: PerforceFileAction
}

export function toSubmittedDiffPath(
  depotPath: string,
  changelist: number,
  action: PerforceFileAction
): string {
  // Strip leading // from depot paths (//depot/... → depot/...) to keep the path clean.
  return `__p4sub${changelist}/${depotPath.replace(/^\/\//, '')}#subact${action}`
}

export function parseSubmittedDiffPath(filePath: string): SubmittedDiffTarget | null {
  // Normalize Windows backslashes before matching.
  const normalized = filePath.replace(/\\/g, '/')
  const match = SUBMITTED_RE.exec(normalized)
  if (!match) {
    return null
  }
  return {
    changelist: Number(match[1]),
    // Restore the // depot prefix that was stripped during encoding.
    depotPath: `//${match[2]}`,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: regex group 3 captures the action literal encoded by toSubmittedDiffPath, which only accepts PerforceFileAction values.
    action: (match[3] ?? 'unknown') as PerforceFileAction
  }
}
