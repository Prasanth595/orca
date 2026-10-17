import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCodexHookTimeoutSeconds } from './codex-hook-timeout'
import * as timeout from './codex-hook-timeout'
import { buildCodexManagedHook, computeOrcaCodexHookHashes } from './codex-hook-definition'
import { buildScratchHooksJson } from './codex-hook-trust-derivation'
import { findStopgapOrcaHashes } from './codex-hook-orca-approvals'
import { computeTrustKey } from './config-toml-trust'

afterEach(() => vi.restoreAllMocks())

describe('native Windows Codex hook timeout', () => {
  it.each([undefined, '', '0', '-1', '10', '15', '31', '300', 'Infinity', '30.0', ' 30'])(
    'keeps the default for %s',
    (value) => {
      expect(resolveCodexHookTimeoutSeconds('win32', value)).toBe(10)
    }
  )

  it('opts in only on native Windows', () => {
    expect(resolveCodexHookTimeoutSeconds('win32', '30')).toBe(30)
    expect(resolveCodexHookTimeoutSeconds('linux', '30')).toBe(10)
    expect(resolveCodexHookTimeoutSeconds('darwin', '30')).toBe(10)
  })

  it('uses the same budget in runtime, scratch and hashes, while keeping Interrupt at 3s', () => {
    vi.spyOn(timeout, 'CODEX_MANAGED_HOOK_TIMEOUT_SECONDS', 'get').mockReturnValue(30)
    const command = 'orca-hook.cmd'
    const scratch = JSON.parse(buildScratchHooksJson(command, false))
    expect(buildCodexManagedHook(command, 'Stop').timeout).toBe(30)
    expect(scratch.hooks.Stop[0].hooks[0].timeout).toBe(30)
    expect(scratch.hooks.Interrupt[0].hooks[0].timeout).toBe(3)
    expect(computeOrcaCodexHookHashes(command).stop).not.toBe(
      computeOrcaCodexHookHashes(command, 10).stop
    )
    expect(computeOrcaCodexHookHashes(command).interrupt).toBe(
      computeOrcaCodexHookHashes(command, 10).interrupt
    )
  })

  it.each([10, 30])('does not reuse a previous budget approval when changing to %ss', (budget) => {
    vi.spyOn(timeout, 'CODEX_MANAGED_HOOK_TIMEOUT_SECONDS', 'get').mockReturnValue(budget)
    const command = 'orca-hook.cmd'
    const sourcePath = '/home/test/hooks.json'
    const key = computeTrustKey({
      sourcePath,
      eventLabel: 'stop',
      groupIndex: 0,
      handlerIndex: 0,
      command
    })
    const previous = budget === 10 ? 30 : 10
    const oldHash = 'codex-derived-previous-budget'
    const hashes = findStopgapOrcaHashes({
      command,
      hooks: { Stop: [{ hooks: [buildCodexManagedHook(command, 'Stop', previous)] }] },
      keySourcePaths: [sourcePath],
      trustStates: new Map([[key, { trustedHash: oldHash, enabled: true }]]),
      knownOrcaHashes: [{ stop: oldHash }]
    })
    expect(hashes.stop).toBe(computeOrcaCodexHookHashes(command).stop)
    expect(hashes.stop).not.toBe(oldHash)
  })
})
