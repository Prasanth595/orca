import { useState } from 'react'
import { TriangleAlert, Unlink } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { PlaneConnectDialog } from '@/components/plane/PlaneConnectDialog'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { isPlaneRuntimeUpdateRequiredError } from '@/runtime/runtime-plane-client'
import { useAppStore } from '@/store'
import type { PlaneConnection, PlaneProjectScope } from '../../../../shared/plane-types'
import type { SecretAtRestProtection } from '../../../../shared/secret-at-rest-protection'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { getProviderAccountScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { PLANE_INTEGRATION_SECTION_ID } from './task-provider-integration-section-ids'
import { UnsealedCredentialNotice } from './UnsealedCredentialNotice'

type DialogMode = 'connect' | 'editScope'
type CardState = 'checking' | 'disconnected' | 'needsScope' | 'connected'

function serverHost(connection: PlaneConnection): string {
  try {
    return new URL(connection.webBaseUrl).host
  } catch {
    return connection.webBaseUrl
  }
}

function scopeLabel(scope: PlaneProjectScope | null): string {
  if (!scope) {
    return translate('plane.card.scopeNone', 'No projects chosen')
  }
  if (scope.mode === 'all') {
    return translate('plane.card.scopeAll', 'All projects')
  }
  return scope.projectIds.length === 1
    ? translate('plane.card.scopeOne', '1 project')
    : translate('plane.card.scopeMany', '{{count}} projects', { count: scope.projectIds.length })
}

function cardDescription(state: CardState, connection: PlaneConnection | null): string {
  if (connection) {
    return translate('plane.card.connectedDescription', '{{slug}} on {{server}}', {
      slug: connection.workspaceSlug,
      server: serverHost(connection)
    })
  }
  return state === 'checking'
    ? translate('plane.card.checking', 'Checking Plane access before showing setup actions.')
    : translate(
        'plane.card.purpose',
        'Browse, start work from and update Plane work items, on Plane Cloud or your own server.'
      )
}

function cardStatusLabel(state: CardState): string {
  switch (state) {
    case 'needsScope':
      return translate('plane.card.statusNeedsScope', 'Choose projects')
    case 'connected':
      return translate('plane.card.statusConnected', 'Connected')
    case 'checking':
    case 'disconnected':
      return translate('plane.card.statusNotConnected', 'Not connected')
  }
}

function PlaneIssueAlert({ issue }: { issue: PlaneErrorKind | null }): React.JSX.Element | null {
  const hostLabel = usePlaneHostLabel()
  return issue ? (
    <p role="alert" className="text-xs text-destructive">
      {getPlaneErrorCopy(issue, hostLabel)}
    </p>
  ) : null
}

function PlaneConnectionBadges({
  connection,
  credentialProtection
}: {
  connection: PlaneConnection
  credentialProtection: SecretAtRestProtection | null
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        {connection.hostKind === 'cloud'
          ? translate('plane.card.hostCloud', 'Plane Cloud')
          : translate('plane.card.hostSelfHosted', 'Self-hosted')}
      </Badge>
      <Badge variant="outline">{serverHost(connection)}</Badge>
      <Badge variant="outline">{scopeLabel(connection.projectScope)}</Badge>
      {connection.insecureHttpAcknowledged ? (
        <Badge variant="outline">
          <TriangleAlert />
          {translate('plane.card.insecureHttp', 'Unencrypted HTTP')}
        </Badge>
      ) : null}
      {credentialProtection === 'plaintext' ? (
        <Badge variant="outline">
          <TriangleAlert />
          {translate('plane.card.plaintextToken', 'Token stored unencrypted')}
        </Badge>
      ) : null}
    </div>
  )
}

function PlaneConnectionRow({
  connection,
  credentialProtection,
  onEditScope
}: {
  connection: PlaneConnection
  credentialProtection: SecretAtRestProtection | null
  onEditScope: () => void
}): React.JSX.Element {
  const disconnectPlane = useAppStore((s) => s.disconnectPlane)
  const mountedRef = useMountedRef()
  const rowClass = useIntegrationSubordinateRowClass('space-y-2')
  const [disconnectFailed, setDisconnectFailed] = useState<PlaneErrorKind | null>(null)

  const handleDisconnect = async (): Promise<void> => {
    setDisconnectFailed(null)
    try {
      await disconnectPlane()
    } catch (error) {
      if (mountedRef.current) {
        setDisconnectFailed(
          isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
        )
      }
    }
  }

  return (
    <div className={rowClass}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{connection.workspaceSlug}</p>
          <p className="truncate text-xs text-muted-foreground">
            {connection.viewer.displayName}
            {connection.viewer.email ? ` · ${connection.viewer.email}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onEditScope}>
          {connection.projectScope
            ? translate('plane.card.editProjects', 'Edit projects')
            : translate('plane.card.chooseProjects', 'Choose projects')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleDisconnect()}
          aria-label={translate('plane.card.disconnect', 'Disconnect {{value0}}', {
            value0: connection.workspaceSlug
          })}
        >
          <Unlink />
        </Button>
      </div>
      <PlaneConnectionBadges connection={connection} credentialProtection={credentialProtection} />
      <PlaneIssueAlert issue={disconnectFailed} />
    </div>
  )
}

function PlaneSetupNotice(): React.JSX.Element {
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const hostLabel = usePlaneHostLabel()
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {translate(
          'plane.card.setupCopy',
          'Connect Plane Cloud or a self-hosted Plane server with a personal access token. The token is stored by {{host}}.',
          { host: hostLabel }
        )}
      </p>
      <Button variant="ghost" size="sm" onClick={() => void checkPlaneConnection()}>
        {translate('plane.card.recheck', 'Re-check')}
      </Button>
    </>
  )
}

function getCardState(
  contextMatches: boolean,
  checked: boolean,
  connection: PlaneConnection | null
): CardState {
  if (!contextMatches || !checked) {
    return 'checking'
  }
  if (!connection) {
    return 'disconnected'
  }
  return connection.projectScope ? 'connected' : 'needsScope'
}

export function PlaneIntegrationCard(): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const planeStatusIssue = useAppStore((s) => s.planeStatusIssue)
  const settings = useAppStore((s) => s.settings)
  const accountScopeRowClass = useIntegrationSubordinateRowClass('text-xs')
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null)

  const contextMatches = planeStatusContextKey === getProviderRuntimeContextKey(settings)
  const connection = contextMatches && planeStatus.connected ? planeStatus.connection : null
  const credentialProtection = planeStatus.connected ? planeStatus.credentialProtection : null
  const state = getCardState(contextMatches, planeStatusChecked, connection)
  const issue: PlaneErrorKind | null =
    planeStatusIssue ?? (planeStatus.credentialError ? 'credential_unreadable' : null)

  return (
    <IntegrationCardShell
      settingsSectionId={PLANE_INTEGRATION_SECTION_ID}
      icon={<PlaneIcon className="size-5" />}
      name="Plane"
      description={cardDescription(state, connection)}
      checking={state === 'checking'}
      statusTone={state === 'connected' ? 'connected' : 'attention'}
      statusLabel={cardStatusLabel(state)}
      actions={
        state === 'disconnected' ? (
          <Button size="sm" onClick={() => setDialogMode('connect')}>
            {translate('plane.card.connect', 'Connect Plane')}
          </Button>
        ) : null
      }
    >
      <IntegrationCardDetails>
        <UnsealedCredentialNotice
          protection={credentialProtection}
          credentialName={translate('plane.card.tokenName', 'Your Plane token')}
        />
        <ProviderHostScopeControl
          labelPrefix={translate('plane.card.accountScopePrefix', 'Account scope')}
          scope={getProviderAccountScope(settings)}
          className={accountScopeRowClass}
        />
        <PlaneIssueAlert issue={state === 'checking' ? null : issue} />
        {connection ? (
          <PlaneConnectionRow
            connection={connection}
            credentialProtection={credentialProtection}
            onEditScope={() => setDialogMode('editScope')}
          />
        ) : null}
        {state === 'disconnected' ? <PlaneSetupNotice /> : null}
      </IntegrationCardDetails>

      <PlaneConnectDialog
        open={dialogMode !== null}
        mode={dialogMode ?? 'connect'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMode(null)
          }
        }}
      />
    </IntegrationCardShell>
  )
}
