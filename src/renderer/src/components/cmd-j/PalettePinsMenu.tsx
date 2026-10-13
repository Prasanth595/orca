import { BookMarked, BookmarkMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { WorktreeJumpPaletteController } from '../use-worktree-jump-palette-controller'

export function PalettePinsMenu({
  controller
}: {
  controller: WorktreeJumpPaletteController
}): React.JSX.Element | null {
  if (controller.pins.length === 0) {
    return null
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={translate('worktreeJumpPalette.managePins', 'Manage shortcuts')}
        >
          <BookMarked /> {controller.pins.length}/5
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          controller.inputRef.current?.focus()
        }}
      >
        <DropdownMenuLabel>
          {translate('worktreeJumpPalette.removePin', 'Remove a shortcut')}
        </DropdownMenuLabel>
        {controller.pins.map((pin) => (
          <DropdownMenuItem key={pin.id} onSelect={() => controller.removePin(pin.id)}>
            <BookmarkMinus />
            <span className="max-w-64 truncate">{pin.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
