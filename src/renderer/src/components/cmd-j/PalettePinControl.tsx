import { BookmarkPlus, BookmarkMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { PaletteItem } from '../worktree-jump-palette-model'
import type { WorktreeJumpPaletteController } from '../use-worktree-jump-palette-controller'

export function PalettePinControl({
  entry,
  controller
}: {
  entry: PaletteItem
  controller: WorktreeJumpPaletteController
}): React.JSX.Element {
  const pinned = controller.pinnedIds.includes(entry.id)
  const label = pinned
    ? translate('worktreeJumpPalette.unpin', 'Remove shortcut')
    : translate('worktreeJumpPalette.pin', 'Add shortcut')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pinned}
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation()
            }
          }}
          onClick={(event) => {
            event.stopPropagation()
            controller.togglePin(entry)
            controller.inputRef.current?.focus()
          }}
        >
          {pinned ? <BookmarkMinus /> : <BookmarkPlus />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
