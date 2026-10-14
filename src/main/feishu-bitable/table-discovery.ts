import { feishuRequest } from './client'
import {
  parseFeishuBitableBase,
  type FeishuBitableTable,
  type FeishuBitableTableDiscoveryArgs,
  type FeishuBitableTableDiscoveryResult
} from '../../shared/feishu-bitable-table-discovery'

export async function discoverTables(
  args: FeishuBitableTableDiscoveryArgs
): Promise<FeishuBitableTableDiscoveryResult> {
  try {
    if (!args.appId.trim() || !args.appSecret.trim()) {
      return { ok: false, error: 'App ID and app secret are required.' }
    }
    const { appToken } = parseFeishuBitableBase(args.appToken)
    const tables: FeishuBitableTable[] = []
    const seenTokens = new Set<string>()
    let pageToken: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ page_size: '100' })
      if (pageToken) {
        query.set('page_token', pageToken)
      }
      const data = await feishuRequest<{
        items?: { table_id?: unknown; name?: unknown }[]
        has_more?: boolean
        page_token?: string
      }>(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?${query}`, {
        method: 'GET',
        auth: { appId: args.appId.trim(), appSecret: args.appSecret.trim() }
      })
      for (const item of data.items ?? []) {
        if (typeof item.table_id !== 'string' || !item.table_id.trim()) {
          throw new Error('Feishu returned an invalid table ID.')
        }
        tables.push({
          tableId: item.table_id,
          name: typeof item.name === 'string' && item.name ? item.name : item.table_id
        })
      }
      if (!data.has_more) {
        return { ok: true, tables }
      }
      if (!data.page_token || seenTokens.has(data.page_token)) {
        throw new Error('Feishu returned an invalid table pagination token.')
      }
      pageToken = data.page_token
      seenTokens.add(pageToken)
    }
    throw new Error('Too many data tables. Enter the table ID manually.')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not load tables.' }
  }
}
