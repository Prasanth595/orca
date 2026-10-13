import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  orcaBrowserGuidanceLaunchOptions,
  resetCodexUserDeveloperInstructionsCache
} from './orca-browser-guidance-launch-options'

describe('orcaBrowserGuidanceLaunchOptions', () => {
  const userDefines = vi.fn()

  beforeEach(() => {
    resetCodexUserDeveloperInstructionsCache()
    userDefines.mockReset().mockResolvedValue(false)
    vi.stubGlobal('window', {
      api: {
        codexConfigSync: { userDefinesDeveloperInstructions: userDefines }
      }
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is off when the setting is off and never reads the Codex config', () => {
    expect(orcaBrowserGuidanceLaunchOptions({}, 'codex')).toEqual({
      orcaBrowserGuidance: false
    })
    expect(userDefines).not.toHaveBeenCalled()
  })

  it('needs no Codex config check for other agents', () => {
    expect(
      orcaBrowserGuidanceLaunchOptions({ useOrcaBrowserForAgentWork: true }, 'claude')
    ).toEqual({
      orcaBrowserGuidance: true
    })
    expect(userDefines).not.toHaveBeenCalled()
  })

  it('skips Codex guidance until the config check answers, then follows it', async () => {
    const settings = { useOrcaBrowserForAgentWork: true }
    expect(orcaBrowserGuidanceLaunchOptions(settings, 'codex')).toEqual({
      orcaBrowserGuidance: true,
      codexUserDeveloperInstructions: true
    })
    await vi.waitFor(() => expect(userDefines).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(orcaBrowserGuidanceLaunchOptions(settings, 'codex')).toEqual({
      orcaBrowserGuidance: true,
      codexUserDeveloperInstructions: false
    })
  })

  it('caches the config answer per launch cwd', async () => {
    const settings = { useOrcaBrowserForAgentWork: true }
    userDefines.mockImplementation((cwd?: string) => Promise.resolve(cwd === '/repo/a'))
    orcaBrowserGuidanceLaunchOptions(settings, 'codex', '/repo/a')
    orcaBrowserGuidanceLaunchOptions(settings, 'codex', '/repo/b')
    await vi.waitFor(() => expect(userDefines).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(userDefines).toHaveBeenCalledWith('/repo/a')
    expect(
      orcaBrowserGuidanceLaunchOptions(settings, 'codex', '/repo/a').codexUserDeveloperInstructions
    ).toBe(true)
    expect(
      orcaBrowserGuidanceLaunchOptions(settings, 'codex', '/repo/b').codexUserDeveloperInstructions
    ).toBe(false)
  })
})
