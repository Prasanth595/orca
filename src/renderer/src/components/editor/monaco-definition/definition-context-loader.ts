import { extractModuleReferences, type ModuleReference } from './module-references'
import { resolveModuleFile } from './module-file-resolver'
import { readPathAliases, type PathAlias } from './tsconfig-path-aliases'
import type { DefinitionFileRoot } from './definition-file-keys'
import type { DefinitionFileHost } from './definition-file-host'

export type DefinitionContextSink = {
  /** Called once per load with the files that are new or changed; the worker re-syncs on each call. */
  publishFiles(files: ReadonlyMap<string, string>): void
  publishPathAliases(rootKey: string, aliases: readonly PathAlias[]): void
}

/** What the worker already holds; shared by every root's loader so the limits are global. */
export type PublishedDefinitionFiles = {
  files: Map<string, string>
  bytes: number
}

export function createPublishedDefinitionFiles(): PublishedDefinitionFiles {
  return { files: new Map(), bytes: 0 }
}

export type DefinitionContextLimits = {
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
}

// Why capped: the worker receives every extra lib again on each change, so the set must stay small.
export const DEFAULT_DEFINITION_CONTEXT_LIMITS: DefinitionContextLimits = {
  maxFiles: 1500,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024
}

const DECLARATION_FILE = /\.d\.[mc]?ts$/
const RELATIVE_SPECIFIER = /^\.\.?(?:\/|$)/

type FileRole = 'opened' | 'source' | 'declaration'

export type DefinitionContextLoader = {
  load(fileKey: string, sourceText: string): Promise<void>
}

/**
 * Loads what go-to-definition needs from one opened file: its imports, files re-exporting the
 * symbols onward, and the declaration files a package stitches its types from. Plain imports of
 * imported files are skipped; following them would load the whole project.
 */
export function createDefinitionContextLoader(
  host: DefinitionFileHost,
  root: DefinitionFileRoot,
  sink: DefinitionContextSink,
  published: PublishedDefinitionFiles = createPublishedDefinitionFiles(),
  limits: DefinitionContextLimits = DEFAULT_DEFINITION_CONTEXT_LIMITS
): DefinitionContextLoader {
  return {
    async load(fileKey, sourceText) {
      const aliases = await readPathAliases(host, root, fileKey)
      sink.publishPathAliases(root.rootKey, aliases)
      const visited = new Set<string>([fileKey])
      const changed = new Map<string, string>()

      const include = async (key: string): Promise<void> => {
        if (visited.has(key)) {
          return
        }
        visited.add(key)
        const text = await host.readText(key)
        if (text === null || text.length > limits.maxFileBytes) {
          return
        }
        const previous = published.files.get(key)
        const addedBytes = text.length - (previous?.length ?? 0)
        const overBudget =
          published.bytes + addedBytes > limits.maxTotalBytes ||
          (previous === undefined && published.files.size >= limits.maxFiles)
        if (overBudget) {
          return
        }
        if (previous !== text) {
          published.files.set(key, text)
          published.bytes += addedBytes
          changed.set(key, text)
        }
        if (!key.endsWith('/package.json')) {
          await visit(key, text, DECLARATION_FILE.test(key) ? 'declaration' : 'source')
        }
      }

      const visit = async (key: string, text: string, role: FileRole): Promise<void> => {
        const references = extractModuleReferences(text).filter((reference) =>
          shouldFollow(reference, role)
        )
        await Promise.all(
          references.map(async (reference) => {
            const resolution = await resolveModuleFile(
              host,
              root,
              aliases,
              reference.specifier,
              key
            )
            if (resolution) {
              await Promise.all(
                [...resolution.supportKeys, resolution.moduleKey].map((target) => include(target))
              )
            }
          })
        )
      }

      await visit(fileKey, sourceText, 'opened')
      if (changed.size > 0) {
        sink.publishFiles(changed)
      }
    }
  }
}

function shouldFollow(reference: ModuleReference, role: FileRole): boolean {
  if (role === 'opened' || reference.reexport) {
    return true
  }
  // A package's declaration files import each other to assemble one public surface.
  return role === 'declaration' && RELATIVE_SPECIFIER.test(reference.specifier)
}
