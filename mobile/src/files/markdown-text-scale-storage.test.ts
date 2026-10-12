import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

import { loadMarkdownTextScale, saveMarkdownTextScale } from './markdown-text-scale-storage'

describe('markdown text scale storage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a stored preset', async () => {
    storage.getItem.mockResolvedValue('1.5')
    expect(await loadMarkdownTextScale()).toBe(1.5)
  })

  it.each(['abc', '3', '0.1', '1.3', ''])('falls back to 1 for corrupt value %j', async (raw) => {
    storage.getItem.mockResolvedValue(raw)
    expect(await loadMarkdownTextScale()).toBe(1)
  })

  it('falls back to 1 when nothing is stored or storage throws', async () => {
    storage.getItem.mockResolvedValue(null)
    expect(await loadMarkdownTextScale()).toBe(1)
    storage.getItem.mockRejectedValue(new Error('boom'))
    expect(await loadMarkdownTextScale()).toBe(1)
  })

  it('saves the value as a string', async () => {
    await saveMarkdownTextScale(1.25)
    expect(storage.setItem).toHaveBeenCalledWith('orca:markdownTextScale', '1.25')
  })
})
