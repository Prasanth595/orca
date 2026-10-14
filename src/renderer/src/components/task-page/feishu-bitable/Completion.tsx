import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'
import type { FeishuBitableTask } from '../../../../../shared/feishu-bitable-types'
import type { RuntimeFeishuBitableSettings } from '@/runtime/runtime-feishu-bitable-client'

export function FeishuBitableCompletion({
  task,
  source
}: {
  task: FeishuBitableTask
  source: RuntimeFeishuBitableSettings
}): React.JSX.Element {
  const complete = useAppStore((s) => s.completeFeishuBitableRecord)
  const mapping = useAppStore(
    (s) =>
      s.feishuBitableStatus.connections.find(
        (connection) => connection.id === task.record.connectionId
      )?.fieldMapping
  )
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const configured = Boolean(mapping?.statusField && mapping.completedValue)
  const alreadyComplete =
    configured && task.fieldValues?.[mapping?.statusField ?? ''] === mapping?.completedValue

  async function markComplete(): Promise<void> {
    if (busy.current || !configured || alreadyComplete || saved) {
      return
    }
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await complete({ record: task.record }, source)
      if (result.ok) {
        setSaved(true)
      } else {
        setError(formatFeishuBitableError(result.error))
      }
    } catch (cause) {
      setError(formatFeishuBitableError(cause))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <div className="mt-4 space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-40"
        disabled={!configured || pending || alreadyComplete || saved}
        onClick={() => void markComplete()}
      >
        {pending
          ? translate('feishu.completion.saving', 'Updating status…')
          : alreadyComplete || saved
            ? translate('feishu.completion.completed', 'Marked complete')
            : translate('feishu.completion.action', 'Mark complete')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {configured
          ? translate(
              'feishu.completion.hint',
              'Updates only {{field}} to {{value}} when you click Mark complete. The app needs record write permission.',
              { field: mapping?.statusField, value: mapping?.completedValue }
            )
          : translate(
              'feishu.completion.configure',
              'Configure a status field and completion value in Settings → Tasks to enable completion updates.'
            )}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-xs text-muted-foreground">
          {translate('feishu.completion.saved', 'The record status was updated in Feishu.')}
        </p>
      ) : null}
    </div>
  )
}
