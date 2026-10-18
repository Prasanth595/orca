// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SlotProps = { terminalTabId: string; isVisible: boolean; isActive: boolean }

const { WORKTREE_ID, TERMINAL_TAB_ID, GROUP_ID, mocks } = vi.hoisted(() => ({
  WORKTREE_ID: 'repo::/grid-member',
  TERMINAL_TAB_ID: 'terminal-1',
  GROUP_ID: 'group-1',
  mocks: {
    slots: new Map<string, { isVisible: boolean; isActive: boolean }>(),
    chatShortcutEnabled: new Array<boolean>()
  }
}))

vi.mock('../../store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create(() => ({
    tabsByWorktree: { [WORKTREE_ID]: [{ id: TERMINAL_TAB_ID, generation: 0 }] },
    unifiedTabsByWorktree: {
      [WORKTREE_ID]: [
        { id: 'unified-1', contentType: 'terminal', entityId: TERMINAL_TAB_ID, groupId: GROUP_ID }
      ]
    },
    groupsByWorktree: { [WORKTREE_ID]: [{ id: GROUP_ID, activeTabId: 'unified-1' }] },
    activeGroupIdByWorktree: { [WORKTREE_ID]: GROUP_ID },
    focusGroup: vi.fn(),
    consumeSuppressedPtyExit: vi.fn(() => false)
  }))
  return { useAppStore }
})
vi.mock('./TerminalOverlaySlot', () => ({
  TerminalOverlaySlot: (props: SlotProps) => {
    mocks.slots.set(props.terminalTabId, { isVisible: props.isVisible, isActive: props.isActive })
    return null
  }
}))
vi.mock('./use-terminal-tab-cold-parking', () => ({
  useTerminalTabColdParking: () => new Set<string>()
}))
vi.mock('../native-chat/use-native-chat-toggle-shortcut', () => ({
  useNativeChatToggleShortcut: (_worktreeId: string, enabled: boolean) => {
    mocks.chatShortcutEnabled.push(enabled)
  }
}))
vi.mock('../tab-group/workspace-emptied-reaction', () => ({
  captureWorkspaceEmptiedReaction: vi.fn()
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

import TerminalPaneOverlayLayer from './TerminalPaneOverlayLayer'

let root: Root | undefined
beforeEach(() => {
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  mocks.slots.clear()
  mocks.chatShortcutEnabled.length = 0
})

async function renderLayer(isWorktreeFocused?: boolean): Promise<void> {
  await act(async () =>
    root?.render(
      <TerminalPaneOverlayLayer
        worktreeId={WORKTREE_ID}
        worktreePath="/grid-member"
        isWorktreeActive
        isWorktreeFocused={isWorktreeFocused}
      />
    )
  )
}

describe('TerminalPaneOverlayLayer on a workspace grid view', () => {
  it('paints an unfocused grid view member without letting its terminal take focus', async () => {
    await renderLayer(false)

    // Why it matters: an active pane focuses itself on mount, so two active cells fight over keys.
    expect(mocks.slots.get(TERMINAL_TAB_ID)).toEqual({ isVisible: true, isActive: false })
    expect(mocks.chatShortcutEnabled.at(-1)).toBe(false)
  })

  it('keeps the focused grid view member active', async () => {
    await renderLayer(true)

    expect(mocks.slots.get(TERMINAL_TAB_ID)).toEqual({ isVisible: true, isActive: true })
    expect(mocks.chatShortcutEnabled.at(-1)).toBe(true)
  })

  it('treats a visible workspace as focused when no grid view is involved', async () => {
    await renderLayer()

    expect(mocks.slots.get(TERMINAL_TAB_ID)).toEqual({ isVisible: true, isActive: true })
  })
})
