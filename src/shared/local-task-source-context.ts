import { LOCAL_EXECUTION_HOST_ID } from './execution-host'
import { normalizeTaskSourceContext, type TaskSourceContext } from './task-source-context'

// Why project-scoped, not repo-loop: local tasks belong to a project, so one
// context with a pinned local host, null repo id, no identity, no preflight.
// Null when no active project: the board shows the no-active-project empty
// state with creation disabled instead of guessing a bucket (KTD3).
export function getLocalTaskSourceContext(
  projectId: string | null | undefined
): TaskSourceContext | null {
  if (!projectId || projectId.trim().length === 0) {
    return null
  }
  return normalizeTaskSourceContext({
    provider: 'local',
    projectId: projectId.trim(),
    hostId: LOCAL_EXECUTION_HOST_ID,
    projectHostSetupId: null,
    repoId: null,
    providerIdentity: null,
    accountLabel: null
  })
}
