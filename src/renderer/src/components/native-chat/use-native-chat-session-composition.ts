import { useMemo } from 'react'
import type { useNativeChatRetainedSession } from './use-native-chat-retained-session'
import { pendingSendsAsMessages, type NativeChatPendingSend } from './native-chat-pending'
import {
  commandMarkersAsMessages,
  type NativeChatCommandMarker
} from './native-chat-command-marker'
import {
  deriveNativeChatStreamingText,
  nativeChatStreamingMessage
} from '../../../../shared/native-chat-streaming'

type NativeChatSession = ReturnType<typeof useNativeChatRetainedSession>

export function useNativeChatSessionComposition(args: {
  sessionAfterCommandBoundaries: NativeChatSession
  pending: NativeChatPendingSend[]
  commandMarkers: NativeChatCommandMarker[]
  hookPreview: string | null | undefined
  liveWorking: boolean
  hookPreviewIsToolOutput: boolean
}): {
  pendingMessages: ReturnType<typeof pendingSendsAsMessages>
  streamingText: string | null
  sessionWithPending: NativeChatSession
} {
  const {
    sessionAfterCommandBoundaries,
    pending,
    commandMarkers,
    hookPreview,
    liveWorking,
    hookPreviewIsToolOutput
  } = args
  const pendingMessages = useMemo(
    () => pendingSendsAsMessages(pending, sessionAfterCommandBoundaries.messages),
    [pending, sessionAfterCommandBoundaries.messages]
  )
  const streamingText = useMemo(
    () =>
      deriveNativeChatStreamingText({
        messages:
          pendingMessages.length > 0
            ? [...sessionAfterCommandBoundaries.messages, ...pendingMessages]
            : sessionAfterCommandBoundaries.messages,
        previewText: hookPreview,
        working: liveWorking,
        previewIsToolOutput: hookPreviewIsToolOutput
      }),
    [
      sessionAfterCommandBoundaries.messages,
      pendingMessages,
      hookPreview,
      liveWorking,
      hookPreviewIsToolOutput
    ]
  )
  const sessionWithPending = useMemo<NativeChatSession>(() => {
    if (pending.length === 0 && commandMarkers.length === 0 && !streamingText) {
      return sessionAfterCommandBoundaries
    }
    return {
      ...sessionAfterCommandBoundaries,
      messages: [
        ...sessionAfterCommandBoundaries.messages,
        ...commandMarkersAsMessages(commandMarkers),
        ...(streamingText ? [nativeChatStreamingMessage(streamingText)] : []),
        ...pendingMessages
      ]
    }
  }, [sessionAfterCommandBoundaries, pending, pendingMessages, commandMarkers, streamingText])
  return { pendingMessages, streamingText, sessionWithPending }
}
