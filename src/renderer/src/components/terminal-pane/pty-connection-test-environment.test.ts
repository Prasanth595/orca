import { describe, expect, it } from 'vitest'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from './pty-connection-test-environment'

describe('pty-connection test environment', () => {
  it('stops real timers a test leaves behind so they cannot fire into the next test', async () => {
    await installTerminalTestGlobals()
    let fired = 0
    // Stand-ins for an undisposed session's retry and poll loops.
    setTimeout(() => {
      fired += 1
    }, 5)
    setInterval(() => {
      fired += 1
    }, 5)

    await restoreTerminalTestGlobals()
    await new Promise<void>((resolve) => setTimeout(resolve, 40))

    expect(fired).toBe(0)
  })
})
