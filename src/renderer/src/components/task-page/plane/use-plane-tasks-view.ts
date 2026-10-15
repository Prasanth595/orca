import { useCallback, useMemo, useState } from 'react'
import { usePlaneHostScope } from '@/components/plane/plane-host-scope'
import { useAppStore } from '@/store'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS } from '@/store/slices/plane-slice-contract'
import type { PlaneConnection, PlaneWorkItem } from '../../../../../shared/plane-types'
import type { PlaneRowWorkspace } from './PlaneWorkItemRow'
import {
  filterPlaneWorkItemsAcross,
  getPlaneAssigneeOptions,
  getPlaneWorkItemKey,
  getScopedPlaneProjects
} from './plane-work-item-filters'
import { combinePlaneWorkItemsStates } from './plane-work-item-pages'
import { getPlaneWorkspaceLabel } from './plane-workspace-selection'
import { usePlaneProjectsByConnection } from './use-plane-connection-projects'
import { usePlaneJump } from './use-plane-jump'
import { usePlaneProjectStates, usePlaneWorkItems } from './use-plane-work-items'

/** Everything the Plane task list derives from its workspaces, filters and loaded pages. */
export function usePlaneTasksView({
  workspaces,
  merged,
  filtersKey
}: {
  workspaces: readonly PlaneConnection[]
  merged: boolean
  filtersKey: string
}) {
  const { target, contextKey, label: hostLabel } = usePlaneHostScope()
  const savedFilters = useAppStore((s) => s.planeWorkItemFiltersByConnection[filtersKey])
  const setPlaneWorkItemFilters = useAppStore((s) => s.setPlaneWorkItemFilters)
  const [selected, setSelected] = useState<PlaneWorkItem | null>(null)
  const single = merged ? null : (workspaces[0] ?? null)
  const connectionIds = useMemo(() => workspaces.map((connection) => connection.id), [workspaces])

  const projectsByConnection = usePlaneProjectsByConnection(connectionIds, target, contextKey)
  const filters = savedFilters ?? DEFAULT_PLANE_WORK_ITEM_FILTERS
  const projects = single
    ? getScopedPlaneProjects(projectsByConnection[single.id] ?? [], single.projectScope)
    : []
  // Why: a project dropped from the scope must not keep filtering the list to nothing.
  const projectId =
    filters.projectId && projects.some((project) => project.id === filters.projectId)
      ? filters.projectId
      : null
  const effectiveFilters = useMemo(() => ({ ...filters, projectId }), [filters, projectId])
  const sources = useMemo(
    () => connectionIds.map((connectionId) => ({ connectionId, projectId })),
    [connectionIds, projectId]
  )
  const sourceKey = JSON.stringify([
    contextKey,
    workspaces.map((connection) => [connection.id, connection.projectScope])
  ])
  const { states, items, refresh, loadMore, replaceItem } = usePlaneWorkItems({
    target,
    sourceKey,
    sources
  })
  const listState = single
    ? (states[single.id] ?? combinePlaneWorkItemsStates([]))
    : combinePlaneWorkItemsStates(Object.values(states))
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
  const projectStates = usePlaneProjectStates(target, single?.id ?? '', projectId)
  const shown = useMemo(
    () =>
      filterPlaneWorkItemsAcross(
        workspaces.map((connection) => ({
          items: states[connection.id]?.items ?? [],
          viewerId: connection.viewer.id
        })),
        effectiveFilters
      ),
    [effectiveFilters, states, workspaces]
  )
  const assignees = useMemo(() => getPlaneAssigneeOptions(items), [items])
  const { jump, jumpError, clearJumpError } = usePlaneJump(
    target,
    connectionIds,
    items,
    setSelected
  )
  const workspaceFor = useMemo(() => {
    if (!merged) {
      return undefined
    }
    const byId = new Map<string, PlaneRowWorkspace>(
      workspaces.map((connection) => [
        connection.id,
        { slug: connection.workspaceSlug, label: getPlaneWorkspaceLabel(connection) }
      ])
    )
    return (item: PlaneWorkItem) => byId.get(item.connectionId)
  }, [merged, workspaces])
  const setFilters = (patch: Partial<typeof filters>): void => {
    clearJumpError()
    setPlaneWorkItemFilters(filtersKey, patch)
  }
  return {
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
  }
}
