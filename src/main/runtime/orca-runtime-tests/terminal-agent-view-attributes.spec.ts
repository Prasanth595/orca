import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime-test-mocks.spec'
import {
  _resetHiddenRendererPtyDeliveryGateForTest,
  markHiddenRendererPty
} from '../../ipc/pty-hidden-delivery-gate'
import { commitTerminalViewAttributesSnapshot } from '../terminal-view-attribute-store'
import type {
  TerminalViewAttributes,
  TerminalViewRgb
} from '../../../shared/terminal-view-attributes'
import { HEADLESS_LEAF_ID, TEST_WORKTREE_PATH, store } from '../orca-runtime-test-fixtures.spec'

function viewAttributes(
  foreground: TerminalViewRgb,
  background: TerminalViewRgb
): TerminalViewAttributes {
  return {
    foreground,
    background,
    cursor: [0xff, 0xff, 0xff],
    ansi: Array.from({ length: 256 }, (): TerminalViewRgb => [0, 0, 0]),
    colorSchemeMode: 'dark',
    cursorStyle: 'block',
    cursorBlink: false
  }
}

describe('OrcaRuntimeService per-agent view attributes', () => {
  it('passes Codex byAgent view colors to background Codex spawns', async () => {
    commitTerminalViewAttributesSnapshot({
      global: viewAttributes([0xff, 0xff, 0xff], [0x28, 0x2c, 0x34]),
      byAgent: { codex: viewAttributes([0xf8, 0xf8, 0xf2], [0x28, 0x2a, 0x36]) }
    })
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-codex-colors' })
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, { command: 'codex' })

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        launchAgent: 'codex',
        terminalColorQueryReplies: { foreground: '#f8f8f2', background: '#282a36' }
      })
    )
  })

  it('answers a hidden OSC 12 query from the Codex byAgent snapshot', async () => {
    commitTerminalViewAttributesSnapshot({
      global: viewAttributes([0xd0, 0xd0, 0xd0], [0x1e, 0x1e, 0x2e]),
      byAgent: {
        codex: {
          ...viewAttributes([0xd0, 0xd0, 0xd0], [0x28, 0x2a, 0x36]),
          cursor: [0x12, 0x34, 0x56]
        }
      }
    })
    const replies: string[] = []
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-codex-osc' })
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn,
      write: (_id, data) => {
        replies.push(data)
        return true
      },
      kill: () => true,
      getForegroundProcess: async () => null
    })

    try {
      await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, { command: 'codex' })
      markHiddenRendererPty('pty-codex-osc')
      runtime.onPtyData('pty-codex-osc', '\x1b]12;?\x07', Date.now())
      await runtime.serializeMainTerminalBuffer('pty-codex-osc')
    } finally {
      _resetHiddenRendererPtyDeliveryGateForTest()
    }

    expect(replies).toEqual(['\x1b]12;rgb:1212/3434/5656\x1b\\'])
  })

  it('fans out Codex view-attribute changes to Codex emulators only', async () => {
    const globalAttrs = viewAttributes([0xff, 0xff, 0xff], [0x28, 0x2c, 0x34])
    const codexAttrs = viewAttributes([0xff, 0xff, 0xff], [0x11, 0x00, 0x00])
    commitTerminalViewAttributesSnapshot({ global: globalAttrs, byAgent: {} })

    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ id: 'pty-fanout-codex' })
      .mockResolvedValueOnce({ id: 'pty-fanout-shell' })
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
      command: 'codex',
      tabId: 'fanout-codex-tab',
      leafId: HEADLESS_LEAF_ID
    })
    await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
      tabId: 'fanout-shell-tab',
      leafId: '22222222-2222-4222-8222-222222222222'
    })

    runtime.onPtyData('pty-fanout-codex', 'boot', Date.now())
    runtime.onPtyData('pty-fanout-shell', 'boot', Date.now())

    const terminals: unknown = Reflect.get(runtime, 'headlessTerminals')
    if (!(terminals instanceof Map)) {
      throw new Error('runtime has no headless terminal map')
    }
    const codexApply = vi.spyOn(
      terminals.get('pty-fanout-codex')!.emulator,
      'applyPushedViewAttributes'
    )
    const shellApply = vi.spyOn(
      terminals.get('pty-fanout-shell')!.emulator,
      'applyPushedViewAttributes'
    )

    commitTerminalViewAttributesSnapshot({ global: globalAttrs, byAgent: { codex: codexAttrs } })

    expect(codexApply).toHaveBeenCalledTimes(1)
    expect(shellApply).not.toHaveBeenCalled()
  })
})
