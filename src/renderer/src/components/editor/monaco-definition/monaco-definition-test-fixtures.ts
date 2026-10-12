import type { DefinitionFileHost, DirectoryEntryKind } from './definition-file-host'
import { keyDirname } from './definition-file-keys'

export const TEST_ROOT_KEY = 'file:///work/app'

/** An in-memory host over `{ 'relative/path': text }`; symlinked package folders list as `symlink`. */
export function createMemoryDefinitionFileHost(
  files: Record<string, string>,
  options: { symlinkedDirectories?: string[] } = {}
): DefinitionFileHost & { reads: string[] } {
  const texts = new Map(
    Object.entries(files).map(([relativePath, text]) => [`${TEST_ROOT_KEY}/${relativePath}`, text])
  )
  const symlinks = new Set(
    (options.symlinkedDirectories ?? []).map((relativePath) => `${TEST_ROOT_KEY}/${relativePath}`)
  )
  const listings = new Map<string, Map<string, DirectoryEntryKind>>()
  for (const fileKey of texts.keys()) {
    let child = fileKey
    let kind: DirectoryEntryKind = 'file'
    while (child !== TEST_ROOT_KEY && child.startsWith(TEST_ROOT_KEY)) {
      const parent = keyDirname(child)
      const listing = listings.get(parent) ?? new Map<string, DirectoryEntryKind>()
      listing.set(child.slice(parent.length + 1), symlinks.has(child) ? 'symlink' : kind)
      listings.set(parent, listing)
      child = parent
      kind = 'directory'
    }
  }
  const reads: string[] = []
  return {
    reads,
    listDirectory: async (directoryKey) => listings.get(directoryKey) ?? null,
    readText: async (fileKey) => {
      reads.push(fileKey)
      return texts.get(fileKey) ?? null
    }
  }
}
