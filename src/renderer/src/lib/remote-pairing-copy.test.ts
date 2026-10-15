import { describe, expect, it } from 'vitest'
import { translateRemotePairingFailureDescription } from './remote-pairing-copy'

describe('translateRemotePairingFailureDescription', () => {
  it('names the server host when the server is the side that must update', () => {
    expect(
      translateRemotePairingFailureDescription(
        { kind: 'protocol-incompatible', message: '', compatibilityReason: 'server-too-old' },
        null
      )
    ).toBe('Update Orca on the server host, then try again.')
    expect(
      translateRemotePairingFailureDescription(
        { kind: 'protocol-incompatible', message: '', compatibilityReason: 'client-too-old' },
        null
      )
    ).toBe('Update Orca on this device and the other host, then try again.')
  })
})
