import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
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
import {
  feishuBitableDiscoverTables,
  type RuntimeFeishuBitableSettings
} from '@/runtime/runtime-feishu-bitable-client'
import {
  parseFeishuBitableBase,
  type FeishuBitableTable
} from '../../../shared/feishu-bitable-table-discovery'

type Props = {
  open: boolean
  settings: RuntimeFeishuBitableSettings
  appId: string
  appSecret: string
  appToken: string
  onAppTokenChange: (value: string) => void
  tableId: string
  onTableIdChange: (value: string) => void
  disabled: boolean
}

export function FeishuBitableTablePicker(props: Props): React.JSX.Element {
  const baseId = useId()
  const tableId = useId()
  const selectId = useId()
  const generation = useRef(0)
  const [tables, setTables] = useState<FeishuBitableTable[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const { appId, appSecret, appToken, settings, open } = props
  useLayoutEffect(() => {
    generation.current += 1
    setTables([])
    setError(null)
    setLoading(false)
    setLoaded(false)
    return () => {
      generation.current += 1
    }
  }, [appId, appSecret, appToken, settings, open])

  async function loadTables(): Promise<void> {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const result = await feishuBitableDiscoverTables(settings, { appId, appSecret, appToken })
      if (request !== generation.current) {
        return
      }
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTables(result.tables)
      setLoaded(true)
      if (result.tables.length === 1) {
        props.onTableIdChange(result.tables[0].tableId)
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load data tables.')
      }
    } finally {
      if (request === generation.current) {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={baseId}>
          {translate('auto.components.feishuBitable.connect.baseLink', 'Bitable link or app token')}
        </Label>
        <Input
          id={baseId}
          value={appToken}
          placeholder={translate('feishu.connect.baseHint', 'Paste a Feishu Bitable link')}
          disabled={props.disabled}
          onChange={(event) => {
            props.onAppTokenChange(event.target.value)
            let linkedTable = ''
            try {
              linkedTable = parseFeishuBitableBase(event.target.value).tableId ?? ''
            } catch {
              /* Incomplete link while typing. */
            }
            props.onTableIdChange(linkedTable)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            props.disabled || loading || !appId.trim() || !appSecret.trim() || !appToken.trim()
          }
          onClick={() => void loadTables()}
        >
          {loading
            ? translate('auto.components.feishuBitable.connect.loadingTables', 'Loading tables…')
            : translate('auto.components.feishuBitable.connect.loadTables', 'Load data tables')}
        </Button>
      </div>
      {tables.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor={selectId}>
            {translate('auto.components.feishuBitable.connect.dataTable', 'Data table')}
          </Label>
          <Select
            value={tables.some((table) => table.tableId === props.tableId) ? props.tableId : ''}
            onValueChange={props.onTableIdChange}
            disabled={props.disabled || loading}
          >
            <SelectTrigger id={selectId}>
              <SelectValue
                placeholder={translate(
                  'auto.components.feishuBitable.connect.chooseTable',
                  'Choose a data table'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {tables.map((table) => (
                <SelectItem key={table.tableId} value={table.tableId}>
                  {table.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {formatFeishuBitableError(error)}
        </p>
      ) : null}
      {loaded && tables.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground">
          {translate(
            'auto.components.feishuBitable.connect.noTables',
            'No data tables found. Check the app’s access to this base.'
          )}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={tableId}>
          {translate(
            'auto.components.feishuBitable.connect.manualTableId',
            'Table ID (or enter manually)'
          )}
        </Label>
        <Input
          id={tableId}
          value={props.tableId}
          placeholder={translate('feishu.connect.tableIdHint', 'Table ID starting with tbl')}
          disabled={props.disabled || loading}
          onChange={(event) => props.onTableIdChange(event.target.value)}
        />
      </div>
    </>
  )
}
