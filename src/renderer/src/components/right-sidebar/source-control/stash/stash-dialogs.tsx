import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import type { SourceControlStashActions } from './use-stash-actions'

function StashSaveDialog({ actions }: { actions: SourceControlStashActions }) {
  const [message, setMessage] = useState('')
  const title =
    actions.save?.action === 'push_staged'
      ? translate('sourceControl.stash.action.push_staged', 'Stash Staged')
      : actions.save?.action === 'push_untracked'
        ? translate('sourceControl.stash.action.push_untracked', 'Stash (Include Untracked)')
        : translate('sourceControl.stash.action.push', 'Stash')
  return (
    <Dialog
      open={actions.save !== null}
      onOpenChange={(open) => {
        if (!open && !actions.busy) {
          actions.setSave(null)
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void actions.saveStash(message)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{actions.save?.context.worktreePath}</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="stash-message">
              {translate('sourceControl.stash.message', 'Message (optional)')}
            </Label>
            <Input
              id="stash-message"
              value={message}
              maxLength={1000}
              disabled={actions.busy}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={actions.busy}
              onClick={() => actions.setSave(null)}
            >
              {translate('sourceControl.stash.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={actions.busy}>
              {title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function StashDialogs({ actions }: { actions: SourceControlStashActions }) {
  const picker = actions.picker
  const pickerTitle =
    picker?.action === 'apply'
      ? translate('sourceControl.stash.action.apply', 'Apply Stash…')
      : picker?.action === 'pop'
        ? translate('sourceControl.stash.action.pop', 'Pop Stash…')
        : picker?.action === 'drop'
          ? translate('sourceControl.stash.action.drop', 'Drop Stash…')
          : translate('sourceControl.stash.action.show', 'View Stash…')
  return (
    <>
      {actions.save ? (
        <StashSaveDialog
          key={`${actions.save.context.worktreeId}:${actions.save.action}`}
          actions={actions}
        />
      ) : null}
      <Dialog
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open && !actions.busy) {
            actions.setPicker(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pickerTitle}</DialogTitle>
            <DialogDescription>
              {picker?.context.worktreePath}
              <span className="block">
                {translate(
                  'sourceControl.stash.repositoryScope',
                  'Stashes are shared by all worktrees in this repository.'
                )}
              </span>
            </DialogDescription>
          </DialogHeader>
          {picker?.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {picker.error}
              </p>
              <Button
                variant="outline"
                onClick={() => void actions.requestStashAction(picker.action)}
              >
                {translate('sourceControl.stash.retry', 'Retry')}
              </Button>
            </div>
          ) : (
            <Command>
              <CommandInput
                placeholder={translate('sourceControl.stash.search', 'Search stashes…')}
                disabled={picker?.loading || actions.busy}
              />
              <CommandList aria-busy={picker?.loading || actions.busy}>
                <CommandEmpty>
                  {picker?.loading
                    ? translate('sourceControl.stash.loading', 'Loading stashes…')
                    : translate('sourceControl.stash.empty', 'No stashes found')}
                </CommandEmpty>
                {picker?.entries.map((stash) => (
                  <CommandItem
                    key={stash.ref}
                    value={`${stash.ref} ${stash.subject}`}
                    disabled={actions.busy}
                    onSelect={() => void actions.selectStash(stash)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{stash.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {stash.ref} · {stash.oid.slice(0, 8)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          )}
          {picker?.truncated ? (
            <p className="text-xs text-muted-foreground">
              {translate('sourceControl.stash.limited', 'Showing the latest 200 stashes.')}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={actions.view !== null}
        onOpenChange={(open) => {
          if (!open) {
            actions.setView(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {actions.view?.stash.ref}: {actions.view?.stash.subject}
            </DialogTitle>
            <DialogDescription>{actions.view?.worktreePath}</DialogDescription>
          </DialogHeader>
          <pre
            tabIndex={0}
            className="max-h-96 overflow-auto scrollbar-sleek rounded-md border border-border p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {actions.view?.output ||
              translate('sourceControl.stash.noDiff', 'No text diff available.')}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
