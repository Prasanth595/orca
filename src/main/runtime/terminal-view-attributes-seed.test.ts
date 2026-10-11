import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { seedAgentViewerColors } from './terminal-view-attributes-seed'

describe('seedAgentViewerColors', () => {
  it('resolves the colours of each agent with an override from persisted settings', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'dark' as const,
      terminalThemeDark: 'Ghostty Default Style Dark',
      agentTerminalThemes: { codex: { dark: 'Dracula' } }
    }
    const byAgent = seedAgentViewerColors(settings, true)
    expect(Object.keys(byAgent)).toEqual(['codex'])
    expect(byAgent.codex?.background).toBe('#282a36')
  })

  it('picks the light slot when the light variant is active', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'system' as const,
      terminalUseSeparateLightTheme: true,
      agentTerminalThemes: { claude: { dark: 'Dracula', light: 'Builtin Solarized Light' } }
    }
    const light = seedAgentViewerColors(settings, false)
    const dark = seedAgentViewerColors(settings, true)
    expect(light.claude?.background).not.toBe(dark.claude?.background)
    expect(dark.claude?.background).toBe('#282a36')
  })

  it('returns nothing when no agent overrides the global theme', () => {
    expect(seedAgentViewerColors(getDefaultSettings('/tmp'), true)).toEqual({})
  })
})
