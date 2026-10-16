import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  selectProjectGroupRemovalTargets,
  type ProjectGroupRemovalProject
} from '@/store/slices/project-group-removal-targets'
import { getRepoHostIdentity, getRepoHostIdentityForParts } from '@/store/slices/repo-host-identity'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { CrossHostProjectGroupMerge } from '../grouping/cross-host-project-group-merge'

export type ProjectGroupNameDialogState =
  | { type: 'create-from-repo'; repo: Repo }
  // hostId is the group row's owner host, so the mutation is not routed to whichever host has focus.
  | { type: 'rename'; groupId: string; currentName: string; hostId?: ExecutionHostId }

export type ProjectGroupDeleteDialogState = {
  groupId: string
  groupName: string
  removeContainedProjects: boolean
  hostId?: ExecutionHostId
}

type ProjectGroupActionTarget = { groupId: string; hostId?: ExecutionHostId }

export type ProjectGroupDialogs = ReturnType<typeof useProjectGroupDialogs>

function reportProjectGroupDeleteFailures(result: {
  status: string
  failedProjectRemovals: readonly unknown[]
  requestedProjectIds: readonly unknown[]
}): void {
  // Why: a missing group is already the desired end state, so only a real delete failure warrants a toast.
  if (result.status === 'group-delete-failed') {
    toast.error(
      translate('auto.components.sidebar.WorktreeList.groupDeleteFailed', 'Failed to delete group'),
      {
        description: translate(
          'auto.components.sidebar.WorktreeList.groupDeleteFailedDesc',
          'Something went wrong while deleting the group. No projects were removed.'
        )
      }
    )
    return
  }
  if (result.status === 'deleted-group' && result.failedProjectRemovals.length > 0) {
    const requestedCount = result.requestedProjectIds.length
    toast.error(
      translate(
        'auto.components.sidebar.WorktreeList.b667b59632',
        'Some projects could not be removed from Orca'
      ),
      {
        description: translate(
          'auto.components.sidebar.WorktreeList.f94466bc39',
          '{{value0}} of {{value1}} contained project{{value2}} remained after deleting the group.',
          {
            value0: result.failedProjectRemovals.length,
            value1: requestedCount,
            value2: requestedCount === 1 ? '' : 's'
          }
        )
      }
    )
  }
}

// Create/rename/delete flows for project groups, including the contained-project fan-out.
export function useProjectGroupDialogs(args: {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  /** The sidebar's fold of same-named groups across hosts; a merged header's actions reach every member. */
  projectGroupMerge?: CrossHostProjectGroupMerge
}) {
  const { repos, projectGroups, projectGroupMerge } = args
  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const createProjectGroup = useAppStore((s) => s.createProjectGroup)
  const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)
  const deleteProjectGroupWithContainedProjects = useAppStore(
    (s) => s.deleteProjectGroupWithContainedProjects
  )
  const [nameDialog, setNameDialog] = useState<ProjectGroupNameDialogState | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<ProjectGroupDeleteDialogState | null>(null)

  // Why every member: renaming or deleting only the header's own group would split
  // the folded header back into one group per host.
  const resolveGroupTargets = useCallback(
    (groupId: string, hostId?: ExecutionHostId): ProjectGroupActionTarget[] => {
      const members = projectGroupMerge?.membersByDisplayId.get(groupId)
      return members && members.length > 1
        ? members.map((member) => ({ groupId: member.id, hostId: getRepoExecutionHostId(member) }))
        : [{ groupId, hostId }]
    },
    [projectGroupMerge]
  )

  const handleCreateGroupFromRepo = useCallback((repo: Repo) => {
    setNameDialog({ type: 'create-from-repo', repo })
  }, [])

  const handleMoveProjectToGroup = useCallback(
    (repo: Repo, groupId: string) => {
      if (repo.projectGroupId === groupId) {
        return
      }
      void moveProjectToGroup(repo.id, groupId, undefined, getRepoExecutionHostId(repo))
    },
    [moveProjectToGroup]
  )

  const handleRemoveProjectFromGroup = useCallback(
    (repo: Repo) => {
      void moveProjectToGroup(repo.id, null, undefined, getRepoExecutionHostId(repo))
    },
    [moveProjectToGroup]
  )

  const handleRenameProjectGroup = useCallback(
    (groupId: string, currentName: string, hostId?: ExecutionHostId) => {
      setNameDialog({ type: 'rename', groupId, currentName, hostId })
    },
    []
  )

  const handleSubmitProjectGroupName = useCallback(
    async (name: string) => {
      if (!nameDialog) {
        return
      }
      if (nameDialog.type === 'create-from-repo') {
        const hostId = getRepoExecutionHostId(nameDialog.repo)
        const group = await createProjectGroup(name, hostId)
        if (group) {
          await moveProjectToGroup(nameDialog.repo.id, group.id, undefined, hostId)
        }
        return
      }
      const renamed = await Promise.all(
        resolveGroupTargets(nameDialog.groupId, nameDialog.hostId).map((target) =>
          updateProjectGroup(target.groupId, { name }, { hostId: target.hostId })
        )
      )
      if (renamed.some((confirmed) => !confirmed)) {
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.groupRenameFailed',
            'Failed to rename group'
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.groupRenameFailedDesc',
              // Why: a falsy result also covers RPC timeout/disconnect, so the copy must not assert the host refused.
              "Orca could not confirm the new name with the group's host. Recheck the group after reconnecting."
            )
          }
        )
      }
    },
    [createProjectGroup, moveProjectToGroup, nameDialog, resolveGroupTargets, updateProjectGroup]
  )

  const deleteTargets = useMemo(() => {
    if (!deleteDialog) {
      return null
    }
    // Why (id, host): ids repeat across hosts, and a same-id row in each member group is two removals.
    const projectsByHostIdentity = new Map<string, ProjectGroupRemovalProject>()
    for (const target of resolveGroupTargets(deleteDialog.groupId, deleteDialog.hostId)) {
      for (const project of selectProjectGroupRemovalTargets(
        projectGroups,
        repos,
        target.groupId,
        target.hostId
      ).projects) {
        projectsByHostIdentity.set(getRepoHostIdentityForParts(project.id, project.hostId), project)
      }
    }
    return [...projectsByHostIdentity.values()]
  }, [deleteDialog, projectGroups, repos, resolveGroupTargets])
  const deleteProjectCount = deleteTargets?.length ?? 0
  const deleteProjectNames = useMemo(() => {
    const reposByHostIdentity = new Map(repos.map((repo) => [getRepoHostIdentity(repo), repo]))
    return (deleteTargets ?? []).map(
      (project) =>
        reposByHostIdentity.get(getRepoHostIdentityForParts(project.id, project.hostId))
          ?.displayName ?? project.id
    )
  }, [deleteTargets, repos])
  const removeContainedProjects =
    deleteProjectCount > 0 && deleteDialog?.removeContainedProjects === true

  const handleDeleteProjectGroup = useCallback(
    (groupId: string, groupName: string, hostId?: ExecutionHostId) => {
      setDeleteDialog({ groupId, groupName, removeContainedProjects: false, hostId })
    },
    []
  )

  const handleConfirmDeleteProjectGroup = useCallback(async () => {
    if (!deleteDialog) {
      return
    }
    try {
      for (const target of resolveGroupTargets(deleteDialog.groupId, deleteDialog.hostId)) {
        reportProjectGroupDeleteFailures(
          await deleteProjectGroupWithContainedProjects(target.groupId, {
            removeContainedProjects,
            hostId: target.hostId
          })
        )
      }
    } finally {
      // Why: deleting contained projects can unmount this dialog before its close handler runs, so the parent owns cleanup.
      setDeleteDialog(null)
    }
  }, [
    deleteProjectGroupWithContainedProjects,
    removeContainedProjects,
    deleteDialog,
    resolveGroupTargets
  ])

  return {
    nameDialog,
    setNameDialog,
    deleteDialog,
    setDeleteDialog,
    deleteProjectCount,
    deleteProjectNames,
    removeContainedProjects,
    handleCreateGroupFromRepo,
    handleMoveProjectToGroup,
    handleRemoveProjectFromGroup,
    handleRenameProjectGroup,
    handleSubmitProjectGroupName,
    handleDeleteProjectGroup,
    handleConfirmDeleteProjectGroup
  }
}
