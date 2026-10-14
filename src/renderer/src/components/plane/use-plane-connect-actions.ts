import type { RefObject } from 'react'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { PlaneConnectFormAction, PlaneConnectFormState } from './plane-connect-form-model'
import {
  getPlaneScopeToSave,
  getPlaneSlugsToConnect,
  toPlaneConnectArgs
} from './plane-connect-form-selectors'
import type { PlaneErrorKind } from './plane-error-copy'

// Why only these stop at one chip: every other failure (token, URL, network) would repeat for
// each workspace, so the first one ends the run and shows once for the whole form.
const WORKSPACE_ERRORS: ReadonlySet<PlaneErrorKind> = new Set([
  'workspace_unavailable',
  'forbidden',
  'not_found'
])

type Dispatch = (action: PlaneConnectFormAction) => void

/** Connects each workspace slug in turn with the same token, then saves each project scope. */
export function usePlaneConnectActions({
  target,
  state,
  dispatch,
  mountedRef,
  onConnected,
  onDone
}: {
  target: RuntimeClientTarget
  state: PlaneConnectFormState
  dispatch: Dispatch
  mountedRef: RefObject<boolean>
  onConnected?: () => void
  onDone: () => void
}): { connect: () => Promise<void>; saveScopes: () => Promise<void> } {
  const connectPlane = useAppStore((s) => s.connectPlane)
  const setPlaneProjectScope = useAppStore((s) => s.setPlaneProjectScope)

  const connect = async (): Promise<void> => {
    const slugs = getPlaneSlugsToConnect(state)
    if (slugs.length === 0 || state.submitting) {
      return
    }
    dispatch({ type: 'commitSlugDraft' })
    dispatch({ type: 'submitStarted' })
    const connected = new Set(
      state.chips.filter((chip) => chip.status === 'connected').map((chip) => chip.slug)
    )
    for (const slug of slugs) {
      const args = toPlaneConnectArgs(state, slug)
      if (!args) {
        break
      }
      dispatch({ type: 'chipStarted', slug })
      const result = await connectPlane(target, args)
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        connected.add(slug)
        dispatch({
          type: 'chipConnected',
          slug,
          connectionId: result.connection.id,
          projects: result.projects,
          scope: result.connection.projectScope
        })
        onConnected?.()
        continue
      }
      if (!WORKSPACE_ERRORS.has(result.error)) {
        dispatch({
          type: 'submitFailed',
          error: { kind: result.error, ...('field' in result ? { field: result.field } : {}) }
        })
        return
      }
      dispatch({ type: 'chipFailed', slug, error: result.error })
    }
    dispatch({ type: 'submitFinished' })
    if (slugs.every((slug) => connected.has(slug))) {
      dispatch({ type: 'goToScope' })
    }
  }

  const saveScopes = async (): Promise<void> => {
    if (state.submitting) {
      return
    }
    dispatch({ type: 'submitStarted' })
    for (const workspace of state.workspaces) {
      const scope = getPlaneScopeToSave(workspace.scope)
      if (!scope) {
        continue
      }
      const result = await setPlaneProjectScope(target, scope, workspace.connectionId)
      if (!mountedRef.current) {
        return
      }
      if (!result.ok) {
        dispatch({ type: 'submitFailed', error: { kind: result.error.kind } })
        return
      }
    }
    onDone()
  }

  return { connect, saveScopes }
}
