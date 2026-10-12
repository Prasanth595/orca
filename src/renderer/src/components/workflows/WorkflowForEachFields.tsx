import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

type Props = {
  localData: Record<string, string>
  onDataChange: (patch: Record<string, string>) => void
  exprHint: (value: string) => React.JSX.Element | null
}

export default function WorkflowForEachFields({
  localData,
  onDataChange,
  exprHint
}: Props): React.JSX.Element {
  return (
    <>
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate('workflows.nodeEditor.itemsExpression', 'Items expression')}
        </span>
        <Input
          value={localData['itemsExpression'] ?? ''}
          onChange={(e) => onDataChange({ itemsExpression: e.target.value })}
          placeholder="{{steps.nodeId.json.items}}"
          className="h-7"
        />
        {exprHint(localData['itemsExpression'] ?? '')}
        <p className="text-[10px] text-muted-foreground">
          {translate(
            'workflows.nodeEditor.itemsExpressionHint',
            'Template expression that resolves to a JSON array. Use {{loop.item}} and {{loop.index}} in body nodes.'
          )}
        </p>
      </div>
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate('workflows.nodeEditor.maxIterations', 'Max iterations')}
        </span>
        <Input
          type="number"
          value={localData['maxIterations'] ?? '100'}
          onChange={(e) => onDataChange({ maxIterations: e.target.value })}
          className="h-7"
          min={1}
          max={10000}
        />
      </div>
    </>
  )
}
