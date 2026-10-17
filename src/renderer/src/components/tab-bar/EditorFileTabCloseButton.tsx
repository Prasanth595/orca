import { X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { TabCloseTooltip } from './TabCloseTooltip'

export function EditorFileTabCloseButton({
  fileIsDirty,
  showsSelectionChrome,
  onClose
}: {
  fileIsDirty: boolean
  showsSelectionChrome: boolean
  onClose: () => void
}): React.JSX.Element {
  return (
    <TabCloseTooltip>
      <button
        className={`flex items-center justify-center w-4 h-4 rounded-sm ${
          fileIsDirty
            ? 'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted motion-reduce:transition-none'
            : showsSelectionChrome
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
              : 'text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted'
        }`}
        type="button"
        // Why: simulator unified tabs reuse this tab chrome, so E2E needs
        // the same stable close affordance on the real button users click.
        data-tab-close-button="true"
        aria-label={translate(
          'auto.components.tab.bar.EditorFileTabCloseButton.4655cf570e',
          'Close tab'
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X className="w-3 h-3" />
      </button>
    </TabCloseTooltip>
  )
}
