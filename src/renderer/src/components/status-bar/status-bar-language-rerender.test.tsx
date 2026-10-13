// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'

const { useStatusBarControllerMock } = vi.hoisted(() => ({
  useStatusBarControllerMock: vi.fn(() => null)
}))

vi.mock('./use-status-bar-controller', () => ({
  useStatusBarController: useStatusBarControllerMock
}))

import { StatusBar } from './StatusBar'

afterEach(() => {
  cleanup()
  useStatusBarControllerMock.mockClear()
})

describe('StatusBar language switch', () => {
  it('re-renders the memoized bar when the language changes', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <StatusBar floatingTerminalOpen={false} />
      </I18nextProvider>
    )
    const rendersBefore = useStatusBarControllerMock.mock.calls.length

    await act(() => i18n.changeLanguage(i18n.language))

    expect(useStatusBarControllerMock.mock.calls.length).toBeGreaterThan(rendersBefore)
  })
})
