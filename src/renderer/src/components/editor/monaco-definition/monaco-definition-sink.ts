import type { typescript as MonacoTypeScript } from 'monaco-editor'
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

export function createMonacoDefinitionSink(
  languages: readonly LanguageDefaults[]
): DefinitionContextSink {
  // Why here, not at Monaco setup: with the experiment off the worker keeps its stock options.
  for (const language of languages) {
    language.setCompilerOptions({
      ...language.getCompilerOptions(),
      ...DEFINITION_COMPILER_OPTIONS
    })
  }
  const aliasesByRoot = new Map<string, readonly PathAlias[]>()
  let appliedPaths = ''
  return {
    publishFiles(files) {
      for (const [key, text] of files) {
        for (const language of languages) {
          language.addExtraLib(text, key)
        }
      }
    },
    publishPathAliases(rootKey, aliases) {
      // Why recency: TS takes the first substitution whose file exists, and sibling worktrees of one
      // repo hold the same relative files, so the root being read must come first.
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
