import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ORCAD_ARTIFACTS, ORCAD_MOBILE_WEB_MANIFEST } from '../../src/shared/orcad-artifacts.ts'
import { writeMobileWebBundleFixtureTree } from './mobile-web-bundle-fixture-tree.mjs'
import {
  readOrcadMobileWebAssetFilenames,
  stageOrcadMobileWebBundle
} from './orcad-mobile-web-bundle.mjs'

let scratch
let bundleDir
let outputDir

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'orcad-mobile-web-'))
  bundleDir = join(scratch, 'mobile-web')
  outputDir = join(scratch, 'orcad')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

it('declares the page manifest as a required orcad artifact', () => {
  const manifest = ORCAD_ARTIFACTS.find(
    (artifact) => artifact.filename === ORCAD_MOBILE_WEB_MANIFEST
  )
  expect(manifest).toBeDefined()
  expect(manifest.optional).toBeUndefined()
})

it('stages the manifest and every asset it lists, byte for byte', async () => {
  const { manifest } = await writeMobileWebBundleFixtureTree({ outDir: bundleDir })
  stageOrcadMobileWebBundle(outputDir, bundleDir)

  const staged = readOrcadMobileWebAssetFilenames(outputDir)
  expect(staged).toHaveLength(manifest.assets.length)
  for (const asset of manifest.assets) {
    expect(readFileSync(join(outputDir, 'out', 'mobile-web', asset.path))).toEqual(
      readFileSync(join(bundleDir, asset.path))
    )
  }
  expect(readFileSync(join(outputDir, ORCAD_MOBILE_WEB_MANIFEST))).toEqual(
    readFileSync(join(bundleDir, 'manifest.json'))
  )
})

it('fails the build when the page was never built', () => {
  expect(() => stageOrcadMobileWebBundle(outputDir, bundleDir)).toThrow('pnpm build:mobile-web')
  expect(existsSync(join(outputDir, ORCAD_MOBILE_WEB_MANIFEST))).toBe(false)
})

it('fails the build on a stale page whose asset no longer matches its manifest', async () => {
  const { manifest } = await writeMobileWebBundleFixtureTree({ outDir: bundleDir })
  writeFileSync(join(bundleDir, manifest.assets[0].path), 'stale')
  expect(() => stageOrcadMobileWebBundle(outputDir, bundleDir)).toThrow(manifest.assets[0].path)
})

it('fails the build when an asset the manifest lists is missing', async () => {
  const { manifest } = await writeMobileWebBundleFixtureTree({ outDir: bundleDir })
  unlinkSync(join(bundleDir, manifest.assets.at(-1).path))
  expect(() => stageOrcadMobileWebBundle(outputDir, bundleDir)).toThrow('missing')
})
