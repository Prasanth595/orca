import { describe, expect, it } from 'vitest'
import { redactPlaneSecrets } from './plane-redact'

describe('redactPlaneSecrets', () => {
  it('removes Plane tokens and API-key headers', () => {
    expect(
      redactPlaneSecrets('failed with plane_api_abc123DEF and {"X-API-Key": "k-999999"}')
    ).toBe('failed with [redacted] and {"X-API-Key": "[redacted]"}')
  })

  it('removes the given secrets but ignores very short ones', () => {
    expect(redactPlaneSecrets('token custom-secret-1 abc', ['custom-secret-1', 'abc'])).toBe(
      'token [redacted] abc'
    )
  })
})
