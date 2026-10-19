import { useState } from 'react'
import type { LocalTask, LocalTaskStatus } from '../../../../../shared/local-task'
import { LOCAL_TASK_STATUSES, LOCAL_TASK_STATUS_LABELS } from '../../../../../shared/local-task'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export type LocalTaskDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; task: LocalTask }
  | { mode: 'delete'; task: LocalTask }

export type TaskPageLocalDialogProps = {
  dialog: LocalTaskDialogState | null
  onClose: () => void
  onCreate: (input: { title: string; description?: string }) => Promise<LocalTask>
  onUpdate: (
    id: number,
    patch: { title?: string; description?: string; status?: LocalTaskStatus }
  ) => Promise<LocalTask | null>
  onDeleteConfirm: (task: LocalTask) => Promise<boolean>
}

export function TaskPageLocalDialog({
  dialog,
  onClose,
  onCreate,
  onUpdate,
  onDeleteConfirm
}: TaskPageLocalDialogProps): React.JSX.Element | null {
  const [title, setTitle] = useState(dialog?.mode === 'edit' ? dialog.task.title : '')
  const [description, setDescription] = useState(
    dialog?.mode === 'edit' ? dialog.task.description : ''
  )
  const [status, setStatus] = useState<LocalTaskStatus>(
    dialog?.mode === 'edit' ? dialog.task.status : 'todo'
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!dialog) {
    return null
  }

  if (dialog.mode === 'delete') {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.TaskPage.localDeleteTitle', 'Delete this task?')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {translate(
              'auto.components.TaskPage.localDeleteBody',
              '“{{value0}}” will be permanently removed.',
              { value0: dialog.task.title }
            )}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {translate('auto.components.TaskPage.localCancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setPending(true)
                void onDeleteConfirm(dialog.task).finally(() => setPending(false))
              }}
            >
              {translate('auto.components.TaskPage.localDeleteConfirm', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const isCreate = dialog.mode === 'create'
  const submit = (): void => {
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setError(translate('auto.components.TaskPage.localTitleRequired', 'Title is required'))
      return
    }
    setError(null)
    setPending(true)
    const done = (): void => {
      setPending(false)
    }
    if (isCreate) {
      void onCreate({ title: trimmedTitle, description: description.trim() || undefined }).then(
        done,
        done
      )
    } else {
      const task = (dialog as { task: LocalTask }).task
      void onUpdate(task.id, {
        title: trimmedTitle,
        description: description.trim(),
        status
      }).then(done, done)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isCreate
              ? translate('auto.components.TaskPage.localNewTitle', 'New local task')
              : translate('auto.components.TaskPage.localEditTitle', 'Edit local task')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            {translate('auto.components.TaskPage.localTitleLabel', 'Title')}
            <Input
              aria-label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-sm">
            {translate('auto.components.TaskPage.localDescriptionLabel', 'Description')}
            <Textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1"
            />
          </label>
          {!isCreate ? (
            <label className="block text-sm">
              {translate('auto.components.TaskPage.localStatusLabel', 'Status')}
              <select
                aria-label="Status"
                value={status}
                onChange={(event) => setStatus(event.target.value as LocalTaskStatus)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                {LOCAL_TASK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {LOCAL_TASK_STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {translate('auto.components.TaskPage.localCancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {isCreate
              ? translate('auto.components.TaskPage.localCreate', 'Create')
              : translate('auto.components.TaskPage.localSave', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
