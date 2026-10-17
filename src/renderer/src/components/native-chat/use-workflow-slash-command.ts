import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'

/** Returns a stable handler that intercepts /workflow commands; returns true when handled. */
export function useWorkflowSlashCommand(): (command: string) => boolean {
  const setSelectedWorkflowId = useAppStore((s) => s.setSelectedWorkflowId)
  const openWorkflowsPage = useAppStore((s) => s.openWorkflowsPage)
  return useCallback(
    (command: string): boolean => {
      if (!command.trimStart().startsWith('/workflow')) {
        return false
      }
      const name = command.replace(/^\/workflow\s*/i, '').trim() || 'New Workflow'
      void window.api.workflows
        .create({
          name,
          description: '',
          schedule: null,
          enabled: false,
          executionTargetType: 'local',
          executionTargetId: '',
          nodes: [],
          edges: []
        })
        .then((wf) => {
          setSelectedWorkflowId(wf.id)
          openWorkflowsPage()
          toast.success(
            translate(
              'auto.components.WorkflowSlashCommand.workflowCreated',
              'Workflow "{{workflowName}}" created',
              { workflowName: wf.name }
            )
          )
        })
        .catch(() =>
          toast.error(
            translate(
              'auto.components.WorkflowSlashCommand.createFailed',
              'Failed to create workflow'
            )
          )
        )
      return true
    },
    [setSelectedWorkflowId, openWorkflowsPage]
  )
}
