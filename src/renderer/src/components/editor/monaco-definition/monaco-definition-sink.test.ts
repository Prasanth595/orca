import { describe, expect, it, vi } from 'vitest'
import type { typescript as MonacoTypeScript } from 'monaco-editor'
import { createMonacoDefinitionSink } from './monaco-definition-sink'

function createLanguageDefaults(): {
  addExtraLib: (content: string, filePath?: string) => { dispose(): void }
  getCompilerOptions: () => MonacoTypeScript.CompilerOptions
  setCompilerOptions: (options: MonacoTypeScript.CompilerOptions) => void
  applied: MonacoTypeScript.CompilerOptions[]
} {
  let options: MonacoTypeScript.CompilerOptions = { allowJs: true }
  const applied: MonacoTypeScript.CompilerOptions[] = []
  return {
    addExtraLib: vi.fn((_content: string, _filePath?: string) => ({ dispose: () => {} })),
    getCompilerOptions: () => options,
    setCompilerOptions: (next) => {
      options = next
      applied.push(next)
    },
    applied
  }
}

const aliasesOf = (root: string): { pattern: string; substitutions: string[] }[] => [
  { pattern: '@/*', substitutions: [`${root}/src/*`] }
]

describe('createMonacoDefinitionSink', () => {
  it('puts the most recently read root first for an alias sibling worktrees share', () => {
    const defaults = createLanguageDefaults()
    const sink = createMonacoDefinitionSink([defaults])

    sink.publishPathAliases('file:///a', aliasesOf('file:///a'))
    sink.publishPathAliases('file:///b', aliasesOf('file:///b'))

    expect(defaults.getCompilerOptions()).toMatchObject({
      allowJs: true,
      paths: { '@/*': ['file:///b/src/*', 'file:///a/src/*'] }
    })
  })

  it('leaves compiler options alone, and the worker running, when the aliases are unchanged', () => {
    const defaults = createLanguageDefaults()
    const sink = createMonacoDefinitionSink([defaults])

    sink.publishPathAliases('file:///a', aliasesOf('file:///a'))
    sink.publishPathAliases('file:///a', aliasesOf('file:///a'))

    expect(defaults.applied).toHaveLength(1)
  })

  it('registers each file with every language under its key', () => {
    const typescriptDefaults = createLanguageDefaults()
    const javascriptDefaults = createLanguageDefaults()
    const sink = createMonacoDefinitionSink([typescriptDefaults, javascriptDefaults])

    sink.publishFiles(new Map([['file:///a/src/x.ts', 'export {}']]))

    expect(typescriptDefaults.addExtraLib).toHaveBeenCalledWith('export {}', 'file:///a/src/x.ts')
    expect(javascriptDefaults.addExtraLib).toHaveBeenCalledWith('export {}', 'file:///a/src/x.ts')
  })
})
