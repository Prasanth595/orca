import { useMobileNativeChatOpenKeys } from './use-mobile-native-chat-open-keys'
import type {
  MobileNativeChatTurnRow,
  MobileNativeChatLiveLine
} from './mobile-native-chat-turn-disclosure-types'
export type {
  MobileNativeChatTurnRow,
  MobileNativeChatLiveLine
} from './mobile-native-chat-turn-disclosure-types'
import {
  mobileNativeChatTurnFold,
  mobileNativeChatActionablePromptIds,
  mobileNativeChatBridgeAnswerIds
} from './mobile-native-chat-turn-fold'
import { useCallback, useMemo } from 'react'
import { isSubagentGroupBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { nativeChatReasoningDisclosureKey } from '../../../src/shared/native-chat-reasoning-row'
import { nativeChatLiveLine } from '../../../src/shared/native-chat-live-line'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import {
  isNativeChatRowInLiveWorkingTurn,
  nativeChatTurnMembership,
  type NativeChatTurnJournal
} from '../../../src/shared/native-chat-turn-membership'
import { nativeChatMessagesWaitingBehindLiveTurn } from '../../../src/shared/native-chat-messages-waiting-behind-live-turn'
import { NATIVE_CHAT_STREAMING_ID } from '../../../src/shared/native-chat-streaming'
import type { NativeChatResolvedPrompt } from '../../../src/shared/native-chat-resolution-receipt'
import { useMobileNativeChatTranscriptRows } from './use-mobile-native-chat-transcript-rows'
import {
  nativeChatRowsInDrawOrder,
  nativeChatTurnBarRows
} from '../../../src/shared/native-chat-turn-grouping'
import {
  useMobileNativeChatTurnStatus,
  type NativeChatTurnStatus
} from './use-mobile-native-chat-turn-status'

const NO_TURN_KEYS: readonly undefined[] = []
/** Owns the transcript's per-turn status rows and their disclosure state, and
 *  resolves what one list row needs. Bridge-lane chats pass `enabled: false`: no turn
 *  rows, but the same live "Working…" line while the agent works. */
export function useMobileNativeChatTurnDisclosure({
  messages,
  enabled,
  isWorking,
  workingStartedAt,
  settledTurns,
  turnJournal = null,
  thinking = false,
  activityText = null,
  stopping = false,
  lineYields = false,
  scopeKey,
  processExpanded = false,
  actionablePromptIds,
  receipts
}: {
  processExpanded?: boolean
  actionablePromptIds?: readonly string[]
  messages: readonly NativeChatMessage[]
  enabled: boolean
  isWorking: boolean
  workingStartedAt?: number | null
  /** Host-recorded durations; they outrank whatever this client observed. */
  settledTurns?: NativeChatSettledTurns | null
  /** The journal that places each row in its turn; absent groups rows by position. */
  turnJournal?: NativeChatTurnJournal | null
  /** Whether the turn is reasoning right now, derived from its journal content. */
  thinking?: boolean
  /** What the provider says the live turn is doing; outranks the other labels. */
  activityText?: string | null
  /** A person's Stop is ending the live turn: the sends the host holds draw after its status. */
  stopping?: boolean
  /** A prompt the reader must answer replaces the live activity line. */
  lineYields?: boolean
  /** Resolved prompts by row; an approval's receipt does not move the agent past its run. */
  receipts?: ReadonlyMap<string, NativeChatResolvedPrompt> | null
  /** Host/worktree/tab identity for timing and disclosure isolation. */
  scopeKey: string
}): {
  active: NativeChatTurnStatus | null
  /** The live turn's provider activity copy, for the footer row. */
  activeActivityText: string | null
  onToggleTurn: (turnKey: string) => void
  resolveRow: (index: number, message: NativeChatMessage) => MobileNativeChatTurnRow
  /** The list's rows, in the order they draw, less those waiting behind the live turn. */
  listMessages: readonly NativeChatMessage[]
  /** Rows waiting behind the live turn, drawn after its live status. */
  waitingRows: readonly { item: NativeChatMessage; index: number }[]
  /** The live activity line, or null while the turn is idle or a prompt replaces it. */
  liveLine: MobileNativeChatLiveLine | null
  /** Stable for a given chat scope, so it never disturbs a row's memo. */
  onToggleReasoning: (key: string) => void
} {
  // Resolve each row's turn, which turn is live, and the order the rows draw in, once: from the
  // turn record when the host states scopes, else by journal order.
  const { rows, turnKeys, liveTurnKey } = useMemo(() => {
    if (!enabled) {
      return { rows: messages, turnKeys: NO_TURN_KEYS, liveTurnKey: undefined }
    }
    const membership = nativeChatTurnMembership(messages, turnJournal)
    return {
      rows: nativeChatRowsInDrawOrder(messages, membership.drawOrder),
      turnKeys: nativeChatRowsInDrawOrder(membership.turnKeys, membership.drawOrder),
      liveTurnKey: membership.liveTurnKey
    }
  }, [enabled, messages, turnJournal])
  // A message waiting behind the live turn draws after that turn's live status, not in the list.
  const waiting = useMemo(() => {
    const ids = enabled
      ? nativeChatMessagesWaitingBehindLiveTurn(
          rows,
          turnJournal?.items,
          stopping,
          turnJournal?.submissions,
          turnJournal ?? {}
        )
      : null
    if (!ids?.size) {
      return { listMessages: rows, waitingRows: [], indexById: null }
    }
    return {
      listMessages: rows.filter((message) => !ids.has(message.id)),
      waitingRows: rows.flatMap((item, index) => (ids.has(item.id) ? [{ item, index }] : [])),
      indexById: new Map(rows.map((message, index) => [message.id, index]))
    }
  }, [enabled, rows, stopping, turnJournal])
  const turnStatuses = useMobileNativeChatTurnStatus({
    turnKeys,
    liveTurnKey,
    enabled,
    isWorking,
    workingStartedAt,
    settledTurns,
    thinking,
    scopeKey
  })
  const [expandedTurnIds, toggleExpandedTurn] = useMobileNativeChatOpenKeys(scopeKey)
  const [expandedReasoning, toggleReasoning] = useMobileNativeChatOpenKeys(scopeKey)
  const [openSubagentGroups, toggleSubagentGroup] = useMobileNativeChatOpenKeys(scopeKey)
  const [openUserMessages, toggleUserMessage] = useMobileNativeChatOpenKeys(scopeKey)

  const { active, activeTurnKey, completedByTurn } = turnStatuses
  const presentation = useMemo(() => {
    if (!enabled) {
      return {
        listMessages: waiting.listMessages,
        indexById: null,
        answerIds: mobileNativeChatBridgeAnswerIds(rows, isWorking),
        foldedRows: new Set<number>(),
        foldableTurnKeys: new Set<string>(),
        bars: new Map<string, { index: number; above: boolean }>()
      }
    }
    const indexById = new Map(rows.map((row, index) => [row.id, index]))
    const fold = mobileNativeChatTurnFold(
      rows,
      turnKeys,
      completedByTurn,
      processExpanded ? new Set(turnKeys.filter((key) => key !== undefined)) : expandedTurnIds,
      mobileNativeChatActionablePromptIds(turnJournal, actionablePromptIds)
    )
    const bars = nativeChatTurnBarRows(rows, turnKeys)
    const anchors = new Set([...bars.values()].map((bar) => bar.index))
    const listMessages = waiting.listMessages.filter((row) => {
      const index = indexById.get(row.id)!
      return !fold.foldedRows.has(index) || anchors.has(index) || receipts?.has(row.id) === true
    })
    return {
      listMessages,
      indexById,
      answerIds: fold.answerIds,
      bars,
      foldedRows: fold.foldedRows,
      foldableTurnKeys: fold.foldableTurnKeys
    }
  }, [
    enabled,
    waiting,
    rows,
    turnKeys,
    completedByTurn,
    processExpanded,
    expandedTurnIds,
    isWorking,
    turnJournal,
    actionablePromptIds,
    receipts
  ])
  const inLiveWorkingTurn = useCallback(
    (index: number) =>
      isNativeChatRowInLiveWorkingTurn(turnKeys[index], liveTurnKey, enabled && isWorking),
    [enabled, isWorking, liveTurnKey, turnKeys]
  )
  const activeActivityText = enabled && isWorking ? (activityText ?? null) : null
  const line = useMemo(
    () =>
      nativeChatLiveLine({
        draws: isWorking && !lineYields && (!enabled || active !== null),
        thinking: active?.thinking === true,
        stopping,
        activityText: activeActivityText,
        messages: rows,
        inLiveWorkingTurn
      }),
    [active, activeActivityText, enabled, inLiveWorkingTurn, isWorking, lineYields, rows, stopping]
  )
  const liveReasoningId = line?.reasoning?.message.id
  const liveLine = useMemo<MobileNativeChatLiveLine | null>(
    () =>
      line && {
        ...line,
        reasoningExpanded:
          line.reasoning !== null &&
          expandedReasoning.has(nativeChatReasoningDisclosureKey(line.reasoning.message.id))
      },
    [expandedReasoning, line]
  )
  const { trailingRunIndex, workRuns } = useMobileNativeChatTranscriptRows({
    enabled,
    rows,
    turnKeys,
    receipts,
    completedByTurn,
    expandedTurnKeys: expandedTurnIds,
    liveReasoningId
  })
  const latestAssistantId = useMemo(
    () => waiting.listMessages.findLast((row) => row.role === 'assistant')?.id ?? null,
    [waiting.listMessages]
  )
  const resolveRow = useCallback(
    (listIndex: number, message: NativeChatMessage): MobileNativeChatTurnRow => {
      const index =
        presentation.indexById?.get(message.id) ?? waiting.indexById?.get(message.id) ?? listIndex
      const turnKey = turnKeys[index]
      const bar = turnKey === undefined ? undefined : presentation.bars.get(turnKey)
      // A turn's bar draws at its first row; the live turn's carries its running clock and settles
      // in place. A message folded into a turn (a steer) carries none.
      const turnStatus =
        enabled && turnKey !== undefined && bar?.index === index
          ? turnKey === activeTurnKey
            ? active
            : (completedByTurn[turnKey] ?? null)
          : null
      return {
        turnStatus,
        processHidden: presentation.foldedRows.has(index),
        finalReply: presentation.answerIds.has(message.id),
        ...(bar?.above === true && turnStatus !== null ? { turnStatusAbove: true } : {}),
        turnExpanded: processExpanded || (turnKey ? expandedTurnIds.has(turnKey) : false),
        // Why: the key travels and the row calls one stable handler with it. A
        // closure per row would be a new identity every render of a streaming
        // transcript, defeating the row's memo; caching one per turn would mean
        // writing a ref during render, which react-freeze can discard.
        // Offered only where the fold hides something, as on desktop.
        turnKey: turnKey && presentation.foldableTurnKeys.has(turnKey) ? turnKey : undefined,
        ...(presentation.foldedRows.has(index) ? { foldedAway: true } : {}),
        // With no user boundary at all, the session's working state stays authoritative. The bridge
        // lane has no turns: only its synthetic streaming row is known to be in the live one.
        activeTurnIsWorking: enabled
          ? inLiveWorkingTurn(index)
          : isWorking && message.id === NATIVE_CHAT_STREAMING_ID,
        trailingRun:
          index === trailingRunIndex ||
          (workRuns.heads.get(index)?.includes(rows[trailingRunIndex]!) ?? false),
        ...(workRuns.heads.has(index)
          ? { workRun: workRuns.heads.get(index), openReasoning: expandedReasoning }
          : {}),
        ...(workRuns.joined.has(index) ? { joinsWorkRun: true } : {}),
        mayStillGrow: !lineYields && message.id === latestAssistantId,
        reasoningIsLive: message.id === liveReasoningId,
        reasoningExpanded:
          message.role === 'reasoning' &&
          expandedReasoning.has(nativeChatReasoningDisclosureKey(message.id)),
        onToggleReasoning: toggleReasoning,
        ...(message.blocks.some(isSubagentGroupBlock)
          ? { subagentGroupsOpen: openSubagentGroups }
          : {}),
        onToggleSubagentGroup: toggleSubagentGroup,
        userMessageOpen: message.role === 'user' && openUserMessages.has(message.id),
        onToggleUserMessage: toggleUserMessage
      }
    },
    [
      turnKeys,
      waiting,
      presentation,
      processExpanded,
      isWorking,
      enabled,
      activeTurnKey,
      active,
      completedByTurn,
      expandedTurnIds,
      inLiveWorkingTurn,
      trailingRunIndex,
      workRuns,
      rows,
      latestAssistantId,
      lineYields,
      liveReasoningId,
      expandedReasoning,
      toggleReasoning,
      openSubagentGroups,
      toggleSubagentGroup,
      openUserMessages,
      toggleUserMessage
    ]
  )

  return {
    active,
    activeActivityText,
    /** Stable for a given chat scope, so it never disturbs a row's memo. */
    onToggleTurn: toggleExpandedTurn,
    resolveRow,
    listMessages: presentation.listMessages,
    waitingRows: waiting.waitingRows,
    liveLine,
    onToggleReasoning: toggleReasoning
  }
}
