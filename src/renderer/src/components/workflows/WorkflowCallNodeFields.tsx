import { useState, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { AgentWorkflow } from '../../../../shared/workflow-types'

type Props = {
  localData: Record<string, string>
  onDataChange: (patch: Record<string, string>) => void
  currentWorkflowId: string
}

export default function WorkflowCallNodeFields({
  localData,
  onDataChange,
  currentWorkflowId
}: Props): React.JSX.Element {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([])

  useEffect(() => {
    void window.api.workflows.list().then(setWorkflows)
  }, [])

  const available = workflows.filter((wf) => wf.id !== currentWorkflowId)
  const selectedId = localData['targetWorkflowId'] ?? ''

  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {translate('workflows.nodeEditor.subWorkflow', 'Sub-workflow')}
      </span>
      <Select
        value={selectedId || '__none__'}
        onValueChange={(v) => onDataChange({ targetWorkflowId: v === '__none__' ? '' : v })}
      >
        <SelectTrigger className="h-7">
          <SelectValue
            placeholder={translate(
              'workflows.nodeEditor.subWorkflowPlaceholder',
              'Choose a workflow…'
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {available.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              {translate('workflows.nodeEditor.noSubWorkflows', 'No other workflows found')}
            </div>
          )}
          {available.map((wf) => (
            <SelectItem key={wf.id} value={wf.id}>
              {wf.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
