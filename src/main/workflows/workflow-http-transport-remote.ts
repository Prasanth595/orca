import { quotePosixShell as q } from '../../shared/wsl-login-shell-command'
import type { PreparedHttpRequest } from './workflow-http-request-builder'
import type { HttpSendOptions, HttpTransport, RawHttpResponse } from './workflow-http-transport'
import type { RemoteExecFn } from './workflow-remote-exec'

// Bytes cross the SSH exec channel as base64 because it only carries strings.
function b64File(path: string): string {
  return `base64 < ${path} | tr -d '\\n'`
}

/** Builds the remote script: curl writes headers/body to temp files, then all three are echoed. */
export function buildRemoteCurlScript(req: PreparedHttpRequest, opts: HttpSendOptions): string {
  // -X HEAD makes curl wait for a body that never arrives; -I is curl's HEAD.
  const args = [
    'curl',
    '-sS',
    '--globoff',
    ...(req.method === 'HEAD' ? ['-I'] : ['-X', q(req.method)])
  ]
  for (const [name, value] of Object.entries(req.headers)) {
    // `Name;` is curl's syntax for an empty-valued header; `Name:` would remove it.
    args.push('-H', q(value === '' ? `${name};` : `${name}: ${value}`))
  }
  // Suppress curl's automatic `Expect: 100-continue` on large bodies.
  args.push('-H', q('Expect:'))
  if (req.body) {
    args.push('--data-binary', '@"$t/req"')
  }
  if (opts.timeoutMs > 0) {
    args.push('--max-time', String(opts.timeoutMs / 1000))
  }
  if (opts.ignoreSsl) {
    args.push('-k')
  }
  if (opts.proxy.trim()) {
    args.push('--proxy', q(opts.proxy.trim()))
  }
  args.push('-D', '"$t/h"', '-o', '"$t/b"', '-w', q('%{http_code}'), '--url', q(req.url))

  return [
    't=$(mktemp -d) || exit 1',
    `trap 'rm -rf "$t"' EXIT`,
    req.body ? 'base64 -d > "$t/req" || exit 1' : null,
    `${args.join(' ')} > "$t/code" || exit $?`,
    `cat "$t/code"; printf '\\n'`,
    `${b64File('"$t/h"')}; printf '\\n'`,
    b64File('"$t/b"')
  ]
    .filter((l) => l !== null)
    .join('\n')
}

/** Parses the last header block of a `curl -D` dump (proxies and 100-continue add earlier ones). */
export function parseCurlHeaderDump(dump: string): {
  statusMessage: string
  headers: Record<string, string>
} {
  const blocks = dump.split(/\r?\n\r?\n/).filter((b) => b.trim().startsWith('HTTP/'))
  const lines = (blocks.at(-1) ?? '').trim().split(/\r?\n/)
  const statusMessage = (lines[0] ?? '').replace(/^HTTP\/[\d.]+\s+\d+\s*/, '')
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':')
    if (idx <= 0) {
      continue
    }
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    headers[name] = headers[name] !== undefined ? `${headers[name]}, ${value}` : value
  }
  return { statusMessage, headers }
}

export function createRemoteHttpTransport(remoteExec: RemoteExecFn): HttpTransport {
  return {
    send: async (req, opts): Promise<RawHttpResponse> => {
      const r = await remoteExec(buildRemoteCurlScript(req, opts), {
        stdin: req.body ? req.body.toString('base64') : undefined,
        signal: opts.signal,
        // Leave curl's own --max-time to report the timeout first.
        timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs + 10_000 : undefined
      })
      if (r.exitCode !== 0) {
        const detail = r.stderr.trim() || `exit code ${r.exitCode}`
        throw new Error(`HTTP request on remote host failed (is curl installed?): ${detail}`)
      }
      const [code = '', headerB64 = '', bodyB64 = ''] = r.stdout.split('\n')
      const { statusMessage, headers } = parseCurlHeaderDump(
        Buffer.from(headerB64, 'base64').toString('latin1')
      )
      return {
        statusCode: Number(code.trim()) || 0,
        statusMessage,
        headers,
        // With -I curl also writes the headers to the body file.
        body: req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(bodyB64, 'base64')
      }
    },
    readFile: async (path) => {
      const r = await remoteExec(b64File(q(path)))
      if (r.exitCode !== 0) {
        throw new Error(`Could not read ${path} on remote host: ${r.stderr.trim()}`)
      }
      return Buffer.from(r.stdout, 'base64')
    },
    writeFile: async (path, content) => {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '.'
      const r = await remoteExec(`mkdir -p ${q(dir)} && base64 -d > ${q(path)}`, {
        stdin: content.toString('base64')
      })
      if (r.exitCode !== 0) {
        throw new Error(`Could not write ${path} on remote host: ${r.stderr.trim()}`)
      }
    }
  }
}
