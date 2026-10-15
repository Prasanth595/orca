import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { readRuntimeFilePreview } from '@/runtime/runtime-file-read-client'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { keyToFilePath, type DefinitionFileRoot } from './definition-file-keys'
import type { DefinitionFileHost, DirectoryEntryKind } from './definition-file-host'
import type { DirEntry } from '../../../../../shared/filesystem-entry-types'

// Why short: an install or branch switch changes node_modules under an open tab.
const HOST_CACHE_TTL_MS = 30_000

type CacheEntry<T> = { storedAt: number; value: Promise<T> }

/** Reads through the workspace owner's file routes, so it follows the same host as the editor. */
export function createRuntimeDefinitionFileHost(
  context: RuntimeFileOperationArgs,
  root: DefinitionFileRoot,
  now: () => number = Date.now
): DefinitionFileHost {
  const listings = new Map<string, CacheEntry<ReadonlyMap<string, DirectoryEntryKind> | null>>()
  const texts = new Map<string, CacheEntry<string | null>>()

  const cached = <T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    read: (filePath: string) => Promise<T>,
    missing: T
  ): Promise<T> => {
    const entry = cache.get(key)
    if (entry && now() - entry.storedAt < HOST_CACHE_TTL_MS) {
      return entry.value
    }
    const filePath = keyToFilePath(root, key)
    const value = filePath === null ? Promise.resolve(missing) : read(filePath).catch(() => missing)
    cache.set(key, { storedAt: now(), value })
    return value
  }

  return {
    listDirectory: (directoryKey) =>
      cached(
        listings,
        directoryKey,
        async (directoryPath) => toEntryKinds(await readRuntimeDirectory(context, directoryPath)),
        null
      ),
    readText: (fileKey) =>
      cached(
        texts,
        fileKey,
        async (filePath) => {
          const result = await readRuntimeFilePreview(context, filePath)
          return result.isBinary ? null : result.content
        },
        null
      )
  }
}

function toEntryKinds(entries: DirEntry[]): ReadonlyMap<string, DirectoryEntryKind> {
  return new Map(
    entries.map((entry) => [
      entry.name,
      entry.isSymlink ? 'symlink' : entry.isDirectory ? 'directory' : 'file'
    ])
  )
}
