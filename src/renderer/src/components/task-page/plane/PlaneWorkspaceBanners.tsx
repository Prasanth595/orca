import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PlaneConnection, PlaneProject } from '../../../../../shared/plane-types'
import { PlaneBanner, PlaneListBanners } from './PlaneListBanners'
import { getPlaneWorkspaceLabel, type PlaneWorkspaceBlock } from './plane-workspace-selection'
import type { PlaneWorkItemsState } from './use-plane-work-items'

const CREDENTIAL_ERRORS: ReadonlySet<PlaneErrorKind> = new Set(['auth', 'credential_unreadable'])

type WorkspaceActions = {
  onEditProjects: (connectionId: string) => void
  onReconnect: (connectionId: string) => void
}

function NeedsScopeBanner(props: { label: string; onChoose: () => void }) {
  return (
    <PlaneBanner prefix={props.label}>
      <span>{translate('plane.workspaceBanner.needsScope', 'Choose which projects to list.')}</span>
      <Button variant="link" size="xs" onClick={props.onChoose}>
        {translate('plane.tasks.chooseProjects', 'Choose projects')}
      </Button>
    </PlaneBanner>
  )
}

function ErrorBanner(props: {
  label: string
  kind: PlaneErrorKind
  hostLabel: string
  onReconnect: () => void
}) {
  return (
    <PlaneBanner prefix={props.label}>
      <span role="alert">{getPlaneErrorCopy(props.kind, props.hostLabel)}</span>
      {CREDENTIAL_ERRORS.has(props.kind) ? (
        <Button variant="link" size="xs" onClick={props.onReconnect}>
          {translate('plane.tasks.reconnect', 'Reconnect Plane')}
        </Button>
      ) : null}
    </PlaneBanner>
  )
}

/**
 * The "all workspaces" view keeps listing what loads; a workspace that needs the user (projects,
 * a new token) or failed shows as its own banner instead of hiding the others.
 */
export function PlaneWorkspaceBanners({
  workspaces,
  blocked,
  states,
  projectsByConnection,
  hostLabel,
  onEditProjects,
  onReconnect,
  onLoadMore
}: WorkspaceActions & {
  workspaces: readonly PlaneConnection[]
  blocked: readonly PlaneWorkspaceBlock[]
  states: Readonly<Record<string, PlaneWorkItemsState>>
  projectsByConnection: Readonly<Record<string, PlaneProject[]>>
  hostLabel: string
  onLoadMore: (connectionId: string, projectId: string) => void
}): React.JSX.Element {
  return (
    <>
      {blocked.map(({ connection, reason }) => {
        const label = getPlaneWorkspaceLabel(connection)
        return reason === 'needs-scope' ? (
          <NeedsScopeBanner
            key={connection.id}
            label={label}
            onChoose={() => onEditProjects(connection.id)}
          />
        ) : (
          <ErrorBanner
            key={connection.id}
            label={label}
            kind="credential_unreadable"
            hostLabel={hostLabel}
            onReconnect={() => onReconnect(connection.id)}
          />
        )
      })}
      {workspaces.map((connection) => {
        const state = states[connection.id]
        const label = getPlaneWorkspaceLabel(connection)
        if (!state) {
          return null
        }
        if (state.needsScope) {
          return (
            <NeedsScopeBanner
              key={connection.id}
              label={label}
              onChoose={() => onEditProjects(connection.id)}
            />
          )
        }
        if (state.status === 'error' && state.error) {
          return (
            <ErrorBanner
              key={connection.id}
              label={label}
              kind={state.error}
              hostLabel={hostLabel}
              onReconnect={() => onReconnect(connection.id)}
            />
          )
        }
        const projects = projectsByConnection[connection.id] ?? []
        return (
          <PlaneListBanners
            key={connection.id}
            state={state}
            hostLabel={hostLabel}
            workspaceLabel={label}
            projectName={(projectId) =>
              projects.find((project) => project.id === projectId)?.name ??
              translate('plane.tasks.unknownProject', 'A project')
            }
            onEditProjects={() => onEditProjects(connection.id)}
            onLoadMore={(projectId) => onLoadMore(connection.id, projectId)}
          />
        )
      })}
    </>
  )
}
