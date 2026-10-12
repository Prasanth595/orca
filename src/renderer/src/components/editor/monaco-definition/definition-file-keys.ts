import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { joinPath } from '@/lib/path'
import { toEditorModelUri } from '../editor-model-uri'

/**
 * A file key is the name the TS worker uses for a file: the workspace root as Monaco encodes it,
 * then raw `/` segments. TS builds exactly these strings when it joins a specifier onto an
 * importer's directory, so extra libs keyed this way are found without any decoding.
 */
export type DefinitionFileRoot = {
  rootPath: string
  rootKey: string
}

const FILE_KEY_PREFIX = 'file://'

export function createDefinitionFileRoot(rootPath: string): DefinitionFileRoot {
  return { rootPath, rootKey: toEditorModelUri(rootPath) }
}

export function isKeyInsideRoot(root: DefinitionFileRoot, key: string): boolean {
  return key === root.rootKey || key.startsWith(`${root.rootKey}/`)
}

function keyPathSegments(key: string): string[] {
  return key.slice(FILE_KEY_PREFIX.length).split('/').filter(Boolean)
}

function toKey(segments: readonly string[]): string {
  return `${FILE_KEY_PREFIX}/${segments.join('/')}`
}

export function keyDirname(key: string): string {
  return toKey(keyPathSegments(key).slice(0, -1))
}

export function keyBasename(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

export function joinKey(directoryKey: string, relativePath: string): string {
  const segments = keyPathSegments(directoryKey)
  for (const part of relativePath.split('/')) {
    if (part === '..') {
      segments.pop()
    } else if (part !== '' && part !== '.') {
      segments.push(part)
    }
  }
  return toKey(segments)
}

/** Accepts both raw keys and the canonical URIs Monaco hands back for them. */
export function keyToFilePath(root: DefinitionFileRoot, key: string): string | null {
  const canonical = URI.parse(key).with({ fragment: '' }).toString()
  if (canonical === root.rootKey) {
    return root.rootPath
  }
  if (!canonical.startsWith(`${root.rootKey}/`)) {
    return null
  }
  const relativePath = canonical
    .slice(root.rootKey.length + 1)
    .split('/')
    .map(decodeURIComponent)
    .join('/')
  return joinPath(root.rootPath, relativePath)
}
