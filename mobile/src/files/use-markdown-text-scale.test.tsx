import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  load: vi.fn<() => Promise<number>>(),
  save: vi.fn(async () => undefined)
}))
vi.mock('./markdown-text-scale-storage', () => ({
  loadMarkdownTextScale: storage.load,
  saveMarkdownTextScale: storage.save
}))

import { resetMarkdownTextScaleStore, useMarkdownTextScale } from './use-markdown-text-scale'

type Api = ReturnType<typeof useMarkdownTextScale>

function mount(): { api: () => Api } {
  let latest: Api | null = null
  function Probe() {
    latest = useMarkdownTextScale()
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  return { api: () => latest! }
}

describe('useMarkdownTextScale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMarkdownTextScaleStore()
  })

  it('loads the saved value', async () => {
    storage.load.mockResolvedValue(1.5)
    const a = mount()
    await act(async () => {})
    expect(a.api().textScale).toBe(1.5)
  })

  it('shares one value between two surfaces', async () => {
    storage.load.mockResolvedValue(1)
    const a = mount()
    const b = mount()
    await act(async () => {})
    act(() => a.api().commitTextScale(1.75))
    expect(b.api().textScale).toBe(1.75)
    expect(storage.save).toHaveBeenCalledWith(1.75)
  })

  it('does not let a late load clobber a pick made before it finished', async () => {
    let resolve!: (v: number) => void
    storage.load.mockReturnValue(new Promise<number>((r) => (resolve = r)))
    const a = mount()
    act(() => a.api().selectTextSize('2'))
    await act(async () => resolve(0.75))
    expect(a.api().textScale).toBe(2)
  })
})
