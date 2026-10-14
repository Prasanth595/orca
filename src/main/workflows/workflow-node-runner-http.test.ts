import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHttpRequestNode, runHttpRequestNode } from './workflow-node-runner-http'
import { localHttpTransport } from './workflow-http-transport'
import { defaultHttpRequestData } from '../../shared/workflow-http-request-defaults'
import type { HttpRequestData, HttpRequestOptions } from '../../shared/workflow-http-request-types'

function portOf(server: http.Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Server is not listening on a TCP port')
  }
  return address.port
}

type Echo = {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

let server: http.Server
let proxy: http.Server
let base = ''
let proxyUrl = ''
let tmpDir = ''
const rawHeaderNames: string[][] = []

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  rawHeaderNames.push(req.rawHeaders.filter((_, i) => i % 2 === 0))
  if (path === '/echo') {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    sendJson(res, 200, { method: req.method, url: req.url, headers, body: body.toString('utf8') })
    return
  }
  if (path === '/text') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('hello world')
    return
  }
  if (path.startsWith('/status/')) {
    sendJson(res, Number(path.split('/')[2]), { error: 'nope' })
    return
  }
  if (path.startsWith('/redirect/')) {
    const n = Number(path.split('/')[2])
    res.writeHead(302, { location: n <= 1 ? '/echo' : `/redirect/${n - 1}` })
    res.end()
    return
  }
  if (path === '/see-other') {
    res.writeHead(303, { location: '/echo' })
    res.end()
    return
  }
  if (path === '/gzip') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
    res.end(gzipSync(JSON.stringify({ zipped: true })))
    return
  }
  if (path === '/binary') {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    return
  }
  if (path === '/slow') {
    setTimeout(() => sendJson(res, 200, { slow: true }), 500)
    return
  }
  if (path === '/digest') {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Digest ')) {
      res.writeHead(401, {
        'www-authenticate': 'Digest realm="test", nonce="abc123", qop="auth", opaque="op"'
      })
      res.end()
      return
    }
    const p: Record<string, string> = {}
    for (const m of auth.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
      p[m[1]!] = m[2] ?? m[3] ?? ''
    }
    const ha1 = md5(`u:test:p`)
    const ha2 = md5(`${req.method}:${p.uri}`)
    const expected = md5(`${ha1}:abc123:${p.nc}:${p.cnonce}:auth:${ha2}`)
    sendJson(res, p.response === expected && p.opaque === 'op' ? 200 : 403, { digest: true })
    return
  }
  if (path === '/pages') {
    const page = Number(url.searchParams.get('page') ?? '1')
    sendJson(res, 200, page <= 3 ? [`item${page}a`, `item${page}b`] : [])
    return
  }
  if (path === '/pages-status') {
    const page = Number(url.searchParams.get('page') ?? '1')
    sendJson(res, page <= 2 ? 200 : 404, { page })
    return
  }
  if (path === '/cursor') {
    const cursor = Number(url.searchParams.get('cursor') ?? '0')
    const next = cursor < 2 ? `/cursor?cursor=${cursor + 1}` : null
    sendJson(res, 200, { items: [cursor], next, hasMore: cursor < 2 })
    return
  }
  sendJson(res, 404, { error: 'unknown route' })
}

function listen(s: http.Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${portOf(s)}`))
  )
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => handle(req, res, Buffer.concat(chunks)))
  })
  // Plain-HTTP proxy: requests arrive with an absolute URL as the target.
  proxy = http.createServer((req, res) =>
    sendJson(res, 200, { proxiedUrl: req.url, proxyAuth: req.headers['proxy-authorization'] })
  )
  base = await listen(server)
  proxyUrl = await listen(proxy)
  tmpDir = await mkdtemp(join(tmpdir(), 'orca-http-runner-test-'))
})

afterAll(async () => {
  server.close()
  proxy.close()
  await rm(tmpDir, { recursive: true, force: true })
})

function makeData(
  patch: Partial<Omit<HttpRequestData, 'options'>> & { options?: Partial<HttpRequestOptions> }
): HttpRequestData {
  const d = defaultHttpRequestData()
  return { ...d, ...patch, options: { ...d.options, ...patch.options } }
}

async function run(
  patch: Parameters<typeof makeData>[0]
): Promise<{ stdout: string; outputValue: unknown }> {
  return runHttpRequestNode(makeData(patch), localHttpTransport)
}

async function echo(patch: Parameters<typeof makeData>[0]): Promise<Echo> {
  const r = await run({ url: `${base}/echo`, ...patch })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: /echo always returns the Echo shape
  return r.outputValue as Echo
}

describe('runHttpRequestNode — methods and URL', () => {
  it('GETs JSON and parses it (autodetect)', async () => {
    const r = await run({ url: `${base}/echo` })
    expect(r.outputValue).toMatchObject({ method: 'GET', url: '/echo' })
    expect(JSON.parse(r.stdout)).toMatchObject({ method: 'GET' })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)('sends %s', async (method) => {
    expect((await echo({ method })).method).toBe(method)
  })

  it('HEAD returns no body', async () => {
    const r = await run({
      url: `${base}/echo`,
      method: 'HEAD',
      options: { includeResponseMeta: true }
    })
    expect(r.outputValue).toMatchObject({ statusCode: 200, body: null })
  })

  it('adds http:// when the scheme is missing', async () => {
    const r = await run({ url: `${base.replace('http://', '')}/echo` })
    expect(r.outputValue).toMatchObject({ method: 'GET' })
  })

  it('rejects an empty URL', async () => {
    await expect(run({ url: '  ' })).rejects.toThrow(/URL is required/)
  })
})

describe('runHttpRequestNode — query parameters', () => {
  it('sends query fields', async () => {
    const e = await echo({
      sendQuery: true,
      queryParameters: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'x y' },
        { name: '', value: 'ignored' }
      ]
    })
    expect(e.url).toBe('/echo?a=1&b=x+y')
  })

  it.each([
    ['noBrackets', '/echo?ids=1&ids=2'],
    ['brackets', '/echo?ids%5B%5D=1&ids%5B%5D=2'],
    ['indices', '/echo?ids%5B0%5D=1&ids%5B1%5D=2']
  ] as const)('encodes JSON arrays with %s format', async (arrayFormat, expected) => {
    const e = await echo({
      sendQuery: true,
      queryMode: 'json',
      queryJson: '{"ids": [1, 2]}',
      options: { arrayFormat }
    })
    expect(e.url).toBe(expected)
  })

  it('reports invalid query JSON', async () => {
    await expect(
      run({ url: `${base}/echo`, sendQuery: true, queryMode: 'json', queryJson: '{bad' })
    ).rejects.toThrow(/Query parameters is not valid JSON/)
  })
})

describe('runHttpRequestNode — headers', () => {
  it('sends header fields and JSON headers', async () => {
    const fields = await echo({ sendHeaders: true, headers: [{ name: 'X-One', value: '1' }] })
    expect(fields.headers['x-one']).toBe('1')
    const json = await echo({
      sendHeaders: true,
      headerMode: 'json',
      headersJson: '{"X-Two": "2"}'
    })
    expect(json.headers['x-two']).toBe('2')
  })

  it('lowercases header names unless disabled', async () => {
    rawHeaderNames.length = 0
    await echo({ sendHeaders: true, headers: [{ name: 'X-Mixed', value: '1' }] })
    expect(rawHeaderNames.at(-1)).toContain('x-mixed')
    await echo({
      sendHeaders: true,
      headers: [{ name: 'X-Mixed', value: '1' }],
      options: { lowercaseHeaders: false }
    })
    expect(rawHeaderNames.at(-1)).toContain('X-Mixed')
  })
})

describe('runHttpRequestNode — authentication', () => {
  const auth = defaultHttpRequestData().auth

  it('basic', async () => {
    const e = await echo({ auth: { ...auth, type: 'basic', username: 'u', password: 'p' } })
    expect(e.headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('bearer', async () => {
    const e = await echo({ auth: { ...auth, type: 'bearer', token: 'tok' } })
    expect(e.headers.authorization).toBe('Bearer tok')
  })

  it('header', async () => {
    const e = await echo({ auth: { ...auth, type: 'header', name: 'X-Api-Key', value: 'k' } })
    expect(e.headers['x-api-key']).toBe('k')
  })

  it('query', async () => {
    const e = await echo({ auth: { ...auth, type: 'query', name: 'api_key', value: 'k' } })
    expect(e.url).toBe('/echo?api_key=k')
  })

  it('digest answers the server challenge', async () => {
    const ok = await run({
      url: `${base}/digest`,
      auth: { ...auth, type: 'digest', username: 'u', password: 'p' }
    })
    expect(ok.outputValue).toEqual({ digest: true })
    await expect(
      run({
        url: `${base}/digest`,
        auth: { ...auth, type: 'digest', username: 'u', password: 'x' }
      })
    ).rejects.toThrow(/403/)
  })
})

describe('runHttpRequestNode — body', () => {
  it('JSON from fields and from raw JSON', async () => {
    const fromFields = await echo({
      method: 'POST',
      sendBody: true,
      bodyParameters: [{ name: 'a', value: '1', kind: 'text' }]
    })
    expect(fromFields.headers['content-type']).toBe('application/json')
    expect(JSON.parse(fromFields.body)).toEqual({ a: '1' })
    const fromJson = await echo({
      method: 'POST',
      sendBody: true,
      bodyMode: 'json',
      bodyJson: '{"n": 2, "nested": {"x": true}}'
    })
    expect(JSON.parse(fromJson.body)).toEqual({ n: 2, nested: { x: true } })
  })

  it('form urlencoded from fields and from a raw string', async () => {
    const e = await echo({
      method: 'POST',
      sendBody: true,
      bodyContentType: 'form_urlencoded',
      bodyParameters: [{ name: 'a b', value: 'c&d', kind: 'text' }]
    })
    expect(e.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(e.body).toBe('a+b=c%26d')
    const raw = await echo({
      method: 'POST',
      sendBody: true,
      bodyContentType: 'form_urlencoded',
      bodyMode: 'json',
      bodyJson: 'x=1&y=2'
    })
    expect(raw.body).toBe('x=1&y=2')
  })

  it('multipart with text and file parts', async () => {
    const filePath = join(tmpDir, 'upload.txt')
    await writeFile(filePath, 'file-content')
    const e = await echo({
      method: 'POST',
      sendBody: true,
      bodyContentType: 'multipart',
      bodyParameters: [
        { name: 'field', value: 'v', kind: 'text' },
        { name: 'doc', value: filePath, kind: 'file' }
      ]
    })
    expect(e.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(e.body).toContain('name="field"\r\n\r\nv\r\n')
    expect(e.body).toContain('name="doc"; filename="upload.txt"\r\nContent-Type: text/plain')
    expect(e.body).toContain('file-content')
  })

  it('raw with a custom content type', async () => {
    const e = await echo({
      method: 'POST',
      sendBody: true,
      bodyContentType: 'raw',
      rawContentType: 'application/xml',
      rawBody: '<a/>'
    })
    expect(e.headers['content-type']).toBe('application/xml')
    expect(e.body).toBe('<a/>')
  })

  it('binary file body', async () => {
    const filePath = join(tmpDir, 'payload.json')
    await writeFile(filePath, '{"bin":1}')
    const e = await echo({
      method: 'PUT',
      sendBody: true,
      bodyContentType: 'binary',
      binaryFilePath: filePath
    })
    expect(e.headers['content-type']).toBe('application/json')
    expect(e.body).toBe('{"bin":1}')
  })

  it('a user Content-Type header wins over the default', async () => {
    const e = await echo({
      method: 'POST',
      sendBody: true,
      sendHeaders: true,
      headers: [{ name: 'Content-Type', value: 'application/vnd.api+json' }],
      bodyMode: 'json',
      bodyJson: '{}'
    })
    expect(e.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('does not send a body with GET', async () => {
    const e = await echo({ sendBody: true, bodyMode: 'json', bodyJson: '{"a":1}' })
    expect(e.body).toBe('')
  })
})

describe('runHttpRequestNode — redirects', () => {
  it('follows redirects by default', async () => {
    const r = await run({ url: `${base}/redirect/3` })
    expect(r.outputValue).toMatchObject({ url: '/echo' })
  })

  it('stops at max redirects', async () => {
    await expect(run({ url: `${base}/redirect/3`, options: { maxRedirects: 2 } })).rejects.toThrow(
      /Maximum number of redirects/
    )
  })

  it('returns the redirect response when following is off', async () => {
    const r = await run({
      url: `${base}/redirect/1`,
      options: { followRedirects: false, includeResponseMeta: true }
    })
    expect(r.outputValue).toMatchObject({ statusCode: 302, headers: { location: '/echo' } })
  })

  it('turns a POST into a bodyless GET on 303', async () => {
    const r = await run({
      url: `${base}/see-other`,
      method: 'POST',
      sendBody: true,
      bodyMode: 'json',
      bodyJson: '{"a":1}'
    })
    expect(r.outputValue).toMatchObject({ method: 'GET', body: '' })
  })
})

describe('runHttpRequestNode — response handling', () => {
  it('fails on non-2xx with the status and body', async () => {
    await expect(run({ url: `${base}/status/404` })).rejects.toThrow(
      /Request failed with status code 404 \(Not Found\): \{"error":"nope"\}/
    )
  })

  it('never error returns the error body', async () => {
    const r = await run({ url: `${base}/status/500`, options: { neverError: true } })
    expect(r.outputValue).toEqual({ error: 'nope' })
  })

  it('includes headers and status when asked', async () => {
    const r = await run({ url: `${base}/text`, options: { includeResponseMeta: true } })
    expect(r.outputValue).toMatchObject({
      body: 'hello world',
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'text/plain' }
    })
  })

  it('puts text under the output field and keeps the raw text as stdout', async () => {
    const r = await run({ url: `${base}/text`, options: { outputField: 'page' } })
    expect(r.outputValue).toEqual({ page: 'hello world' })
    expect(r.stdout).toBe('hello world')
  })

  it('forces JSON parsing and reports invalid JSON', async () => {
    await expect(run({ url: `${base}/text`, options: { responseFormat: 'json' } })).rejects.toThrow(
      /not valid JSON/
    )
  })

  it('forces text even for JSON responses', async () => {
    const r = await run({ url: `${base}/gzip`, options: { responseFormat: 'text' } })
    expect(r.outputValue).toEqual({ data: '{"zipped":true}' })
  })

  it('decodes gzip bodies', async () => {
    expect((await run({ url: `${base}/gzip` })).outputValue).toEqual({ zipped: true })
  })

  it('returns binary bodies as base64 under autodetect', async () => {
    const r = await run({ url: `${base}/binary` })
    expect(r.outputValue).toEqual({
      mimeType: 'image/png',
      encoding: 'base64',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]).toString('base64')
    })
  })

  it('writes the body to a file', async () => {
    const out = join(tmpDir, 'nested', 'out.png')
    const r = await run({
      url: `${base}/binary`,
      options: { responseFormat: 'file', responseFilePath: out }
    })
    expect(r.outputValue).toEqual({ filePath: out, mimeType: 'image/png', sizeBytes: 6 })
    expect((await readFile(out)).length).toBe(6)
  })

  it('times out', async () => {
    await expect(run({ url: `${base}/slow`, options: { timeoutMs: 50 } })).rejects.toThrow(
      /timed out after 50ms/
    )
  })

  it('can be cancelled', async () => {
    const controller = new AbortController()
    const pending = runHttpRequestNode(
      makeData({ url: `${base}/slow` }),
      localHttpTransport,
      controller.signal
    )
    controller.abort()
    await expect(pending).rejects.toThrow(/Cancelled/)
  })
})

describe('runHttpRequestNode — proxy', () => {
  it('sends the absolute URL to an HTTP proxy with credentials', async () => {
    const r = await run({
      url: 'http://example.invalid/path?q=1',
      options: { proxy: proxyUrl.replace('http://', 'http://user:pass@') }
    })
    expect(r.outputValue).toEqual({
      proxiedUrl: 'http://example.invalid/path?q=1',
      proxyAuth: `Basic ${Buffer.from('user:pass').toString('base64')}`
    })
  })
})

describe('runHttpRequestNode — pagination', () => {
  const pagination = defaultHttpRequestData().options.pagination

  it('updates a parameter until the response is empty and merges array pages', async () => {
    const r = await run({
      url: `${base}/pages`,
      options: {
        pagination: {
          ...pagination,
          mode: 'updateParameter',
          parameters: [{ location: 'query', name: 'page', value: '{{ $pageCount + 1 }}' }]
        }
      }
    })
    expect(r.outputValue).toEqual(['item1a', 'item1b', 'item2a', 'item2b', 'item3a', 'item3b'])
  })

  it('respects max pages', async () => {
    const r = await run({
      url: `${base}/pages`,
      options: {
        pagination: {
          ...pagination,
          mode: 'updateParameter',
          parameters: [{ location: 'query', name: 'page', value: '{{$pageCount + 1}}' }],
          maxPages: 2
        }
      }
    })
    expect(r.outputValue).toEqual(['item1a', 'item1b', 'item2a', 'item2b'])
  })

  it('stops on a completing status code without failing', async () => {
    const r = await run({
      url: `${base}/pages-status`,
      options: {
        pagination: {
          ...pagination,
          mode: 'updateParameter',
          parameters: [{ location: 'query', name: 'page', value: '{{$pageCount + 1}}' }],
          completeWhen: 'statusCodes',
          completeStatusCodes: '404, 410'
        }
      }
    })
    expect(r.outputValue).toEqual([{ page: 1 }, { page: 2 }])
  })

  it('follows a next URL from the response body', async () => {
    const r = await run({
      url: `${base}/cursor`,
      options: {
        pagination: { ...pagination, mode: 'nextUrl', nextUrl: '{{$response.body.next}}' }
      }
    })
    expect(r.outputValue).toEqual([
      { items: [0], next: '/cursor?cursor=1', hasMore: true },
      { items: [1], next: '/cursor?cursor=2', hasMore: true },
      { items: [2], next: null, hasMore: false }
    ])
  })

  it('completes when a negated expression becomes truthy', async () => {
    const r = await run({
      url: `${base}/cursor`,
      options: {
        pagination: {
          ...pagination,
          mode: 'updateParameter',
          parameters: [{ location: 'query', name: 'cursor', value: '{{$pageCount}}' }],
          completeWhen: 'expression',
          completeExpression: '!{{$response.body.hasMore}}',
          maxPages: 10
        }
      }
    })
    expect(r.outputValue).toHaveLength(3)
  })
})

describe('executeHttpRequestNode — {{}} templates', () => {
  const steps = {
    form: {
      output: '{"id":"42","token":"secret","name":"Ada"}',
      json: { id: '42', token: 'secret', name: 'Ada', tags: ['a', 'b'] }
    }
  }

  it('resolves templates in every field', async () => {
    const auth = defaultHttpRequestData().auth
    const r = await executeHttpRequestNode(
      makeData({
        method: 'POST',
        url: `${base}/echo?id={{steps.form.json.id}}`,
        auth: { ...auth, type: 'bearer', token: '{{steps.form.json.token}}' },
        sendQuery: true,
        queryParameters: [{ name: 'q-{{steps.form.json.id}}', value: '{{steps.form.json.name}}' }],
        sendHeaders: true,
        headerMode: 'json',
        headersJson: '{"X-Name": "{{steps.form.json.name}}"}',
        sendBody: true,
        bodyMode: 'json',
        bodyJson: '{"name": "{{steps.form.json.name}}", "tag": "{{steps.form.json.tags[1]}}"}'
      }),
      steps
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: /echo response shape
    const e = r.outputValue as Echo
    expect(e.url).toBe('/echo?id=42&q-42=Ada')
    expect(e.headers.authorization).toBe('Bearer secret')
    expect(e.headers['x-name']).toBe('Ada')
    expect(JSON.parse(e.body)).toEqual({ name: 'Ada', tag: 'b' })
  })

  it('leaves pagination placeholders for the paginator', async () => {
    const r = await executeHttpRequestNode(
      makeData({
        url: `${base}/pages`,
        options: {
          pagination: {
            ...defaultHttpRequestData().options.pagination,
            mode: 'updateParameter',
            parameters: [{ location: 'query', name: 'page', value: '{{$pageCount + 1}}' }],
            maxPages: 1
          }
        }
      }),
      steps
    )
    expect(r.outputValue).toEqual(['item1a', 'item1b'])
  })

  it('fills defaults for partial node data', async () => {
    const r = await executeHttpRequestNode({ url: `${base}/echo`, method: 'post' }, {})
    expect(r.outputValue).toMatchObject({ method: 'POST' })
  })
})
