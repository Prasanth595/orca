import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { BRANCH_OPERATORS, operatorNeedsValue } from './workflow-node-editor-config'
import type { BranchCondition, BranchConditionOperator } from '../../../../shared/workflow-types'

// Module-level counter for stable keys — never called during render
let _condKeySeq = 0
type KeyedCondition = BranchCondition & { readonly _k: string }

type Props = {
  initialConditions: BranchCondition[]
  initialDefaultLabel: string
  onChange: (conditions: BranchCondition[], defaultLabel: string) => void
}

export default function WorkflowBranchConditionEditor({
  initialConditions,
  initialDefaultLabel,
  onChange
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
    const next = [...keyedConditions, newCond]
    update(next, defaultLabel)
  }

  function updateCondition(index: number, patch: Partial<BranchCondition>): void {
    const next = keyedConditions.map((c, i) => (i === index ? { ...c, ...patch } : c))
    update(next, defaultLabel)
  }

  function removeCondition(index: number): void {
    const next = keyedConditions.filter((_, i) => i !== index)
    update(next, defaultLabel)
  }

  function handleDefaultLabelChange(label: string): void {
    update(keyedConditions, label)
  }

  return (
    <div className="space-y-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {translate('workflows.nodeEditor.conditions', 'Conditions')}
      </span>
      {keyedConditions.map((cond, i) => (
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
            className="w-full h-6 rounded border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              {translate('workflows.nodeEditor.conditionField', 'Field')}
            </span>
            <input
              type="text"
              value={cond.field}
              onChange={(e) => updateCondition(i, { field: e.target.value })}
              placeholder="exitCode | output | json.field"
              className="w-full h-6 rounded border border-input bg-background px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
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
              className="w-full h-6 rounded border border-input bg-background px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="w-full h-6 rounded border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>
      ))}
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
