import { join, resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createServer, normalizePath } from 'vite'
import { electronViteConfig } from '../../electron.vite.config'
import webConfig from '../../vite.web.config'

describe('renderer workspace module imports', () => {
  for (const [name, config] of [
    ['desktop', electronViteConfig.renderer],
    ['web', webConfig]
  ] as const) {
    it(`${name} loads the Quick Open accumulator through browser ESM`, async () => {
      const cacheDir = await mkdtemp(join(tmpdir(), 'orca-renderer-module-'))
      const server = await createServer({
        ...config,
        configFile: false,
        cacheDir,
        root: resolve('src/renderer'),
        server: { middlewareMode: true },
        optimizeDeps: { noDiscovery: true, include: [] }
      })
      try {
        const importer = await server.transformRequest(
          `/@fs/${normalizePath(resolve('src/shared/quick-open-listing-limits.ts'))}`
        )
        const importUrl = importer?.code.match(/from "([^"]+)"/)?.[1]
        expect(importUrl).toBeDefined()
        if (!importer || !importUrl) {
          throw new Error('Quick Open module was not transformed')
        }
        const dependency = await server.transformRequest(importUrl)
        if (!dependency) {
          throw new Error('GrowingByteBuffer module was not transformed')
        }
        const dependencyPath = join(cacheDir, 'growing-byte-buffer.mjs')
        const importerPath = join(cacheDir, 'quick-open-listing-limits.mjs')
        await writeFile(dependencyPath, dependency.code)
        await writeFile(
          importerPath,
          importer.code.replace(importUrl, pathToFileURL(dependencyPath).href)
        )
        const moduleUrl = pathToFileURL(importerPath).href
        const loaded: unknown = await import(/* @vite-ignore */ moduleUrl)
        expect(loaded).toHaveProperty('QuickOpenSubprocessPathAccumulator', expect.any(Function))
      } finally {
        await server.close()
        await rm(cacheDir, { recursive: true, force: true })
      }
    })
  }
})
