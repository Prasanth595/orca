import { describe, it, expect } from 'vitest'
import { defaultHttpRequestData, normalizeHttpRequestData } from './workflow-http-request-defaults'

describe('normalizeHttpRequestData', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(normalizeHttpRequestData(undefined)).toEqual(defaultHttpRequestData())
    expect(normalizeHttpRequestData('nope')).toEqual(defaultHttpRequestData())
  })

  it('keeps valid values and replaces invalid ones', () => {
    const d = normalizeHttpRequestData({
      method: 'patch',
      url: 'https://x',
      auth: { type: 'bearer', token: 't' },
      headers: [{ name: 'a', value: 'b' }, 'junk', { name: 3 }],
      bodyContentType: 'xml',
      bodyParameters: [
        { name: 'f', value: '/p', kind: 'file' },
        { name: 'g', kind: 'weird' }
      ],
      options: {
        timeoutMs: '1500',
        maxRedirects: -1,
        responseFormat: 'file',
        outputField: '',
        pagination: { mode: 'nextUrl', maxPages: 'abc', parameters: [{ location: 'nowhere' }] }
      }
    })
    expect(d.method).toBe('PATCH')
    expect(d.auth).toMatchObject({ type: 'bearer', token: 't', username: '' })
    expect(d.headers).toEqual([
      { name: 'a', value: 'b' },
      { name: '', value: '' }
    ])
    expect(d.bodyContentType).toBe('json')
    expect(d.bodyParameters).toEqual([
      { name: 'f', value: '/p', kind: 'file' },
      { name: 'g', value: '', kind: 'text' }
    ])
    expect(d.options.timeoutMs).toBe(1500)
    expect(d.options.maxRedirects).toBe(21)
    expect(d.options.responseFormat).toBe('file')
    expect(d.options.outputField).toBe('data')
    expect(d.options.pagination).toMatchObject({
      mode: 'nextUrl',
      maxPages: 100,
      parameters: [{ location: 'query', name: '', value: '' }]
    })
  })
})
