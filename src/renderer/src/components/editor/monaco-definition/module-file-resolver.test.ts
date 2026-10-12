import { describe, expect, it } from 'vitest'
import { resolveExportsTarget, resolveModuleFile } from './module-file-resolver'
import { createMemoryDefinitionFileHost, TEST_ROOT_KEY } from './monaco-definition-test-fixtures'
import type { PathAlias } from './tsconfig-path-aliases'

const root = { rootPath: '/work/app', rootKey: TEST_ROOT_KEY }
const importer = `${TEST_ROOT_KEY}/src/feature/view.tsx`

async function resolve(
  files: Record<string, string>,
  specifier: string,
  aliases: PathAlias[] = []
): Promise<{ moduleKey: string; supportKeys: string[] } | null> {
  const host = createMemoryDefinitionFileHost(files, {
    symlinkedDirectories: ['node_modules/linked']
  })
  return resolveModuleFile(host, root, aliases, specifier, importer)
}

describe('resolveModuleFile', () => {
  it('prefers the TypeScript source an ESM `.js` import names', async () => {
    const result = await resolve(
      { 'src/feature/model.ts': '', 'src/feature/model.js': '' },
      './model.js'
    )

    expect(result?.moduleKey).toBe(`${TEST_ROOT_KEY}/src/feature/model.ts`)
  })

  it('falls back to a directory index', async () => {
    const result = await resolve({ 'src/shared/index.tsx': '' }, '../shared')

    expect(result?.moduleKey).toBe(`${TEST_ROOT_KEY}/src/shared/index.tsx`)
  })

  it('tries each alias substitution in order', async () => {
    const aliases = [
      {
        pattern: '@/*',
        substitutions: [`${TEST_ROOT_KEY}/missing/*`, `${TEST_ROOT_KEY}/src/*`]
      }
    ]

    const result = await resolve({ 'src/lib/format.ts': '' }, '@/lib/format', aliases)

    expect(result?.moduleKey).toBe(`${TEST_ROOT_KEY}/src/lib/format.ts`)
  })

  it('follows a package `exports` subpath to its declarations and loads the manifest', async () => {
    const manifest = JSON.stringify({
      exports: { './client': { import: './dist/client.js', default: './dist/client.cjs' } }
    })

    const result = await resolve(
      {
        'node_modules/linked/package.json': manifest,
        'node_modules/linked/dist/client.d.ts': '',
        'node_modules/linked/dist/client.js': ''
      },
      'linked/client'
    )

    expect(result).toEqual({
      moduleKey: `${TEST_ROOT_KEY}/node_modules/linked/dist/client.d.ts`,
      supportKeys: [`${TEST_ROOT_KEY}/node_modules/linked/package.json`]
    })
  })

  it('uses the DefinitelyTyped package when the package ships no types', async () => {
    const result = await resolve(
      {
        'node_modules/@scope/plain/package.json': JSON.stringify({ main: 'index.js' }),
        'node_modules/@scope/plain/index.js': '',
        'node_modules/@types/scope__plain/package.json': JSON.stringify({ types: 'index.d.ts' }),
        'node_modules/@types/scope__plain/index.d.ts': ''
      },
      '@scope/plain'
    )

    expect(result).toEqual({
      moduleKey: `${TEST_ROOT_KEY}/node_modules/@types/scope__plain/index.d.ts`,
      supportKeys: [`${TEST_ROOT_KEY}/node_modules/@types/scope__plain/package.json`]
    })
  })

  it('maps Node built-ins onto @types/node', async () => {
    const result = await resolve(
      {
        'node_modules/@types/node/package.json': JSON.stringify({ types: 'index.d.ts' }),
        'node_modules/@types/node/index.d.ts': ''
      },
      'node:fs'
    )

    expect(result?.moduleKey).toBe(`${TEST_ROOT_KEY}/node_modules/@types/node/index.d.ts`)
  })

  it('does not search above the workspace root', async () => {
    const result = await resolve({}, 'outside')

    expect(result).toBeNull()
  })
})

describe('resolveExportsTarget', () => {
  it('matches the longest wildcard key and substitutes the match', () => {
    const exports = {
      './*': './dist/*.js',
      './icons/*': { types: './types/icons/*.d.ts', default: './dist/icons/*.js' }
    }

    expect(resolveExportsTarget(exports, './icons/arrow')).toBe('./types/icons/arrow.d.ts')
  })

  it('ignores conditions a bundler never matches', () => {
    const exports = { node: './node.js', browser: './browser.js', default: './index.js' }

    expect(resolveExportsTarget(exports, '.')).toBe('./index.js')
  })
})
