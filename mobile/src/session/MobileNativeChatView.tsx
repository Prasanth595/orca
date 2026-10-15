import { useMobileTheme } from '../theme/use-mobile-theme'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { ArrowDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-native-chat-view-styles'
import { mobileNativeChatListFooter } from './mobile-native-chat-list-footer'
import { mobileNativeChatListHeader } from './mobile-native-chat-list-header'
import {
  buildMobileNativeChatTransientData,
  mobileNativeChatEmptyState
} from './mobile-native-chat-render-data'
import { useMobileNativeChatPageHistory } from './use-mobile-native-chat-page-history'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import {
  mobileNativeChatRowAnchor,
  useMobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import {
  mobileNativeChatComposerPlaceholder,
  useSettledMobileNativeChatInputLock
} from './use-mobile-native-chat-input-lease'
import { MobileNativeChatLiveLine } from './MobileNativeChatLiveLine'
import { MobileNativeChatStopButton } from './MobileNativeChatStopButton'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { NO_COMPOSER_TRAY } from './use-mobile-native-chat-composer-tray'
import { MobileNativeChatRefreshStatus } from './MobileNativeChatRefreshStatus'
import { MobileNativeChatLoading } from './MobileNativeChatLoading'
import { MobileNativeChatScrollHold } from './MobileNativeChatScrollHold'
import { useMobileNativeChatRowRenderer } from './use-mobile-native-chat-row-renderer'

export type { MobileNativeChatInputLockReason } from './mobile-native-chat-view-contract'
import type { MobileNativeChatViewProps as Props } from './mobile-native-chat-view-contract'

export function MobileNativeChatView({
  messages,
  folded,
  status,
  error,
  readFailedFinally = false,
  agent,
  agentWorking,
  canStop = agentWorking,
  structuredActivityUi = false,
  turnIndicator = null,
  workingStartedAt,
  settledTurns,
  turnJournal = null,
  receipts = null,
  actionablePromptIds,
  onStop,
  streaming,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  pending,
  imagePreviewsByMessageId,
  composerText,
  onComposerTextChange,
  onAttachImage,
  attachments,
  onRemoveAttachment,
  isAttaching,
  onMicPress,
  micActive,
  dictationMode,
  onMicPressIn,
  onMicPressOut,
  inputLockReason,
  sendErrorMessage,
  onClearSendError,
  filePaths,
  onNeedFiles,
  sessionOptions,
  ask,
  askKey,
  onDismissAsk,
  onAnswerAsk,
  onCancelAsk,
  onCancelPrompt,
  onCollapseAsk,
  onCollapsePrompt,
  collapsedPrompt,
  question,
  onAnswerQuestion,
  permission,
  promptKey,
  onRespondPermission,
  composerTray: { content: trayContent, composerInputRef: inputRef } = NO_COMPOSER_TRAY,
  onOpenFile,
  keyboardInset = 0
}: Props): React.JSX.Element {
  useMobileTheme()

  const insets = useSafeAreaInsets()
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom
  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()

  // `data` is the list source: folded transcript + synthetic streaming bubble +
  // route-owned accepted echoes. Memoize on the same deps so the
  // downstream autoscroll effects/`renderItem` keep referential stability.
  const { data } = useMemo(
    () =>
      buildMobileNativeChatTransientData({
        messages,
        folded,
        streaming,
        pending,
        imagePreviewsByMessageId
      }),
    [messages, folded, streaming, pending, imagePreviewsByMessageId]
  )
  const {
    listRef,
    initialPositionReady,
    showJumpToTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    readerIsScrolling,
    recordScrollMetrics
  } = useMobileNativeChatTailFollow<NativeChatMessage>({
    hasItems: data.length > 0,
    scopeKey: sendSurfaceId
  })

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const accepted = await onSend(text)
      if (!accepted) {
        return false
      }
      // The route-owned banner outlives this send; a success must retire it too,
      // or a stale "Message not sent" sits above the delivered message.
      onClearSendError?.()
      // Always jump to the newest message when the user sends.
      jumpToTail()
      return true
    },
    [onSend, onClearSendError, jumpToTail]
  )

  const loadEarlier = useCallback(() => onLoadEarlier?.(), [onLoadEarlier])
  const historyRequestedDuringDrag = useRef(false)
  const onScrollBeginDrag = useCallback(() => {
    historyRequestedDuringDrag.current = false
    beginUserScroll()
  }, [beginUserScroll])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = e.nativeEvent
      recordScrollMetrics(e.nativeEvent)
      // Near the top — page in older history. Only the reader's scroll: a pin reports offsets too.
      if (contentOffset.y < 60 && hasMore && !loadingEarlier && readerIsScrolling()) {
        historyRequestedDuringDrag.current = true
        loadEarlier()
      }
    },
    [hasMore, loadingEarlier, loadEarlier, readerIsScrolling, recordScrollMetrics]
  )

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (historyRequestedDuringDrag.current) {
        recordScrollMetrics(event.nativeEvent)
      } else {
        onScroll(event)
      }
      endUserDrag(event)
    },
    [onScroll, endUserDrag, recordScrollMetrics]
  )

  // Per-turn status rows: one live indicator while the turn runs, then a settled
  // "Worked for N" row. The structured lane owns them; the bridge lane keeps its
  // three-dot indicator.
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    processExpanded: toolsExpanded,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
    workingStartedAt,
    settledTurns,
    turnJournal,
    thinking: turnIndicator?.thinking === true,
    activityText: turnIndicator?.activityText ?? null,
    // The display status, decided once in the session hook.
    stopping: turnIndicator?.stopping === true,
    lineYields: structuredActivityUi && (ask != null || permission != null || question != null),
    scopeKey: sendSurfaceId
  })

  const renderItem = useMobileNativeChatRowRenderer({
    toolsExpanded,
    fontScale,
    onOpenFile,
    structuredActivityUi,
    turns,
    turnJournal,
    agent,
    receipts,
    actionablePromptIds
  })

  const history = useMobileNativeChatPageHistory(turns.listMessages, renderItem)

  const liveStatus = turns.liveLine ? (
    <MobileNativeChatLiveLine
      line={turns.liveLine}
      onToggleReasoning={turns.onToggleReasoning}
      fontScale={fontScale}
      onOpenFile={onOpenFile}
    />
  ) : null

  const emptyState = mobileNativeChatEmptyState(status, agent ?? null, error)

  const lockReason = useSettledMobileNativeChatInputLock(inputLockReason)
  // Why only Send, terminal-backed only: that send types into the agent's prompt and can answer it,
  // while drafting never does; the host queues a structured send behind it.
  const expandedPromptOwnsSend =
    !structuredActivityUi && !collapsedPrompt && (ask ?? permission ?? question) != null
  const emptyStateView = emptyState ? (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{emptyState.title}</Text>
      <Text style={styles.emptySubtitle}>{emptyState.subtitle}</Text>
    </View>
  ) : null

  // Whatever was already on screen: nothing here can act on a chat that cannot load, and its words
  // say why once, as a fresh open's do.
  if (readFailedFinally && emptyStateView) {
    return <View style={[styles.root, { paddingBottom: bottomPad }]}>{emptyStateView}</View>
  }

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {messages.length > 0 ? <MobileNativeChatRefreshStatus status={status} error={error} /> : null}
      {status === 'loading' && messages.length === 0 ? (
        <MobileNativeChatLoading />
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <MobileNativeChatScrollHold headKey={turns.listMessages[0]?.id} listRef={listRef} />
          <GestureDetector gesture={pinchGesture}>
            <FlatList
              key={sendSurfaceId}
              ref={listRef}
              initialNumToRender={history.listRows.length}
              style={data.length > 0 && !initialPositionReady ? { opacity: 0 } : undefined}
              accessibilityElementsHidden={data.length > 0 && !initialPositionReady}
              importantForAccessibility={
                data.length > 0 && !initialPositionReady ? 'no-hide-descendants' : 'auto'
              }
              data={history.listRows}
              keyExtractor={(item) => item.id}
              renderItem={history.renderListRow}
              contentContainerStyle={styles.listContent}
              // Let link/file taps land while the composer keyboard is up
              // instead of being swallowed by the dismiss gesture.
              keyboardShouldPersistTaps="handled"
              onRefresh={hasMore ? loadEarlier : undefined}
              refreshing={loadingEarlier === true}
              onScroll={onScroll}
              onScrollBeginDrag={onScrollBeginDrag}
              onScrollEndDrag={onScrollEndDrag}
              onMomentumScrollBegin={beginMomentum}
              onMomentumScrollEnd={endMomentum}
              scrollEventThrottle={32}
              onContentSizeChange={pinToTailAfterContentResize}
              onLayout={pinToTail}
              maintainVisibleContentPosition={
                initialPositionReady ? mobileNativeChatRowAnchor(hasMore === true) : undefined
              }
              ListHeaderComponent={history.withHistory(
                mobileNativeChatListHeader(hasMore, loadingEarlier, loadEarlier)
              )}
              ListFooterComponent={mobileNativeChatListFooter(
                liveStatus,
                turns.waitingRows,
                renderItem
              )}
              ListEmptyComponent={emptyStateView}
            />
          </GestureDetector>
          {data.length > 0 && !initialPositionReady ? <MobileNativeChatLoading restoring /> : null}
          {/* Jump-to-latest control. */}
          {showJumpToTail ? (
            <Pressable
              accessibilityLabel="Scroll to latest"
              style={[styles.fab, styles.fabBottom]}
              onPress={jumpToTail}
            >
              <ArrowDown size={18} color={colors.textPrimary} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </GestureHandlerRootView>
      )}
      {trayContent}
      <MobileNativeChatPromptCard
        key={promptKey ?? undefined}
        {...{ ask, askKey, onDismissAsk, onAnswerAsk, onCancelAsk, onCancelPrompt, onCollapseAsk }}
        {...{ permission, onRespondPermission, question, onAnswerQuestion, onCollapsePrompt }}
        collapsedPrompt={collapsedPrompt}
      />
      <View style={styles.chromeRow}>
        <View style={styles.chromeLeft}>
          {agentWorking && !structuredActivityUi ? <MobileAgentWorkingIndicator /> : null}
          <Pressable
            style={({ pressed }) => [styles.chromeToggle, pressed && styles.pressed]}
            onPress={() => setToolsExpanded((v) => !v)}
            hitSlop={8}
          >
            {toolsExpanded ? (
              <ChevronsDownUp size={14} color={colors.textMuted} strokeWidth={2} />
            ) : (
              <ChevronsUpDown size={14} color={colors.textMuted} strokeWidth={2} />
            )}
            <Text style={styles.chromeToggleLabel}>
              {toolsExpanded ? 'Collapse' : structuredActivityUi ? 'Process' : 'Tools'}
            </Text>
          </Pressable>
        </View>
        {canStop ? (
          // Only this phone's own request holds Stop: a repeat is how a stuck stop escalates.
          <MobileNativeChatStopButton
            onStop={onStop}
            held={agentWorking === true && turnIndicator?.stopRequestInFlight === true}
          />
        ) : null}
      </View>
      {sendErrorMessage ? (
        // This banner is the only channel for a send failure — announce it.
        <View
          style={styles.sendError}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.sendErrorText}>{sendErrorMessage}</Text>
        </View>
      ) : null}
      <MobileNativeChatComposer
        structuredCommands={
          structuredActivityUi ? (sessionOptions?.controller.conversationCommands ?? []) : undefined
        }
        value={composerText}
        onChangeText={onComposerTextChange}
        onSend={handleSend}
        sendSurfaceId={sendSurfaceId}
        {...{ getSendCompletionGeneration, getComposerEditGeneration, inputRef }}
        agent={agent}
        sessionOptions={sessionOptions}
        onAttachImage={onAttachImage}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        isAttaching={isAttaching}
        onMicPress={onMicPress}
        micActive={micActive}
        dictationMode={dictationMode}
        onMicPressIn={onMicPressIn}
        onMicPressOut={onMicPressOut}
        disabled={lockReason !== null}
        sendDisabled={expandedPromptOwnsSend}
        placeholder={mobileNativeChatComposerPlaceholder(lockReason, turnIndicator?.afterStop)}
        filePaths={filePaths}
        onNeedFiles={onNeedFiles}
      />
    </View>
  )
}
