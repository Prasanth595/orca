import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { useTaskPageLocalMutations } from '../../use-task-page-local-mutations'
import { TaskPageLocalDialog } from './Dialog'
import type { LocalTask } from '../../../../../shared/local-task'

export function TaskPageLocalDialogHost({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const { createLocalTask, editLocalTask, deleteLocalTask } = useTaskPageLocalMutations(model)
  const { localTaskDialog, setLocalTaskDialog, localTaskSourceProjectId } = model
  if (!localTaskDialog || !localTaskSourceProjectId) {
    return null
  }
  const close = (): void => setLocalTaskDialog(null)
  const byId = (id: number): LocalTask | null =>
    model.localTasks.find((entry) => entry.id === id) ?? null
  return (
    <TaskPageLocalDialog
      key={
        localTaskDialog.mode === 'edit' || localTaskDialog.mode === 'delete'
          ? `${localTaskDialog.mode}-${localTaskDialog.task.id}`
          : 'create'
      }
      dialog={localTaskDialog}
      onClose={close}
      onCreate={async (input) => createLocalTask(input)}
      onUpdate={async (id, patch) => {
        const existing = byId(id)
        if (!existing) {
          return null
        }
        const updated = await editLocalTask(existing, patch)
        if (updated) {
          close()
        }
        return updated
      }}
      onDeleteConfirm={async (task) => {
        const ok = await deleteLocalTask(task)
        if (ok) {
          close()
        }
        return ok
      }}
    />
  )
}
