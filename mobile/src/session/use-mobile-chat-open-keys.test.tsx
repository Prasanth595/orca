import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it } from 'vitest'
import { useScopedOpenKeys } from './use-mobile-chat-open-keys'
it('keeps each tab disclosure state when returning without leaking it into another tab', () => {
  let current!: ReturnType<typeof useScopedOpenKeys>
  function Probe({ scope }: { scope: string }) {
    current = useScopedOpenKeys(scope)
    return null
  }
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(createElement(Probe, { scope: 'a' }))
  })
  try {
    act(() => current[1]('process'))
    act(() => tree.update(createElement(Probe, { scope: 'b' })))
    expect(current[0].has('process')).toBe(false)
    act(() => current[1]('other'))
    act(() => tree.update(createElement(Probe, { scope: 'a' })))
    expect(current[0].has('process')).toBe(true)
  } finally {
    act(() => tree.unmount())
  }
})
