// @vitest-environment happy-dom
import { includePinnedWorktrees } from './palette-pinned-worktrees'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PALETTE_PINS_STORAGE_KEY, readPalettePins, usePalettePins } from './use-palette-pins'
import { makeWorktree } from '../worktree-jump-palette-test-fixtures'
import { searchWorktreeDocuments } from '@/lib/worktree-palette-search'
import { encodePaletteIdentity } from '@/lib/palette-match/palette-ranking'
import { getPaletteWorktreeIdentity } from '@/lib/palette-repo-resolution'
import type { WorktreePaletteItem } from '../worktree-jump-palette-model'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

function item(index: number, hostId: 'local' | 'ssh:builder' = 'local'): WorktreePaletteItem {
  const worktree = makeWorktree(`workspace-${index}`, `Workspace ${index}`, { hostId })
  const match = searchWorktreeDocuments({
    worktrees: [worktree],
    query: '',
    repoMap: new Map(),
    documents: new Map()
  })[0]!
  return {
    id: encodePaletteIdentity(['worktree', getPaletteWorktreeIdentity(worktree)]),
    type: 'worktree',
    worktree,
    match
  }
}

describe('search palette pins', () => {
  beforeEach(() => localStorage.clear())

  it('persists five pins in insertion order, rejects a sixth, and frees a slot on unpin', () => {
    const first = renderHook(() => usePalettePins())
    act(() => {
      for (let index = 0; index < 6; index++) {
        first.result.current.togglePin(item(index))
      }
    })
    expect(first.result.current.pinnedIds).toEqual([0, 1, 2, 3, 4].map((index) => item(index).id))
    first.unmount()
    const reopened = renderHook(() => usePalettePins())
    expect(reopened.result.current.pins).toHaveLength(5)
    act(() => reopened.result.current.togglePin(item(1)))
    act(() => reopened.result.current.togglePin(item(5)))
    expect(reopened.result.current.pinnedIds).toEqual(
      [0, 2, 3, 4, 5].map((index) => item(index).id)
    )
    expect(readPalettePins()).toEqual(reopened.result.current.pins)
  })

  it('keeps identical workspace ids on different hosts separate', () => {
    const { result } = renderHook(() => usePalettePins())
    act(() => {
      result.current.togglePin(item(1))
      result.current.togglePin(item(1, 'ssh:builder'))
    })
    expect(result.current.pins).toHaveLength(2)
    act(() => result.current.togglePin(item(1)))
    expect(result.current.pinnedIds).toEqual([item(1, 'ssh:builder').id])
  })

  it('recovers from malformed storage and bounds duplicate or oversized saved lists', () => {
    localStorage.setItem(PALETTE_PINS_STORAGE_KEY, '{broken')
    expect(readPalettePins()).toEqual([])
    localStorage.setItem(
      PALETTE_PINS_STORAGE_KEY,
      JSON.stringify([
        null,
        { id: 2, title: 'bad' },
        { id: '', title: 'bad' },
        { id: 'a', title: 'First' },
        { id: 'a', title: 'Duplicate' },
        ...Array.from({ length: 8 }, (_, index) => ({ id: String(index), title: String(index) }))
      ])
    )
    expect(readPalettePins().map((pin) => pin.id)).toEqual(['a', '0', '1', '2', '3'])
  })

  it('keeps the prior pins when persistence fails', () => {
    const { result } = renderHook(() => usePalettePins())
    act(() => result.current.togglePin(item(0)))
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    act(() => result.current.togglePin(item(1)))
    expect(result.current.pinnedIds).toEqual([item(0).id])
    write.mockRestore()
  })
})

describe('pinned workspace visibility', () => {
  it('includes a pinned current or hidden workspace without bypassing the active host filter', () => {
    const local = item(0)
    const remote = item(0, 'ssh:builder')
    const archived = item(1)
    archived.worktree.isArchived = true
    const all = [local.worktree, remote.worktree, archived.worktree]
    const pins = [local.id, remote.id, archived.id]
    expect(includePinnedWorktrees([], { all, pinnedIds: pins })).toEqual([
      local.worktree,
      remote.worktree
    ])
    expect(
      includePinnedWorktrees([], {
        all,
        pinnedIds: pins,
        matchesFilter: (worktree) => worktree.hostId === 'local'
      })
    ).toEqual([local.worktree])
    expect(includePinnedWorktrees([local.worktree], { all, pinnedIds: pins })).toEqual([
      local.worktree,
      remote.worktree
    ])
  })
})
