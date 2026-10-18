// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useNativeChatBtw } from './use-native-chat-btw'

describe('useNativeChatBtw', () => {
  it('opens an empty overlay for a bare /btw', () => {
    const { result } = renderHook(() =>
      useNativeChatBtw({ messages: [], ask: vi.fn() })
    )
    act(() => {
      result.current.ask('')
    })
    expect(result.current.state.open).toBe(true)
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.question).toBe('')
  })

  it('does not write the exchange into the returned state as a chat turn', async () => {
    const ask = vi.fn(async () => ({ success: true as const, answer: 'the retry lives in timer.ts' }))
    const { result } = renderHook(() => useNativeChatBtw({ messages: [], ask }))
    await act(async () => {
      result.current.ask('which file holds the retry?')
    })
    expect(ask).toHaveBeenCalledOnce()
    expect(result.current.state).toMatchObject({
      open: true,
      status: 'ready',
      question: 'which file holds the retry?',
      answer: 'the retry lives in timer.ts'
    })
  })
})
