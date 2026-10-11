import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  NODE_TYPE_LABELS,
  NODE_TYPE_ICON_COLORS,
  NODE_TYPE_ICONS,
  TRIGGER_NODE_TYPES,
  ACTION_NODE_TYPES,
  CONTROL_FLOW_NODE_TYPES
} from './workflow-canvas-node-config'
import type { WorkflowNodeType } from '../../../../shared/workflow-types'

type Props = { onAdd: (type: WorkflowNodeType) => void }

export default function WorkflowAddNodeMenu({ onAdd }: Props): React.JSX.Element {
  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[176px]">
      <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {translate('workflows.canvas.menuGroupTriggers', 'Triggers')}
      </div>
      {TRIGGER_NODE_TYPES.map((type) => {
        const Icon = NODE_TYPE_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-muted transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onAdd(type)}
          >
            <Icon className={cn('size-3.5 shrink-0', NODE_TYPE_ICON_COLORS[type])} />
            {NODE_TYPE_LABELS[type]}
          </button>
        )
      })}
      <div className="mx-3 my-1 border-t border-border" />
      <div className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {translate('workflows.canvas.menuGroupActions', 'Actions')}
      </div>
      {ACTION_NODE_TYPES.map((type) => {
        const Icon = NODE_TYPE_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-muted transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onAdd(type)}
          >
            <Icon className={cn('size-3.5 shrink-0', NODE_TYPE_ICON_COLORS[type])} />
            {NODE_TYPE_LABELS[type]}
          </button>
        )
      })}
      <div className="mx-3 my-1 border-t border-border" />
      <div className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {translate('workflows.canvas.menuGroupControlFlow', 'Control Flow')}
      </div>
      {CONTROL_FLOW_NODE_TYPES.map((type) => {
        const Icon = NODE_TYPE_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-muted transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onAdd(type)}
          >
            <Icon className={cn('size-3.5 shrink-0', NODE_TYPE_ICON_COLORS[type])} />
            {NODE_TYPE_LABELS[type]}
          </button>
        )
      })}
    </div>
  )
}
