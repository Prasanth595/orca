import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

type Props = {
  retryCount: string
  retryDelaySeconds: string
  onChange: (patch: Record<string, string>) => void
}

export default function WorkflowRetryFields({
  retryCount,
  retryDelaySeconds,
  onChange
}: Props): React.JSX.Element {
  return (
    <div className="space-y-2 pt-1 border-t border-border">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {translate('workflows.nodeEditor.retry', 'Retry')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">
            {translate('workflows.nodeEditor.retryCount', 'Max retries')}
          </span>
          <Input
            type="number"
            value={retryCount}
            onChange={(e) => onChange({ retryCount: e.target.value })}
            className="h-6"
            min={0}
            max={10}
          />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">
            {translate('workflows.nodeEditor.retryDelay', 'Delay (s)')}
          </span>
          <Input
            type="number"
            value={retryDelaySeconds}
            onChange={(e) => onChange({ retryDelaySeconds: e.target.value })}
            className="h-6"
            min={0}
          />
        </div>
      </div>
    </div>
  )
}
