import { useCallback, useState } from 'react'
const MAX_EXPANDED_TURNS = 128
const MAX_CHAT_SCOPES = 32
const EMPTY_OPEN_KEYS: ReadonlySet<string> = new Set()

/** Keys the reader opened in this chat, bounded; another chat's never leak in. */
export function useScopedOpenKeys(scopeKey: string): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map())
  const toggle = useCallback(
    (key: string) => {
      setState((current) => {
        const next = new Set(current.get(scopeKey) ?? [])
        if (!next.delete(key)) {
          if (next.size >= MAX_EXPANDED_TURNS) {
            const oldest = next.values().next().value
            if (oldest) {
              next.delete(oldest)
            }
          }
          next.add(key)
        }
        const scopes = new Map(current)
        scopes.delete(scopeKey)
        scopes.set(scopeKey, next)
        while (scopes.size > MAX_CHAT_SCOPES) {
          const oldest = scopes.keys().next().value
          if (oldest !== undefined) {
            scopes.delete(oldest)
          }
        }
        return scopes
      })
    },
    [scopeKey]
  )
  return [state.get(scopeKey) ?? EMPTY_OPEN_KEYS, toggle]
}
