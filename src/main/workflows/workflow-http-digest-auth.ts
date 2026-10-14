import { createHash, randomBytes } from 'node:crypto'

export type DigestChallenge = {
  realm: string
  nonce: string
  qop?: string
  opaque?: string
  algorithm: string
}

/** Parses a `WWW-Authenticate: Digest …` header; returns null for other schemes. */
export function parseDigestChallenge(header: string | undefined): DigestChallenge | null {
  if (!header || !/^\s*digest\s/i.test(header)) {
    return null
  }
  const params: Record<string, string> = {}
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? ''
  }
  if (params.nonce === undefined) {
    return null
  }
  return {
    realm: params.realm ?? '',
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm ?? 'MD5'
  }
}

function hashFor(algorithm: string): (s: string) => string {
  const algo = algorithm.toUpperCase().startsWith('SHA-256') ? 'sha256' : 'md5'
  return (s) => createHash(algo).update(s).digest('hex')
}

/** RFC 7616 Authorization header for one request (nonce count is always 1). */
export function buildDigestAuthorization(
  challenge: DigestChallenge,
  method: string,
  requestUrl: string,
  username: string,
  password: string,
  cnonce: string = randomBytes(8).toString('hex')
): string {
  const h = hashFor(challenge.algorithm)
  const parsed = new URL(requestUrl)
  const uri = `${parsed.pathname}${parsed.search}`
  const nc = '00000001'
  let ha1 = h(`${username}:${challenge.realm}:${password}`)
  if (challenge.algorithm.toLowerCase().endsWith('-sess')) {
    ha1 = h(`${ha1}:${challenge.nonce}:${cnonce}`)
  }
  const ha2 = h(`${method}:${uri}`)
  // Servers may offer "auth,auth-int"; only "auth" is supported.
  const qop = challenge.qop
    ?.split(',')
    .map((q) => q.trim())
    .find((q) => q === 'auth')
  const response = qop
    ? h(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : h(`${ha1}:${challenge.nonce}:${ha2}`)

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${challenge.algorithm}`,
    `response="${response}"`
  ]
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  }
  if (challenge.opaque !== undefined) {
    parts.push(`opaque="${challenge.opaque}"`)
  }
  return `Digest ${parts.join(', ')}`
}
