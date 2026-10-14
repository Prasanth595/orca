import { useId } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItemFilters } from '@/store/slices/plane-slice-contract'
import {
  PLANE_PRIORITIES,
  PLANE_STATE_GROUPS,
  type PlaneMember,
  type PlaneProject,
  type PlaneState,
  type PlaneStateGroup
} from '../../../../../shared/plane-types'
import { getPlanePriorityLabel, getPlaneStateGroupLabel } from './plane-work-item-labels'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import {
  OPEN_PLANE_STATE_GROUPS,
  getPlaneIdentifierQuery,
  isOpenPlaneStateSelection
} from './plane-work-item-filters'

const ALL_PROJECTS = '__all__'
const ANY_STATE = '__any__'

function stateFilterLabel(filters: PlaneWorkItemFilters, states: readonly PlaneState[]): string {
  const exact = filters.projectId && states.find((state) => state.id === filters.stateId)
  if (exact) {
    return exact.name
  }
  if (isOpenPlaneStateSelection(filters.stateGroups)) {
    return translate('plane.filters.stateOpen', 'Open')
  }
  if (
    filters.stateGroups.length === 0 ||
    filters.stateGroups.length === PLANE_STATE_GROUPS.length
  ) {
    return translate('plane.filters.stateAll', 'All states')
  }
  return filters.stateGroups.map(getPlaneStateGroupLabel).join(', ')
}

function PlaneStateFilter({
  filters,
  states,
  onChange
}: {
  filters: PlaneWorkItemFilters
  states: readonly PlaneState[]
  onChange: (patch: Partial<PlaneWorkItemFilters>) => void
}): React.JSX.Element {
  const toggleGroup = (group: PlaneStateGroup, checked: boolean): void =>
    onChange({
      stateId: null,
      stateGroups: PLANE_STATE_GROUPS.filter((entry) =>
        entry === group ? checked : filters.stateGroups.includes(entry)
      )
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {translate('plane.filters.stateTrigger', 'State: {{value}}', {
            value: stateFilterLabel(filters, states)
          })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onSelect={() => onChange({ stateId: null, stateGroups: [...OPEN_PLANE_STATE_GROUPS] })}
        >
          {translate('plane.filters.stateOpen', 'Open')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {translate('plane.filters.stateGroups', 'State groups')}
        </DropdownMenuLabel>
        {PLANE_STATE_GROUPS.map((group) => (
          <DropdownMenuCheckboxItem
            key={group}
            checked={!filters.stateId && filters.stateGroups.includes(group)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => toggleGroup(group, checked === true)}
          >
            {getPlaneStateGroupLabel(group)}
          </DropdownMenuCheckboxItem>
        ))}
        {filters.projectId && states.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {translate('plane.filters.exactState', 'Exact state')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.stateId ?? ANY_STATE}
              onValueChange={(value) => onChange({ stateId: value === ANY_STATE ? null : value })}
            >
              <DropdownMenuRadioItem value={ANY_STATE}>
                {translate('plane.filters.anyState', 'Any state in the groups')}
              </DropdownMenuRadioItem>
              {states.map((state) => (
                <DropdownMenuRadioItem key={state.id} value={state.id}>
                  {state.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PlaneFilters({
  filters,
  projects,
  states,
  assignees,
  refreshing,
  onChange,
  onJumpToIdentifier,
  onRefresh,
  projectFilterHint
}: {
  filters: PlaneWorkItemFilters
  projects: readonly PlaneProject[]
  states: readonly PlaneState[]
  assignees: readonly PlaneMember[]
  refreshing: boolean
  onChange: (patch: Partial<PlaneWorkItemFilters>) => void
  onJumpToIdentifier: (identifier: string) => void
  onRefresh: () => void
  /** Set when project choices do not apply (several workspaces); disables the project filter. */
  projectFilterHint?: string
}): React.JSX.Element {
  const projectHintId = useId()
  return (
    <div className="rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.projectId ?? ALL_PROJECTS}
          disabled={projectFilterHint !== undefined}
          onValueChange={(value) =>
            onChange({ projectId: value === ALL_PROJECTS ? null : value, stateId: null })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label={translate('plane.filters.project', 'Project')}
            aria-describedby={projectFilterHint ? projectHintId : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>
              {translate('plane.filters.allInScope', 'All in scope')}
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectFilterHint ? (
          <span id={projectHintId} className="text-xs text-muted-foreground">
            {projectFilterHint}
          </span>
        ) : null}
        <PlaneStateFilter filters={filters} states={states} onChange={onChange} />
        <Select value={filters.assignee} onValueChange={(assignee) => onChange({ assignee })}>
          <SelectTrigger size="sm" aria-label={translate('plane.filters.assignee', 'Assignee')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anyone">{translate('plane.filters.anyone', 'Anyone')}</SelectItem>
            <SelectItem value="me">{translate('plane.filters.me', 'Me')}</SelectItem>
            <SelectItem value="unassigned">
              {translate('plane.filters.unassigned', 'Unassigned')}
            </SelectItem>
            {assignees.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.priority}
          onValueChange={(value) =>
            onChange({ priority: PLANE_PRIORITIES.find((entry) => entry === value) ?? 'any' })
          }
        >
          <SelectTrigger size="sm" aria-label={translate('plane.filters.priority', 'Priority')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">
              {translate('plane.filters.anyPriority', 'Any priority')}
            </SelectItem>
            {PLANE_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {getPlanePriorityLabel(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <Input
            value={filters.text}
            aria-label={translate('plane.filters.search', 'Search work items')}
            placeholder={translate(
              'plane.filters.searchPlaceholder',
              'Filter by title, or type an ID like WEB-12'
            )}
            className="h-8"
            onChange={(event) => onChange({ text: event.target.value })}
            onKeyDown={(event) => {
              const identifier = getPlaneIdentifierQuery(filters.text)
              if (event.key === 'Enter' && identifier && !isImeOwnedKeyboardEvent(event)) {
                event.preventDefault()
                onJumpToIdentifier(identifier)
              }
            }}
          />
        </div>
        <Button variant="ghost" size="sm" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {translate('plane.filters.refresh', 'Refresh')}
        </Button>
      </div>
    </div>
  )
}
