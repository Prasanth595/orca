import type {
  ProviderAccountsSnapshot,
  ProviderAccountsWatcher
} from './runtime-provider-accounts-client'

/** Subscribe to the same atomic account/usage snapshot that remote clients receive. */
export function watchLocalProviderAccountUsage(handlers: {
  onSnapshot: (snapshot: ProviderAccountsSnapshot) => void
  onError: (error: unknown) => void
}): ProviderAccountsWatcher {
  let closed = false
  let unsubscribe: (() => void) | undefined
  const timer = window.setTimeout(() => {
    if (!closed) {
      handlers.onError(new Error('Timed out waiting for provider account usage.'))
    }
  }, 15_000)
  void window.api.runtime
    .subscribe({ method: 'accounts.subscribe' }, (response) => {
      if (closed) {
        return
      }
      if (!response.ok) {
        window.clearTimeout(timer)
        handlers.onError(new Error(response.error.message))
        return
      }
      const message = response.result
      if (typeof message !== 'object' || message === null) {
        return
      }
      if ('type' in message && message.type === 'end') {
        window.clearTimeout(timer)
        handlers.onError(new Error('Provider account usage subscription closed.'))
        return
      }
      if (!('snapshot' in message) || !message.snapshot) {
        return
      }
      window.clearTimeout(timer)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: accounts.subscribe is the host-owned account snapshot contract.
      handlers.onSnapshot(message.snapshot as ProviderAccountsSnapshot)
    })
    .then((handle) => {
      unsubscribe = handle.unsubscribe
      if (closed) {
        unsubscribe()
      }
    })
    .catch((error: unknown) => {
      window.clearTimeout(timer)
      if (!closed) {
        handlers.onError(error)
      }
    })
  return {
    close: () => {
      closed = true
      window.clearTimeout(timer)
      unsubscribe?.()
    }
  }
}
