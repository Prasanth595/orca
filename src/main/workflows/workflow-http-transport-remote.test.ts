import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import {
  buildRemoteCurlScript,
  createRemoteHttpTransport,
  parseCurlHeaderDump
} from './workflow-http-transport-remote'
import { runHttpRequestNode } from './workflow-node-runner-http'
import { defaultHttpRequestData } from '../../shared/workflow-http-request-defaults'
import type { RemoteExecFn } from './workflow-remote-exec'

function portOf(server: http.Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Server is not listening on a TCP port')
  }
  return address.port
}

const opts = { timeoutMs: 5000, ignoreSsl: false, proxy: '' }

describe('buildRemoteCurlScript', () => {
  it('quotes every user value and reads the body from stdin', () => {
    const script = buildRemoteCurlScript(
      {
        method: 'POST',
        url: "http://h/x?a='b'",
        headers: { 'x-q': "it's", 'x-empty': '' },
        body: Buffer.from('hi')
      },
      { ...opts, ignoreSsl: true, proxy: 'http://p:1' }
    )
    expect(script).toContain(`-X 'POST'`)
    expect(script).toContain(`-H 'x-q: it'\\''s'`)
    expect(script).toContain(`-H 'x-empty;'`)
    expect(script).toContain(`--url 'http://h/x?a='\\''b'\\'''`)
    expect(script).toContain('base64 -d > "$t/req"')
    expect(script).toContain('--data-binary @"$t/req"')
    expect(script).toContain('--max-time 5')
    expect(script).toContain(' -k ')
    expect(script).toContain(`--proxy 'http://p:1'`)
    expect(script).toContain('--globoff')
  })

  it('uses -I for HEAD and skips stdin without a body', () => {
    const script = buildRemoteCurlScript(
      { method: 'HEAD', url: 'http://h/', headers: {}, body: null },
      { ...opts, timeoutMs: 0 }
    )
    expect(script).toContain(' -I ')
    expect(script).not.toContain('-X')
    expect(script).not.toContain('base64 -d')
    expect(script).not.toContain('--max-time')
  })
})

describe('parseCurlHeaderDump', () => {
  it('reads the final header block after proxy and 100-continue blocks', () => {
    const dump =
      'HTTP/1.1 200 Connection established\r\n\r\n' +
      'HTTP/1.1 100 Continue\r\n\r\n' +
      'HTTP/2 201 Created\r\ncontent-type: application/json\r\nSet-Cookie: a=1\r\nset-cookie: b=2\r\n\r\n'
    expect(parseCurlHeaderDump(dump)).toEqual({
      statusMessage: 'Created',
      headers: { 'content-type': 'application/json', 'set-cookie': 'a=1, b=2' }
    })
  })
})

describe('createRemoteHttpTransport', () => {
  it('decodes the status / headers / body envelope', async () => {
    const remoteExec = vi.fn<RemoteExecFn>().mockResolvedValue({
      stdout: [
        '200',
        Buffer.from('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\n').toString('base64'),
        Buffer.from('remote body').toString('base64')
      ].join('\n'),
      stderr: '',
      exitCode: 0
    })
    const transport = createRemoteHttpTransport(remoteExec)
    const res = await transport.send(
      { method: 'POST', url: 'http://h/', headers: {}, body: Buffer.from('payload') },
      opts
    )
    expect(res).toEqual({
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('remote body')
    })
    expect(remoteExec.mock.calls[0]![1]).toMatchObject({
      stdin: Buffer.from('payload').toString('base64'),
      timeoutMs: 15_000
    })
  })

  it('surfaces curl failures', async () => {
    const remoteExec = vi
      .fn<RemoteExecFn>()
      .mockResolvedValue({ stdout: '', stderr: 'curl: (6) Could not resolve host', exitCode: 6 })
    await expect(
      createRemoteHttpTransport(remoteExec).send(
        { method: 'GET', url: 'http://nope/', headers: {}, body: null },
        opts
      )
    ).rejects.toThrow(/Could not resolve host/)
  })

  it('reads and writes files through base64', async () => {
    const remoteExec = vi
      .fn<RemoteExecFn>()
      .mockResolvedValueOnce({
        stdout: Buffer.from('file bytes').toString('base64'),
        stderr: '',
        exitCode: 0
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
    const transport = createRemoteHttpTransport(remoteExec)
    expect((await transport.readFile("/tmp/it's.txt")).toString()).toBe('file bytes')
    expect(remoteExec.mock.calls[0]![0]).toBe(`base64 < '/tmp/it'\\''s.txt' | tr -d '\\n'`)
    await transport.writeFile('/srv/out/x.bin', Buffer.from('out'))
    expect(remoteExec.mock.calls[1]![0]).toBe(`mkdir -p '/srv/out' && base64 -d > '/srv/out/x.bin'`)
    expect(remoteExec.mock.calls[1]![1]).toEqual({ stdin: Buffer.from('out').toString('base64') })
  })
})

// Runs the generated script with a real POSIX shell and curl, standing in for the SSH host.
const canRunCurl =
  process.platform !== 'win32' && existsSync('/bin/sh') && existsSync('/usr/bin/curl')

describe.skipIf(!canRunCurl)('remote transport end-to-end with real curl', () => {
  let server: http.Server
  let base = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/echo' })
          res.end()
          return
        }
        res.writeHead(201, { 'content-type': 'application/json', 'x-reply': 'yes' })
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            auth: req.headers.authorization,
            body: Buffer.concat(chunks).toString('utf8')
          })
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${portOf(server)}`
  })

  afterAll(() => {
    server.close()
  })

  const localShellExec: RemoteExecFn = async (command, execOpts = {}) => {
    const r = await runProcess({
      program: '/bin/sh',
      args: ['-c', command],
      input: execOpts.stdin,
      timeoutMs: execOpts.timeoutMs ?? 10_000
    })
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.code ?? 1 }
  }

  it('sends a JSON POST, follows a redirect, and parses the reply', async () => {
    const d = defaultHttpRequestData()
    const result = await runHttpRequestNode(
      {
        ...d,
        method: 'POST',
        url: `${base}/echo`,
        auth: { ...d.auth, type: 'bearer', token: 'tok' },
        sendQuery: true,
        queryParameters: [{ name: 'ids[]', value: '1' }],
        sendBody: true,
        bodyMode: 'json',
        bodyJson: '{"hello": "wörld"}',
        options: { ...d.options, includeResponseMeta: true }
      },
      createRemoteHttpTransport(localShellExec)
    )
    expect(result.outputValue).toMatchObject({
      statusCode: 201,
      statusMessage: 'Created',
      headers: { 'x-reply': 'yes' },
      body: {
        method: 'POST',
        url: '/echo?ids%5B%5D=1',
        auth: 'Bearer tok',
        body: '{"hello":"wörld"}'
      }
    })

    const redirected = await runHttpRequestNode(
      { ...d, url: `${base}/redirect` },
      createRemoteHttpTransport(localShellExec)
    )
    expect(redirected.outputValue).toMatchObject({ method: 'GET', url: '/echo' })
  })

  it('round-trips binary files through the shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-http-remote-'))
    try {
      const transport = createRemoteHttpTransport(localShellExec)
      const bytes = Buffer.from([0, 1, 2, 255, 10, 13])
      await transport.writeFile(join(dir, 'sub', 'f.bin'), bytes)
      expect(await transport.readFile(join(dir, 'sub', 'f.bin'))).toEqual(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
