import { translate } from '@/i18n/i18n'
import type { PlaneConnectFormAction, PlaneConnectFormState } from './plane-connect-form-model'
import { getPlaneErrorCopy } from './plane-error-copy'
import { PlaneProjectScopePicker } from './PlaneProjectScopePicker'

/** One project picker per workspace; with a single workspace the heading is left out. */
export function PlaneConnectScopeStep({
  state,
  dispatch,
  hostLabel
}: {
  state: PlaneConnectFormState
  dispatch: (action: PlaneConnectFormAction) => void
  hostLabel: string
}): React.JSX.Element {
  const several = state.workspaces.length > 1
  return (
    <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto scrollbar-sleek">
      {state.workspaces.map((workspace) => (
        <section
          key={workspace.connectionId}
          className="flex flex-col gap-2"
          aria-label={translate('plane.connect.scopeFor', 'Projects in {{slug}}', {
            slug: workspace.slug
          })}
        >
          {several ? (
            <h3 className="text-sm font-medium text-foreground">{workspace.slug}</h3>
          ) : null}
          <PlaneProjectScopePicker
            projects={workspace.projects}
            value={workspace.scope}
            disabled={state.submitting}
            onChange={(scope) =>
              dispatch({ type: 'setScope', connectionId: workspace.connectionId, scope })
            }
          />
        </section>
      ))}
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {getPlaneErrorCopy(state.error.kind, hostLabel)}
        </p>
      ) : null}
    </div>
  )
}
