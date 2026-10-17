import { describe, expect, it } from 'vitest'
import { parseSubmittedDiffPath, toSubmittedDiffPath } from './perforce-submitted-paths'

describe('submitted diff paths', () => {
  it('round-trips depot path, changelist and action', () => {
    expect(
      parseSubmittedDiffPath(toSubmittedDiffPath('//depot/project/src/main.cpp', 12345, 'edit'))
    ).toEqual({
      changelist: 12345,
      depotPath: '//depot/project/src/main.cpp',
      action: 'edit'
    })
    expect(parseSubmittedDiffPath(toSubmittedDiffPath('//depot/src/new.ts', 1, 'add'))).toEqual({
      changelist: 1,
      depotPath: '//depot/src/new.ts',
      action: 'add'
    })
    expect(parseSubmittedDiffPath(toSubmittedDiffPath('//depot/old.txt', 99999, 'delete'))).toEqual(
      {
        changelist: 99999,
        depotPath: '//depot/old.txt',
        action: 'delete'
      }
    )
  })

  it('handles Windows backslash normalization', () => {
    const encoded = toSubmittedDiffPath('//depot/src/file.cpp', 42, 'edit')
    const withBackslashes = encoded.replace(/\//g, '\\')
    expect(parseSubmittedDiffPath(withBackslashes)).toEqual({
      changelist: 42,
      depotPath: '//depot/src/file.cpp',
      action: 'edit'
    })
  })

  it('ignores ordinary paths', () => {
    expect(parseSubmittedDiffPath('src/main.cpp')).toBeNull()
    expect(parseSubmittedDiffPath('src/main.cpp#shelf12345')).toBeNull()
  })
})
