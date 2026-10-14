import { translate } from '@/i18n/i18n'
import type { FeishuBitableTask } from '../../../shared/feishu-bitable-types'

export function feishuBitableTaskTitle(task: FeishuBitableTask): string {
  return task.titleMissing
    ? translate('feishu.rows.untitled', 'Feishu record {{id}}', { id: task.record.recordId })
    : task.title
}
