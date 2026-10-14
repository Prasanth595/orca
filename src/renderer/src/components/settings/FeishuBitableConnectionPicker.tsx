import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'
import { useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

export function FeishuBitableConnectionPicker(): React.JSX.Element {
  const status = useAppStore((s) => s.feishuBitableStatus)
  const select = useAppStore((s) => s.selectFeishuBitableConnection)
  const disconnect = useAppStore((s) => s.disconnectFeishuBitable)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update connection.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 border-b border-border py-3">
      <Label htmlFor="feishu-table-connection">
        {translate('auto.components.settings.feishu.connection', 'Active table')}
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={status.activeConnectionId ?? undefined}
          disabled={busy}
          onValueChange={(id) => void run(() => select(id))}
        >
          <SelectTrigger id="feishu-table-connection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {status.connections.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !status.activeConnectionId}
          onClick={() => void run(() => disconnect(status.activeConnectionId))}
        >
          {translate('auto.components.settings.feishu.disconnect', 'Disconnect')}
        </Button>
      </div>
      {status.credentialProtection === 'plaintext' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.feishu.plaintext',
            'This host stores the app secret without encryption.'
          )}
        </p>
      ) : null}
      {status.credentialError || error ? (
        <p role="alert" className="text-xs text-destructive">
          {formatFeishuBitableError(error ?? status.credentialError)}
        </p>
      ) : null}
    </div>
  )
}
