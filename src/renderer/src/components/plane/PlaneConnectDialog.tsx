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
import {
  INITIAL_PLANE_CONNECT_FORM,
  canSubmitPlaneCredentials,
  getPlaneScopeToSave,
  planeConnectFormReducer,
  toPlaneConnectArgs
} from './plane-connect-form-model'
import { PlaneConnectCredentialsStep } from './plane-connect-credentials-step'
import { getPlaneErrorCopy } from './plane-error-copy'
import { PlaneProjectScopePicker } from './PlaneProjectScopePicker'
import { usePlaneHostLabel } from './use-plane-host-label'

type PlaneConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `editScope` skips the credentials and opens on the saved project scope. */
  mode?: 'connect' | 'editScope'
  onConnected?: () => void
}

export function PlaneConnectDialog({
  open,
  onOpenChange,
  mode = 'connect',
  onConnected
}: PlaneConnectDialogProps): React.JSX.Element {
  const connectPlane = useAppStore((s) => s.connectPlane)
  const setPlaneProjectScope = useAppStore((s) => s.setPlaneProjectScope)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const remoteRuntime = useAppStore((s) => hasRemoteProviderRuntime(s.settings))
  const hostLabel = usePlaneHostLabel()
  const mountedRef = useMountedRef()
  const [state, dispatch] = useReducer(planeConnectFormReducer, INITIAL_PLANE_CONNECT_FORM)

  // Why before paint: a token typed into an earlier open must never render again.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    if (mode === 'connect') {
      dispatch({ type: 'reset' })
      return
    }
    const { planeProjects, planeStatus } = useAppStore.getState()
    dispatch({
      type: 'editScope',
      projects: planeProjects,
      scope: planeStatus.connected ? planeStatus.connection.projectScope : null
    })
    void loadPlaneProjects({ refresh: true }).then((result) => {
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        dispatch({ type: 'projectsLoaded', projects: result.value })
      } else {
        dispatch({ type: 'submitFailed', error: { kind: result.error.kind } })
      }
    })
  }, [loadPlaneProjects, mode, mountedRef, open])

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!state.submitting) {
      onOpenChange(nextOpen)
    }
  }
  const isDirty = (): boolean =>
    state.step === 'credentials' &&
    Boolean(state.serverUrl || state.apiBaseUrl || state.workspaceSlug || state.apiToken)
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(isDirty)

  const handleConnect = async (): Promise<void> => {
    const args = toPlaneConnectArgs(state)
    if (!args) {
      return
    }
    dispatch({ type: 'submitStarted' })
    const result = await connectPlane(args)
    if (!mountedRef.current) {
      return
    }
    if (!result.ok) {
      dispatch({
        type: 'submitFailed',
        error: { kind: result.error, ...('field' in result ? { field: result.field } : {}) }
      })
      return
    }
    dispatch({
      type: 'connected',
      projects: result.projects,
      scope: result.status.connected ? result.status.connection.projectScope : null
    })
    onConnected?.()
  }

  const handleSaveScope = async (): Promise<void> => {
    const scope = getPlaneScopeToSave(state.scope)
    if (!scope || state.submitting) {
      return
    }
    dispatch({ type: 'submitStarted' })
    const result = await setPlaneProjectScope(scope)
    if (!mountedRef.current) {
      return
    }
    if (!result.ok) {
      dispatch({ type: 'submitFailed', error: { kind: result.error.kind } })
      return
    }
    onOpenChange(false)
  }

  const onScopeStep = state.step === 'scope'
  const canSubmit = onScopeStep
    ? !state.submitting && getPlaneScopeToSave(state.scope) !== null
    : canSubmitPlaneCredentials(state)

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
          <DialogTitle>
            {onScopeStep
              ? translate('plane.connect.scopeTitle', 'Choose Plane projects')
              : translate('plane.connect.title', 'Connect Plane')}
          </DialogTitle>
          <DialogDescription>
            {onScopeStep
              ? translate(
                  'plane.connect.scopeDescription',
                  'Pick the projects whose work items Orca lists. You can change this later.'
                )
              : translate(
                  'plane.connect.description',
                  'Use a personal access token to browse Plane work items and start workspaces from them.'
                )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void (onScopeStep ? handleSaveScope() : handleConnect())
          }}
        >
          {onScopeStep ? (
            <div className="flex flex-col gap-3">
              <PlaneProjectScopePicker
                projects={state.projects}
                value={state.scope}
                disabled={state.submitting}
                onChange={(scope) => dispatch({ type: 'setScope', scope })}
              />
              {state.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {getPlaneErrorCopy(state.error.kind, hostLabel)}
                </p>
              ) : null}
            </div>
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
              {onScopeStep && mode === 'connect'
                ? translate('plane.connect.later', 'Choose later')
                : translate('plane.connect.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {state.submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {onScopeStep
                ? translate('plane.connect.saveScope', 'Save projects')
                : state.submitting
                  ? translate('plane.connect.verifying', 'Verifying…')
                  : translate('plane.connect.connect', 'Connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
