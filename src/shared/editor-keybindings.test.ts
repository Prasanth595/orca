import { describe, expect, it } from 'vitest'
import { resolveEditorKeybindings } from './editor-keybindings'

describe('resolveEditorKeybindings', () => {
  it('treats only vim as vim', () => {
    expect(resolveEditorKeybindings('vim')).toBe('vim')
    expect(resolveEditorKeybindings(undefined)).toBe('default')
    expect(resolveEditorKeybindings('default')).toBe('default')
    expect(resolveEditorKeybindings('')).toBe('default')
    expect(resolveEditorKeybindings('emacs')).toBe('default')
  })
})
