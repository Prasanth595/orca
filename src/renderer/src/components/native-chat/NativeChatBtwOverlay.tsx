import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImeInput } from '@/lib/ime-text-field'
import { translate } from '@/i18n/i18n'
import type { NativeChatBtwState } from './use-native-chat-btw'

/** Ephemeral side-question card. It is not a transcript row. */
export function NativeChatBtwOverlay({
  state,
  onDismiss,
  onAsk,
  onDraftChange
}: {
  state: NativeChatBtwState
  onDismiss: () => void
  onAsk: (question: string) => void
  onDraftChange: (draft: string) => void
}): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!state.question) {
      inputRef.current?.focus()
    }
  }, [state.question])

  if (!state.open) {
    return null
  }

  const title = translate('components.native-chat.btw.title', 'By the way')
  const closeLabel = translate('components.native-chat.btw.close', 'Close')
  const placeholder = translate(
    'components.native-chat.btw.placeholder',
    'Ask a side question…'
  )
  const answering = translate('components.native-chat.btw.answering', 'Answering…')

  return (
    <div
      role="dialog"
      aria-label={title}
      data-native-chat-typing-redirect-ignore="true"
      data-native-chat-btw-overlay="true"
      className="absolute right-4 bottom-3 left-4 z-20 mx-auto max-w-lg rounded-lg border border-border bg-popover/95 p-3 text-popover-foreground shadow-floating backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          title={closeLabel}
          aria-label={closeLabel}
        >
          <X size={14} />
        </Button>
      </div>
      {state.question ? (
        <p className="mt-1 text-sm text-foreground">{state.question}</p>
      ) : (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault()
            onAsk(state.draft)
          }}
        >
          <ImeInput
            ref={inputRef}
            type="text"
            value={state.draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
      )}
      {state.status === 'loading' ? (
        <p className="mt-2 text-sm text-muted-foreground">{answering}</p>
      ) : null}
      {state.status === 'error' && state.error ? (
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.status === 'ready' && state.answer ? (
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
          {state.answer}
        </p>
      ) : null}
    </div>
  )
}
