import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import {
  createDefinitionContextLoader,
  createPublishedDefinitionFiles,
  type DefinitionContextSink
} from './definition-context-loader'
import { toPathsCompilerOptions } from './monaco-definition-sink'
import { createMemoryDefinitionFileHost, TEST_ROOT_KEY } from './monaco-definition-test-fixtures'
import type { PathAlias } from './tsconfig-path-aliases'

const root = { rootPath: '/work/app', rootKey: TEST_ROOT_KEY }
const openedKey = `${TEST_ROOT_KEY}/src/app.tsx`
const openedText = [
  "import { useState } from 'react'",
  "import { formatDate } from '@/lib/date'",
  "import { Button } from './ui'",
  "import { parse } from 'parser/strict'",
  'useState; formatDate; Button; parse'
].join('\n')

const projectFiles: Record<string, string> = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
  'src/lib/date.ts': "import { unrelated } from './unrelated'\nexport const formatDate = 1",
  'src/lib/unrelated.ts': 'export const unrelated = 1',
  'src/ui/index.ts': "export { Button } from './button.js'",
  'src/ui/button.tsx': 'export const Button = 1',
  'node_modules/react/package.json': JSON.stringify({ main: 'index.js' }),
  'node_modules/react/index.js': '',
  'node_modules/@types/react/package.json': JSON.stringify({ types: 'index.d.ts' }),
  'node_modules/@types/react/index.d.ts': "export * from './hooks'",
  'node_modules/@types/react/hooks.d.ts': 'export declare function useState<T>(value: T): [T]',
  'node_modules/parser/package.json': JSON.stringify({
    exports: { './strict': { types: './types/strict.d.ts', default: './dist/strict.js' } }
  }),
  'node_modules/parser/types/strict.d.ts': 'export declare function parse(text: string): unknown'
}

function createRecordingSink(): DefinitionContextSink & {
  files: Map<string, string>
  getAliases(): readonly PathAlias[]
} {
  const files = new Map<string, string>()
  let aliases: readonly PathAlias[] = []
  return {
    files,
    getAliases: () => aliases,
    publishFiles(published) {
      for (const [key, text] of published) {
        files.set(key, text)
      }
    },
    publishPathAliases(_rootKey, next) {
      aliases = next
    }
  }
}

/** A language service shaped like Monaco's worker: the opened model plus the published extra libs. */
function definitionFileOf(
  sink: ReturnType<typeof createRecordingSink>,
  symbol: string
): string | undefined {
  const files = new Map([[openedKey, openedText], ...sink.files])
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      ...toPathsCompilerOptions([sink.getAliases()])
    }),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
      const text = files.get(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => 'lib.d.ts',
    fileExists: (fileName) => files.has(fileName),
    readFile: (fileName) => files.get(fileName)
  })
  const position = openedText.lastIndexOf(symbol)
  return service.getDefinitionAtPosition(openedKey, position)?.[0]?.fileName
}

describe('createDefinitionContextLoader', () => {
  it('loads exactly what TS needs to follow imports into project files and node_modules', async () => {
    const host = createMemoryDefinitionFileHost(projectFiles)
    const sink = createRecordingSink()
    const loader = createDefinitionContextLoader(host, root, sink)

    await loader.load(openedKey, openedText)

    expect(definitionFileOf(sink, 'useState;')).toBe(
      `${TEST_ROOT_KEY}/node_modules/@types/react/hooks.d.ts`
    )
    expect(definitionFileOf(sink, 'formatDate;')).toBe(`${TEST_ROOT_KEY}/src/lib/date.ts`)
    expect(definitionFileOf(sink, 'Button;')).toBe(`${TEST_ROOT_KEY}/src/ui/button.tsx`)
    expect(definitionFileOf(sink, 'parse')).toBe(
      `${TEST_ROOT_KEY}/node_modules/parser/types/strict.d.ts`
    )
    // A plain import of an imported file is not on any definition path.
    expect(sink.files.has(`${TEST_ROOT_KEY}/src/lib/unrelated.ts`)).toBe(false)
  })

  it('publishes only new or changed files on a later load', async () => {
    const host = createMemoryDefinitionFileHost(projectFiles)
    const published: ReadonlyMap<string, string>[] = []
    const sink = {
      ...createRecordingSink(),
      publishFiles: (files: ReadonlyMap<string, string>) => published.push(files)
    }
    const loader = createDefinitionContextLoader(host, root, sink)

    await loader.load(openedKey, openedText)
    await loader.load(openedKey, openedText)

    expect(published).toHaveLength(1)
  })

  it('stops loading new files at the shared file limit', async () => {
    const host = createMemoryDefinitionFileHost(projectFiles)
    const sink = createRecordingSink()
    const loader = createDefinitionContextLoader(
      host,
      root,
      sink,
      createPublishedDefinitionFiles(),
      {
        maxFiles: 2,
        maxFileBytes: 1024,
        maxTotalBytes: 1024 * 1024
      }
    )

    await loader.load(openedKey, openedText)

    expect(sink.files.size).toBe(2)
  })
})
