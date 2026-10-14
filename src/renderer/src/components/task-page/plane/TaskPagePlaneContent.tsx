import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { PlaneConnectDialog } from '@/components/plane/PlaneConnectDialog'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { defaultScopeSource } from '@/lib/default-creation-host'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { planeLookupWorkItemForTarget } from '@/runtime/runtime-plane-client'
import { getPlaneRuntimeTarget } from '@/runtime/runtime-plane-target'
import { useAppStore } from '@/store'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS } from '@/store/slices/plane-slice-contract'
import type {
  PlaneConnection,
  PlaneWorkItem,
  PlaneWorkItemDetail as PlaneWorkItemDetailValue
} from '../../../../../shared/plane-types'
import { PlaneFilters } from './PlaneFilters'
import { PlaneListBanners } from './PlaneListBanners'
import { PlaneWorkItemDetail } from './PlaneWorkItemDetail'
import { PlaneWorkItemList } from './PlaneWorkItemRow'
import {
  filterPlaneWorkItems,
  getPlaneAssigneeOptions,
  getPlaneWorkItemKey,
  getScopedPlaneProjects,
  hasActivePlaneFilters
} from './plane-work-item-filters'
import {
  usePlaneProjectStates,
  usePlaneWorkItems,
  type PlaneWorkItemsState
} from './use-plane-work-items'

type DialogMode = 'connect' | 'editScope'
type PlaneListStateChange = NonNullable<Parameters<typeof PlaneWorkItemList>[0]['stateChange']>

/** Slots later features fill in; this view renders them as given. */
export type PlaneWorkItemActionSlots = {
  renderRowActions?: (item: PlaneWorkItem) => React.ReactNode
  /** Receives the loaded detail (with description) once it arrives, else the list item. */
  renderDetailActions?: (item: PlaneWorkItem | PlaneWorkItemDetailValue) => React.ReactNode
}

const CREDENTIAL_ERRORS: ReadonlySet<PlaneErrorKind> = new Set(['auth', 'credential_unreadable'])

function EmptyCard(props: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
      <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
      <p className="text-base font-medium text-foreground">{props.title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{props.body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{props.children}</div>
    </div>
  )
}

function PlaneNeedsScope({ onChooseProjects }: { onChooseProjects: () => void }) {
  return (
    <EmptyCard
      title={translate('plane.tasks.needsScopeTitle', 'Choose Plane projects')}
      body={translate(
        'plane.tasks.needsScopeBody',
        'Pick which projects Orca lists. Your saved choice is no longer available, or none was made yet.'
      )}
    >
      <Button onClick={onChooseProjects}>
        {translate('plane.tasks.chooseProjects', 'Choose projects')}
      </Button>
    </EmptyCard>
  )
}

function PlaneCredentialError(props: { kind: PlaneErrorKind; onReconnect: () => void }) {
  const hostLabel = usePlaneHostLabel()
  return (
    <EmptyCard
      title={translate('plane.tasks.credentialTitle', 'Reconnect Plane')}
      body={getPlaneErrorCopy(props.kind, hostLabel)}
    >
      <Button onClick={props.onReconnect}>
        {translate('plane.tasks.reconnect', 'Reconnect Plane')}
      </Button>
    </EmptyCard>
  )
}

function usePlaneJump(
  target: ReturnType<typeof getPlaneRuntimeTarget>,
  items: readonly PlaneWorkItem[],
  onFound: (item: PlaneWorkItem) => void
) {
  const [jumpError, setJumpError] = useState<string | null>(null)
  const hostLabel = usePlaneHostLabel()
  const jump = (identifier: string): void => {
    setJumpError(null)
    const loaded = items.find((item) => item.identifier === identifier)
    if (loaded) {
      onFound(loaded)
      return
    }
    // Why: only an exact ID the list has not loaded costs a request.
    planeLookupWorkItemForTarget(target, identifier).then(
      (result) => {
        if (result.ok) {
          onFound(result.value)
        } else {
          setJumpError(
            result.error.kind === 'not_found'
              ? translate(
                  'plane.tasks.idNotFound',
                  '{{identifier}} was not found in this workspace.',
                  {
                    identifier
                  }
                )
              : getPlaneErrorCopy(result.error.kind, hostLabel)
          )
        }
      },
      () => setJumpError(getPlaneErrorCopy('runtime_error', hostLabel))
    )
  }
  return { jump, jumpError, clearJumpError: () => setJumpError(null) }
}

function PlaneListBody({
  state,
  shown,
  canClearFilters,
  hostLabel,
  onOpen,
  onClearFilters,
  renderRowActions,
  stateChange
}: {
  state: PlaneWorkItemsState
  shown: PlaneWorkItem[]
  canClearFilters: boolean
  hostLabel: string
  onOpen: (item: PlaneWorkItem) => void
  onClearFilters: () => void
  renderRowActions?: (item: PlaneWorkItem) => React.ReactNode
  stateChange: PlaneListStateChange
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
      <PlaneListBodyContent
        state={state}
        shown={shown}
        canClearFilters={canClearFilters}
        hostLabel={hostLabel}
        onOpen={onOpen}
        onClearFilters={onClearFilters}
        renderRowActions={renderRowActions}
        stateChange={stateChange}
      />
    </div>
  )
}

function PlaneListBodyContent(props: Parameters<typeof PlaneListBody>[0]): React.JSX.Element {
  const { state, shown } = props
  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (state.status === 'error' && state.error) {
    return (
      <p role="alert" className="px-3 py-10 text-center text-sm text-destructive">
        {getPlaneErrorCopy(state.error, props.hostLabel)}
      </p>
    )
  }
  if (shown.length > 0) {
    return (
      <PlaneWorkItemList
        items={shown}
        onOpen={props.onOpen}
        renderActions={props.renderRowActions}
        stateChange={props.stateChange}
      />
    )
  }
  const filteredOut = state.items.length > 0
  return (
    <div className="flex flex-col items-center gap-3 px-3 py-10 text-center text-sm text-muted-foreground">
      <p>
        {filteredOut
          ? translate('plane.tasks.noMatch', 'No work items match these filters.')
          : translate('plane.tasks.empty', 'No work items in the chosen projects.')}
      </p>
      {filteredOut && props.canClearFilters ? (
        <Button variant="outline" size="sm" onClick={props.onClearFilters}>
          {translate('plane.tasks.clearFilters', 'Clear filters')}
        </Button>
      ) : null}
    </div>
  )
}

function PlaneConnectedTasks({
  connection,
  onEditProjects,
  onReconnect,
  renderRowActions,
  renderDetailActions
}: PlaneWorkItemActionSlots & {
  connection: PlaneConnection
  onEditProjects: () => void
  onReconnect: () => void
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const planeProjects = useAppStore((s) => s.planeProjects)
  const planeProjectsContextKey = useAppStore((s) => s.planeProjectsContextKey)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const savedFilters = useAppStore((s) => s.planeWorkItemFiltersByConnection[connection.id])
  const setPlaneWorkItemFilters = useAppStore((s) => s.setPlaneWorkItemFilters)
  const hostLabel = usePlaneHostLabel()
  const contextKey = getProviderRuntimeContextKey(settings)
  const target = useMemo(() => getPlaneRuntimeTarget(defaultScopeSource(settings)), [settings])
  const [selected, setSelected] = useState<PlaneWorkItem | null>(null)

  useEffect(() => {
    if (planeProjectsContextKey !== contextKey) {
      void loadPlaneProjects()
    }
  }, [contextKey, loadPlaneProjects, planeProjectsContextKey])

  const filters = savedFilters ?? DEFAULT_PLANE_WORK_ITEM_FILTERS
  const projects = getScopedPlaneProjects(planeProjects, connection.projectScope)
  // Why: a project dropped from the scope must not keep filtering the list to nothing.
  const projectId =
    filters.projectId && projects.some((project) => project.id === filters.projectId)
      ? filters.projectId
      : null
  const effectiveFilters = useMemo(() => ({ ...filters, projectId }), [filters, projectId])
  const sourceKey = JSON.stringify([contextKey, connection.id, connection.projectScope])
  const { state, refresh, loadMore, replaceItem } = usePlaneWorkItems({
    target,
    sourceKey,
    projectId
  })
  const handleItemChange = useCallback(
    (next: PlaneWorkItem) => {
      replaceItem(next)
      setSelected((previous) =>
        previous && getPlaneWorkItemKey(previous) === getPlaneWorkItemKey(next) ? next : previous
      )
    },
    [replaceItem]
  )
  const stateChange = useMemo(
    () => ({ target, onItemChange: handleItemChange }),
    [handleItemChange, target]
  )
  const states = usePlaneProjectStates(target, projectId)
  const shown = useMemo(
    () => filterPlaneWorkItems(state.items, effectiveFilters, connection.viewer.id),
    [connection.viewer.id, effectiveFilters, state.items]
  )
  const assignees = useMemo(() => getPlaneAssigneeOptions(state.items), [state.items])
  const { jump, jumpError, clearJumpError } = usePlaneJump(target, state.items, setSelected)
  const projectName = (id: string | undefined): string =>
    projects.find((project) => project.id === id)?.name ??
    translate('plane.tasks.unknownProject', 'A project')
  const setFilters = (patch: Partial<typeof filters>): void => {
    clearJumpError()
    setPlaneWorkItemFilters(connection.id, patch)
  }

  if (state.needsScope) {
    return <PlaneNeedsScope onChooseProjects={onEditProjects} />
  }
  if (state.status === 'error' && state.error && CREDENTIAL_ERRORS.has(state.error)) {
    return <PlaneCredentialError kind={state.error} onReconnect={onReconnect} />
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col">
      <PlaneFilters
        filters={effectiveFilters}
        projects={projects}
        states={states}
        assignees={assignees}
        refreshing={state.refreshing || state.status === 'loading'}
        onChange={setFilters}
        onJumpToIdentifier={jump}
        onRefresh={refresh}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
          <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {translate('plane.tasks.listTitle', 'Plane work items')}
          </div>
          {state.status === 'ready' ? (
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
        <PlaneListBanners
          state={state}
          hostLabel={hostLabel}
          projectName={projectName}
          onEditProjects={onEditProjects}
          onLoadMore={loadMore}
        />
        <PlaneListBody
          state={state}
          shown={shown}
          canClearFilters={hasActivePlaneFilters(effectiveFilters)}
          hostLabel={hostLabel}
          onOpen={setSelected}
          onClearFilters={() => setFilters(DEFAULT_PLANE_WORK_ITEM_FILTERS)}
          renderRowActions={renderRowActions}
          stateChange={stateChange}
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

export function TaskPagePlaneContent({
  onHide,
  renderRowActions,
  renderDetailActions
}: PlaneWorkItemActionSlots & { onHide: () => void }): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const settings = useAppStore((s) => s.settings)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null)

  const contextKey = getProviderRuntimeContextKey(settings)
  const ready = planeStatusChecked && planeStatusContextKey === contextKey
  const connection = ready && planeStatus.connected ? planeStatus.connection : null

  useEffect(() => {
    if (!ready) {
      void checkPlaneConnection()
    }
  }, [checkPlaneConnection, contextKey, ready])

  const body = !ready ? (
    <div className="mt-4 flex items-center justify-center py-14">
      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
    </div>
  ) : !connection ? (
    <EmptyCard
      title={translate('plane.tasks.connectTitle', 'Connect Plane')}
      body={translate(
        'plane.tasks.connectBody',
        'Browse work items from Plane Cloud or your self-hosted Plane server and start workspaces from them.'
      )}
    >
      <Button onClick={() => setDialogMode('connect')}>
        {translate('plane.tasks.connect', 'Connect Plane')}
      </Button>
      <Button variant="outline" onClick={onHide}>
        {translate('plane.tasks.hide', 'Hide Plane')}
      </Button>
    </EmptyCard>
  ) : planeStatus.connected && planeStatus.credentialError ? (
    <PlaneCredentialError
      kind="credential_unreadable"
      onReconnect={() => setDialogMode('connect')}
    />
  ) : connection.projectScope === null ? (
    <PlaneNeedsScope onChooseProjects={() => setDialogMode('editScope')} />
  ) : (
    // Why keyed: a workspace switcher can swap the connection; pages, selection and detail
    // belong to one connection and must not leak into the next.
    <PlaneConnectedTasks
      key={connection.id}
      connection={connection}
      onEditProjects={() => setDialogMode('editScope')}
      onReconnect={() => setDialogMode('connect')}
      renderRowActions={renderRowActions}
      renderDetailActions={renderDetailActions}
    />
  )

  return (
    <>
      {body}
      <PlaneConnectDialog
        open={dialogMode !== null}
        mode={dialogMode ?? 'connect'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMode(null)
          }
        }}
      />
    </>
  )
}
