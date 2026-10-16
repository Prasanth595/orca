import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  ORCAD_MOBILE_WEB_DIR,
  ORCAD_MOBILE_WEB_MANIFEST,
  orcadMobileWebAssetFilenames
} from '../../src/shared/orcad-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  './verify-packaged-mobile-web-bundle.cjs'
)

/**
 * The built page (pnpm build:mobile-web) into an orcad package. Fatal when it is missing or stale,
 * as electron-builder's beforePack is: a server without it serves phones no page.
 */
export function stageOrcadMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  assertMobileWebBundleBuilt(bundleDir)
  const manifestText = readFileSync(join(bundleDir, 'manifest.json'), 'utf8')
  for (const filename of [
    ORCAD_MOBILE_WEB_MANIFEST,
    ...orcadMobileWebAssetFilenames(manifestText)
  ]) {
    const relativePath = filename.slice(ORCAD_MOBILE_WEB_DIR.length + 1)
    const destination = join(outputDir, ...filename.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(bundleDir, ...relativePath.split('/')), destination)
  }
}

/** The asset half of a package's artifact list, read from the page it carries. */
export function readOrcadMobileWebAssetFilenames(packageDir) {
  return orcadMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...ORCAD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
