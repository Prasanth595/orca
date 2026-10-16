import { z } from 'zod'
import { WorktreeSelector } from './git-params'

const MAX_PATHS = 2000

/**
 * `settings` carries the caller's Settings > Perforce (p4 path, connection overrides) so p4 on the
 * serving host runs with the user's configuration; the server normalizes whatever arrives.
 */
export const PerforceWorkspaceParams = WorktreeSelector.extend({
  settings: z.unknown().optional()
})

const Changelist = z.number().int().positive()
const ChangelistTarget = z.union([z.literal('default'), Changelist])
const RelativePaths = z.array(z.string()).max(MAX_PATHS)

export const PerforceHistoryParams = PerforceWorkspaceParams.extend({
  limit: z.number().int().positive().optional()
})
export const PerforceFilePathParams = PerforceWorkspaceParams.extend({ filePath: z.string() })
export const PerforceFilePathsParams = PerforceWorkspaceParams.extend({ filePaths: RelativePaths })
export const PerforceDiscardParams = PerforceWorkspaceParams.extend({
  entries: z
    .array(z.object({ path: z.string(), group: z.string(), action: z.string() }))
    .max(MAX_PATHS)
})
export const PerforceSubmitParams = PerforceWorkspaceParams.extend({
  changelist: ChangelistTarget,
  message: z.string().optional()
})
export const PerforceChangelistParams = PerforceWorkspaceParams.extend({ changelist: Changelist })
export const PerforceUnshelveFromParams = PerforceWorkspaceParams.extend({
  sourceChangelist: Changelist,
  changelist: ChangelistTarget
})
export const PerforceChangelistFilesParams = PerforceChangelistParams.extend({
  filePaths: RelativePaths
})
export const PerforceUnshelveFilesParams = PerforceChangelistParams.extend({
  depotPaths: z.array(z.string()).max(MAX_PATHS)
})
export const PerforceCreateChangelistParams = PerforceWorkspaceParams.extend({
  description: z.string(),
  filePaths: RelativePaths
})
export const PerforceEditDescriptionParams = PerforceChangelistParams.extend({
  description: z.string()
})
export const PerforceMoveToChangelistParams = PerforceWorkspaceParams.extend({
  filePaths: RelativePaths,
  changelist: ChangelistTarget
})
