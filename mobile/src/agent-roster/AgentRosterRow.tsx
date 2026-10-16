import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import {
  agentDisplayLabel,
  agentDotState,
  agentRowTimeAt,
  formatTimeAgo
} from '../worktree/agent-row-display'
import { AgentStateDot } from '../components/AgentStateDot'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import type { AgentRosterEntry } from './agent-roster-entries'
import { agentRosterTitle } from './agent-roster-display'

type Props = {
  entry: AgentRosterEntry
  now: number
  onPress: (entry: AgentRosterEntry) => void
}

// One flat roster row: the agent line the sidebar renders, plus the workspace it belongs to — the
// pair a workspace-grouped list makes the user hunt for.
function AgentRosterRowComponent({ entry, now, onPress }: Props) {
  const worktreeLocation =
    entry.projectLabel === entry.worktreeLabel
      ? entry.projectLabel
      : `${entry.projectLabel}, ${entry.worktreeLabel}`
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agentRosterTitle(entry.agent)} in ${worktreeLocation}`}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, entry.unvisited && styles.titleUnvisited]} numberOfLines={1}>
          {agentRosterTitle(entry.agent)}
        </Text>
        <Text style={styles.project} numberOfLines={1}>
          · {entry.projectLabel}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <AgentStateDot state={agentDotState(entry.agent, now)} />
        {entry.agent.agentType ? (
          <MobileAgentIcon agentId={entry.agent.agentType} size={13} />
        ) : null}
        <Text
          style={[styles.summary, entry.unvisited && styles.summaryUnvisited]}
          numberOfLines={1}
        >
          {agentDisplayLabel(entry.agent, now)}
        </Text>
        <Text style={styles.time}>{formatTimeAgo(agentRowTimeAt(entry.agent), now)}</Text>
      </View>
      {entry.branchLabel ? (
        <Text style={styles.branch} numberOfLines={1}>
          {entry.branchLabel}
        </Text>
      ) : null}
    </Pressable>
  )
}

export const AgentRosterRow = memo(AgentRosterRowComponent)

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  title: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  titleUnvisited: {
    fontWeight: '700'
  },
  project: {
    maxWidth: '45%',
    flexShrink: 0,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 3
  },
  summary: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted
  },
  summaryUnvisited: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  time: {
    fontSize: 10,
    color: colors.textMuted
  },
  branch: {
    marginTop: 2,
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: typography.monoFamily
  }
})
