import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  PlaneConnectDialog,
  type PlaneConnectDialogMode
} from '@/components/plane/PlaneConnectDialog'
import {
  PlaneHostScopeProvider,
  useResolvedPlaneHostScope
} from '@/components/plane/plane-host-scope'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { PLANE_ALL_WORKSPACES } from '@/store/slices/plane-slice-contract'
import type { PlaneConnectionStatus } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { PlaneCredentialError, PlaneEmptyCard, PlaneNeedsScope } from './PlaneEmptyStates'
import { PlaneTasksView, type PlaneWorkItemActionSlots } from './PlaneTasksView'
import { PlaneWorkspaceSwitcher } from './PlaneWorkspaceSwitcher'
import { partitionPlaneWorkspaces, resolvePlaneTasksWorkspace } from './plane-workspace-selection'

export type { PlaneWorkItemActionSlots } from './PlaneTasksView'

type DialogState = { mode: PlaneConnectDialogMode; connectionId?: string }
type ConnectedStatus = Extract<PlaneConnectionStatus, { connected: true }>

function PlaneWorkspaceBody({
  status,
  workspaceId,
  openDialog,
  slots
}: {
  status: ConnectedStatus
  workspaceId: string
  openDialog: (dialog: DialogState) => void
  slots: PlaneWorkItemActionSlots
}): React.JSX.Element {
  const editProjects = (connectionId: string): void =>
    openDialog({ mode: 'editScope', connectionId })
  const reconnect = (connectionId: string): void => openDialog({ mode: 'connect', connectionId })

  if (workspaceId === PLANE_ALL_WORKSPACES) {
    const { listable, blocked } = partitionPlaneWorkspaces(status.connections)
    return (
      <PlaneTasksView
        key={PLANE_ALL_WORKSPACES}
        merged
        workspaces={listable}
        blocked={blocked}
        filtersKey={PLANE_ALL_WORKSPACES}
        onEditProjects={editProjects}
        onReconnect={reconnect}
        {...slots}
      />
    )
  }
  const entry = status.connections.find((candidate) => candidate.connection.id === workspaceId)
  const connection = entry?.connection ?? status.connection
  // Why the fallback: the top-level error belongs to the active connection only.
  const credentialError =
    entry?.credentialError ??
    (connection.id === status.connection.id ? status.credentialError : undefined)
  if (credentialError) {
    return (
      <PlaneCredentialError
        kind="credential_unreadable"
        onReconnect={() => reconnect(connection.id)}
      />
    )
  }
  if (connection.projectScope === null) {
    return <PlaneNeedsScope onChooseProjects={() => editProjects(connection.id)} />
  }
  // Why keyed: pages, selection and detail belong to one workspace and must not leak into the next.
  return (
    <PlaneTasksView
      key={connection.id}
      merged={false}
      workspaces={[connection]}
      filtersKey={connection.id}
      onEditProjects={editProjects}
      onReconnect={reconnect}
      {...slots}
    />
  )
}

/** `host` is the Plane task source's host, resolved once by the Tasks page for every child. */
export function TaskPagePlaneContent({
  host,
  onHide,
  renderRowActions,
  renderDetailActions
}: PlaneWorkItemActionSlots & {
  host: RuntimeClientTarget
  onHide: () => void
}): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const savedWorkspaceId = useAppStore((s) => s.planeTasksWorkspaceId)
  const setWorkspaceId = useAppStore((s) => s.setPlaneTasksWorkspaceId)
  const hostScope = useResolvedPlaneHostScope(host)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const { target, contextKey } = hostScope
  const ready = planeStatusChecked && planeStatusContextKey === contextKey
  const status = ready && planeStatus.connected ? planeStatus : null

  useEffect(() => {
    if (!ready) {
      void checkPlaneConnection(target)
    }
  }, [checkPlaneConnection, contextKey, ready, target])

  let body: React.JSX.Element
  if (!ready) {
    body = (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  } else if (!status) {
    body = (
      <PlaneEmptyCard
        title={translate('plane.tasks.connectTitle', 'Connect Plane')}
        body={translate(
          'plane.tasks.connectBody',
          'Browse work items from Plane Cloud or your self-hosted Plane server and start workspaces from them.'
        )}
      >
        <Button onClick={() => setDialog({ mode: 'connect' })}>
          {translate('plane.tasks.connect', 'Connect Plane')}
        </Button>
        <Button variant="outline" onClick={onHide}>
          {translate('plane.tasks.hide', 'Hide Plane')}
        </Button>
      </PlaneEmptyCard>
    )
  } else {
    const workspaceId = resolvePlaneTasksWorkspace(
      savedWorkspaceId,
      status.connections,
      status.connection.id
    )
    body = (
      <div className="flex min-h-0 max-h-full flex-col">
        <PlaneWorkspaceSwitcher
          entries={status.connections}
          value={workspaceId}
          onChange={setWorkspaceId}
        />
        <PlaneWorkspaceBody
          status={status}
          workspaceId={workspaceId}
          openDialog={setDialog}
          slots={{ renderRowActions, renderDetailActions }}
        />
      </div>
    )
  }

  return (
    <PlaneHostScopeProvider value={hostScope}>
      {body}
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
    </PlaneHostScopeProvider>
  )
}
