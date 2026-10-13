import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { selectProjectGroupRemovalTargets } from '@/store/slices/project-group-removal-targets'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { isRepoIconStored, type RepoIcon } from '../../../../../../shared/repo-icon'
import { findIndexedProjectGroupOwner } from '@/lib/worktree-runtime-owner-index'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'

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

export type ProjectGroupIconDialogState = {
  groupId: string
  groupName: string
  hostId?: ExecutionHostId
}

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

// Create/rename/icon/delete flows for project groups, including the contained-project fan-out.
export function useProjectGroupDialogs(args: {
  repos: readonly Repo[]
  repoMap: Map<string, Repo>
  projectGroups: readonly ProjectGroup[]
}) {
  const { repos, repoMap, projectGroups } = args
  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const createProjectGroup = useAppStore((s) => s.createProjectGroup)
  const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)
  const deleteProjectGroupWithContainedProjects = useAppStore(
    (s) => s.deleteProjectGroupWithContainedProjects
  )
  const [nameDialog, setNameDialog] = useState<ProjectGroupNameDialogState | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<ProjectGroupDeleteDialogState | null>(null)
  const [iconDialog, setIconDialog] = useState<ProjectGroupIconDialogState | null>(null)

  const handleChangeProjectGroupIcon = useCallback(
    (groupId: string, groupName: string, hostId?: ExecutionHostId) => {
      setIconDialog({ groupId, groupName, hostId })
    },
    []
  )

  // Why: read the live row so the dialog preview tracks each saved pick.
  const iconDialogGroup = useMemo(
    () =>
      iconDialog
        ? findIndexedProjectGroupOwner(projectGroups, iconDialog.groupId, iconDialog.hostId)
        : null,
    [iconDialog, projectGroups]
  )

  // Why: saves run in pick order, so a slow earlier response can't overwrite a later pick.
  const iconSaveQueue = useRef<Promise<void>>(Promise.resolve())

  const saveProjectGroupIcon = useCallback(
    async (target: ProjectGroupIconDialogState, icon: RepoIcon | null) => {
      const saved = await updateProjectGroup(target.groupId, { icon }, { hostId: target.hostId })
      const stored = findIndexedProjectGroupOwner(
        useAppStore.getState().projectGroups,
        target.groupId,
        target.hostId
      )
      if (saved && isRepoIconStored(stored?.icon, icon)) {
        return
      }
      // Why: an older host strips the unknown icon field yet still reports success.
      if (saved && icon !== null && !stored?.icon) {
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.groupIconUnsupported',
            "This group's host doesn't support group icons yet"
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.groupIconUnsupportedDesc',
              'The group is stored on an Orca server running an older version. Update Orca there, then set the icon again.'
            )
          }
        )
        return
      }
      toast.error(
        translate(
          'auto.components.sidebar.WorktreeList.groupIconFailed',
          'Failed to update group icon'
        ),
        {
          description: translate(
            'auto.components.sidebar.WorktreeList.groupIconFailedDesc',
            "Orca could not confirm the icon with the group's host. Recheck the group after reconnecting."
          )
        }
      )
    },
    [updateProjectGroup]
  )

  const handleSetProjectGroupIcon = useCallback(
    (icon: RepoIcon | null): Promise<void> => {
      if (!iconDialog) {
        return Promise.resolve()
      }
      const run = iconSaveQueue.current.then(() => saveProjectGroupIcon(iconDialog, icon))
      iconSaveQueue.current = run.catch(() => undefined)
      return run
    },
    [iconDialog, saveProjectGroupIcon]
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
      const renamed = await updateProjectGroup(
        nameDialog.groupId,
        { name },
        { hostId: nameDialog.hostId }
      )
      if (!renamed) {
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
    [createProjectGroup, moveProjectToGroup, nameDialog, updateProjectGroup]
  )

  const deleteTargets = useMemo(() => {
    if (!deleteDialog) {
      return null
    }
    return selectProjectGroupRemovalTargets(
      projectGroups,
      repos,
      deleteDialog.groupId,
      deleteDialog.hostId
    )
  }, [deleteDialog, projectGroups, repos])
  const deleteProjectCount = deleteTargets?.projectIds.length ?? 0
  const deleteProjectNames = useMemo(
    () =>
      (deleteTargets?.projectIds ?? []).map(
        (projectId) => repoMap.get(projectId)?.displayName ?? projectId
      ),
    [deleteTargets, repoMap]
  )
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
      reportProjectGroupDeleteFailures(
        await deleteProjectGroupWithContainedProjects(deleteDialog.groupId, {
          removeContainedProjects,
          hostId: deleteDialog.hostId
        })
      )
    } finally {
      // Why: deleting contained projects can unmount this dialog before its close handler runs, so the parent owns cleanup.
      setDeleteDialog(null)
    }
  }, [deleteProjectGroupWithContainedProjects, removeContainedProjects, deleteDialog])

  return {
    iconDialog,
    setIconDialog,
    iconDialogGroup,
    handleChangeProjectGroupIcon,
    handleSetProjectGroupIcon,
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
