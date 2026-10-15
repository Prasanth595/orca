import type {
  MobileStructuredAgentStateArgs,
  MobileStructuredAgentState
} from './mobile-structured-agent-state-contract'
import { openTranscriptAfterHold, isSubscribeEvent } from './mobile-structured-chat-subscription'
import { structuredChatCache } from './mobile-chat-transcript-cache'
import { useMobileChatCheckpoint } from './use-mobile-chat-checkpoint'
import { reduceMobileChatHistory, type MobileChatHistoryState } from './mobile-chat-history-window'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isRootAgentJournalItem } from '../../../src/shared/agent-session-journal-producer'
import { readOlderStructuredChatHistory } from './mobile-structured-history-read'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import { structuredAgentSessionHolderId } from '../../../src/shared/structured-agent-session-holder'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  oldestStructuredAgentSessionCursor,
  type StructuredAgentSessionAction
} from '../../../src/shared/structured-agent-session-reducer'
import {
  agentSessionReadFailureRefusal,
  agentSessionReadFailureText,
  callAgentSession
} from './mobile-structured-agent-session-rpc'
import {
  NO_QUEUED_FEED,
  reduceMobileQueuePause,
  type QueuedFeed,
  reduceMobileQueuedMessageFeed
} from './mobile-structured-queued-message-feed'

const MAX_RETAINED_SESSION_STATES = 32

export function useMobileStructuredAgentState(
  args: MobileStructuredAgentStateArgs
): MobileStructuredAgentState {
  const { client, connected, enabled, sessionId, sessionKey } = args
  // Keep a bounded cache so offline tab switches select the right transcript
  // synchronously without growing for the lifetime of the app.
  const [sessionStates, setSessionStates] = useState<Map<string, MobileChatHistoryState>>(() => {
    const cached = client && sessionKey ? structuredChatCache.get(client, sessionKey) : null
    return new Map(cached && sessionKey ? [[sessionKey, cached]] : [])
  })
  const [queuedBySession, setQueuedBySession] = useState<Map<string, QueuedFeed>>(() => new Map())
  const cacheClient = useRef(client)
  if (cacheClient.current !== client) {
    cacheClient.current = client
    setSessionStates(new Map())
    setQueuedBySession(new Map())
  }
  const state =
    enabled && sessionKey
      ? (sessionStates.get(sessionKey) ??
        (client ? structuredChatCache.get(client, sessionKey) : null) ??
        EMPTY_STRUCTURED_AGENT_SESSION)
      : EMPTY_STRUCTURED_AGENT_SESSION
  const { messages: queuedMessages, pause: queuePause } =
    (enabled && sessionKey ? queuedBySession.get(sessionKey) : undefined) ?? NO_QUEUED_FEED
  const [loadingOlder, setLoadingOlder] = useState(false)
  const olderReadGeneration = useRef<number | null>(null)
  const stateRef = useRef(state)
  const sessionKeyRef = useRef(sessionKey)
  const streamGenerationRef = useRef(0)
  useLayoutEffect(() => {
    stateRef.current = state
    sessionKeyRef.current = sessionKey
  }, [sessionKey, state])

  const apply = useCallback(
    (action: StructuredAgentSessionAction) => {
      if (!sessionKey) {
        return
      }
      setSessionStates((current) => {
        const previous =
          current.get(sessionKey) ??
          (client ? structuredChatCache.get(client, sessionKey) : null) ??
          EMPTY_STRUCTURED_AGENT_SESSION
        const next = reduceMobileChatHistory(previous, action)
        if (next === previous) {
          return current
        }
        const updated = new Map(current)
        updated.delete(sessionKey)
        updated.set(sessionKey, next)
        while (updated.size > MAX_RETAINED_SESSION_STATES) {
          const oldest = updated.keys().next().value
          if (oldest === undefined) {
            break
          }
          updated.delete(oldest)
        }
        return updated
      })
    },
    [client, sessionKey]
  )
  // The refusal rides beside its words, so the view can tell a failure no retry gets past.
  const applyReadFailure = useCallback(
    (failure: unknown) => {
      const refusal = agentSessionReadFailureRefusal(failure)
      apply({
        type: 'error',
        message: agentSessionReadFailureText(failure),
        ...(refusal ? { refusal } : {})
      })
    },
    [apply]
  )

  const applyQueued = useCallback(
    (event: AgentSessionSubscribeEvent) => {
      if (!sessionKey) {
        return
      }
      setQueuedBySession((current) => {
        const previous = current.get(sessionKey) ?? NO_QUEUED_FEED
        const messages = reduceMobileQueuedMessageFeed(previous.messages, event)
        const pause = reduceMobileQueuePause(previous.pause, event)
        if (messages === previous.messages && pause === previous.pause) {
          return current
        }
        const updated = new Map(current)
        updated.delete(sessionKey)
        updated.set(sessionKey, { messages, pause })
        while (updated.size > MAX_RETAINED_SESSION_STATES) {
          const oldest = updated.keys().next().value
          if (oldest === undefined) {
            break
          }
          updated.delete(oldest)
        }
        return updated
      })
    },
    [sessionKey]
  )

  useEffect(() => {
    streamGenerationRef.current += 1
    sessionKeyRef.current = sessionKey
    setLoadingOlder(false)
    if (!client || !sessionId || !enabled) {
      return
    }
    if (!connected) {
      // The cleanup above drops the dead hold and stream; keyed state keeps this
      // session's transcript visible while another tab can be selected.
      return
    }
    let cancelled = false
    void structuredChatCache.restore(client, sessionKey ?? '').then((cached) => {
      if (!cancelled && cached) {
        setSessionStates((previous) =>
          previous.get(sessionKey ?? '')?.items.length ||
          previous.get(sessionKey ?? '')?.fence != null
            ? previous
            : new Map(previous).set(sessionKey ?? '', { ...cached, fence: null, status: 'loading' })
        )
      }
    })
    setSessionStates((previous) => {
      const next = new Map(previous)
      const current = next.get(sessionKey ?? '')
      if (current) {
        next.set(sessionKey ?? '', { ...current, fence: null })
      }
      return next
    })
    apply({ type: 'loading' })
    const holderId = structuredAgentSessionHolderId('mobile-chat')
    const held = callAgentSession(client, 'agentSession.hold', {
      sessionId,
      holderId
    })
    const resumeCursor = sessionStates.get(sessionKey ?? '')?.cursor
    const endStream = openTranscriptAfterHold(
      client,
      sessionId,
      held,
      (raw) => {
        if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'error') {
          applyReadFailure(raw)
          return
        }
        if (isSubscribeEvent(raw)) {
          apply({ type: 'event', event: raw })
          applyQueued(raw)
        }
      },
      resumeCursor
    )
    return () => {
      cancelled = true
      endStream()
      void held
        .then(() =>
          callAgentSession(
            client,
            'agentSession.release',
            {
              sessionId,
              holderId
            },
            undefined,
            { failWhenDisconnected: true }
          ).catch(() => undefined)
        )
        .catch(() => undefined)
    }
  }, [apply, applyQueued, applyReadFailure, client, connected, enabled, sessionId, sessionKey])

  useMobileChatCheckpoint(() => {
    if (client && sessionKey && state.epoch) {
      structuredChatCache.set(client, sessionKey, { ...state, fence: null })
    }
  })

  const loadEarlier = useCallback(() => {
    const current = stateRef.current
    if (
      !client ||
      !sessionId ||
      !sessionKey ||
      sessionKeyRef.current !== sessionKey ||
      loadingOlder ||
      olderReadGeneration.current === streamGenerationRef.current ||
      !current.hasOlder
    ) {
      return
    }
    if (!oldestStructuredAgentSessionCursor(current)) {
      return
    }
    const requestSessionKey = sessionKey
    const requestGeneration = streamGenerationRef.current
    const isCurrentRead = (): boolean =>
      sessionKeyRef.current === requestSessionKey &&
      streamGenerationRef.current === requestGeneration
    olderReadGeneration.current = requestGeneration
    setLoadingOlder(true)
    void readOlderStructuredChatHistory({ client, sessionId, stateRef, isCurrentRead, apply })
      .catch((error: unknown) => {
        if (isCurrentRead()) {
          applyReadFailure(error)
        }
      })
      .finally(() => {
        if (isCurrentRead()) {
          olderReadGeneration.current = null
          setLoadingOlder(false)
        }
      })
  }, [apply, applyReadFailure, client, loadingOlder, sessionId, sessionKey])

  // A window of only a subagent's rows draws nothing, and an empty list cannot be scrolled
  // to ask for more, so it reads back once from each such head. A first page can be one: an
  // older host's for any burst, a current host's when a burst fills its byte bound.
  const drawsNothingFrom =
    state.status === 'ready' && state.hasOlder && !state.items.some(isRootAgentJournalItem)
      ? `${sessionKey}:${state.epoch}:${state.items[0]?.sequence}`
      : null
  const readBackFromRef = useRef<string | null>(null)
  useEffect(() => {
    if (drawsNothingFrom === null || loadingOlder || readBackFromRef.current === drawsNothingFrom) {
      return
    }
    readBackFromRef.current = drawsNothingFrom
    loadEarlier()
  }, [drawsNothingFrom, loadEarlier, loadingOlder])

  return { state, stateRef, queuedMessages, queuePause, loadingOlder, loadEarlier }
}
