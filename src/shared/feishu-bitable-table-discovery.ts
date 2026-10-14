export type FeishuBitableTableDiscoveryArgs = {
  appId: string
  appSecret: string
  appToken: string
}

export type FeishuBitableTable = { tableId: string; name: string }
export type FeishuBitableTableDiscoveryResult =
  | { ok: true; tables: FeishuBitableTable[] }
  | { ok: false; error: string }

export function parseFeishuBitableBase(value: string): { appToken: string; tableId?: string } {
  const trimmed = value.trim()
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { appToken: trimmed }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a Feishu Bitable link or app token.')
  }
  const match = /^\/base\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.feishu.cn') || !match) {
    throw new Error('Use a Feishu Bitable link containing /base/, or enter its app token.')
  }
  return { appToken: match[1], tableId: url.searchParams.get('table') || undefined }
}
