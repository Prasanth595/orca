import { useLayoutEffect, useReducer } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { preventOutsideDismissWhenDirty } from '@/lib/outside-dismiss-guard'
import { hasRemoteProviderRuntime } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import type { PlaneConnection, PlaneConnectionStatus } from '../../../../shared/plane-types'
import {
  INITIAL_PLANE_CONNECT_FORM,
  planeConnectFormReducer,
  type PlaneConnectFormState
} from './plane-connect-form-model'
import { canSubmitPlaneCredentials, getPlaneScopeToSave } from './plane-connect-form-selectors'
import { PlaneConnectCredentialsStep } from './plane-connect-credentials-step'
import { PlaneConnectScopeStep } from './PlaneConnectScopeStep'
import { allPlaneChipsConnected } from './plane-workspace-chips'
import { usePlaneConnectActions } from './use-plane-connect-actions'
import { usePlaneHostLabel } from './use-plane-host-label'

export type PlaneConnectDialogMode = 'connect' | 'addWorkspace' | 'editScope'

type PlaneConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * `addWorkspace` reuses the saved token of `connectionId`; `editScope` opens on the project
   * scope of `connectionId`. Both fall back to the active connection.
   */
  mode?: PlaneConnectDialogMode
  connectionId?: string
  onConnected?: () => void
}

function findConnection(
  status: PlaneConnectionStatus,
  connectionId: string | undefined
): PlaneConnection | null {
  if (!status.connected) {
    return null
  }
  const id = connectionId ?? status.connection.id
  return status.connections.find((entry) => entry.connection.id === id)?.connection ?? null
}

function serverHost(connection: PlaneConnection): string {
  try {
    return new URL(connection.webBaseUrl).host
  } catch {
    return connection.webBaseUrl
  }
}

function dialogCopy(state: PlaneConnectFormState): { title: string; description: string } {
  if (state.step === 'scope') {
    return {
      title: translate('plane.connect.scopeTitle', 'Choose Plane projects'),
      description: translate(
        'plane.connect.scopeDescription',
        'Pick the projects whose work items Orca lists. You can change this later.'
      )
    }
  }
  if (state.reuseFrom) {
    return {
      title: translate('plane.connect.addTitle', 'Add Plane workspaces'),
      description: translate(
        'plane.connect.addDescription',
        'Add more workspaces on {{server}} with the token you already saved.',
        { server: state.reuseFrom.server }
      )
    }
  }
  return {
    title: translate('plane.connect.title', 'Connect Plane'),
    description: translate(
      'plane.connect.description',
      'Use a personal access token to browse Plane work items and start workspaces from them.'
    )
  }
}

export function PlaneConnectDialog({
  open,
  onOpenChange,
  mode = 'connect',
  connectionId,
  onConnected
}: PlaneConnectDialogProps): React.JSX.Element {
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const remoteRuntime = useAppStore((s) => hasRemoteProviderRuntime(s.settings))
  const hostLabel = usePlaneHostLabel()
  const mountedRef = useMountedRef()
  const [state, dispatch] = useReducer(planeConnectFormReducer, INITIAL_PLANE_CONNECT_FORM)
  const { connect, saveScopes } = usePlaneConnectActions({
    state,
    dispatch,
    mountedRef,
    onConnected,
    onDone: () => onOpenChange(false)
  })

  // Why before paint: a token typed into an earlier open must never render again.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const { planeProjectsByConnection, planeStatus } = useAppStore.getState()
    const connection = mode === 'connect' ? null : findConnection(planeStatus, connectionId)
    if (!connection) {
      dispatch({ type: 'reset' })
      return
    }
    if (mode === 'addWorkspace') {
      dispatch({
        type: 'addWorkspace',
        source: {
          connectionId: connection.id,
          slug: connection.workspaceSlug,
          server: serverHost(connection)
        }
      })
      return
    }
    dispatch({
      type: 'editScope',
      workspaces: [
        {
          connectionId: connection.id,
          slug: connection.workspaceSlug,
          projects: planeProjectsByConnection[connection.id] ?? [],
          scope: connection.projectScope
        }
      ]
    })
    void loadPlaneProjects({ refresh: true, connectionId: connection.id }).then((result) => {
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        dispatch({ type: 'projectsLoaded', connectionId: connection.id, projects: result.value })
      } else {
        dispatch({ type: 'submitFailed', error: { kind: result.error.kind } })
      }
    })
  }, [connectionId, loadPlaneProjects, mode, mountedRef, open])

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!state.submitting) {
      onOpenChange(nextOpen)
    }
  }
  const isDirty = (): boolean =>
    state.step === 'credentials' &&
    Boolean(
      state.serverUrl || state.apiBaseUrl || state.slugDraft || state.chips.length || state.apiToken
    )
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(isDirty)

  const onScopeStep = state.step === 'scope'
  const readyToContinue = allPlaneChipsConnected(state.chips) && !state.slugDraft.trim()
  const canSubmit = onScopeStep
    ? !state.submitting &&
      state.workspaces.length > 0 &&
      state.workspaces.every((w) => getPlaneScopeToSave(w.scope) !== null)
    : readyToContinue
      ? !state.submitting
      : canSubmitPlaneCredentials(state)
  const handleSubmit = (): void => {
    if (onScopeStep) {
      void saveScopes()
    } else if (readyToContinue) {
      dispatch({ type: 'goToScope' })
    } else {
      void connect()
    }
  }
  const { title, description } = dialogCopy(state)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Why: Settings stacks above z-100, and the dialog must sit over it.
        overlayClassName="z-[110]"
        className="z-[120] sm:max-w-md"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          {onScopeStep ? (
            <PlaneConnectScopeStep state={state} dispatch={dispatch} hostLabel={hostLabel} />
          ) : (
            <PlaneConnectCredentialsStep
              state={state}
              dispatch={dispatch}
              hostLabel={hostLabel}
              remoteRuntime={remoteRuntime}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={state.submitting}
            >
              {onScopeStep && mode !== 'editScope'
                ? translate('plane.connect.later', 'Choose later')
                : translate('plane.connect.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {state.submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {onScopeStep
                ? translate('plane.connect.saveScope', 'Save projects')
                : state.submitting
                  ? translate('plane.connect.verifying', 'Verifying…')
                  : readyToContinue
                    ? translate('plane.connect.continue', 'Continue')
                    : translate('plane.connect.connect', 'Connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
