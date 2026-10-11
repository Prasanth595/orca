import { describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function makeOperations(): SettingsMutationOperations {
  return {
    state: getDefaultPersistedState('/tmp'),
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

describe('updateSettings agentTerminalThemes', () => {
  it('stores a trimmed per-agent override and drops inherit, unknown agents and blank slots', () => {
    // Callers reach the store through IPC, so keys are not limited to known agents.
    const agentTerminalThemes: Record<string, { dark?: string; light?: string }> = {
      codex: { dark: ' Dracula ', light: 'inherit' },
      claude: { dark: '', light: '  ' },
      'not-an-agent': { dark: 'Dracula' }
    }
    const settings = updateSettings(makeOperations(), { agentTerminalThemes })

    expect(settings.agentTerminalThemes).toEqual({ codex: { dark: 'Dracula' } })
  })

  it('clears every override when the map is replaced with an empty one', () => {
    const operations = makeOperations()
    updateSettings(operations, { agentTerminalThemes: { codex: { dark: 'Dracula' } } })

    expect(updateSettings(operations, { agentTerminalThemes: {} }).agentTerminalThemes).toEqual({})
  })
})
