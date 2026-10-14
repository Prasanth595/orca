import { defaultHttpRequestData, normalizeHttpRequestData } from './workflow-http-request-defaults'
import type { HttpKeyValue, HttpRequestData } from './workflow-http-request-types'

/** Splits a POSIX-shell-style command line, honoring quotes and line continuations. */
export function tokenizeShellCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let i = 0
  const s = input.replace(/\\\r?\n/g, ' ')
  while (i < s.length) {
    const ch = s[i]!
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      i++
    } else if (ch === "'") {
      const end = s.indexOf("'", i + 1)
      current += s.slice(i + 1, end === -1 ? s.length : end)
      hasToken = true
      i = end === -1 ? s.length : end + 1
    } else if (ch === '$' && s[i + 1] === "'") {
      // ANSI-C quoting, as emitted by browser "Copy as cURL (bash)".
      i += 2
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const esc = s[i + 1]!
          current += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc
          i += 2
        } else {
          current += s[i++]
        }
      }
      hasToken = true
      i++
    } else if (ch === '"') {
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1]!)) {
          current += s[i + 1]
          i += 2
        } else {
          current += s[i++]
        }
      }
      hasToken = true
      i++
    } else if (ch === '\\' && i + 1 < s.length) {
      current += s[i + 1]
      hasToken = true
      i += 2
    } else {
      current += ch
      hasToken = true
      i++
    }
  }
  if (hasToken) {
    tokens.push(current)
  }
  return tokens
}

const FLAGS_WITH_VALUE = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '--json',
  '-F',
  '--form',
  '-u',
  '--user',
  '--url',
  '--max-redirs',
  '-m',
  '--max-time',
  '-x',
  '--proxy',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '--connect-timeout',
  '-o',
  '--output',
  '-w',
  '--write-out'
])

function splitPair(raw: string, sep: string): HttpKeyValue {
  const idx = raw.indexOf(sep)
  return idx === -1
    ? { name: raw.trim(), value: '' }
    : { name: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() }
}

function parseUrlEncoded(body: string): HttpKeyValue[] | null {
  if (!/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) {
    return null
  }
  return [...new URLSearchParams(body)].map(([name, value]) => ({ name, value }))
}

function isJsonObject(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object'
  } catch {
    return false
  }
}

/** Converts a `curl …` command into HTTP Request node data. Throws when no URL is present. */
export function parseCurlCommand(command: string): HttpRequestData {
  const tokens = tokenizeShellCommand(command.trim())
  if (tokens[0] === 'curl') {
    tokens.shift()
  }
  const data = defaultHttpRequestData()
  const headers: HttpKeyValue[] = []
  const dataParts: string[] = []
  const formParts: string[] = []
  let method: string | null = null
  let url = ''
  let forceGet = false
  let isJsonFlag = false

  for (let i = 0; i < tokens.length; i++) {
    let flag = tokens[i]!
    let value: string | undefined
    const eq = flag.startsWith('--') ? flag.indexOf('=') : -1
    if (eq !== -1) {
      value = flag.slice(eq + 1)
      flag = flag.slice(0, eq)
    } else if (FLAGS_WITH_VALUE.has(flag)) {
      value = tokens[++i] ?? ''
    }
    switch (flag) {
      case '-X':
      case '--request':
        method = (value ?? '').toUpperCase()
        break
      case '-H':
      case '--header':
        headers.push(splitPair(value ?? '', ':'))
        break
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode':
        dataParts.push(value ?? '')
        break
      case '--json':
        dataParts.push(value ?? '')
        isJsonFlag = true
        break
      case '-F':
      case '--form':
        formParts.push(value ?? '')
        break
      case '-u':
      case '--user': {
        const { name, value: password } = splitPair(value ?? '', ':')
        data.auth = {
          ...data.auth,
          type: data.auth.type === 'digest' ? 'digest' : 'basic',
          username: name,
          password
        }
        break
      }
      case '--digest':
        data.auth = { ...data.auth, type: 'digest' }
        break
      case '--url':
        url = value ?? ''
        break
      case '-G':
      case '--get':
        forceGet = true
        break
      case '-I':
      case '--head':
        method = 'HEAD'
        break
      case '-k':
      case '--insecure':
        data.options.ignoreSsl = true
        break
      case '-L':
      case '--location':
        data.options.followRedirects = true
        break
      case '--max-redirs':
        data.options.maxRedirects = Number(value) || data.options.maxRedirects
        break
      case '-m':
      case '--max-time':
        data.options.timeoutMs = Math.round(Number(value) * 1000) || data.options.timeoutMs
        break
      case '-x':
      case '--proxy':
        data.options.proxy = value ?? ''
        break
      case '-A':
      case '--user-agent':
        headers.push({ name: 'User-Agent', value: value ?? '' })
        break
      case '-e':
      case '--referer':
        headers.push({ name: 'Referer', value: value ?? '' })
        break
      case '-b':
      case '--cookie':
        headers.push({ name: 'Cookie', value: value ?? '' })
        break
      default:
        if (!flag.startsWith('-') && !url) {
          url = flag
        }
    }
  }
  if (!url) {
    throw new Error('No URL found in cURL command.')
  }

  const parsedUrl = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)
  const query = [...parsedUrl.searchParams].map(([name, value]) => ({ name, value }))
  const rawData = dataParts.join('&')
  if (forceGet && rawData) {
    query.push(...(parseUrlEncoded(rawData) ?? [{ name: rawData, value: '' }]))
  }
  parsedUrl.search = ''
  data.url = parsedUrl.toString()
  if (query.length > 0) {
    data.sendQuery = true
    data.queryParameters = query
  }

  const contentTypeHeader = headers.find((h) => h.name.toLowerCase() === 'content-type')
  const contentType = contentTypeHeader?.value.toLowerCase() ?? ''
  const hasBody = (!forceGet && dataParts.length > 0) || formParts.length > 0
  data.method = normalizeHttpRequestData({ method: method ?? (hasBody ? 'POST' : 'GET') }).method

  if (formParts.length > 0) {
    data.sendBody = true
    data.bodyContentType = 'multipart'
    data.bodyParameters = formParts.map((part) => {
      const { name, value } = splitPair(part, '=')
      return value.startsWith('@')
        ? { name, value: value.slice(1), kind: 'file' as const }
        : { name, value, kind: 'text' as const }
    })
  } else if (hasBody) {
    data.sendBody = true
    if (isJsonFlag || contentType.includes('json') || (!contentType && isJsonObject(rawData))) {
      data.bodyContentType = 'json'
      data.bodyMode = 'json'
      data.bodyJson = isJsonObject(rawData) ? JSON.stringify(JSON.parse(rawData), null, 2) : rawData
    } else if (!contentType || contentType.includes('x-www-form-urlencoded')) {
      data.bodyContentType = 'form_urlencoded'
      const fields = parseUrlEncoded(rawData)
      data.bodyMode = fields ? 'fields' : 'json'
      data.bodyParameters = (fields ?? []).map((f) => ({ ...f, kind: 'text' as const }))
      data.bodyJson = fields ? '' : rawData
    } else {
      data.bodyContentType = 'raw'
      data.rawContentType = contentTypeHeader?.value ?? 'text/plain'
      data.rawBody = rawData
    }
  }

  // Content-Type is carried by the body settings (rawContentType or the encoder).
  const keptHeaders = data.sendBody ? headers.filter((h) => h !== contentTypeHeader) : headers
  if (keptHeaders.length > 0) {
    data.sendHeaders = true
    data.headers = keptHeaders
  }
  return data
}
