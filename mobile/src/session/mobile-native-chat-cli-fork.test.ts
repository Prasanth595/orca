import { expect, it, vi } from 'vitest'
import { SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY } from '../../../src/shared/session-tabs-runtime-capabilities'

vi.mock('lucide-react-native', () => ({ SquareTerminal: 'Icon' }))

const { canOfferMobileNativeChatCliFork } =
  await import('./mobile-native-chat-cli-fork')

it('offers the phone fork only when the complete host contract is present', () => {
  const offer = (hostCapabilities: string[], workspaceOnPairedHost: boolean) =>
    canOfferMobileNativeChatCliFork({ agent: 'claude', hostCapabilities, workspaceOnPairedHost })
  expect(offer([], true)).toBe(false)
  expect(offer([SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY], false)).toBe(false)
  expect(offer([SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY], true)).toBe(true)
})
