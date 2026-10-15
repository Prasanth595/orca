import { parse } from 'jsonc-parser'
import { keyBasename, keyDirname } from './definition-file-keys'

export type DirectoryEntryKind = 'file' | 'directory' | 'symlink'

/** Read access to the workspace's host; every method resolves `null` instead of throwing. */
export type DefinitionFileHost = {
  listDirectory(directoryKey: string): Promise<ReadonlyMap<string, DirectoryEntryKind> | null>
  readText(fileKey: string): Promise<string | null>
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function entryKind(
  host: DefinitionFileHost,
  key: string
): Promise<DirectoryEntryKind | undefined> {
  const listing = await host.listDirectory(keyDirname(key))
  return listing?.get(keyBasename(key))
}

// Why symlinks count as both: pnpm links every package directory, and a listing doesn't follow them.
export async function isHostFile(host: DefinitionFileHost, key: string): Promise<boolean> {
  const kind = await entryKind(host, key)
  return kind === 'file' || kind === 'symlink'
}

export async function isHostDirectory(host: DefinitionFileHost, key: string): Promise<boolean> {
  const kind = await entryKind(host, key)
  return kind === 'directory' || kind === 'symlink'
}

/** Probes in parallel but honors candidate order, like TS's extension priority. */
export async function firstHostFile(
  host: DefinitionFileHost,
  candidates: readonly string[]
): Promise<string | null> {
  const exists = await Promise.all(candidates.map((candidate) => isHostFile(host, candidate)))
  return candidates[exists.indexOf(true)] ?? null
}

/** tsconfig.json allows comments and trailing commas. */
export function parseJsonObject(text: string | null): JsonObject | null {
  if (text === null) {
    return null
  }
  const value: unknown = parse(text, [], { allowTrailingComma: true })
  return isJsonObject(value) ? value : null
}
