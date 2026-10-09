import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronsDown, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

const FLOATING_TRIGGER_GAP = 8

/** How far left the button must move to clear the floating workspace launcher, if at all. */
function floatingTriggerShift(button: HTMLElement, currentShift: number): number {
  const trigger = document.querySelector<HTMLElement>('[data-floating-terminal-toggle]')
  if (!trigger) {
    return 0
  }
  const own = button.getBoundingClientRect()
  const other = trigger.getBoundingClientRect()
  if (other.width === 0 || other.height === 0) {
    return 0
  }
  // Undo the current shift so we compare against the button's resting spot.
  const right = own.right + currentShift
  const left = own.left + currentShift
  const overlaps =
    left < other.right + FLOATING_TRIGGER_GAP &&
    right > other.left - FLOATING_TRIGGER_GAP &&
    own.top < other.bottom + FLOATING_TRIGGER_GAP &&
    own.bottom > other.top - FLOATING_TRIGGER_GAP
  return overlaps ? right - other.left + FLOATING_TRIGGER_GAP : 0
}

/** One hide/show control that sits at the same corner whether the message box is open or not. */
export function NativeChatComposerToggleButton({
  collapsed,
  hasPendingDraft,
  onToggle
}: {
  collapsed: boolean
  hasPendingDraft: boolean
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const label = collapsed
    ? translate('components.native-chat.composer.expand', 'Show message box')
    : translate('components.native-chat.composer.collapse', 'Hide message box')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const shiftRef = useRef(0)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    const button = buttonRef.current
    if (!button) {
      return
    }
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = floatingTriggerShift(button, shiftRef.current)
        shiftRef.current = next
        setShift(next)
      })
    }
    measure()
    // Why: the launcher moves on window resize and on drag (pointerup), and this
    // corner moves whenever the pane or message box resizes.
    const resizeObserver = new ResizeObserver(measure)
    const root = button.closest('[data-native-chat-root="true"]')
    resizeObserver.observe(root ?? document.body)
    window.addEventListener('resize', measure)
    window.addEventListener('pointerup', measure)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('pointerup', measure)
    }
  }, [collapsed])

  return (
    <div className="relative h-0">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Same launcher treatment as the floating workspace button. */}
          <Button
            ref={buttonRef}
            type="button"
            variant="launcher"
            size="icon"
            aria-label={label}
            aria-expanded={!collapsed}
            onClick={onToggle}
            style={shift ? { transform: `translateX(-${shift}px)` } : undefined}
            className="absolute right-4 bottom-3 z-10"
          >
            {collapsed ? <PenLine className="size-4" /> : <ChevronsDown className="size-4" />}
            {collapsed && hasPendingDraft ? (
              // Why: a hidden draft is easy to forget; the dot says one is waiting.
              <span
                aria-hidden
                className="pointer-events-none absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-card dark:ring-accent"
              />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
