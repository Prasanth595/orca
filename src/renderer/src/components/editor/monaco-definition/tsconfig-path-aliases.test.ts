import { describe, expect, it } from 'vitest'
import { readPathAliases } from './tsconfig-path-aliases'
import { createMemoryDefinitionFileHost, TEST_ROOT_KEY } from './monaco-definition-test-fixtures'

const root = { rootPath: '/work/app', rootKey: TEST_ROOT_KEY }

describe('readPathAliases', () => {
  it('reads the nearest config, its baseUrl, and the configs it references', async () => {
    const host = createMemoryDefinitionFileHost({
      'tsconfig.json': `{
        // solution-style root
        "files": [],
        "references": [{ "path": "./config/tsconfig.web.json" }],
        "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/renderer/src/*"] } },
      }`,
      'config/tsconfig.web.json': JSON.stringify({
        compilerOptions: { paths: { '@shared/*': ['../src/shared/*'] } }
      }),
      'src/renderer/src/app.ts': ''
    })

    const aliases = await readPathAliases(host, root, `${TEST_ROOT_KEY}/src/renderer/src/app.ts`)

    expect(aliases).toEqual([
      { pattern: '@/*', substitutions: [`${TEST_ROOT_KEY}/src/renderer/src/*`] },
      { pattern: '@shared/*', substitutions: [`${TEST_ROOT_KEY}/src/shared/*`] }
    ])
  })

  it('inherits paths through a relative extends chain, resolved from the declaring config', async () => {
    const host = createMemoryDefinitionFileHost({
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['./lib/*'] } } }),
      'packages/web/tsconfig.json': JSON.stringify({
        extends: ['@tsconfig/strictest', '../../tsconfig.base']
      }),
      'packages/web/src/main.ts': ''
    })

    const aliases = await readPathAliases(host, root, `${TEST_ROOT_KEY}/packages/web/src/main.ts`)

    expect(aliases).toEqual([{ pattern: '~/*', substitutions: [`${TEST_ROOT_KEY}/lib/*`] }])
  })

  it('returns no aliases when the workspace has no config', async () => {
    const host = createMemoryDefinitionFileHost({ 'src/main.js': '' })

    expect(await readPathAliases(host, root, `${TEST_ROOT_KEY}/src/main.js`)).toEqual([])
  })
})
