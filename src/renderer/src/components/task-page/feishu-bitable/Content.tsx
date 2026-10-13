import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'
import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import type { FeishuBitableTask } from '../../../../../shared/feishu-bitable-types'
import { FeishuBitableIcon } from '@/components/icons/FeishuBitableIcon'
import { FeishuBitableConnectDialog } from '@/components/feishu-bitable-connect-dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { formatRelativeTime } from '../../task-page-source-context'
import { translate } from '@/i18n/i18n'

export function TaskPageFeishuBitableContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const contextKey = useAppStore((s) => getProviderRuntimeContextKey(s.settings))
  const status = useAppStore((s) => s.feishuBitableStatus)
  const statusChecked = useAppStore((s) => s.feishuBitableStatusChecked)
  const tasks = useAppStore((s) => s.feishuBitableTasks)
  const nextPageToken = useAppStore((s) => s.feishuBitableNextPageToken)
  const loading = useAppStore((s) => s.feishuBitableLoading)
  const error = useAppStore((s) => s.feishuBitableError)
  const selectedTask = useAppStore((s) => s.selectedFeishuBitableTask)
  const checkConnection = useAppStore((s) => s.checkFeishuBitableConnection)
  const fetchRecords = useAppStore((s) => s.fetchFeishuBitableRecords)
  const [connectOpen, setConnectOpen] = useState(false)
  const { hideTaskSource, taskSource } = model

  useEffect(() => {
    if (taskSource === 'feishu-bitable') {
      void checkConnection()
    }
  }, [taskSource, contextKey, checkConnection])

  useEffect(() => {
    if (taskSource === 'feishu-bitable' && status.connected) {
      void fetchRecords().catch(() => {})
    }
  }, [taskSource, status.connected, status.activeConnectionId, fetchRecords])

  if (taskSource !== 'feishu-bitable') {
    return null
  }

  if (!statusChecked) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!status.connected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <FeishuBitableIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          {translate(
            'auto.components.TaskPage.feishuBitableConnectTitle',
            'Connect Feishu Bitable'
          )}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {translate(
            'auto.components.TaskPage.feishuBitableConnectBody',
            'Browse Bitable records through an enterprise self-built app and start workspaces from them.'
          )}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setConnectOpen(true)}>
            {translate('auto.components.TaskPage.feishuBitableConnectAction', 'Connect Feishu')}
          </Button>
          <Button
            variant="outline"
            onClick={() => hideTaskSource('feishu-bitable', 'Feishu Bitable')}
          >
            {translate('auto.components.TaskPage.feishuBitableHide', 'Hide Feishu Bitable')}
          </Button>
        </div>
        <FeishuBitableConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onConnected={() => void checkConnection()}
        />
      </div>
    )
  }

  if (selectedTask) {
    return (
      <FeishuBitableTaskDetail
        task={selectedTask}
        onBack={() => model.setSelectedFeishuBitableTask(null)}
        onUse={() => model.handleUseFeishuBitableTask(selectedTask)}
      />
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {translate('auto.components.TaskPage.feishuBitableRecords', 'Bitable records')}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {tasks.length} {translate('auto.components.TaskPage.feishuBitableShown', 'shown')}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={loading}
            onClick={() => void fetchRecords().catch(() => {})}
          >
            {translate('auto.components.TaskPage.feishuBitableRefresh', 'Refresh')}
          </Button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
        style={{ scrollbarGutter: 'stable' }}
      >
        {status.credentialError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {status.credentialError}
          </div>
        ) : null}
        {!status.credentialError && error ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {error}
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void fetchRecords().catch(() => {})}
            >
              {translate('auto.components.TaskPage.feishuBitableRetry', 'Retry')}
            </Button>
          </div>
        ) : null}

        {loading && tasks.length === 0 ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-3 py-3">
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && tasks.length === 0 && !error && !status.credentialError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate('auto.components.TaskPage.feishuBitableEmpty', 'No Bitable records found')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {translate(
                'auto.components.TaskPage.feishuBitableEmptyBody',
                'Check the table mapping or field mapping in Settings → Tasks.'
              )}
            </p>
          </div>
        ) : null}

        <ul className="divide-y divide-border/50">
          {tasks.map((task) => (
            <li key={`${task.record.connectionId}:${task.record.recordId}`}>
              <button
                type="button"
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                onClick={() => model.setSelectedFeishuBitableTask(task)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[
                      task.connectionLabel,
                      task.updatedAt ? formatRelativeTime(task.updatedAt) : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {nextPageToken ? (
          <div className="border-t border-border/50 p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={loading}
              onClick={() =>
                void fetchRecords({ pageToken: nextPageToken, append: true }).catch(() => {})
              }
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                translate('auto.components.TaskPage.feishuBitableLoadMore', 'Load more')
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FeishuBitableTaskDetail({
  task,
  onBack,
  onUse
}: {
  task: FeishuBitableTask
  onBack: () => void
  onUse: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border/50 bg-muted/35 px-3">
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {translate('auto.components.TaskPage.feishuBitableBack', 'Records')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-sleek">
        <h2 className="text-base font-medium text-foreground">{task.title}</h2>
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
        {task.description ? (
          <section className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {translate('auto.components.TaskPage.feishuBitableDescription', 'Description')}
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">
              {task.description}
            </p>
          </section>
        ) : null}
        {task.acceptanceCriteria ? (
          <section className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {translate('auto.components.TaskPage.feishuBitableAcceptance', 'Acceptance criteria')}
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">
              {task.acceptanceCriteria}
            </p>
          </section>
        ) : null}
        <div className="mt-6">
          <Button onClick={onUse}>
            {translate('auto.components.TaskPage.feishuBitableUse', 'Start workspace')}
          </Button>
        </div>
      </div>
    </div>
  )
}
