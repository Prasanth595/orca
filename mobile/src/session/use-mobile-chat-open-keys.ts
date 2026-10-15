import { useCallback, useState } from 'react'
const MAX_EXPANDED_TURNS = 128
const EMPTY_OPEN_KEYS: ReadonlySet<string> = new Set()

/** Keys the reader opened in this chat, bounded; another chat's never leak in. */
export function useScopedOpenKeys(scopeKey: string): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState<{ scopeKey: string; keys: ReadonlySet<string> }>(() => ({
    scopeKey,
    keys: new Set()
  }))
  const toggle = useCallback(
    (key: string) => {
      setState((current) => {
        const next = new Set(current.scopeKey === scopeKey ? current.keys : [])
        if (!next.delete(key)) {
          if (next.size >= MAX_EXPANDED_TURNS) {
            const oldest = next.values().next().value
            if (oldest) {
              next.delete(oldest)
            }
          }
          next.add(key)
        }
        return { scopeKey, keys: next }
      })
    },
    [scopeKey]
  )
  return [state.scopeKey === scopeKey ? state.keys : EMPTY_OPEN_KEYS, toggle]
}
