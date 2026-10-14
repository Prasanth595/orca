import { useFeishuBitableRecordWorkspaces } from './use-record-workspaces'
import { feishuBitableTaskTitle } from '@/lib/feishu-bitable-task-title'
import { useMemo } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { findFeishuBitableRecordWorkspaceAttachment } from '@/lib/feishu-bitable-record-workspace-attachment'
import { useAppStore } from '@/store'
import { feishuBitableRecordColumns, feishuBitableDetailColumn } from './record-columns'
import {
  feishuBitableRecordKey,
  type FeishuBitableField,
  type FeishuBitableTask
} from '../../../../../shared/feishu-bitable-types'
import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'

export function TaskPageFeishuBitableRows({
  tasks,
  fields,
  model
}: {
  tasks: readonly FeishuBitableTask[]
  fields: readonly FeishuBitableField[]
  model: Pick<
    TaskPageComposerActionsModel,
    | 'allWorktrees'
    | 'feishuBitableTaskSourceContext'
    | 'setSelectedFeishuBitableTask'
    | 'handleUseFeishuBitableTask'
    | 'openComposerForFeishuBitableTask'
  >
}): React.JSX.Element {
  const workspaces = useFeishuBitableRecordWorkspaces(model.allWorktrees)
  const titleField = useAppStore(
    (s) =>
      s.feishuBitableStatus.connections.find(
        (connection) => connection.id === s.feishuBitableStatus.activeConnectionId
      )?.fieldMapping.titleField
  )
  const columns = useMemo(() => feishuBitableRecordColumns(fields, tasks), [fields, tasks])
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="sticky top-0 z-10 bg-background text-2xs font-medium text-muted-foreground">
        <tr className="border-b border-border">
          {columns.map((name) => (
            <th key={name} scope="col" className="min-w-40 whitespace-nowrap px-3 py-2">
              {name}
            </th>
          ))}
          <th scope="col" className="sticky right-0 bg-background px-3 py-2">
            {translate('feishu.rows.actions', 'Actions')}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {tasks.map((task) => {
          const attached = findFeishuBitableRecordWorkspaceAttachment(
            workspaces,
            task.record,
            model.feishuBitableTaskSourceContext?.hostId
          )
          return (
            <tr
              key={feishuBitableRecordKey(task.record)}
              className="group min-h-12 hover:bg-accent"
            >
              {columns.map((name) => (
                <td key={name} className="px-3 py-2.5">
                  {name === feishuBitableDetailColumn(columns, task, titleField) ? (
                    <button
                      type="button"
                      className="block max-w-64 truncate text-left font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={task.fieldValues?.[name] ?? ''}
                      aria-label={translate('feishu.rows.details', 'View record: {{title}}', {
                        title: feishuBitableTaskTitle(task)
                      })}
                      onClick={() => model.setSelectedFeishuBitableTask(task)}
                    >
                      {task.fieldValues?.[name] || '—'}
                    </button>
                  ) : (
                    <p className="max-w-64 truncate" title={task.fieldValues?.[name] ?? ''}>
                      {task.fieldValues?.[name] || '—'}
                    </p>
                  )}
                </td>
              ))}
              <td className="sticky right-0 bg-background px-3 py-2.5 group-hover:bg-accent">
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  {columns.length === 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => model.setSelectedFeishuBitableTask(task)}
                    >
                      {translate('feishu.rows.details', 'View record: {{title}}', {
                        title: feishuBitableTaskTitle(task)
                      })}
                    </Button>
                  ) : null}
                  {attached ? (
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => model.handleUseFeishuBitableTask(task)}
                      aria-label={`${translate('auto.components.TaskPage.606a85c774', 'Open')}: ${feishuBitableTaskTitle(task)}`}
                    >
                      {translate('auto.components.TaskPage.606a85c774', 'Open')}
                      <ArrowRight className="size-3" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => model.openComposerForFeishuBitableTask(task)}
                    aria-label={`${translate('auto.components.TaskPage.b6329379ca', 'Start new workspace')}: ${feishuBitableTaskTitle(task)}`}
                  >
                    <Plus className="size-3" />
                    {translate('auto.components.TaskPage.b6329379ca', 'Start new workspace')}
                  </Button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
