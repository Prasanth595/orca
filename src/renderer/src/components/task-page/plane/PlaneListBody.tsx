import { LoaderCircle } from 'lucide-react'
import { getPlaneErrorCopy } from '@/components/plane/plane-error-copy'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItem } from '../../../../../shared/plane-types'
import { PlaneWorkItemList, type PlaneRowWorkspace } from './PlaneWorkItemRow'
import type { PlaneWorkItemsState } from './use-plane-work-items'

type PlaneListStateChange = NonNullable<Parameters<typeof PlaneWorkItemList>[0]['stateChange']>

export function PlaneListBody({
  state,
  shown,
  canClearFilters,
  hostLabel,
  onOpen,
  onClearFilters,
  renderRowActions,
  stateChange,
  workspaceFor
}: {
  state: PlaneWorkItemsState
  shown: PlaneWorkItem[]
  canClearFilters: boolean
  hostLabel: string
  onOpen: (item: PlaneWorkItem) => void
  onClearFilters: () => void
  renderRowActions?: (item: PlaneWorkItem) => React.ReactNode
  stateChange: PlaneListStateChange
  workspaceFor?: (item: PlaneWorkItem) => PlaneRowWorkspace | undefined
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
        workspaceFor={workspaceFor}
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
        workspaceFor={props.workspaceFor}
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
