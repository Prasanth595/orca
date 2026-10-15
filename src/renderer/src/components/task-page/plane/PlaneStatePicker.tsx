import { ChevronDown, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItem } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { usePlaneStateChange, type PlaneStateChange } from './plane-state-change'

type MenuPrimitives = {
  Label: typeof DropdownMenuLabel | typeof ContextMenuLabel
  RadioGroup: typeof DropdownMenuRadioGroup | typeof ContextMenuRadioGroup
  RadioItem: typeof DropdownMenuRadioItem | typeof ContextMenuRadioItem
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator
}

const DROPDOWN: MenuPrimitives = {
  Label: DropdownMenuLabel,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Separator: DropdownMenuSeparator
}

const CONTEXT: MenuPrimitives = {
  Label: ContextMenuLabel,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
  Separator: ContextMenuSeparator
}

function PlaneStateMenuItems({
  item,
  change,
  menu
}: {
  item: PlaneWorkItem
  change: PlaneStateChange
  menu: MenuPrimitives
}): React.JSX.Element {
  const { Label, RadioGroup, RadioItem, Separator } = menu
  if (!change.sections) {
    return (
      <Label>
        {change.loadingStates
          ? translate('plane.statePicker.loading', 'Loading states…')
          : translate('plane.statePicker.unavailable', 'States are unavailable.')}
      </Label>
    )
  }
  const statesById = new Map(
    change.sections.flatMap((section) => section.states).map((s) => [s.id, s])
  )
  return (
    <RadioGroup
      value={item.state?.id ?? ''}
      onValueChange={(stateId) => {
        const state = statesById.get(stateId)
        if (state) {
          change.changeState(state)
        }
      }}
    >
      {change.sections.map((section, index) => (
        <div key={section.group} role="group" aria-label={section.label}>
          {index > 0 ? <Separator /> : null}
          <Label>{section.label}</Label>
          {section.states.map((state) => (
            <RadioItem key={state.id} value={state.id} disabled={change.pending}>
              {state.name}
            </RadioItem>
          ))}
        </div>
      ))}
    </RadioGroup>
  )
}

type StatePickerProps = {
  item: PlaneWorkItem
  target: RuntimeClientTarget
  onItemChange: (item: PlaneWorkItem) => void
}

/** Detail-sheet control: the current state as a button that opens the grouped state list. */
export function PlaneStatePicker(props: StatePickerProps): React.JSX.Element {
  const change = usePlaneStateChange(props)
  const stateName = props.item.state?.name ?? translate('plane.row.noState', 'No state')
  return (
    <DropdownMenu onOpenChange={(open) => (open ? change.loadStates() : undefined)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={change.pending}
          aria-label={translate('plane.statePicker.trigger', 'Change state: {{state}}', {
            state: stateName
          })}
        >
          {stateName}
          {change.pending ? <LoaderCircle className="animate-spin" /> : <ChevronDown />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <PlaneStateMenuItems item={props.item} change={change} menu={DROPDOWN} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Right-click menu for a list row, matching the context menus of the other task lists. */
export function PlaneWorkItemContextMenu({
  children,
  ...props
}: StatePickerProps & { children: React.ReactNode }): React.JSX.Element {
  const change = usePlaneStateChange(props)
  return (
    <ContextMenu onOpenChange={(open) => (open ? change.loadStates() : undefined)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={change.pending}>
            {translate('plane.statePicker.changeState', 'Change state')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <PlaneStateMenuItems item={props.item} change={change} menu={CONTEXT} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => void window.api.shell.openUrl(props.item.url)}>
          <ExternalLink />
          {translate('plane.detail.openInPlane', 'Open in Plane')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
