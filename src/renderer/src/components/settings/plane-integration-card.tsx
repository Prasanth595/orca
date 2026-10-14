import { useState } from 'react'
import { TriangleAlert, Unlink } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import {
  PlaneConnectDialog,
  type PlaneConnectDialogMode
} from '@/components/plane/PlaneConnectDialog'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { isPlaneRuntimeUpdateRequiredError } from '@/runtime/runtime-plane-client'
import { useAppStore } from '@/store'
import type {
  PlaneConnection,
  PlaneConnectionEntry,
  PlaneProjectScope
} from '../../../../shared/plane-types'
import type { SecretAtRestProtection } from '../../../../shared/secret-at-rest-protection'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { getProviderAccountScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { PLANE_INTEGRATION_SECTION_ID } from './task-provider-integration-section-ids'
import { UnsealedCredentialNotice } from './UnsealedCredentialNotice'

type DialogRequest = { mode: PlaneConnectDialogMode; connectionId?: string }
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

function connectedSummary(connections: readonly PlaneConnection[]): string {
  return connections.length === 1
    ? translate('plane.card.connectedOne', 'Connected to {{slug}} on {{server}}.', {
        slug: connections[0].workspaceSlug,
        server: serverHost(connections[0])
      })
    : translate('plane.card.connectedCount', '{{count}} workspaces connected.', {
        count: connections.length
      })
}

// Why the same sentence first: the card reads like the other task providers', with the
// connection summary after it.
function cardDescription(state: CardState, connections: readonly PlaneConnection[]): string {
  if (connections.length > 0) {
    const purpose = translate(
      'plane.card.purpose',
      'Browse, start work from and update Plane work items, on Plane Cloud or your own server.'
    )
    return `${purpose} ${connectedSummary(connections)}`
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
  entry,
  onEditScope
}: {
  entry: PlaneConnectionEntry
  onEditScope: () => void
}): React.JSX.Element {
  const { connection, credentialProtection } = entry
  const disconnectPlane = useAppStore((s) => s.disconnectPlane)
  const mountedRef = useMountedRef()
  const rowClass = useIntegrationSubordinateRowClass('space-y-2')
  const [disconnectFailed, setDisconnectFailed] = useState<PlaneErrorKind | null>(null)

  const handleRemove = async (): Promise<void> => {
    setDisconnectFailed(null)
    try {
      await disconnectPlane(connection.id)
    } catch (error) {
      if (mountedRef.current) {
        setDisconnectFailed(
          isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
        )
      }
    }
  }

  return (
    <div className={rowClass} data-plane-connection={connection.id}>
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
          onClick={() => void handleRemove()}
          aria-label={translate('plane.card.remove', 'Remove {{value0}}', {
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
  connections: readonly PlaneConnection[]
): CardState {
  if (!contextMatches || !checked) {
    return 'checking'
  }
  if (connections.length === 0) {
    return 'disconnected'
  }
  return connections.every((c) => c.projectScope) ? 'connected' : 'needsScope'
}

export function PlaneIntegrationCard(): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const planeStatusIssue = useAppStore((s) => s.planeStatusIssue)
  const settings = useAppStore((s) => s.settings)
  const accountScopeRowClass = useIntegrationSubordinateRowClass('text-xs')
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  const contextMatches = planeStatusContextKey === getProviderRuntimeContextKey(settings)
  const entries = contextMatches && planeStatus.connected ? planeStatus.connections : []
  const connections = entries.map((entry) => entry.connection)
  // Why any: sealing is host-wide, so one plaintext token means this host does not seal.
  const credentialProtection = entries.some((e) => e.credentialProtection === 'plaintext')
    ? 'plaintext'
    : (entries[0]?.credentialProtection ?? null)
  const state = getCardState(contextMatches, planeStatusChecked, connections)
  const credentialError = entries.some((e) => e.credentialError) || planeStatus.credentialError
  const issue: PlaneErrorKind | null =
    planeStatusIssue ?? (credentialError ? 'credential_unreadable' : null)

  return (
    <IntegrationCardShell
      settingsSectionId={PLANE_INTEGRATION_SECTION_ID}
      icon={<PlaneIcon className="size-5" />}
      name="Plane"
      description={cardDescription(state, connections)}
      checking={state === 'checking'}
      statusTone={state === 'connected' ? 'connected' : 'attention'}
      statusLabel={cardStatusLabel(state)}
      actions={
        state === 'disconnected' ? (
          <Button size="sm" onClick={() => setDialog({ mode: 'connect' })}>
            {translate('plane.card.connect', 'Connect Plane')}
          </Button>
        ) : state !== 'checking' ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'addWorkspace' })}>
            {translate('plane.card.addWorkspace', 'Add workspace')}
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
        {entries.map((entry) => (
          <PlaneConnectionRow
            key={entry.connection.id}
            entry={entry}
            onEditScope={() => setDialog({ mode: 'editScope', connectionId: entry.connection.id })}
          />
        ))}
        {state === 'disconnected' ? <PlaneSetupNotice /> : null}
      </IntegrationCardDetails>

      <PlaneConnectDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'connect'}
        connectionId={dialog?.connectionId}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
          }
        }}
      />
    </IntegrationCardShell>
  )
}
