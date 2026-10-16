import {
  MobileWebBundleManifestReadSchema,
  type MobileWebBundleManifestRead
} from '../transport/mobile-web-bundle-reply-schemas'

/** The activation's manifest: a generation directory is an activation only once this is in it. */
export const MANIFEST_FILE_NAME = 'manifest.json'

/** Read back as loosely as it was accepted: reading a cached manifest strictly would make a field a
 *  newer desktop added a forced redownload on every launch. */
export function parseGenerationManifest(text: string | null): MobileWebBundleManifestRead | null {
  if (text === null) {
    return null
  }
  try {
    const parsed = MobileWebBundleManifestReadSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
