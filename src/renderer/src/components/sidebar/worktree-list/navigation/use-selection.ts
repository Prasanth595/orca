import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type React from 'react'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../../../shared/worktree/host-qualified-identity'
import type { HostSectionRow } from '../../host-section-rows'
import type { PinnedWorktreeDisplayPolicy } from '../grouping/row-types'
import { getRenderedWorktreesInSidebarOrder } from '../../worktree-sidebar-row-preference'
import { setVisibleWorktreeIds, setVisibleWorktreeShortcutTargets } from '../../visible-worktrees'
import { useListMultiSelection } from '@/hooks/use-list-multi-selection'
import { useReusedArrayIdentity } from '../listing/use-reused-array-identity'

const getSidebarContainer = (): Element | null =>
  document.querySelector('[data-worktree-sidebar-container]')

// Multi-select over the rows the sidebar actually rendered, so gestures, context menus, and
// the Cmd+1–9 shortcut cache all agree on one order.
export function useSidebarWorktreeSelection(args: {
  sectionRows: HostSectionRow[]
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  /** The workspace whose card renders as active; null in full-page views. */
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: ExecutionHostId | null
}) {
  const { sectionRows, pinnedDisplayPolicy, activeWorktreeId, activeWorkspaceExecutionHostId } =
    args
  // Why: derive order from the built rows, not the flat worktrees array, so Cmd+1–9 match visual positions when grouping reorders cards.
  const renderedWorktrees = useMemo(
    () => getRenderedWorktreesInSidebarOrder(sectionRows, pinnedDisplayPolicy),
    [pinnedDisplayPolicy, sectionRows]
  )
  const renderedWorktreeIds = useReusedArrayIdentity(
    useMemo(
      () => Array.from(new Set(renderedWorktrees.map((worktree) => worktree.id))),
      [renderedWorktrees]
    )
  )
  const selection = useListMultiSelection({
    items: renderedWorktrees,
    getKey: getWorktreeHostIdentity,
    getScope: getSidebarContainer
  })
  const {
    visibleKeys: renderedWorktreeIdentities,
    selectForContextMenu: selectItemForContextMenu,
    selectOnly
  } = selection
  // Why keep the event arg: kanban and list cards share the onContextMenuSelect prop shape.
  const selectForContextMenu = useCallback(
    (_event: React.MouseEvent<HTMLElement>, worktree: Worktree): readonly Worktree[] =>
      selectItemForContextMenu(worktree),
    [selectItemForContextMenu]
  )

  // Resolved in the vocabulary the rows themselves carry, which is not always the one the
  // store names: activation resolves a host even for a local row, while withRepoHostOwnership
  // leaves that row unqualified. Composing the resolved host would publish an identity no row
  // has, and the render-phase prune would then drop the selection outright.
  const activeIdentity = useMemo(() => {
    if (!activeWorktreeId) {
      return null
    }
    if (activeWorkspaceExecutionHostId) {
      // Only when a row actually carries it — that is what disambiguates one id across hosts.
      const composed = composeWorktreeHostIdentity(activeWorkspaceExecutionHostId, activeWorktreeId)
      if (renderedWorktreeIdentities.includes(composed)) {
        return composed
      }
    }
    const activeWorktree = renderedWorktrees.find((worktree) => worktree.id === activeWorktreeId)
    return activeWorktree ? getWorktreeHostIdentity(activeWorktree) : null
  }, [
    activeWorktreeId,
    activeWorkspaceExecutionHostId,
    renderedWorktreeIdentities,
    renderedWorktrees
  ])

  // Keyed on the activation rather than on the resolved identity: the identity also goes null
  // when a filter or a collapsed group hides the active row, and a null there must not read as
  // "nothing has been activated yet".
  const activationKey = activeWorktreeId
    ? composeWorktreeHostIdentity(activeWorkspaceExecutionHostId ?? undefined, activeWorktreeId)
    : null
  // What was last activated, and which identity was last written into the selection.
  // The flag is only meaningful once an identity has been adopted: it carries a move that
  // could not be written yet, which comparing those two values cannot express.
  const observedActivation = useRef<string | null | undefined>(undefined)
  const publishedIdentity = useRef<string | null>(null)
  const moveAwaitingPublish = useRef(false)
  // Why this exists: only mouse gestures ever wrote the selection, so activating a workspace
  // any other way (keyboard cycling, Cmd+digit, the palette, history) left the ring on the
  // card the user last clicked. A plain click activates *and* replaces the selection; every
  // other activation now agrees with it.
  //
  // Why a layout effect: an effect after paint would show the previous card's ring for a frame.
  useLayoutEffect(() => {
    // The store starts with no active workspace and hydration restores one after this hook
    // mounts, so nothing before the first adopted identity counts as a move. No flag check
    // here: the flag is only ever set below, under `!inStartup`, so it cannot be true while
    // no identity has been adopted.
    const inStartup = publishedIdentity.current === null
    const previousActivation = observedActivation.current
    observedActivation.current = activationKey
    if (!inStartup && previousActivation !== undefined && previousActivation !== activationKey) {
      // Remembered even when it cannot be published yet: a round trip through a workspace whose
      // row is hidden ends on the identity it started from, and only this flag still knows the
      // user moved twice.
      moveAwaitingPublish.current = true
    }
    if (!activeIdentity) {
      // Nothing is active, or a filter or a collapsed group hides the active row. A move waits.
      return
    }
    if (inStartup) {
      // Adopt what hydration restored without selecting it, so Cmd+click is not armed from a
      // card nobody picked.
      publishedIdentity.current = activeIdentity
      return
    }
    // The identity is compared too: discovery backfill can re-qualify a rendered row under an
    // unchanged activation, and the published identity would otherwise be pruned and lost.
    if (!moveAwaitingPublish.current && publishedIdentity.current === activeIdentity) {
      return
    }
    moveAwaitingPublish.current = false
    publishedIdentity.current = activeIdentity
    selectOnly(activeIdentity)
  }, [activationKey, activeIdentity, selectOnly])

  // Why layout effect: the Cmd/Ctrl+1–9 handler can fire right after commit; publishing after paint would leave the shortcut cache stale.
  useLayoutEffect(() => {
    const chipKeysByIdentity = new Map<string, string>()
    for (const row of sectionRows) {
      if (row.type === 'item' && row.lineageGroupKey && row.lineageChildCount > 0) {
        chipKeysByIdentity.set(getWorktreeHostIdentity(row.worktree), row.lineageGroupKey)
      }
    }
    setVisibleWorktreeIds(renderedWorktreeIds)
    setVisibleWorktreeShortcutTargets(
      renderedWorktrees.map((worktree) => {
        const lineageGroupKey = chipKeysByIdentity.get(getWorktreeHostIdentity(worktree))
        return {
          id: worktree.id,
          ...(worktree.hostId ? { executionHostId: worktree.hostId } : {}),
          ...(lineageGroupKey ? { lineageGroupKey } : {})
        }
      })
    )
    // Why null, not []: [] is a real rendered order (all collapsed/filtered); null tells shortcuts the list is unmounted.
    return () => {
      setVisibleWorktreeIds(null)
      setVisibleWorktreeShortcutTargets(null)
    }
  }, [renderedWorktreeIds, renderedWorktrees, sectionRows])

  return {
    renderedWorktreeIds,
    renderedWorktreeIdentities,
    selectedWorktreeIds: selection.selectedKeys,
    selectedWorktrees: selection.selectedItems,
    updateSelectionForGesture: selection.updateSelectionForGesture,
    selectForContextMenu
  }
}
