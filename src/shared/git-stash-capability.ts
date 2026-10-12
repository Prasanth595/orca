export function isStashStagedUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const stderr =
    'stderr' in error && typeof error.stderr === 'string' ? error.stderr : error.message
  return /unknown (?:option|switch)\s+['`](?:--)?staged['`]/i.test(stderr)
}
