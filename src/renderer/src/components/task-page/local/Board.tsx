import { useMemo } from 'react'
import type { LocalTask, LocalTaskStatus } from '../../../../../shared/local-task'
import { LOCAL_TASK_STATUSES, LOCAL_TASK_STATUS_LABELS } from '../../../../../shared/local-task'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { LoaderCircle, Plus } from 'lucide-react'

// Statuses a card in the given column can move to (keyboard menu + drop targets).
const MOVE_TARGETS: Record<LocalTaskStatus, readonly LocalTaskStatus[]> = {
  todo: ['in-progress', 'done'],
  'in-progress': ['todo', 'done'],
  done: ['todo', 'in-progress']
}

function LocalBoardEmptyState({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}

export type TaskPageLocalBoardProps = {
  tasks: readonly LocalTask[]
  loading: boolean
  unreadable: boolean
  hasProject: boolean
  onRetry: () => void
  onCreate: () => void
  onEdit: (task: LocalTask) => void
  onDeleteRequest: (task: LocalTask) => void
  onMove: (task: LocalTask, status: LocalTaskStatus) => void
  onOpenWorktree: (task: LocalTask) => void
}

export function TaskPageLocalBoard({
  tasks,
  loading,
  unreadable,
  hasProject,
  onRetry,
  onCreate,
  onEdit,
  onDeleteRequest,
  onMove,
  onOpenWorktree
}: TaskPageLocalBoardProps): React.JSX.Element | null {
  const grouped = useMemo(() => {
    const buckets: Record<LocalTaskStatus, LocalTask[]> = {
      todo: [],
      'in-progress': [],
      done: []
    }
    for (const task of tasks) {
      buckets[task.status].push(task)
    }
    return buckets
  }, [tasks])

  if (loading) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!hasProject) {
    return (
      <LocalBoardEmptyState
        title={translate('auto.components.TaskPage.localNoProject', 'No active project')}
        description={translate(
          'auto.components.TaskPage.localNoProjectDescription',
          'Select a project to track local tasks for it.'
        )}
      />
    )
  }

  if (unreadable) {
    return (
      <LocalBoardEmptyState
        title={translate('auto.components.TaskPage.localUnreadable', 'Local tasks unavailable')}
        description={translate(
          'auto.components.TaskPage.localUnreadableDescription',
          'The stored tasks could not be read. Retry to reload without losing data.'
        )}
        action={
          <Button type="button" size="sm" className="mt-4" onClick={onRetry}>
            {translate('auto.components.TaskPage.localRetry', 'Retry')}
          </Button>
        }
      />
    )
  }

  if (tasks.length === 0) {
    return (
      <LocalBoardEmptyState
        title={translate('auto.components.TaskPage.localEmpty', 'No local tasks yet')}
        description={translate(
          'auto.components.TaskPage.localEmptyDescription',
          'Create the first task to start tracking work for this project.'
        )}
        action={
          <Button type="button" size="sm" className="mt-4" onClick={onCreate}>
            <Plus className="size-3.5" aria-hidden />
            {translate('auto.components.TaskPage.localNewTask', 'New task')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3">
      {LOCAL_TASK_STATUSES.map((status) => {
        const columnTasks = grouped[status]
        return (
          <section
            key={status}
            data-testid={`local-column-${status}`}
            aria-label={LOCAL_TASK_STATUS_LABELS[status]}
            className="flex min-h-0 flex-col rounded-md border border-border/50 bg-muted/50 shadow-sm"
          >
            <h3 className="flex-none px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {LOCAL_TASK_STATUS_LABELS[status]}
              <span className="ml-2 font-normal">{columnTasks.length}</span>
            </h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 scrollbar-sleek">
              {columnTasks.map((task) => (
                <article
                  key={task.id}
                  className="rounded-md border border-border/50 bg-background p-3 shadow-sm"
                >
                  <p data-task-title className="text-sm font-medium text-foreground">
                    {task.title}
                  </p>
                  {task.description ? (
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Edit task ${task.id}`}
                      onClick={() => onEdit(task)}
                    >
                      {translate('auto.components.TaskPage.localEdit', 'Edit')}
                    </Button>
                    {MOVE_TARGETS[task.status].map((target) => (
                      <Button
                        key={target}
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={`Move to ${LOCAL_TASK_STATUS_LABELS[target].toLowerCase()}`}
                        onClick={() => onMove(task, target)}
                      >
                        {LOCAL_TASK_STATUS_LABELS[target]}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Open worktree for task ${task.id}`}
                      onClick={() => onOpenWorktree(task)}
                    >
                      {translate('auto.components.TaskPage.localWorktree', 'Worktree')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Delete task ${task.id}`}
                      onClick={() => onDeleteRequest(task)}
                    >
                      {translate('auto.components.TaskPage.localDelete', 'Delete')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
