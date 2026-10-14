import { feishuBitableTaskTitle } from '@/lib/feishu-bitable-task-title'
import { FeishuBitableCompletion } from './Completion'
import { feishuBitableRecordColumns } from './record-columns'
import {
  getFeishuBitableRuntimeTarget,
  type RuntimeFeishuBitableSettings
} from '@/runtime/runtime-feishu-bitable-client'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '../../task-page-source-context'
import type {
  FeishuBitableTask,
  FeishuBitableField
} from '../../../../../shared/feishu-bitable-types'

export function FeishuBitableTaskDetail({
  task,
  fields,
  onBack,
  onUse,
  source,
  hasWorkspace = false
}: {
  task: FeishuBitableTask
  fields: readonly FeishuBitableField[]
  onBack: () => void
  onUse: () => void
  source: RuntimeFeishuBitableSettings
  hasWorkspace?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-xs">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border/50 bg-muted/35 px-3">
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {translate('auto.components.TaskPage.feishuBitableBack', 'Records')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-sleek">
        <h2 className="text-base font-medium text-foreground">{feishuBitableTaskTitle(task)}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{task.connectionLabel}</span>
          {task.updatedAt ? <span>{formatRelativeTime(task.updatedAt)}</span> : null}
          {task.url ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              onClick={() => task.url && window.api.shell.openUrl(task.url)}
            >
              <ExternalLink className="size-3" />
              {translate('auto.components.TaskPage.feishuBitableOpenRecord', 'Open record')}
            </button>
          ) : null}
        </div>
        {task.fieldValues ? (
          <dl className="mt-4 divide-y divide-border">
            {feishuBitableRecordColumns(fields, [task]).map((name) => (
              <div key={name} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                <dt className="text-xs font-medium text-muted-foreground">{name}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm sm:col-span-2">
                  {task.fieldValues?.[name] || '—'}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <>
            {task.description ? (
              <section className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {translate('auto.components.TaskPage.feishuBitableDescription', 'Description')}
                </h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
                  {task.description}
                </p>
              </section>
            ) : null}
            {task.acceptanceCriteria ? (
              <section className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {translate(
                    'auto.components.TaskPage.feishuBitableAcceptance',
                    'Acceptance criteria'
                  )}
                </h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
                  {task.acceptanceCriteria}
                </p>
              </section>
            ) : null}
          </>
        )}
        <FeishuBitableCompletion
          key={JSON.stringify([task.record, getFeishuBitableRuntimeTarget(source)])}
          task={task}
          source={source}
        />
        <div className="mt-6">
          <Button onClick={onUse}>
            {hasWorkspace
              ? translate('feishu.details.openWorkspace', 'Open workspace')
              : translate('auto.components.TaskPage.feishuBitableUse', 'Start workspace')}
          </Button>
        </div>
      </div>
    </div>
  )
}
