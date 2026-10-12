import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkflowRun } from '../../../../shared/workflow-types'

type Props = { activeRun: WorkflowRun; onDismiss: () => void }

export default function WorkflowRunBanner({ activeRun, onDismiss }: Props): React.JSX.Element {
  const completedCount = activeRun.nodeRuns.filter((nr) => nr.status === 'completed').length
  const skippedCount = activeRun.nodeRuns.filter((nr) => nr.status === 'skipped').length
  const failedCount = activeRun.nodeRuns.filter((nr) => nr.status === 'failed').length
  const totalCount = activeRun.nodeRuns.length

  const label =
    activeRun.status === 'running'
      ? `${translate('workflows.run.running', 'Running…')} ${completedCount}/${totalCount - skippedCount} ${translate('workflows.run.nodes', 'nodes')}`
      : activeRun.status === 'completed'
        ? `${translate('workflows.run.completed', 'Run completed')}${skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
        : activeRun.status === 'failed'
          ? `${translate('workflows.run.failed', 'Run failed:')} ${activeRun.error ?? ''}`
          : activeRun.status === 'cancelled'
            ? translate('workflows.run.cancelled', 'Run cancelled')
            : activeRun.status

  return (
    <button
      type="button"
      className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-background/95 border border-border rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-2 cursor-pointer hover:bg-background transition-colors"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onDismiss}
      title={translate('workflows.run.clickToDismiss', 'Click to dismiss')}
    >
      {activeRun.status === 'running' && (
        <Loader2 className="size-3 animate-spin text-status-warning shrink-0" />
      )}
      {activeRun.status === 'completed' && (
        <CheckCircle2 className="size-3 text-status-success shrink-0" />
      )}
      {(activeRun.status === 'failed' || activeRun.status === 'cancelled') && (
        <XCircle className="size-3 text-destructive shrink-0" />
      )}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  )
}
