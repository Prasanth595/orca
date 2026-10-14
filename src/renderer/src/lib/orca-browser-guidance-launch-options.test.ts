import { beforeEach, describe, expect, it, vi } from 'vitest'

const pairedWeb = vi.hoisted(() => vi.fn<() => boolean>())
const runtimeOwner = vi.hoisted(() => vi.fn<(state: unknown, id: string) => string | null>())

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./desktop-window-chrome', () => ({ isPairedWebClientWindow: pairedWeb }))
vi.mock('./worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: runtimeOwner
}))

import { orcaBrowserGuidanceLaunchOptions } from './orca-browser-guidance-launch-options'

const ON = { useOrcaBrowserForAgentWork: true }

describe('orcaBrowserGuidanceLaunchOptions', () => {
  beforeEach(() => {
    runtimeOwner.mockReset().mockReturnValue(null)
    pairedWeb.mockReset().mockReturnValue(false)
  })

  it('is off when the setting is off', () => {
    expect(orcaBrowserGuidanceLaunchOptions({}, 'codex', 'wt')).toEqual({
      orcaBrowserGuidance: false
    })
  })

  it('needs no spawn gate for other agents', () => {
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'claude', 'wt')).toEqual({
      orcaBrowserGuidance: true
    })
  })

  it('gates Codex guidance for a worktree this app owns', () => {
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'codex', 'wt')).toEqual({
      orcaBrowserGuidance: true,
      codexGuidanceSpawnGated: true
    })
  })

  it('leaves Codex ungated when a paired runtime owns the worktree', () => {
    runtimeOwner.mockReturnValue('env-1')
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'codex', 'wt')).toEqual({
      orcaBrowserGuidance: true
    })
  })

  it('leaves Codex ungated without a worktree', () => {
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'codex')).toEqual({
      orcaBrowserGuidance: true
    })
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'codex', null)).toEqual({
      orcaBrowserGuidance: true
    })
  })

  it('leaves Codex ungated in the paired web client', () => {
    pairedWeb.mockReturnValue(true)
    expect(orcaBrowserGuidanceLaunchOptions(ON, 'codex', 'wt')).toEqual({
      orcaBrowserGuidance: true
    })
  })
})
