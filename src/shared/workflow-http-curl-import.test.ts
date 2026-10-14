import { describe, it, expect } from 'vitest'
import { parseCurlCommand, tokenizeShellCommand } from './workflow-http-curl-import'

describe('tokenizeShellCommand', () => {
  it('handles quotes, escapes, ANSI-C strings and line continuations', () => {
    expect(tokenizeShellCommand(`curl 'a b' "c \\"d\\"" e\\ f \\\n  $'g\\nh' --x=1`)).toEqual([
      'curl',
      'a b',
      'c "d"',
      'e f',
      'g\nh',
      '--x=1'
    ])
  })
})

describe('parseCurlCommand', () => {
  it('parses a simple GET and splits the query string into fields', () => {
    const d = parseCurlCommand('curl https://api.example.com/items?limit=10&q=a%20b')
    expect(d.method).toBe('GET')
    expect(d.url).toBe('https://api.example.com/items')
    expect(d.sendQuery).toBe(true)
    expect(d.queryParameters).toEqual([
      { name: 'limit', value: '10' },
      { name: 'q', value: 'a b' }
    ])
    expect(d.sendBody).toBe(false)
  })

  it('parses a JSON POST with headers', () => {
    const d = parseCurlCommand(`curl -X POST https://api.example.com/users \\
      -H 'Content-Type: application/json' \\
      -H 'Authorization: Bearer abc' \\
      --data-raw '{"name":"Ada"}'`)
    expect(d.method).toBe('POST')
    expect(d.sendBody).toBe(true)
    expect(d.bodyContentType).toBe('json')
    expect(d.bodyMode).toBe('json')
    expect(JSON.parse(d.bodyJson)).toEqual({ name: 'Ada' })
    // Content-Type is implied by the body type, so only Authorization stays a header.
    expect(d.headers).toEqual([{ name: 'Authorization', value: 'Bearer abc' }])
  })

  it('defaults -d to a form-urlencoded POST with fields', () => {
    const d = parseCurlCommand(`curl https://x.test -d 'a=1' -d 'b=two'`)
    expect(d.method).toBe('POST')
    expect(d.bodyContentType).toBe('form_urlencoded')
    expect(d.bodyParameters).toEqual([
      { name: 'a', value: '1', kind: 'text' },
      { name: 'b', value: 'two', kind: 'text' }
    ])
  })

  it('detects JSON bodies without a content type and --json', () => {
    expect(parseCurlCommand(`curl https://x.test -d '{"a":1}'`).bodyContentType).toBe('json')
    const d = parseCurlCommand(`curl https://x.test --json '[1,2]'`)
    expect(d.bodyContentType).toBe('json')
    expect(d.method).toBe('POST')
  })

  it('keeps unknown content types as raw bodies', () => {
    const d = parseCurlCommand(
      `curl -X PUT https://x.test -H 'content-type: text/csv' --data-binary 'a,b'`
    )
    expect(d.bodyContentType).toBe('raw')
    expect(d.rawContentType).toBe('text/csv')
    expect(d.rawBody).toBe('a,b')
    expect(d.sendHeaders).toBe(false)
  })

  it('parses multipart forms with file parts', () => {
    const d = parseCurlCommand(`curl https://x.test -F 'title=Hi' -F 'file=@/tmp/a.png'`)
    expect(d.method).toBe('POST')
    expect(d.bodyContentType).toBe('multipart')
    expect(d.bodyParameters).toEqual([
      { name: 'title', value: 'Hi', kind: 'text' },
      { name: 'file', value: '/tmp/a.png', kind: 'file' }
    ])
  })

  it('maps auth and transport flags', () => {
    const d = parseCurlCommand(
      `curl --digest -u 'me:pw:x' -k -L --max-redirs 3 -m 2.5 -x http://proxy:8080 -A bot https://x.test`
    )
    expect(d.auth).toMatchObject({ type: 'digest', username: 'me', password: 'pw:x' })
    expect(d.options).toMatchObject({
      ignoreSsl: true,
      followRedirects: true,
      maxRedirects: 3,
      timeoutMs: 2500,
      proxy: 'http://proxy:8080'
    })
    expect(d.headers).toEqual([{ name: 'User-Agent', value: 'bot' }])
    expect(parseCurlCommand(`curl -u a:b https://x.test`).auth.type).toBe('basic')
  })

  it('moves data into the query with -G and honors -I and --url=', () => {
    const g = parseCurlCommand(`curl -G https://x.test -d 'q=1'`)
    expect(g.method).toBe('GET')
    expect(g.sendBody).toBe(false)
    expect(g.queryParameters).toEqual([{ name: 'q', value: '1' }])
    expect(parseCurlCommand(`curl -I --url=https://x.test`).method).toBe('HEAD')
  })

  it('keeps {{}} templates intact', () => {
    const d = parseCurlCommand(
      `curl 'https://x.test/users/{{steps.a.json.id}}' -H 'X-Token: {{steps.a.json.token}}'`
    )
    expect(decodeURI(d.url)).toBe('https://x.test/users/{{steps.a.json.id}}')
    expect(d.headers).toEqual([{ name: 'X-Token', value: '{{steps.a.json.token}}' }])
  })

  it('throws when there is no URL', () => {
    expect(() => parseCurlCommand('curl -X POST')).toThrow(/No URL/)
  })
})
