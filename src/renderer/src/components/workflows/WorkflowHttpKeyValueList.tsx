import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { HttpKeyValue } from '../../../../shared/workflow-http-request-types'
import { HttpSelectField, type ExprHint } from './WorkflowHttpFieldControls'

type Props<Row extends HttpKeyValue> = {
  rows: Row[]
  onChange: (rows: Row[]) => void
  newRow: () => Row
  exprHint: ExprHint
  /** Optional per-row selector, e.g. text/file for multipart or the pagination location. */
  variant?: {
    get: (row: Row) => string
    set: (row: Row, value: string) => Row
    options: { value: string; label: string }[]
  }
  valuePlaceholder?: (row: Row) => string
}

export default function WorkflowHttpKeyValueList<Row extends HttpKeyValue>({
  rows,
  onChange,
  newRow,
  exprHint,
  variant,
  valuePlaceholder
}: Props<Row>): React.JSX.Element {
  // Rows carry no id, so keep a parallel list of stable React keys.
  const keySeq = useRef(0)
  const makeKey = (): string => `row-${keySeq.current++}`
  const [keys, setKeys] = useState<string[]>(() => rows.map(makeKey))
  if (keys.length !== rows.length) {
    // Rows were replaced from outside (e.g. cURL import).
    setKeys(rows.map(makeKey))
  }

  function add(): void {
    setKeys([...keys, makeKey()])
    onChange([...rows, newRow()])
  }

  function remove(index: number): void {
    setKeys(keys.filter((_, j) => j !== index))
    onChange(rows.filter((_, j) => j !== index))
  }

  function replace(index: number, next: Row): void {
    onChange(rows.map((r, i) => (i === index ? next : r)))
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div
          key={keys[i] ?? `pending-${row.name}`}
          className="rounded border border-border p-2 space-y-1.5 bg-muted/20"
        >
          <div className="flex items-center gap-1.5">
            <Input
              value={row.name}
              onChange={(e) => replace(i, { ...row, name: e.target.value })}
              placeholder={translate('workflows.http.name', 'Name')}
              className="h-7"
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              onClick={() => remove(i)}
              title={translate('workflows.http.remove', 'Remove')}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          {variant && (
            <HttpSelectField
              value={variant.get(row)}
              options={variant.options}
              onChange={(v) => replace(i, variant.set(row, v))}
            />
          )}
          <Input
            value={row.value}
            onChange={(e) => replace(i, { ...row, value: e.target.value })}
            placeholder={valuePlaceholder?.(row) ?? translate('workflows.http.value', 'Value')}
            className="h-7"
          />
          {exprHint(row.value)}
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-full h-7" onClick={add}>
        <Plus className="size-3" />
        {translate('workflows.http.add', 'Add')}
      </Button>
    </div>
  )
}
