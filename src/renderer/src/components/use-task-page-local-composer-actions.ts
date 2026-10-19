import { useCallback } from 'react'
import type { LocalTask } from '../../../shared/local-task'
import { getLinkedWorkItemSuggestedName } from '../../../shared/workspace-name'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getRepoWorkspaceCreationTargetHint } from '@/lib/project-host-workspace-target'
import type { Repo } from '../../../shared/repo-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

type LocalComposerModel = {
  openModal: (modal: 'new-workspace-composer', data: Record<string, unknown>) => void
  localTaskSourceContext: TaskSourceContext | null
  repos: readonly Repo[] | null | undefined
}

export function useTaskPageLocalComposerActions(model: LocalComposerModel) {
  const { openModal, localTaskSourceContext } = model
  const openComposerForLocalTask = useCallback(
    (task: LocalTask): void => {
      if (!localTaskSourceContext) {
        // Why: composer drops local tasks without matching source context — refuse rather than create unlinked (Jira precedent).
        toast.error(
          translate(
            'auto.components.TaskPage.localLinkSourceUnavailable',
            'Couldn’t link this local task. Select a project, then try again.'
          )
        )
        return
      }
      const linkedWorkItem: LinkedWorkItemSummary = {
        type: 'issue',
        provider: 'local',
        number: task.id,
        title: task.title,
        url: task.url
      }
      const eligibleRepos = (model.repos ?? []).filter((repo) => repo.path)
      const { activeRepoId, projectHostSetups } = useAppStore.getState()
      // Why repo.path, not the shared git-kind selector: a local task needs any
      // writable checkout for its worktree, including non-git folders the
      // task-source pickers hide.
      const defaultRepo =
        eligibleRepos.find((repo) => repo.id === activeRepoId) ?? eligibleRepos[0] ?? null
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext: localTaskSourceContext,
        initialRepoId: defaultRepo?.id,
        initialWorkspaceTarget: defaultRepo
          ? getRepoWorkspaceCreationTargetHint(defaultRepo, projectHostSetups)
          : undefined,
        prefilledName: getLinkedWorkItemSuggestedName(task),
        telemetrySource: 'sidebar'
      })
    },
    [localTaskSourceContext, model.repos, openModal]
  )
  const handleUseLocalTask = useCallback(
    (task: LocalTask): void => {
      useAppStore.getState().recordFeatureInteraction('local-tasks')
      openComposerForLocalTask(task)
    },
    [openComposerForLocalTask]
  )
  return { openComposerForLocalTask, handleUseLocalTask }
}
