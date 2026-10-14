import { translate } from '@/i18n/i18n'
import type { FormInputField } from '../../../../shared/workflow-types'

type Props = {
  fields: FormInputField[]
  onChange: (fields: FormInputField[]) => void
}

const inputCls =
  'w-full h-7 rounded border border-input bg-background px-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
const textareaCls =
  'w-full rounded border border-input bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none'

export default function WorkflowFormFillEditor({ fields, onChange }: Props): React.JSX.Element {
  function updateValue(index: number, value: string): void {
    onChange(fields.map((f, i) => (i === index ? { ...f, value } : f)))
  }

  if (fields.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground italic">
        {translate(
          'workflows.nodeEditor.formNoFields',
          'No fields yet. Click the pencil icon to add fields.'
        )}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {fields.map((field, i) => (
        <div key={field.id} className="space-y-1">
          <span className="text-[11px] font-medium text-foreground capitalize">{field.label}</span>
          {field.type === 'multi_choice' ? (
            <select
              value={field.value}
              onChange={(e) => updateValue(i, e.target.value)}
              className={inputCls}
            >
              <option value="">—</option>
              {(field.options ?? '')
                .split('\n')
                .filter(Boolean)
                .map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
            </select>
          ) : field.type === 'json' ? (
            <textarea
              value={field.value}
              onChange={(e) => updateValue(i, e.target.value)}
              rows={3}
              placeholder='{"key": "value"}'
              className={`${textareaCls} font-mono`}
            />
          ) : field.type === 'number' ? (
            <input
              type="number"
              value={field.value}
              onChange={(e) => updateValue(i, e.target.value)}
              className={inputCls}
            />
          ) : (
            <input
              type="text"
              value={field.value}
              onChange={(e) => updateValue(i, e.target.value)}
              placeholder={field.label}
              className={inputCls}
            />
          )}
        </div>
      ))}
    </div>
  )
}
