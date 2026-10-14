import type {
  FeishuBitableField,
  FeishuBitableTask
} from '../../../../../shared/feishu-bitable-types'

export function feishuBitableRecordColumns(
  fields: readonly FeishuBitableField[],
  tasks: readonly FeishuBitableTask[]
): string[] {
  return fields.length > 0
    ? fields.map((field) => field.fieldName)
    : [...new Set(tasks.flatMap((task) => Object.keys(task.fieldValues ?? {})))]
}

export function feishuBitableDetailColumn(
  columns: readonly string[],
  task: FeishuBitableTask,
  titleField?: string | null
): string | undefined {
  return (
    columns.find((name) => name === titleField) ??
    columns.find((name) => task.fieldValues?.[name] === task.title) ??
    columns[0]
  )
}
