import { useCallback } from 'react'
import { toast } from 'sonner'
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
          toast.success(`Workflow "${wf.name}" created`)
        })
        .catch(() => toast.error('Failed to create workflow'))
      return true
    },
    [setSelectedWorkflowId, openWorkflowsPage]
  )
}
