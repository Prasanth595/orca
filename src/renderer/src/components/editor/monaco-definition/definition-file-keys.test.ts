import { describe, expect, it } from 'vitest'
import {
  createDefinitionFileRoot,
  joinKey,
  keyDirname,
  keyToFilePath
} from './definition-file-keys'

describe('definition file keys', () => {
  it('keeps the encoded root and appends raw segments, the way TS joins a specifier', () => {
    const root = createDefinitionFileRoot('/Users/me/my app')

    const key = joinKey(`${root.rootKey}/src/feature`, '../../node_modules/@types/react/index.d.ts')

    expect(root.rootKey).toBe('file:///Users/me/my%20app')
    expect(key).toBe('file:///Users/me/my%20app/node_modules/@types/react/index.d.ts')
  })

  it('maps raw and canonical keys back to the same host path', () => {
    const root = createDefinitionFileRoot('/Users/me/my app')
    const raw = `${root.rootKey}/node_modules/@types/react/index.d.ts`
    const canonical = `${root.rootKey}/node_modules/%40types/react/index.d.ts`

    expect(keyToFilePath(root, raw)).toBe('/Users/me/my app/node_modules/@types/react/index.d.ts')
    expect(keyToFilePath(root, canonical)).toBe(
      '/Users/me/my app/node_modules/@types/react/index.d.ts'
    )
  })

  it('maps keys under a Windows drive root to backslash paths', () => {
    const root = createDefinitionFileRoot('C:\\src\\app')

    expect(keyToFilePath(root, `${root.rootKey}/src/index.ts`)).toBe('C:\\src\\app\\src\\index.ts')
  })

  it('refuses keys outside the root and never climbs above the filesystem root', () => {
    const root = createDefinitionFileRoot('/work/app')

    expect(keyToFilePath(root, 'file:///work/other/index.ts')).toBeNull()
    expect(joinKey('file:///work', '../../../etc')).toBe('file:///etc')
    expect(keyDirname('file:///')).toBe('file:///')
  })
})
