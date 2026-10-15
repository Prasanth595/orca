import { translate } from '@/i18n/i18n'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS } from '@/store/slices/plane-slice-contract'
import type {
  PlaneConnection,
  PlaneWorkItem,
  PlaneWorkItemDetail as PlaneWorkItemDetailValue
} from '../../../../../shared/plane-types'
import { PlaneCredentialError, PlaneNeedsScope } from './PlaneEmptyStates'
import { PlaneFilters } from './PlaneFilters'
import { PlaneListBanners } from './PlaneListBanners'
import { PlaneListBody } from './PlaneListBody'
import { PlaneWorkItemDetail } from './PlaneWorkItemDetail'
import { PlaneWorkspaceBanners } from './PlaneWorkspaceBanners'
import { hasActivePlaneFilters } from './plane-work-item-filters'
import type { PlaneWorkspaceBlock } from './plane-workspace-selection'
import { usePlaneTasksView } from './use-plane-tasks-view'

const CREDENTIAL_ERRORS: ReadonlySet<string> = new Set(['auth', 'credential_unreadable'])
const NO_BLOCKED_WORKSPACES: readonly PlaneWorkspaceBlock[] = []

/** Slots later features fill in; this view renders them as given. */
export type PlaneWorkItemActionSlots = {
  renderRowActions?: (item: PlaneWorkItem) => React.ReactNode
  /** Receives the loaded detail (with description) once it arrives, else the list item. */
  renderDetailActions?: (item: PlaneWorkItem | PlaneWorkItemDetailValue) => React.ReactNode
}

/**
 * One list over one workspace, or merged over several. Pages, selection and detail live in this
 * component, so the parent keys it by its workspace choice to keep them from leaking across.
 */
export function PlaneTasksView({
  workspaces,
  merged,
  blocked = NO_BLOCKED_WORKSPACES,
  filtersKey,
  onEditProjects,
  onReconnect,
  renderRowActions,
  renderDetailActions
}: PlaneWorkItemActionSlots & {
  workspaces: readonly PlaneConnection[]
  /** True for "All workspaces": rows carry a workspace badge and banners name their workspace. */
  merged: boolean
  /** Only for the merged view: workspaces it cannot list, shown as banners. */
  blocked?: readonly PlaneWorkspaceBlock[]
  /** The connection id, or the merged view's key; filters are remembered under it. */
  filtersKey: string
  onEditProjects: (connectionId: string) => void
  onReconnect: (connectionId: string) => void
}): React.JSX.Element {
  const {
    target,
    hostLabel,
    selected,
    setSelected,
    single,
    projects,
    projectsByConnection,
    effectiveFilters,
    states,
    listState,
    refresh,
    loadMore,
    handleItemChange,
    stateChange,
    projectStates,
    shown,
    assignees,
    jump,
    jumpError,
    workspaceFor,
    setFilters
  } = usePlaneTasksView({ workspaces, merged, filtersKey })

  if (single && listState.needsScope) {
    return <PlaneNeedsScope onChooseProjects={() => onEditProjects(single.id)} />
  }
  if (single && listState.error && CREDENTIAL_ERRORS.has(listState.error)) {
    return (
      <PlaneCredentialError kind={listState.error} onReconnect={() => onReconnect(single.id)} />
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col">
      <PlaneFilters
        filters={effectiveFilters}
        projects={projects}
        states={projectStates}
        assignees={assignees}
        refreshing={listState.refreshing || listState.status === 'loading'}
        onChange={setFilters}
        onJumpToIdentifier={jump}
        onRefresh={refresh}
        projectFilterHint={
          merged
            ? translate(
                'plane.workspaceSwitcher.projectFilterHint',
                'Choose one workspace to filter by project or exact state.'
              )
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
          <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {translate('plane.tasks.listTitle', 'Plane work items')}
          </div>
          {listState.status === 'ready' ? (
            <span className="text-2xs text-muted-foreground">
              {translate('plane.tasks.shown', '{{count}} shown', { count: shown.length })}
            </span>
          ) : null}
        </div>
        {jumpError ? (
          <p role="alert" className="border-b border-border/50 px-3 py-2 text-xs text-destructive">
            {jumpError}
          </p>
        ) : null}
        {single ? (
          <PlaneListBanners
            state={listState}
            hostLabel={hostLabel}
            projectName={(id) =>
              projects.find((project) => project.id === id)?.name ??
              translate('plane.tasks.unknownProject', 'A project')
            }
            onEditProjects={() => onEditProjects(single.id)}
            onLoadMore={(id) => loadMore(single.id, id)}
          />
        ) : (
          <PlaneWorkspaceBanners
            workspaces={workspaces}
            blocked={blocked}
            states={states}
            projectsByConnection={projectsByConnection}
            hostLabel={hostLabel}
            onEditProjects={onEditProjects}
            onReconnect={onReconnect}
            onLoadMore={loadMore}
          />
        )}
        <PlaneListBody
          state={listState}
          shown={shown}
          canClearFilters={hasActivePlaneFilters(effectiveFilters)}
          hostLabel={hostLabel}
          onOpen={setSelected}
          onClearFilters={() => setFilters(DEFAULT_PLANE_WORK_ITEM_FILTERS)}
          renderRowActions={renderRowActions}
          stateChange={stateChange}
          workspaceFor={workspaceFor}
        />
      </div>
      <PlaneWorkItemDetail
        item={selected}
        target={target}
        onClose={() => setSelected(null)}
        onItemChange={handleItemChange}
        renderActions={renderDetailActions}
      />
    </div>
  )
}
