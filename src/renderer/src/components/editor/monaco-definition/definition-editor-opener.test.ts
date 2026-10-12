// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'

const store = vi.hoisted(() => ({
  openFile: vi.fn(() => 'file-id'),
  setPendingEditorReveal: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))

import { openDefinitionResource, registerDefinitionSource } from './definition-editor-opener'
import { createDefinitionFileRoot } from './definition-file-keys'

function createFakeCodeEditor(): object {
  return {}
}

describe('definition editor opener', () => {
  const root = createDefinitionFileRoot('/work/app')
  const sourceEditor = createFakeCodeEditor()

  beforeEach(() => {
    store.openFile.mockClear()
    store.setPendingEditorReveal.mockClear()
  })

  it('opens a node_modules definition as a tab and reveals its position', async () => {
    const unregister = registerDefinitionSource(sourceEditor, {
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      root
    })
    // Monaco hands back the canonical form, with `@` encoded.
    const resource = URI.parse(`${root.rootKey}/node_modules/%40types/react/index.d.ts`)

    const handled = openDefinitionResource(sourceEditor, resource, {
      startLineNumber: 12,
      startColumn: 5,
      endLineNumber: 12,
      endColumn: 13
    })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    unregister()

    expect(handled).toBe(true)
    expect(store.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/work/app/node_modules/@types/react/index.d.ts',
        relativePath: 'node_modules/@types/react/index.d.ts',
        worktreeId: 'wt-1',
        mode: 'edit'
      })
    )
    expect(store.setPendingEditorReveal).toHaveBeenLastCalledWith({
      filePath: '/work/app/node_modules/@types/react/index.d.ts',
      line: 12,
      column: 5,
      matchLength: 0
    })
  })

  it('leaves editors it does not know, and files outside the workspace, to Monaco', async () => {
    const unregister = registerDefinitionSource(sourceEditor, {
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      root
    })
    const outside = URI.parse('file:///work/other/index.ts')
    const inside = URI.parse(`${root.rootKey}/src/index.ts`)

    const outsideHandled = openDefinitionResource(sourceEditor, outside)
    const unknownEditorHandled = openDefinitionResource(createFakeCodeEditor(), inside)
    unregister()

    expect(outsideHandled).toBe(false)
    expect(unknownEditorHandled).toBe(false)
    expect(store.openFile).not.toHaveBeenCalled()
  })
})
