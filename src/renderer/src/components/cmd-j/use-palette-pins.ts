import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { resolveWorktreeDisplayName } from '@/lib/worktree-default-display-name'
import type { PaletteItem } from '../worktree-jump-palette-model'

export const PALETTE_PINS_STORAGE_KEY = 'orca.jumpPalette.pins.v1'
export const MAX_PALETTE_PINS = 5
export type PalettePin = { id: string; title: string }

export function readPalettePins(): PalettePin[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PALETTE_PINS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) {
      return []
    }
    const pins: PalettePin[] = []
    for (const entry of value) {
      if (
        entry &&
        typeof entry === 'object' &&
        'id' in entry &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        'title' in entry &&
        typeof entry.title === 'string' &&
        !pins.some((pin) => pin.id === entry.id)
      ) {
        pins.push({ id: entry.id, title: entry.title })
      }
      if (pins.length === MAX_PALETTE_PINS) {
        break
      }
    }
    return pins
  } catch {
    return []
  }
}

export function isPinnablePaletteItem(item: PaletteItem): boolean {
  return (
    item.type === 'worktree' ||
    item.type === 'workspace-tab' ||
    item.type === 'browser-page' ||
    item.type === 'simulator-tab'
  )
}

export function usePalettePins() {
  const [pins, setPins] = useState(readPalettePins)
  const pinsRef = useRef(pins)
  const save = useCallback((next: PalettePin[]) => {
    try {
      localStorage.setItem(PALETTE_PINS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      toast.error(translate('worktreeJumpPalette.pinSaveFailed', 'Could not save shortcuts'))
      return
    }
    pinsRef.current = next
    setPins(next)
  }, [])
  const removePin = useCallback(
    (id: string) => {
      save(pinsRef.current.filter((pin) => pin.id !== id))
    },
    [save]
  )
  const togglePin = useCallback(
    (item: PaletteItem) => {
      if (!isPinnablePaletteItem(item)) {
        return
      }
      const current = pinsRef.current
      if (current.some((pin) => pin.id === item.id)) {
        removePin(item.id)
      } else if (current.length < MAX_PALETTE_PINS) {
        save([
          ...current,
          {
            id: item.id,
            title:
              item.type === 'worktree'
                ? resolveWorktreeDisplayName(item.worktree)
                : item.result.title
          }
        ])
      } else {
        toast.info(
          translate('worktreeJumpPalette.pinLimit', 'Remove a shortcut to add another (5 maximum)')
        )
      }
    },
    [removePin, save]
  )
  const pinnedIds = useMemo(() => pins.map((pin) => pin.id), [pins])
  return { pins, pinnedIds, togglePin, removePin }
}
