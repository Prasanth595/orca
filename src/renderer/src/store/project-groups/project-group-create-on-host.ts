import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { getProjectGroupHostId } from '../slices/project-group-owner-routing'
import { adoptFromEndpoint } from '../adopt-from-endpoint'

/** Creates a group on the given host and adds the host-stamped row to the catalog. */
export function createProjectGroupOnHost(set: Parameters<StateCreator<AppState>>[0]) {
  return async (
    target: RuntimeClientTarget,
    args: Parameters<typeof window.api.projectGroups.create>[0]
  ): Promise<ProjectGroup> => {
    const group =
      target.kind === 'local'
        ? await window.api.projectGroups.create(args)
        : (
            await callRuntimeRpc<{ group: ProjectGroup }>(target, 'projectGroup.create', args, {
              timeoutMs: 15_000
            })
          ).group
    const ownedGroup = adoptFromEndpoint(target, { kind: 'projectGroup', row: group })
    const ownerHostId = getProjectGroupHostId(ownedGroup)
    set((s) => {
      // An overlapping catalog refresh may have already inserted a newer copy.
      if (
        s.projectGroups.some(
          (existing) =>
            existing.id === ownedGroup.id && getProjectGroupHostId(existing) === ownerHostId
        )
      ) {
        return s
      }
      return {
        projectGroups: [...s.projectGroups, ownedGroup],
        folderWorkspacePathStatuses: {}
      }
    })
    return ownedGroup
  }
}
