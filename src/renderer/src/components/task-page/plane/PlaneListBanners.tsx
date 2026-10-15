import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { getPlaneErrorCopy } from '@/components/plane/plane-error-copy'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItemsState } from './use-plane-work-items'

export function PlaneBanner({
  prefix,
  children
}: {
  /** Names the workspace a banner belongs to when several are listed together. */
  prefix?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <TriangleAlert className="size-3.5 shrink-0" />
      {prefix ? <span className="font-medium text-foreground">{prefix}</span> : null}
      {children}
    </div>
  )
}

export function PlaneListBanners({
  state,
  hostLabel,
  projectName,
  onEditProjects,
  onLoadMore,
  workspaceLabel
}: {
  state: PlaneWorkItemsState
  hostLabel: string
  projectName: (projectId: string | undefined) => string
  onEditProjects: () => void
  onLoadMore: (projectId: string) => void
  workspaceLabel?: string
}): React.JSX.Element {
  const missing = state.missingProjectIds.length
  return (
    <>
      {state.errors.map((error) => (
        <PlaneBanner prefix={workspaceLabel} key={`${error.projectId ?? 'all'}:${error.kind}`}>
          <span role="alert">
            {translate('plane.banner.projectError', '{{project}} could not be loaded: {{reason}}', {
              project: projectName(error.projectId),
              reason: getPlaneErrorCopy(error.kind, hostLabel)
            })}
          </span>
        </PlaneBanner>
      ))}
      {missing > 0 ? (
        <PlaneBanner prefix={workspaceLabel}>
          <span>
            {missing === 1
              ? translate('plane.banner.missingOne', '1 selected project is no longer available.')
              : translate(
                  'plane.banner.missingMany',
                  '{{count}} selected projects are no longer available.',
                  { count: missing }
                )}
          </span>
          <Button variant="link" size="xs" onClick={onEditProjects}>
            {translate('plane.banner.editProjects', 'Edit projects')}
          </Button>
        </PlaneBanner>
      ) : null}
      {state.truncatedProjectIds.map((projectId) => (
        <PlaneBanner prefix={workspaceLabel} key={`truncated:${projectId}`}>
          <span>
            {translate('plane.banner.truncated', 'Showing the newest work items in {{project}}.', {
              project: projectName(projectId)
            })}
          </span>
          {state.nextCursorByProject[projectId] ? (
            <Button
              variant="link"
              size="xs"
              disabled={state.loadingMoreProjectId !== null}
              onClick={() => onLoadMore(projectId)}
            >
              {state.loadingMoreProjectId === projectId ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {translate('plane.banner.loadMore', 'Load more')}
            </Button>
          ) : null}
        </PlaneBanner>
      ))}
      {state.totalCapped ? (
        <PlaneBanner prefix={workspaceLabel}>
          <span>
            {translate(
              'plane.banner.totalCapped',
              'Showing the first 500 work items. Choose one project to see more.'
            )}
          </span>
        </PlaneBanner>
      ) : null}
    </>
  )
}
