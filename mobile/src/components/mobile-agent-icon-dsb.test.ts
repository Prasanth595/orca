import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileAgentIcon } from './MobileAgentIcon'

// Mocked react-native components are string tags that ReactTestInstance's ElementType omits.
function hostType(node: ReactTestInstance): unknown {
  return node.type
}

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Terminal: 'Terminal'
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Stop: 'Stop'
}))

vi.mock('./mobile-agent-icon-assets', () => ({
  MOBILE_AGENT_ICON_ASSETS: { dsh: 'dsh-whale-asset', cursor: 'cursor-asset' }
}))

vi.mock('./AgentIcons', () => ({
  ClaudeIcon: 'ClaudeIcon',
  OpenAIIcon: 'OpenAIIcon'
}))

describe('MobileAgentIcon DeepSeek Build', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(agentId: string): ReactTestRenderer {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId }))
    })
    consoleError.mockRestore()
    return renderer!
  }

  it('gives DeepSeek Build (dsb) tabs the same DeepSeek whale as DeepSeek Harness (dsh)', () => {
    const dsb = render('dsb').root.find((node) => hostType(node) === 'Image').props.source
    act(() => renderer?.unmount())
    const dsh = render('dsh').root.find((node) => hostType(node) === 'Image').props.source

    expect(dsb).toBe('dsh-whale-asset')
    expect(dsb).toBe(dsh)
  })

  it('leaves other agent icons unchanged', () => {
    expect(render('cursor').root.find((node) => hostType(node) === 'Image').props.source).toBe(
      'cursor-asset'
    )
    act(() => renderer?.unmount())
    expect(render('claude').root.findAll((node) => hostType(node) === 'ClaudeIcon')).toHaveLength(1)
  })
})
