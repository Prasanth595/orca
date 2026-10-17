import { describe, expect, it, vi } from 'vitest'
import {
  classifyLinearError,
  linearRetryMetadata,
  sanitizeLinearErrorMessage
} from './issue-context-errors'

describe('sanitizeLinearErrorMessage', () => {
  it('removes stack frames without regex line splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    try {
      expect(
        sanitizeLinearErrorMessage('Linear request failed\r\n    at request (sdk.js:10:2)')
      ).toBe('Linear request failed')
      const usedStackSplit = splitSpy.mock.calls.some(
        ([separator]) => separator instanceof RegExp && separator.source === '\\r?\\n\\s+at\\s+'
      )
      expect(usedStackSplit).toBe(false)
    } finally {
      splitSpy.mockRestore()
    }
  })

  it('redacts sensitive Linear payloads after trimming stack frames', () => {
    expect(
      sanitizeLinearErrorMessage(
        'Request failed authorization: Bearer secret-token\n    at request (sdk.js:10:2)'
      )
    ).toBe('Request failed authorization: Bearer [REDACTED]')
  })
})

describe('structured Linear failures', () => {
  it.each([
    [{ status: 401 }, 'linear_auth_expired'],
    [{ status: 403 }, 'linear_permission_denied'],
    [{ status: 429 }, 'linear_rate_limited'],
    [{ type: 'AuthenticationError' }, 'linear_auth_expired'],
    [{ type: 'Forbidden' }, 'linear_permission_denied'],
    [{ type: 'Ratelimited', status: 400 }, 'linear_rate_limited']
  ] as const)('prioritizes SDK fields over misleading message text: %j', (fields, code) => {
    const error = Object.assign(new Error('network timeout 429 forbidden'), fields)
    expect(classifyLinearError(error)).toBe(code)
  })

  it.each([Number.NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '120', null, {}])(
    'omits unsafe timing %s',
    (value) => {
      expect(
        linearRetryMetadata(
          { retryAfter: value, requestsResetAt: value, complexityResetAt: value },
          'linear_rate_limited'
        )
      ).toBeUndefined()
    }
  )

  it('retains valid zero and fractional delays without returning SDK payloads', () => {
    expect(
      linearRetryMetadata(
        {
          retryAfter: 0.5,
          requestsResetAt: 0,
          complexityResetAt: 1792022580000,
          raw: { token: 'secret' },
          data: { content: 'private' }
        },
        'linear_rate_limited'
      )
    ).toEqual({ retryAfterSeconds: 0.5, requestsResetAtMs: 0, complexityResetAtMs: 1792022580000 })
    expect(linearRetryMetadata({ retryAfter: 120 }, 'linear_permission_denied')).toBeUndefined()
    expect(classifyLinearError(new Error('unknown failure'))).toBe('linear_network_error')
  })
})
