import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { BRANCH_OPERATORS, operatorNeedsValue } from './workflow-node-editor-config'
import type { BranchCondition, BranchConditionOperator } from '../../../../shared/workflow-types'

// Module-level counter for stable keys — never called during render
let _condKeySeq = 0
type KeyedCondition = BranchCondition & { readonly _k: string }

type ParentNodeLastRun = { output: string; json: unknown; exitCode: number | null }

type FieldMode = 'exitCode' | 'output' | 'json' | 'custom'

type Props = {
  initialConditions: BranchCondition[]
  initialDefaultLabel: string
  onChange: (conditions: BranchCondition[], defaultLabel: string) => void
  parentNodeLastRun?: ParentNodeLastRun
}

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => {
    if (v == null || typeof v !== 'object') {
      return undefined
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: traversing unknown JSON at runtime
    return (v as Record<string, unknown>)[k]
  }, obj)
}

function resolveFieldHint(field: string, data: ParentNodeLastRun): string | undefined {
  if (!field) {
    return undefined
  }
  let subject: unknown
  if (field === 'exitCode') {
    subject = data.exitCode
  } else if (field === 'output') {
    subject = data.output
  } else if (field.startsWith('json.')) {
    subject = resolvePath(data.json, field.slice(5))
  } else {
    subject = resolvePath(data.json, field)
  }
  if (subject === undefined || subject === null) {
    return undefined
  }
  const raw = typeof subject === 'string' ? subject : JSON.stringify(subject)
  const flat = raw.replace(/\n/g, '↵').replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

function fieldMode(field: string): FieldMode {
  if (field === 'exitCode') {
    return 'exitCode'
  }
  if (field === 'output') {
    return 'output'
  }
  if (field.startsWith('json.') || field === 'json') {
    return 'json'
  }
  return 'custom'
}

export default function WorkflowBranchConditionEditor({
  initialConditions,
  initialDefaultLabel,
  onChange,
  parentNodeLastRun
}: Props): React.JSX.Element {
  const [keyedConditions, setKeyedConditions] = useState<KeyedCondition[]>(() =>
    initialConditions.map((c, idx) => ({ ...c, _k: `init_${idx}` }))
  )
  const [defaultLabel, setDefaultLabel] = useState(initialDefaultLabel)

  function update(conds: KeyedCondition[], label: string): void {
    setKeyedConditions(conds)
    setDefaultLabel(label)
    onChange(
      conds.map(({ _k: _dropped, ...c }) => c),
      label
    )
  }

  function addCondition(): void {
    const key = `new_${++_condKeySeq}`
    const op: BranchConditionOperator = 'exitCode0'
    const newCond: KeyedCondition = {
      label: `path${keyedConditions.length + 1}`,
      field: 'exitCode',
      operator: op,
      value: '',
      _k: key
    }
    update([...keyedConditions, newCond], defaultLabel)
  }

  function updateCondition(index: number, patch: Partial<BranchCondition>): void {
    update(
      keyedConditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      defaultLabel
    )
  }

  function removeCondition(index: number): void {
    update(
      keyedConditions.filter((_, i) => i !== index),
      defaultLabel
    )
  }

  function handleDefaultLabelChange(label: string): void {
    update(keyedConditions, label)
  }

  const inputCls =
    'w-full h-6 rounded border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="space-y-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {translate('workflows.nodeEditor.conditions', 'Conditions')}
      </span>
      {keyedConditions.map((cond, i) => {
        const mode = fieldMode(cond.field)
        const jsonPath = cond.field.startsWith('json.') ? cond.field.slice(5) : ''
        const hint =
          parentNodeLastRun && cond.field
            ? resolveFieldHint(cond.field, parentNodeLastRun)
            : undefined

        return (
          <div key={cond._k} className="rounded border border-border p-2 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {translate('workflows.nodeEditor.conditionLabel', 'Label')}
              </span>
              <button
                type="button"
                onClick={() => removeCondition(i)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <input
              type="text"
              value={cond.label}
              onChange={(e) => updateCondition(i, { label: e.target.value })}
              placeholder="success"
              className={inputCls}
            />
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">
                {translate('workflows.nodeEditor.conditionField', 'Field')}
              </span>
              {/* Field mode select */}
              <select
                value={mode}
                onChange={(e) => {
                  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: select options are constrained to FieldMode values defined above
                  const next = e.target.value as FieldMode
                  if (next === 'exitCode') {
                    updateCondition(i, { field: 'exitCode' })
                  } else if (next === 'output') {
                    updateCondition(i, { field: 'output' })
                  } else if (next === 'json') {
                    updateCondition(i, { field: 'json.' })
                  } else {
                    updateCondition(i, { field: '' })
                  }
                }}
                className={inputCls}
              >
                <option value="exitCode">
                  {translate('workflows.nodeEditor.conditionFieldExitCode', 'exitCode')}
                </option>
                <option value="output">
                  {translate('workflows.nodeEditor.conditionFieldOutput', 'output')}
                </option>
                <option value="json">
                  {translate('workflows.nodeEditor.conditionFieldJson', 'json.field')}
                </option>
                <option value="custom">
                  {translate('workflows.nodeEditor.conditionFieldCustom', 'custom…')}
                </option>
              </select>
              {/* JSON path sub-input */}
              {mode === 'json' && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    json.
                  </span>
                  <input
                    type="text"
                    value={jsonPath}
                    onChange={(e) => updateCondition(i, { field: `json.${e.target.value}` })}
                    placeholder="field"
                    className={`${inputCls} flex-1`}
                  />
                </div>
              )}
              {/* Custom free-text input */}
              {mode === 'custom' && (
                <input
                  type="text"
                  value={cond.field}
                  onChange={(e) => updateCondition(i, { field: e.target.value })}
                  placeholder="field.path"
                  className={`${inputCls} font-mono`}
                />
              )}
              {/* Resolved value hint from last run */}
              {hint !== undefined && (
                <span className="font-mono text-[10px] text-muted-foreground truncate block">
                  {`→ ${hint}`}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">
                {translate('workflows.nodeEditor.conditionOperator', 'Operator')}
              </span>
              <select
                value={cond.operator}
                onChange={(e) => {
                  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: select options are constrained to BranchConditionOperator values
                  updateCondition(i, { operator: e.target.value as BranchConditionOperator })
                }}
                className={inputCls}
              >
                {BRANCH_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
            {operatorNeedsValue(cond.operator) && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  {translate('workflows.nodeEditor.conditionValue', 'Value')}
                </span>
                <input
                  type="text"
                  value={cond.value}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={addCondition}
        className="w-full h-7 rounded-md border border-input bg-background text-[11px] text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
      >
        <Plus className="size-3" />
        {translate('workflows.nodeEditor.addCondition', 'Add condition')}
      </button>
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate('workflows.nodeEditor.defaultLabel', 'Default label (no match)')}
        </span>
        <Input
          value={defaultLabel}
          onChange={(e) => handleDefaultLabelChange(e.target.value)}
          placeholder="otherwise"
          className="h-7"
        />
      </div>
    </div>
  )
}
