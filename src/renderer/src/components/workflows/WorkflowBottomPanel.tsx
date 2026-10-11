import { useState } from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useWorkflowLastOutputs } from '@/hooks/use-workflow-last-outputs'
import {
  NODE_TYPE_LABELS,
  NODE_TYPE_ICON_COLORS,
  NODE_TYPE_ICONS
} from './workflow-canvas-node-config'
import WorkflowRunHistory from './WorkflowRunHistory'
import WorkflowNodeOutputInspector from './WorkflowNodeOutputInspector'

type Props = { workflowId: string }

function OutputsPanel({ workflowId }: Props): React.JSX.Element {
  // orderedNodeIds comes from the same fetch as outputs — no race between the two
  const lastResult = useWorkflowLastOutputs(workflowId)

  if (!lastResult || lastResult.orderedNodeIds.length === 0) {
    return (
      <div className="px-3 py-3 text-[12px] text-muted-foreground">
        {translate('workflows.outputs.empty', 'No outputs yet.')}
      </div>
    )
  }

  const { outputs, orderedNodeIds } = lastResult

  return (
    <div className="flex-1 overflow-y-auto scrollbar-sleek min-h-0">
      {orderedNodeIds.map((nodeId) => {
        const output = outputs[nodeId]
        if (!output) {
          return null
        }
        return (
          <div key={nodeId} className="border-b border-border/50 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              {output.nodeType !== undefined &&
                (() => {
                  const Icon = NODE_TYPE_ICONS[output.nodeType]
                  return (
                    <>
                      <Icon
                        className={cn('size-3 shrink-0', NODE_TYPE_ICON_COLORS[output.nodeType])}
                      />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                        {NODE_TYPE_LABELS[output.nodeType]}
                      </span>
                    </>
                  )
                })()}
              <span className="text-[11px] text-muted-foreground font-mono">
                {nodeId.slice(0, 8)}
              </span>
            </div>
            <WorkflowNodeOutputInspector nodeId={nodeId} output={output.json ?? output.output} />
          </div>
        )
      })}
    </div>
  )
}

type Tab = 'outputs' | 'history'

export default function WorkflowBottomPanel({ workflowId }: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('outputs')

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 border-b border-border shrink-0 h-8">
        {(['outputs', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              'text-[11px] px-2 py-1 rounded transition-colors',
              activeTab === tab
                ? 'text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'outputs'
              ? translate('workflows.bottomPanel.outputs', 'Outputs')
              : translate('workflows.bottomPanel.history', 'Run History')}
          </button>
        ))}
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {activeTab === 'outputs' ? (
          <OutputsPanel workflowId={workflowId} />
        ) : (
          <WorkflowRunHistory workflowId={workflowId} />
        )}
      </div>
    </div>
  )
}
