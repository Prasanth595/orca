/** React Native has no guaranteed `crypto.randomUUID`, and on the page it needs a secure context
 *  the iOS shell's custom scheme is not; the fallback is a v4 UUID too, because callers strip the
 *  dashes or send it where a UUID is validated. */
export function randomV4Uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = '89ab'[Math.floor(Math.random() * 4)]!
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
