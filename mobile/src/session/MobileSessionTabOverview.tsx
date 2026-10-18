import { useEffect } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { AgentStateDot } from '../components/AgentStateDot'
import { useNow } from '../hooks/use-now'
import { useBackClaim } from '../navigation/use-back-claim'
import { triggerMediumImpact, triggerSelection } from '../platform/haptics'
import { colors } from '../theme/mobile-theme'
import { MobileSessionTabIcon } from './MobileSessionTabIcon'
import {
  buildMobileSessionTabOverviewRows,
  type MobileSessionTabOverviewRow
} from './mobile-session-tab-overview-rows'
import { tabOverviewStyles as styles } from './mobile-session-tab-overview-styles'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useMobileSessionTabOverviewAgentText } from './use-mobile-session-tab-overview-agent-text'
import { getMobileSessionTabTitle } from './mobile-terminal-tab-agent'
import type { MobileSessionTab } from './mobile-session-route-types'

const agentStateKeyOf = (tabs: readonly MobileSessionTab[]) =>
  tabs
    .map((tab) =>
      tab.type === 'terminal' && tab.agentStatus
        ? `${tab.agentStatus.paneKey}:${tab.agentStatus.state}:${tab.agentStatus.stateStartedAt}`
        : ''
    )
    .join('|')

/**
 * The tab strip's expanded form: every session tab on its own full-width row, so a long title
 * reads in full, with its agent's state, how long it has held it, and its last words below. A row
 * opens its tab and folds the list; its X closes the tab and keeps the list.
 */
export function MobileSessionTabOverview({ controller }: { controller: MobileSessionController }) {
  const {
    client,
    connState,
    hostId,
    worktreeId,
    visibleTabs,
    showTabOverview,
    setShowTabOverview,
    activeSessionTabId,
    markdownDocs,
    keyboardLift,
    switchSessionTab,
    handleCloseSessionTab,
    openSessionTabActionSheetAfterKeyboardDismiss
  } = controller
  const tabTitles = new Map(visibleTabs.map((tab) => [tab.id, getMobileSessionTabTitle(tab)]))
  const insets = useSafeAreaInsets()
  const open = showTabOverview && visibleTabs.length > 0
  // Ticks only while open, so a long-silent agent decays to idle as it does in the worktree list.
  const now = useNow(30_000, open)
  const agentText = useMobileSessionTabOverviewAgentText({
    client,
    connState,
    hostId,
    worktreeId,
    open,
    agentStateKey: agentStateKeyOf(visibleTabs)
  })
  useBackClaim(
    open
      ? () => {
          setShowTabOverview(false)
          return true
        }
      : null
  )
  useEffect(() => {
    // Folds a list whose last tab closed, so the next tab to appear does not reopen it.
    if (showTabOverview && visibleTabs.length === 0) {
      setShowTabOverview(false)
    }
  }, [showTabOverview, visibleTabs.length])
  if (!open) {
    return null
  }
  const rows = buildMobileSessionTabOverviewRows({
    tabs: visibleTabs,
    titles: tabTitles,
    activeTabId: activeSessionTabId,
    markdownDocs,
    agentText,
    now
  })
  const showsAgentState = rows.some((row) => row.agent !== null)
  // keyboardLift excludes the home indicator on iOS; adding it back clears the keyboard itself.
  const bottomInset = keyboardLift + insets.bottom

  const renderRow = (row: MobileSessionTabOverviewRow, index: number) => (
    <View key={row.tab.id}>
      {index > 0 && <View style={styles.separator} />}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.agent ? `${row.title}, ${row.agent.label}` : row.title}
        accessibilityState={{ selected: row.active }}
        style={({ pressed }) => [
          styles.row,
          (row.agent !== null || row.detail !== null) && styles.rowMultiline,
          pressed && styles.rowPressed,
          row.active && styles.rowActive
        ]}
        onPress={() => {
          setShowTabOverview(false)
          switchSessionTab(row.tab)
        }}
        onLongPress={() => {
          triggerMediumImpact()
          openSessionTabActionSheetAfterKeyboardDismiss(row.tab)
        }}
        delayLongPress={400}
      >
        <View style={styles.marks}>
          {showsAgentState && (
            <View style={styles.markSlot}>
              {row.agent && <AgentStateDot state={row.agent.state} />}
            </View>
          )}
          <View style={styles.markSlot}>
            <MobileSessionTabIcon tab={row.tab} />
          </View>
        </View>
        <View style={styles.body}>
          {/* hangul-word: a wrapped Korean title breaks between words, not inside one. */}
          <Text
            style={[styles.title, row.active && styles.titleActive]}
            numberOfLines={2}
            lineBreakStrategyIOS="hangul-word"
          >
            {row.title}
          </Text>
          {row.agent && (
            <Text style={styles.status} numberOfLines={1}>
              <Text style={styles.statusLabel}>{row.agent.label}</Text>
              {row.agent.since !== null && ` · ${row.agent.since}`}
            </Text>
          )}
          {row.detail !== null && (
            <Text style={styles.detail} numberOfLines={3} lineBreakStrategyIOS="hangul-word">
              {row.detail}
            </Text>
          )}
        </View>
        {row.hasUnsavedEdits ? (
          <View style={styles.unsavedMark} accessibilityLabel="Unsaved changes">
            <View style={styles.unsavedDot} />
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Close ${row.title}`}
            onPress={() => {
              triggerSelection()
              void handleCloseSessionTab(row.tab)
            }}
          >
            <X size={16} color={colors.textMuted} strokeWidth={2.2} />
          </Pressable>
        )}
      </Pressable>
    </View>
  )

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.backdrop}
        accessibilityLabel="Dismiss tab list"
        onPress={() => setShowTabOverview(false)}
      />
      <View style={[styles.column, { paddingBottom: bottomInset }]} pointerEvents="box-none">
        <View style={styles.panel}>
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="All tabs"
          >
            {rows.map(renderRow)}
          </ScrollView>
        </View>
      </View>
    </View>
  )
}
