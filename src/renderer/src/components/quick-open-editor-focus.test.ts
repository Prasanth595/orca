// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeQuickOpenEditorHandoff, focusOpenedEditorSurface } from './quick-open-editor-focus'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('focusOpenedEditorSurface', () => {
  it('focuses the editor textarea opened from Go to file', () => {
    const editor = document.createElement('textarea')
    editor.className = 'monaco-editor'
    const wrapper = document.createElement('div')
    wrapper.className = 'monaco-editor'
    wrapper.append(editor)
    document.body.append(wrapper)

    expect(focusOpenedEditorSurface()).toBe(true)
    expect(document.activeElement).toBe(editor)
  })
})

describe('completeQuickOpenEditorHandoff', () => {
  it('keeps a dismissed dialog from restoring focus, and focuses the editor after a file open', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const editor = document.createElement('textarea')
    const wrapper = document.createElement('div')
    wrapper.className = 'monaco-editor'
    wrapper.append(editor)
    document.body.append(wrapper)
    const event = new Event('focusout', { cancelable: true })

    completeQuickOpenEditorHandoff(event, true)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(editor)
    frames.shift()?.(0)
    frames.shift()?.(0)
    expect(document.activeElement).toBe(editor)
  })

  it('does not move focus when the dialog was dismissed without opening a file', () => {
    const previous = document.createElement('button')
    document.body.append(previous)
    previous.focus()
    const event = new Event('focusout', { cancelable: true })

    completeQuickOpenEditorHandoff(event, false)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(previous)
  })
})
