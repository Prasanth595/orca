import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'
import { useId, useLayoutEffect, useMemo, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { hasRemoteProviderRuntime } from '@/lib/provider-runtime-context'
import { preventOutsideDismissWhenDirty } from '@/lib/outside-dismiss-guard'
import { translate } from '@/i18n/i18n'
import { defaultScopeSource } from '@/lib/default-creation-host'
import { FeishuBitableTablePicker } from './feishu-bitable-table-picker'
import { parseFeishuBitableBase } from '../../../shared/feishu-bitable-table-discovery'

type FeishuBitableConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

type ConnectState = 'idle' | 'connecting' | 'error'

// Why: mirrors JiraConnectDialog so settings and the Tasks empty state share
// one enterprise-app credential flow without depending on TaskPage state.
export function FeishuBitableConnectDialog({
  open,
  onOpenChange,
  onConnected
}: FeishuBitableConnectDialogProps): React.JSX.Element {
  const connectFeishuBitable = useAppStore((s) => s.connectFeishuBitable)
  const settings = useAppStore((s) => s.settings)
  const discoverySource = useMemo(() => defaultScopeSource(settings), [settings])
  const mountedRef = useMountedRef()
  const labelId = useId()
  const appIdId = useId()
  const appSecretId = useId()
  const errorId = useId()

  const [label, setLabel] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [appToken, setAppToken] = useState('')
  const [tableId, setTableId] = useState('')
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)

  // Start every open with a clean slate so a previously-typed secret or old
  // error can't linger across reopens. Runs before paint so a stale credential
  // never renders for a frame.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    setLabel('')
    setAppId('')
    setAppSecret('')
    setAppToken('')
    setTableId('')
    setConnectState('idle')
    setConnectError(null)
  }, [open])

  const canSubmit =
    Boolean(appId.trim()) &&
    Boolean(appSecret.trim()) &&
    Boolean(appToken.trim()) &&
    Boolean(tableId.trim()) &&
    connectState !== 'connecting'
  const credentialStorageCopy = hasRemoteProviderRuntime(settings)
    ? translate(
        'feishu.connect.remoteSecret',
        'Your app secret is sent to the selected remote runtime and stored there with runtime-supported encryption.'
      )
    : translate(
        'feishu.connect.localSecret',
        'Your app secret is stored locally and encrypted when local runtime storage supports it.'
      )

  const clearErrorOnEdit = (): void => {
    if (connectState === 'error') {
      setConnectState('idle')
      setConnectError(null)
    }
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (connectState !== 'connecting') {
      onOpenChange(nextOpen)
    }
  }

  // Why: a stray backdrop click must not discard typed credentials.
  // Escape / Cancel / × stay explicit.
  const isDraftDirty = (): boolean =>
    appId !== '' || appSecret !== '' || appToken !== '' || tableId !== ''
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(isDraftDirty)

  const handleConnect = async (): Promise<void> => {
    const trimmedAppId = appId.trim()
    const trimmedSecret = appSecret.trim()
    const trimmedAppToken = appToken.trim()
    const trimmedTableId = tableId.trim()
    const trimmedLabel = label.trim()
    if (
      !trimmedAppId ||
      !trimmedSecret ||
      !trimmedAppToken ||
      !trimmedTableId ||
      connectState === 'connecting'
    ) {
      return
    }
    setConnectState('connecting')
    setConnectError(null)
    try {
      const result = await connectFeishuBitable({
        appId: trimmedAppId,
        appSecret: trimmedSecret,
        appToken: parseFeishuBitableBase(trimmedAppToken).appToken,
        tableId: trimmedTableId,
        ...(trimmedLabel ? { label: trimmedLabel } : {})
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        onOpenChange(false)
        onConnected?.()
        return
      }
      setConnectState('error')
      setConnectError(result.error)
    } catch (error) {
      if (mountedRef.current) {
        setConnectState('error')
        setConnectError(error instanceof Error ? error.message : 'Connection failed')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.feishuBitable.connect.title', 'Connect Feishu Bitable')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.feishuBitable.connect.description',
              'Use an enterprise app (App ID + secret), paste your Bitable link, then load and choose a data table.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleConnect()
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor={labelId}>
                {translate('auto.components.feishuBitable.connect.labelField', 'Name (optional)')}
              </Label>
              <Input
                id={labelId}
                placeholder={translate(
                  'auto.components.feishuBitable.connect.labelPlaceholder',
                  'Team task board'
                )}
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={appIdId}>
                {translate('auto.components.feishuBitable.connect.appId', 'App ID')}
              </Label>
              <Input
                id={appIdId}
                autoFocus
                placeholder={translate('feishu.connect.appIdHint', 'App ID starting with cli_')}
                value={appId}
                onChange={(event) => {
                  setAppId(event.target.value)
                  setTableId('')
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={appSecretId}>
                {translate('auto.components.feishuBitable.connect.appSecret', 'App secret')}
              </Label>
              <Input
                id={appSecretId}
                type="password"
                placeholder={translate(
                  'auto.components.feishuBitable.connect.appSecretPlaceholder',
                  'Enterprise app secret'
                )}
                value={appSecret}
                onChange={(event) => {
                  setAppSecret(event.target.value)
                  setTableId('')
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
                aria-invalid={connectState === 'error'}
                aria-describedby={connectState === 'error' ? errorId : undefined}
              />
            </div>
            <FeishuBitableTablePicker
              open={open}
              settings={discoverySource}
              appId={appId}
              appSecret={appSecret}
              appToken={appToken}
              tableId={tableId}
              onAppTokenChange={(value) => {
                setAppToken(value)
                clearErrorOnEdit()
              }}
              onTableIdChange={(value) => {
                setTableId(value)
                clearErrorOnEdit()
              }}
              disabled={connectState === 'connecting'}
            />
            {connectState === 'error' && connectError ? (
              <p id={errorId} className="text-xs text-destructive">
                {formatFeishuBitableError(connectError)}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.feishuBitable.connect.grantHint',
                'The app needs Bitable read scopes and the base must be shared with the app or its tenant.'
              )}
            </p>
            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Lock className="size-3 shrink-0" />
              {credentialStorageCopy}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={connectState === 'connecting'}
            >
              {translate('auto.components.feishuBitable.connect.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {connectState === 'connecting' ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate('auto.components.feishuBitable.connect.verifying', 'Verifying…')}
                </>
              ) : (
                translate('auto.components.feishuBitable.connect.submit', 'Connect')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
