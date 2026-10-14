import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import type { PlaneMember, PlaneWorkItem } from '../../../../../shared/plane-types'
import { getPlaneStateGroup, getPlaneWorkItemKey } from './plane-work-item-filters'
import { PlaneWorkItemContextMenu } from './PlaneStatePicker'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

function initials(member: PlaneMember): string {
  const parts = member.displayName.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}` : (parts[0] ?? '?')
  return letters.slice(0, 2).toUpperCase()
}

export function PlaneAssigneeAvatars({
  assignees
}: {
  assignees: readonly PlaneMember[]
}): React.JSX.Element | null {
  if (assignees.length === 0) {
    return null
  }
  const shown = assignees.slice(0, 3)
  return (
    <span
      className="flex shrink-0 -space-x-1.5"
      aria-label={translate('plane.row.assignees', 'Assigned to {{names}}', {
        names: assignees.map((member) => member.displayName).join(', ')
      })}
    >
      {shown.map((member) => (
        <span
          key={member.id}
          className="flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-medium text-muted-foreground"
        >
          {initials(member)}
        </span>
      ))}
      {assignees.length > shown.length ? (
        <span className="flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] text-muted-foreground">
          +{assignees.length - shown.length}
        </span>
      ) : null}
    </span>
  )
}

// Why data-group: one static class list keeps the tone tokens checkable and themeable.
export function PlaneStatePill({ item }: { item: PlaneWorkItem }): React.JSX.Element {
  return (
    <span
      data-group={getPlaneStateGroup(item)}
      className="max-w-32 shrink-0 truncate rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground data-[group=cancelled]:line-through data-[group=completed]:border-status-success-border data-[group=completed]:bg-status-success-background data-[group=completed]:text-status-success data-[group=started]:border-status-warning-border data-[group=started]:bg-status-warning-background data-[group=started]:text-status-warning data-[group=unstarted]:border-border data-[group=unstarted]:bg-background data-[group=unstarted]:text-foreground"
    >
      {item.state?.name ?? translate('plane.row.noState', 'No state')}
    </span>
  )
}

export function PlaneWorkItemRow({
  item,
  onOpen,
  actions,
  ...liProps
}: Omit<React.ComponentProps<'li'>, 'children' | 'className'> & {
  item: PlaneWorkItem
  onOpen: (item: PlaneWorkItem) => void
  /** Per-row actions slot (e.g. starting a workspace); rendered outside the row button. */
  actions?: React.ReactNode
}): React.JSX.Element {
  // Why spread: a context-menu trigger wraps the row and passes its ref and handlers through.
  return (
    <li {...liProps} className="group flex items-center gap-2 px-2 hover:bg-accent/40">
      <button
        type="button"
        data-plane-row
        data-plane-connection-id={item.connectionId}
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {item.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
        <PlaneStatePill item={item} />
        <PlaneAssigneeAvatars assignees={item.assignees} />
        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
          {formatUiRelativeTimeFromDate(item.updatedAt)}
        </span>
      </button>
      {actions}
    </li>
  )
}

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

// Why: rows are plain buttons, so arrow keys move focus between them like the other task lists.
function moveRowFocus(event: React.KeyboardEvent<HTMLUListElement>): void {
  if (!NAVIGATION_KEYS.has(event.key)) {
    return
  }
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-plane-row]')]
  const active = document.activeElement
  const current = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))
  if (rows[next]) {
    event.preventDefault()
    rows[next].focus()
  }
}

export function PlaneWorkItemList({
  items,
  onOpen,
  renderActions,
  stateChange
}: {
  items: readonly PlaneWorkItem[]
  onOpen: (item: PlaneWorkItem) => void
  renderActions?: (item: PlaneWorkItem) => React.ReactNode
  /** Enables the row context menu that changes an item's state. */
  stateChange?: { target: RuntimeClientTarget; onItemChange: (item: PlaneWorkItem) => void }
}): React.JSX.Element {
  return (
    <ul
      className="divide-y divide-border/50"
      aria-label={translate('plane.list.label', 'Plane work items')}
      onKeyDown={moveRowFocus}
    >
      {items.map((item) => {
        const row = (
          <PlaneWorkItemRow
            key={getPlaneWorkItemKey(item)}
            item={item}
            onOpen={onOpen}
            actions={renderActions?.(item)}
          />
        )
        return stateChange ? (
          <PlaneWorkItemContextMenu
            key={getPlaneWorkItemKey(item)}
            item={item}
            target={stateChange.target}
            onItemChange={stateChange.onItemChange}
          >
            {row}
          </PlaneWorkItemContextMenu>
        ) : (
          row
        )
      })}
    </ul>
  )
}
