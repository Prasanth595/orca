import { useCallback, useRef } from 'react'
import { measureElement, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { AutomationInboxRow } from './AutomationInboxRow'
import { useAutomationInbox } from './use-automation-inbox'
import type { ThreadReadFilter } from './activity-thread-types'

export function AutomationInboxSection({
  query,
  readFilter
}: {
  query: string
  readFilter: ThreadReadFilter
}): React.JSX.Element | null {
  const { items, open, change } = useAutomationInbox(query, readFilter)
  if (!items.length) {
    return null
  }
  return <AutomationInboxList items={items} open={open} change={change} />
}

function AutomationInboxList({
  items,
  open,
  change
}: Pick<ReturnType<typeof useAutomationInbox>, 'items' | 'open' | 'change'>): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const getItemKey = useCallback((index: number) => items[index]?.[0] ?? index, [items])
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    measureElement: (element, observerEntry, instance) => {
      const height = measureElement(element, observerEntry, instance)
      return height > 0 ? height : 128
    },
    estimateSize: () => 128,
    overscan: 3,
    useFlushSync: false,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) =>
        callback(rect.height ? rect : { width: 320, height: 256 })
      )
  })
  return (
    <section
      className="shrink-0 border-b border-border"
      aria-label={translate('auto.components.activity.automationInbox.title', 'Automation alerts')}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium">
        {translate('auto.components.activity.automationInbox.title', 'Automation alerts')}
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div ref={scrollRef} className="max-h-64 overflow-y-auto scrollbar-sleek">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index]
            if (!item) {
              return null
            }
            const [key, entry] = item
            return (
              <div
                key={key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <AutomationInboxRow
                  entry={entry}
                  onOpen={() => open(key)}
                  onChange={(action) => change([key], action)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
