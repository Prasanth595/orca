import { useState } from 'react'
import { ChevronRight, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentWorkflow } from '../../../../shared/workflow-types'
import type { StepOutput } from '../../hooks/use-workflow-last-outputs'
import WorkflowNodeOutputInspector from './WorkflowNodeOutputInspector'

type Props = {
  workflow: AgentWorkflow
  lastOutputs: Record<string, StepOutput>
  onInsert?: (expr: string) => void
}

const NODE_TYPE_LABELS: Record<string, string> = {
  trigger_cron: 'Cron',
  trigger_manual: 'Manual',
  shell_command: 'Shell',
  python_script: 'Python',
  agent_call: 'Agent',
  file_read: 'File Read',
  file_write: 'File Write',
  email_send: 'Email',
  http_request: 'HTTP',
  json_transform: 'JSON'
}

export default function WorkflowOutputBrowserDrawer({
  workflow,
  lastOutputs,
  onInsert
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const nodesWithOutputs = workflow.nodes.filter((n) => lastOutputs[n.id])

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-6"
        onClick={() => setOpen((v) => !v)}
        title={translate('workflows.outputBrowser.browseTitle', 'Browse last run outputs')}
      >
        <Database className="size-3" />
        {translate('workflows.outputBrowser.browseButton', 'Browse outputs')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end pointer-events-none">
          <div
            className="pointer-events-auto w-[380px] h-full bg-background border-l border-border shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-[12px] font-semibold">
                {translate('workflows.outputBrowser.lastRunOutputs', 'Last Run Outputs')}
              </span>
              <Button size="icon" variant="ghost" className="size-6" onClick={() => setOpen(false)}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-sleek min-h-0">
              {nodesWithOutputs.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-muted-foreground">
                  {translate('workflows.outputBrowser.noOutputs', 'No outputs from last run yet.')}
                </div>
              ) : (
                nodesWithOutputs.map((node) => (
                  <div key={node.id} className="border-b border-border/50">
                    <button
                      type="button"
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 text-left',
                        selectedNodeId === node.id && 'bg-muted'
                      )}
                      onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14 shrink-0">
                        {NODE_TYPE_LABELS[node.type] ?? node.type}
                      </span>
                      <span className="text-[12px] truncate flex-1">{node.id.slice(0, 8)}</span>
                    </button>
                    {selectedNodeId === node.id && (
                      <div className="px-3 pb-3">
                        {onInsert && (
                          <div className="text-[10px] text-muted-foreground mb-1">
                            {translate(
                              'workflows.outputBrowser.insertHint',
                              'Click a value to insert template expression'
                            )}
                          </div>
                        )}
                        <WorkflowNodeOutputInspector
                          nodeId={node.id}
                          output={lastOutputs[node.id]?.json ?? lastOutputs[node.id]?.output}
                          onCopyExpr={onInsert}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <div
            className="pointer-events-auto absolute inset-0 -z-10"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </>
  )
}
