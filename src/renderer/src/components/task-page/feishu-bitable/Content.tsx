import { useFeishuBitableRecordWorkspaces } from './use-record-workspaces'
import { findFeishuBitableRecordWorkspaceAttachment } from '@/lib/feishu-bitable-record-workspace-attachment'
import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'
import { defaultScopeSource } from '@/lib/default-creation-host'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { FeishuBitableIcon } from '@/components/icons/FeishuBitableIcon'
import { FeishuBitableConnectDialog } from '@/components/feishu-bitable-connect-dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { FeishuBitableTaskDetail } from './Detail'
import { TaskPageFeishuBitableRows } from './Rows'
import { translate } from '@/i18n/i18n'

export function TaskPageFeishuBitableContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const workspaces = useFeishuBitableRecordWorkspaces(model.allWorktrees)
  const settings = useAppStore((s) => s.settings)
  const contextKey = useAppStore((s) => getProviderRuntimeContextKey(s.settings))
  const status = useAppStore((s) => s.feishuBitableStatus)
  const statusChecked = useAppStore((s) => s.feishuBitableStatusChecked)
  const tasks = useAppStore((s) => s.feishuBitableTasks)
  const fields = useAppStore((s) => s.feishuBitableFields)
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
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-xs">
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
            {formatFeishuBitableError(error)}
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
        source={model.feishuBitableTaskSourceContext ?? defaultScopeSource(settings)}
        fields={fields}
        hasWorkspace={Boolean(
          findFeishuBitableRecordWorkspaceAttachment(
            workspaces,
            selectedTask.record,
            model.feishuBitableTaskSourceContext?.hostId
          )
        )}
        onBack={() => model.setSelectedFeishuBitableTask(null)}
        onUse={() => model.handleUseFeishuBitableTask(selectedTask)}
      />
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-xs">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="min-w-0 text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {translate('auto.components.TaskPage.feishuBitableRecords', 'Bitable records')}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
          <span>
            {translate('feishu.rows.shown', '{{count}} records shown', { count: tasks.length })}
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
        className="min-h-0 flex-1 overflow-auto scrollbar-sleek"
        style={{ scrollbarGutter: 'stable' }}
      >
        {status.credentialError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {formatFeishuBitableError(status.credentialError)}
          </div>
        ) : null}
        {!status.credentialError && error ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {formatFeishuBitableError(error)}
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

        {tasks.length > 0 || fields.length > 0 ? (
          <TaskPageFeishuBitableRows tasks={tasks} fields={fields} model={model} />
        ) : null}

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
