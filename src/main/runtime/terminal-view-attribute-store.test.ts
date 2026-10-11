import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalViewAttributes, TerminalViewRgb } from '../../shared/terminal-view-attributes'
import {
  _resetTerminalViewAttributesForTest,
  commitTerminalViewAttributesSnapshot,
  getTerminalViewAttributes,
  getTerminalViewerColors,
  getTerminalViewerHostColors,
  ptyMatchesViewAttributeScope,
  registerTerminalViewAttributesApplier,
  seedTerminalViewerColors,
  setPairedViewerColors,
  setTerminalViewerColorsListener
} from './terminal-view-attribute-store'

function attrs(background: TerminalViewRgb): TerminalViewAttributes {
  return {
    foreground: [0xff, 0xff, 0xff],
    background,
    cursor: [0xff, 0xff, 0xff],
    ansi: Array.from({ length: 256 }, (): TerminalViewRgb => [0, 0, 0]),
    colorSchemeMode: 'dark',
    cursorStyle: 'block',
    cursorBlink: false
  }
}

const GLOBAL = attrs([0x28, 0x2c, 0x34])
const CODEX = attrs([0x11, 0x00, 0x00])
const LIGHT_GLOBAL = attrs([0xfa, 0xfa, 0xfa])

beforeEach(() => {
  _resetTerminalViewAttributesForTest()
})

describe('terminal-view-attribute-store snapshot', () => {
  it('looks up global, agent override, and inherit fallback', () => {
    commitTerminalViewAttributesSnapshot({
      global: GLOBAL,
      byAgent: { codex: CODEX }
    })
    expect(getTerminalViewAttributes(null)?.background).toEqual(GLOBAL.background)
    expect(getTerminalViewAttributes('codex')?.background).toEqual(CODEX.background)
    expect(getTerminalViewAttributes('claude')?.background).toEqual(GLOBAL.background)
  })

  it('does not fan out an identical re-push', () => {
    const applier = vi.fn()
    registerTerminalViewAttributesApplier(applier)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    applier.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(applier).not.toHaveBeenCalled()
  })

  it('does not apply when adding a Codex override equal to global', () => {
    const applier = vi.fn()
    registerTerminalViewAttributesApplier(applier)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    applier.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: GLOBAL } })
    expect(applier).not.toHaveBeenCalled()
  })

  it('does not apply when removing a same-as-global Codex override back to inherit', () => {
    const applier = vi.fn()
    registerTerminalViewAttributesApplier(applier)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: GLOBAL } })
    applier.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    expect(applier).not.toHaveBeenCalled()
  })

  it('applies global only to Codex when removing a different Codex override', () => {
    const applier = vi.fn()
    registerTerminalViewAttributesApplier(applier)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    applier.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    expect(applier).toHaveBeenCalledTimes(1)
    expect(applier).toHaveBeenCalledWith(GLOBAL, { launchAgent: 'codex' })
  })

  it('does not fan out a Codex-only change to the shell/global scope', () => {
    const applier = vi.fn()
    registerTerminalViewAttributesApplier(applier)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    applier.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(applier).toHaveBeenCalledTimes(1)
    expect(applier).toHaveBeenCalledWith(CODEX, { launchAgent: 'codex' })
  })

  it('replaces a stale Codex map on renderer-reload inherit snapshot', () => {
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    expect(getTerminalViewAttributes('codex')?.background).toEqual(GLOBAL.background)
  })

  it('commits atomically so appliers only see the new global+agent pair', () => {
    const seen: { global: TerminalViewRgb; codex: TerminalViewRgb }[] = []
    registerTerminalViewAttributesApplier(() => {
      seen.push({
        global: getTerminalViewAttributes(null)!.background,
        codex: getTerminalViewAttributes('codex')!.background
      })
    })
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    seen.length = 0
    commitTerminalViewAttributesSnapshot({
      global: LIGHT_GLOBAL,
      byAgent: { codex: CODEX }
    })
    expect(seen.length).toBeGreaterThan(0)
    for (const snapshot of seen) {
      expect(snapshot).toEqual({
        global: LIGHT_GLOBAL.background,
        codex: CODEX.background
      })
    }
  })

  it('scopes a fan-out to the agent override, or to global for agents that inherit', () => {
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(ptyMatchesViewAttributeScope('codex', 'codex')).toBe(true)
    expect(ptyMatchesViewAttributeScope('codex', null)).toBe(false)
    expect(ptyMatchesViewAttributeScope('claude', null)).toBe(true)
    expect(ptyMatchesViewAttributeScope(null, null)).toBe(true)
    expect(ptyMatchesViewAttributeScope(null, 'codex')).toBe(false)
  })
})

describe('terminal-view-attribute-store viewer colours', () => {
  const SEEDED = { foreground: '#111111', background: '#222222' }
  const SEEDED_CODEX = { foreground: '#333333', background: '#444444' }
  const PAIRED = { foreground: '#555555', background: '#666666' }

  it('answers a pane from its agent override once a snapshot lands, else from the global colours', () => {
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(getTerminalViewerColors('codex')).toEqual({
      foreground: '#ffffff',
      background: '#110000'
    })
    expect(getTerminalViewerColors('claude')).toEqual(getTerminalViewerColors(null))
  })

  it('answers an agent pane from its seeded colours until the first snapshot', () => {
    seedTerminalViewerColors(SEEDED, { codex: SEEDED_CODEX })
    expect(getTerminalViewerColors('codex')).toEqual(SEEDED_CODEX)
    expect(getTerminalViewerColors('claude')).toEqual(SEEDED)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    expect(getTerminalViewerColors('codex')).toEqual(getTerminalViewerColors(null))
  })

  it('keeps a paired client colour global; only this host agent seed overrides it', () => {
    seedTerminalViewerColors(SEEDED, { codex: SEEDED_CODEX })
    setPairedViewerColors(PAIRED)
    expect(getTerminalViewerColors('claude')).toEqual(PAIRED)
    expect(getTerminalViewerColors('codex')).toEqual(SEEDED_CODEX)
  })

  it('reports host colours with only the agents that override', () => {
    expect(getTerminalViewerHostColors()).toBeNull()
    seedTerminalViewerColors(SEEDED, { codex: SEEDED_CODEX })
    expect(getTerminalViewerHostColors()).toEqual({ ...SEEDED, byAgent: { codex: SEEDED_CODEX } })
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    expect(getTerminalViewerHostColors()).toEqual({ foreground: '#ffffff', background: '#282c34' })
  })

  it('notifies the listener when an agent override changes the host colours', () => {
    const listener = vi.fn()
    setTerminalViewerColorsListener(listener)
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: {} })
    listener.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(listener).toHaveBeenCalledWith({
      foreground: '#ffffff',
      background: '#282c34',
      byAgent: { codex: { foreground: '#ffffff', background: '#110000' } }
    })
    listener.mockClear()
    commitTerminalViewAttributesSnapshot({ global: GLOBAL, byAgent: { codex: CODEX } })
    expect(listener).not.toHaveBeenCalled()
  })
})
