import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ChevronRight, Minus, Plus, X } from 'lucide-react-native'
import type Animated from 'react-native-reanimated'
import type { AnimatedRef, SharedValue } from 'react-native-reanimated'
import { CustomKeyModal, loadCustomKeys, saveCustomKeys, type CustomKey } from './CustomKeyModal'
import { DragReorderList } from './DragReorderList'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { terminalSettingsScreenStyles as baseStyles } from '../terminal/terminal-settings-screen-styles'
import {
  TERMINAL_ACCESSORY_KEYS,
  type TerminalAccessoryKey
} from '../terminal/terminal-accessory-keys'
import {
  MAX_TERMINAL_ACCESSORY_ROWS,
  MIN_TERMINAL_ACCESSORY_ROWS,
  ROW_DIVIDER_ID_PREFIX,
  getDefaultTerminalAccessoryLayout,
  loadTerminalAccessoryLayout,
  parseTerminalAccessoryReorderIds,
  reconcileTerminalAccessoryLayoutCustomKeys,
  saveTerminalAccessoryLayout,
  setTerminalAccessoryBuiltInVisible,
  setTerminalAccessoryRowCount,
  updateTerminalAccessoryRows,
  type TerminalAccessoryLayout
} from '../terminal/terminal-accessory-layout'

// Why: DragReorderList absolutely positions rows, so every row in a
// reorderable section must share one fixed height.
const REORDER_ROW_HEIGHT = 56

type UnifiedShortcutItem =
  | { kind: 'built-in'; id: string; shortcutKey: TerminalAccessoryKey }
  | { kind: 'custom'; id: string; customKey: CustomKey }
  | { kind: 'row-divider'; id: string; rowNumber: number }

function useSequencedStorage<T>(
  initial: T | (() => T),
  load: () => Promise<T>,
  save: (value: T) => Promise<void>
) {
  const [value, setValue] = useState<T>(initial)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const seqRef = useRef(0)
  const pendingRef = useRef(0)

  const commit = useCallback(
    (next: T, persist = true) => {
      seqRef.current += 1
      setValue(next)
      if (!persist) {
        return
      }
      pendingRef.current += 1
      chainRef.current = chainRef.current
        .catch(() => {})
        .then(() => save(next))
        .catch(() => {})
        .finally(() => {
          pendingRef.current -= 1
        })
    },
    [save]
  )

  const refresh = useCallback(() => {
    const refreshSeq = seqRef.current
    void load().then((loaded) => {
      if (pendingRef.current === 0 && refreshSeq === seqRef.current) {
        setValue(loaded)
      }
    })
  }, [load])

  return { value, commit, refresh }
}

type Props = {
  scrollRef: AnimatedRef<Animated.ScrollView>
  scrollOffsetY: SharedValue<number>
  scrollContentHeight: SharedValue<number>
  onDragActiveChange: (active: boolean) => void
}

export function TerminalShortcutSettings({
  scrollRef,
  scrollOffsetY,
  scrollContentHeight,
  onDragActiveChange
}: Props): React.JSX.Element {
  const [showCustomKeyModal, setShowCustomKeyModal] = useState(false)
  const layoutStore = useSequencedStorage<TerminalAccessoryLayout>(
    getDefaultTerminalAccessoryLayout,
    loadTerminalAccessoryLayout,
    saveTerminalAccessoryLayout
  )
  const customKeysStore = useSequencedStorage<CustomKey[]>([], loadCustomKeys, saveCustomKeys)
  const customKeys = customKeysStore.value

  const refreshAll = useCallback(() => {
    layoutStore.refresh()
    customKeysStore.refresh()
  }, [layoutStore.refresh, customKeysStore.refresh])

  useFocusEffect(refreshAll)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshAll()
      }
    })
    return () => sub.remove()
  }, [refreshAll])

  const effectiveLayout = useMemo(
    () =>
      reconcileTerminalAccessoryLayoutCustomKeys(
        layoutStore.value,
        customKeys.map((key) => key.id)
      ),
    [layoutStore.value, customKeys]
  )

  const syncCustomKeys = useCallback(
    (keys: CustomKey[], persistKeys = true) => {
      customKeysStore.commit(keys, persistKeys)
      layoutStore.commit(
        reconcileTerminalAccessoryLayoutCustomKeys(
          effectiveLayout,
          keys.map((k) => k.id)
        )
      )
    },
    [customKeysStore, effectiveLayout, layoutStore]
  )

  const handleUnifiedReorder = useCallback(
    (orderedIds: string[]) => {
      const nextRows = parseTerminalAccessoryReorderIds(orderedIds, effectiveLayout.rowCount)
      const nextLayout = updateTerminalAccessoryRows(effectiveLayout, nextRows)
      layoutStore.commit(nextLayout)
      const byId = new Map(customKeys.map((key) => [key.id, key]))
      const orderedCustomIds = nextLayout.rows.flat().filter((id) => byId.has(id))
      if (
        orderedCustomIds.length === customKeys.length &&
        !orderedCustomIds.every((id, index) => customKeys[index]?.id === id)
      ) {
        customKeysStore.commit(orderedCustomIds.flatMap((id) => byId.get(id) ?? []))
      }
    },
    [customKeys, customKeysStore, effectiveLayout, layoutStore]
  )

  const visibleBuiltInSet = useMemo(
    () => new Set(effectiveLayout.visibleBuiltInIds),
    [effectiveLayout.visibleBuiltInIds]
  )

  const unifiedItems = useMemo((): UnifiedShortcutItem[] => {
    const builtInById = new Map(TERMINAL_ACCESSORY_KEYS.map((key) => [key.id, key]))
    const customById = new Map(customKeys.map((key) => [key.id, key]))
    return effectiveLayout.rows.flatMap((rowIds, rowIndex) => {
      const divider: UnifiedShortcutItem[] =
        rowIndex > 0
          ? [
              {
                kind: 'row-divider',
                id: `${ROW_DIVIDER_ID_PREFIX}${rowIndex}__`,
                rowNumber: rowIndex + 1
              }
            ]
          : []
      const rowItems = rowIds.flatMap((id): UnifiedShortcutItem[] => {
        const builtIn = builtInById.get(id)
        const custom = customById.get(id)
        return builtIn
          ? [{ kind: 'built-in', id, shortcutKey: builtIn }]
          : custom
            ? [{ kind: 'custom', id, customKey: custom }]
            : []
      })
      return [...divider, ...rowItems]
    })
  }, [effectiveLayout.rows, customKeys])

  const canDecreaseRows = effectiveLayout.rowCount > MIN_TERMINAL_ACCESSORY_ROWS
  const canIncreaseRows = effectiveLayout.rowCount < MAX_TERMINAL_ACCESSORY_ROWS
  const renderStepButton = (delta: -1 | 1, enabled: boolean, label: string, Icon: typeof Minus) => (
    <Pressable
      style={({ pressed }) => [
        styles.stepperButton,
        pressed && enabled && styles.stepperButtonPressed,
        !enabled && styles.stepperButtonDisabled
      ]}
      disabled={!enabled}
      onPress={() =>
        layoutStore.commit(
          setTerminalAccessoryRowCount(effectiveLayout, effectiveLayout.rowCount + delta)
        )
      }
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={15} color={enabled ? colors.textPrimary : colors.textMuted} strokeWidth={2.2} />
    </Pressable>
  )

  return (
    <>
      <Text style={[baseStyles.groupHeading, baseStyles.inputGroupGap]}>SHORTCUT BAR</Text>
      <Text style={baseStyles.groupDescription}>
        Toggle keys to show or hide them, and hold the grip to drag built-in or custom shortcuts
        into any order or row on the terminal shortcut bar.
      </Text>
      <View style={[baseStyles.section, baseStyles.sectionTopGap]}>
        <View style={baseStyles.row}>
          <View style={baseStyles.rowContent}>
            <Text style={baseStyles.rowLabel}>Shortcut Rows</Text>
            <Text style={baseStyles.rowSublabel}>Stack shortcut keys across 1 to 4 rows</Text>
          </View>
          <View style={styles.stepper}>
            {renderStepButton(-1, canDecreaseRows, 'Decrease shortcut rows', Minus)}
            <Text style={styles.stepperValue}>{effectiveLayout.rowCount}</Text>
            {renderStepButton(1, canIncreaseRows, 'Increase shortcut rows', Plus)}
          </View>
        </View>
        <View style={baseStyles.separator} />
        {effectiveLayout.rowCount > 1 && (
          <>
            <View style={styles.rowDividerContent}>
              <Text style={styles.rowHeaderText}>ROW 1</Text>
            </View>
            <View style={baseStyles.separator} />
          </>
        )}
        <DragReorderList
          items={unifiedItems}
          itemKey={(item) => item.id}
          rowHeight={REORDER_ROW_HEIGHT}
          isItemDraggable={(item) => item.kind !== 'row-divider'}
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={onDragActiveChange}
          onReorder={handleUnifiedReorder}
          renderRow={(item) =>
            item.kind === 'row-divider' ? (
              <View style={styles.rowDividerContent}>
                <Text style={styles.rowHeaderText}>{`ROW ${item.rowNumber}`}</Text>
              </View>
            ) : (
              <View style={styles.reorderRowContent}>
                <View style={styles.keycap}>
                  <Text style={styles.keycapText}>
                    {item.kind === 'built-in' ? item.shortcutKey.label : item.customKey.label}
                  </Text>
                </View>
                <View style={baseStyles.rowContent}>
                  <Text style={baseStyles.rowLabel}>
                    {item.kind === 'built-in'
                      ? (item.shortcutKey.accessibilityLabel ?? item.shortcutKey.label)
                      : item.customKey.label}
                  </Text>
                  {item.kind === 'custom' && (
                    <Text style={baseStyles.rowSublabel} numberOfLines={1} ellipsizeMode="tail">
                      {item.customKey.bytes.replace(/\r/g, ' ↵')}
                    </Text>
                  )}
                </View>
                {item.kind === 'built-in' ? (
                  <Switch
                    value={visibleBuiltInSet.has(item.shortcutKey.id)}
                    onValueChange={(visible) =>
                      layoutStore.commit(
                        setTerminalAccessoryBuiltInVisible(
                          effectiveLayout,
                          item.shortcutKey.id,
                          visible
                        )
                      )
                    }
                    trackColor={{ false: colors.borderSubtle, true: colors.textSecondary }}
                    thumbColor={colors.textPrimary}
                  />
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.deleteButton,
                      pressed && styles.deleteButtonPressed
                    ]}
                    onPress={() => syncCustomKeys(customKeys.filter((k) => k.id !== item.id))}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.customKey.label}`}
                  >
                    <X size={16} color={colors.statusRed} />
                  </Pressable>
                )}
              </View>
            )
          }
        />
        <Pressable
          style={({ pressed }) => [baseStyles.row, pressed && baseStyles.rowPressed]}
          onPress={() => setShowCustomKeyModal(true)}
        >
          <View style={baseStyles.rowContent}>
            <Text style={baseStyles.rowLabel}>Add Custom Shortcut…</Text>
            <Text style={baseStyles.rowSublabel}>Create key combo or text macro</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
        <View style={baseStyles.separator} />
        <Pressable
          style={({ pressed }) => [baseStyles.row, pressed && baseStyles.rowPressed]}
          onPress={() =>
            layoutStore.commit(
              reconcileTerminalAccessoryLayoutCustomKeys(
                getDefaultTerminalAccessoryLayout(),
                customKeys.map((key) => key.id)
              )
            )
          }
        >
          <View style={baseStyles.rowContent}>
            <Text style={baseStyles.rowLabel}>Reset Defaults</Text>
            <Text style={baseStyles.rowSublabel}>
              Show every built-in shortcut key in the original order
            </Text>
          </View>
        </Pressable>
      </View>

      <CustomKeyModal
        visible={showCustomKeyModal}
        onClose={() => setShowCustomKeyModal(false)}
        onKeysChanged={(keys) => syncCustomKeys(keys, false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  reorderRowContent: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingLeft: spacing.md + 2
  },
  rowDividerContent: {
    height: REORDER_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.md + 2,
    backgroundColor: colors.bgBase
  },
  rowHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperButtonPressed: { backgroundColor: colors.borderSubtle },
  stepperButtonDisabled: { opacity: 0.35 },
  stepperValue: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: typography.monoFamily
  },
  keycap: {
    minWidth: 62,
    alignItems: 'center',
    backgroundColor: colors.bgRaised,
    borderRadius: radii.button,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  keycapText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)'
  },
  deleteButtonPressed: { backgroundColor: 'rgba(239, 68, 68, 0.2)' }
})
