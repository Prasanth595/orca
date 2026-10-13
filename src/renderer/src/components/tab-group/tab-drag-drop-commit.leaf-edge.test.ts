/**
 * @vitest-environment happy-dom
 */
import type { DragEndEvent } from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { commitTabDragDrop, type LeafJoinDeps } from './tab-drag-drop-commit'
import {
  dragEndEventAt,
  geometrySnapshot,
  GROUP,
  leafRectsFor,
  leafTargetState,
  SOURCE,
  SOURCE_UNIFIED,
  sourceDrag,
  TARGET,
  TARGET_UNIFIED,
  WT,
  A,
  C,
  sleepingRecord
} from './tab-drag-leaf-target-fixture'

vi.mock('../browser-pane/host-guest/webview-registry', () => ({
  acquireWebviewsDragPassthrough: vi.fn(() => vi.fn())
}))
vi.mock('../../runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: vi.fn(() => false),
  moveWebRuntimeSessionTab: vi.fn()
}))

const dropAt = dragEndEventAt

function setup(outcome: 'moved' | 'refused' | 'unknown' = 'moved') {
  const moveTabIntoPane = vi.fn<LeafJoinDeps['moveTabIntoPane']>(() => Promise.resolve(outcome))
  const dropUnifiedTab = vi.fn(() => false)
  const reorderUnifiedTabs = vi.fn()
  const finishDrag = vi.fn()
  const leafJoin: LeafJoinDeps = {
    moveTabIntoPane,
    readLeafRects: () => leafRectsFor('split'),
    getPreDragSnapshot: () => ({
      activeGroupId: GROUP,
      activeTabIdByGroup: { [GROUP]: SOURCE_UNIFIED }
    })
  }
  const commit = (event: DragEndEvent): void =>
    commitTabDragDrop({
      event,
      worktreeId: WT,
      dragGeometryRef: { current: geometrySnapshot() },
      dropUnifiedTab,
      reorderUnifiedTabs,
      finishDrag,
      leafJoin
    })
  return { commit, moveTabIntoPane, dropUnifiedTab, reorderUnifiedTabs, finishDrag }
}

function shownTabId(): string | null | undefined {
  return useAppStore.getState().groupsByWorktree[WT]?.[0]?.activeTabId
}

beforeEach(() => {
  useAppStore.setState(leafTargetState())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('commitTabDragDrop: a drop on the edge of a pane inside another tab', () => {
  it.each([
    ['left', { x: 520, y: 316 }, 'left', C],
    ['right', { x: 790, y: 316 }, 'right', C],
    ['top', { x: 650, y: 170 }, 'top', C],
    ['bottom', { x: 650, y: 470 }, 'bottom', C]
  ] as const)('joins on the %s side of the pane it is over', (_name, pointer, side, leafId) => {
    const h = setup()

    h.commit(dropAt(pointer, { overGroupId: GROUP }))

    expect(h.moveTabIntoPane).toHaveBeenCalledTimes(1)
    expect(h.moveTabIntoPane).toHaveBeenCalledWith({
      sourceTabId: SOURCE,
      targetTabId: TARGET,
      targetLeafId: leafId,
      side
    })
    expect(h.dropUnifiedTab).not.toHaveBeenCalled()
    expect(h.reorderUnifiedTabs).not.toHaveBeenCalled()
  })

  it('ends the drag without restoring the preview, so the shown target tab stays shown', async () => {
    const h = setup('moved')

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))
    await Promise.resolve()

    expect(h.finishDrag).toHaveBeenCalledTimes(1)
    expect(h.finishDrag).toHaveBeenCalledWith(false)
    expect(shownTabId()).toBe(TARGET_UNIFIED)
  })

  it('puts the pre-drag tab back when the move was refused', async () => {
    const h = setup('refused')

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))
    await vi.waitFor(() => expect(shownTabId()).toBe(SOURCE_UNIFIED))
  })

  it('does not restore the preview over groups that changed while the move was in flight', async () => {
    const h = setup('refused')
    let refuse: (outcome: 'refused') => void = () => {}
    h.moveTabIntoPane.mockReturnValueOnce(
      new Promise((resolve) => {
        refuse = resolve
      })
    )

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))
    const created = { id: 'group-new', worktreeId: WT, activeTabId: 'unified-new', tabOrder: [] }
    useAppStore.setState((s) => ({
      groupsByWorktree: {
        ...s.groupsByWorktree,
        [WT]: [...(s.groupsByWorktree[WT] ?? []), created]
      }
    }))
    refuse('refused')
    await Promise.resolve()
    await Promise.resolve()

    const groups = useAppStore.getState().groupsByWorktree[WT] ?? []
    expect(groups.find((g) => g.id === 'group-new')?.activeTabId).toBe('unified-new')
    expect(shownTabId()).toBe(TARGET_UNIFIED)
  })

  it('leaves the shown tab alone when the outcome is unknown: main may have moved it', async () => {
    const h = setup('unknown')

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))
    await Promise.resolve()
    await Promise.resolve()

    expect(shownTabId()).toBe(TARGET_UNIFIED)
  })

  it('does nothing, and restores the preview, over a pane that cannot take it', () => {
    useAppStore.setState(
      leafTargetState({
        tabsByWorktree: {
          [WT]: (leafTargetState().tabsByWorktree[WT] ?? []).map((tab) =>
            tab.id === TARGET ? { ...tab, viewMode: 'chat' as const } : tab
          )
        }
      })
    )
    const h = setup()

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
    expect(h.dropUnifiedTab).not.toHaveBeenCalled()
    expect(h.finishDrag).toHaveBeenCalledWith(true)
  })

  it('re-checks eligibility at the drop: a source that fell asleep after the hover does not join', () => {
    const paneKey = `${SOURCE}:${A}`
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: { [paneKey]: sleepingRecord(paneKey, SOURCE) }
    })
    const h = setup()

    h.commit(dropAt({ x: 790, y: 316 }, { overGroupId: GROUP }))

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
  })
})

describe('commitTabDragDrop: drops that keep their behaviour', () => {
  it('the center of a pane still moves the tab into the group under the pointer', () => {
    const h = setup()

    h.commit(dropAt({ x: 600, y: 300 }, { overGroupId: 'group-2' }))

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
    expect(h.dropUnifiedTab).toHaveBeenCalledWith(SOURCE_UNIFIED, { groupId: 'group-2' })
  })

  it("the center of a pane in the dragged tab's own group does nothing and restores the preview", () => {
    const h = setup()

    h.commit(dropAt({ x: 600, y: 300 }, { overGroupId: GROUP }))

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
    expect(h.dropUnifiedTab).not.toHaveBeenCalled()
    expect(h.reorderUnifiedTabs).not.toHaveBeenCalled()
    expect(h.finishDrag).toHaveBeenCalledWith(true, undefined)
  })

  it('the outer band still opens a new column', () => {
    const h = setup()

    h.commit(dropAt({ x: 900, y: 316 }, { overGroupId: GROUP }))

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
    expect(h.dropUnifiedTab).toHaveBeenCalledWith(SOURCE_UNIFIED, {
      groupId: GROUP,
      splitDirection: 'right'
    })
  })

  it('a non-terminal tab never joins a pane', () => {
    const h = setup()

    h.commit(
      dropAt(
        { x: 790, y: 316 },
        { overGroupId: 'group-2', drag: sourceDrag({ tabType: 'editor' }) }
      )
    )

    expect(h.moveTabIntoPane).not.toHaveBeenCalled()
    expect(h.dropUnifiedTab).toHaveBeenCalledWith(SOURCE_UNIFIED, { groupId: 'group-2' })
  })
})
