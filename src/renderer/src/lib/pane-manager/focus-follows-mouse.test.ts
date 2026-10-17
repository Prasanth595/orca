import { describe, expect, it } from 'vitest'
import { shouldFollowMouseFocus, type FocusFollowsMouseInput } from './focus-follows-mouse'

describe('shouldFollowMouseFocus', () => {
  // Base input where every gate passes. Individual tests flip one field
  // at a time to assert that each gate blocks focus independently.
  const base: FocusFollowsMouseInput = {
    featureEnabled: true,
    activePaneId: 1,
    hoveredPaneId: 2,
    hoveredPaneHasFocus: false,
    mouseButtons: 0,
    windowHasFocus: true,
    managerDestroyed: false
  }

  it('switches focus when all gates pass', () => {
    expect(shouldFollowMouseFocus(base)).toBe(true)
  })

  it('blocks when the feature is disabled', () => {
    expect(shouldFollowMouseFocus({ ...base, featureEnabled: false })).toBe(false)
  })

  it('blocks when the manager is destroyed', () => {
    expect(shouldFollowMouseFocus({ ...base, managerDestroyed: true })).toBe(false)
  })

  it('blocks when hovering the already-active pane that holds focus', () => {
    expect(shouldFollowMouseFocus({ ...base, hoveredPaneId: 1, hoveredPaneHasFocus: true })).toBe(
      false
    )
  })

  // Main and floating layouts are separate managers: the hovered pane can be
  // its own manager's active pane while focus is in the other layout.
  it('refocuses the already-active pane when focus is elsewhere', () => {
    expect(shouldFollowMouseFocus({ ...base, hoveredPaneId: 1, hoveredPaneHasFocus: false })).toBe(
      true
    )
  })

  it('still blocks an unfocused active pane while a mouse button is held', () => {
    expect(
      shouldFollowMouseFocus({
        ...base,
        hoveredPaneId: 1,
        hoveredPaneHasFocus: false,
        mouseButtons: 1
      })
    ).toBe(false)
  })

  it('blocks while the primary mouse button is held (buttons=1)', () => {
    expect(shouldFollowMouseFocus({ ...base, mouseButtons: 1 })).toBe(false)
  })

  it('blocks while the secondary mouse button is held (buttons=2)', () => {
    expect(shouldFollowMouseFocus({ ...base, mouseButtons: 2 })).toBe(false)
  })

  it('blocks when the window does not have OS focus', () => {
    expect(shouldFollowMouseFocus({ ...base, windowHasFocus: false })).toBe(false)
  })
})
