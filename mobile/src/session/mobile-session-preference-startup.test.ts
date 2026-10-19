import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCustomKeys, type CustomKey } from '../components/CustomKeyModal'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode,
  loadTerminalTextScale
} from '../storage/preferences'
import {
  loadTerminalAccessoryLayout,
  type TerminalAccessoryLayoutPreference
} from '../terminal/terminal-accessory-layout'
import { useMobileSessionLifecycle } from './use-mobile-session-lifecycle'
import { useMobileSessionPreferenceFocus } from './use-mobile-session-preference-focus'

const focusEffects = vi.hoisted(() => ({
  callbacks: [] as Array<() => void | (() => void)>
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'ios' }
}))
vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    // Runs once on mount, as a focus does; `refocus` below replays a later return to the screen.
    useFocusEffect: (effect: () => void | (() => void)) => {
      react.useEffect(() => {
        focusEffects.callbacks.push(effect)
        return effect()
      }, [effect])
    }
  }
})
vi.mock('../storage/preferences', () => ({
  loadTerminalTextScale: vi.fn(),
  loadTerminalAutocompleteEnabled: vi.fn(),
  loadTerminalLinkOpenMode: vi.fn()
}))
vi.mock('../components/CustomKeyModal', () => ({ loadCustomKeys: vi.fn() }))
vi.mock('../terminal/terminal-accessory-layout', () => ({ loadTerminalAccessoryLayout: vi.fn() }))
vi.mock('../transport/host-store', () => ({ loadHosts: vi.fn().mockResolvedValue([]) }))
vi.mock('../terminal/terminal-foreground-recovery', () => ({
  recoverActiveTerminalAfterForeground: vi.fn(),
  shouldRecoverTerminalOnAppStateChange: () => false
}))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  focusEffects.callbacks = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('saved session settings before the first render', () => {
  it('publishes terminal readiness only after every terminal setting has applied', async () => {
    const scale = deferred<number>()
    vi.mocked(loadTerminalTextScale).mockReturnValue(scale.promise)
    vi.mocked(loadTerminalAutocompleteEnabled).mockResolvedValue(true)
    vi.mocked(loadTerminalLinkOpenMode).mockResolvedValue('phone-browser')
    const scope = {
      setTerminalTextScale: vi.fn(),
      setAutocompleteEnabled: vi.fn(),
      setTerminalLinkOpenMode: vi.fn()
    }
    let ready = false
    function Harness() {
      ready = useMobileSessionPreferenceFocus(scope).terminalPreferencesReady
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(ready).toBe(false)
    await act(async () => {
      await Promise.resolve()
    })
    // The other two settled first, and nothing may land before the text scale does.
    expect(ready).toBe(false)
    expect(scope.setAutocompleteEnabled).not.toHaveBeenCalled()
    await act(async () => {
      scale.resolve(1.25)
      await scale.promise
    })
    expect(ready).toBe(true)
    expect(scope.setTerminalTextScale).toHaveBeenCalledWith(1.25)
    expect(scope.setAutocompleteEnabled).toHaveBeenCalledWith(true)
    expect(scope.setTerminalLinkOpenMode).toHaveBeenCalledWith('phone-browser')

    // A return from Settings re-reads in place; readiness never drops, so nothing remounts.
    const nextScale = deferred<number>()
    vi.mocked(loadTerminalTextScale).mockReturnValue(nextScale.promise)
    act(() => {
      for (const effect of focusEffects.callbacks) {
        effect()
      }
    })
    expect(ready).toBe(true)
    await act(async () => {
      nextScale.resolve(1.5)
      await nextScale.promise
    })
    expect(ready).toBe(true)
    expect(scope.setTerminalTextScale).toHaveBeenLastCalledWith(1.5)
  })

  it('publishes accessory readiness only after the saved custom keys and layout have applied', async () => {
    const keys = deferred<CustomKey[]>()
    const layout = deferred<TerminalAccessoryLayoutPreference>()
    vi.mocked(loadCustomKeys).mockReturnValue(keys.promise)
    vi.mocked(loadTerminalAccessoryLayout).mockReturnValue(layout.promise)
    const scope = {
      hostId: 'host',
      connState: 'connecting',
      setCustomKeys: vi.fn(),
      setVisibleBuiltInIds: vi.fn(),
      setHostEndpoint: vi.fn(),
      connStateRef: { current: 'connecting' },
      terminalRefs: { current: new Map() },
      initializedHandlesRef: { current: new Set() },
      activeHandleRef: { current: null },
      scheduleDelayedAction: vi.fn(),
      unsubscribeTerminal: vi.fn(),
      subscribeToTerminal: vi.fn()
    }
    let ready: boolean | undefined
    function Harness() {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only these members of the session model.
      ready = useMobileSessionLifecycle(scope as never).accessoryPreferencesReady
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(ready).toBe(false)
    await act(async () => {
      layout.resolve({ version: 2, orderedBuiltInIds: ['esc', 'tab'], visibleBuiltInIds: ['tab'] })
      await layout.promise
    })
    expect(scope.setVisibleBuiltInIds).toHaveBeenCalledWith(['tab'])
    expect(ready).toBe(false)
    const saved: CustomKey[] = [{ id: 'k1', label: 'ls', bytes: 'ls', enter: true }]
    await act(async () => {
      keys.resolve(saved)
      await keys.promise
    })
    expect(scope.setCustomKeys).toHaveBeenCalledWith(saved)
    expect(ready).toBe(true)
  })
})
