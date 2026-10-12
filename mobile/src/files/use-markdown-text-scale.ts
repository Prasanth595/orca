import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { PickerOption } from '../components/PickerModal'
import { loadMarkdownTextScale, saveMarkdownTextScale } from './markdown-text-scale-storage'
import { MARKDOWN_TEXT_SCALES } from './markdown-text-scales'

// Why a module-level store: the file preview and the session reader both show Markdown text at
// one persisted size. Each used to load it once on mount into its own state, so a change in one
// left the other stale and its next pinch overwrote the saved value. One store, both subscribe.
let current = 1
let loadStarted = false
let changedByUser = false
const listeners = new Set<() => void>()

function setCurrent(scale: number, fromUser: boolean) {
  if (fromUser) {
    changedByUser = true
  }
  if (scale === current) {
    return
  }
  current = scale
  for (const listener of listeners) {
    listener()
  }
}

function ensureLoaded() {
  if (loadStarted) {
    return
  }
  loadStarted = true
  void loadMarkdownTextScale().then((saved) => {
    // Why: a pick made while the load was in flight is newer than what the load read.
    if (!changedByUser) {
      setCurrent(saved, false)
    }
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: forget the in-memory value and load state. */
export function resetMarkdownTextScaleStore() {
  current = 1
  loadStarted = false
  changedByUser = false
  listeners.clear()
}

export type TextSizeValue = string

export const TEXT_SIZE_OPTIONS: (PickerOption<TextSizeValue> & { scale: number })[] =
  MARKDOWN_TEXT_SCALES.map((scale) => ({
    value: String(scale),
    label: `${Math.round(scale * 100)}%`,
    scale
  }))

export function useMarkdownTextScale() {
  const textScale = useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  )
  useEffect(ensureLoaded, [])
  const setLiveScale = useCallback((scale: number) => setCurrent(scale, true), [])
  const commitTextScale = useCallback((scale: number) => {
    setCurrent(scale, true)
    void saveMarkdownTextScale(scale)
  }, [])
  const selectTextSize = useCallback(
    (value: TextSizeValue) => {
      const option = TEXT_SIZE_OPTIONS.find((o) => o.value === value)
      if (option) {
        commitTextScale(option.scale)
      }
    },
    [commitTextScale]
  )
  return { textScale, setLiveScale, commitTextScale, selectTextSize }
}
