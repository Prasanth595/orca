import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import type { Socket } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PreparedHttpRequest } from './workflow-http-request-builder'

export type HttpSendOptions = {
  timeoutMs: number
  ignoreSsl: boolean
  proxy: string
  signal?: AbortSignal
}

export type RawHttpResponse = {
  statusCode: number
  statusMessage: string
  /** Lowercased header names. */
  headers: Record<string, string>
  /** Undecoded bytes; content-encoding is handled by the caller. */
  body: Buffer
}

/** One network hop (no redirects or auth retries) plus file I/O on the execution host. */
export type HttpTransport = {
  send: (req: PreparedHttpRequest, opts: HttpSendOptions) => Promise<RawHttpResponse>
  readFile: (path: string) => Promise<Buffer>
  writeFile: (path: string, content: Buffer) => Promise<void>
}

function proxyAuthHeader(proxy: URL): Record<string, string> {
  if (!proxy.username) {
    return {}
  }
  const creds = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
  return { 'Proxy-Authorization': `Basic ${Buffer.from(creds).toString('base64')}` }
}

function defaultPort(url: URL): number {
  return Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
}

/** Opens a CONNECT tunnel through an HTTP proxy and upgrades it to TLS for the target. */
function openTunnel(proxy: URL, target: URL, opts: HttpSendOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const authority = `${target.hostname}:${defaultPort(target)}`
    const connectReq = http.request({
      host: proxy.hostname,
      port: defaultPort(proxy),
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority, ...proxyAuthHeader(proxy) }
    })
    connectReq.once('connect', (res, socket: Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT failed with status ${res.statusCode}`))
        return
      }
      resolve(
        tls.connect({ socket, servername: target.hostname, rejectUnauthorized: !opts.ignoreSsl })
      )
    })
    connectReq.once('error', reject)
    connectReq.end()
  })
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) {
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
    }
  }
  return out
}

async function sendLocal(
  req: PreparedHttpRequest,
  opts: HttpSendOptions
): Promise<RawHttpResponse> {
  const target = new URL(req.url)
  const proxy = opts.proxy.trim() ? new URL(opts.proxy.trim()) : null
  const isHttps = target.protocol === 'https:'
  const headers: Record<string, string> = { ...req.headers }
  if (req.body) {
    headers['content-length'] = String(req.body.length)
  }

  let requestOptions: http.RequestOptions
  let transportModule: typeof http | typeof https = isHttps ? https : http
  if (proxy && isHttps) {
    const tunnel = await openTunnel(proxy, target, opts)
    transportModule = http
    requestOptions = {
      host: target.hostname,
      port: defaultPort(target),
      path: `${target.pathname}${target.search}`,
      agent: false,
      createConnection: () => tunnel
    }
  } else if (proxy) {
    // Plain-HTTP proxying sends the absolute URL as the request target.
    Object.assign(headers, proxyAuthHeader(proxy), { host: target.host })
    requestOptions = { host: proxy.hostname, port: defaultPort(proxy), path: target.toString() }
    transportModule = http
  } else {
    requestOptions = {
      host: target.hostname,
      port: defaultPort(target),
      path: `${target.pathname}${target.search}`,
      ...(isHttps ? { rejectUnauthorized: !opts.ignoreSsl, servername: target.hostname } : {})
    }
  }

  return new Promise((resolve, reject) => {
    const clientReq = transportModule.request(
      { ...requestOptions, method: req.method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.once('error', reject)
        res.once('end', () => {
          cleanup()
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            headers: flattenHeaders(res.headers),
            body: Buffer.concat(chunks)
          })
        })
      }
    )
    const timer =
      opts.timeoutMs > 0
        ? setTimeout(
            () => clientReq.destroy(new Error(`Request timed out after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
          )
        : null
    const onAbort = (): void => {
      clientReq.destroy(new Error('Cancelled'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    function cleanup(): void {
      if (timer) {
        clearTimeout(timer)
      }
      opts.signal?.removeEventListener('abort', onAbort)
    }
    clientReq.once('error', (err) => {
      cleanup()
      reject(err)
    })
    if (opts.signal?.aborted) {
      onAbort()
      return
    }
    clientReq.end(req.body ?? undefined)
  })
}

export const localHttpTransport: HttpTransport = {
  send: sendLocal,
  readFile: (path) => readFile(path),
  writeFile: async (path, content) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}
