import { useRef } from 'react'
import { MobilePairingPathOption } from '@/components/settings/MobilePairingPathOption'

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1
}

export type PlaneOption<T extends string> = { value: T; title: string; description: string }

// Why the bordered radio rows: both choices carry a title and a sentence, and neither may
// read as the default — a segmented control would shrink them to labels.
export function PlaneOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false
}: {
  label: string
  options: readonly PlaneOption<T>[]
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
}): React.JSX.Element {
  const optionRefs = useRef(new Map<T, HTMLDivElement>())
  const focusIndex = value === null ? 0 : options.findIndex((option) => option.value === value)

  const handleArrowKeys = (event: React.KeyboardEvent): void => {
    const step = ARROW_STEPS[event.key]
    if (!step || disabled) {
      return
    }
    event.preventDefault()
    const current = Math.max(0, focusIndex)
    const next = options[(current + step + options.length) % options.length]
    onChange(next.value)
    optionRefs.current.get(next.value)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleArrowKeys}
      className="overflow-hidden rounded-md border border-border"
    >
      {options.map((option, index) => (
        <MobilePairingPathOption
          key={option.value}
          selected={option.value === value}
          tabIndex={index === focusIndex ? 0 : -1}
          disabled={disabled}
          positionInSet={index + 1}
          setSize={options.length}
          optionRef={(element) => {
            if (element) {
              optionRefs.current.set(option.value, element)
            } else {
              optionRefs.current.delete(option.value)
            }
          }}
          onSelect={() => onChange(option.value)}
          title={option.title}
          description={option.description}
        />
      ))}
    </div>
  )
}
