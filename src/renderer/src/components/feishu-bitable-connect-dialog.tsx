import { useId, useLayoutEffect, useState } from 'react'
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
  const mountedRef = useMountedRef()
  const labelId = useId()
  const appIdId = useId()
  const appSecretId = useId()
  const appTokenId = useId()
  const tableIdId = useId()
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
    ? 'Your app secret is sent to the selected remote runtime and stored there with runtime-supported encryption.'
    : 'Your app secret is stored locally and encrypted when local runtime storage supports it.'

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
        appToken: trimmedAppToken,
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
              'Use an enterprise self-built app (App ID + secret) with a Bitable app token and table ID to browse records.'
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
                placeholder="cli_a1b2c3d4e5f6"
                value={appId}
                onChange={(event) => {
                  setAppId(event.target.value)
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
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
                aria-invalid={connectState === 'error'}
                aria-describedby={connectState === 'error' ? errorId : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={appTokenId}>
                {translate('auto.components.feishuBitable.connect.appToken', 'Bitable app token')}
              </Label>
              <Input
                id={appTokenId}
                placeholder={translate(
                  'auto.components.feishuBitable.connect.appTokenPlaceholder',
                  'From the base URL after /base/'
                )}
                value={appToken}
                onChange={(event) => {
                  setAppToken(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={tableIdId}>
                {translate('auto.components.feishuBitable.connect.tableId', 'Table ID')}
              </Label>
              <Input
                id={tableIdId}
                placeholder="tblXXXXXXXXXXXX"
                value={tableId}
                onChange={(event) => {
                  setTableId(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            {connectState === 'error' && connectError ? (
              <p id={errorId} className="text-xs text-destructive">
                {connectError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.feishuBitable.connect.grantHint',
                'The app needs Bitable read scopes and the base must be shared with the app or its tenant.'
              )}
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
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
