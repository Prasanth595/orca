import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { PLANE_ALL_WORKSPACES } from '@/store/slices/plane-slice-contract'
import type { PlaneConnectionEntry } from '../../../../../shared/plane-types'
import { getPlaneWorkspaceLabel } from './plane-workspace-selection'

/** Chooses one connected workspace, or all of them merged; only shown with two or more. */
export function PlaneWorkspaceSwitcher({
  entries,
  value,
  onChange
}: {
  entries: readonly PlaneConnectionEntry[]
  value: string
  onChange: (workspaceId: string) => void
}): React.JSX.Element | null {
  if (entries.length < 2) {
    return null
  }
  return (
    <div className="mb-2 flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          size="sm"
          aria-label={translate('plane.workspaceSwitcher.label', 'Plane workspace')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PLANE_ALL_WORKSPACES}>
            {translate('plane.workspaceSwitcher.all', 'All workspaces')}
          </SelectItem>
          <SelectSeparator />
          {entries.map(({ connection }) => (
            <SelectItem key={connection.id} value={connection.id}>
              {getPlaneWorkspaceLabel(connection)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
