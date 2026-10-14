import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { openPlaneWorkItemComposer, type PlaneComposerItem } from './open-plane-work-item-composer'

export function PlaneCreateWorkspaceButton({
  item,
  sourceContext,
  variant = 'icon'
}: {
  item: PlaneComposerItem
  sourceContext: TaskSourceContext | null
  /** `icon` fits a list row; `labelled` names the action where there is room (the detail). */
  variant?: 'icon' | 'labelled'
}): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  // Why by the item's connectionId: the link must name the connection the item came from.
  const connection = useAppStore((s) =>
    s.planeStatus.connected && s.planeStatus.connection.id === item.connectionId
      ? s.planeStatus.connection
      : null
  )
  const label = translate('plane.tasks.createWorkspaceFor', 'Create workspace from {{value0}}', {
    value0: item.identifier
  })
  const open = (event: React.MouseEvent): void => {
    // Rows open the detail on click; this action must not.
    event.stopPropagation()
    openPlaneWorkItemComposer({ item, connection, sourceContext, openModal })
  }
  return variant === 'labelled' ? (
    <Button variant="outline" size="sm" title={label} onClick={open}>
      <Plus />
      {translate('plane.tasks.createWorkspace', 'Create workspace')}
    </Button>
  ) : (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={open}>
      <Plus />
    </Button>
  )
}
