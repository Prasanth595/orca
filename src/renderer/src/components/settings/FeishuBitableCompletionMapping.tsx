import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  FeishuBitableField,
  FeishuBitableFieldMapping
} from '../../../../shared/feishu-bitable-types'

export function FeishuBitableCompletionMapping({
  fields,
  draft,
  onChange
}: {
  fields: readonly FeishuBitableField[]
  draft: FeishuBitableFieldMapping
  onChange: (mapping: FeishuBitableFieldMapping) => void
}): React.JSX.Element {
  const field = fields.find((entry) => entry.fieldName === draft.statusField)
  const statusLabel = translate('feishu.mapping.statusField', 'Status field (optional)')
  const valueLabel = translate('feishu.mapping.completedValue', 'Completion value')
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'feishu.mapping.completionHint',
          'Completion is manual. Choose a text or single-select status field; no other columns are changed. Read-only access is sufficient until you mark a record complete.'
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{statusLabel}</Label>
          <Select
            value={field ? `field:${field.fieldName}` : 'none'}
            onValueChange={(value) =>
              onChange({
                ...draft,
                statusField: value === 'none' ? null : value.slice('field:'.length),
                completedValue: null
              })
            }
          >
            <SelectTrigger size="sm" className="w-full" aria-label={statusLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {translate('feishu.mapping.disabled', 'Do not update status')}
              </SelectItem>
              {fields
                .filter((entry) => entry.type === 1 || entry.type === 3)
                .map((entry) => (
                  <SelectItem key={entry.fieldName} value={`field:${entry.fieldName}`}>
                    {entry.fieldName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{valueLabel}</Label>
          {field?.type === 3 ? (
            <Select
              value={
                field.options?.includes(draft.completedValue ?? '')
                  ? (draft.completedValue ?? '')
                  : ''
              }
              onValueChange={(value) => onChange({ ...draft, completedValue: value })}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={valueLabel}>
                <SelectValue
                  placeholder={translate('feishu.mapping.chooseValue', 'Choose an existing option')}
                />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              aria-label={valueLabel}
              disabled={!field}
              value={draft.completedValue ?? ''}
              onChange={(event) =>
                onChange({ ...draft, completedValue: event.target.value || null })
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
