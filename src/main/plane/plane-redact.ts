// Plane personal access tokens are `plane_api_` followed by an opaque key.
const PLANE_TOKEN_PATTERN = /plane_api_[A-Za-z0-9_-]+/g
const API_KEY_HEADER_PATTERN = /(x-api-key["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi
// Why a floor: replacing a very short "secret" would shred unrelated text.
const MIN_REDACTED_SECRET_LENGTH = 8
export const PLANE_REDACTED = '[redacted]'

/** Strips Plane tokens, API-key headers and the given secrets from text bound for logs or spans. */
export function redactPlaneSecrets(text: string, secrets: readonly string[] = []): string {
  let redacted = text
  for (const secret of secrets) {
    if (secret.length >= MIN_REDACTED_SECRET_LENGTH) {
      redacted = redacted.split(secret).join(PLANE_REDACTED)
    }
  }
  return redacted
    .replace(PLANE_TOKEN_PATTERN, PLANE_REDACTED)
    .replace(API_KEY_HEADER_PATTERN, `$1${PLANE_REDACTED}`)
}
