import type { IDisposable, typescript as MonacoTypeScript } from 'monaco-editor'
import type { DefinitionContextSink } from './definition-context-loader'
import type { PathAlias } from './tsconfig-path-aliases'

type LanguageDefaults = Pick<
  MonacoTypeScript.LanguageServiceDefaults,
  'addExtraLib' | 'getCompilerOptions' | 'setCompilerOptions'
>

// Why a widened number: TS 5's `bundler` resolution (reads package `exports`) postdates Monaco's enum.
const MODULE_RESOLUTION_BUNDLER: number = 100
const MODULE_ESNEXT = 99

/** Lets the worker resolve imports the way a bundler-era project does, over the files we load. */
const DEFINITION_COMPILER_OPTIONS: MonacoTypeScript.CompilerOptions = {
  moduleResolution: MODULE_RESOLUTION_BUNDLER,
  module: MODULE_ESNEXT,
  allowJs: true
}

export type MonacoDefinitionSink = DefinitionContextSink & {
  /** Moves a root's aliases to the front without reading anything; no-op for an unknown root. */
  preferRoot(rootKey: string): void
  /** Drops every published file and restores the options the worker had before the sink. */
  dispose(): void
}

export function createMonacoDefinitionSink(
  languages: readonly LanguageDefaults[]
): MonacoDefinitionSink {
  const originalOptions = languages.map((language) => language.getCompilerOptions())
  // Why here, not at Monaco setup: with the experiment off the worker keeps its stock options.
  for (const language of languages) {
    language.setCompilerOptions({
      ...language.getCompilerOptions(),
      ...DEFINITION_COMPILER_OPTIONS
    })
  }
  const libsByKey = new Map<string, IDisposable[]>()
  const aliasesByRoot = new Map<string, readonly PathAlias[]>()
  let appliedPaths = ''
  // Why: a load already in flight when the experiment turns off still finishes into this sink.
  let disposed = false

  const publishPathAliases = (rootKey: string, aliases: readonly PathAlias[]): void => {
    if (disposed) {
      return
    }
    // Why recency: TS takes the first substitution whose file exists, and sibling worktrees of one
    // repo hold the same relative files, so the root being read or edited must come first.
    aliasesByRoot.delete(rootKey)
    aliasesByRoot.set(rootKey, aliases)
    const pathsOptions = toPathsCompilerOptions(Array.from(aliasesByRoot.values()).toReversed())
    const serialized = JSON.stringify(pathsOptions)
    if (serialized === appliedPaths) {
      return
    }
    appliedPaths = serialized
    // Changing compiler options restarts the worker, so only a real change gets here.
    for (const language of languages) {
      language.setCompilerOptions({ ...language.getCompilerOptions(), ...pathsOptions })
    }
  }

  return {
    publishFiles(files) {
      if (disposed) {
        return
      }
      for (const [key, text] of files) {
        // Re-adding a key replaces its lib, so only the latest handle can still remove it.
        libsByKey.set(
          key,
          languages.map((language) => language.addExtraLib(text, key))
        )
      }
    },
    publishPathAliases,
    preferRoot(rootKey) {
      const aliases = aliasesByRoot.get(rootKey)
      if (aliases) {
        publishPathAliases(rootKey, aliases)
      }
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      for (const libs of libsByKey.values()) {
        for (const lib of libs) {
          lib.dispose()
        }
      }
      libsByKey.clear()
      aliasesByRoot.clear()
      languages.forEach((language, index) => language.setCompilerOptions(originalOptions[index]))
    }
  }
}

export function toPathsCompilerOptions(aliasesByPriority: readonly (readonly PathAlias[])[]): {
  paths: Record<string, string[]>
  pathsBasePath: string
} {
  const paths: Record<string, string[]> = {}
  for (const aliases of aliasesByPriority) {
    for (const alias of aliases) {
      paths[alias.pattern] = [...(paths[alias.pattern] ?? []), ...alias.substitutions]
    }
  }
  // Why: substitutions are absolute, but TS still needs a base to print module specifiers;
  // without a tsconfig path or baseUrl it throws inside definition and hover requests.
  return { paths, pathsBasePath: 'file:///' }
}
