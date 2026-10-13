// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserAgentWorkSetting } from './BrowserAgentWorkSetting'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

describe('BrowserAgentWorkSetting', () => {
  const userDefinesDeveloperInstructions = vi.fn(() => Promise.resolve(false))

  beforeEach(() => {
    vi.stubGlobal('window', {
      ...window,
      api: { codexConfigSync: { userDefinesDeveloperInstructions } }
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    userDefinesDeveloperInstructions.mockClear()
  })

  it('is off by default and turns the setting on', () => {
    const updateSettings = vi.fn()
    render(<BrowserAgentWorkSetting settings={{}} updateSettings={updateSettings} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(updateSettings).toHaveBeenCalledWith({
      useOrcaBrowserForAgentWork: true
    })
  })

  it('turns the setting off when enabled', () => {
    const updateSettings = vi.fn()
    render(
      <BrowserAgentWorkSetting
        settings={{ useOrcaBrowserForAgentWork: true }}
        updateSettings={updateSettings}
      />
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(updateSettings).toHaveBeenCalledWith({
      useOrcaBrowserForAgentWork: false
    })
  })
})
