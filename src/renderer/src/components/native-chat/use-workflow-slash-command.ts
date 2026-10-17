import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'

/** Longest wait for the agent to report a created workflow before giving up. */
const WATCH_TIMEOUT_MS = 10 * 60 * 1000

/** Arming callback; `description` is the routed prompt's free text or null when absent. */
export type WorkflowRouteArmer = (description: string | null) => void

/**
 * Arms the "/workflow routed to the agent" watch: the routing prompt sends the
 * description as a normal chat turn, and the first workflow created after the
 * arm (the agent's CLI import) is selected on the Workflows page.
 */
export function useWorkflowSlashCommand(): WorkflowRouteArmer {
  const setSelectedWorkflowId = useAppStore((s) => s.setSelectedWorkflowId)
  const openWorkflowsPage = useAppStore((s) => s.openWorkflowsPage)
  const activeWatchRef = useRef<{ exit: () => void } | null>(null)

  useEffect(() => {
    const active = activeWatchRef.current
    return () => active?.exit()
  }, [])

  return useCallback(() => {
    // A newer route supersedes an in-flight watch: the just-sent prompt's graph is the target.
    activeWatchRef.current?.exit()
    // Why createdAt alone: the routing prompt is sent after arming, so the
    // agent's CLI import strictly postdates it; a stale list diff can race.
    const armedAt = Date.now()
    let settled = false
    const exit = () => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      activeWatchRef.current = null
    }
    const timeout = window.setTimeout(exit, WATCH_TIMEOUT_MS)
    const unsubscribe = window.api.workflows.onChanged((payload) => {
      const created = payload.workflows.find((wf) => wf.createdAt > armedAt)
      if (!created) {
        return
      }
      exit()
      setSelectedWorkflowId(created.id)
      openWorkflowsPage()
      toast.success(
        translate(
          'auto.components.WorkflowSlashCommand.workflowCreated',
          'Workflow "{{workflowName}}" created',
          { workflowName: created.name }
        )
      )
    })
    activeWatchRef.current = { exit }
  }, [setSelectedWorkflowId, openWorkflowsPage])
}
