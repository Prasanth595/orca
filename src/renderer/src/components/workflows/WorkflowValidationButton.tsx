import { AlertTriangle } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkflowValidationError } from '../../../../shared/workflow-graph-validation'

type Props = {
  errors: WorkflowValidationError[]
}

export default function WorkflowValidationButton({ errors }: Props): React.JSX.Element | null {
  if (errors.length === 0) {
    return null
  }

  const count = errors.length
  const label =
    count === 1
      ? translate('workflows.validation.issue', '1 issue — run blocked')
      : translate('workflows.validation.issues', `${count} issues — run blocked`, { count })

  return (
    <div className="relative group" onMouseDown={(e) => e.stopPropagation()}>
      {/* Tooltip — shown on CSS hover, no state needed */}
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-popover border border-border rounded-lg shadow-lg p-2.5 w-64">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive mb-2">
            {label}
          </p>
          <ul className="space-y-1.5">
            {errors.map((err) => (
              <li key={err.message} className="flex items-start gap-1.5">
                <AlertTriangle className="size-3 text-destructive shrink-0 mt-[1px]" />
                <span className="text-[11px] text-foreground leading-tight">{err.message}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Down-pointing caret */}
        <div
          className="absolute top-full left-1/2 -translate-x-1/2"
          style={{
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid hsl(var(--border))'
          }}
        />
      </div>

      <button
        type="button"
        className="flex items-center justify-center gap-1 h-8 px-3 rounded-full border border-destructive/60 bg-background text-destructive shadow-md hover:bg-destructive/10 transition-colors"
        tabIndex={-1}
      >
        <AlertTriangle className="size-3.5" />
        <span className="text-[12px] font-medium">{count}</span>
      </button>
    </div>
  )
}
