import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { FormInputField, FormFieldType } from '../../../../shared/workflow-types'

let _fieldKeySeq = 0
type KeyedField = FormInputField & { readonly _k: string }

type Props = {
  initialFields: FormInputField[]
  onChange: (fields: FormInputField[]) => void
}

function fieldTypes(): { value: FormFieldType; label: string }[] {
  return [
    { value: 'string', label: translate('workflows.nodeEditor.formFieldTypeString', 'String') },
    { value: 'number', label: translate('workflows.nodeEditor.formFieldTypeNumber', 'Number') },
    {
      value: 'multi_choice',
      label: translate('workflows.nodeEditor.formFieldTypeMultiChoice', 'Multi-choice')
    },
    { value: 'json', label: translate('workflows.nodeEditor.formFieldTypeJson', 'JSON') }
  ]
}

const inputCls =
  'w-full h-6 rounded border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

const textareaCls =
  'w-full rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none'

export default function WorkflowFormInputEditor({
  initialFields,
  onChange
}: Props): React.JSX.Element {
  const [fields, setFields] = useState<KeyedField[]>(() =>
    initialFields.map((f, idx) => ({ ...f, _k: `init_${idx}` }))
  )

  function update(next: KeyedField[]): void {
    setFields(next)
    onChange(next.map(({ _k: _dropped, ...f }) => f))
  }

  function addField(): void {
    const key = `new_${++_fieldKeySeq}`
    update([
      ...fields,
      { id: key, label: `field${fields.length + 1}`, type: 'string', value: '', _k: key }
    ])
  }

  function updateField(index: number, patch: Partial<FormInputField>): void {
    update(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  function removeField(index: number): void {
    update(fields.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {translate('workflows.nodeEditor.formFields', 'Fields')}
      </span>
      {fields.map((field, i) => {
        const opts = (field.options ?? '').split('\n').filter(Boolean)
        return (
          <div key={field._k} className="rounded border border-border p-2 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {translate('workflows.nodeEditor.formFieldLabel', 'Field name')}
              </span>
              <button
                type="button"
                onClick={() => removeField(i)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <input
              type="text"
              value={field.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="fieldName"
              className={inputCls}
            />
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">
                {translate('workflows.nodeEditor.formFieldType', 'Type')}
              </span>
              <select
                value={field.type}
                onChange={(e) => {
                  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: select options constrained to FormFieldType values
                  updateField(i, { type: e.target.value as FormFieldType, value: '' })
                }}
                className={inputCls}
              >
                {fieldTypes().map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {field.type === 'multi_choice' && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  {translate('workflows.nodeEditor.formFieldOptions', 'Options (one per line)')}
                </span>
                <textarea
                  value={field.options ?? ''}
                  onChange={(e) => updateField(i, { options: e.target.value, value: '' })}
                  rows={3}
                  className={textareaCls}
                />
              </div>
            )}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">
                {translate('workflows.nodeEditor.formFieldValue', 'Value')}
              </span>
              {field.type === 'multi_choice' ? (
                <select
                  value={field.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  className={inputCls}
                >
                  <option value="">—</option>
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.type === 'json' ? (
                <textarea
                  value={field.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  rows={3}
                  placeholder='{"key": "value"}'
                  className={`${textareaCls} font-mono`}
                />
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  value={field.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  className={inputCls}
                />
              ) : (
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  className={inputCls}
                />
              )}
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={addField}
        className="w-full h-7 rounded-md border border-input bg-background text-[11px] text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
      >
        <Plus className="size-3" />
        {translate('workflows.nodeEditor.addField', 'Add field')}
      </button>
    </div>
  )
}
