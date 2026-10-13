import { isWorkspaceLinkedItemSourceContextMatch } from '../../../shared/workspace-linked-item-source-context'
import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { openFeishuBitableRecordWorkspaceOrStart } from '@/lib/feishu-bitable-record-workspace-open'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { getLinkedWorkItemWorkspaceName } from '../../../shared/workspace-name'
import type { FeishuBitableTask } from '../../../shared/feishu-bitable-types'
import type { TaskPageJiraListEffectsModel } from './use-task-page-jira-list-effects'

type FeishuBitableTaskComposerArgs = {
  openModal: TaskPageJiraListEffectsModel['openModal']
  feishuBitableTaskSourceContext: TaskPageJiraListEffectsModel['feishuBitableTaskSourceContext']
}

// Why: mirrors the Linear/Jira composer entries — dedup-or-open first, then the
// pre-filled new-workspace composer so the user confirms name/agent/host.
export function useFeishuBitableTaskComposer(args: FeishuBitableTaskComposerArgs): {
  openComposerForFeishuBitableTask: (task: FeishuBitableTask) => void
  handleUseFeishuBitableTask: (task: FeishuBitableTask) => void
} {
  const { openModal, feishuBitableTaskSourceContext } = args
  const openComposerForFeishuBitableTask = useCallback(
    (task: FeishuBitableTask): void => {
      if (!feishuBitableTaskSourceContext) {
        // Why: refuse rather than create an unlinked workspace — the record tuple is the identity.
        toast.error(
          translate(
            'auto.components.TaskPage.feishuBitableLinkUnavailable',
            'Couldn’t link this Feishu record. Reconnect Feishu Bitable, then try again.'
          )
        )
        return
      }
      // Why: Bitable rows have no numeric id; number 0 is a display placeholder, identity rides on feishuRecord.
      const linkedWorkItem: LinkedWorkItemSummary = {
        type: 'issue',
        provider: 'feishu-bitable',
        number: 0,
        title: task.title,
        url: task.url ?? '',
        feishuRecord: task.record,
        feishuTask: {
          source: task.source,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          url: task.url
        }
      }
      if (
        !isWorkspaceLinkedItemSourceContextMatch(linkedWorkItem, feishuBitableTaskSourceContext)
      ) {
        toast.error('Reload the Feishu record after switching connections.')
        return
      }
      const seed = getLinkedWorkItemWorkspaceName(linkedWorkItem)
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext: feishuBitableTaskSourceContext,
        ...(seed?.seedName ? { prefilledName: seed.seedName } : {}),
        telemetrySource: 'sidebar'
      })
    },
    [feishuBitableTaskSourceContext, openModal]
  )
  const handleUseFeishuBitableTask = useCallback(
    (task: FeishuBitableTask): void => {
      useAppStore.getState().recordFeatureInteraction('feishu-bitable-tasks')
      if (!feishuBitableTaskSourceContext) {
        openComposerForFeishuBitableTask(task)
        return
      }
      openFeishuBitableRecordWorkspaceOrStart(
        task.record,
        () => openComposerForFeishuBitableTask(task),
        feishuBitableTaskSourceContext.hostId
      )
    },
    [openComposerForFeishuBitableTask, feishuBitableTaskSourceContext]
  )
  return { openComposerForFeishuBitableTask, handleUseFeishuBitableTask }
}
